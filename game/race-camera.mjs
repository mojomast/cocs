// Pure race-demo camera logic. The title-screen race cycles a small set of
// rigs so the menu reel never sits on one chase shot. This module is free of
// three.js/WebGL so the mode selection, car rotation and poses are unit
// testable; view.mjs owns the smoothing and applies the returned pose.

export const RACE_DEMO_MODES = ['chase', 'orbit', 'flyover', 'trackside'];
export const RACE_DEMO_MODE_SECONDS = 7;

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export function raceDemoMode(elapsed) {
  const t = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  return RACE_DEMO_MODES[Math.floor(t / RACE_DEMO_MODE_SECONDS) % RACE_DEMO_MODES.length];
}

// Vehicles arrive either flat ({x,y,z,yaw}) or wrapped in a position vector.
function readVehicle(value) {
  if (!value || typeof value !== 'object') return null;
  const source = value.position && Number.isFinite(value.position.x) ? value.position : value;
  if (!Number.isFinite(source.x)) return null;
  return {
    id: Number.isFinite(value.id) ? value.id : null,
    x: num(source.x), y: num(source.y), z: num(source.z),
    yaw: num(value.yaw ?? value.heading, 0),
  };
}

function vehicleList(vehicles, vehicle) {
  const list = [];
  for (const item of Array.isArray(vehicles) ? vehicles : []) {
    const read = readVehicle(item);
    if (read) list.push(read);
  }
  if (!list.length) {
    const read = readVehicle(vehicle);
    if (read) list.push(read);
  }
  return list;
}

function poseBounds(centerline, list) {
  const points = [];
  for (const point of centerline) if (point && Number.isFinite(point.x) && Number.isFinite(point.z)) points.push(point);
  if (!points.length) for (const vehicle of list) points.push(vehicle);
  if (!points.length) return { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
  }
  const pad = 28;
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

// Sample a closed polyline by arc length so the flyover and trackside rigs move
// along the circuit instead of cutting across it.
function sampleCenterline(centerline, distance) {
  if (!centerline.length) return null;
  if (centerline.length === 1) return { x: centerline[0].x, z: centerline[0].z, dx: 0, dz: 1 };
  const lengths = [];
  let total = 0;
  for (let i = 0; i < centerline.length; i++) {
    const a = centerline[i], b = centerline[(i + 1) % centerline.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    lengths.push(length); total += length;
  }
  if (!(total > 0)) return { x: centerline[0].x, z: centerline[0].z, dx: 0, dz: 1 };
  let d = ((distance % total) + total) % total;
  for (let i = 0; i < centerline.length; i++) {
    const length = lengths[i], a = centerline[i], b = centerline[(i + 1) % centerline.length];
    if (d <= length || i === centerline.length - 1) {
      const t = length ? Math.min(1, d / length) : 0;
      const dx = length ? (b.x - a.x) / length : 0;
      const dz = length ? (b.z - a.z) / length : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx, dz };
    }
    d -= length;
  }
  return { x: centerline[0].x, z: centerline[0].z, dx: 0, dz: 1 };
}

function packCenter(list) {
  if (!list.length) return null;
  let x = 0, y = 0, z = 0;
  for (const vehicle of list) { x += vehicle.x; y += vehicle.y; z += vehicle.z; }
  return { x: x / list.length, y: y / list.length, z: z / list.length };
}

// Arc length of the centerline point closest to the pack, so the flyover can
// hold a lead ahead of the racers instead of drifting on a fixed clock.
function nearestArcLength(centerline, point) {
  let best = 0, bestDistance = Infinity, travelled = 0;
  for (let i = 0; i < centerline.length; i++) {
    const a = centerline[i], b = centerline[(i + 1) % centerline.length];
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), length2 = dx * dx + dz * dz;
    const t = length2 ? clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const distance = (point.x - px) ** 2 + (point.z - pz) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = travelled + length * t; }
    travelled += length;
  }
  return best;
}

export function raceDemoPose({ mode, centerline, vehicle, vehicles, elapsed } = {}) {
  const t = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const points = (Array.isArray(centerline) ? centerline : []).filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.z));
  const list = vehicleList(vehicles, vehicle);
  const segment = Math.floor(t / RACE_DEMO_MODE_SECONDS);
  const selected = list.length ? list[((segment % list.length) + list.length) % list.length] : null;
  const focus = selected || { x: 0, y: 0, z: 0, yaw: 0 };
  const rig = RACE_DEMO_MODES.includes(mode) ? mode : 'chase';
  const pack = packCenter(list) || focus;
  const bounds = poseBounds(points, list);
  let x = focus.x, y = focus.y + 5, z = focus.z;
  let lookX = focus.x, lookY = focus.y + 1, lookZ = focus.z;
  if (rig === 'chase') {
    const sin = Math.sin(focus.yaw), cos = Math.cos(focus.yaw);
    x = focus.x - sin * 9; y = focus.y + 5; z = focus.z - cos * 9;
    lookX = focus.x + sin * 6; lookY = focus.y + 1; lookZ = focus.z + cos * 6;
  } else if (rig === 'orbit') {
    const angle = t * 0.55, radius = 8.5;
    x = focus.x + Math.cos(angle) * radius; y = focus.y + 4.2; z = focus.z + Math.sin(angle) * radius;
    lookX = focus.x; lookY = focus.y + 1.1; lookZ = focus.z;
  } else if (rig === 'flyover') {
    const ahead = pack && points.length ? nearestArcLength(points, pack) : t * 16;
    const sample = sampleCenterline(points, ahead + 18) || { x: focus.x, z: focus.z, dx: 0, dz: 1 };
    x = sample.x; y = 12 + 1.4 * Math.sin(t * 0.31); z = sample.z;
    lookX = pack.x; lookY = pack.y + 1.2; lookZ = pack.z;
  } else {
    const anchor = sampleCenterline(points, segment * RACE_DEMO_MODE_SECONDS * 13) || { x: focus.x, z: focus.z, dx: 0, dz: 1 };
    const side = segment % 2 ? 1 : -1;
    x = anchor.x + anchor.dz * side * 15; y = 3.4; z = anchor.z - anchor.dx * side * 15;
    lookX = pack.x; lookY = pack.y + 1.1; lookZ = pack.z;
  }
  x = clamp(num(x, focus.x), bounds.minX, bounds.maxX);
  z = clamp(num(z, focus.z), bounds.minZ, bounds.maxZ);
  y = Math.max(0.8, num(y, focus.y + 4));
  return {
    mode: rig,
    x, y, z,
    lookX: num(lookX, x), lookY: num(lookY, 1), lookZ: num(lookZ, z),
    fov: 70,
    carId: selected ? selected.id : null,
  };
}
