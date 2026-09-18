// Runtime access to the assets baked from Moth Quantum engines.
//
// The heavy lifting (submitting jobs, uploading inputs, decoding files) happens
// offline in scripts/moth-bake.mjs, which writes a compact data module:
// game/moth-baked.mjs. This module is the pure, dependency-free reader the game
// uses at runtime. It holds no three.js import and performs no I/O, so it is
// safe in Node tests and on the server-rendered entry.
//
// Nothing is active until configureMothAssets() runs; without it every accessor
// returns null and the game falls back to its procedural generators.

import { MOTH_BAKED } from './moth-baked.mjs';

let registry = null;

function decodeBase64(value) {
  if (typeof value !== 'string' || !value) return null;
  if (typeof Buffer !== 'undefined') {
    const buffer = Buffer.from(value, 'base64');
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Decoded buffers are cached per registry so repeated material/texture lookups
// do not re-run base64 decoding every frame.
function decodeCache(source) {
  const cache = new Map();
  const image = (bucket, name) => {
    const key = `${bucket}:${name}`;
    if (cache.has(key)) return cache.get(key);
    const record = source[bucket]?.[name];
    if (!record) { cache.set(key, null); return null; }
    const data = decodeBase64(record.data);
    const value = data ? { width: record.width, height: record.height, data, ...(record.equirect ? { equirect: true } : {}) } : null;
    cache.set(key, value);
    return value;
  };
  return {
    image,
    texture(name) { return image('textures', name); },
    normal(name) { return image('normals', name); },
    sky(name) { return image('sky', name); },
    material(name) {
      const key = `material:${name}`;
      if (cache.has(key)) return cache.get(key);
      const record = source.materials?.[name];
      const r = record ? decodeBase64(record.r) : null;
      const t = record ? decodeBase64(record.t) : null;
      const value = r && t ? { size: record.size, r, t } : null;
      cache.set(key, value);
      return value;
    },
    effect(name) {
      const key = `effect:${name}`;
      if (cache.has(key)) return cache.get(key);
      const record = source.effects?.[name];
      const frames = [];
      for (const frame of record?.frames || []) {
        const data = decodeBase64(frame.data);
        if (data) frames.push({ width: frame.width, height: frame.height, data });
      }
      const value = frames.length ? { fps: record.fps ?? 10, frames } : null;
      cache.set(key, value);
      return value;
    },
  };
}

const clone = (value) => (value == null ? value : typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

export function configureMothAssets(data = MOTH_BAKED) {
  registry = data && typeof data === 'object' ? { source: data, decode: decodeCache(data) } : null;
  return mothAssetsStatus();
}

export function resetMothAssets() { registry = null; }

const count = (value) => Object.keys(value || {}).length;

export function mothAssetsStatus() {
  if (!registry) return { active: false, version: null, textures: 0, normals: 0, materials: 0, sky: 0, effects: 0, levels: 0, seeds: 0, motifs: 0, irs: 0, audio: 0, spaces: 0 };
  const source = registry.source;
  return {
    active: true,
    version: source.version ?? null,
    textures: count(source.textures),
    normals: count(source.normals),
    materials: count(source.materials),
    sky: count(source.sky),
    effects: count(source.effects),
    levels: count(source.levels),
    seeds: count(source.seeds),
    motifs: count(source.motifs),
    irs: count(source.irs),
    audio: count(source.audio),
    spaces: count(source.spaces),
  };
}

// A baked albedo tile for a canonical texture kind, or null to use the
// procedural generator. `kind` is expected to already be canonical so this
// module stays independent of textures.mjs. The returned record is the cached
// decode result and is treated as read-only.
export function mothSurfaceOverride(kind) {
  if (!registry || typeof kind !== 'string') return null;
  return registry.decode.texture(kind);
}

export function mothTextureNames() {
  return registry ? Object.keys(registry.source.textures || {}) : [];
}

// A baked normal map for a canonical texture kind, derived offline from a
// quantum-blurred height grid. Read-only, cached per configuration.
export function mothNormalOverride(kind) {
  if (!registry || typeof kind !== 'string') return null;
  return registry.decode.normal(kind);
}

export function mothNormalNames() {
  return registry ? Object.keys(registry.source.normals || {}) : [];
}

// An equirectangular sky/nebula texture.
export function mothSky(name) {
  if (!registry || typeof name !== 'string') return null;
  return registry.decode.sky(name);
}

export function mothSkyNames() {
  return registry ? Object.keys(registry.source.sky || {}) : [];
}

// An animated effect sequence (decoded frame buffers). Read-only.
export function mothEffect(name) {
  if (!registry || typeof name !== 'string') return null;
  return registry.decode.effect(name);
}

export function mothEffectNames() {
  return registry ? Object.keys(registry.source.effects || {}) : [];
}

// A reverb impulse response descriptor: { url, seconds, sampleRate, channels, taps }.
// The WAV is served same-origin from /moth/files; fetch and decodeAudioData it.
export function mothIr(name) {
  if (!registry || typeof name !== 'string') return null;
  const record = registry.source.irs?.[name];
  return record ? clone(record) : null;
}

export function mothIrNames() {
  return registry ? Object.keys(registry.source.irs || {}) : [];
}

// An audio clip descriptor for a bed/stinger/room-tone: { url, seconds,
// sampleRate, channels, loopStart, loopEnd, gain, ... }. The WAV is served
// same-origin from /moth/files; fetch and decodeAudioData it at runtime.
export function mothAudioClip(name) {
  if (!registry || typeof name !== 'string') return null;
  const record = registry.source.audio?.[name];
  return record ? clone(record) : null;
}

export function mothAudioNames() {
  return registry ? Object.keys(registry.source.audio || {}) : [];
}

// A compact echo/tap map: { lattice, sites, depth, seed, count, taps }. Drives
// the delay/feedback space without shipping a WAV.
export function mothEchoMap(name) {
  if (!registry || typeof name !== 'string') return null;
  const record = registry.source.spaces?.[name];
  return record ? clone(record) : null;
}

export function mothEchoMapNames() {
  return registry ? Object.keys(registry.source.spaces || {}) : [];
}

// Reflectance/transmittance LUTs produced by the entanglement shader engine.
// Read-only, cached per configuration.
export function mothMaterialLut(name) {
  if (!registry || typeof name !== 'string') return null;
  return registry.decode.material(name);
}

export function mothMaterialNames() {
  return registry ? Object.keys(registry.source.materials || {}) : [];
}

// A quantum labyrinth graph. Returned as a copy so callers cannot mutate the
// registry, and so successive map builds stay isolated.
export function mothLevel(name) {
  if (!registry || typeof name !== 'string') return null;
  return mothLevelFrom(registry.source, name);
}

// Pure variant that reads a baked data object directly, so modules that run at
// import time (before configureMothAssets) can still resolve a level.
export function mothLevelFrom(data, name) {
  const record = data?.levels?.[name];
  return record ? clone(record) : null;
}

export function mothLevelNames() {
  return registry ? Object.keys(registry.source.levels || {}) : [];
}

// A provably-fair seed record (random bytes plus the entropy witness metadata).
export function mothSeed(name) {
  if (!registry || typeof name !== 'string') return null;
  const record = registry.source.seeds?.[name];
  if (!record) return null;
  const copy = clone(record);
  Object.defineProperty(copy, 'bytes', { value: () => hexToBytes(record.hex), enumerable: false });
  return copy;
}

export function mothSeedNames() {
  return registry ? Object.keys(registry.source.seeds || {}) : [];
}

export function mothMotif(name) {
  if (!registry || typeof name !== 'string') return null;
  const record = registry.source.motifs?.[name];
  return record ? clone(record) : null;
}

export function mothProvenance() {
  return registry ? clone(registry.source.provenance || {}) : null;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]*$/i.test(hex) || hex.length % 2) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
