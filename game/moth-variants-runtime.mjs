// Runtime access to the deterministic material variants generated offline by
// scripts/moth-variants.mjs (MOTH-GRAPHICS-PLAN.md §4.3, §5.1, §11 G2/G3).
//
// This module is pure, dependency-free, has no three.js import and performs no
// I/O, so it is safe in Node tests and server-side rendering. The committed
// data module game/moth-variants.mjs holds base64 RGBA tiles; decoding is lazy
// per kind and cached, and a seed change never re-decodes an identical tile.
//
// Typical consumer shape (variant wins, existing single record is the fallback):
//
//   import { mothVariantFor, mothVariantRecord } from './moth-variants-runtime.mjs';
//   const id = mothVariantFor('metal', panelSeed);       // stable id or null
//   const variant = id ? mothVariantRecord('metal', id) : null;
//   if (variant) use(variant.albedo, variant.roughness);
//   else use(mothSurfaceOverride('metal'));               // existing baked record

import { MOTH_VARIANTS } from './moth-variants.mjs';

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

// registry = { source, cache: Map<kind, Array<record|null>> } or null.
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

// Variant ids for a kind, bounded and never throwing. Unknown kinds return [].
export function mothVariantNames(kind) {
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

// Decoded {width,height,data} pairs, cached per kind. `id` is the variant id
// returned by mothVariantFor/mothVariantNames; a numeric index is also accepted
// for tooling. Returns null when the kind, id or payload is unavailable.
export function mothVariantRecord(kind, id) {
  const reg = ensureRegistry();
  const source = reg.source;
  const list = source && source.kinds && source.kinds[kind];
  if (!Array.isArray(list) || list.length === 0) return null;
  const names = mothVariantNames(kind);
  if (names.length === 0) return null;
  const index = typeof id === 'number' ? Math.trunc(id) : names.indexOf(String(id));
  if (!Number.isInteger(index) || index < 0 || index >= names.length) return null;
  let decoded = reg.cache.get(kind);
  if (!decoded) {
    decoded = new Array(names.length).fill(null);
    for (let i = 0; i < names.length; i++) {
      const albedo = decodeImage(list[i] && list[i].albedo);
      const roughness = decodeImage(list[i] && list[i].roughness);
      decoded[i] = albedo && roughness ? { id: names[i], albedo, roughness } : null;
    }
    reg.cache.set(kind, decoded);
  }
  return decoded[index] ?? null;
}

// Deterministic variant selection from a stable key (number or short string).
// Returns null when the kind has no variants, so callers fall back to the
// existing single baked record for that kind.
export function mothVariantFor(kind, key) {
  const names = mothVariantNames(kind);
  if (names.length === 0) return null;
  return names[hashKey(key) % names.length];
}

export function mothVariantStatus() {
  const reg = ensureRegistry();
  const kinds = mothVariantKinds();
  let variants = 0;
  for (const kind of kinds) variants += mothVariantNames(kind).length;
  return {
    configured: reg.source != null,
    version: reg.source && reg.source.version != null ? reg.source.version : null,
    algorithm: reg.source && typeof reg.source.algorithm === 'string' ? reg.source.algorithm : null,
    kinds,
    variants,
    decodedKinds: [...reg.cache.keys()],
  };
}
