// Runtime access to the deterministic material variants generated offline by
// scripts/moth-variants.mjs (MOTH-GRAPHICS-PLAN.md §4.3, §5.1, §11 G2/G3) and
// to the Moth-baked variant tiles in game/moth-baked.mjs (`textures` bucket,
// read through mothSurfaceOverride in game/moth-assets.mjs).
//
// This module is pure, dependency-free, has no three.js import and performs no
// I/O, so it is safe in Node tests and server-side rendering. The committed
// data module game/moth-variants.mjs holds base64 RGBA tiles; decoding is lazy
// per kind and cached, and a seed change never re-decodes an identical tile.
// Baked variants decode through moth-assets.mjs (one decode per configured
// registry, cached there) and this module only wraps the decoded image, so no
// payload is touched until a caller asks for it.
//
// A kind's variant pool is the generated ids (committed order) followed by the
// baked ids from the fixed MOTH_BAKED_VARIANTS table below, and selection is a
// stable hash over that list. The table is a constant, not a live registry
// read, so the same key resolves to the same id in every process independent
// of clock, RNG or load order; a selected record whose payload is missing or
// malformed resolves to null and callers fall back to the single-record path.
//
// Typical consumer shape (variant wins, existing single record is the fallback):
//
//   import { mothVariantFor, mothVariantRecord } from './moth-variants-runtime.mjs';
//   const id = mothVariantFor('metal', panelSeed);            // stable id or null
//   const variant = id ? mothVariantRecord('metal', id) : null;
//   if (variant?.source === 'baked') use(variant.albedo);     // procedural roughness
//   else if (variant) use(variant.albedo, variant.roughness); // generated pair
//   else use(mothSurfaceOverride('metal'));                   // existing baked record

import { MOTH_VARIANTS } from './moth-variants.mjs';
import { mothSurfaceOverride } from './moth-assets.mjs';

// kind -> baked texture key in game/moth-baked.mjs `textures`. Each listed key
// becomes one variant of that kind, exactly once. Frozen so neither callers nor
// tooling can reorder the pool after import.
export const MOTH_BAKED_VARIANTS = Object.freeze({
  weathered_concrete: Object.freeze(['weathered_concrete-worn', 'weathered_concrete-damp']),
  metal: Object.freeze(['metal-oxide']),
  riveted_armor: Object.freeze(['riveted_armor-scorched']),
  hex_paneling: Object.freeze(['hex_paneling-mottle']),
  rock: Object.freeze(['rock-moss']),
  ice: Object.freeze(['ice-cracked']),
  circuit_board: Object.freeze(['circuit_board-etch']),
  rough_stucco: Object.freeze(['rough_stucco-weathered']),
});

// Selection is bounded: a malformed or hostile data module cannot make a
// caller allocate an unbounded list.
const MAX_VARIANTS_PER_KIND = 16;
const MAX_KINDS = 64;

// Selection hash: FNV-1a 32-bit followed by a Murmur3-style avalanche
// finalizer. Integer-only and identical in Node and browsers: each UTF-16 code
// unit contributes its low and high byte. The avalanche removes the small
// low-bit structure FNV-1a shows for keys that differ in one trailing
// character, so strings, sequential panel ids and short numeric keys select
// the same well-spread variant everywhere, independent of load order, seeds or
// clock.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function keyBytes(key) {
  if (typeof key === 'number') return Number.isFinite(key) ? String(Math.trunc(key)) : '0';
  if (typeof key === 'bigint') return key.toString();
  if (typeof key === 'string') return key;
  if (key == null) return '';
  return String(key);
}

function avalanche(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function hashKey(key) {
  const text = keyBytes(key);
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h ^= code & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
    h ^= (code >>> 8) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return avalanche(h);
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value) return null;
  if (typeof Buffer !== 'undefined') {
    try {
      const buffer = Buffer.from(value, 'base64');
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch {
      return null;
    }
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function decodeImage(record) {
  if (!record || typeof record !== 'object' || typeof record.data !== 'string') return null;
  const width = record.width | 0;
  const height = record.height | 0;
  if (width <= 0 || height <= 0) return null;
  const bytes = decodeBase64(record.data);
  if (!bytes || bytes.length !== width * height * 4) return null;
  return { width, height, data: bytes };
}

// registry = { source, cache: Map<kind, Map<id, record>> } or null.
let registry = null;

function defaultRegistry() {
  return { source: MOTH_VARIANTS, cache: new Map() };
}

function ensureRegistry() {
  if (!registry) registry = defaultRegistry();
  return registry;
}

export function configureMothVariants(data = MOTH_VARIANTS) {
  registry = { source: data && typeof data === 'object' ? data : null, cache: new Map() };
  return mothVariantStatus();
}

export function resetMothVariants() {
  registry = null;
}

export function mothVariantKinds() {
  const source = ensureRegistry().source;
  const kinds = source && source.kinds && typeof source.kinds === 'object' ? Object.keys(source.kinds) : [];
  return kinds.slice(0, MAX_KINDS);
}

// Generated variant ids only, in committed order. Kept internal so the public
// mothVariantNames() can expose the mixed pool without callers having to know
// which half a record came from.
function generatedVariantNames(kind) {
  const source = ensureRegistry().source;
  const list = source && source.kinds && source.kinds[kind];
  if (!Array.isArray(list)) return [];
  const names = [];
  const limit = Math.min(list.length, MAX_VARIANTS_PER_KIND);
  for (let i = 0; i < limit; i++) {
    const id = list[i] && list[i].id;
    if (typeof id === 'string' && id) names.push(id);
  }
  return names;
}

// Baked variant ids for a kind: the fixed table above, in table order. Pure and
// static, so it answers even before game/moth-baked.mjs has landed a record.
export function mothBakedVariantNames(kind) {
  const list = typeof kind === 'string' ? MOTH_BAKED_VARIANTS[kind] : null;
  if (!Array.isArray(list)) return [];
  const names = [];
  const limit = Math.min(list.length, MAX_VARIANTS_PER_KIND);
  for (let i = 0; i < limit; i++) {
    if (typeof list[i] === 'string' && list[i]) names.push(list[i]);
  }
  return names;
}

// Every variant id for a kind: generated ids first (committed order), then
// baked ids (table order). This is the exact pool mothVariantFor() hashes over.
// Unknown kinds return [], and a null variant registry disables the mixed pool
// entirely (generated and baked) so callers fall back to the single-record
// path. Never throws.
export function mothVariantNames(kind) {
  if (ensureRegistry().source == null) return [];
  const names = generatedVariantNames(kind);
  const baked = mothBakedVariantNames(kind);
  if (baked.length === 0) return names;
  return names.concat(baked).slice(0, MAX_VARIANTS_PER_KIND);
}

// Baked payload wrappers, keyed by variant id. A wrapper is reused only while
// moth-assets returns the same decoded image object, so reconfiguring the asset
// registry (tests, hot reload of the bake file) can never serve a stale tile. A
// miss is never cached: the next call retries.
const bakedCache = new Map();

function validBakedImage(image) {
  if (!image || typeof image !== 'object') return null;
  const width = image.width | 0;
  const height = image.height | 0;
  if (width <= 0 || height <= 0) return null;
  const data = image.data;
  if (!data || typeof data.length !== 'number' || data.length !== width * height * 4) return null;
  return { width, height, data };
}

function bakedVariantRecord(id) {
  let override = null;
  try {
    override = mothSurfaceOverride(id);
  } catch {
    override = null;
  }
  const albedo = validBakedImage(override);
  if (!albedo) {
    bakedCache.delete(id);
    return null;
  }
  const cached = bakedCache.get(id);
  if (cached && cached.override === override) return cached.record;
  const record = { source: 'baked', id, albedo };
  bakedCache.set(id, { override, record });
  return record;
}

// Generated records are decoded once per kind and cached by kind; malformed
// entries are dropped. Keyed by id so a malformed entry cannot shift the
// alignment of the ids returned by mothVariantNames().
function generatedVariantRecords(kind) {
  const reg = ensureRegistry();
  let decoded = reg.cache.get(kind);
  if (decoded) return decoded;
  decoded = new Map();
  const source = reg.source;
  const list = source && source.kinds && source.kinds[kind];
  if (Array.isArray(list)) {
    const limit = Math.min(list.length, MAX_VARIANTS_PER_KIND);
    for (let i = 0; i < limit; i++) {
      const entry = list[i];
      const id = entry && entry.id;
      if (typeof id !== 'string' || !id) continue;
      const albedo = decodeImage(entry.albedo);
      const roughness = decodeImage(entry.roughness);
      if (albedo && roughness) decoded.set(id, { source: 'generated', id, albedo, roughness });
    }
  }
  reg.cache.set(kind, decoded);
  return decoded;
}

// Resolve one variant id to its decoded payload. `id` is a combined id from
// mothVariantNames()/mothVariantFor(), or a numeric index into that list.
// Generated variants always carry a paired roughness tile; baked variants only
// carry an albedo (the caller keeps its procedural roughness). Returns null when
// the kind, id or payload is unavailable, so callers can fall back.
export function mothVariantRecord(kind, id) {
  if (ensureRegistry().source == null) return null;
  const names = mothVariantNames(kind);
  if (names.length === 0) return null;
  let resolved = null;
  if (typeof id === 'number') {
    const index = Math.trunc(id);
    if (!Number.isInteger(index) || index < 0 || index >= names.length) return null;
    resolved = names[index];
  } else {
    resolved = String(id);
    if (names.indexOf(resolved) < 0) return null;
  }
  if (mothBakedVariantNames(kind).includes(resolved)) return bakedVariantRecord(resolved);
  return generatedVariantRecords(kind).get(resolved) ?? null;
}

// Deterministic variant selection from a stable key (number or short string).
// The pool is mothVariantNames(kind) in order, so the mapping is identical in
// every process and for the life of a committed data set. Returns null when the
// kind has no variants (or the variant registry is disabled), so callers fall
// back to the existing single baked record for that kind.
export function mothVariantFor(kind, key) {
  const names = mothVariantNames(kind);
  if (names.length === 0) return null;
  return names[hashKey(key) % names.length];
}

export function mothVariantStatus() {
  const reg = ensureRegistry();
  const kinds = mothVariantKinds();
  const bakedKinds = Object.keys(MOTH_BAKED_VARIANTS);
  let variants = 0;
  for (const kind of kinds) variants += mothVariantNames(kind).length;
  let bakedVariants = 0;
  for (const kind of bakedKinds) bakedVariants += mothBakedVariantNames(kind).length;
  return {
    configured: reg.source != null,
    version: reg.source && reg.source.version != null ? reg.source.version : null,
    algorithm: reg.source && typeof reg.source.algorithm === 'string' ? reg.source.algorithm : null,
    kinds,
    variants,
    bakedKinds,
    bakedVariants,
    decodedKinds: [...reg.cache.keys()],
  };
}
