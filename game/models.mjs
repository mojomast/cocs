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
          if (mat.normalScale?.set) mat.normalScale.set(normalScale, normalScale);
          else mat.normalScale = new T.Vector2(normalScale, normalScale);
        }
        if (textures.bumpMap) {
          mat.bumpMap = textures.bumpMap;
          mat.bumpScale = normalScale;
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

  // Side exhaust pipes under chassis
  const exhaustMat = new T.MeshStandardMaterial({ color: '#7a8592', metalness: 0.9, roughness: 0.25 });
  for (const sign of [-1, 1]) {
    const pipe = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.45, 8), exhaustMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(sign * 0.92, 0.24, -0.6);
    group.add(pipe);
  }

  // Roof spotlight lightbar mounted over cockpit
  const barMat = new T.MeshStandardMaterial({ color: '#1b2229', metalness: 0.85, roughness: 0.3 });
  const lightbar = new T.Mesh(new T.BoxGeometry(1.2, 0.045, 0.08), barMat);
  lightbar.position.set(0, 1.62, 0.32);
  group.add(lightbar);
  const lampMat = new T.MeshBasicMaterial({ color: '#fff9d6' });
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    const lamp = new T.Mesh(new T.CylinderGeometry(0.032, 0.032, 0.02, 8), lampMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(i * 0.24, 1.62, 0.36);
    group.add(lamp);
  }

  vehicle.add(group);
  return group;
}

// Industrial ventilation shaft / fan duct with slatted housing and rotating impeller fan
export function createIndustrialVentilationShaft(parent, { width = 0.64, height = 0.64, depth = 0.32, color = '#242b33', bladeCount = 5 } = {}) {
  const group = new T.Group();
  group.name = 'ventilation-shaft';

  const frameMat = new T.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.35 });
  const frame = new T.Mesh(new T.BoxGeometry(width, height, depth), frameMat);
  group.add(frame);

  const cavity = new T.Mesh(new T.CylinderGeometry(width * 0.42, width * 0.42, depth + 0.004, 16), new T.MeshBasicMaterial({ color: '#090c0f' }));
  cavity.rotation.x = Math.PI / 2;
  group.add(cavity);

  const hubMat = new T.MeshStandardMaterial({ color: '#3c4856', metalness: 0.9, roughness: 0.2 });
  const hub = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, depth * 0.6, 12), hubMat);
  hub.rotation.x = Math.PI / 2;
  group.add(hub);

  const bladeMat = new T.MeshStandardMaterial({ color: '#4a5768', metalness: 0.85, roughness: 0.3 });
  const bladeGeo = new T.BoxGeometry(width * 0.36, 0.016, depth * 0.3);
  for (let i = 0; i < bladeCount; i++) {
    const blade = new T.Mesh(bladeGeo, bladeMat);
    const angle = (i / bladeCount) * Math.PI * 2;
    blade.position.set(Math.cos(angle) * width * 0.18, Math.sin(angle) * width * 0.18, 0);
    blade.rotation.z = angle;
    blade.rotation.x = 0.45;
    group.add(blade);
  }

  const grillMat = new T.MeshStandardMaterial({ color: '#1a2027', metalness: 0.7, roughness: 0.4 });
  for (let i = -2; i <= 2; i++) {
    const bar = new T.Mesh(new T.BoxGeometry(width * 0.88, 0.018, 0.02), grillMat);
    bar.position.set(0, i * (height * 0.16), depth * 0.51);
    group.add(bar);
  }

  if (parent) parent.add(group);
  return group;
}

// Futuristic holographic emitter pedestal with projecting energy cone
export function createHolographicEmitter(parent, { radius = 0.28, height = 0.08, color = '#57e6cd', beamHeight = 0.65 } = {}) {
  const group = new T.Group();
  group.name = 'holographic-emitter';

  const baseMat = new T.MeshStandardMaterial({ color: '#1e2630', metalness: 0.85, roughness: 0.28 });
  const base = new T.Mesh(new T.CylinderGeometry(radius * 0.88, radius, height, 16), baseMat);
  group.add(base);

  const lensMat = new T.MeshStandardMaterial({
    color: '#ffffff',
    emissive: color,
    emissiveIntensity: 1.2,
    roughness: 0.1,
    metalness: 0.9,
  });
  const lens = new T.Mesh(new T.CylinderGeometry(radius * 0.52, radius * 0.56, height * 0.4, 16), lensMat);
  lens.position.y = height * 0.38;
  group.add(lens);

  const coneGeo = new T.ConeGeometry(radius * 1.35, beamHeight, 16, 1, true);
  coneGeo.translate(0, beamHeight * 0.5, 0);
  const coneMat = new T.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    wireframe: true,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
  });
  const cone = new T.Mesh(coneGeo, coneMat);
  cone.position.y = height * 0.5;
  group.add(cone);

  if (parent) parent.add(group);
  return group;
}

// Heavy reinforced blast bulkhead with hydraulic locking cylinders and hazard trim
export function createReinforcedBulkhead(parent, { width = 1.2, height = 1.8, depth = 0.16, color = '#242d38', hazardTrim = true } = {}) {
  const group = new T.Group();
  group.name = 'reinforced-bulkhead';

  const bodyMat = new T.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.32 });
  const body = new T.Mesh(new T.BoxGeometry(width, height, depth), bodyMat);
  group.add(body);

  const ribMat = new T.MeshStandardMaterial({ color: '#384554', metalness: 0.85, roughness: 0.28 });
  for (const sign of [-1, 1]) {
    const rib = new T.Mesh(new T.BoxGeometry(width * 0.9, 0.04, depth * 0.35), ribMat);
    rib.rotation.z = sign * 0.52;
    rib.position.z = depth * 0.42;
    group.add(rib);
  }

  const pistonMat = new T.MeshStandardMaterial({ color: '#7a8794', metalness: 0.95, roughness: 0.18 });
  for (const sx of [-width * 0.46, width * 0.46]) {
    for (const sy of [-height * 0.3, height * 0.3]) {
      const piston = new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.24, 8), pistonMat);
      piston.position.set(sx, sy, 0);
      group.add(piston);
    }
  }

  if (hazardTrim) {
    const hazardMat = new T.MeshStandardMaterial({ color: '#ffd166', metalness: 0.5, roughness: 0.4 });
    const hazard = new T.Mesh(new T.BoxGeometry(width * 0.94, 0.04, depth + 0.008), hazardMat);
    hazard.position.y = height * 0.45;
    group.add(hazard);
  }

  if (parent) parent.add(group);
  return group;
}

// Biological / chitinous armor plating with luminescent seams
export function createBioArmorPlating(parent, { width = 0.32, height = 0.22, depth = 0.035, color = '#1a332d', glowColor = '#38ffd0', scales = 3 } = {}) {
  const group = new T.Group();
  group.name = 'bio-armor-plating';

  const scaleMat = new T.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.2 });
  const glowMat = new T.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.85 });

  for (let i = 0; i < scales; i++) {
    const sWidth = width * (1.0 - i * 0.12);
    const sHeight = height / scales * 1.35;
    const y = -height * 0.35 + i * (height * 0.65 / scales);
    const z = i * 0.008;

    const scaleMesh = new T.Mesh(new T.BoxGeometry(sWidth, sHeight, depth), scaleMat);
    scaleMesh.position.set(0, y, z);
    scaleMesh.rotation.x = -0.12;
    group.add(scaleMesh);

    const seam = new T.Mesh(new T.BoxGeometry(sWidth * 0.92, 0.008, depth + 0.004), glowMat);
    seam.position.set(0, y + sHeight * 0.42, z + 0.002);
    group.add(seam);
  }

  if (parent) parent.add(group);
  return group;
}

// Enhances an operator robot model with chest chevron plating, actuator pins, and visor lens
export function enhanceOperatorModel(robot, { color = '#57e6cd', accent = '#2c3540' } = {}) {
  if (!robot) return;
  const group = new T.Group();
  group.name = 'operator-enhancements';

  const chestPlateMat = new T.MeshStandardMaterial({ color: accent, metalness: 0.8, roughness: 0.3 });
  const chevron = new T.Mesh(new T.BoxGeometry(0.24, 0.09, 0.035), chestPlateMat);
  chevron.position.set(0, 1.48, -0.22);
  group.add(chevron);

  const chevronTrim = new T.Mesh(new T.BoxGeometry(0.22, 0.012, 0.04), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  chevronTrim.position.set(0, 1.44, -0.22);
  group.add(chevronTrim);

  const pinMat = new T.MeshStandardMaterial({ color: '#8b96a4', metalness: 0.9, roughness: 0.2 });
  const pinGeo = new T.CylinderGeometry(0.018, 0.018, 0.04, 8);
  pinGeo.rotateZ(Math.PI / 2);
  for (const sign of [-1, 1]) {
    const pin = new T.Mesh(pinGeo, pinMat);
    pin.position.set(sign * 0.15, 0.52, 0.02);
    group.add(pin);
  }

  robot.add(group);
  return group;
}

