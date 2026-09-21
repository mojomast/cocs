// Visual fidelity and model construction enhancements for TokenArena.
// Provides material shaders, high-detail attachments, and glowing energy conduit meshes.

import * as T from 'three';
import { CHARACTERS, WEAPONS } from './data.mjs';
import { surfaceTextures as defaultSurfaceTextures } from './textures.mjs';
import {currentAssets} from './effects-fx.mjs';
import {beveledBox,contourGeometry,joinedGeometry,placedGeometry} from './model-geometry.mjs';
import {OPERATOR_ANATOMY,operatorPartGeometry} from './operator-anatomy.mjs';
import {operatorDetailGeometry,OperatorDetailLOD,OPERATOR_DETAIL_DISTANCE} from './operator-detail.mjs';

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


// Authored helmet proportions, not random greebles or palette swaps. Existing
// wing/harness pieces remain attached to the same head/chest/shoulder joints.
export const OPERATOR_FORMS=Object.freeze({
 chatgpt:{name:'Surveyor',width:.184,depth:.174,height:1.00,jaw:.73,power:.86,visor:.064,eyes:'split',cheek:.050},
 claude:{name:'Warden',width:.193,depth:.174,height:1.06,jaw:.88,power:.60,visor:.052,eyes:'bar',cheek:.070},
 grok:{name:'Outrider',width:.151,depth:.182,height:.94,jaw:.58,power:.66,visor:.045,eyes:'mono',cheek:.038},
 meta:{name:'Bulwark',width:.205,depth:.182,height:.91,jaw:.92,power:.57,visor:.056,eyes:'split',cheek:.077},
 gemini:{name:'Duplex',width:.154,depth:.167,height:1.12,jaw:.67,power:.77,visor:.078,eyes:'dual',cheek:.042},
 deepseek:{name:'Bathys',width:.173,depth:.193,height:1.07,jaw:.62,power:.84,visor:.082,eyes:'diver',cheek:.057},
 mistral:{name:'Slipstream',width:.153,depth:.189,height:.93,jaw:.59,power:.70,visor:.046,eyes:'swept',cheek:.038},
 kimi:{name:'Orbital',width:.188,depth:.182,height:1.04,jaw:.76,power:1.00,visor:.106,eyes:'constellation',cheek:.042},
 qwen:{name:'Lamellar',width:.191,depth:.173,height:1.02,jaw:.81,power:.55,visor:.050,eyes:'triple',cheek:.066},
});

// Ten rings per helmet keep the existing 864/216 triangle allocation. The
// silhouettes are independently authored: flat sensor housing, square gorget,
// low wedge, turret, split ceramic crown, pressure can, aerofoil, orb and kabuto.
// [Y, width factor, depth factor, Z offset, X offset, split-crown rise].
const OPERATOR_HEAD_PROFILES={
 chatgpt:[[-.16,0,0],[-.149,.45,.59],[-.11,.66,.81],[-.035,.98,1],[.055,1,1],[.09,1,.97],[.115,.92,.89],[.147,.67,.68],[.15,.66,.67],[.151,0,0]],
 claude:[[-.16,0,0],[-.15,.77,.65],[-.12,.95,.88],[-.035,1,1],[.055,1,1],[.083,.84,.91],[.126,.84,.84],[.165,.81,.78],[.184,.75,.73],[.187,0,0]],
 grok:[[-.15,0,0],[-.141,.27,.61],[-.091,.57,.85],[-.022,.94,1],[.035,1,1],[.065,.96,.96,.008],[.087,.79,.94,.018],[.111,.74,.91,.029],[.124,.64,.70,.035],[.127,0,0,.035]],
 meta:[[-.16,0,0],[-.153,.80,.74],[-.12,.94,.94],[-.035,1,1],[.043,1,1],[.072,1,.99],[.093,.95,.92],[.114,.91,.86],[.12,.90,.85],[.122,0,0]],
 gemini:[[-.16,0,0],[-.149,.40,.64],[-.11,.58,.84],[-.035,.92,1],[.044,.94,1],[.091,.89,.91],[.127,.77,.82,0,0,.018],[.145,.72,.68,0,0,.037],[.147,.66,.62,0,0,.04],[.148,0,0]],
 deepseek:[[-.16,0,0],[-.151,.66,.68],[-.11,.88,.93],[-.035,.92,1],[.06,.92,1],[.112,.91,.99],[.145,.88,.91],[.174,.77,.79],[.185,.50,.58],[.19,0,0]],
 mistral:[[-.16,0,0],[-.148,.28,.60,-.009],[-.10,.54,.87,-.009],[-.035,.95,1],[.035,1,1],[.065,.94,.97,.012],[.082,.79,.92,.024],[.107,.72,.81,.038],[.12,.62,.67,.045],[.124,0,0,.045]],
 kimi:[[-.16,0,0],[-.15,.35,.48],[-.107,.72,.77],[-.035,.98,.99],[.038,1,1],[.082,.94,.94],[.119,.80,.81],[.158,.57,.57],[.18,.31,.32],[.19,0,0]],
 qwen:[[-.16,0,0],[-.151,.62,.61],[-.115,.77,.79],[-.035,.96,1],[.048,1,1],[.086,1,.96],[.106,.83,.83],[.145,.58,.68],[.174,.41,.51],[.19,0,0]],
};

// Visible, assembled operator INCLUDING the held five-draw weapon; neutral team
// markers, shield and flash inactive. Shadow passes are additional submissions.
// Keep these tighter than the existing roster/balance verification gates.
export const OPERATOR_MODEL_BUDGETS=Object.freeze({
 close:Object.freeze({drawObjects:88,triangles:35000}),
 near:Object.freeze({drawObjects:64,triangles:12950}),
 far:Object.freeze({drawObjects:51,triangles:5600}),
 software:Object.freeze({drawObjects:65,triangles:6500}),
});

function operatorGeometry(key,make){const assets=currentAssets();return assets?assets.geometry(`lattice-operator-${key}`,make):make();}
function operatorMaterial(key,make){const assets=currentAssets();return assets?assets.material(`lattice-operator-${key}`,make):make();}

// Identical load-bearing assemblies share buffers across both sides and across
// industrial/suspension chassis; colors continue to belong to the actor.
function anatomyGeometry(id,part,side=1,low=false){
 const limb=['forearm','thigh','shin'].includes(part),family=OPERATOR_ANATOMY[id].limb;
 const sharedId=part==='hand'?'chatgpt':limb&&family==='suspension'?'chatgpt':limb&&family==='industrial'?'meta':id;
 const handed=part==='foreplate'||part==='shinplate'||part==='shoulder';
 return operatorGeometry(`anatomy-${sharedId}-${part}-${handed?side:1}-${low?'far':'near'}`,()=>operatorPartGeometry(sharedId,part,{low,side:handed?side:1}));
}

// Replacements run before GPU upload. Keep cached originals alive for other
// actors; unowned originals can be released once no mesh in this actor uses them.
function replaceOperatorGeometry(robot,node,geometry){
 if(!node?.isMesh)return;
 const previous=node.geometry;node.geometry=geometry;
 if(previous===geometry||currentAssets()?.resources.has(previous))return;
 let used=false;robot.traverse(n=>{if(n.geometry===previous)used=true;});if(!used)previous.dispose();
}

function faceplateGeometry(form,low=false){
 const p=[],uv=[],index=[],segments=low?8:32;
 for(let row=0;row<3;row++)for(let i=0;i<=segments;i++){
  const a=(i/segments-.5)*2.2;
  p.push(Math.sin(a)*form.width*.87,(row/2-.5)*form.visor+.018-Math.abs(Math.sin(a))*.012,-Math.cos(a)*form.depth*.60-form.depth*.48);
  uv.push(i/segments,row/2);
 }
 for(let row=0;row<2;row++)for(let i=0;i<segments;i++){
  const a=row*(segments+1)+i,b=a+segments+1;index.push(a,b,a+1,b,b+1,a+1);
 }
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(index);geo.computeVertexNormals();return geo;
}

function helmetHardware(form,id,low=false){
 const parts=[],plate=(size,p,rotation)=>parts.push(placedGeometry(beveledBox(...size),p,rotation));
 for(const s of [-1,1]){
  // Swept mandibular plates terminate at the visor, leaving a black gasket.
  plate([form.cheek,.103,.104],[s*form.width*.77,-.074,-form.depth*.62],[.16,0,s*.16]);
   const ear=new T.CylinderGeometry(.042,.046,.025,low?8:24);ear.rotateZ(Math.PI/2);ear.translate(s*(form.width+.005),.018,.006);parts.push(ear);
 }
 if(id==='claude'||id==='meta')plate([form.width*1.18,.048,.068],[0,-.135,-form.depth*.61]);
 else if(id==='qwen')for(let i=0;i<3;i++)plate([.15-i*.025,.025,.07],[0,.122+i*.023,-.104+i*.034]);
 else if(id==='mistral')for(const s of [-1,1])plate([.028,.042,.18],[s*.13,.106,.024],[.16,s*.18,0]);
 else if(id==='deepseek')plate([.060,.097,.091],[0,-.09,-.164],[.22,0,0]);
 else if(id==='grok')plate([.044,.047,.19],[.048,.148,.022],[.08,0,-.10]);
 else plate([.11,.033,.075],[0,-.119,-form.depth*.71]);
 return joinedGeometry(parts);
}

function opticGeometry(form,low=false){
 const parts=[],z=-form.depth*1.10;
 const strip=(w,h,x,y,angle=0)=>parts.push(placedGeometry(beveledBox(w,h,.012,.004),[x,y,z],[0,0,angle]));
 const lens=(x,y,r)=>{const g=new T.SphereGeometry(r,low?8:20,low?4:10);g.scale(1,.83,.25);g.translate(x,y,z);parts.push(g);};
 switch(form.eyes){
  case 'dual':lens(-.071,.022,.032);lens(.071,.022,.032);break;
  case 'mono':strip(.142,.016,0,.022,-.08);lens(.093,.016,.021);break;
  case 'bar':strip(.21,.016,0,.02);break;
  case 'diver':strip(.052,.046,-.049,.018);strip(.052,.046,.049,.018);break;
  case 'swept':strip(.093,.017,-.051,.023,.17);strip(.093,.017,.051,.023,-.17);break;
  case 'constellation':lens(0,.022,.027);lens(-.07,.028,.014);lens(.07,.028,.014);break;
  case 'triple':for(const x of [-.067,0,.067])strip(.043,.020,x,.022);break;
  default:strip(.075,.020,-.047,.022);strip(.075,.020,.047,.022);
 }
 return joinedGeometry(parts);
}

function sculptOperator(robot){
 const data=robot.userData,j=data.joints;
 // robotModel's existing signature supplies identity through its immutable hull
 // colour; team recolouring only happens after this construction hook.
 const id=CHARACTERS.find(c=>c.color===data.color)?.id;
 if(!id||!j.head)return;
 const f=OPERATOR_FORMS[id],head=j.head,[shell,visor,eye]=head.children;
 data.operatorIdentity={id,name:f.name,design:OPERATOR_ANATOMY[id].design};head.name=`operator-head-${id}`;
  replaceOperatorGeometry(robot,shell,operatorGeometry(`helmet-${id}`,()=>contourGeometry(
   OPERATOR_HEAD_PROFILES[id].map(([y,w,d,z=0,x=0,crown=0])=>[y*f.height,w*f.width,d*f.depth,z,x,crown*f.height]),
   {segments:48,power:f.power})));
 shell.scale.set(1,1,1);shell.name=`helmet-shell-${id}`;
 replaceOperatorGeometry(robot,visor,operatorGeometry(`visor-${id}`,()=>faceplateGeometry(f)));visor.position.set(0,0,0);visor.scale.set(1,1,1);visor.name='inset-visor';
  replaceOperatorGeometry(robot,eye,operatorGeometry(`optics-${id}`,()=>opticGeometry(f)));eye.position.set(0,0,0);eye.scale.set(1,1,1);eye.name=`optics-${f.eyes}`;
 visor.userData.operatorSurface={id,part:'visor'};eye.userData.operatorSurface={id,part:'optics'};
 const hardware=new T.Mesh(operatorGeometry(`helmet-hardware-${id}`,()=>helmetHardware(f,id)),data.armor);
  hardware.name='helmet-mandible-and-comms';hardware.castShadow=hardware.receiveShadow=true;head.add(hardware);
  hardware.userData.operatorSurface={id,part:'hardware'};
  // The legacy Duplex bubbles otherwise eclipse its actual inset dual optics.
  // Keep the existing status-lamp meshes, but recess them above the eye line.
  if(id==='gemini')for(const node of head.children)if(node.geometry?.type==='SphereGeometry'&&node.geometry.parameters.radius===.055){
   node.scale.set(.22,.30,.18);node.position.set(Math.sign(node.position.x)*.104,.094,-.175);
  }
 // Keep public brow/nub handles, but turn the old floating bubbles into a visor
 // seal and a recessed status lamp. They retain the existing low-detail policy.
 if(data.visor?.brow){
  const brow=data.visor.brow;
  replaceOperatorGeometry(robot,brow,operatorGeometry(`brow-${id}`,()=>beveledBox(f.width*1.58,.026,.041,.009,2)));
  brow.position.set(0,.026+f.visor*.5,-f.depth*.85);brow.scale.set(1,1,1);
 }
 if(data.visor?.nub){data.visor.nub.position.set(0,-.089,-f.depth*.99);data.visor.nub.scale.set(.46,.3,.28);}
  // Every anatomy batch remains on its original joint and keeps the exact
  // team/identity material. No change to grip reach, ragdoll links or hitboxes.
  const part=(node,kind,side=1)=>{
   if(!node?.isMesh)return;
   replaceOperatorGeometry(robot,node,anatomyGeometry(id,kind,side));
   node.scale.set(1,1,1);node.userData.operatorSurface={id,part:kind,side};node.name=`${kind}-${id}`;
  };
  const torso=data.torso,chestShell=j.chest.children.find(n=>n.isMesh&&n.material===data.armor);
   part(torso,'abdomen');part(chestShell,'chest');
   const pelvis=j.hips?.children.find(n=>n.geometry?.type==='SphereGeometry');
   if(pelvis)part(pelvis,'pelvis');
  const emblem=j.chest.children.find(n=>n.isMesh&&n.userData.lodDetail);
  if(emblem){part(emblem,'core');emblem.position.set(0,0,0);}
  const chassis=j.chest.children.find(n=>n.geometry?.type==='BoxGeometry');
  if(chassis){part(chassis,'chassis');chassis.position.set(0,0,0);}
  for(const [jointName,kind] of [['armUpper','arm'],['forearm','forearm'],['legUpper','thigh'],['legLower','shin']])for(const side of ['L','R']){
   const joint=j[`${jointName}${side}`],sign=side==='L'?-1:1;
   for(const n of joint?.children||[]){
    if(n.geometry?.type==='CapsuleGeometry')part(n,kind,sign);
    else if(n.geometry?.type==='BoxGeometry')part(n,kind==='shin'?'shinplate':'foreplate',sign);
   }
  }
   for(const [i,pad] of (data.shoulderPads||[]).entries()){
    const name=pad.name;part(pad,'shoulder',i===0?-1:1);pad.name=name;
    // Small exposed bearings must not reintroduce a common full-width sphere
    // underneath the narrower pauldron and open orbital/suspension shells.
    for(const node of pad.parent.children){
     const radius=node.geometry?.parameters?.radius;
     if(node.geometry?.type!=='SphereGeometry'||(radius!==.13&&radius!==.16))continue;
     const girth={chatgpt:.72,claude:.80,grok:.62,meta:1,gemini:.58,deepseek:.77,mistral:.57,kimi:.45,qwen:.74}[id];
     node.scale.multiplyScalar(girth);
    }
   }
   for(const side of ['L','R']){
    const hip=j[`legUpper${side}`]?.parent;
    for(const node of hip?.children||[])if(node.geometry?.type==='SphereGeometry'&&node.geometry.parameters.radius===.115){
     const girth={chatgpt:.77,claude:.95,grok:.62,meta:1,gemini:.60,deepseek:.91,mistral:.61,kimi:.72,qwen:.90}[id];
     node.scale.multiplyScalar(girth);
    }
   }
   const harness=j.chest.getObjectByName('wing-chest-plate');
   if(harness){const name=harness.name;part(harness,'harness');harness.name=name;}
   for(const side of ['L','R']){
    const pauldron=j.chest.getObjectByName(`wing-pauldron-${side}`);
    if(pauldron){const name=pauldron.name;part(pauldron,'pauldron');pauldron.name=name;}
   }
  for(const side of ['L','R']){
   const foot=j[`foot${side}`]?.children.find(n=>n.isMesh);if(foot){part(foot,'foot');foot.position.y=-.046;}
  }
  // Exposed revolute bearings, rather than toy-like spherical joints. These
  // remain mesh leaves: all shoulder/elbow/hip/knee animation groups are intact.
  const bearings=new Set([j.hips]);
  for(const side of ['L','R'])for(const name of ['armUpper','forearm','legUpper','legLower']){
   const joint=j[`${name}${side}`];if(joint?.parent)bearings.add(joint.parent);
   if(name==='forearm')bearings.add(joint);
  }
  for(const joint of bearings)for(const node of joint?.children||[]){
   const r=node.geometry?.parameters?.radius;
   if(node.geometry?.type!=='SphereGeometry'||r<.075||r>.17)continue;
   replaceOperatorGeometry(robot,node,operatorGeometry(`bearing-${r}`,()=>contourGeometry([
    [-r*.72,0,0],[-r*.72,r*.75,r*.75],[-r*.5,r,r],
    [r*.5,r,r],[r*.72,r*.75,r*.75],[r*.72,0,0],
   ],{segments:12,power:1})));
   node.rotation.z=Math.PI/2;node.name='machined-joint-bearing';
  }
}

// Native Three LOD is evaluated per-camera (including preview cameras) without
// changing view's presentation API. Only mesh leaves are duplicated; animation
// joints, materials, and all public references remain the original objects.
// Hidden low meshes also make uncached preview-resource disposal complete.
function installOperatorLOD(robot){
 const software=robot.children.some(n=>n.userData.blobShadow===true),nodes=[];
 robot.userData.joints.root.traverse(n=>{
   if(!n.isMesh||n.material?.transparent)return;
  // The five-mesh world weapon already has its own deliberately tiny budget.
  for(let p=n;p&&p!==robot;p=p.parent)if(p.userData.weapon)return;
  const p=n.geometry.parameters,type=n.geometry.type;
  let make,key;
   const surface=n.userData.operatorSurface;
   if(surface){
    const {id,part,side=1}=surface;key=`anatomy-${id}-${part}-${side}`;
    if(!['visor','optics','hardware'].includes(part)){nodes.push({node:n,geometry:anatomyGeometry(id,part,side,true)});return;}
    make=()=>part==='visor'?faceplateGeometry(OPERATOR_FORMS[id],true):part==='optics'?opticGeometry(OPERATOR_FORMS[id],true):helmetHardware(OPERATOR_FORMS[id],id,true);
   }
   else if(n.userData.lodDetail&&type!=='BeveledBoxGeometry')return;
   else if(type==='CapsuleGeometry'){key=`capsule-${p.radius}-${p.height}`;make=()=>new T.CapsuleGeometry(p.radius,p.height,2,8);}
   else if(type==='SphereGeometry'&&p.widthSegments>8){key=`sphere-${p.radius}`;make=()=>new T.SphereGeometry(p.radius,8,6);}
   else if(type==='TorusGeometry'){key=`torus-${p.radius}-${p.tube}-${p.arc}`;make=()=>new T.TorusGeometry(p.radius,p.tube,4,12,p.arc);}
   else if(type==='ContourGeometry'){const segments=p.segments<=16?8:12;key=`contour-${JSON.stringify(p.sections)}-${p.power}-${segments}`;make=()=>contourGeometry(p.sections,{segments,power:p.power});}
  else if(type==='BeveledBoxGeometry'&&p.segments>1){key=`bevel-${p.width}-${p.height}-${p.depth}-${p.radius}`;make=()=>beveledBox(p.width,p.height,p.depth,p.radius,1);}
  if(make)nodes.push({node:n,geometry:operatorGeometry(`lod-${key}`,make)});
 });
 const levels=[];
 for(const {node,geometry} of nodes){
  const parent=node.parent,lod=new T.LOD(),low=new T.Mesh(geometry,node.material);
  lod.name=`detail-${node.name||node.geometry.type}`;
  low.name=`distance-${node.name||node.geometry.type}`;
  low.position.copy(node.position);low.quaternion.copy(node.quaternion);low.scale.copy(node.scale);
   low.castShadow=node.castShadow;low.receiveShadow=node.receiveShadow;
   // The presentation detail switch targets the wrapper; native LOD owns leaf
   // visibility. This prevents detail updates accidentally enabling both levels.
   if(node.userData.lodDetail){lod.userData.lodDetail=true;delete node.userData.lodDetail;}
  parent.add(lod);lod.addLevel(node,0);lod.addLevel(low,18,.15);
  // SoftwareRenderer does not process Three LOD: start and stay on its low mesh.
  lod.autoUpdate=!software;node.visible=!software;low.visible=software;
  levels.push(lod);
 }
  robot.userData.modelLOD={distance:18,hysteresis:.15,levels,software};
}

function installPrecisionAssemblies(robot){
 const data=robot.userData,id=data.operatorIdentity.id,j=data.joints;
 // Keep the software path's geometry working set unchanged. These sub-pixel
 // fasteners and recesses are a close-range WebGL tier, not gameplay geometry.
 if(data.modelLOD.software)return;
 const material=operatorMaterial('precision-metal',()=>new T.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.43,metalness:.62}));
 const accent=CHARACTERS.find(c=>c.id===id)?.accent??'#91b5b2';
 const details=[];
 const mount=(parent,part,side=1,position=null,rotation=null)=>{
  if(!parent)return;
  const geometry=operatorGeometry(`precision-${id}-${part}-${side}`,()=>operatorDetailGeometry(id,part,{side,form:OPERATOR_FORMS[id],accent}));
  const mesh=new T.Mesh(geometry,material),lod=new OperatorDetailLOD(),empty=new T.Group();
  mesh.name=`precision-${part}`;mesh.castShadow=false;mesh.receiveShadow=true;
  lod.name=`close-detail-${part}`;lod.userData.operatorPrecision=true;
  if(position)lod.position.fromArray(position);if(rotation)lod.rotation.fromArray(rotation);
  lod.addLevel(mesh,0);lod.addLevel(empty,OPERATOR_DETAIL_DISTANCE,.15);
  // Construction is camera-independent. The first render selects the tier.
  mesh.visible=false;empty.visible=false;parent.add(lod);details.push(lod);
 };
 mount(j.head,'head');mount(j.chest,'chest');mount(data.torso,'waist');
 mount(data.backpack,'back',1,[0,0,.085],[0,Math.PI,0]);
 for(const [i,pad] of data.shoulderPads.entries())mount(pad,'shoulder',i===0?-1:1);
 for(const side of ['L','R']){
  const sign=side==='L'?-1:1;
  for(const [joint,part] of [['armUpper','arm'],['forearm','forearm'],['legUpper','thigh'],['legLower','shin']]){
   const node=j[`${joint}${side}`]?.getObjectByName(`${part}-${id}`);
   mount(node,part,sign);
   if(part==='forearm'||part==='shin')mount(j[`${joint}${side}`]?.getObjectByName(`${part==='shin'?'shinplate':'foreplate'}-${id}`),'guard',sign);
  }
  const foot=j[`foot${side}`]?.getObjectByName(`foot-${id}`);mount(foot,'foot',sign);
  mount(data.characterRefinement[`hand${side}`],'hand',sign);
 }
 data.modelLOD.closeDetails=details;data.modelLOD.closeDistance=OPERATOR_DETAIL_DISTANCE;
}

// Character-only geometry pass. Invoke once after robotModel installs joints.
// Invoke once after robotModel installs userData.joints, before first animation.
export function refineOperatorCharacter(robot) {
  const data=robot?.userData,j=data?.joints;
  if(!j) return null;
  if(data.characterRefinement) return data.characterRefinement;
  sculptOperator(robot);
  if(j.hips) j.hips.position.y=.7835; // .34 thigh + .35 shin + .0935 sole
  if(j.torso) j.torso.position.y=.22;
  if(j.chest) j.chest.position.y=.30;
  if(j.head) j.head.position.y=.28;
  j.contactGait=true;
  // Character-owned carry mount: keep both receiver contacts within arm reach.
  // Aim rotation remains view-owned; weapon geometry/anchors are never rewritten.
  if(data.gunAnchor) { data.gunAnchor.position.set(.04,.06,-.08); j.gunAnchor=data.gunAnchor; }
  const plateMaterial=data.armor ?? new T.MeshStandardMaterial({color:'#2c3540'});
  const id=data.operatorIdentity?.id;
  const armor=new T.Mesh(id?anatomyGeometry(id,'sternum'):operatorGeometry('sternum',()=>joinedGeometry([-1,1].map(s=>placedGeometry(beveledBox(.166,.18,.038,.012,2),[s*.085,0,0],[0,s*.12,s*.13])))),plateMaterial);
  if(id)armor.userData.operatorSurface={id,part:'sternum'};
  armor.name='articulated-sternum';armor.position.set(0,-.055,-.19);j.chest?.add(armor);
  const handMaterial=operatorMaterial('glove',()=>new T.MeshStandardMaterial({color:'#18262c',roughness:.65}));
  const palmGeometry=anatomyGeometry('chatgpt','hand');
  const result={armor};
  for(const side of ['L','R']) {
    const fore=j[`forearm${side}`];if(!fore) continue;
    const hand=new T.Group();hand.name=`hand-${side}`;hand.position.set(0,-.275,0);fore.add(hand);
    const palm=new T.Mesh(palmGeometry,handMaterial);palm.userData.operatorSurface={id:'chatgpt',part:'hand'};hand.add(palm);
    const grip=new T.Group();grip.name=`grip-${side}`;grip.position.set(0,-.015,-.055);hand.add(grip);
    result[`hand${side}`]=hand;result[`grip${side}`]=grip;
    j[`hand${side}`]=hand;
  }
  armor.castShadow=armor.receiveShadow=true;
  for(const hand of [result.handL,result.handR])hand?.traverse(n=>{if(n.isMesh)n.castShadow=n.receiveShadow=true;});
  data.characterRefinement=result;
  if(data.operatorIdentity){installOperatorLOD(robot);installPrecisionAssemblies(robot);}
  // Capture the revised proportions as bind transforms, not the old floating rig.
  data.rig?.captureBind();
  return result;
}
