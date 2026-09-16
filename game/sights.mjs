// Reusable weapon-sight geometry and the ADS alignment solver.
//
// Every component here is deliberately *open*: the player must be able to see
// the target through the sight. A rear notch is two side posts over a lower
// bridge with an empty center, a rear aperture is a bare ring with no backing
// plate, a holographic sight is a thin frame around an empty window (plus a
// small reticle), and a scope is an open-ended tube with no caps or lens disks
// across the bore. Nothing here disables depth testing or paints a reticle over
// an opaque block.
//
// `attach*` helpers take the same `ctx` object a weapon builder receives
// ({T, box, cylinder, ring, geo, material, palette}) and attach geometry to the
// group. They return the real anchor positions (aperture center and front
// aiming point) so the caller can record them for ADS alignment.
import * as T from 'three';

const v3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);

// Rear "notch" battle sight: a pair of side posts sitting on a lower bridge,
// with an open gap between them. The aiming point is the empty center at
// (x, y, z); the posts frame it without filling it.
export function attachRearNotch(parent, ctx, { x = 0, y = 0, z = 0, width = 0.09, height = 0.05, depth = 0.03, gap = 0.03, material, bridge } = {}) {
  const { box } = ctx;
  const mat = material || ctx.palette?.dark;
  const bar = bridge || material || ctx.palette?.light;
  const post = Math.max(0.008, (width - gap) / 2);
  const half = gap / 2 + post / 2;
  const tagRear = node => { if (node) node.userData.sightRear = true; return node; };
  tagRear(box(parent, post, height, depth, x - half, y, z, mat));
  tagRear(box(parent, post, height, depth, x + half, y, z, mat));
  // A thin bridge under the opening ties the posts together without rising into
  // the sight line; the gap above it stays open.
  tagRear(box(parent, width, Math.max(0.01, height * 0.22), depth * 0.9, x, y - height * 0.39, z, bar));
  return { x, y, z, width: gap, height };
}

// Rear aperture ("ghost ring"): a real torus around the aiming point with no
// plate behind it, so the opening is genuinely transparent.
export function attachRearAperture(parent, ctx, { x = 0, y = 0, z = 0, radius = 0.02, tube = 0.006, material } = {}) {
  const { ring } = ctx;
  const mat = material || ctx.palette?.light;
  // ring() builds a torus in its local XY plane; rx = 0 leaves the bore along Z.
  const node = ring(parent, radius, tube, x, y, z, mat, 0);
  if (node) { node.userData.sightRear = true; node.userData.sightAperture = true; }
  return { x, y, z, radius, inner: Math.max(0, radius - tube) };
}

// Front sight post. The post rises to a tip at (x, y, z) — the front aiming
// point — and extends downward, keeping the target above the tip unobstructed.
export function attachFrontPost(parent, ctx, { x = 0, y = 0, z = 0, width = 0.012, height = 0.05, depth = 0.014, material, tipMaterial } = {}) {
  const { box } = ctx;
  const mat = material || ctx.palette?.dark;
  const post = box(parent, width, height, depth, x, y - height / 2, z, mat);
  if (post) post.userData.sightFront = true;
  const tip = ctx.T && box(parent, width * 0.9, Math.min(0.012, height * 0.25), depth * 0.9, x, y, z, tipMaterial || ctx.palette?.glow);
  if (tip) tip.userData.sightFrontTip = true;
  return { x, y, z, tip: true };
}

// A full iron-sight pair (notch + post). Returns the anchors used to derive ADS.
export function attachIronSights(parent, ctx, { rear = {}, front = {} } = {}) {
  const notch = attachRearNotch(parent, ctx, rear);
  const post = attachFrontPost(parent, ctx, front);
  return {
    kind: 'iron',
    rear: { x: notch.x, y: notch.y, z: notch.z, aperture: notch.width },
    front: { x: post.x, y: post.y, z: post.z },
  };
}

// Holographic sight: a thin rectangular frame with an empty center window, a
// small bright reticle at the axis, and optional faint (transparent, non-
// emissive-slab) glass. The frame never fills the window.
export function attachHoloSight(parent, ctx, { x = 0, y = 0, z = 0, width = 0.09, height = 0.07, depth = 0.1, frame = 0.007, material, reticle, reticleMaterial } = {}) {
  const { box, T: three } = ctx;
  const mat = material || ctx.palette?.dark;
  const halfW = width / 2, halfH = height / 2;
  const parts = [
    box(parent, width + frame, frame, depth, x, y + halfH, z, mat),
    box(parent, width + frame, frame, depth, x, y - halfH, z, mat),
    box(parent, frame, height, depth, x - halfW, y, z, mat),
    box(parent, frame, height, depth, x + halfW, y, z, mat),
  ];
  for (const part of parts) if (part) part.userData.sightFrame = true;
  // A small reticle ring/tick at the empty center — intended to be seen, so it
  // is deliberately tiny rather than a covering slab.
  const retMat = reticleMaterial || ctx.palette?.glow;
  if (three) {
    const dot = new three.Mesh(ctx.geo ? ctx.geo('sight-holo-reticle|.006|10', () => new T.RingGeometry(0.004, 0.006, 10)) : new T.RingGeometry(0.004, 0.006, 10), retMat);
    dot.position.set(x, y, z + depth * 0.06);
    dot.name = 'reticle';
    parent.add(dot);
  }
  return { kind: 'holo', rear: { x, y, z }, front: { x, y, z: z - depth } };
}

// Scope: an open-ended tube. No end caps and no lens disk sit in the bore; the
// rear and front anchors are the bore openings on the optical axis.
export function attachScope(parent, ctx, { x = 0, y = 0, z = 0, length = 0.5, radius = 0.055, bell = 0.02, material, ringMaterial, mount = false, mountY, mountMaterial } = {}) {
  const { geo, cylinder, ring, box } = ctx;
  const mat = material || ctx.palette?.dark;
  const openTube = (r, len, cx, cy, cz) => {
    const g = geo ? geo(`sight-scope-tube|${r}|${len}|16`, () => new T.CylinderGeometry(r, r, len, 16, 1, true)) : new T.CylinderGeometry(r, r, len, 16, 1, true);
    const m = new T.Mesh(g, mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(cx, cy, cz);
    m.userData.scopeTube = true;
    parent.add(m);
    return m;
  };
  // Main tube, then a slightly flared objective bell and a plain ocular — all
  // open so the barrel can be seen straight through.
  openTube(radius, length, x, y, z - length * 0.5);
  openTube(radius + bell, 0.11, x, y, z - length - 0.02);
  openTube(radius + 0.005, 0.1, x, y, z + 0.05);
  if (ring) {
    ring(parent, radius + 0.012, 0.012, x, y, z - length * 0.5 + 0.1, ringMaterial || ctx.palette?.glow, 0);
    ring(parent, radius + 0.012, 0.012, x, y, z + 0.02, ringMaterial || ctx.palette?.glow, 0);
  }
  // Physical mount: a receiver base plate with paired support posts and clamp
  // rings so a raised optic reads as bolted on rather than floating. Everything
  // sits below or outside the bore, so the sight line stays open.
  if (mount) {
    const post = mountMaterial || mat;
    const baseY = Number.isFinite(mountY) ? mountY : y - radius - 0.05;
    const postX = radius + 0.022;
    const top = y - radius + 0.004;
    const postLength = Math.max(0.02, top - baseY);
    for (const rz of [z - length * 0.74, z - length * 0.16]) {
      if (ring) ring(parent, radius + 0.01, 0.01, x, y, rz, ringMaterial || post, 0);
      if (box) {
        box(parent, 0.02, postLength, 0.024, x + postX, baseY + postLength / 2, rz, post);
        box(parent, 0.02, postLength, 0.024, x - postX, baseY + postLength / 2, rz, post);
      }
    }
    if (box) box(parent, postX * 2 + 0.02, 0.018, length * 0.8, x, baseY + 0.009, z - length * 0.45, post);
  }
  return { kind: 'scope', rear: { x, y, z: z + 0.05 }, front: { x, y, z: z - length - 0.02 } };
}

// Optic attachment shared by the viewmodel tail. `kind` is one of none/iron/
// holo/scope. The anchors come from the weapon's own built-in sights, so the
// optic sits on the same axis instead of floating on a separate hard-coded line.
export function attachOptic(parent, ctx, kind, anchors, { x = 0, y = 0, z = 0 } = {}) {
  if (kind === 'holo') return attachHoloSight(parent, ctx, { x, y, z, material: ctx.palette?.dark, reticleMaterial: ctx.palette?.glow });
  if (kind === 'scope') return attachScope(parent, ctx, { x, y, z, material: ctx.palette?.dark, ringMaterial: ctx.palette?.glow, mount: true });
  if (kind === 'iron') {
    // An "iron" attachment is a raised rail-mounted aperture + post over the
    // built-in sights; keep it open.
    attachRearAperture(parent, ctx, { x, y: y + 0.01, z: z + 0.01, material: ctx.palette?.light });
    return { kind: 'iron' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// ADS alignment solver.
//
// Given the real rear aperture and front aiming point reported by the sight
// builders (in the weapon group's local space), solve the translation and
// rotation that align the sight line with the weapon camera's center ray. The
// caller applies its own uniform model scale: a local point p maps to
// `P + Q * (scale * p)`.
//
// The rear aperture (and therefore the whole sight line, front tip included, once
// Q aligns the bore) is centred on the camera axis in x/y, but the weapon *body*
// is held at a fixed `distance` in front of the eye rather than pinning the rear
// sight at a fixed eye relief. Pinning eye relief pushed weapons whose rear sight
// sits forward of the model origin (e.g. the Scattergun) back through the camera,
// filling the screen with the receiver. A fixed body distance keeps every weapon
// framed consistently and in front of the near plane.
//
//   Q = rotation taking (front - rear) onto (0, 0, -1)
//   P = (-(Q * rear * scale).x, -(Q * rear * scale).y, -distance)
//
// `rearZ` records where the real aperture ended up so the geometric tests can
// check it against the center ray.
export function solveSightPose(rear, front, { scale = 1, distance = 0.62, eyeRelief } = {}) {
  const r = v3(Number(rear?.x) || 0, Number(rear?.y) || 0, Number(rear?.z) || 0);
  const f = v3(Number(front?.x) || 0, Number(front?.y) || 0, Number(front?.z) || 0);
  const dir = f.clone().sub(r);
  if (dir.lengthSq() < 1e-12) dir.set(0, 0, -1);
  dir.normalize();
  const quat = new T.Quaternion().setFromUnitVectors(dir, v3(0, 0, -1));
  const rotatedRear = r.clone().applyQuaternion(quat).multiplyScalar(scale);
  const body = Number.isFinite(eyeRelief)
    ? Math.max(0.2, eyeRelief + rotatedRear.z)
    : (Number.isFinite(distance) ? Math.max(0.2, distance) : 0.62);
  const rearZ = -body + rotatedRear.z;
  const euler = new T.Euler().setFromQuaternion(quat, 'YXZ');
  return {
    position: { x: -rotatedRear.x, y: -rotatedRear.y, z: -body },
    quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
    pitch: euler.x,
    yaw: euler.y,
    roll: euler.z,
    distance: body,
    rearZ,
    eyeRelief: -rearZ,
  };
}

// Project a local weapon-space point through a solved pose and uniform scale
// back into weapon-camera space. Used by the geometric tests to confirm the
// aperture lands on the center ray.
export function projectSightPoint(point, pose, scale = 1) {
  const q = new T.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
  const p = v3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0).multiplyScalar(scale).applyQuaternion(q);
  return v3(p.x + pose.position.x, p.y + pose.position.y, p.z + pose.position.z);
}

// Guard used by tests and the renderer: how far (in weapon-camera units) the
// solved rear aperture and front tip deviate from the ideal sight line
// (rear on the center axis at eye relief, bore pointing down -Z).
export function sightAlignmentError(rear, front, pose, scale = 1) {
  const r = projectSightPoint(rear, pose, scale);
  const f = projectSightPoint(front, pose, scale);
  const idealRear = v3(0, 0, -pose.eyeRelief);
  const rearError = r.distanceTo(idealRear);
  const bore = f.clone().sub(r);
  const length = bore.length() || 1;
  bore.normalize();
  // Angle between the bore and the camera forward axis (0, 0, -1).
  const angleError = Math.acos(Math.max(-1, Math.min(1, -bore.z)));
  const lateral = Math.hypot(f.x, f.y);
  return { rearError, angleError, lateral, length };
}

// ---------------------------------------------------------------------------
// ADS presentation composition.
//
// The weapon-camera pose is a blend between a *neutral* hip orientation and the
// solved ADS orientation, with the presentation channels (movement sway, recoil,
// reload, weapon switch) composed exactly once on top. The neutral hip pose must
// not already contain the recoil channels: doing so and then re-adding them made
// recoil roughly double through the ADS transition. Recoil is applied once here;
// its roll strength eases from full at hip to half at full ADS.
const AXIS_X = v3(1, 0, 0);
const AXIS_Z = v3(0, 0, 1);
const scratchAxis = new T.Quaternion();
const scratchAim = new T.Quaternion();
export const ZERO_CHANNELS = Object.freeze({ recoil: null, punch: null, reload: null, swap: null, movement: null });

export function composeAdsQuaternion(out, aimQuaternion, adsT, channels) {
  const t = Math.max(0, Math.min(1, Number(adsT) || 0));
  out.identity();
  if (aimQuaternion) {
    scratchAim.set(Number(aimQuaternion.x) || 0, Number(aimQuaternion.y) || 0, Number(aimQuaternion.z) || 0, Number.isFinite(aimQuaternion.w) ? aimQuaternion.w : 1);
    out.slerp(scratchAim, t);
  }
  const c = channels || ZERO_CHANNELS;
  const pitch = (c.recoil?.pitch || 0) + (c.punch?.pitch || 0) + (c.reload?.pitch || 0) + (c.swap?.pitch || 0);
  const roll = (c.movement?.roll || 0) * (1 - t * 0.5) + (c.reload?.roll || 0) + (c.swap?.roll || 0) + (c.recoil?.roll || 0);
  if (pitch) out.multiply(scratchAxis.setFromAxisAngle(AXIS_X, pitch));
  if (roll) out.multiply(scratchAxis.setFromAxisAngle(AXIS_Z, roll));
  return out;
}

export const SIGHT_EXPORTS = Object.freeze(['attachRearNotch', 'attachRearAperture', 'attachFrontPost', 'attachIronSights', 'attachHoloSight', 'attachScope', 'attachOptic', 'solveSightPose', 'projectSightPoint', 'sightAlignmentError', 'composeAdsQuaternion']);
