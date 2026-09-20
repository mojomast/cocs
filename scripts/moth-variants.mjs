#!/usr/bin/env node
// Deterministic, offline material-variant generator for the archived Moth raw
// texture outputs (MOTH-GRAPHICS-PLAN.md §4, §5.1, §6 Experiment A/B, §11 G2/G3).
//
// For each canonical kind it derives three related tiles — `original`, `worn`
// (grime/dust accumulation) and `stained` (corrosion/oxidation/mineral
// staining) — plus a matching small grayscale roughness map per variant. No
// network, no new dependencies, no Math.random / Date.now / performance.now:
// every field comes from a seeded LCG keyed by kind + variant + algorithm
// version, so the generated module is byte-identical across machines.
//
//   node scripts/moth-variants.mjs                     # full run (64px albedo)
//   node scripts/moth-variants.mjs --only metal        # one kind
//   node scripts/moth-variants.mjs --only metal,rock   # comma list
//   node scripts/moth-variants.mjs --size 64           # albedo size (roughness = size/2)
//   node scripts/moth-variants.mjs --out /tmp/x.mjs    # explicit target (tests)
//
// The committed module game/moth-variants.mjs is read at runtime by
// game/moth-variants-runtime.mjs (pure reader, no three.js import).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodePng, clamp } from './moth-bake.mjs';

// Re-exported so offline tooling and tests share one codec reference.
export { decodePng } from './moth-bake.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'assets/moth/manifest.json');
const FILES_DIR = path.join(ROOT, 'public/moth/files');
const DEFAULT_OUT = path.join(ROOT, 'game/moth-variants.mjs');

// Versioned algorithm constant: it is concatenated with every source PNG before
// hashing, so a digest mismatch is visible whenever either the bytes or the
// recipe version changes.
export const ALGORITHM = 'moth-variants/1';
export const VERSION = 1;
export const DEFAULT_SIZE = 64;
export const MIN_SIZE = 16;
export const MODULE_BUDGET_BYTES = 600 * 1024;

// The first bounded slice from the plan: one structural metal family, one
// concrete floor family, one natural rock family, one riveted structural family.
export const KINDS = ['metal', 'weathered_concrete', 'rock', 'riveted_armor'];

// Per-kind art parameters. `protect` is the share of the wear budget held back
// on structural pixels (seams, bolts, panel edges, markings); `structural`
// kinds derive a stronger protection mask from local contrast so wear lands on
// flat paint instead of erasing the construction.
const KIND_PARAMS = {
  metal: {
    structural: true,
    protect: 0.85,
    grime: { dark: 20, dust: 12, desat: 0.45 },
    stain: { amount: 0.55, color: [126, 80, 44] },
    tint: 6,
    rough: { base: 0.42, contrast: 0.26, grime: 0.22, stain: 0.32, noise: 0.06 },
  },
  weathered_concrete: {
    structural: false,
    protect: 0.45,
    grime: { dark: 22, dust: 13, desat: 0.35 },
    stain: { amount: 0.38, color: [146, 138, 118] },
    tint: 6,
    rough: { base: 0.8, contrast: 0.1, grime: 0.14, stain: 0.16, noise: 0.06 },
  },
  rock: {
    structural: false,
    protect: 0.4,
    grime: { dark: 16, dust: 11, desat: 0.3 },
    stain: { amount: 0.4, color: [96, 72, 46] },
    tint: 6,
    rough: { base: 0.86, contrast: 0.1, grime: 0.12, stain: 0.14, noise: 0.06 },
  },
  riveted_armor: {
    structural: true,
    protect: 0.88,
    grime: { dark: 14, dust: 9, desat: 0.4 },
    stain: { amount: 0.5, color: [140, 86, 44] },
    tint: 5,
    rough: { base: 0.5, contrast: 0.3, grime: 0.18, stain: 0.3, noise: 0.06 },
  },
};

// Uniform variant ids keep the runtime selector switchable; axis meaning is
// documented here and in the generated header.
export const VARIANT_IDS = ['original', 'worn', 'stained'];

// ---------------------------------------------------------------------------
// Deterministic primitives (no Math.random, no clock)
// ---------------------------------------------------------------------------

export function fnv1a32(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    h ^= code & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (code >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function lcg(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
}

const smooth = (t) => t * t * (3 - 2 * t);

function smoothstep(lo, hi, value) {
  if (hi <= lo) return value >= hi ? 1 : 0;
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return smooth(t);
}

function percentile(values, p) {
  const sorted = Float32Array.from(values);
  sorted.sort();
  return sorted[clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1)];
}

// Wrapped value noise: the lattice wraps at `cells`, so the field is exactly
// periodic over the image and never introduces a seam.
export function valueNoise(size, cells, seed, octaves = 3) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(2, cells << o);
    const rnd = lcg((seed + Math.imul(o, 0x9e3779b9)) >>> 0);
    const grid = new Float32Array(c * c);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd() / 4294967296;
    for (let y = 0; y < size; y++) {
      const fy = (y * c) / size;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const ry0 = y0 % c;
      const ry1 = (ry0 + 1) % c;
      for (let x = 0; x < size; x++) {
        const fx = (x * c) / size;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const rx0 = x0 % c;
        const rx1 = (rx0 + 1) % c;
        const v00 = grid[ry0 * c + rx0];
        const v10 = grid[ry0 * c + rx1];
        const v01 = grid[ry1 * c + rx0];
        const v11 = grid[ry1 * c + rx1];
        const top = v00 + (v10 - v00) * tx;
        const bottom = v01 + (v11 - v01) * tx;
        out[y * size + x] += (top + (bottom - top) * ty) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function boxBlurWrap(src, size, radius) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = ((y + dy) % size + size) % size;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = ((x + dx) % size + size) % size;
          sum += src[yy * size + xx];
          n++;
        }
      }
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

// Area-average resample with wrap-around reads; works for any integer ratio and
// keeps a tileable source tileable. Exported so tests can build the reference
// seam metric from the same raw bytes the generator used.
export function resampleWrap(src, sw, sh, dw, dh, channels) {
  const out = new Float32Array(dw * dh * channels);
  for (let dy = 0; dy < dh; dy++) {
    const y0 = (dy * sh) / dh;
    const y1 = ((dy + 1) * sh) / dh;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = (dx * sw) / dw;
      const x1 = ((dx + 1) * sw) / dw;
      let acc = [0, 0, 0, 0];
      let wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        const yy = ((sy % sh) + sh) % sh;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const xx = ((sx % sw) + sw) % sw;
          const w = wx * wy;
          const si = (yy * sw + xx) * channels;
          for (let c = 0; c < channels; c++) acc[c] += src[si + c] * w;
          wsum += w;
        }
      }
      const oi = (dy * dw + dx) * channels;
      for (let c = 0; c < channels; c++) out[oi + c] = acc[c] / wsum;
    }
  }
  return out;
}

const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function lumaField(pixels, size, channels = 4) {
  const out = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const o = i * channels;
    out[i] = channels === 1 ? pixels[o] : lumaOf(pixels[o], pixels[o + 1], pixels[o + 2]);
  }
  return out;
}

export function meanLuma(pixels, size, channels = 4) {
  const lum = lumaField(pixels, size, channels);
  let sum = 0;
  for (let i = 0; i < lum.length; i++) sum += lum[i];
  return sum / lum.length;
}

// Documented seam metric (plan §10.2): mean absolute wrap-boundary step
// (column W-1 vs column 0, row H-1 vs row 0) divided by the mean absolute
// interior adjacent-pixel step. A value near the interior gradient means the
// tile wraps as cleanly as it varies inside; a large value marks a hard seam.
export function seamMetric(pixels, size, channels = 4) {
  const lum = lumaField(pixels, size, channels);
  let edge = 0;
  for (let i = 0; i < size; i++) {
    edge += Math.abs(lum[i * size] - lum[i * size + size - 1]);
    edge += Math.abs(lum[i] - lum[(size - 1) * size + i]);
  }
  edge /= 2 * size;
  let interior = 0;
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 1; x++) {
      interior += Math.abs(lum[y * size + x + 1] - lum[y * size + x]);
      n++;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size; x++) {
      interior += Math.abs(lum[(y + 1) * size + x] - lum[y * size + x]);
      n++;
    }
  }
  interior /= n;
  return { edge, interior, ratio: edge / Math.max(interior, 1e-6) };
}

// Pearson correlation of the high-pass (pixel minus 3x3 wrapped blur) signal.
// `<= 0` would mean local contrast has been inverted; the generator only adds
// bounded, same-sign detail, so this stays positive.
export function contrastCorrelation(a, b, size, channels = 4) {
  const la = lumaField(a, size, channels);
  const lb = lumaField(b, size, channels);
  const ha = new Float32Array(size * size);
  const hb = new Float32Array(size * size);
  const blurA = boxBlurWrap(la, size, 1);
  const blurB = boxBlurWrap(lb, size, 1);
  for (let i = 0; i < ha.length; i++) {
    ha[i] = la[i] - blurA[i];
    hb[i] = lb[i] - blurB[i];
  }
  const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
  const ma = mean(ha);
  const mb = mean(hb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ha.length; i++) {
    const da = ha[i] - ma;
    const db = hb[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

// ---------------------------------------------------------------------------
// Source resolution and digests
// ---------------------------------------------------------------------------

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// sha256(archived PNG bytes || algorithm constant). The runtime module and the
// tests can recompute this exactly from the committed raw file.
export function inputDigest(kind, pngBytes) {
  return sha256Hex(Buffer.concat([pngBytes, Buffer.from(`${ALGORITHM}:${kind}`)]));
}

export function readManifest(manifestPath = MANIFEST) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

// Resolve canonical kind -> archived raw directory through the manifest jobs
// (`raw` + `bake.name`), never by guessing directory names.
export function resolveSources({ filesDir = FILES_DIR, manifestPath = MANIFEST, kinds = KINDS } = {}) {
  const manifest = readManifest(manifestPath);
  const byKind = new Map();
  for (const job of manifest.jobs || []) {
    // Only albedo tiles; the same canonical name also has normal-map jobs.
    if (job.bake?.type !== 'texture-tile') continue;
    const name = job.bake?.name || job.bake?.key;
    if (!name || !job.raw) continue;
    if (!byKind.has(name)) byKind.set(name, job.raw);
  }
  const sources = {};
  for (const kind of kinds) {
    const raw = byKind.get(kind);
    if (!raw) throw new Error(`manifest has no texture-tile job baking kind "${kind}"`);
    const rel = path.posix.join('public/moth/files', raw, 'result.png');
    const file = path.join(filesDir, raw, 'result.png');
    if (!fs.existsSync(file)) throw new Error(`archived raw output missing for ${kind}: ${rel}`);
    const bytes = fs.readFileSync(file);
    const decoded = decodePng(bytes);
    sources[kind] = {
      raw,
      file: rel,
      bytes,
      width: decoded.width,
      height: decoded.height,
      digest: inputDigest(kind, bytes),
    };
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Variant synthesis
// ---------------------------------------------------------------------------

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function structureMaps(base, size) {
  const lum = lumaField(base, size, 4);
  const grad = new Float32Array(size * size);
  const sat = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) % size + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = ((x - 1) % size + size) % size;
      const xp = (x + 1) % size;
      grad[y * size + x] = Math.abs(lum[y * size + xp] - lum[y * size + xm]) + Math.abs(lum[yp * size + x] - lum[ym * size + x]);
      const o = (y * size + x) * 4;
      const r = base[o];
      const g = base[o + 1];
      const b = base[o + 2];
      sat[y * size + x] = Math.max(r, g, b) - Math.min(r, g, b);
    }
  }
  const gradBlur = boxBlurWrap(grad, size, Math.max(1, Math.round(size / 32)));
  // Relative thresholds: contrast marks seams/bolts, saturation marks rare
  // authored markings (not a whole painted field).
  const cLo = percentile(gradBlur, 0.55);
  const cHi = percentile(gradBlur, 0.92);
  const sLo = percentile(sat, 0.9);
  const sHi = percentile(sat, 0.995);
  const structure = new Float32Array(size * size);
  for (let i = 0; i < structure.length; i++) {
    const byContrast = smoothstep(cLo, cHi, gradBlur[i]);
    const byMarking = smoothstep(sLo, sHi, sat[i]);
    structure[i] = Math.max(byContrast, 0.8 * byMarking);
  }
  return { structure, gradBlur };
}

function generateVariant(base, structure, size, params, kind, variantIndex) {
  const seed = fnv1a32(`${ALGORITHM}:${kind}:${variantIndex}`);
  const nA = valueNoise(size, 2, seed ^ 0x51ed270b, 3);
  const nB = valueNoise(size, 3, seed ^ 0x1b56c4e9, 3);
  const nC = valueNoise(size, 2, (seed + 0x9e3779b9) >>> 0, 3);
  const nD = valueNoise(size, 4, (seed + 0x85ebca6b) >>> 0, 2);
  const nE = valueNoise(size, 3, (seed + 0xc2b2ae35) >>> 0, 2);
  const tintChannels = [0, 1, 2].map((c) => valueNoise(size, 2, (seed + 0x27d4eb2f * (c + 1)) >>> 0, 2));

  // Variant 1 leans on grime/dust, variant 2 on staining; both share fields so
  // albedo and roughness describe the same patches.
  const grimeWeight = variantIndex === 1 ? 1 : 0.55;
  const stainWeight = variantIndex === 1 ? 0.35 : 1;

  const albedo = new Uint8Array(size * size * 4);
  const rough = new Float32Array(size * size);
  const baseMean = meanLuma(base, size, 4);
  const raw = new Float32Array(size * size * 3);

  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    const wear = 1 - params.protect * structure[i];
    const grime = smoothstep(0.42, 0.8, nA[i]) * grimeWeight * wear;
    const dust = smoothstep(0.3, 0.72, nB[i]) * grimeWeight * wear * (1 - grime);
    const stain = smoothstep(0.52, 0.86, nC[i]) * (0.5 + 0.5 * nD[i]) * stainWeight * wear;
    const value = [base[o], base[o + 1], base[o + 2]];
    for (let c = 0; c < 3; c++) {
      let v = value[c];
      v += (params.tint * (tintChannels[c][i] - 0.5));
      v -= params.grime.dark * grime;
      v += params.grime.dust * dust;
      // Dust/grime desaturates slightly; markings keep their chroma because
      // their `wear` is near the floor.
      const l = lumaOf(value[0], value[1], value[2]);
      v += (l - v) * params.grime.desat * (grime + dust) * 0.5;
      v += (params.stain.color[c] - v) * (params.stain.amount * stain);
      raw[i * 3 + c] = v;
    }
    const rBase = params.rough.base + params.rough.contrast * (1 - structure[i] * 0.8);
    rough[i] = clamp(
      rBase +
        params.rough.grime * grime +
        params.rough.stain * stain * stainWeight +
        params.rough.noise * (nE[i] - 0.5) * 2,
      0.08,
      0.98,
    );
  }

  // Brightness guard: mean luminance must stay within ±6% of the source. A
  // positive multiplicative gain plus a small uniform offset cannot invert
  // local contrast (differences keep their sign); the offset is clamped so a
  // pathological source cannot be crushed or blown out.
  let sum = 0;
  for (let i = 0; i < size * size; i++) sum += lumaOf(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]);
  const before = sum / (size * size);
  const gain = clamp(baseMean / Math.max(before, 1e-6), 0.7, 1.4);
  let offset = clamp(baseMean - before * gain, -12, 12);
  const vals = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size * 3; i++) vals[i] = raw[i] * gain + offset;
  // Quantize, measure, and correct the float field by the residual (never by a
  // biased integer shift) until the mean lands inside the ±6% budget.
  let meanAfter = 0;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < size * size; i++) {
      const o = i * 4;
      for (let c = 0; c < 3; c++) albedo[o + c] = clamp(Math.round(vals[i * 3 + c]), 0, 255);
      albedo[o + 3] = 255;
    }
    meanAfter = meanLuma(albedo, size);
    if (Math.abs(meanAfter - baseMean) / Math.max(baseMean, 1e-6) <= 0.04) break;
    const shift = clamp(baseMean - meanAfter, -8, 8);
    for (let i = 0; i < size * size * 3; i++) vals[i] += shift;
  }
  return { albedo, rough, gain, offset, meanBefore: before, meanAfter };
}

function quantizeRoughness(rough, size, outSize) {
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i++) field[i] = rough[i];
  const small = resampleWrap(field, size, size, outSize, outSize, 1);
  const out = new Uint8Array(outSize * outSize * 4);
  for (let i = 0; i < outSize * outSize; i++) {
    const v = clamp(Math.round(small[i] * 255), 0, 255);
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function generateKind(kind, { size = DEFAULT_SIZE, source } = {}) {
  const params = KIND_PARAMS[kind];
  if (!params) throw new Error(`unknown kind "${kind}" (known: ${KINDS.join(', ')})`);
  if (!source) throw new Error(`generateKind needs a resolved source for "${kind}"`);
  const decoded = decodePng(source.bytes);
  const base = resampleWrap(decoded.data, decoded.width, decoded.height, size, size, 4);
  const { structure } = structureMaps(base, size);
  const roughSize = Math.max(MIN_SIZE / 2, Math.round(size / 2));

  const baseAlbedo = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 4; c++) baseAlbedo[i * 4 + c] = clamp(Math.round(base[i * 4 + c]), 0, 255);
  }
  const sourceSeam = seamMetric(base, size);
  const sourceMean = meanLuma(base, size);

  const records = [];
  const summary = [];
  // Variant 0 is the downsampled archived original; the existing single baked
  // record can be used instead at runtime when the selector returns `original`.
  // Its roughness comes from the same structural protection mask so it already
  // pairs with the source albedo.
  const baseRough = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    baseRough[i] = params.rough.base + params.rough.contrast * (1 - structure[i] * 0.8);
  }
  records.push({
    id: VARIANT_IDS[0],
    albedo: { width: size, height: size, data: base64(baseAlbedo) },
    roughness: {
      width: roughSize,
      height: roughSize,
      data: base64(quantizeRoughness(baseRough, size, roughSize)),
    },
  });
  for (let v = 1; v < VARIANT_IDS.length; v++) {
    const { albedo, rough } = generateVariant(base, structure, size, params, kind, v);
    const roughness = quantizeRoughness(rough, size, roughSize);
    const seam = seamMetric(albedo, size);
    const mean = meanLuma(albedo, size);
    summary.push({
      id: VARIANT_IDS[v],
      seam,
      meanDeltaPct: ((mean / Math.max(sourceMean, 1e-6)) - 1) * 100,
      contrastCorr: contrastCorrelation(base, albedo, size),
    });
    records.push({
      id: VARIANT_IDS[v],
      albedo: { width: size, height: size, data: base64(albedo) },
      roughness: { width: roughSize, height: roughSize, data: base64(roughness) },
    });
  }
  return { kind, size, roughSize, records, summary, sourceSeam, sourceMean };
}

// ---------------------------------------------------------------------------
// Module assembly
// ---------------------------------------------------------------------------

const pad7 = (n) => String(n).padStart(7, '0');

export function renderModule(data, { moduleBytes = 0 } = {}) {
  const lines = [];
  lines.push('// GENERATED by scripts/moth-variants.mjs — do not edit by hand.');
  lines.push('// Deterministic offline material variants derived from the archived Moth raw outputs.');
  lines.push('// Regenerate: node scripts/moth-variants.mjs [--only <kind>] [--size <px>] [--out <path>]');
  lines.push('//');
  lines.push(`// Algorithm: ${data.algorithm}`);
  lines.push(`// Sizes: albedo ${data.sizes.albedo}x${data.sizes.albedo}, roughness ${data.sizes.roughness}x${data.sizes.roughness} (base64 RGBA, row-major)`);
  lines.push('// Variant ids: original (archived source), worn (grime/dust), stained (corrosion/oxidation/mineral).');
  lines.push('// Source digests are sha256(archived PNG bytes || algorithm constant):');
  for (const [kind, s] of Object.entries(data.sources)) {
    lines.push(`//   ${kind.padEnd(20)} ${s.digest}  ${s.file}`);
  }
  lines.push(`// Bundle digest: ${data.bundleDigest}`);
  lines.push(`// Byte budget: ${data.budget.limitBytes} bytes; this module: ${pad7(moduleBytes)} bytes`);
  lines.push('');
  lines.push(`export const MOTH_VARIANTS = ${JSON.stringify(data, null, 2)};`);
  return `${lines.join('\n')}\n`;
}

export function buildModule({ only = KINDS, size = DEFAULT_SIZE, filesDir = FILES_DIR, manifestPath = MANIFEST } = {}) {
  const kinds = Array.isArray(only) ? only : [only];
  if (kinds.length === 0) throw new Error('at least one kind is required');
  for (const kind of kinds) if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}" (known: ${KINDS.join(', ')})`);
  if (size < MIN_SIZE || size % 2 !== 0 || size > 256) throw new Error(`--size must be an even integer between ${MIN_SIZE} and 256`);
  const sources = resolveSources({ filesDir, manifestPath, kinds });
  const kindRecords = {};
  const summary = [];
  for (const kind of kinds) {
    const generated = generateKind(kind, { size, source: sources[kind] });
    kindRecords[kind] = generated.records;
    const bytes = generated.records.reduce(
      (sum, r) => sum + r.albedo.data.length + r.roughness.data.length,
      0,
    );
    summary.push({
      kind,
      variants: generated.records.length,
      size: generated.size,
      roughSize: generated.roughSize,
      bytes,
      sourceSeam: generated.sourceSeam,
      sourceMean: generated.sourceMean,
      detail: generated.summary,
    });
  }
  const sourceMeta = {};
  for (const kind of kinds) {
    const s = sources[kind];
    sourceMeta[kind] = { digest: s.digest, width: s.width, height: s.height, raw: s.raw, file: s.file };
  }
  const bundleDigest = sha256Hex(Buffer.from([ALGORITHM, ...kinds.map((k) => `${k}:${sourceMeta[k].digest}`)].join('|')));
  const data = {
    version: VERSION,
    algorithm: ALGORITHM,
    generator: 'scripts/moth-variants.mjs',
    sizes: { albedo: size, roughness: Math.max(MIN_SIZE / 2, Math.round(size / 2)) },
    budget: { limitBytes: MODULE_BUDGET_BYTES },
    bundleDigest,
    sources: sourceMeta,
    kinds: kindRecords,
  };
  const placeholder = renderModule(data, { moduleBytes: 0 });
  const placeholderBytes = Buffer.byteLength(placeholder, 'utf8');
  let source = renderModule(data, { moduleBytes: placeholderBytes });
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes !== placeholderBytes) source = renderModule(data, { moduleBytes: bytes });
  const finalBytes = Buffer.byteLength(source, 'utf8');
  if (finalBytes > MODULE_BUDGET_BYTES) {
    throw new Error(
      `generated module is ${finalBytes} bytes, over the ${MODULE_BUDGET_BYTES}-byte budget: ` +
        `lower --size (currently ${size}) or pass --only ${kinds[0]}`,
    );
  }
  return { source, data, summary, bytes: finalBytes };
}

// Atomic write through a same-directory temp file; the temp name is derived
// from the pid and a counter, never from a random source.
let tmpCounter = 0;
export function writeModuleAtomic(target, source) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${tmpCounter++}.tmp`);
  try {
    fs.writeFileSync(tmp, source);
    fs.renameSync(tmp, target);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { only: KINDS, size: DEFAULT_SIZE, out: DEFAULT_OUT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--only') options.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--size') options.size = Number(argv[++i]);
    else if (arg === '--out') options.out = path.resolve(String(argv[++i] || ''));
    else throw new Error(`unknown argument "${arg}" (try --help)`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('usage: node scripts/moth-variants.mjs [--only <kind>[,<kind>]] [--size <px>] [--out <path>]');
    console.log(`kinds: ${KINDS.join(', ')}`);
    return;
  }
  const { source, summary, data, bytes } = buildModule({ only: options.only, size: options.size });
  writeModuleAtomic(options.out, source);
  for (const s of summary) {
    const worn = s.detail.find((v) => v.id === 'worn');
    const stained = s.detail.find((v) => v.id === 'stained');
    const seam = [worn, stained].map((v) => (v ? v.seam.ratio.toFixed(2) : 'n/a')).join('/');
    const mean = [worn, stained].map((v) => (v ? `${v.meanDeltaPct >= 0 ? '+' : ''}${v.meanDeltaPct.toFixed(2)}%` : 'n/a')).join('/');
    const corr = [worn, stained].map((v) => (v ? v.contrastCorr.toFixed(2) : 'n/a')).join('/');
    console.log(
      `${s.kind.padEnd(20)} variants ${s.variants}  albedo ${s.size}px  roughness ${s.roughSize}px  bytes ${String(s.bytes).padStart(7)}` +
        `  seam ${seam} (source ${s.sourceSeam.ratio.toFixed(2)})  mean Δ ${mean}  contrast r ${corr}`,
    );
  }
  console.log(`module ${options.out}  ${bytes} bytes  ${data.bundleDigest.slice(0, 16)}…  algorithm ${data.algorithm}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`moth-variants: ${error.message}`);
    process.exitCode = 1;
  }
}
