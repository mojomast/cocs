// Shared, three.js-free rules for next-gen structure geometry so the level
// generator (collision) and the renderer (smooth geometry) agree on where a
// cavern's entrances are and how tall its shell is.

// The generator's positive planar turn maps +X to +Z (opposite three.js yaw).
// Keep origin/tangent/outward normal explicit; renderers must not infer a face
// from the parent's rotation or swap a facade span after it has been measured.
export function facadeFrame(parent, side) {
  const {x=0,y=0,z=0,w,d,h=6,rot=0}=parent;
  const faces={south:[0,d/2,1,0,0,1,w],north:[0,-d/2,-1,0,0,-1,w],east:[w/2,0,0,-1,1,0,d],west:[-w/2,0,0,1,-1,0,d]};
  if(!faces[side])throw new RangeError(`Unknown facade side: ${side}`);
  const [ox,oz,tx,tz,nx,nz,span]=faces[side],c=Math.cos(rot),s=Math.sin(rot);
  const turn=(x,z)=>({x:c*x-s*z,z:s*x+c*z});
  const o=turn(ox,oz);
  return {localOrigin:{x:ox,y:0,z:oz},localTangent:{x:tx,z:tz},localNormal:{x:nx,z:nz},parent:{x,y,z,rot},origin:{x:x+o.x,y,z:z+o.z},tangent:turn(tx,tz),normal:turn(nx,nz),span,height:h};
}

// Also usable for signs, trim and other facade-mounted rectangles. Centered
// packing leaves edge/roof/sill margins even on narrow or single-window faces.
export function facadeDetails({frame,rows=1}, {width=1.5,height=1,edge=.35,sill=.5,roof=.5,gap=1.2,depth=.14,offset=.09}={}) {
  if(!frame || width<=0 || height<=0)return [];
  const usable=frame.span-2*edge,vertical=frame.height-sill-roof;
  const cols=Math.floor((usable+gap)/(width+gap));
  const count=Math.min(Math.max(1,Math.floor(rows)),Math.floor((vertical+.7)/(height+.7)));
  if(cols<1||count<1)return [];
  const out=[],packed=cols*width+(cols-1)*gap;
  for(let r=0;r<count;r++)for(let i=0;i<cols;i++){
    const u=-packed/2+width/2+i*(width+gap),v=sill+height/2+(count===1?(vertical-height)/2:r*(vertical-height)/(count-1));
    out.push({x:frame.origin.x+frame.tangent.x*u+frame.normal.x*offset,y:frame.origin.y+v,z:frame.origin.z+frame.tangent.z*u+frame.normal.z*offset,w:width,h:height,d:depth,rot:Math.atan2(-frame.tangent.z,frame.tangent.x)});
  }
  return out;
}

export const CAVERN_SEGMENTS = 16;

// Horizontal projection is shared by floor authoring, wall clearance and the
// interior director. Eye height must never shift a sloping floor's XZ sample.
export function pathFloorAt(x,z,a,b) {
  const dx=b[0]-a[0],dz=b[2]-a[2],length=dx*dx+dz*dz;
  const t=length>1e-12?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/length)):0;
  return {x:a[0]+dx*t,y:a[1]+(b[1]-a[1])*t,z:a[2]+dz*t,t};
}

export const tunnelFloorPath=s=>s.floorPoints??s.points??[];

// Exact line/circle cuts retain authored Y by linear interpolation. Return
// multiple paths for a tunnel crossing a cavern, not a mesh bridged over a gap.
export function tunnelRenderPaths(tunnel,structures=[]) {
  const points=tunnelFloorPath(tunnel),caves=structures.filter(s=>s.type==='cavern'),paths=[];
  let current=null;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],dx=b[0]-a[0],dz=b[2]-a[2],aa=dx*dx+dz*dz;
    if(aa<1e-12)continue;
    const cuts=[0,1];
    for(const c of caves){
      const ox=a[0]-c.x,oz=a[2]-c.z,bb=2*(ox*dx+oz*dz),cc=ox*ox+oz*oz-c.radius*c.radius,disc=bb*bb-4*aa*cc;
      if(disc<0)continue;
      for(const t of [(-bb-Math.sqrt(disc))/(2*aa),(-bb+Math.sqrt(disc))/(2*aa)])if(t>0&&t<1)cuts.push(t);
    }
    cuts.sort((a,b)=>a-b);
    const at=t=>[a[0]+dx*t,a[1]+(b[1]-a[1])*t,a[2]+dz*t];
    for(let j=0;j<cuts.length-1;j++){
      if(cuts[j+1]-cuts[j]<1e-9)continue;
      const mid=at((cuts[j]+cuts[j+1])/2);
      if(caves.some(c=>Math.hypot(mid[0]-c.x,mid[2]-c.z)<c.radius-1e-9)){current=null;continue;}
      const start=at(cuts[j]),end=at(cuts[j+1]);
      if(current&&current.at(-1).every((v,k)=>Math.abs(v-start[k])<1e-8))current.push(end);
      else{current=[start,end];paths.push(current);}
    }
  }
  return paths;
}

// Two opposite entrances: the first two of every eight wall segments are open.
export const cavernOpening = i => i % 8 < 2;

// Angular arcs for the solid wall ring between the entrances, in radians.
export function cavernArcs(segments = CAVERN_SEGMENTS, openSegments = null) {
  const span = (Math.PI * 2) / segments;
  const arcs = [];
  let start = null;
  for (let i = 0; i <= segments; i++) {
    const include = i < segments && !(openSegments ? openSegments.includes(i) : cavernOpening(i));
    if (include && start === null) start = i;
    if (!include && start !== null) { arcs.push({ thetaStart: (start - .5) * span, thetaLength: (i - start) * span }); start = null; }
  }
  return arcs;
}

// Convert the collision-space arc ranges into three.js CylinderGeometry theta
// ranges. Collision places a wall segment at (cos a, sin a), while a cylinder
// vertex at theta sits at (sin theta, cos theta), so theta = PI/2 - a. Without
// this conversion the visible openings land on solid collision segments.
export function cavernRenderArcs(segments = CAVERN_SEGMENTS, openSegments = null) {
  return cavernArcs(segments,openSegments).map(({ thetaStart, thetaLength }) => ({
    thetaStart: Math.PI / 2 - (thetaStart + thetaLength),
    thetaLength,
  }));
}

// A cavern is a low stone drum with a domed roof, open at two opposite points.
export function cavernShell(radius = 12, height = 8, segments = CAVERN_SEGMENTS, openSegments = null) {
  const r = Math.max(1, Number(radius) || 12), h = Math.max(1, Number(height) || 8);
  return { radius: r, wallHeight: h * .52, domeHeight: h * .66, arcs: cavernArcs(segments,openSegments), renderArcs: cavernRenderArcs(segments,openSegments) };
}

// ---- Destructible props ---------------------------------------------------
//
// Lightweight, deterministic prop-break rules shared by the simulation and the
// renderer. Props are presentation-only: breaking one never edits collision
// blocks or authoritative movement, so a replay stays byte-identical whether or
// not a client renders debris. Debris is emitted as a pure, pooled plan (a fixed
// count of chunks with bounded velocities) so the CPU renderer can skip it and
// the WebGL renderer can reuse one instanced/pooled draw.

// Only these prop families are breakable; rocks/trees/ruins are static scenery.
export const BREAKABLE_PROPS = Object.freeze(new Set(['crate', 'barrel']));

// Per-family break profile. `threshold` is the damage that shatters the prop,
// `pieces` the pooled debris count, `force` the launch speed and `spread` the
// half-angle of the burst. Values are deliberately small so a busy firefight
// cannot flood the debris pool.
const BREAK_TABLE = Object.freeze({
  crate: Object.freeze({kind: 'crate', threshold: 30, pieces: 6, force: 4.2, spread: 1, color: '#6b4a2f', material: 'wood', sound: 'splat'}),
  barrel: Object.freeze({kind: 'barrel', threshold: 22, pieces: 5, force: 5.4, spread: .8, color: '#b0703f', material: 'metal', sound: 'burst'}),
});

export const BREAK_KINDS = Object.freeze(Object.keys(BREAK_TABLE));

// Pure deterministic hash (FNV-1a over quantized numbers) so the same prop and
// hit always produce the same shatter, independent of frame timing or renderer.
export function propHash(...values) {
  let h = 2166136261 >>> 0;
  for (const value of values) { const n = Math.floor((Number.isFinite(value) ? value : 0) * 1000); h ^= (n >>> 0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
export const propHashUnit = (...values) => propHash(...values) / 4294967296;

export function breakProfile(kind) { return BREAK_TABLE[kind] || null; }
export function isBreakable(kind) { return BREAKABLE_PROPS.has(kind); }

// A prop's stable identity: index in the map's authored prop list plus its
// position. The index keeps two props at the same coordinate distinct.
export function propId(prop, index = 0) {
  const seed = Number.isFinite(prop?.seed) ? prop.seed : index;
  return `${prop?.type || 'prop'}:${index}:${Math.round((prop?.x || 0) * 10)}:${Math.round((prop?.z || 0) * 10)}:${seed}`;
}

// Apply damage to a prop's break state. Returns the previous and next state so
// the caller can fire the shatter exactly once. `state` is a plain map keyed by
// propId; the function never mutates the prop itself.
export function applyPropDamage(state, id, kind, amount) {
  const profile = breakProfile(kind);
  if (!profile || !Number.isFinite(amount) || amount <= 0) return null;
  const current = state.get(id) || { hp: profile.threshold, broken: false };
  if (current.broken) return { id, kind, broken: true, wasBroken: true, hp: 0, profile };
  const hp = current.hp - amount;
  if (hp > 0) { state.set(id, { hp, broken: false }); return { id, kind, broken: false, wasBroken: false, hp, profile }; }
  state.set(id, { hp: 0, broken: true });
  return { id, kind, broken: true, wasBroken: false, hp: 0, profile };
}

// Presentation-only staging for a partially damaged prop. Pure and
// deterministic: the same hp and profile always yield the same shrink/darken,
// so the instanced crate or barrel can read "about to break" before the shatter
// without the renderer touching break state or collision. `progress` reaches 1
// exactly at the break threshold and `scale` stays inside ~0.86..0.92.
export function propDamageStage(hp, profile) {
  const threshold = Number.isFinite(profile?.threshold) && profile.threshold > 0 ? profile.threshold : 1;
  const remaining = Number.isFinite(hp) ? Math.max(0, Math.min(threshold, hp)) : threshold;
  const progress = 1 - remaining / threshold;
  const scale = Number((.92 - .06 * progress).toFixed(4));
  const shade = Number((1 - .38 * progress).toFixed(4));
  return Object.freeze({ progress, scale, shade });
}

// Deterministic debris plan for a shattered prop. Pure: same prop, same hit
// origin and same serial always yield the same chunks. Each chunk has a bounded
// velocity and spin so the pooled debris cannot escape its lifetime budget.
export function propBreakPlan(prop, { origin = null, serial = 0, reduced = false } = {}) {
  const profile = breakProfile(prop?.type);
  if (!profile) return null;
  const seed = propHash(prop?.seed ?? 0, prop?.x ?? 0, prop?.z ?? 0, serial);
  const baseX = Number(prop?.x) || 0, baseY = Number(prop?.y) || 0, baseZ = Number(prop?.z) || 0;
  const ox = Number.isFinite(origin?.x) ? origin.x : baseX + 1, oy = Number.isFinite(origin?.y) ? origin.y : baseY + .6, oz = Number.isFinite(origin?.z) ? origin.z : baseZ + 1;
  const count = Math.max(0, reduced ? Math.min(2, profile.pieces) : profile.pieces);
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const a = propHashUnit(seed, i * 7 + 1) * Math.PI * 2;
    const elevation = .25 + propHashUnit(seed, i * 7 + 2) * .9;
    const speed = profile.force * (.55 + propHashUnit(seed, i * 7 + 3) * .8);
    const dx = baseX - ox, dz = baseZ - oz, len = Math.hypot(dx, dz) || 1;
    const outward = .6 + profile.spread * .4;
    // Clamp the launch vector so a burst can never exceed the profile's budget.
    let vx = (Math.cos(a) + dx / len * outward) * speed, vy = (elevation + .35) * speed, vz = (Math.sin(a) + dz / len * outward) * speed;
    const magnitude = Math.hypot(vx, vy, vz), cap = profile.force * 2.2;
    if (magnitude > cap) { const k = cap / magnitude; vx *= k; vy *= k; vz *= k; }
    pieces.push({
      offset: { x: (propHashUnit(seed, i * 7 + 4) - .5) * .5, y: propHashUnit(seed, i * 7 + 5) * .4, z: (propHashUnit(seed, i * 7 + 6) - .5) * .5 },
      velocity: { x: vx, y: vy, z: vz },
      spin: { x: (propHashUnit(seed, i * 7 + 7) - .5) * 12, y: (propHashUnit(seed, i * 7 + 8) - .5) * 12, z: (propHashUnit(seed, i * 7 + 9) - .5) * 12 },
      scale: .55 + propHashUnit(seed, i * 7 + 10) * .7,
      life: .9 + propHashUnit(seed, i * 7 + 11) * .7,
    });
  }
  return { id: prop?.id ?? null, kind: prop.type, color: profile.color, material: profile.material, sound: profile.sound, pieces, count };
}

// ---- Weapon inspector -----------------------------------------------------
//
// Pure pose math for the menu/showcase 3D weapon viewer. Keeping the rotation
// and framing here (three.js-free) means the viewer's contract can be verified
// without a WebGL context, and the same pose is reproducible for a given
// weapon and time. `spin` is the idle turntable rate, `pitch` the presentation
// tilt and `distance`/`height` the framing of the inspect camera.

// Normalize a mount option set. `spin` may be a per-second rate; `reduced`
// freezes the turntable but keeps a fixed three-quarter pose so the weapon is
// still readable without motion.
export function weaponPose({time=0,spin=.35,pitch=-.18,reduced=false,index=0}={}){
 const t=Number.isFinite(time)?time:0,rate=Number.isFinite(spin)?spin:0;
 const yaw=reduced?(Math.PI*.75+index*.4):(Math.PI*.75+index*.4+t*rate);
 return { yaw, pitch:Number.isFinite(pitch)?pitch:-.18, roll:reduced?0:Math.sin(t*.7+index)*.03 };
}

// Inspect camera framing for a weapon bounding radius. Pulls back and lifts
// slightly so the whole silhouette (including a long barrel) stays in frame.
export function weaponInspect(radius=1,{fov=34,reduced=false}={}){
 const r=Math.max(.2,Number.isFinite(radius)?radius:1);
 const distance=r*(reduced?3.1:2.85),height=r*.55;
 return { distance, height, fov:Number.isFinite(fov)?fov:34, target:r*.1 };
}
