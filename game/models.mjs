// Visual fidelity and model construction enhancements for TokenArena.
// Provides material shaders, high-detail attachments, and glowing energy conduit meshes.

import * as T from 'three';
import { WEAPONS } from './data.mjs';
import { surfaceTextures as defaultSurfaceTextures } from './textures.mjs';

export const FIDELITY_PRESETS = Object.freeze({
  LOW: { segments: 8, glowIntensity: 0.5, dynamicShadows: false },
  MEDIUM: { segments: 12, glowIntensity: 0.8, dynamicShadows: true },
  HIGH: { segments: 16, glowIntensity: 1.2, dynamicShadows: true },
  ULTRA: { segments: 24, glowIntensity: 1.5, dynamicShadows: true },
});

export function enhanceModelMaterials(object, { emissiveBoost = 0.2, metalness = 0.6, roughness = 0.4 } = {}) {
  if (!object) return;
  object.traverse(node => {
    if (node.isMesh && node.material) {
      const mat = node.material;
      if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
        mat.metalness = metalness;
        mat.roughness = roughness;
        if (mat.emissive && emissiveBoost > 0) {
          mat.emissiveIntensity = (mat.emissiveIntensity || 1) * (1 + emissiveBoost);
        }
      }
    }
  });
}

export function createThrusterExhaust(parent, { color = '#57e6cd', size = 0.08 } = {}) {
  const group = new T.Group();
  group.name = 'thruster-exhaust';

  const coreGeo = new T.ConeGeometry(size * 0.7, size * 2.2, 8);
  coreGeo.rotateX(Math.PI);
  const coreMat = new T.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.9,
  });
  const core = new T.Mesh(coreGeo, coreMat);
  group.add(core);

  const plumeGeo = new T.ConeGeometry(size * 1.3, size * 3.5, 8);
  plumeGeo.rotateX(Math.PI);
  const plumeMat = new T.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    blending: T.AdditiveBlending,
  });
  const plume = new T.Mesh(plumeGeo, plumeMat);
  group.add(plume);

  if (parent) parent.add(group);
  return group;
}

export function createEnergyShieldMesh({ radius = 1.15, color = '#70ffe6', opacity = 0.18 } = {}) {
  const geo = new T.SphereGeometry(radius, 18, 14);
  const mat = new T.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    wireframe: true,
    blending: T.AdditiveBlending,
  });
  return new T.Mesh(geo, mat);
}

// Lazy texture loader helper that works in both bundler and Node environments
let _surfaceTextures = null;
export function registerTextureProvider(fn) {
  _surfaceTextures = fn;
}

function resolveSurfaceTextures() {
  if (_surfaceTextures) return _surfaceTextures;
  if (typeof globalThis !== 'undefined' && globalThis.__tokenarena_textures) {
    return globalThis.__tokenarena_textures;
  }
  return defaultSurfaceTextures;
}

// Applies procedural textures to eligible meshes in a model hierarchy
export function applyProceduralTexturesToModel(object, { kind = 'hex_paneling', seed = 1, repeat = [2, 2], normalScale = 0.4 } = {}) {
  if (!object || typeof document === 'undefined' || !document.createElement) return 0;
  const getTex = resolveSurfaceTextures();
  if (!getTex) return 0;
  const textures = getTex(kind, { seed, repeat });
  if (!textures) return 0;

  let count = 0;
  object.traverse(node => {
    if (node.isMesh && node.material) {
      const mat = node.material;
      if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
        if (textures.map) mat.map = textures.map;
        if (textures.roughnessMap) mat.roughnessMap = textures.roughnessMap;
        if (textures.normalMap) {
          mat.normalMap = textures.normalMap;
          mat.normalScale = new T.Vector2(normalScale, normalScale);
        }
        mat.needsUpdate = true;
        count++;
      }
    }
  });
  return count;
}

// Illuminated energy conduit / power cable along 3D waypoints
export function createGlowingConduit(parent, points = [[0, 0, 0], [0, 0, 0.5]], { color = '#57e6cd', radius = 0.016, segments = 8, glow = true } = {}) {
  const group = new T.Group();
  group.name = 'glowing-conduit';

  if (!points || points.length < 2) return group;
  const curvePoints = points.map(p => Array.isArray(p) ? new T.Vector3(p[0], p[1], p[2]) : new T.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0));
  const curve = new T.CatmullRomCurve3(curvePoints);
  const tubularSegments = Math.max(8, curvePoints.length * 8);

  const coreGeo = new T.TubeGeometry(curve, tubularSegments, radius * 0.7, segments, false);
  const coreMat = new T.MeshStandardMaterial({
    color: '#1a2228',
    emissive: color,
    emissiveIntensity: 0.9,
    roughness: 0.25,
    metalness: 0.8,
  });
  const coreMesh = new T.Mesh(coreGeo, coreMat);
  group.add(coreMesh);

  if (glow) {
    const sheathGeo = new T.TubeGeometry(curve, tubularSegments, radius * 1.35, segments, false);
    const sheathMat = new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      blending: T.AdditiveBlending,
    });
    const sheathMesh = new T.Mesh(sheathGeo, sheathMat);
    group.add(sheathMesh);
  }

  if (parent) parent.add(group);
  return group;
}

// High-detail beveled composite armor plating with corner fasteners
export function createArmorPlatingDetail(parent, { width = 0.22, height = 0.12, depth = 0.024, color = '#2c3540', accentColor = '#57e6cd', bevel = 0.008 } = {}) {
  const group = new T.Group();
  group.name = 'armor-plating';

  const plateMat = new T.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.35 });
  const plateGeo = new T.BoxGeometry(width, height, depth);
  const plateMesh = new T.Mesh(plateGeo, plateMat);
  group.add(plateMesh);

  // Accent edge trim
  if (accentColor) {
    const trimMat = new T.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.85 });
    const trimGeo = new T.BoxGeometry(width * 0.92, 0.006, depth + 0.002);
    const trimMesh = new T.Mesh(trimGeo, trimMat);
    trimMesh.position.y = height * 0.44;
    group.add(trimMesh);
  }

  // Corner hex bolt rivets
  const boltMat = new T.MeshStandardMaterial({ color: '#5a6572', metalness: 0.9, roughness: 0.2 });
  const boltGeo = new T.CylinderGeometry(0.007, 0.007, depth + 0.004, 6);
  boltGeo.rotateX(Math.PI / 2);
  const hx = width * 0.42, hy = height * 0.38;
  for (const sx of [-hx, hx]) {
    for (const sy of [-hy, hy]) {
      const bolt = new T.Mesh(boltGeo, boltMat);
      bolt.position.set(sx, sy, 0);
      group.add(bolt);
    }
  }

  if (parent) parent.add(group);
  return group;
}

// Multi-port compensator / muzzle brake for weapon barrels
export function createWeaponMuzzleBrake(parent, { length = 0.12, radius = 0.038, ports = 4, color = '#1a1f26' } = {}) {
  const group = new T.Group();
  group.name = 'muzzle-brake';

  const bodyMat = new T.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.3 });
  const bodyGeo = new T.CylinderGeometry(radius, radius * 1.05, length, 12);
  bodyGeo.rotateX(Math.PI / 2);
  const bodyMesh = new T.Mesh(bodyGeo, bodyMat);
  group.add(bodyMesh);

  // Machined port cutouts (dark recessed apertures)
  const portMat = new T.MeshBasicMaterial({ color: '#090b0e' });
  const portGeo = new T.BoxGeometry(radius * 2.2, radius * 0.35, length / (ports + 1) * 0.7);
  for (let i = 0; i < ports; i++) {
    const zOffset = -length * 0.35 + (i + 0.5) * (length * 0.7 / ports);
    const port = new T.Mesh(portGeo, portMat);
    port.position.z = zOffset;
    group.add(port);
  }

  if (parent) parent.add(group);
  return group;
}

// Industrial front radiator cooling grill
export function createRadiatorGrill(parent, { width = 0.52, height = 0.24, depth = 0.04, color = '#181e24' } = {}) {
  const group = new T.Group();
  group.name = 'radiator-grill';

  const frameMat = new T.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.4 });
  const frame = new T.Mesh(new T.BoxGeometry(width, height, depth), frameMat);
  group.add(frame);

  // Recessed cavity
  const cavity = new T.Mesh(new T.BoxGeometry(width * 0.9, height * 0.84, depth + 0.002), new T.MeshBasicMaterial({ color: '#0d1014' }));
  group.add(cavity);

  // Slats
  const slatMat = new T.MeshStandardMaterial({ color: '#38424c', metalness: 0.8, roughness: 0.35 });
  const slatGeo = new T.BoxGeometry(width * 0.88, 0.012, depth * 0.8);
  const slatCount = 5;
  for (let i = 0; i < slatCount; i++) {
    const y = -height * 0.32 + (i / (slatCount - 1)) * (height * 0.64);
    const slat = new T.Mesh(slatGeo, slatMat);
    slat.position.set(0, y, depth * 0.2);
    slat.rotation.x = 0.3;
    group.add(slat);
  }

  if (parent) parent.add(group);
  return group;
}

// Enhances a vehicle model with aerodynamic splitter, roll-cage, and radiator details
export function enhanceVehicleModel(vehicle, { preset = FIDELITY_PRESETS.HIGH, color = '#5f6338' } = {}) {
  if (!vehicle) return;
  const group = new T.Group();
  group.name = 'vehicle-enhancements';

  // Front splitter
  const splitterMat = new T.MeshStandardMaterial({ color: '#16191d', metalness: 0.6, roughness: 0.4 });
  const splitter = new T.Mesh(new T.BoxGeometry(1.9, 0.04, 0.38), splitterMat);
  splitter.position.set(0, 0.22, 1.88);
  splitter.name = 'front-splitter';
  group.add(splitter);

  // Radiator grill
  const grill = createRadiatorGrill(null, { width: 0.85, height: 0.32, depth: 0.08 });
  grill.position.set(0, 0.52, 1.76);
  group.add(grill);

  // Roll-cage stabilizer bars over cockpit
  const steelMat = new T.MeshStandardMaterial({ color: '#2a323a', metalness: 0.85, roughness: 0.25 });
  for (const sign of [-1, 1]) {
    const barGeo = new T.CylinderGeometry(0.024, 0.024, 1.45, 8);
    barGeo.rotateX(0.42);
    const bar = new T.Mesh(barGeo, steelMat);
    bar.position.set(sign * 0.55, 1.22, -0.22);
    group.add(bar);
  }

  vehicle.add(group);
  return group;
}

