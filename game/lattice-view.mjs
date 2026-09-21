import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {latticeAssetRecords, latticeCargoRecords, latticeMachinePlacement, LATTICE_MACHINE_LABELS} from './lattice-asset-state.mjs';
import {buildLatticeMachineGeometry, latticeToolPose} from './lattice-machines.mjs';

const COLORS = Object.freeze({neutral: '#c0d1cc', offline: '#586872', active: '#8ce4c9', ready: '#a6c3c4', held: '#a6c3c4', contested: '#ffd166', blocked: '#ff8072', prime: '#d5b2ff'});
const MAX_ASSETS = 96;
const clampCount = value => Math.max(0, Math.min(4, value));

function glyphGeometry(status) {
  const parts = [];
  const bar = (w, h, x, y, angle = 0) => { const g = new T.BoxGeometry(w, h, .055); g.rotateZ(angle); g.translate(x, y, 0); parts.push(g); };
  if (status === 'contested') { bar(.5, .085, 0, 0, .75); bar(.5, .085, 0, 0, -.75); }
  else if (status === 'blocked') { bar(.45, .08, 0, .14); bar(.45, .08, 0, -.14); bar(.08, .27, -.18, 0); bar(.08, .27, .18, 0); bar(.5, .06, 0, 0, -.65); }
  else if (status === 'active') { bar(.29, .29, 0, 0, Math.PI / 4); }
  else if (status === 'ready') { bar(.28, .07, -.12, 0, -.7); bar(.28, .07, .12, 0, .7); }
  else if (status === 'held') { bar(.35, .08, 0, .1); bar(.35, .08, 0, -.1); }
  else bar(.42, .08, 0, 0);
  const geometry = mergeGeometries(parts); for (const part of parts) part.dispose(); return geometry;
}

// Mesh-level palettes rather than instanceColor: the software renderer supports
// instancing and vertex colour but deliberately does not read instanceColor.
class Batches {
  constructor(root) { this.root = root; this.meshes = new Map(); }
  begin() { for (const mesh of this.meshes.values()) mesh.userData.used = 0; }
  put(key, geometry, material, matrix, label = null) {
    let mesh = this.meshes.get(key);
    const used = mesh?.userData.used ?? 0;
    if (!mesh || used >= mesh.instanceMatrix.count) {
      const capacity = mesh ? mesh.instanceMatrix.count * 2 : 16;
      const next = new T.InstancedMesh(geometry, material, capacity);
      next.instanceMatrix.setUsage(T.DynamicDrawUsage); next.frustumCulled = false;
      next.name = `lattice:${key}`; next.userData.objective = true; next.userData.noCameraOcclusion = true;
      next.userData.used = used;
      if (label) { next.userData.label = label; next.userData.labelSize = .23; }
      if (mesh) { next.instanceMatrix.array.set(mesh.instanceMatrix.array); mesh.removeFromParent(); mesh.dispose(); }
      this.root.add(next); this.meshes.set(key, next); mesh = next;
    }
    mesh.setMatrixAt(used, matrix); mesh.userData.used = used + 1;
  }
  finish() {
    for (const mesh of this.meshes.values()) {
      mesh.count = mesh.userData.used; mesh.visible = mesh.count > 0;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }
  }
  clear() { for (const mesh of this.meshes.values()) { mesh.removeFromParent(); mesh.dispose(); } this.meshes.clear(); }
}

/** View-owned lifecycle, with no simulation, DOM UI, collision or model-module
 * dependency. update() accepts local Match or detached network snapshots.
 * Stationary chassis/labels are rebuilt only for roster/placement changes.
 * Live indicators share small global batches; no per-frame geometry/materials. */
export class LatticeWorldAssets {
  constructor({software = false, teamColor = team => team === 0 ? '#55d9de' : '#ed8a76'} = {}) {
    this.software = software; this.teamColor = teamColor;
    this.root = new T.Group(); this.root.name = 'lattice-machines'; this.root.userData.objective = true;
    this.resources = new Set(); this.templates = new Map(); this.labels = new Map(); this.materials = new Map();
    this.stationary = new Batches(this.root); this.dynamic = new Batches(this.root);
    this.mounts = new Map(); this.fields = new Map(); this.layoutKey = ''; this.arena = null; this.disposed = false;
    this.pose = new T.Object3D(); this.local = new T.Object3D(); this.matrix = new T.Matrix4(); this.color = new T.Color();
    this.bodyMaterial = this.own(new T.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .68, metalness: .48}));
    this.projectionMaterial = this.own(new T.MeshBasicMaterial({color: '#a1d8da', vertexColors: true, wireframe: true, transparent: true, opacity: .3, depthWrite: false}));
    this.box = this.own(new T.BoxGeometry(1, 1, 1));
    this.shard = this.own(new T.OctahedronGeometry(1, 0));
    this.focus = this.own(new T.RingGeometry(.47, .56, 4).rotateX(-Math.PI / 2));
    this.labelPlane = this.own(new T.PlaneGeometry(1.95, .42));
    this.glyphs = new Map(Object.keys(COLORS).filter(key => !['neutral', 'prime'].includes(key)).map(status => [status, this.own(glyphGeometry(status))]));
  }
  own(resource) { this.resources.add(resource); return resource; }
  material(name) {
    if (!this.materials.has(name)) this.materials.set(name, this.own(new T.MeshBasicMaterial({color: COLORS[name] ?? '#ffffff'})));
    return this.materials.get(name);
  }
  template(kind) {
    if (!this.templates.has(kind)) {
      const template = buildLatticeMachineGeometry(kind, {simple: this.software});
      this.own(template.body); this.own(template.tool); this.templates.set(kind, template);
    }
    return this.templates.get(kind);
  }
  label(kind) {
    if (this.labels.has(kind)) return this.labels.get(kind);
    const text = LATTICE_MACHINE_LABELS[kind];
    let map = null;
    if (!this.software && typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 80;
      const ctx = canvas.getContext?.('2d');
      if (ctx) {
        ctx.fillStyle = '#10222c'; ctx.fillRect(0, 0, 384, 80);
        ctx.strokeStyle = '#b9cfc7'; ctx.lineWidth = 3; ctx.strokeRect(3, 3, 378, 74);
        ctx.fillStyle = '#e3ebe1'; ctx.font = 'bold 45px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 192, 42);
        map = this.own(new T.CanvasTexture(canvas)); map.colorSpace = T.SRGBColorSpace; map.generateMipmaps = false; map.minFilter = T.LinearFilter;
      }
    }
    const material = this.own(new T.MeshBasicMaterial({color: map ? '#ffffff' : '#c9e0d7', map, side: T.DoubleSide}));
    this.labels.set(kind, material); return material;
  }
  mountMatrix(mount) {
    this.pose.position.set(mount.x, mount.y, mount.z); this.pose.rotation.set(0, mount.yaw, 0);
    this.pose.scale.set(mount.scale, mount.scale, mount.depth); this.pose.updateMatrix(); return this.pose.matrix;
  }
  at(mount, x, y, z, sx = 1, sy = 1, sz = 1, rz = 0) {
    this.local.position.set(x, y, z); this.local.rotation.set(0, 0, rz); this.local.scale.set(sx, sy, sz); this.local.updateMatrix();
    return this.matrix.multiplyMatrices(this.mountMatrix(mount), this.local.matrix);
  }
  world(x, y, z, sx = 1, sy = 1, sz = 1) {
    this.local.position.set(x, y, z); this.local.rotation.set(0, 0, 0); this.local.scale.set(sx, sy, sz); this.local.updateMatrix(); return this.local.matrix;
  }
  fieldGeometry(record, arena, prime) {
    const radius = Math.max(.65, record.radius - (prime ? 1.05 : .45));
    const geometry = new T.RingGeometry(Math.max(.1, radius - .12), radius, this.software ? 24 : 48).rotateX(-Math.PI / 2);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const height = arena.terrain?.height?.(record.x + p.getX(i), record.z + p.getZ(i));
      p.setY(i, (Number.isFinite(height) ? height : record.y) - record.y + .085);
    }
    // Segmented field edge means a live ward, never a new solid force wall.
    const indices = Array.from(geometry.index.array).filter((_, i) => Math.floor(i / 6) % 2 === 0);
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return this.own(geometry);
  }
  rebuild(records, arena) {
    this.stationary.clear(); this.dynamic.clear();
    for (const field of this.fields.values()) for (const geometry of Object.values(field)) { geometry.dispose(); this.resources.delete(geometry); }
    this.fields.clear(); this.mounts.clear(); this.stationary.begin();
    const used = [];
    // Interaction bays get first choice of reachable faces. Node machinery may
    // use the rest of the capture court, but every focus stays on its true XYZ.
    const ordered = [...records].sort((a, b) => Number(b.terminal) - Number(a.terminal) || a.key.localeCompare(b.key));
    for (const record of ordered) {
      const mount = latticeMachinePlacement(record, arena, used); used.push(mount); this.mounts.set(record.key, mount);
      const {kind} = record.state, template = this.template(kind), mode = mount.projected ? 'projection' : 'solid';
      this.stationary.put(`body:${kind}:${mode}`, template.body, mount.projected ? this.projectionMaterial : this.bodyMaterial, this.mountMatrix(mount));
      this.stationary.put(`label:${kind}`, this.labelPlane, this.label(kind), this.at(mount, 0, 2.99, .94), LATTICE_MACHINE_LABELS[kind]);
      if (!record.terminal) this.fields.set(record.key, {ward: this.fieldGeometry(record, arena, false), prime: this.fieldGeometry(record, arena, true)});
    }
    this.stationary.finish();
  }
  update(match, arena = {}, {reducedMotion = false} = {}) {
    if (this.disposed) return 0;
    const records = latticeAssetRecords(match, arena).slice(0, MAX_ASSETS);
    const layoutKey = records.map(r => `${r.key}/${r.state.kind}/${r.x}/${r.y}/${r.z}/${r.radius}/${r.reach}`).join('|');
    if (layoutKey !== this.layoutKey || arena !== this.arena) {
      this.rebuild(records, arena); this.layoutKey = layoutKey; this.arena = arena;
    }
    // Palette changes update only two shared materials, including in software.
    for (const team of [0, 1]) this.material(`team${team}`).color.set(this.teamColor(team));
    this.dynamic.begin();
    const time = Number.isFinite(match?.time) ? match.time : 0, reduced = reducedMotion || this.software;
    const focuses = new Set();
    for (const record of records) {
      const state = record.state, mount = this.mounts.get(record.key), {kind} = state;
      const owner = state.owner === null ? 'neutral' : `team${state.owner}`, statusMat = this.material(state.status);
      const mode = mount.projected ? 'projection' : 'solid';
      const tool = latticeToolPose(kind, state, time, reduced);
      this.dynamic.put(`tool:${kind}:${mode}`, this.template(kind).tool, mount.projected ? this.projectionMaterial : this.bodyMaterial,
        this.at(mount, tool.x, tool.y, tool.z, 1, 1, 1, tool.rz));
      // Ownership is separate from activity/contest; amber does not erase team.
      this.dynamic.put(`owner:${owner}`, this.box, this.material(owner), this.at(mount, 0, 2.75, .83, 1.75, .065, .06));
      const bars = state.owner === 1 ? 2 : state.owner === 0 ? 1 : 0;
      for (let i = 0; i < bars; i++) this.dynamic.put(`team-mark:${owner}`, this.box, this.material(owner), this.at(mount, -.98 + i * .14, 2.56, .84, .065, .24, .06));
      this.dynamic.put(`status:${state.status}`, this.glyphs.get(state.status), statusMat, this.at(mount, .77, 2.56, .86, .65, .65, 1));
      this.dynamic.put(`lamp:${state.status}`, this.box, statusMat, this.at(mount, -.72, .42, .79, .12, .12, .05));
      if (state.charge > 0) {
        const tint = state.captureTeam === null ? owner : `team${state.captureTeam}`;
        this.dynamic.put(`charge:${tint}`, this.box, this.material(tint), this.at(mount, -.54 + .65 * state.charge, .42, .79, 1.3 * state.charge, .1, .05));
      }
      // Real, currently collectible shards and actual banked inventory only.
      for (const team of [0, 1]) {
        const tint = `team${team}`, x = team === 0 ? -.43 : .43;
        if (state.shards[team]) this.dynamic.put(`shards:${tint}`, this.shard, this.material(tint), this.at(mount, x, 1.1, .18, .17, .25, .17));
        for (let i = 0; i < clampCount(state.banked[team]); i++) this.dynamic.put(`bank:${tint}`, this.box, this.material(tint), this.at(mount, x, .71 + i * .41, .74, .3, .06, .035));
        if (state.banked[team] > 4) this.dynamic.put(`overflow:${tint}`, this.shard, this.material(tint), this.at(mount, x, 2.4, .75, .065, .065, .065));
      }
      if (state.oracle) this.dynamic.put(`oracle:${owner}`, this.shard, this.material(owner), this.at(mount, 0, 1.62, .1, .14, .14, .14));
      const anchorKey = `${record.x}/${record.y}/${record.z}`;
      if (!focuses.has(anchorKey)) {
        focuses.add(anchorKey);
        this.dynamic.put(`focus:${owner}`, this.focus, this.material(owner), this.world(record.x, record.y + .085, record.z));
      }
      const fields = this.fields.get(record.key);
      if (fields && state.support) this.dynamic.put(`ward:${record.key}`, fields.ward, this.material(owner), this.world(record.x, record.y, record.z));
      if (fields && state.prime) this.dynamic.put(`prime:${record.key}`, fields.prime, this.material('prime'), this.world(record.x, record.y, record.z));
    }
    for (const cargo of latticeCargoRecords(match).slice(0, MAX_ASSETS)) this.dynamic.put(`cargo:team${cargo.team}`, this.shard,
      this.material(`team${cargo.team}`), this.world(cargo.x, cargo.y, cargo.z, .15, .23, .15));
    this.dynamic.finish(); this.root.visible = records.length > 0;
    this.root.userData.assetCount = records.length;
    return records.length;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.root.removeFromParent(); this.stationary.clear(); this.dynamic.clear();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear(); this.templates.clear(); this.labels.clear(); this.materials.clear(); this.fields.clear(); this.mounts.clear();
  }
}

/** Integration seam for ArenaView.updateCocsObjectives, after marker updates.
 * Keep exact capture beacons/boundaries/team marks; replace generic emblems.
 * clearLatticeWorld(view) must run BEFORE generic worldGroup disposal. */
export function updateLatticeWorld(view, match, arena) {
  if (!view.worldGroup) return 0;
  let assets = view.latticeWorldAssets;
  const software = view.renderer?.isSoftware === true;
  if (assets && (assets.software !== software || assets.root.parent !== view.worldGroup)) { assets.dispose(); assets = null; }
  if (!assets) {
    assets = new LatticeWorldAssets({software, teamColor: team => view.objectiveColor(team, arena)});
    view.latticeWorldAssets = assets; view.worldGroup.add(assets.root);
  }
  const count = assets.update(match, arena, {reducedMotion: view.reduced?.() === true});
  for (const [key, marker] of view.objectiveModels ?? []) if (marker.userData.cocsNode && assets.mounts.has(`node:${key}`)) {
    if (marker.userData.emblem) marker.userData.emblem.visible = false;
    marker.scale.setScalar(1);
  }
  return count;
}

export function clearLatticeWorld(view) {
  view.latticeWorldAssets?.dispose(); view.latticeWorldAssets = null;
}
