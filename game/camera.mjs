// Camera collision for the cinematic/demo director. Given the followed actor's
// head, the camera position and the distance at which scenery first blocks the
// line back from the head, return a camera position pulled in front of that
// obstruction (and re-aimed at the head). Null means no adjustment is needed.
import {clamp} from './math.mjs';

function geometry(head, camera, options = {}) {
  const margin = Number.isFinite(options.margin) ? options.margin : .4;
  const min = Number.isFinite(options.min) ? options.min : 1.3;
  const dx = Number(head.x || 0) - Number(camera.x || 0);
  const dy = Number(head.y || 0) - Number(camera.y || 0);
  const dz = Number(head.z || 0) - Number(camera.z || 0);
  const dist = Math.hypot(dx, dy, dz);
  return { dx, dy, dz, dist, margin, min };
}

// Desired camera distance from the followed actor's head: the full distance when
// the line back from the head is clear, or a shorter stand-off just inside the
// first obstruction. Feed it every frame and smooth the result; never leave a
// blocked frame uncorrected or the camera will flicker between two poses.
export function occlusionDistance(head, camera, blockDistance, options = {}) {
  if (!head || !camera) return null;
  const g = geometry(head, camera, options);
  if (!(g.dist > g.min)) return g.dist;
  const block = Number(blockDistance);
  if (!Number.isFinite(block) || block >= g.dist - .35) return g.dist;
  return Math.max(g.min, block - g.margin);
}

export function clearCameraPosition(head, camera, blockDistance, options = {}) {
  if (!head || !camera) return null;
  const g = geometry(head, camera, options);
  const want = occlusionDistance(head, camera, blockDistance, options);
  if (!Number.isFinite(want) || want >= g.dist - 1e-9) return null;
  const ux = g.dx / g.dist, uy = g.dy / g.dist, uz = g.dz / g.dist;
  return {
    x: (head.x || 0) - ux * want,
    y: (head.y || 0) - uy * want,
    z: (head.z || 0) - uz * want,
    yaw: Math.atan2(-g.dx, -g.dz),
    pitch: clamp(Math.asin(clamp(uy, -1, 1)), -1.45, 1.45),
    distance: want,
  };
}

