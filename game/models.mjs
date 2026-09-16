// Visual fidelity and model construction enhancements for TokenArena.
// Provides material shaders, high-detail attachments, and glowing energy conduit meshes.

import * as T from 'three';
import { WEAPONS } from './data.mjs';

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
