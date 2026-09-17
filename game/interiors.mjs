// Walkable interior volumes derived from a next-gen arena's structures, used by
// the cinematic director so the camera can follow a fight inside a building,
// cavern or tunnel instead of orbiting the roof. Pure and three.js-free.

import {clamp} from './math.mjs';
import {tunnelFloorPath,pathFloorAt} from './structures.mjs';
const num = (v, d = 0) => Number.isFinite(v) ? v : d;

export function buildInteriors(structures = []) {
  const out = [];
  for (const s of structures || []) {
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'building') {
      const q = ((Math.round((s.rot || 0) / (Math.PI / 2)) % 4) + 4) % 4, swap = q % 2 === 1, wall = num(s.wall, .5);
      out.push({ kind: 'box', x: num(s.x), z: num(s.z), base: num(s.y), height: Math.max(1, num(s.h, 6)), hw: Math.max(.6, (swap ? num(s.d, 8) : num(s.w, 8)) / 2 - wall * 1.3), hd: Math.max(.6, (swap ? num(s.w, 8) : num(s.d, 8)) / 2 - wall * 1.3) });
    } else if (s.type === 'cavern') {
      out.push({ kind: 'cyl', x: num(s.x), z: num(s.z), base: num(s.y), height: Math.max(1, num(s.height, 8)), r: Math.max(1, num(s.radius, 12) * .82) });
    } else if (s.type === 'tunnel') {
      const r = Math.max(.8, num(s.radius, 3) * .8), pts = tunnelFloorPath(s);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!a || !b) continue;
        out.push({ kind: 'seg', ax: num(a[0]), ay: num(a[1]), az: num(a[2]), bx: num(b[0]), by: num(b[1]), bz: num(b[2]), r, floorPath:!!s.floorPoints });
      }
    }
  }
  return out;
}

export function nearestOnSegment(px, py, pz, seg) {
  const dx = seg.bx - seg.ax, dy = seg.by - seg.ay, dz = seg.bz - seg.az, len = dx * dx + dy * dy + dz * dz;
  const t = len > 1e-9 ? clamp(((px - seg.ax) * dx + (py - seg.ay) * dy + (pz - seg.az) * dz) / len, 0, 1) : 0;
  return { x: seg.ax + dx * t, y: seg.ay + dy * t, z: seg.az + dz * t };
}

export function interiorAt(interiors, point) {
  if (!point) return null;
  const px = num(point.x), py = num(point.y), pz = num(point.z);
  let best = null, bestMargin = Infinity;
  for (const v of interiors || []) {
    let margin;
    if (v.kind === 'box') {
      if (py < v.base - .2 || py > v.base + v.height) continue;
      margin = Math.min(v.hw - Math.abs(px - v.x), v.hd - Math.abs(pz - v.z));
    } else if (v.kind === 'cyl') {
      if (py < v.base - .2 || py > v.base + v.height) continue;
      margin = v.r - Math.hypot(px - v.x, pz - v.z);
    } else {
      const n = v.floorPath ? pathFloorAt(px,pz,[v.ax,v.ay,v.az],[v.bx,v.by,v.bz]) : nearestOnSegment(px, py, pz, v);
      if (py < n.y - (v.floorPath?.05:1) || py > n.y + v.r + 1.6) continue;
      margin = v.r - Math.hypot(px - n.x, py - n.y, pz - n.z);
    }
    if (margin >= 0 && margin < bestMargin) { bestMargin = margin; best = v; }
  }
  return best;
}

export function interiorCenter(volume, point) {
  if (!volume) return null;
  if (volume.kind === 'seg') {
    if(volume.floorPath){const p=pathFloorAt(num(point?.x),num(point?.z),[volume.ax,volume.ay,volume.az],[volume.bx,volume.by,volume.bz]);return {x:p.x,y:p.y,z:p.z};}
    return nearestOnSegment(num(point?.x), num(point?.y), num(point?.z), volume);
  }
  return { x: volume.x, y: volume.base, z: volume.z };
}
