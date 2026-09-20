// ---------------------------------------------------------------------------
// Ability visual effects for the class/harness layer (Phase 4/5 wave 2).
//
// One self-contained, presentation-only module owns:
//   * a distinct burst for each of the seven harness actives on `power`,
//   * snapshot-driven cues for the nine operator signature verbs (the sim emits
//     no verb events, so verb visuals read `actor.verbState` supplied by
//     `operatorVerbSnapshot`),
//   * the world cable for a placed rope (`rope-place` / `rope-remove` /
//     `rope-expire` / anchor life), which had no geometry before.
//
// Integration surface (the view adds `group` once and forwards events/frames):
//   const vfx=createAbilityVfx({quality:()=>this._quality(),reduced:()=>this.reduced()});
//   this.scene.add(vfx.group);
//   for(const e of match.events)vfx.handleEvent(e);
//   vfx.update(dt,match);
//   vfx.dispose();                       // releases every geometry/material
//
// Contract:
//   * `handleEvent(e)` consumes `power`, `rope-place`, `rope-remove`,
//     `rope-expire`, `weapon-switch` and `death` (the last two only for verb
//     reads/cleanup) and ignores every other simulation event.
//   * `update(dt,snapshot)` is called once per frame with the current match
//     snapshot; `dt` is clamped to 0.25 s like the existing pools.
//   * No simulation state is ever written, no clock is read and no RNG is
//     rolled: offsets come from a small integer hash, so replaying the same
//     events and snapshots always produces the same effect lifetimes.
//   * Reduced motion spawns static, non-expanding cues (no grow, spin, drift,
//     rise, motes or streaks) and time-based opacity fades are disabled, so a
//     reduced cue never animates.
//   * Pools are bounded from the view's quality tiers: the cue/channel/cable
//     budgets are derived from `quality().deaths` exactly like DeathPool /
//     ShellPool / HitReactionFX do, and slots are reused oldest-first.
//   * Geometry is shared per effect kind (one table for both pools); materials
//     are per slot so independent fades never allocate on the hot path.
// ---------------------------------------------------------------------------

import * as T from 'three';
import {OPERATOR_KITS,WINGS} from './kits.mjs';
import {HARNESS_PROFILES} from './harness-profiles.mjs';
import {OPERATOR_VERBS} from './operator-verbs.mjs';

// Event types this module consumes. Every other event the view forwards falls
// through to `ignored` in stats().
export const ABILITY_VFX_EVENTS = Object.freeze([
 'power', 'rope-place', 'rope-remove', 'rope-expire', 'weapon-switch', 'death',
]);

// The placed rope stays a world object for at most the telegraph's 12 s hold.
export const ROPE_DISPLAY_CAP = 12;

// Fallback tints, keyed to the harness. The codebase keys its wing palette to
// the operator (kits.mjs), not to the harness: every harness can be worn by any
// operator, so there is no harness->wing table. The module therefore resolves
// the actor's wing colour from the snapshot's `character` first and only falls
// back to these per-harness tints when no character is known. A host may inject
// the live model colour through `wingColor(actorId,harnessId)` instead.
export const HARNESS_TINTS = Object.freeze({
 openclaw: '#ff8b5c',
 hermes: '#ffd166',
 opencode: '#70ffe6',
 claudecode: '#57b9ff',
 codex: '#8affc1',
 cline: '#6d4aff',
 roo: '#b797ff',
});
const FALLBACK_TINT = '#74f4de';

// Operator signature-verb palettes, read from the operator's data colour so a
// verb cue reads as its owner without importing the HUD or the actor models.
export const VERB_TINTS = Object.freeze({
 heat: '#ff8b4d',
 'deep-compute': '#56c5f2',
 braced: '#57b9ff',
 'alignment-review': '#f29d71',
 adaptive: '#57e6cd',
 'long-context': '#ff82b2',
 'tool-use': '#b797ff',
 effortless: '#ffbd59',
 revision: '#fff0c3',
});

const WING_COLOR_BY_ID = Object.fromEntries(WINGS.map(wing => [wing.id, wing.color]));
const WING_BY_OPERATOR = Object.fromEntries(OPERATOR_KITS.map(kit => [kit.id, kit.wing]));

// Verb tuning is read live from the operator-verbs descriptors (single source,
// so a balance pass can never drift the presentation): the meter normalizers
// below are the sim's own pinned numbers, not copies. The chosen air-streak
// threshold is presentation-only.
const AIR_STREAK_SPEED = 3.5;

const DEFAULT_QUALITY = Object.freeze({tier: 2, particles: 1, deaths: 72});

const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const clamp01 = value => Math.max(0, Math.min(1, finiteOr(value, 0)));
const HEAT_MAX = finiteOr(OPERATOR_VERBS.heat?.numbers?.maxFireRateBonus, .12);
const REVIEW_ABSORB = Math.max(1, finiteOr(OPERATOR_VERBS['alignment-review']?.numbers?.absorb, 35));
const TOOL_WINDOW = finiteOr(OPERATOR_VERBS['tool-use']?.numbers?.handlingSeconds, 3);
const LONG_CONTEXT_TTL = finiteOr(OPERATOR_VERBS['long-context']?.numbers?.trailTtl, 1.5);
const REVIEW_PIPS = 5;
const finitePoint = value => Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const samePoint = (a, b, tolerance = .15) => finitePoint(a) && finitePoint(b)
 && Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.z - b.z) <= tolerance;

// Tiny deterministic hash (same shape as view.mjs shadeHash): no RNG, no clock.
const unitHash = (seed, index) => {
 let h = Math.imul((seed | 0) + 374761393, 668265263) ^ Math.imul((index | 0) + 1274126177, 2246822519);
 h = Math.imul(h ^ (h >>> 13), 1274126177);
 h ^= h >>> 16;
 return (h >>> 0) / 4294967295;
};

// `quality` may be the view's `_quality` method or a plain tier object.
function resolveQuality(quality) {
 const value = typeof quality === 'function' ? quality() : quality;
 return {
  tier: finiteOr(value?.tier, DEFAULT_QUALITY.tier),
  particles: Math.max(0, finiteOr(value?.particles, DEFAULT_QUALITY.particles)),
  deaths: Math.max(0, finiteOr(value?.deaths, DEFAULT_QUALITY.deaths)),
 };
}

// Pool budgets from the tier's `deaths` number, mirroring the view's use of
// `this._quality().deaths` for DeathPool/ShellPool/HitReactionFX. Fixed at
// creation: an auto-quality change never resizes a live pool.
function limitsFor(quality) {
 const deaths = quality.deaths;
 return {
  cues: Math.max(10, Math.min(48, Math.round(deaths * .5))),
  channels: Math.max(6, Math.min(30, Math.round(deaths * .35))),
  ropes: Math.max(2, Math.min(8, Math.round(deaths / 12))),
 };
}

// One shared geometry per kind, owned by the module and released by dispose().
function buildGeometry() {
 return {
  ring: new T.TorusGeometry(1, .055, 6, 26),
  disc: new T.RingGeometry(.52, 1, 26),
  arc: new T.RingGeometry(.72, 1, 18, 1, Math.PI / 2 - 1, 2),
  crescent: new T.TorusGeometry(1, .12, 4, 20, 2.2),
  dome: new T.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  streak: new T.BoxGeometry(1, 1, 1),
  mote: new T.IcosahedronGeometry(.09, 0),
  pip: new T.SphereGeometry(.075, 8, 6),
  beam: new T.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, .5, 0),
 };
}
const FLAT_KINDS = new Set(['ring', 'disc', 'arc', 'crescent']);
const AXIS_X = new T.Vector3(1, 0, 0);
const AXIS_Y = new T.Vector3(0, 1, 0);
const UP_V = new T.Vector3(0, 1, 0);
const _segmentStart = new T.Vector3();
const _segmentEnd = new T.Vector3();
const _segmentDir = new T.Vector3();
const _segmentQuat = new T.Quaternion();
const _cableSide = new T.Vector3();

// Orient the unit beam (built along +Y from its origin) onto the segment a->b.
function orientSegment(mesh, a, b, radius) {
 _segmentStart.set(a.x, a.y, a.z);
 _segmentEnd.set(b.x, b.y, b.z);
 _segmentDir.subVectors(_segmentEnd, _segmentStart);
 const length = _segmentDir.length() || 1e-4;
 mesh.position.copy(_segmentStart);
 _segmentQuat.setFromUnitVectors(AXIS_Y, _segmentDir.normalize());
 mesh.quaternion.copy(_segmentQuat);
 mesh.scale.set(radius, length, radius);
 mesh.visible = true;
}

// Generic pooled cue slot. One pool drives one-shot bursts and a second pool
// drives actor-bound verb channels so long-lived channels can never starve the
// burst budget. Geometry is looked up from the shared table on every spawn; the
// material belongs to the slot so independent fades never allocate.
class CuePool {
 constructor(parent, limit, geometry) {
  this.parent = parent;
  this.limit = Math.max(1, limit | 0);
  this.geometry = geometry;
  this.slots = [];
  this.serial = 0;
  this.recycle = null;
 }
 liveCount() {
  let count = 0;
  for (const slot of this.slots) if (slot.active) count++;
  return count;
 }
 _slot() {
  let slot = this.slots.find(entry => !entry.active);
  if (slot) return slot;
  if (this.slots.length >= this.limit) {
   this.slots.sort((a, b) => a.serial - b.serial);
   slot = this.slots[0];
   this.recycle?.(slot);
   return slot;
  }
  const material = new T.MeshBasicMaterial({color: '#ffffff', transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending});
  const holder = new T.Group();
  const mesh = new T.Mesh(this.geometry.ring, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  holder.add(mesh);
  holder.visible = false;
  this.parent.add(holder);
  slot = {
   holder, mesh, material, active: false, serial: 0, kind: 'ring', key: null, channel: null,
   persistent: false, follow: null, actor: null, offset: {x: 0, y: 0, z: 0}, dir: null, life: 0, total: 1,
   delay: 0, radius: 1, grow: 0, spin: 0, opacity: .6, baseOpacity: .6, length: 1,
   thickness: .04, size: .1, yaw: 0, tilt: 0, drift: null, rise: 0, reduced: false, fade: true,
  };
  this.slots.push(slot);
  return slot;
 }
 spawn(options = {}) {
  const slot = this._slot();
  if (!slot) return null;
  const kind = this.geometry[options.kind] ? options.kind : 'ring';
  const reduced = options.reduced === true;
  slot.active = true;
  slot.serial = ++this.serial;
  slot.kind = kind;
  slot.key = options.key ?? null;
  slot.channel = options.channel ?? null;
  slot.persistent = options.persistent === true;
  slot.reduced = reduced;
  slot.follow = options.follow ?? null;
  slot.actor = options.actor ?? options.follow ?? null;
  slot.offset = options.offset
   ? {x: finiteOr(options.offset.x, 0), y: finiteOr(options.offset.y, 0), z: finiteOr(options.offset.z, 0)}
   : {x: 0, y: 0, z: 0};
  slot.dir = options.dir
   ? {x: finiteOr(options.dir.x, 0), y: finiteOr(options.dir.y, 0), z: finiteOr(options.dir.z, 0)}
   : null;
  slot.delay = reduced ? 0 : Math.max(0, finiteOr(options.delay, 0));
  slot.total = slot.life = Math.max(.01, finiteOr(options.life, .4));
  slot.radius = Math.max(.01, finiteOr(options.radius, 1));
  slot.grow = reduced ? 0 : finiteOr(options.grow, 0);
  slot.spin = reduced ? 0 : finiteOr(options.spin, 0);
  slot.opacity = slot.baseOpacity = Math.max(0, finiteOr(options.opacity, .6));
  slot.length = Math.max(.01, finiteOr(options.length, 1));
  slot.thickness = Math.max(.002, finiteOr(options.thickness, .04));
  slot.size = Math.max(.002, finiteOr(options.size, .1));
  slot.yaw = finiteOr(options.yaw, 0);
  slot.tilt = finiteOr(options.tilt, 0);
  slot.drift = !reduced && options.drift
   ? {x: finiteOr(options.drift.x, 0), y: finiteOr(options.drift.y, 0), z: finiteOr(options.drift.z, 0)}
   : null;
  slot.rise = reduced ? 0 : finiteOr(options.rise, 0);
  slot.fade = options.fade !== false && !reduced;
  slot.mesh.geometry = this.geometry[kind];
  slot.mesh.position.set(0, 0, 0);
  slot.mesh.rotation.set(FLAT_KINDS.has(kind) ? -Math.PI / 2 : 0, 0, 0);
  slot.material.color.set(options.color ?? '#ffffff');
  slot.material.opacity = slot.baseOpacity;
  if (finitePoint(options.pos)) slot.holder.position.set(options.pos.x, options.pos.y, options.pos.z);
  slot.holder.visible = slot.delay <= 0;
  this._orient(slot);
  this._applyScale(slot);
  return slot;
 }
 release(slot) {
  if (!slot || !slot.active) return false;
  slot.active = false;
  slot.key = null;
  slot.holder.visible = false;
  return true;
 }
 clear() {
  for (const slot of this.slots) {
   slot.active = false;
   slot.key = null;
   slot.holder.visible = false;
  }
 }
 update(dt, {resolve = null} = {}) {
  const step = Math.max(0, Math.min(finiteOr(dt, 0), .25));
  for (const slot of this.slots) {
   if (!slot.active) continue;
   if (slot.delay > 0) {
    slot.delay -= step;
    if (slot.delay > 0) { slot.holder.visible = false; continue; }
    slot.holder.visible = true;
   }
   if (slot.follow != null && resolve) {
    const actor = resolve(slot.follow);
    if (actor) slot.holder.position.set(
     finiteOr(actor.x, 0) + slot.offset.x,
     finiteOr(actor.y, 0) + slot.offset.y,
     finiteOr(actor.z, 0) + slot.offset.z,
    );
   }
   if (!slot.persistent) {
    slot.life -= step;
    if (slot.life <= 0) { this.release(slot); continue; }
    if (slot.grow) slot.radius = Math.max(.01, slot.radius + slot.grow * step);
    if (slot.drift) {
     slot.holder.position.x += slot.drift.x * step;
     slot.holder.position.y += slot.drift.y * step;
     slot.holder.position.z += slot.drift.z * step;
    }
    if (slot.rise) slot.mesh.position.y += slot.rise * step;
    if (slot.spin) slot.holder.rotation.y += slot.spin * step;
    // Reduced cues keep a fixed opacity for their whole (short) life so a
    // reduced frame never animates, not even a fade.
    slot.material.opacity = slot.fade ? slot.opacity * Math.max(0, slot.life / slot.total) : slot.baseOpacity;
   }
   this._applyScale(slot);
  }
 }
 _orient(slot) {
  if (slot.dir) {
   _segmentDir.set(slot.dir.x, slot.dir.y, slot.dir.z);
   if (_segmentDir.lengthSq() < 1e-8) _segmentDir.set(0, 0, -1);
   slot.holder.quaternion.setFromUnitVectors(AXIS_X, _segmentDir.normalize());
   return;
  }
  slot.holder.quaternion.identity();
  slot.holder.rotation.set(0, slot.yaw, slot.tilt);
 }
 _applyScale(slot) {
  if (slot.kind === 'streak') slot.mesh.scale.set(slot.length, slot.thickness, slot.thickness);
  else if (slot.kind === 'mote' || slot.kind === 'pip') slot.mesh.scale.setScalar(slot.size);
  else slot.mesh.scale.setScalar(slot.radius);
 }
 dispose() {
  for (const slot of this.slots) {
   this.parent.remove(slot.holder);
   slot.material.dispose();
  }
  this.slots = [];
  this.recycle = null;
 }
}

// Taut double-strand cable between a rope's anchors: two sagged segments per
// strand (a shallow V), shared unit-beam geometry, one material per cable. Life
// mirrors the telegraph's hold cap and expires on `rope-expire`, `rope-remove`,
// death or anchor life. Presentation only.
class CablePool {
 constructor(parent, limit, geometry) {
  this.parent = parent;
  this.limit = Math.max(1, limit | 0);
  this.beam = geometry.beam;
  this.slots = [];
  this.serial = 0;
 }
 liveCount() {
  let count = 0;
  for (const slot of this.slots) if (slot.active) count++;
  return count;
 }
 _slot() {
  let slot = this.slots.find(entry => !entry.active);
  if (slot) return slot;
  if (this.slots.length >= this.limit) {
   this.slots.sort((a, b) => a.serial - b.serial);
   return this.slots[0];
  }
  const material = new T.MeshBasicMaterial({color: '#ffffff', transparent: true, depthWrite: false, blending: T.AdditiveBlending});
  const holder = new T.Group();
  const meshes = [];
  for (let i = 0; i < 4; i++) {
   const mesh = new T.Mesh(this.beam, material);
   mesh.frustumCulled = false;
   mesh.renderOrder = 2;
   mesh.visible = false;
   holder.add(mesh);
   meshes.push(mesh);
  }
  holder.visible = false;
  this.parent.add(holder);
  slot = {holder, meshes, material, active: false, serial: 0, life: 0, total: 1, from: null, to: null, actor: null};
  this.slots.push(slot);
  return slot;
 }
 spawn({from, to, color = '#ffe3a8', life = 20, reduced = false, actor = null} = {}) {
  if (!finitePoint(from) || !finitePoint(to)) return null;
  const slot = this._slot();
  if (!slot) return null;
  slot.active = true;
  slot.serial = ++this.serial;
  slot.total = slot.life = Math.min(ROPE_DISPLAY_CAP, Math.max(.5, finiteOr(life, 20)));
  slot.from = {x: from.x, y: from.y, z: from.z};
  slot.to = {x: to.x, y: to.y, z: to.z};
  slot.actor = actor ?? null;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const span = Math.hypot(dx, dy, dz) || .001;
  const sag = Math.min(.35, Math.max(.04, span * .035));
  const mid = {x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - sag, z: (from.z + to.z) / 2};
  _segmentDir.set(dx, dy, dz).normalize();
  const side = _cableSide.copy(_segmentDir).cross(UP_V);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const offset = .035;
  for (let strand = 0; strand < 2; strand++) {
   const sign = strand === 0 ? 1 : -1;
   const ox = side.x * offset * sign, oy = side.y * offset * sign, oz = side.z * offset * sign;
   const a = {x: from.x + ox, y: from.y + oy, z: from.z + oz};
   const b = {x: mid.x + ox, y: mid.y + oy, z: mid.z + oz};
   const c = {x: to.x + ox, y: to.y + oy, z: to.z + oz};
   orientSegment(slot.meshes[strand * 2], a, b, .022);
   orientSegment(slot.meshes[strand * 2 + 1], b, c, .022);
  }
  slot.material.color.set(color);
  slot.material.opacity = reduced ? .34 : .55;
  slot.holder.visible = true;
  return slot;
 }
 release(slot) {
  if (!slot || !slot.active) return false;
  slot.active = false;
  slot.holder.visible = false;
  return true;
 }
 releaseAt(pos, tolerance = .15) {
  if (!finitePoint(pos)) return 0;
  let released = 0;
  for (const slot of this.slots) if (slot.active && samePoint(slot.to, pos, tolerance)) { this.release(slot); released++; }
  return released;
 }
 releaseByActor(actor) {
  if (actor == null) return 0;
  let released = 0;
  for (const slot of this.slots) if (slot.active && slot.actor === actor) { this.release(slot); released++; }
  return released;
 }
 update(dt) {
  const step = Math.max(0, Math.min(finiteOr(dt, 0), .25));
  for (const slot of this.slots) {
   if (!slot.active) continue;
   slot.life -= step;
   if (slot.life <= 0) this.release(slot);
  }
 }
 clear() {
  for (const slot of this.slots) this.release(slot);
 }
 dispose() {
  for (const slot of this.slots) {
   this.parent.remove(slot.holder);
   slot.material.dispose();
  }
  this.slots = [];
 }
}

class AbilityVfx {
 constructor({quality = null, reduced = false, wingColor = null, groundY = null} = {}) {
  this.group = new T.Group();
  this.group.name = 'ability-vfx';
  this._quality = quality;
  this._reduced = reduced;
  this._wingColor = typeof wingColor === 'function' ? wingColor : null;
  this._groundY = typeof groundY === 'function' ? groundY : null;
  this._disposed = false;
  this._snapshot = null;
  this._limits = limitsFor(resolveQuality(quality));
  this._geometry = buildGeometry();
  this._cues = new CuePool(this.group, this._limits.cues, this._geometry);
  this._channels = new CuePool(this.group, this._limits.channels, this._geometry);
  this._ropes = new CablePool(this.group, this._limits.ropes, this._geometry);
  this._channelMap = new Map();
  this._channels.recycle = slot => {
   if (slot.key && this._channelMap.get(slot.key) === slot) this._channelMap.delete(slot.key);
  };
  this._prev = new Map();
  this._timers = new Map();
  this._pendingRopes = [];
  this._spawned = 0;
  this._handled = 0;
  this._ignored = 0;
  this._ropesPlaced = 0;
 }
 // --- scene hook ----------------------------------------------------------
 attach(scene) {
  if (!scene) return this.group;
  if (this.group.parent !== scene) scene.add(this.group);
  return this.group;
 }
 detach() {
  this.group.parent?.remove(this.group);
  return this.group;
 }
 // --- introspection -------------------------------------------------------
 reducedNow() {
  return typeof this._reduced === 'function' ? this._reduced() === true : this._reduced === true;
 }
 stats() {
  const cues = this._cues.liveCount();
  const channels = this._channels.liveCount();
  const ropes = this._ropes.liveCount();
  const limits = {...this._limits, total: this._limits.cues + this._limits.channels + this._limits.ropes};
  return {
   disposed: this._disposed,
   cues,
   channels,
   ropes,
   live: cues + channels + ropes,
   limits,
   nodes: this.group.children.length,
   geometries: this._geometry ? Object.keys(this._geometry).length : 0,
   spawned: this._spawned,
   ropesPlaced: this._ropesPlaced,
   events: {handled: this._handled, ignored: this._ignored},
  };
 }
 // Plain, sorted slot table for determinism/lifetime assertions. Numbers are
 // rounded so two identical runs compare exactly.
 debug() {
  const rows = [];
  const push = (pool, slot) => rows.push({
   pool,
   serial: slot.serial,
   kind: slot.kind,
   key: slot.key,
   channel: slot.channel,
   follow: slot.follow,
   life: +slot.life.toFixed(6),
   total: +slot.total.toFixed(6),
   radius: +slot.radius.toFixed(6),
   size: +slot.size.toFixed(6),
   grow: +slot.grow.toFixed(6),
   spin: +slot.spin.toFixed(6),
   opacity: +slot.material.opacity.toFixed(6),
   pos: [+slot.holder.position.x.toFixed(6), +slot.holder.position.y.toFixed(6), +slot.holder.position.z.toFixed(6)],
   scale: [+slot.mesh.scale.x.toFixed(6), +slot.mesh.scale.y.toFixed(6), +slot.mesh.scale.z.toFixed(6)],
  });
  for (const slot of this._cues.slots) if (slot.active) push('cues', slot);
  for (const slot of this._channels.slots) if (slot.active) push('channels', slot);
  for (const slot of this._ropes.slots) if (slot.active) rows.push({
   pool: 'ropes',
   serial: slot.serial,
   kind: 'cable',
   key: null,
   channel: null,
   follow: null,
   life: +slot.life.toFixed(6),
   total: +slot.total.toFixed(6),
   radius: 0,
   size: 0,
   grow: 0,
   spin: 0,
   opacity: +slot.material.opacity.toFixed(6),
   pos: [0, 0, 0],
   scale: [0, 0, 0],
   actor: slot.actor,
   to: [+slot.to.x.toFixed(6), +slot.to.y.toFixed(6), +slot.to.z.toFixed(6)],
  });
  return rows.sort((a, b) => a.serial - b.serial);
 }
 // --- event surface -------------------------------------------------------
 handleEvent(e) {
  if (this._disposed) return false;
  if (!e || typeof e.type !== 'string') { this._ignored++; return false; }
  const type = e.type;
  if (type === 'power') { this._handled++; this._power(e); return true; }
  if (type === 'rope-place') { this._handled++; this._ropePlace(e); return true; }
  if (type === 'rope-expire') {
   this._handled++;
   const pos = e.pos ?? e.to;
   this._ropes.releaseAt(pos);
   this._pendingRopes = this._pendingRopes.filter(pending => !samePoint(pending.to, pos));
   return true;
  }
  if (type === 'rope-remove') {
   this._handled++;
   if (finitePoint(e.pos)) this._ropes.releaseAt(e.pos);
   else if (e.actor != null) this._ropes.releaseByActor(e.actor);
   else this._ropes.clear();
   return true;
  }
  if (type === 'weapon-switch') { this._handled++; this._weaponSwitch(e); return true; }
  if (type === 'death') {
   this._handled++;
   this._releaseActor(e.actor);
   this._prev.delete(e.actor);
   this._timers.delete(e.actor);
   // The sim clears a dead owner's ropes without emitting rope-remove; mirror it.
   this._ropes.releaseByActor(e.actor);
   return true;
  }
  this._ignored++;
  return false;
 }
 // `power` carries {actor,harness,pos,duration}: one distinct burst per harness,
 // wing-coloured when the actor's character (or the injected resolver) knows it.
 _power(e) {
  const harness = typeof e.harness === 'string' ? e.harness : this._actor(e.actor)?.harness ?? null;
  const at = finitePoint(e.pos) ? {x: e.pos.x, y: e.pos.y, z: e.pos.z} : this._chest(e.actor);
  if (!at) return;
  const color = this._colorFor(e.actor, harness);
  const duration = Math.max(0, finiteOr(e.duration, 0));
  const reduced = this.reducedNow();
  const seed = (finiteOr(e.id, this._spawned) | 0) + 1;
  switch (harness) {
   case 'openclaw': return this._openclaw(at, color, duration, reduced, seed);
   case 'hermes': return this._hermes(at, color, duration, reduced, seed, e.actor);
   case 'opencode': return this._opencode(at, color, duration, reduced, seed, e.actor);
   case 'claudecode': return this._claudecode(at, color, duration, reduced, seed);
   case 'codex': return this._codex(at, color, duration, reduced, seed);
   case 'cline': return this._cline(at, color, duration, reduced, seed, e.actor);
   case 'roo': return this._roo(at, color, duration, reduced, seed);
   default: return this._genericBurst(at, color, reduced);
  }
 }
 // OpenClaw · Claw Burst: three expanding crescents plus a radial shock ring.
 _openclaw(at, color, duration, reduced, seed) {
  const base = {x: at.x, y: at.y - 1, z: at.z};
  if (reduced) {
   this._cue({kind: 'ring', pos: {x: base.x, y: base.y + .06, z: base.z}, radius: 1.6, life: .4, opacity: .3, color});
   return;
  }
  for (let i = 0; i < 3; i++) {
   this._cue({
    kind: 'crescent', pos: base, radius: .55, grow: 2.4, life: .45, opacity: .85,
    yaw: i * Math.PI * 2 / 3 + unitHash(seed, i) * .6,
    tilt: (unitHash(seed, i + 7) - .5) * .5,
    color,
   });
  }
  this._cue({kind: 'ring', pos: {x: base.x, y: base.y + .04, z: base.z}, radius: .7, grow: 8, life: .5, opacity: .7, color});
  this._cue({kind: 'disc', pos: {x: base.x, y: base.y + .08, z: base.z}, radius: 1.1, grow: 3.2, life: .5, opacity: .35, color});
 }
 // Hermes · Courier Rush: speed streaks trailing the sprint direction.
 _hermes(at, color, duration, reduced, seed, actorId) {
  if (reduced) {
   this._cue({kind: 'disc', pos: {x: at.x, y: at.y - .9, z: at.z}, radius: 1.15, life: .32, opacity: .25, color});
   return;
  }
  const dir = this._facing(actorId);
  const side = {x: -dir.z, z: dir.x};
  const count = Math.max(3, Math.round(7 * this._particlesNow()));
  for (let i = 0; i < count; i++) {
   const a = unitHash(seed, i * 3 + 1), b = unitHash(seed, i * 3 + 2), c = unitHash(seed, i * 3 + 3);
   const lateral = (a - .5) * 1.3, back = .1 + b * 1.4, lift = (c - .5) * .9;
   this._cue({
    kind: 'streak',
    pos: {x: at.x - dir.x * back + side.x * lateral, y: at.y + lift - .3, z: at.z - dir.z * back + side.z * lateral},
    dir,
    length: .8 + a * 1.1,
    thickness: .03 + b * .02,
    life: .24 + c * .12,
    opacity: .65,
    drift: {x: -dir.x * 4.5, y: 0, z: -dir.z * 4.5},
    color,
   });
  }
  this._cue({kind: 'ring', pos: {x: at.x, y: at.y - 1, z: at.z}, radius: .7, grow: 1.4, life: .3, opacity: .4, color});
 }
 // OpenCode · Parallel Burst: staggered echo rings plus flanking afterimages.
 _opencode(at, color, duration, reduced, seed, actorId) {
  if (reduced) {
   this._cue({kind: 'ring', pos: {x: at.x, y: at.y - .9, z: at.z}, radius: 1.2, life: .36, opacity: .28, color});
   return;
  }
  for (let i = 0; i < 3; i++) {
   this._cue({
    kind: 'ring', pos: {x: at.x, y: at.y - .6 - i * .25, z: at.z}, radius: .6 + i * .35,
    grow: 3.4, life: .4, opacity: .6 - i * .12, delay: i * .08, color,
   });
  }
  const dir = this._facing(actorId);
  const side = {x: -dir.z, z: dir.x};
  for (let i = 0; i < 2; i++) {
   const sign = i === 0 ? 1 : -1;
   this._cue({
    kind: 'streak',
    pos: {x: at.x + side.x * .45 * sign, y: at.y - .2, z: at.z + side.z * .45 * sign},
    dir, length: 1.1, thickness: .03, life: .22, opacity: .35, color,
   });
  }
  this._cue({kind: 'arc', pos: {x: at.x, y: at.y - .95, z: at.z}, radius: 1.3, grow: 1.6, life: .4, opacity: .4, yaw: this._aim(actorId), color});
 }
 // Claude Code · Guardrail: a dome shell with a bright rim for the duration.
 _claudecode(at, color, duration, reduced, seed) {
  const hold = Math.min(3, Math.max(.6, duration || 3));
  const base = {x: at.x, y: at.y - 1, z: at.z};
  this._cue({kind: 'dome', pos: base, radius: 1.45, life: hold, opacity: reduced ? .16 : .2, color});
  this._cue({
   kind: 'ring', pos: {x: base.x, y: base.y + .05, z: base.z}, radius: 1.35,
   grow: reduced ? 0 : .18, life: hold, opacity: reduced ? .4 : .55, color,
  });
  if (!reduced) this._cue({kind: 'pip', pos: {x: at.x, y: at.y + .45, z: at.z}, size: .09, life: .4, opacity: .5, color});
 }
 // Codex · Recompile: a green flash with rising repair motes.
 _codex(at, color, duration, reduced, seed) {
  const base = {x: at.x, y: at.y - 1, z: at.z};
  this._cue({kind: 'disc', pos: {x: base.x, y: base.y + .05, z: base.z}, radius: .8, grow: reduced ? 0 : 2.4, life: .4, opacity: reduced ? .25 : .6, color: '#8affc1'});
  if (reduced) return;
  this._motes({x: base.x, y: base.y + .1, z: base.z}, color, 9, {seed, life: .6, size: .1, radius: .7, rise: 1.7});
 }
 // Cline · Phase Step: a dark violet dash streak through the travel axis.
 _cline(at, color, duration, reduced, seed, actorId) {
  const violet = HARNESS_TINTS.cline;
  if (reduced) {
   this._cue({kind: 'disc', pos: {x: at.x, y: at.y - .9, z: at.z}, radius: 1.1, life: .3, opacity: .28, color: violet});
   return;
  }
  const dir = this._facing(actorId);
  this._cue({kind: 'ring', pos: {x: at.x, y: at.y - .9, z: at.z}, radius: .6, grow: 2.8, life: .3, opacity: .5, color: violet});
  for (let i = 0; i < 3; i++) {
   const back = .35 + i * .9, lift = (unitHash(seed, i) - .5) * .5;
   this._cue({
    kind: 'streak', pos: {x: at.x - dir.x * back, y: at.y - .9 + lift, z: at.z - dir.z * back},
    dir, length: 1.5, thickness: .05, life: .22 + i * .04, opacity: .6 - i * .12, delay: i * .03, color: violet,
   });
  }
 }
 // Roo · Context Jam: expanding rings plus a lingering field edge at the radius.
 _roo(at, color, duration, reduced, seed) {
  const base = {x: at.x, y: at.y - 1, z: at.z};
  const radius = finiteOr(HARNESS_PROFILES.roo?.ability?.radius, 7);
  const hold = Math.max(.5, duration || 3);
  if (reduced) {
   this._cue({kind: 'ring', pos: {x: base.x, y: base.y + .06, z: base.z}, radius, life: hold, opacity: .26, color});
   return;
  }
  for (let i = 0; i < 2; i++) {
   this._cue({kind: 'ring', pos: {x: base.x, y: base.y + .06 + i * .02, z: base.z}, radius: .9 + i * .3, grow: 4.6, life: .5, opacity: .55, delay: i * .12, color});
  }
  this._cue({kind: 'disc', pos: {x: base.x, y: base.y + .05, z: base.z}, radius, life: hold, opacity: .16, spin: .4, color});
  this._motes(base, color, 6, {seed, life: .5, size: .08, radius: radius * .5, rise: .9});
 }
 // Unknown/future harnesses still read as an activation.
 _genericBurst(at, color, reduced) {
  this._cue({kind: 'ring', pos: at, radius: 1, grow: reduced ? 0 : 2.8, life: .34, opacity: reduced ? .3 : .6, color});
  if (!reduced) this._cue({kind: 'disc', pos: at, radius: 1.4, grow: 2, life: .4, opacity: .35, color});
 }
 // Adaptive (ChatGPT) and Revision (Gemini) have no snapshot meters: the swap
 // flash is keyed on the weapon-switch event plus the actor's verb identity.
 _weaponSwitch(e) {
  const state = this._actor(e.actor)?.verbState;
  if (!state || state.active !== true || state.verb !== 'revision') return;
  const at = this._chest(e.actor) ?? this._feet(e.actor);
  if (!at) return;
  const reduced = this.reducedNow();
  this._cue({
   kind: 'disc', follow: e.actor, offset: {x: 0, y: 1, z: 0}, radius: .9,
   grow: reduced ? 0 : 2.6, life: .28, opacity: .7, channel: 'revision-swap', color: this._colorFor(e.actor, null),
  });
  this._cue({kind: 'ring', follow: e.actor, offset: {x: 0, y: 1.1, z: 0}, radius: .5, grow: reduced ? 0 : 1.4, life: .24, opacity: .5, channel: 'revision-swap', color: VERB_TINTS.revision});
 }
 // --- rope cables ---------------------------------------------------------
 _ropePlace(e) {
  const to = finitePoint(e.to) ? e.to : finitePoint(e.pos) ? e.pos : null;
  if (!to) return;
  const life = Math.min(ROPE_DISPLAY_CAP, Math.max(.5, finiteOr(e.life, 20)));
  const reduced = this.reducedNow();
  const color = this._colorFor(e.actor, null);
  // The sim keeps one rope per owner, so mirror it: a new placement replaces
  // the owner's previous cable and never fills the pool.
  if (e.actor != null) {
   this._ropes.releaseByActor(e.actor);
   this._pendingRopes = this._pendingRopes.filter(pending => pending.actor !== e.actor);
  }
  if (finitePoint(e.from)) {
   this._pendingRopes.push({from: {x: e.from.x, y: e.from.y, z: e.from.z}, to: {x: to.x, y: to.y, z: to.z}, life, actor: e.actor ?? null, color, reduced, age: 0});
   this._resolvePendings(0);
   return;
  }
  // The movement event only carries the anchor (`pos`); the placer's feet come
  // from the frame snapshot on the next update.
  this._pendingRopes.push({from: null, to: {x: to.x, y: to.y, z: to.z}, life, actor: e.actor ?? null, color, reduced, age: 0});
  if (this._pendingRopes.length > 8) this._pendingRopes.splice(0, this._pendingRopes.length - 8);
 }
 _resolvePendings(step) {
  if (!this._pendingRopes.length) return;
  const keep = [];
  for (const pending of this._pendingRopes) {
   if (!pending.from) {
    const actor = this._actor(pending.actor);
    if (actor) pending.from = {x: finiteOr(actor.x, 0), y: finiteOr(actor.y, 0), z: finiteOr(actor.z, 0)};
   }
   if (pending.from) {
    if (this._ropes.spawn({from: pending.from, to: pending.to, color: pending.color, life: pending.life, reduced: pending.reduced, actor: pending.actor})) this._ropesPlaced++;
    continue;
   }
   pending.age += step;
   if (pending.age < 1) keep.push(pending);
  }
  this._pendingRopes = keep;
 }
 // --- frame surface -------------------------------------------------------
 update(dt, snapshot) {
  if (this._disposed) return;
  this._snapshot = snapshot ?? null;
  const step = Math.max(0, Math.min(finiteOr(dt, 0), .25));
  const reduced = this.reducedNow();
  const actors = Array.isArray(this._snapshot?.actors) ? this._snapshot.actors : [];
  this._resolvePendings(step);
  this._updateVerbChannels(step, actors, reduced);
  this._cues.update(step, {resolve: id => this._actor(id)});
  this._channels.update(step, {resolve: id => this._actor(id)});
  this._ropes.update(step);
 }
 // Snapshot-derived verb channels. The sim emits no verb events, so everything
 // here reads `actor.verbState` (the output of operatorVerbSnapshot).
 _updateVerbChannels(dt, actors, reduced) {
  const seen = new Set();
  for (const actor of actors) {
   if (!actor) continue;
   seen.add(actor.id);
   const state = actor.verbState;
   if (!state || state.active !== true || typeof state.verb !== 'string') {
    this._releaseActor(actor.id);
    this._prev.delete(actor.id);
    this._timers.delete(actor.id);
    continue;
   }
   this._verb(actor, state, dt, reduced);
  }
  for (const [key, slot] of [...this._channelMap]) if (slot.actor != null && !seen.has(slot.actor)) this._releaseKey(key);
  for (const id of [...this._prev.keys()]) if (!seen.has(id)) this._prev.delete(id);
  for (const id of [...this._timers.keys()]) if (!seen.has(id)) this._timers.delete(id);
 }
 _verb(actor, state, dt, reduced) {
  const id = actor.id;
  switch (state.verb) {
   case 'heat': {
    // Grok · Heat: the weapon glow ramps with the 0..12% stack meter.
    const glow = clamp01(finiteOr(state.heat, 0) / HEAT_MAX);
    if (glow <= 0) { this._releaseKey(`${id}:heat`); break; }
    const slot = this._ensure(`${id}:heat`, {kind: 'mote', channel: 'heat', follow: id, offset: {x: 0, y: 1.12, z: .18}, color: VERB_TINTS.heat}, reduced);
    if (slot) {
     slot.size = .08 + .32 * glow;
     slot.material.opacity = reduced ? .5 : .12 + .65 * glow;
     slot.spin = reduced ? 0 : 1.7;
    }
    break;
   }
   case 'deep-compute': {
    // DeepSeek · Deep Compute: a charge ring/visor ramps 0..1 and flares once
    // when the meter reaches full.
    const charge = clamp01(finiteOr(state.charge, 0));
    const previous = this._prev.get(id) ?? {};
    if (charge <= 1e-4) {
     this._releaseKey(`${id}:compute`);
     this._releaseKey(`${id}:compute-visor`);
    } else {
     const ring = this._ensure(`${id}:compute`, {kind: 'ring', channel: 'compute', follow: id, offset: {x: 0, y: .35, z: 0}, color: VERB_TINTS['deep-compute']}, reduced);
     if (ring) {
      ring.radius = .5 + .85 * charge;
      ring.material.opacity = reduced ? .4 : .16 + .6 * charge;
     }
     const visor = this._ensure(`${id}:compute-visor`, {kind: 'pip', channel: 'compute-visor', follow: id, offset: {x: 0, y: 1.42, z: .22}, color: '#c3d9f9'}, reduced);
     if (visor) {
      visor.size = .05 + .07 * charge;
      visor.material.opacity = reduced ? .6 : .3 + .6 * charge;
     }
    }
    if (charge >= 1 && finiteOr(previous.charge, 0) < 1) {
     this._cue({kind: 'disc', channel: 'compute-flare', follow: id, offset: {x: 0, y: .9, z: 0}, radius: 1.1, grow: reduced ? 0 : 3, life: .34, opacity: .75, color: '#c3d9f9'});
    }
    previous.charge = charge;
    this._prev.set(id, previous);
    break;
   }
   case 'alignment-review': {
    // Claude · Alignment Review: a meter ring, one shield pip per equal slice
    // of the live absorb pool (REVIEW_ABSORB is read from the verb descriptor),
    // and a flash whenever the pool is spent.
    const meter = clamp01(finiteOr(state.meter, 0));
    const pool = Math.max(0, finiteOr(state.pool, 0));
    const previous = this._prev.get(id) ?? {};
    if (meter <= 1e-4 && pool <= 0) {
     this._releaseKey(`${id}:review`);
    } else {
     const ring = this._ensure(`${id}:review`, {kind: 'ring', channel: 'review', follow: id, offset: {x: 0, y: .25, z: 0}, color: VERB_TINTS['alignment-review']}, reduced);
     if (ring) {
      ring.radius = .55 + .3 * meter;
      ring.material.opacity = reduced ? .4 : .15 + .55 * meter;
      ring.spin = reduced ? 0 : .5;
     }
    }
    const pipCount = Math.min(REVIEW_PIPS, Math.max(0, Math.ceil(pool / (REVIEW_ABSORB / REVIEW_PIPS))));
    for (let i = 0; i < pipCount; i++) {
     const angle = -Math.PI / 2 + (i / pipCount) * Math.PI * 2;
     const pip = this._ensure(`${id}:review-pip-${i}`, {
      kind: 'pip', channel: 'review-pip', follow: id,
      offset: {x: Math.cos(angle) * .78, y: .3 + i * .16, z: Math.sin(angle) * .78},
      color: '#ffe9c9',
     }, reduced);
     if (pip) {
      pip.size = .05 + .03 * Math.min(1, pool / REVIEW_ABSORB);
      pip.material.opacity = reduced ? .7 : .75;
     }
    }
    for (let i = pipCount; i < REVIEW_PIPS; i++) this._releaseKey(`${id}:review-pip-${i}`);
    if (pool < finiteOr(previous.pool, 0) - 1e-6) {
     this._cue({kind: 'disc', channel: 'review-flash', follow: id, offset: {x: 0, y: .95, z: 0}, radius: .8, grow: reduced ? 0 : 2.4, life: .3, opacity: .75, color: '#ffe9c9'});
    }
    previous.pool = pool;
    previous.meter = meter;
    this._prev.set(id, previous);
    break;
   }
   case 'braced': {
    // Meta · Braced: regen motes while crouched out of combat and below the
    // class spawn armor cap.
    const timer = this._timers.get(id) ?? {};
    const regen = actor.grounded === true
     && finiteOr(state.combatIn, 0) <= 0
     && Number.isFinite(actor.spawnArmor) && Number.isFinite(actor.armor)
     && actor.spawnArmor > 0 && actor.armor < actor.spawnArmor;
    if (!regen || reduced) {
     timer.braced = 0;
    } else {
     const interval = actor.crouching === true ? .22 : .42;
     timer.braced = finiteOr(timer.braced, 0) + dt;
     if (timer.braced >= interval) {
      timer.braced -= interval;
      const feet = this._feet(id);
      if (feet) this._motes(feet, VERB_TINTS.braced, actor.crouching === true ? 2 : 1, {seed: id + 17, life: .5, size: .07, radius: .4, rise: 1.1});
     }
    }
    this._timers.set(id, timer);
    break;
   }
   case 'tool-use': {
    // Qwen · Tool Use: an interaction-window ring for the whole handling window.
    const windowIn = Math.max(0, finiteOr(state.windowIn, 0));
    if (windowIn <= 0) { this._releaseKey(`${id}:tool`); break; }
    const slot = this._ensure(`${id}:tool`, {kind: 'ring', channel: 'tool', follow: id, offset: {x: 0, y: .12, z: 0}, color: VERB_TINTS['tool-use']}, reduced);
    if (slot) {
     slot.radius = 1.05;
     slot.material.opacity = reduced ? .3 : .2 + .3 * Math.min(1, windowIn / TOOL_WINDOW);
     slot.spin = reduced ? 0 : .7;
    }
    break;
   }
   case 'long-context': {
    // Kimi · Long Context: the snapshot exposes the recorded trails
    // [{enemyId,x,z,ttl}], so each one becomes a ground breadcrumb whose
    // brightness follows its TTL. The trail has no y; `groundY(x,z)` can be
    // injected, otherwise the marker sits just above the world origin plane.
    const trails = Array.isArray(state.trails) ? state.trails : [];
    const live = new Set();
    for (const trail of trails) {
     if (!trail || !Number.isFinite(trail.x) || !Number.isFinite(trail.z)) continue;
     const key = `${id}:trail:${trail.enemyId}`;
     live.add(key);
     const ttl = Math.max(0, finiteOr(trail.ttl, 0));
     if (ttl <= 0) continue;
     const y = finiteOr(this._groundY?.(trail.x, trail.z), 0);
     const slot = this._ensure(key, {kind: 'disc', channel: 'trail', actor: id, follow: null, pos: {x: trail.x, y: y + .05, z: trail.z}, radius: .42, color: VERB_TINTS['long-context']}, reduced);
     if (slot) {
      slot.holder.position.set(trail.x, y + .05, trail.z);
      slot.baseOpacity = Math.min(.55, .18 + .4 * (ttl / LONG_CONTEXT_TTL));
      slot.material.opacity = reduced ? .38 : slot.baseOpacity;
     }
    }
    for (const key of [...this._channelMap.keys()]) if (key.startsWith(`${id}:trail:`) && !live.has(key)) this._releaseKey(key);
    break;
   }
   case 'adaptive': {
    // ChatGPT · Adaptive: one flash the moment the first-mag window opens.
    const open = state.open === true;
    const previous = this._prev.get(id) ?? {};
    if (open && previous.open !== true) {
     this._cue({kind: 'disc', channel: 'adaptive-swap', follow: id, offset: {x: 0, y: 1, z: 0}, radius: 1.05, grow: reduced ? 0 : 2.6, life: .3, opacity: .7, color: VERB_TINTS.adaptive});
    }
    previous.open = open;
    this._prev.set(id, previous);
    break;
   }
   case 'effortless': {
    // Mistral · Effortless has no numeric snapshot state; the streaks are keyed
    // on the verb identity plus the airborne speed it shapes.
    const timer = this._timers.get(id) ?? {};
    const speed = Math.hypot(finiteOr(actor.vx, 0), finiteOr(actor.vz, 0));
    if (reduced || actor.grounded === true || speed <= AIR_STREAK_SPEED) {
     timer.effortless = 0;
    } else {
     timer.effortless = finiteOr(timer.effortless, 0) + dt;
     const interval = .12;
     if (timer.effortless >= interval) {
      timer.effortless -= interval;
      this._cue({
       kind: 'streak',
       pos: {x: finiteOr(actor.x, 0), y: finiteOr(actor.y, 0) + .5, z: finiteOr(actor.z, 0)},
       dir: {x: -finiteOr(actor.vx, 0) / speed, y: 0, z: -finiteOr(actor.vz, 0) / speed},
       length: .9, thickness: .028, life: .22, opacity: .42, color: this._colorFor(id, null),
      });
     }
    }
    this._timers.set(id, timer);
    break;
   }
   // Revision has no snapshot state at all: its swap flash rides the event hook.
   default: break;
  }
 }
 // --- small helpers -------------------------------------------------------
 _actor(id) {
  const actors = this._snapshot?.actors;
  if (id == null || !Array.isArray(actors)) return null;
  for (const actor of actors) if (actor && actor.id === id) return actor;
  return null;
 }
 _chest(id) {
  const actor = this._actor(id);
  if (!actor) return null;
  return {x: finiteOr(actor.x, 0), y: finiteOr(actor.y, 0) + 1.05, z: finiteOr(actor.z, 0)};
 }
 _feet(id) {
  const actor = this._actor(id);
  if (!actor) return null;
  return {x: finiteOr(actor.x, 0), y: finiteOr(actor.y, 0), z: finiteOr(actor.z, 0)};
 }
 _aim(id) {
  const actor = this._actor(id);
  return actor && Number.isFinite(actor.yaw) ? actor.yaw : 0;
 }
 _facing(id) {
  const actor = this._actor(id);
  if (actor && Number.isFinite(actor.yaw)) return {x: -Math.sin(actor.yaw), y: 0, z: -Math.cos(actor.yaw)};
  if (actor) {
   const length = Math.hypot(finiteOr(actor.vx, 0), finiteOr(actor.vz, 0));
   if (length > 1e-3) return {x: actor.vx / length, y: 0, z: actor.vz / length};
  }
  return {x: 0, y: 0, z: -1};
 }
 _colorFor(id, harness) {
  if (this._wingColor) {
   const color = this._wingColor(id, harness);
   if (typeof color === 'string' && color) return color;
  }
  const character = this._actor(id)?.character;
  const wing = character ? WING_BY_OPERATOR[character] : null;
  const color = wing ? WING_COLOR_BY_ID[wing] : null;
  return color ?? HARNESS_TINTS[harness] ?? FALLBACK_TINT;
 }
 _particlesNow() {
  return resolveQuality(this._quality).particles;
 }
 // All one-shot spawns funnel through here so reduced motion is enforced in one
 // place: no growth, no spin, no delay, no drift and no rise, and no fades.
 _cue(options) {
  if (this._disposed) return null;
  const reduced = this.reducedNow();
  const merged = reduced
   ? {...options, reduced: true, grow: 0, spin: 0, delay: 0, drift: null, rise: 0}
   : {...options, reduced: false};
  const slot = this._cues.spawn(merged);
  if (slot) this._spawned++;
  return slot;
 }
 _motes(at, color, count, {seed = 1, life = .5, size = .09, radius = .6, rise = 1.4, opacity = .75} = {}) {
  if (this._disposed || this.reducedNow()) return 0;
  const total = Math.max(1, Math.round(count * this._particlesNow()));
  let spawned = 0;
  for (let i = 0; i < total; i++) {
   const u = unitHash(seed, i * 5 + 1), v = unitHash(seed, i * 5 + 2), w = unitHash(seed, i * 5 + 3);
   const angle = u * Math.PI * 2, distance = Math.sqrt(v) * radius;
   const slot = this._cue({
    kind: 'mote',
    pos: {x: finiteOr(at.x, 0) + Math.cos(angle) * distance, y: finiteOr(at.y, 0) + w * .35, z: finiteOr(at.z, 0) + Math.sin(angle) * distance},
    size: size * (.7 + u * .6),
    rise: rise * (.6 + w * .8),
    drift: {x: Math.cos(angle) * .3, y: 0, z: Math.sin(angle) * .3},
    life: life * (.7 + v * .6),
    opacity,
    color,
   });
   if (slot) spawned++;
  }
  return spawned;
 }
 _ensure(key, options, reduced) {
  const existing = this._channelMap.get(key);
  if (existing && existing.active) return existing;
  const slot = this._channels.spawn({...options, actor: options.actor ?? options.follow ?? null, key, persistent: true, life: 1, delay: 0, reduced});
  if (slot) {
   this._channelMap.set(key, slot);
   this._spawned++;
  }
  return slot;
 }
 _releaseKey(key) {
  const slot = this._channelMap.get(key);
  if (!slot) return false;
  this._channelMap.delete(key);
  this._channels.release(slot);
  return true;
 }
 _releaseActor(id) {
  if (id == null) return;
  const prefix = `${id}:`;
  for (const key of [...this._channelMap.keys()]) if (key.startsWith(prefix)) this._releaseKey(key);
 }
 // --- lifecycle -----------------------------------------------------------
 reset() {
  this._cues.clear();
  this._channels.clear();
  this._channelMap.clear();
  this._ropes.clear();
  this._pendingRopes = [];
  this._prev.clear();
  this._timers.clear();
 }
 dispose() {
  if (this._disposed) return;
  this._disposed = true;
  this.reset();
  this.detach();
  this._cues.dispose();
  this._channels.dispose();
  this._ropes.dispose();
  if (this._geometry) for (const key of Object.keys(this._geometry)) this._geometry[key].dispose();
  this._geometry = null;
 }
}

export function createAbilityVfx(options = {}) {
 return new AbilityVfx(options);
}
