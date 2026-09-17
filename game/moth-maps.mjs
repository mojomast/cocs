// Builds a playable arena from a Moth Quantum labyrinth graph.
//
// labyrinth-v1 returns a grid of qubits plus a coupling map: nodes become
// rooms, coupled neighbours become doorways, and each node's measured Bloch
// vector drives its dressing. The graph is pure data, so the same bake always
// produces the same arena. This is the same trick Moth's own "Quantum
// Backrooms" uses to generate levels on real quantum hardware.
//
// buildMothArena() is standalone (pass it any graph); mothArena() reads a graph
// from the runtime registry populated by configureMothAssets().

import { createLevel, terrainField } from './levelgen.mjs';
import { mothLevel } from './moth-assets.mjs';

export const MOTH_CELL_SIZE = 12;
export const MOTH_WALL_HEIGHT = 3.4;
export const MOTH_WALL_THICKNESS = 0.6;
// Doors are sized to clear the 6 m navigation grid the simulation walks on, and
// cell centres land on multiples of 6, so every doorway is actually passable
// rather than merely drawn.
export const MOTH_DOOR_WIDTH = 4.5;

const centerX = (col, cols, size) => (col - (cols - 1) / 2) * size;
const centerZ = (row, rows, size) => (row - (rows - 1) / 2) * size;

const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// Quantum couplings author the doorways, but a coupling map is not guaranteed to
// connect every room. Add the minimal set of extra doors that makes the whole
// labyrinth walk-connected, preserving the quantum choices and never leaving an
// isolated island.
function openEdgeSet(graph) {
  const { rows, cols } = graph;
  const count = rows * cols;
  const adjacent = (a, b) => (a >= 0 && b >= 0 && a < count && b < count) && (Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) + Math.abs((a % cols) - (b % cols)) === 1);
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const open = new Set();
  for (const [a, b] of graph.coupling || []) if (adjacent(a, b)) { open.add(edgeKey(a, b)); union(a, b); }
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const here = row * cols + col;
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const nr = row + dr, nc = col + dc;
      if (nr >= rows || nc >= cols) continue;
      const there = nr * cols + nc;
      if (find(here) === find(there)) continue;
      open.add(edgeKey(here, there));
      union(here, there);
    }
  }
  return open;
}

// A wall on a vertical grid line runs along Z; a doorway leaves a gap in the
// middle so the two rooms stay walk-connected.
function wallAlongZ(ctx, x, z, span, open, { door, height, thickness }) {
  if (!open) { ctx.addBlock({ x, z, w: thickness, d: span, h: height, kind: 'wall' }); return; }
  const segment = (span - door) / 2;
  if (segment <= 0.15) return;
  ctx.addBlock({ x, z: z - span / 2 + segment / 2, w: thickness, d: segment, h: height, kind: 'wall' });
  ctx.addBlock({ x, z: z + span / 2 - segment / 2, w: thickness, d: segment, h: height, kind: 'wall' });
}
function wallAlongX(ctx, z, x, span, open, { door, height, thickness }) {
  if (!open) { ctx.addBlock({ x, z, w: span, d: thickness, h: height, kind: 'wall' }); return; }
  const segment = (span - door) / 2;
  if (segment <= 0.15) return;
  ctx.addBlock({ x: x - span / 2 + segment / 2, z, w: segment, d: thickness, h: height, kind: 'wall' });
  ctx.addBlock({ x: x + span / 2 - segment / 2, z, w: segment, d: thickness, h: height, kind: 'wall' });
}

export function buildMothArena(graph, {
  id = 'moth-arena',
  name = 'Quantum Labyrinth',
  tag = 'MOTH / QUANTUM LABYRINTH',
  size = MOTH_CELL_SIZE,
  wallHeight = MOTH_WALL_HEIGHT,
  wallThickness = MOTH_WALL_THICKNESS,
  doorWidth = MOTH_DOOR_WIDTH,
} = {}) {
  if (!graph || !Number.isInteger(graph.rows) || !Number.isInteger(graph.cols)) throw new Error('buildMothArena: invalid graph');
  const { rows, cols } = graph;
  const width = cols * size, depth = rows * size;
  const margin = wallThickness + 0.5;
  const bounds = { minX: -width / 2 - margin, maxX: width / 2 + margin, minZ: -depth / 2 - margin, maxZ: depth / 2 + margin };
  const terrain = terrainField(bounds, { height: () => 0, amplitude: 0 });
  const open = openEdgeSet(graph);
  const node = (row, col) => row * cols + col;
  const wall = { door: doorWidth, height: wallHeight, thickness: wallThickness };
  const seed = ((graph.coupling || []).flat().reduce((sum, value) => sum + value, rows * 31 + cols * 17 + 1)) || 1;
  const metric = graph.metrics?.mode ? `${graph.metrics.mode.toUpperCase()}${Number.isFinite(graph.metrics.szSamp) ? ` · Sz ${graph.metrics.szSamp}` : ''}` : 'AER';

  return createLevel({
    id, name, tag,
    color: '#8be9e0', background: '#05080a', seed,
    bounds, terrain, biome: 'ruins', amplitude: 0, relief: 0,
    description: `A ${rows}x${cols} labyrinth carved from a quantum graph (${metric}). Coupled qubits open doorways; radiating qubits mark the objectives.`,
    layout(ctx) {
      for (let row = 0; row < rows; row++) {
        const z = centerZ(row, rows, size);
        for (let col = 0; col <= cols; col++) {
          const x = -width / 2 + col * size;
          const isOpen = col > 0 && col < cols && open.has(edgeKey(node(row, col - 1), node(row, col)));
          wallAlongZ(ctx, x, z, size, isOpen, wall);
        }
      }
      for (let col = 0; col < cols; col++) {
        const x = centerX(col, cols, size);
        for (let row = 0; row <= rows; row++) {
          const z = -depth / 2 + row * size;
          const isOpen = row > 0 && row < rows && open.has(edgeKey(node(row - 1, col), node(row, col)));
          wallAlongX(ctx, z, x, size, isOpen, wall);
        }
      }
      let objectiveCount = 0;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const [x, z] = [centerX(col, cols, size), centerZ(row, rows, size)];
        ctx.addNav(x, z);
        const cell = graph.cells?.[node(row, col)];
        // Decoration only: rooms stay clear so the nav graph is never blocked by
        // a quantum flourish. Real cover is added by createLevel's own safe
        // placement pass.
        if (cell?.radiating) {
          ctx.addObjective(x, z, 3.2);
          ctx.addBarrel({ x, z, scale: 1.1 });
          ctx.addBarrel({ x: x + 1.4, z: z - 1.4, scale: 0.85 });
          objectiveCount++;
        } else if (cell && cell.z > 0.06) {
          ctx.addRock({ x, z, scale: 0.7, collide: false });
        } else if (cell && cell.z < -0.06) {
          ctx.addRuin({ x, z, scale: 0.8 });
        }
      }
      if (!objectiveCount) ctx.addObjective(0, 0, 4);
      // Spawn ring: corners, edge midpoints and the centre, de-duplicated so
      // small grids stay valid.
      const seen = new Set();
      const candidates = [
        [0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1],
        [0, Math.floor((cols - 1) / 2)], [rows - 1, Math.floor((cols - 1) / 2)],
        [Math.floor((rows - 1) / 2), 0], [Math.floor((rows - 1) / 2), cols - 1],
      ];
      for (const [row, col] of candidates) {
        const key = `${row}:${col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        ctx.addSpawn(centerX(col, cols, size), centerZ(row, rows, size));
      }
    },
  });
}

export function mothArena(name = 'moth-backrooms', options = {}) {
  const graph = mothLevel(name);
  if (!graph) return null;
  return buildMothArena(graph, { id: name, ...options });
}

export const MOTH_MAP_INFO = Object.freeze({ id: 'moth-backrooms', name: 'Quantum Labyrinth', tag: 'MOTH / QUANTUM LABYRINTH' });
