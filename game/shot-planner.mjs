// Action-directed shot planner for the COCS cinematic director.
//
// `planShot()` is a pure, deterministic function: no DOM, no three.js, no wall
// clock, no module-level mutable state. It reads a snapshot-shaped state (or a
// live Match, both expose `actors`/`vehicles`/`objectives`/`race`/`events`), a
// `safety` object of injected camera-collision callbacks, the previous decision
// returned by an earlier call, and timing. It returns the next shot decision
// plus the camera pose for that shot; the director owns smoothing.
//
// The planner picks *encounters and objectives* (firefights, kills and their
// aftermath, contested zones, flag carriers and pursuers, payload pushes, VIP
// escorts, vehicle duels, race packs and soccer attacks) instead of clusters of
// teammates doing nothing. A no-action fallback keeps a stable establishing
// shot on the objective (or arena centre); a flyover is only ever used as short
// context after a long calm stretch, and never in reduced motion.
//
// Selection uses hysteresis, a minimum shot duration and a hold window for
// important beats, so small score changes never cause an unwanted cut. Shots
// only blend when the two compositions are nearby, compatible and the sampled
// segment between camera poses is clear of walls and floors; otherwise the
// planner makes an intentional cut.

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = v => (Number.isFinite(v) ? v : 0);
const hasId = v => v !== null && v !== undefined;
const alive = a => !!a && !a.dead && num(a.health, 1) > 0;
const selectable = a => alive(a) && hasId(a.id);
const px = a => num(a && a.x);
const pz = a => num(a && a.z);
const headOf = a => ({ x: px(a), y: num(a && a.y) + 1.45, z: pz(a) });
const chestOf = a => ({ x: px(a), y: num(a && a.y) + 1.1, z: pz(a) });
const dist2d = (a, b) => Math.hypot(px(a) - num(b.x), pz(a) - num(b.z));
const dist3d = (a, b) => Math.hypot(px(a) - num(b.x), num(a.y) - num(b.y), pz(a) - num(b.z));
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const pitchTo = (from, to) => {
 const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, flat = Math.hypot(dx, dz);
 return flat < 1e-6 ? (dy >= 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(dy, flat);
};
const normal2 = (x, z) => { const l = Math.hypot(x, z); return l < 1e-9 ? { x: 0, z: 0 } : { x: x / l, z: z / l }; };
const perp2 = (d, sign = 1) => ({ x: -d.z * sign, z: d.x * sign });
const mixPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const hashUnit = text => {
 let h = 2166136261 >>> 0;
 const s = String(text);
 for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
 return h / 4294967296;
};

// ---------------------------------------------------------------------------
// Rig vocabulary. Planner rigs map onto the director's public CAMERA_RIGS so
// the HUD, keybinds and `pose.rig` stay unchanged.
// ---------------------------------------------------------------------------
export const SHOT_RIGS = ['ots', 'side', 'combat', 'tripod', 'objective', 'firstperson', 'establish', 'flyover'];
export const SHOT_RIG_TO_RIG = { ots: 'chase', side: 'follow', combat: 'orbit', tripod: 'tripod', objective: 'dolly', firstperson: 'firstperson', establish: 'crane', flyover: 'flyover' };
export const RIG_TO_SHOT = { chase: 'ots', follow: 'side', orbit: 'combat', tripod: 'tripod', dolly: 'objective', firstperson: 'firstperson', crane: 'establish', flyover: 'flyover' };

// ---------------------------------------------------------------------------
// Tuning. Every threshold lives here so tests and callers can reason about the
// planner without reading the scoring code.
// ---------------------------------------------------------------------------
export const PLANNER = {
 minShot: 2.2, reducedMinShot: 3.4,          // minimum duration of an action shot
 hysteresis: .12, reducedHysteresis: .22,    // score margin needed to leave a shot
 killHold: 2.4, objectiveHold: 2.6,          // hold windows for a beat to resolve
 momentCutWindow: .8,                        // fresh beats may interrupt a related encounter
 allowFirstPerson: true,
 eventMemory: 5,                             // seconds of event history that matter
 maxSubjects: 3, maxRigsPerSubject: 3, maxCandidates: 12,
 fireRange: 26, pursuitRange: 30, vehicleRange: 48, soccerRange: 42,
 otsDistance: 3.6, otsSide: 1.15,
 sideDistance: 5.6,
 combatMin: 5.5, combatMax: 14,
 tripodDistance: 8.5, tripodHeight: 3.2,
 objectiveDistance: 10.5, objectiveHeight: 3.8,
 establishDistance: 22, establishHeight: 11,
 flyoverRadius: 26, flyoverHeight: 13, flyoverCooldown: 24, flyoverCalm: 24, flyoverDuration: 4.2,
 minCameraHeight: .8, cameraRadius: .55, minSubjectDistance: 2.4,
 maxBlendDistance: 10, reducedBlendDistance: 6.5,
 maxBlendAngle: Math.PI / 3, reducedBlendAngle: Math.PI / 5,
 blendSamples: 8, reducedBlendSamples: 6,
 screenMin: .12, screenGood: .42, screenMax: 1.15, subjectHeight: 1.8,
 maxShot: 6,                                 // incumbent age before the stale penalty
 incumbentBonus: .05, repeatMargin: .06,
 penaltyRigImmediate: .10, penaltyRigRepeat: .05, penaltyTargetRepeat: .06, penaltyAngleRepeat: .05,
 stalePenalty: .25,
 boundsMargin: 6,
};

// ---------------------------------------------------------------------------
// Scoring table. Shots are scored 0..~0.8:
//
//   gate    = gateBase + gateScale * relevance          (0.2 .. 1.0)
//   quality = recency*recency + visibility*vis + framing*fit
//           + inclusion*inc + clearance*clr + continuity*cont   (0 .. 0.68)
//   score   = gate*quality
//           + resolve * resolution bonus   (fresh kill / contested beat)
//           + incumbentBonus               (keeps the current shot sticky)
//           - repetitionPenalties          (recent rig / target / angle)
//           - stalePenalty                 (incumbent outlives maxShot)
//   switch only when best.score > current.score + hysteresis (+ holdBreak
//   while a beat is inside its hold window), unless a fresh moment overrides.
//
// relevance/safety semantics:
//   relevance  structural importance of the subject (firefight > idle cluster)
//   recency    how fresh the events behind the subject are
//   visibility ratio of subject (and opponent) the safety callbacks can see
//   framing    how close the subject's apparent size is to a readable size
//   inclusion  opponent / objective present inside the frame
//   clearance  camera not inside geometry: obstruction + floor margin
//   continuity overlap with the previous shot's target / camera position
// ---------------------------------------------------------------------------
export const SCORING = {
 gateBase: .2, gateScale: .8,
 recency: .16, visibility: .16, framing: .12, inclusion: .10, clearance: .08, continuity: .06,
 resolve: .14,
 hysteresis: .12, holdBreak: .35,
};

const KIND_ORDER = { kill: 0, firefight: 1, objective: 2, vip: 3, vehicle: 4, soccer: 5, race: 6, establish: 7, flyover: 8 };

// ---------------------------------------------------------------------------
// Input normalisation.
// ---------------------------------------------------------------------------
function flagList(state) {
 const raw = (state && state.flags) || (state && state.objectives && state.objectives.flags);
 if (Array.isArray(raw)) return raw;
 if (raw && typeof raw === 'object') return Object.values(raw);
 return [];
}

function objectiveState(state) {
 if (state.objectives && typeof state.objectives === 'object') return state.objectives;
 if (state.objectiveState && typeof state.objectiveState === 'object') return state.objectiveState;
 return null;
}

function eventStamp(ev, fallback) {
 if (Number.isFinite(ev.seenAt)) return ev.seenAt;
 if (Number.isFinite(ev.time)) return ev.time;
 return fallback;
}

function gatherEvents(state, inputEvents, now, cfg) {
 const out = [];
 const seen = new Set();
 const add = ev => {
  if (!ev || typeof ev !== 'object' || !ev.type) return;
  const key = `${ev.type}|${ev.id ?? ''}|${ev.time ?? ''}|${ev.actor ?? ''}|${ev.source ?? ''}|${ev.killer ?? ''}|${ev.pos ? `${ev.pos.x},${ev.pos.z}` : ''}`;
  if (seen.has(key)) return;
  const ts = eventStamp(ev, now);
  const age = now - ts;
  if (age > cfg.eventMemory) return;
  seen.add(key);
  out.push({ ev, age: Math.max(0, age), ts });
 };
 if (Array.isArray(inputEvents)) for (const ev of inputEvents) add(ev);
 if (Array.isArray(state.events)) for (const ev of state.events) add(ev);
 return out;
}

function makeCtx(input, state, now, cfg, safety) {
 const rawActors = Array.isArray(state.actors) ? state.actors : [];
 const actors = rawActors.filter(a => a && hasId(a.id) && Number.isFinite(a.x) && Number.isFinite(a.z));
 const byId = new Map(actors.map(a => [a.id, a]));
 const vehicles = (Array.isArray(state.vehicles) ? state.vehicles : []).filter(v => v && hasId(v.id) && Number.isFinite(v.x) && Number.isFinite(v.z));
 const center = (input.center && Number.isFinite(input.center.x)) ? { x: input.center.x, z: num(input.center.z) }
  : (state.center && Number.isFinite(state.center.x)) ? { x: state.center.x, z: num(state.center.z) }
  : { x: 0, z: 0 };
 const previous = input.previous && typeof input.previous === 'object' ? input.previous : null;
 const recent = gatherEvents(state, input.events, now, cfg);
 return {
  state, actors, byId, vehicles, center, previous, recent,
  flags: flagList(state), objectives: objectiveState(state),
  race: state.race && typeof state.race === 'object' ? state.race : null,
  safety: safety && typeof safety === 'object' ? safety : {},
  now, cfg, reduced: input.reduced === true, forceCut: input.forceCut === true,
  shoulder: input.shoulderSign === 1 || input.shoulderSign === -1 ? input.shoulderSign : null,
 };
}

// ---------------------------------------------------------------------------
// Safety callbacks. Missing callbacks degrade to "clear open ground" so the
// planner still works in lightweight tests; the director injects the real
// arena-backed implementations.
// ---------------------------------------------------------------------------
const safeFloor = (safety, x, z) => {
 if (typeof safety.floorAt !== 'function') return 0;
 const v = safety.floorAt(x, z);
 return Number.isFinite(v) ? v : null;
};
const safeObstructed = (safety, x, y, z, r) => (typeof safety.obstructed === 'function' ? safety.obstructed(x, y, z, r) === true : false);
const safeVisible = (safety, a, b) => (typeof safety.rayVisible === 'function' ? safety.rayVisible(a, b) !== false : true);
const safeInterior = (safety, point) => (typeof safety.interiorAt === 'function' ? safety.interiorAt(point) : null);
const inBounds = (safety, x, z, margin) => {
 const b = safety.bounds;
 if (!b || !Number.isFinite(b.minX) || !Number.isFinite(b.maxX)) return true;
 return x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;
};

// ---------------------------------------------------------------------------
// Subjects: encounters, beats and objectives worth pointing a camera at.
// ---------------------------------------------------------------------------
const enemyOf = (ctx, a, b) => {
 if (!a || !b) return false;
 const ta = a.team, tb = b.team;
 if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
 return ta !== tb;
};

function makeSubject(partial) {
 return {
  kind: 'establish', reason: 'shot', targets: [], primary: null,
  anchor: { x: 0, y: 0, z: 0 }, relevance: 0, recency: 1,
  moment: false, age: 0, hold: 0, rank: 0, ...partial,
 };
}

function damagePairs(ctx) {
 const map = new Map();
 for (const { ev, age } of ctx.recent) {
  if (ev.type !== 'damage') continue;
  const src = ev.source, dst = ev.actor;
  if (!hasId(src) || !hasId(dst) || src === dst) continue;
  const lo = Math.min(src, dst), hi = Math.max(src, dst), key = `${lo}|${hi}`;
  const rec = map.get(key) || { a: lo, b: hi, damage: 0, age: Infinity, dirs: new Set() };
  rec.damage += num(ev.amount, 10);
  rec.age = Math.min(rec.age, age);
  rec.dirs.add(`${src}>${dst}`);
  map.set(key, rec);
 }
 for (const rec of map.values()) rec.mutual = rec.dirs.size > 1;
 return map;
}

// Misses are still action. Use the recorded shot segment (not bot intent) to
// identify an opponent under fire before the first damage event arrives.
function shootingSubjects(ctx, out) {
 const pairs = new Set();
 for (let i = ctx.recent.length - 1; i >= 0; i--) {
  const { ev, age } = ctx.recent[i];
  if (ev.type !== 'shot' || !ev.from || !ev.to) continue;
  const shooter = ctx.byId.get(ev.actor);
  if (!selectable(shooter)) continue;
  const dx = ev.to.x - ev.from.x, dz = ev.to.z - ev.from.z, length2 = dx * dx + dz * dz;
  if (!(length2 > 1)) continue;
  const opponent = ctx.actors.filter(a => selectable(a) && a.id !== shooter.id && enemyOf(ctx, shooter, a))
   .map(a => {
    const t = clamp(((a.x - ev.from.x) * dx + (a.z - ev.from.z) * dz) / length2, 0, 1);
    return { a, distance: Math.hypot(a.x - ev.from.x - t * dx, a.z - ev.from.z - t * dz) };
   }).filter(({ a, distance }) => distance < 3 && dist2d(a, shooter) <= ctx.cfg.fireRange * 2)
   .sort((a, b) => a.distance - b.distance || a.a.id - b.a.id)[0]?.a;
  if (!opponent) continue;
  const targets = [shooter.id, opponent.id].sort((a, b) => a - b), key = `fight:${targets.join(':')}`;
  if (pairs.has(key)) continue;
  pairs.add(key);
  out.push(makeSubject({ key, kind: 'firefight', reason: `exchange ${shooter.name ?? shooter.id}/${opponent.name ?? opponent.id}`,
   targets, primary: targets[0], anchor: mixPoint(chestOf(shooter), chestOf(opponent), .5),
   relevance: .62, recency: clamp(1 - age / ctx.cfg.eventMemory, 0, 1), age }));
 }
}

function encounterSubjects(ctx, out) {
 // Kills (and the death aftermath) are the strongest beats in the planner.
 for (const { ev, age } of ctx.recent) {
  if (ev.type === 'death') {
   const victim = ctx.byId.get(ev.actor) || null;
   const killer = ctx.byId.get(ev.killer) || null;
   const anchor = ev.pos && Number.isFinite(ev.pos.x)
    ? { x: ev.pos.x, y: num(ev.pos.y) + 1, z: ev.pos.z }
    : victim ? headOf(victim) : null;
   if (!anchor) continue;
   const targets = [];
   if (selectable(killer)) targets.push(killer.id);
   if (selectable(victim)) targets.push(victim.id);
   if (!targets.length) continue; // dead and missing: skip, never invent a subject
   const recency = clamp(1 - age / 3.5, 0, 1);
   out.push(makeSubject({
    key: `death:${ev.id ?? ev.time}:${ev.actor}:${ev.killer}`, kind: 'kill', reason: `kill ${victim && victim.name ? victim.name : ev.actor ?? '?'}`,
    targets, primary: targets[0], victim: ev.actor, anchor,
    relevance: clamp(.35 + .55 * recency + .1, 0, 1), recency, moment: true, age, hold: ctx.cfg.killHold,
   }));
  } else if (ev.type === 'explosion') {
   if (!ev.pos || !Number.isFinite(ev.pos.x)) continue;
   const anchor = { x: ev.pos.x, y: num(ev.pos.y) + .6, z: ev.pos.z };
   const near = ctx.actors.filter(a => selectable(a) && dist2d(a, anchor) <= 10).map(a => a.id).sort((a, b) => a - b).slice(0, 3);
   if (!near.length) continue;
   const recency = clamp(1 - age / 3, 0, 1);
   out.push(makeSubject({
    key: `explosion:${ev.id ?? ev.time}:${anchor.x}:${anchor.z}`, kind: 'kill', reason: 'explosion', targets: near, primary: near[0] ?? null, anchor,
    relevance: clamp(.45 + .5 * recency, 0, 1), recency, moment: true, age, hold: ctx.cfg.objectiveHold,
   }));
  } else if (ev.type === 'melee' && hasId(ev.hit)) {
   const attacker = ctx.byId.get(ev.actor), victim = ctx.byId.get(ev.hit);
   const anchor = ev.pos && Number.isFinite(ev.pos.x)
    ? { x: ev.pos.x, y: num(ev.pos.y) + 1, z: ev.pos.z }
    : attacker && victim ? mixPoint(chestOf(attacker), chestOf(victim), .5) : attacker ? headOf(attacker) : null;
   if (!anchor) continue;
   const targets = [attacker, victim].filter(selectable).map(a => a.id);
   if (!targets.length) continue;
   const recency = clamp(1 - age / 3, 0, 1);
   out.push(makeSubject({
    key: `melee:${ev.id ?? ev.time}:${ev.actor}:${ev.hit}`, kind: 'kill', reason: `melee ${attacker && attacker.name ? attacker.name : ev.actor ?? '?'}`, targets, primary: targets[0], anchor,
    relevance: clamp(.4 + .5 * recency, 0, 1), recency, moment: true, age, hold: ctx.cfg.killHold,
   }));
  } else if (ev.type === 'vehicle-destroyed') {
   if (!ev.pos || !Number.isFinite(ev.pos.x)) continue;
   const anchor = { x: ev.pos.x, y: num(ev.pos.y) + 1.2, z: ev.pos.z };
   const crew = [ev.driver, ...(Array.isArray(ev.occupants) ? ev.occupants : [])].filter(hasId);
   const targets = crew.map(id => ctx.byId.get(id)).filter(selectable).map(a => a.id).sort((a, b) => a - b);
   const near = ctx.actors.filter(a => selectable(a) && dist2d(a, anchor) <= 12).map(a => a.id).sort((a, b) => a - b);
   const merged = [...new Set([...targets, ...near])].slice(0, 3);
   const recency = clamp(1 - age / 3, 0, 1);
   out.push(makeSubject({
    key: `destroyed:${ev.id ?? ev.time}:${ev.vehicle}`, kind: 'vehicle', reason: 'vehicle destroyed', targets: merged, primary: merged[0] ?? null, anchor,
    relevance: clamp(.5 + .45 * recency, 0, 1), recency, moment: true, age, hold: ctx.cfg.objectiveHold,
   }));
  }
 }
 // Reciprocal fire: opponents actively trading damage within engagement range.
 for (const rec of damagePairs(ctx).values()) {
  const a = ctx.byId.get(rec.a), b = ctx.byId.get(rec.b);
  if (!selectable(a) || !selectable(b) || !enemyOf(ctx, a, b)) continue;
  const d = dist2d(a, b);
  if (d > ctx.cfg.fireRange) continue;
  const recency = clamp(1 - rec.age / (ctx.cfg.eventMemory * .8), 0, 1);
  const closeness = clamp(1 - d / ctx.cfg.fireRange, 0, 1);
  const damage = clamp(rec.damage / 120, 0, 1);
  const anchor = { x: (px(a) + px(b)) / 2, y: (num(a.y) + num(b.y)) / 2 + 1.15, z: (pz(a) + pz(b)) / 2 };
  out.push(makeSubject({
   key: `fight:${rec.a}:${rec.b}`, kind: 'firefight', reason: `firefight ${a.name ?? a.id}/${b.name ?? b.id}`,
   targets: [rec.a, rec.b], primary: rec.a, anchor,
   relevance: clamp(.40 + .30 * (rec.mutual ? 1 : 0) + .20 * closeness + .10 * damage, 0, 1),
   recency, moment: false, age: rec.age, hold: 0,
  }));
 }
}

function objectiveSubjects(ctx, out) {
 const o = ctx.objectives;
 // CTF flags: carriers and their pursuers, dropped flags with nearby players.
 for (const flag of ctx.flags) {
  if (!flag || typeof flag !== 'object') continue;
  if (flag.state === 'carried' && hasId(flag.carrier)) {
   const carrier = ctx.byId.get(flag.carrier);
   if (!selectable(carrier)) continue;
   const pursuers = ctx.actors
    .filter(a => selectable(a) && a.id !== carrier.id && enemyOf(ctx, a, carrier))
    .map(a => ({ a, d: dist2d(a, carrier) }))
    .filter(x => x.d <= ctx.cfg.pursuitRange)
    .sort((x, y) => x.d - y.d || x.a.id - y.a.id);
   const targets = [carrier.id, ...pursuers.slice(0, 2).map(x => x.a.id)];
   const threat = pursuers.length ? clamp(1 - pursuers[0].d / ctx.cfg.pursuitRange, 0, 1) : 0;
   out.push(makeSubject({
    key: `flag:${flag.team}:carrier:${carrier.id}`, kind: 'objective', reason: `flag carrier ${carrier.name ?? carrier.id}`,
    targets, primary: carrier.id, anchor: { x: px(carrier), y: num(carrier.y) + 1.15, z: pz(carrier) },
    relevance: clamp(.45 + .25 * threat + .15 * (pursuers.length ? 1 : 0) + .15, 0, 1),
    recency: 1, moment: false, age: 0, hold: ctx.cfg.objectiveHold,
   }));
  } else if (flag.state === 'dropped' && Number.isFinite(flag.x)) {
   const anchor = { x: flag.x, y: num(flag.y) + .4, z: num(flag.z) };
   const near = ctx.actors.filter(a => selectable(a) && dist2d(a, anchor) <= 12).map(a => a.id).sort((a, b) => a - b).slice(0, 3);
   out.push(makeSubject({
    key: `flag:${flag.team}:dropped`, kind: 'objective', reason: 'dropped flag', targets: near, primary: near[0] ?? null, anchor,
    relevance: clamp(.32 + .2 * (near.length ? 1 : 0), 0, 1),
    recency: 1, moment: false, age: 0, hold: ctx.cfg.objectiveHold,
   }));
  }
 }
 // Contested / changing zones (koth, domination, assault).
 for (const zone of o && Array.isArray(o.zones) ? o.zones : []) {
  if (!zone || !Number.isFinite(zone.x) || !Number.isFinite(zone.z)) continue;
  const radius = num(zone.radius, 5);
  const inside = ctx.actors.filter(a => selectable(a) && dist2d(a, zone) <= radius * 1.4).map(a => a.id).sort((a, b) => a - b).slice(0, 4);
  const contested = zone.contested === true;
  const progress = clamp(num(zone.progress, 0) / 100, 0, 1);
  const capturing = zone.captureTeam !== null && zone.captureTeam !== undefined;
  if (!inside.length && !contested && !capturing && progress <= 0) continue;
  const tags = [contested ? 'contested' : capturing ? 'capturing' : 'held'];
  out.push(makeSubject({
   key: `zone:${zone.id ?? `${zone.x}:${zone.z}`}`, kind: 'objective', reason: `zone ${zone.id ?? ''} ${tags[0]}`.replace(/\s+/g, ' ').trim(),
   targets: inside, primary: inside[0] ?? null,
   anchor: { x: zone.x, y: num(zone.y, 0) + 1, z: zone.z },
   relevance: clamp(.42 + .28 * (contested ? 1 : 0) + .18 * progress + .12 * (inside.length ? 1 : 0), 0, 1),
   recency: 1, moment: false, age: 0, hold: ctx.cfg.objectiveHold,
  }));
 }
 // Payload pushes.
 const payload = (o && o.payload) || (o && o.kind === 'payload' ? o : null);
 if (payload && payload.position && Number.isFinite(payload.position.x)) {
  const p = payload.position;
  const near = ctx.actors.filter(a => selectable(a) && dist2d(a, p) <= 16).map(a => a.id).sort((a, b) => a - b).slice(0, 4);
  const pushing = payload.pushing === true || num(payload.speed, 0) > .15;
  const contested = payload.contested === true;
  const progress = clamp(num(payload.progress, 0), 0, 1);
  const reason = contested ? 'payload contested' : pushing ? 'payload push' : 'payload';
  out.push(makeSubject({
   key: 'payload', kind: 'objective', reason, targets: near, primary: near[0] ?? null,
   anchor: { x: p.x, y: num(p.y) + 1.2, z: p.z },
   relevance: clamp(.45 + .25 * (pushing ? 1 : 0) + .20 * (contested ? 1 : 0) + .10 * progress, 0, 1),
   recency: 1, moment: false, age: 0, hold: ctx.cfg.objectiveHold,
  }));
 }
 // VIP escorts: juggernaut or extraction.
 const vipId = Number.isFinite(o && o.juggernautId) ? o.juggernautId : (o && Number.isFinite(o.vipId) ? o.vipId : null);
 if (vipId !== null) {
  const vip = ctx.byId.get(vipId);
  if (selectable(vip)) {
   const enemy = ctx.actors
    .filter(a => selectable(a) && enemyOf(ctx, a, vip))
    .map(a => ({ a, d: dist2d(a, vip) }))
    .sort((x, y) => x.d - y.d || x.a.id - y.a.id)[0];
   const targets = [vip.id];
   if (enemy && enemy.d <= 32) targets.push(enemy.a.id);
   out.push(makeSubject({
    kind: 'vip', reason: `vip ${vip.name ?? vip.id}`, targets, primary: vip.id,
    anchor: { x: px(vip), y: num(vip.y) + 1.15, z: pz(vip) },
    relevance: clamp(.55 + .25 * (enemy ? clamp(1 - enemy.d / 32, 0, 1) : 0) + .20, 0, 1),
    recency: 1, moment: false, age: 0, hold: ctx.cfg.objectiveHold,
   }));
  }
 }
}

function vehicleSubjects(ctx, out) {
 const vehicles = ctx.vehicles.filter(v => num(v.health, 1) > 0);
 const damaged = new Map();
 for (const { ev, age } of ctx.recent) {
  if (ev.type === 'vehicle-damage' && hasId(ev.vehicle)) damaged.set(ev.vehicle, Math.min(damaged.get(ev.vehicle) ?? Infinity, age));
 }
 for (let i = 0; i < vehicles.length; i++) for (let j = i + 1; j < vehicles.length; j++) {
  const a = vehicles[i], b = vehicles[j];
  const d = Math.hypot(num(a.x) - num(b.x), num(a.z) - num(b.z));
  if (d > ctx.cfg.vehicleRange) continue;
  const crewA = [a.driver, a.gunner, ...(Array.isArray(a.passengers) ? a.passengers : [])].filter(hasId);
  const crewB = [b.driver, b.gunner, ...(Array.isArray(b.passengers) ? b.passengers : [])].filter(hasId);
  const leadA = crewA.map(id => ctx.byId.get(id)).find(selectable);
  const leadB = crewB.map(id => ctx.byId.get(id)).find(selectable);
  if (!leadA || !leadB || !enemyOf(ctx, leadA, leadB)) continue;
  const hitAge = Math.min(damaged.get(a.id) ?? Infinity, damaged.get(b.id) ?? Infinity);
  const recency = Number.isFinite(hitAge) ? clamp(1 - hitAge / 4, 0, 1) : clamp(1 - (Math.min(...[...damaged.values()].filter(Number.isFinite), Infinity)) / 4, 0, 0);
  out.push(makeSubject({
   kind: 'vehicle', reason: `vehicle duel ${a.id}/${b.id}`,
   targets: [leadA.id, leadB.id], primary: leadA.id,
   anchor: { x: (num(a.x) + num(b.x)) / 2, y: (num(a.y) + num(b.y)) / 2 + 1.2, z: (num(a.z) + num(b.z)) / 2 },
   relevance: clamp(.40 + .25 * clamp(1 - d / ctx.cfg.vehicleRange, 0, 1) + .20 * (Number.isFinite(hitAge) ? 1 : 0) + .15 * clamp((crewA.length + crewB.length) / 4, 0, 1), 0, 1),
   recency: Number.isFinite(hitAge) ? recency : 1, moment: false, age: Number.isFinite(hitAge) ? hitAge : 0, hold: ctx.cfg.objectiveHold,
  }));
 }
}

function vehicleById(ctx, id) {
 if (!hasId(id)) return null;
 return ctx.vehicles.find(v => v.id === id) || ctx.byId.get(id) || null;
}

// Snapshots publish `standings`; a live Match race state carries `racers`.
function standingsOf(race) {
 if (!race) return [];
 if (Array.isArray(race.standings)) return race.standings;
 if (Array.isArray(race.racers)) {
  return [...race.racers]
   .sort((a, b) => ((a.finishTime ?? Infinity) - (b.finishTime ?? Infinity)) || num(b.progress) - num(a.progress) || a.actorId - b.actorId)
   .map(r => ({ actorId: r.actorId, vehicleId: r.vehicleId, progress: num(r.progress), finishTime: r.finishTime ?? null }));
 }
 return [];
}

function raceSubjects(ctx, out) {
 const race = ctx.race;
 if (!race || race.kind === 'soccer') return;
 const standings = standingsOf(race);
 if (!standings.length) return;
 const prevOrder = ctx.previous && ctx.previous.watch && Array.isArray(ctx.previous.watch.raceOrder) ? ctx.previous.watch.raceOrder : null;
 let best = null;
 for (let i = 0; i < standings.length - 1; i++) {
  const a = standings[i], b = standings[i + 1];
  const va = vehicleById(ctx, a.vehicleId), vb = vehicleById(ctx, b.vehicleId);
  if (!va || !vb) continue;
  const d = Math.hypot(num(va.x) - num(vb.x), num(va.z) - num(vb.z));
  if (d > 34) continue;
  const gap = Math.abs(num(a.progress) - num(b.progress));
  const swapped = prevOrder && (prevOrder[i] !== a.actorId || prevOrder[i + 1] !== b.actorId);
  const rel = clamp(.35 + .30 * clamp(1 - gap / .12, 0, 1) + .20 * clamp(1 - d / 34, 0, 1) + .15 * (swapped ? 1 : 0), 0, 1);
  if (!best || rel > best.rel) {
   best = {
    rel, targets: [a.actorId, b.actorId], primary: a.actorId,
    anchor: { x: (num(va.x) + num(vb.x)) / 2, y: (num(va.y) + num(vb.y)) / 2 + 1, z: (num(va.z) + num(vb.z)) / 2 },
    reason: swapped ? `overtake ${a.actorId}/${b.actorId}` : `race pack ${a.actorId}/${b.actorId}`,
   };
  }
 }
 if (!best) {
  const leader = standings[0];
  const v = vehicleById(ctx, leader.vehicleId);
  if (v) {
   best = {
    rel: .30, targets: [leader.actorId], primary: leader.actorId,
    anchor: { x: num(v.x), y: num(v.y) + 1, z: num(v.z) }, reason: `race leader ${leader.actorId}`,
   };
  }
 }
 if (!best) return;
 out.push(makeSubject({
  key: `race:${best.targets.slice().sort((a,b)=>a-b).join(':')}`, kind: 'race', reason: best.reason, targets: best.targets, primary: best.primary, anchor: best.anchor,
  relevance: best.rel, recency: 1, moment: false, age: 0, hold: ctx.cfg.objectiveHold,
 }));
}

function soccerSubjects(ctx, out) {
 const race = ctx.race;
 if (!race || race.kind !== 'soccer' || !race.ball || !Number.isFinite(race.ball.x)) return;
 const ball = race.ball;
 const goals = Array.isArray(race.goals) ? race.goals : [];
 let goalDistance = Infinity;
 for (const g of goals) {
  if (!Number.isFinite(g && g.x)) continue;
  goalDistance = Math.min(goalDistance, Math.hypot(ball.x - num(g.x), ball.z - num(g.z)));
 }
 const speed = Math.hypot(num(ball.vx), num(ball.vz));
 const near = (Array.isArray(race.standings) ? race.standings : [])
  .map(r => ({ id: r.actorId, v: vehicleById(ctx, r.vehicleId) }))
  .filter(x => x.v && Math.hypot(num(x.v.x) - ball.x, num(x.v.z) - ball.z) <= 16)
  .map(x => ({ id: x.id, d: Math.hypot(num(x.v.x) - ball.x, num(x.v.z) - ball.z) }))
  .sort((a, b) => a.d - b.d || a.id - b.id);
 if (goalDistance > ctx.cfg.soccerRange && !near.length) return;
 const anchor = { x: ball.x + num(ball.vx) * .45, y: num(ball.y) + .7, z: ball.z + num(ball.vz) * .45 };
 out.push(makeSubject({
  key: 'soccer:ball', kind: 'soccer', reason: goalDistance <= ctx.cfg.soccerRange ? 'soccer attack' : 'soccer ball',
  targets: near.slice(0, 2).map(x => x.id), primary: near[0] ? near[0].id : null, anchor,
  relevance: clamp(.40 + .35 * clamp(1 - goalDistance / ctx.cfg.soccerRange, 0, 1) + .25 * clamp(speed / 18, 0, 1), 0, 1),
  recency: 1, moment: false, age: 0, hold: ctx.cfg.objectiveHold,
 }));
}

function objectiveAnchor(ctx) {
 const o = ctx.objectives;
 if (o && o.payload && o.payload.position && Number.isFinite(o.payload.position.x)) {
  return { x: o.payload.position.x, y: num(o.payload.position.y) + 1, z: o.payload.position.z };
 }
 for (const zone of o && Array.isArray(o.zones) ? o.zones : []) {
  if (zone && Number.isFinite(zone.x) && Number.isFinite(zone.z)) return { x: zone.x, y: num(zone.y, 0) + 1, z: zone.z };
 }
 for (const flag of ctx.flags) {
  if (flag && Number.isFinite(flag.x) && Number.isFinite(flag.z)) return { x: flag.x, y: num(flag.y) + 1, z: flag.z };
 }
 return null;
}

function buildSubjects(ctx) {
 const out = [];
 encounterSubjects(ctx, out);
 shootingSubjects(ctx, out);
 objectiveSubjects(ctx, out);
 vehicleSubjects(ctx, out);
 raceSubjects(ctx, out);
 soccerSubjects(ctx, out);
 for (const s of out) {
  s.key ??= `${s.kind}:${s.reason}:${s.primary ?? ''}`;
  s.rank = s.relevance * (.55 + .45 * clamp(s.recency, 0, 1)) + (s.moment ? .18 : 0);
 }
 out.sort((a, b) => b.rank - a.rank || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (a.primary ?? -1) - (b.primary ?? -1));
 // Collapse near-duplicates (e.g. the same death event ingested twice).
 const deduped = [];
 for (const s of out) {
  const duplicate = deduped.find(d => d.key === s.key);
  if (!duplicate) deduped.push(s);
 }
 // Candidate composition is bounded separately. Never evict the held encounter
 // just because several higher-ranked events arrived elsewhere this frame.
 return deduped;
}

function subjectActors(subject, ctx) {
 const list = subject.targets.map(id => ctx.byId.get(id)).filter(Boolean);
 const primary = list.find(selectable) || null;
 const opponent = list.find(a => a !== primary && selectable(a)) || null;
 return { list, primary, opponent };
}

// ---------------------------------------------------------------------------
// Candidate composition. Each candidate is one rig pointed at one subject.
// ---------------------------------------------------------------------------
function facing2(primary, opponent) {
 if (opponent) {
  const n = normal2(px(opponent) - px(primary), pz(opponent) - pz(primary));
  if (n.x || n.z) return n;
 }
 const yaw = num(primary && primary.yaw, 0);
 return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

function stableAngle(ctx, target, key) {
 const prev = ctx.previous && ctx.previous.pose;
 if (prev && Number.isFinite(prev.x)) {
  const origin = ctx.previous.aim || target;
  const dx = prev.x - origin.x, dz = prev.z - origin.z;
  if (Math.hypot(dx, dz) > 1.5) return Math.atan2(dz, dx);
 }
 return hashUnit(key) * TAU;
}

function firstPersonReadable(subject, ctx) {
 if (!ctx.cfg.allowFirstPerson) return false;
 const { primary } = subjectActors(subject, ctx);
 if (!primary || primary.vehicleId != null) return false;
 // The subject's aim is only readable while they are actually shooting or
 // hitting something; an idle stare at a distant enemy is not a POV shot.
 // (`damage.actor` is the victim, `damage.source` the shooter.)
 return ctx.recent.some(({ ev, age }) => {
  if (age > 1.4) return false;
  if (ev.type === 'shot' || ev.type === 'melee' || ev.type === 'launch') return ev.actor === primary.id;
  if (ev.type === 'damage') return ev.source === primary.id;
  return false;
 });
}

function candidateRigs(subject, ctx) {
 let rigs;
 if (subject.kind === 'kill' || subject.kind === 'firefight') rigs = ['ots', 'combat', 'side', 'tripod'];
 else if (subject.kind === 'vehicle') rigs = ['side', 'ots', 'combat', 'tripod'];
 else if (subject.kind === 'objective') rigs = ['objective', 'tripod', 'ots'];
 else if (subject.kind === 'vip') rigs = ['ots', 'side', 'objective'];
 else if (subject.kind === 'race') rigs = ['side', 'ots', 'tripod'];
 else if (subject.kind === 'soccer') rigs = ['objective', 'side', 'combat'];
 else rigs = ['establish', 'tripod', 'objective'];
 if (firstPersonReadable(subject, ctx) && !rigs.includes('firstperson')) rigs.splice(1, 0, 'firstperson');
 return rigs;
}

function composeCandidate(subject, rig, ctx) {
 const { primary, opponent } = subjectActors(subject, ctx);
 const anchor = subject.anchor;
 const cfg = ctx.cfg;
 let pose = null, aim = null, framing = 'stable', fov = 66;
 if (rig === 'ots') {
  if (!primary) return null;
  const f = facing2(primary, opponent || (subject.kind === 'kill' ? anchor : null));
  const side = perp2(f, ctx.shoulder ?? 1);
  const base = chestOf(primary);
  pose = {
   x: base.x - f.x * cfg.otsDistance + side.x * cfg.otsSide,
   y: num(primary.y) + 1.72,
   z: base.z - f.z * cfg.otsDistance + side.z * cfg.otsSide,
  };
  aim = opponent ? mixPoint(chestOf(primary), chestOf(opponent), .62)
   : subject.kind === 'kill' ? mixPoint(chestOf(primary), anchor, .55) : headOf(primary);
  framing = 'over-shoulder';
  fov = 62;
 } else if (rig === 'side') {
  if (!primary) return null;
  const f = facing2(primary, opponent || (subject.kind === 'kill' ? anchor : null));
  const side = perp2(f, 1);
  const base = chestOf(primary);
  pose = { x: base.x + side.x * cfg.sideDistance, y: num(primary.y) + 1.6, z: base.z + side.z * cfg.sideDistance };
  aim = opponent && subject.kind !== 'kill' ? mixPoint(chestOf(primary), chestOf(opponent), .35) : chestOf(primary);
  framing = 'side';
  fov = 66;
 } else if (rig === 'combat') {
  if (!primary || (!opponent && subject.kind !== 'kill')) return null;
  const a = chestOf(primary), b = opponent ? chestOf(opponent) : anchor;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const line = normal2(b.x - a.x, b.z - a.z);
  const side = perp2(line, ctx.shoulder ?? 1);
  const lineLen = Math.hypot(b.x - a.x, b.z - a.z);
  const dist = clamp(lineLen * .7 + 3.2, cfg.combatMin, cfg.combatMax);
  pose = { x: mid.x + side.x * dist, y: mid.y + 1.7, z: mid.z + side.z * dist };
  aim = mid;
  framing = 'combat';
  fov = 68;
 } else if (rig === 'tripod') {
  const target = primary ? chestOf(primary) : anchor;
  const angle = stableAngle(ctx, target, `tripod:${subject.kind}:${subject.primary ?? 'x'}`);
  pose = {
   x: target.x + Math.cos(angle) * cfg.tripodDistance,
   y: (primary ? num(primary.y) : target.y) + cfg.tripodHeight,
   z: target.z + Math.sin(angle) * cfg.tripodDistance,
  };
  aim = { x: target.x, y: target.y + .1, z: target.z };
  framing = 'stable';
  fov = 58;
 } else if (rig === 'objective') {
  let dir = null;
  if (primary) dir = normal2(anchor.x - px(primary), anchor.z - pz(primary));
  if (!dir || (!dir.x && !dir.z)) dir = normal2(anchor.x - ctx.center.x, anchor.z - ctx.center.z);
  if (!dir || (!dir.x && !dir.z)) dir = { x: 0, z: -1 };
  if (ctx.previous && ctx.previous.subjectKey === subject.key && ctx.previous.rig === rig) {
   const angle = stableAngle(ctx, anchor, subject.key);
   dir = { x: Math.cos(angle), z: Math.sin(angle) };
  }
  pose = { x: anchor.x + dir.x * cfg.objectiveDistance, y: anchor.y + cfg.objectiveHeight, z: anchor.z + dir.z * cfg.objectiveDistance };
  aim = { x: anchor.x, y: anchor.y + .4, z: anchor.z };
  framing = 'objective';
  fov = 64;
 } else if (rig === 'firstperson') {
  if (!firstPersonReadable(subject, ctx)) return null;
  const yaw = num(primary.yaw, 0), pitch = clamp(num(primary.pitch, 0), -1.2, 1.2);
  const eye = headOf(primary);
  pose = { x: eye.x - Math.sin(yaw) * .12, y: eye.y - .05, z: eye.z - Math.cos(yaw) * .12 };
  aim = { x: pose.x - Math.sin(yaw) * 10, y: pose.y + Math.sin(pitch) * 10, z: pose.z - Math.cos(yaw) * 10 };
  framing = 'firstperson';
  fov = 74;
 } else if (rig === 'establish') {
  const angle = stableAngle(ctx, anchor, `establish:${subject.kind}:${subject.primary ?? 'x'}`);
  const floor = safeFloor(ctx.safety, anchor.x, anchor.z);
  const baseY = Number.isFinite(floor) ? floor : anchor.y;
  const dist = cfg.establishDistance * (ctx.reduced ? 1.15 : 1);
  pose = { x: anchor.x + Math.cos(angle) * dist, y: baseY + cfg.establishHeight, z: anchor.z + Math.sin(angle) * dist };
  aim = { x: anchor.x, y: anchor.y, z: anchor.z };
  framing = 'establishing';
  fov = 60;
 } else if (rig === 'flyover') {
  const angle = ctx.now * .25 + hashUnit(`fly:${subject.kind}:${subject.primary ?? 'x'}`) * TAU;
  const floor = safeFloor(ctx.safety, anchor.x, anchor.z);
  const baseY = Number.isFinite(floor) ? floor : anchor.y;
  pose = {
   x: anchor.x + Math.cos(angle) * cfg.flyoverRadius,
   y: baseY + cfg.flyoverHeight + 2 * Math.sin(ctx.now * .19),
   z: anchor.z + Math.sin(angle) * cfg.flyoverRadius,
  };
  aim = { x: anchor.x, y: anchor.y, z: anchor.z };
  framing = 'flyover';
  fov = 62;
 }
 if (!pose || !aim) return null;
 return finishCandidate(subject, { rig, pose, aim, framing, fov }, ctx);
}

function screenFit(apparent, cfg) {
 if (apparent <= 0) return 0;
 if (apparent < cfg.screenMin) return clamp(apparent / cfg.screenMin, 0, 1);
 if (apparent > cfg.screenMax) return clamp(1 - (apparent - cfg.screenMax) / 1.5, 0, 1);
 return clamp(1 - Math.abs(apparent - cfg.screenGood) / cfg.screenGood * .35, 0, 1);
}

function frameInclusion(cam, aim, fov, subject, ctx) {
 const half = (fov * Math.PI / 180) / 2;
 const forward = { x: aim.x - cam.x, y: aim.y - cam.y, z: aim.z - cam.z };
 const { primary, opponent } = subjectActors(subject, ctx);
 let inc = 0;
 const inFrame = point => {
  const v = { x: point.x - cam.x, y: point.y - cam.y, z: point.z - cam.z };
  const la = Math.hypot(v.x, v.y, v.z), lf = Math.hypot(forward.x, forward.y, forward.z);
  if (la < 1e-6 || lf < 1e-6) return true;
  const dot = (v.x * forward.x + v.y * forward.y + v.z * forward.z) / (la * lf);
  return Math.acos(clamp(dot, -1, 1)) < half * 1.05;
 };
 if (opponent && inFrame(chestOf(opponent))) inc += .6;
 if (inFrame(subject.anchor)) inc += .4;
 return clamp(inc, 0, 1);
}

function continuityOf(subject, pose, ctx) {
 const prev = ctx.previous;
 if (!prev) return 0;
 let c = 0;
 if (Array.isArray(prev.targets) && prev.targets.length && subject.targets.some(id => prev.targets.includes(id))) c += .6;
 if (prev.pose && Number.isFinite(prev.pose.x) && Number.isFinite(prev.pose.z)) {
  c += .4 * clamp(1 - Math.hypot(prev.pose.x - pose.x, prev.pose.z - pose.z) / 12, 0, 1);
 }
 return clamp(c, 0, 1);
}

function finishCandidate(subject, raw, ctx) {
 const cfg = ctx.cfg, safety = ctx.safety;
 let { x, y, z } = raw.pose;
 if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
 const floor = safeFloor(safety, x, z);
 if (floor === null) return null;
 y = Math.max(y, floor + cfg.minCameraHeight);
 const volume = safeInterior(safety, { x, y, z });
 if (volume && Number.isFinite(volume.base) && Number.isFinite(volume.height)) {
  y = Math.min(y, volume.base + volume.height - .6);
  y = Math.max(y, floor + .5);
 }
 if (!inBounds(safety, x, z, cfg.boundsMargin)) return null;
 let pulled = false;
 if (safeObstructed(safety, x, y, z, cfg.cameraRadius)) {
  const dx = raw.aim.x - x, dz = raw.aim.z - z, len = Math.hypot(dx, dz) || 1;
  let freed = false;
  for (let t = .25; t <= 2.5; t += .25) {
   const nx = x + dx / len * t, nz = z + dz / len * t;
   const nf = safeFloor(safety, nx, nz);
   if (nf === null) break;
   const ny = Math.max(y, nf + cfg.minCameraHeight);
   if (!safeObstructed(safety, nx, ny, nz, cfg.cameraRadius)) { x = nx; y = ny; z = nz; freed = true; break; }
  }
  if (!freed) return null;
  pulled = true;
 }
 const cam = { x, y, z };
 if (dist3d(cam, raw.aim) < cfg.minSubjectDistance) return null;
 if (!inBounds(safety, x, z, cfg.boundsMargin)) return null;
 const { primary, opponent } = subjectActors(subject, ctx);
 const seePrimary = primary ? safeVisible(safety, cam, chestOf(primary)) : safeVisible(safety, cam, raw.aim);
 const seeOpponent = opponent ? safeVisible(safety, cam, chestOf(opponent)) : true;
 // First person *is* the subject's eyes: occlusion of the body is irrelevant,
 // readability was already enforced when the candidate was composed.
 const vis = raw.rig === 'firstperson' ? 1
  : clamp((primary || opponent ? (seePrimary ? 1 : .15) : .7) * .6 + (opponent ? (seeOpponent ? 1 : .15) : .6) * .4, 0, 1);
 const distance = Math.max(.01, dist3d(cam, raw.aim));
 const apparent = 2 * Math.atan(cfg.subjectHeight / (2 * distance)) / (raw.fov * Math.PI / 180);
 return {
  subject, rig: raw.rig, pose: { x, y, z }, aim: { ...raw.aim }, framing: raw.framing, fov: raw.fov,
  distance, clearance: pulled ? .8 : 1, vis, fit: screenFit(apparent, cfg),
  inc: frameInclusion(cam, raw.aim, raw.fov, subject, ctx),
  cont: continuityOf(subject, cam, ctx),
 };
}

// ---------------------------------------------------------------------------
// Scoring, repetition and selection.
// ---------------------------------------------------------------------------
function cameraAngleAround(candidate) {
 const a = candidate.aim, p = candidate.pose;
 const dx = p.x - a.x, dz = p.z - a.z;
 if (Math.hypot(dx, dz) < .5) return null;
 return Math.atan2(dz, dx);
}

function scoreCandidate(candidate, ctx) {
 const cfg = ctx.cfg, s = candidate.subject;
 const rel = clamp(s.relevance, 0, 1);
 const rec = clamp(s.recency ?? 1, 0, 1);
 const gate = SCORING.gateBase + SCORING.gateScale * rel;
 const quality = SCORING.recency * rec
  + SCORING.visibility * candidate.vis
  + SCORING.framing * candidate.fit
  + SCORING.inclusion * candidate.inc
  + SCORING.clearance * (candidate.clearance * .7 + candidate.vis * .3)
  + SCORING.continuity * candidate.cont;
 let score = gate * quality;
 const prev = ctx.previous;
 const watch = prev && prev.watch;
 const holds = prev && Number.isFinite(prev.minUntil) && ctx.now <= prev.minUntil;
 if (s.moment && s.age <= holdFor(s, cfg, ctx.reduced)) score += SCORING.resolve * (s.kind === 'kill' ? .9 : .6);
 if (candidate.incumbent) {
  score += cfg.incumbentBonus;
  if (holds) score += SCORING.resolve * .3; // let an important beat resolve
  const startedAt = prev && Number.isFinite(prev.startedAt) ? prev.startedAt : null;
  const age = startedAt === null ? 0 : ctx.now - startedAt;
  if (age > cfg.maxShot) score -= cfg.stalePenalty * clamp((age - cfg.maxShot) / 2, 0, 1);
 }
 if (watch && !candidate.incumbent) {
  const rigs = Array.isArray(watch.recentRigs) ? watch.recentRigs : [];
  if (rigs[0] === candidate.rig) score -= cfg.penaltyRigImmediate;
  else if (rigs.includes(candidate.rig)) score -= cfg.penaltyRigRepeat;
  const targets = Array.isArray(watch.recentTargets) ? watch.recentTargets : [];
  if (targets.length && s.targets.includes(targets[0])) score -= cfg.penaltyTargetRepeat;
  const angle = cameraAngleAround(candidate);
  const angles = Array.isArray(watch.recentAngles) ? watch.recentAngles : [];
  if (angle !== null && angles.length && Math.abs(angleDelta(angles[0], angle)) < 25 * Math.PI / 180) score -= cfg.penaltyAngleRepeat;
 }
 candidate.score = score;
 candidate.incumbent = candidate.incumbent === true;
 return candidate;
}

function compareCandidates(a, b) {
 const d = b.score - a.score;
 if (Math.abs(d) > 1e-9) return d;
 const k = (KIND_ORDER[a.subject.kind] ?? 9) - (KIND_ORDER[b.subject.kind] ?? 9);
 if (k) return k;
 const r = SHOT_RIGS.indexOf(a.rig) - SHOT_RIGS.indexOf(b.rig);
 if (r) return r;
 return (a.subject.primary ?? -1) - (b.subject.primary ?? -1);
}

function composeIncumbent(ctx) {
 const prev = ctx.previous;
 if (!prev || !prev.rig || !prev.pose) return null;
 if (prev.rig === 'flyover' && Number.isFinite(prev.minUntil) && ctx.now > prev.minUntil) return null; // short context only
 const ids = Array.isArray(prev.targets) ? prev.targets : [];
 // Follow the resolution of this very encounter from the same side. A victim
 // dying must not invalidate the shot and send the camera to a distant fight.
 if (prev.subjectKind === 'firefight') {
  const resolution = ctx.subjects.find(s => s.key.startsWith('death:') && ids.includes(s.victim) && s.primary === prev.primary
   && s.age <= ctx.cfg.momentCutWindow && dist2d(s.anchor, prev.anchor) < 12);
  if (resolution) {
   const candidate = composeCandidate(resolution, prev.rig, ctx);
   if (candidate) { candidate.incumbent = true; candidate.promoted = true; return candidate; }
  }
 }
 let subject = null;
 if (prev.subjectKind === 'establish' || prev.subjectKind === 'flyover') {
  subject = fallbackSubject(ctx);
 } else {
  subject = ctx.subjects.find(s => prev.subjectKey ? s.key === prev.subjectKey
   : s.kind === prev.subjectKind && s.targets.length === ids.length && s.targets.every(id => ids.includes(id)));
 }
 if (!subject) return null;
 const candidate = composeCandidate(subject, prev.rig, ctx);
 if (!candidate) return null;
 candidate.incumbent = true;
 return candidate;
}

function fallbackSubject(ctx) {
 const anchor = objectiveAnchor(ctx) || { x: ctx.center.x, y: 0, z: ctx.center.z };
 return makeSubject({ kind: 'establish', reason: 'no action: establishing shot', anchor, relevance: .10, recency: 1, moment: false, age: 0, hold: 0 });
}

function fallbackCandidates(ctx) {
 const subject = fallbackSubject(ctx);
 const out = [];
 for (const rig of candidateRigs(subject, ctx)) {
  const candidate = composeCandidate(subject, rig, ctx);
  if (candidate) out.push(scoreCandidate(candidate, ctx));
 }
 return out;
}

function flyoverAllowed(ctx) {
 if (ctx.reduced) return false;
 const watch = ctx.previous && ctx.previous.watch;
 const calmSince = watch && Number.isFinite(watch.calmSince) ? watch.calmSince : null;
 if (calmSince === null || ctx.now - calmSince < ctx.cfg.flyoverCalm) return false;
 const last = watch && Number.isFinite(watch.lastFlyoverAt) ? watch.lastFlyoverAt : -Infinity;
 return ctx.now - last >= ctx.cfg.flyoverCooldown;
}

function flyoverCandidate(ctx) {
 const subject = makeSubject({ kind: 'flyover', reason: 'context flyover', anchor: fallbackSubject(ctx).anchor, relevance: .05, recency: 1, moment: false, age: 0, hold: 0 });
 const candidate = composeCandidate(subject, 'flyover', ctx);
 return candidate ? scoreCandidate(candidate, ctx) : null;
}

// ---------------------------------------------------------------------------
// Transitions: cut or a safe, compatible blend.
// ---------------------------------------------------------------------------
function compatibleShots(prev, candidate) {
 if (prev.rig === 'flyover' || candidate.rig === 'flyover') return false;
 if (prev.rig === 'firstperson' || candidate.rig === 'firstperson') return false;
 const ids = Array.isArray(prev.targets) ? prev.targets : [];
 if (ids.length && ids.some(id => candidate.subject.targets.includes(id))) return true;
 if (prev.subjectKind === candidate.subject.kind) return true;
 const tracking = new Set(['kill', 'firefight', 'vehicle', 'objective', 'vip', 'soccer', 'race']);
 if (tracking.has(prev.subjectKind) && tracking.has(candidate.subject.kind)) {
  if (prev.anchor && Number.isFinite(prev.anchor.x) && dist2d(prev.anchor, candidate.subject.anchor) < 8) return true;
 }
 if (prev.subjectKind === 'establish' || candidate.subject.kind === 'establish') return true;
 return false;
}

function pathPointSafe(point, ctx) {
 const cfg = ctx.cfg, safety = ctx.safety;
 const floor = safeFloor(safety, point.x, point.z);
 if (floor === null || !Number.isFinite(floor)) return false;
 if (point.y < floor + cfg.minCameraHeight * .6) return false;
 if (safeObstructed(safety, point.x, point.y, point.z, cfg.cameraRadius)) return false;
 const volume = safeInterior(safety, point);
 if (volume && Number.isFinite(volume.base) && Number.isFinite(volume.height) && point.y > volume.base + volume.height - .35) return false;
 return true;
}

function samplePath(from, to, ctx) {
 const count = ctx.reduced ? ctx.cfg.reducedBlendSamples : ctx.cfg.blendSamples;
 const path = [];
 for (let i = 0; i <= count; i++) {
  const t = i / count;
  const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
  if (!pathPointSafe(point, ctx)) return null;
  path.push(point);
 }
 return path;
}

function transitionBetween(candidate, ctx) {
 const prev = ctx.previous, cfg = ctx.cfg;
 if (!prev || !prev.pose || !Number.isFinite(prev.pose.x)) return { type: 'cut', reason: 'initial' };
 const subject = candidate.subject;
 const freshMoment = subject.moment && subject.age <= cfg.momentCutWindow;
 if (freshMoment) return { type: 'cut', reason: 'moment' };
 if (!compatibleShots(prev, candidate)) return { type: 'cut', reason: 'incompatible' };
 const d = Math.hypot(prev.pose.x - candidate.pose.x, prev.pose.y - candidate.pose.y, prev.pose.z - candidate.pose.z);
 const yaw = Math.abs(angleDelta(num(prev.pose.yaw, 0), yawTo(candidate.pose, candidate.aim)));
 const maxDistance = ctx.reduced ? cfg.reducedBlendDistance : cfg.maxBlendDistance;
 const maxAngle = ctx.reduced ? cfg.reducedBlendAngle : cfg.maxBlendAngle;
 if (d > maxDistance || yaw > maxAngle) return { type: 'cut', reason: 'distance' };
 const path = samplePath(prev.pose, candidate.pose, ctx);
 if (!path) return { type: 'cut', reason: 'blocked' };
 const duration = clamp(d / 7 + yaw / Math.PI, .28, 1) * (ctx.reduced ? 1.6 : 1);
 return { type: 'blend', path, dur: Number(duration.toFixed(3)) };
}

function holdFor(subject, cfg, reduced) {
 if (subject.kind === 'flyover') return cfg.flyoverDuration;
 const base = reduced ? cfg.reducedMinShot : cfg.minShot;
 if (subject.moment) return subject.kind === 'kill' ? Math.max(cfg.killHold, base) : Math.max(cfg.objectiveHold, base);
 if (subject.kind === 'objective' || subject.kind === 'vip') return Math.max(cfg.objectiveHold, base);
 return base;
}

function pushRecent(list, value, max) {
 const out = [value, ...list.filter(v => v !== value)];
 return out.slice(0, max);
}

function updateWatch(prevWatch, decision, ctx, switched) {
 const watch = Object.assign({}, prevWatch || {});
 if (switched) {
  watch.recentRigs = pushRecent(Array.isArray(prevWatch && prevWatch.recentRigs) ? prevWatch.recentRigs : [], decision.rig, 3);
  watch.recentTargets = decision.primary === null || decision.primary === undefined
   ? (Array.isArray(prevWatch && prevWatch.recentTargets) ? prevWatch.recentTargets.slice() : [])
   : pushRecent(Array.isArray(prevWatch && prevWatch.recentTargets) ? prevWatch.recentTargets : [], decision.primary, 4);
  const angle = cameraAngleAround({ pose: decision.pose, aim: decision.aim });
  watch.recentAngles = angle === null
   ? (Array.isArray(prevWatch && prevWatch.recentAngles) ? prevWatch.recentAngles.slice() : [])
   : pushRecent(Array.isArray(prevWatch && prevWatch.recentAngles) ? prevWatch.recentAngles : [], angle, 3);
  watch.startedAt = ctx.now;
  if (decision.rig === 'flyover') watch.lastFlyoverAt = ctx.now;
  if (decision.subjectKind === 'establish' || decision.subjectKind === 'flyover') {
   if (!Number.isFinite(watch.calmSince)) watch.calmSince = ctx.now;
  } else {
   watch.calmSince = null;
  }
 } else if (!Number.isFinite(watch.calmSince) && (decision.subjectKind === 'establish' || decision.subjectKind === 'flyover')) {
  watch.calmSince = ctx.now;
 }
 if (ctx.race) {
  const order = standingsOf(ctx.race);
  if (order.length) watch.raceOrder = order.map(r => r.actorId);
 }
 watch.shoulderTarget = decision.primary ?? null;
 watch.shoulderSign = ctx.shoulder ?? 1;
 return watch;
}

// ---------------------------------------------------------------------------
// Deterministic tie-break + selection.
// ---------------------------------------------------------------------------
function makeDecision(candidate, ctx, options) {
 const subject = candidate.subject;
 const continuing = options.continuing === true;
 const transition = options.transition || (continuing
  ? { type: 'blend', dur: Number((.25 * (ctx.reduced ? 1.6 : 1)).toFixed(3)) }
  : transitionBetween(candidate, ctx));
 const minUntil = continuing && !candidate.promoted && Number.isFinite(ctx.previous && ctx.previous.minUntil)
  ? ctx.previous.minUntil
  : ctx.now + holdFor(subject, ctx.cfg, ctx.reduced);
 const pose = candidate.pose;
 const aim = candidate.aim;
 const decision = {
  rig: candidate.rig,
  targets: [...subject.targets],
  primary: subject.primary ?? null,
  subjectKind: subject.kind,
  subjectKey: subject.key ?? subject.kind,
  anchor: { ...subject.anchor },
  framing: candidate.framing,
  visibility: Number(candidate.vis.toFixed(4)),
  score: Number(fin(candidate.score).toFixed(6)),
  reason: subject.reason,
  transition,
  minUntil,
  pose: { x: pose.x, y: pose.y, z: pose.z, yaw: yawTo(pose, aim), pitch: clamp(pitchTo(pose, aim), -1.45, 1.45), fov: candidate.fov },
  aim: { ...aim },
  incumbent: continuing,
  startedAt: continuing && ctx.previous && Number.isFinite(ctx.previous.startedAt) ? ctx.previous.startedAt : ctx.now,
  watch: null,
 };
 decision.watch = updateWatch(ctx.previous && ctx.previous.watch, decision, ctx, !continuing);
 return decision;
}

function emergencyDecision(ctx) {
 const center = ctx.center;
 const floor = safeFloor(ctx.safety, center.x, center.z);
 const baseY = Number.isFinite(floor) ? floor : 0;
 const pose = { x: center.x + ctx.cfg.establishDistance * .7, y: baseY + ctx.cfg.establishHeight, z: center.z + ctx.cfg.establishDistance * .7 };
 const aim = { x: center.x, y: baseY + 1, z: center.z };
 const subject = makeSubject({ kind: 'establish', reason: 'no safe shot: wide hold', anchor: aim, relevance: .02 });
 const decision = {
  rig: 'establish', targets: [], primary: null, subjectKind: 'establish', anchor: { ...aim }, framing: 'establishing',
  score: 0, reason: subject.reason, transition: { type: 'cut', reason: 'emergency' },
  minUntil: ctx.now + ctx.cfg.minShot,
  pose: { x: pose.x, y: pose.y, z: pose.z, yaw: yawTo(pose, aim), pitch: clamp(pitchTo(pose, aim), -1.45, 1.45), fov: 60 },
  aim: { ...aim }, incumbent: false, startedAt: ctx.now, watch: null,
 };
 decision.watch = updateWatch(ctx.previous && ctx.previous.watch, decision, ctx, true);
 return decision;
}

function select(ctx, candidates, incumbent) {
 const cfg = ctx.cfg;
 candidates.sort(compareCandidates);
 const best = candidates.length ? candidates[0] : null;
 const freshBest = best && best.subject.moment && best.subject.age <= cfg.momentCutWindow;
 if (incumbent) {
  const held = Number.isFinite(ctx.previous.minUntil) && ctx.now < ctx.previous.minUntil;
  const idle = incumbent.subject.kind === 'establish' || incumbent.subject.kind === 'flyover';
  const related = best && best.subject.targets.some(id => incumbent.subject.targets.includes(id))
   && dist2d(best.subject.anchor, incumbent.subject.anchor) < 12;
  // A beat may resolve the encounter we are watching; unrelated highlights
  // cannot steal its hold. In particular a stream of explosions is not a cut
  // clock. Calm establishing shots can give way as soon as real action starts.
  const interrupt = freshBest && !incumbent.subject.moment && (idle || related);
  const actionAppeared = idle && best && !['establish', 'flyover'].includes(best.subject.kind);
  const beat = incumbent.subject.moment || incumbent.subject.kind === 'objective' || incumbent.subject.kind === 'vip';
  const margin = (ctx.reduced ? cfg.reducedHysteresis : cfg.hysteresis)
   + (beat && Number.isFinite(ctx.previous.minUntil) && ctx.now <= ctx.previous.minUntil ? SCORING.holdBreak : 0);
  const force = ctx.forceCut;
  const override = force || interrupt || actionAppeared || (!held && best && best.score > incumbent.score + margin);
  if (!override) return makeDecision(incumbent, ctx, { continuing: true });
  let chosen = best || incumbent;
  if (chosen !== incumbent && chosen.rig === ctx.previous.rig) {
   const alternative = candidates.find(c => c.rig !== ctx.previous.rig && c.score >= chosen.score - cfg.repeatMargin);
   if (alternative) chosen = alternative;
  }
  if (ctx.forceCut) return makeDecision(chosen, ctx, { transition: { type: 'cut', reason: 'requested' } });
  return makeDecision(chosen, ctx, {});
 }
 if (!best) return emergencyDecision(ctx);
 return makeDecision(best, ctx, {});
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------
export function planShot(input = {}) {
 const state = input.state && typeof input.state === 'object' ? input.state : {};
 const cfg = Object.assign({}, PLANNER, input.options || {});
 const now = Number.isFinite(input.time) ? input.time : num(state.time, 0);
 const dt = clamp(num(input.dt, 1 / 60), 1 / 240, .1);
 const ctx = makeCtx(input, state, now, cfg, input.safety);
 ctx.dt = dt;
 if (!ctx.shoulder) {
  // Prefer the shoulder side already established by the previous shot so a
  // continuing composition never flips sides frame to frame. Otherwise consume
  // exactly one value from the injected rng.
  const sign = ctx.previous && ctx.previous.watch && ctx.previous.watch.shoulderSign;
  if (sign === 1 || sign === -1) {
   ctx.shoulder = sign;
  } else {
   const rng = typeof input.random === 'function' ? input.random : () => .5;
   let value = rng();
   if (!Number.isFinite(value)) value = .5;
   ctx.shoulder = value < .5 ? -1 : 1;
  }
 }
 const subjects = buildSubjects(ctx);
 ctx.subjects = subjects;
 const candidates = [];
 const pool = subjects.slice(0, cfg.maxSubjects);
 outer:
 for (const subject of pool) {
  const rigs = candidateRigs(subject, ctx).slice(0, cfg.maxRigsPerSubject);
  for (const rig of rigs) {
   const candidate = composeCandidate(subject, rig, ctx);
   if (candidate) {
    candidates.push(scoreCandidate(candidate, ctx));
    if (candidates.length >= cfg.maxCandidates) break outer;
   }
  }
 }
 // After a long calm stretch the context flyover replaces the wide fallback:
 // one short establishing move, then the planner returns to a stable shot.
 const fly = flyoverAllowed(ctx) ? flyoverCandidate(ctx) : null;
 if (fly) {
  candidates.push(fly);
 } else {
  for (const fallback of fallbackCandidates(ctx)) {
   if (candidates.length >= cfg.maxCandidates) break;
   candidates.push(fallback);
  }
 }
 const incumbent = composeIncumbent(ctx);
 if (incumbent) scoreCandidate(incumbent, ctx);
 return select(ctx, candidates, incumbent);
}
