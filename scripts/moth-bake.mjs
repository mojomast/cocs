#!/usr/bin/env node
// Moth Quantum asset bake pipeline.
//
// Runs the jobs listed in assets/moth/manifest.json against the Moth Atlas API
// (https://api.mothquantum.com), decodes the returned files with zero runtime
// dependencies, and emits a compact, deterministic data module the game can
// consume at runtime: game/moth-baked.mjs.
//
//   MOTH_API_KEY=... node scripts/moth-bake.mjs catalog
//   MOTH_API_KEY=... node scripts/moth-bake.mjs sources
//   MOTH_API_KEY=... node scripts/moth-bake.mjs run [--only <id>] [--force] [--dry]
//   node scripts/moth-bake.mjs repair [--only <id>]   # offline, no key/credits
//
// The API key is read from the environment only; it is never written to disk or
// the emitted module. Baked job ids are recorded back into the manifest so a
// re-run downloads the existing result instead of paying for another run.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.MOTH_API_BASE || 'https://api.mothquantum.com';
const MANIFEST = path.join(ROOT, 'assets/moth/manifest.json');
const FILES_DIR = path.join(ROOT, 'public/moth/files');
const SOURCES_DIR = path.join(ROOT, 'assets/moth/sources');
const MODULE_OUT = path.join(ROOT, 'game/moth-baked.mjs');

const rgba = (name) => name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();

function readKey() {
  const key = (process.env.MOTH_API_KEY || '').trim();
  if (!key) throw new Error('MOTH_API_KEY is not set (create a key at platform.mothquantum.com)');
  return key;
}

async function api(pathname, { method = 'GET', body, key, raw = false, headers = {} } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  if (raw) return { status: res.status, ok: res.ok, text };
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const detail = json?.detail || json?.title || text.slice(0, 200);
    const err = new Error(`${method} ${pathname} -> ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json ?? { status: res.status, ok: res.ok, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listEngines(key) {
  const body = await api('/api/v1/engines', { key });
  return body.engines || body.items || body.data || body;
}
export async function getEngine(key, id) {
  return api(`/api/v1/engines/${encodeURIComponent(id)}`, { key });
}

export async function submitJob(key, engine, { params = {}, inputFiles, mode } = {}) {
  const body = { params };
  if (inputFiles) body.input_files = inputFiles;
  if (mode) body.mode = mode;
  return api(`/api/v1/engines/${encodeURIComponent(engine)}/process`, { method: 'POST', key, body });
}
export async function jobStatus(key, jobId) {
  return api(`/api/v1/jobs/${encodeURIComponent(jobId)}/status`, { key });
}
export async function jobResult(key, jobId) {
  return api(`/api/v1/jobs/${encodeURIComponent(jobId)}/result`, { key });
}

export async function waitForJob(key, jobId, { timeoutMs = 15 * 60 * 1000, intervalMs = 1500, log = () => {} } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const status = await jobStatus(key, jobId);
    const key2 = `${status.status}:${status.progress?.step || ''}`;
    if (key2 !== last) { last = key2; log(`  ${status.status}${status.progress?.step ? ` (${status.progress.step})` : ''}${status.progress?.detail ? ` — ${status.progress.detail}` : ''}`); }
    if (status.status === 'completed') return status;
    if (status.status === 'failed' || status.status === 'cancelled') {
      const err = new Error(`job ${jobId} ${status.status}: ${status.error?.message || status.error?.type || 'unknown error'}`);
      err.status = status.status; err.error = status.error;
      throw err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`job ${jobId} timed out after ${Math.round(timeoutMs / 1000)}s`);
}

// Upload a local file through the create -> presigned PUT -> complete flow and
// return its asset id, which engines consume via `input_files`.
export async function uploadAsset(key, filePath, { contentType } = {}) {
  const bytes = fs.readFileSync(filePath);
  const type = contentType || guessContentType(filePath);
  const created = await api('/api/v1/assets', { method: 'POST', key, body: { filename: path.basename(filePath), content_type: type, size_bytes: bytes.length } });
  const upload = created.upload;
  if (!upload?.url) throw new Error(`asset ${created.asset_id}: no presigned upload returned`);
  const res = await fetch(upload.url, { method: upload.method || 'PUT', headers: upload.headers || {}, body: bytes });
  if (!res.ok) throw new Error(`asset upload -> ${res.status}`);
  await api(`/api/v1/assets/${encodeURIComponent(created.asset_id)}/complete`, { method: 'POST', key, body: {} });
  return created.asset_id;
}

function guessContentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.zip': 'application/zip', '.json': 'application/json', '.wav': 'audio/wav', '.mid': 'audio/midi', '.midi': 'audio/midi', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.bin': 'application/octet-stream', '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr' })[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Decoders (dependency-free)
// ---------------------------------------------------------------------------

export function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`PNG bit depth ${bitDepth} unsupported`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`PNG color type ${colorType} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[row - stride + x - channels] : 0;
      let value;
      if (filter === 0) value = v;
      else if (filter === 1) value = v + a;
      else if (filter === 2) value = v + b;
      else if (filter === 3) value = v + ((a + b) >> 1);
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error(`PNG filter ${filter} unsupported`);
      out[row + x] = value & 255;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (colorType === 0) { r = g = b = out[i]; }
    else if (colorType === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (colorType === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else if (colorType === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    else { const p = out[i]; r = palette[p * 3]; g = palette[p * 3 + 1]; b = palette[p * 3 + 2]; a = trns && p < trns.length ? trns[p] : 255; }
    pixels[i * 4] = r; pixels[i * 4 + 1] = g; pixels[i * 4 + 2] = b; pixels[i * 4 + 3] = a;
  }
  return { width, height, data: pixels };
}

// Minimal PNG encoder (truecolour 8-bit), used only to synthesize source art.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) { const t = Buffer.from(type, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = rgb[y * width * 3 + x]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

export function unzip(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= floor; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: end-of-central-directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(localOffset + 26), localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const comp = buf.subarray(start, start + compSize);
    files.set(name, method === 0 ? Buffer.from(comp) : zlib.inflateRawSync(comp));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// Radiance RGBE (.hdr) decoder. Handles flat and modern RLE scanlines.
export function decodeHdr(buf) {
  let p = 0;
  const readLine = () => { let j = p; while (j < buf.length && buf[j] !== 10) j++; const s = buf.toString('ascii', p, j); p = j + 1; return s; };
  if (!readLine().startsWith('#?')) throw new Error('not a Radiance HDR');
  while (true) { const line = readLine(); if (line === '') break; }
  const dims = readLine().match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!dims) throw new Error('HDR resolution line missing');
  const height = +dims[1], width = +dims[2];
  const data = buf.subarray(p);
  const out = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  const isRle = (o) => width >= 8 && width < 32768 && data[o] === 2 && data[o + 1] === 2 && ((data[o + 2] << 8) | data[o + 3]) === width;
  let off = 0;
  for (let y = 0; y < height; y++) {
    if (isRle(off)) {
      off += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          const count = data[off++];
          if (count > 128) { const val = data[off++]; for (let k = 0; k < count - 128; k++) scan[x++ * 4 + c] = val; }
          else { for (let k = 0; k < count; k++) scan[x++ * 4 + c] = data[off++]; }
        }
      }
    } else {
      for (let i = 0; i < width * 4; i++) scan[i] = data[off++];
    }
    for (let x = 0; x < width; x++) {
      const r = scan[x * 4], g = scan[x * 4 + 1], b = scan[x * 4 + 2], e = scan[x * 4 + 3];
      const idx = (y * width + x) * 3;
      if (e === 0) { out[idx] = out[idx + 1] = out[idx + 2] = 0; }
      else { const f = Math.pow(2, e - 136); out[idx] = r * f; out[idx + 1] = g * f; out[idx + 2] = b * f; }
    }
  }
  return { width, height, data: out };
}

function resizeNearest(data, sw, sh, tw, th, channels) {
  const out = new Uint8Array(tw * th * channels);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = Math.min(sw - 1, Math.floor((x * sw) / tw)), sy = Math.min(sh - 1, Math.floor((y * sh) / th));
    for (let c = 0; c < channels; c++) out[(y * tw + x) * channels + c] = data[(sy * sw + sx) * channels + c];
  }
  return out;
}
function hdrToRgb8(hdr, size) {
  const small = resizeNearest(hdr.data, hdr.width, hdr.height, size, size, 3);
  const out = new Uint8Array(size * size * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(small[i] * 255)));
  return out;
}

// ---------------------------------------------------------------------------
// Bakers: turn a finished job into the compact runtime record
// ---------------------------------------------------------------------------

export const BAKERS = {
  // A quantum-transformed tile, downscaled to a small RGBA texture.
  'texture-tile'(job, ctx) {
    const png = ctx.files.get('result');
    if (!png) throw new Error('texture-tile: no result file');
    const image = decodePng(png);
    const size = ctx.bake.size ?? 48;
    const small = resizeNearest(image.data, image.width, image.height, size, size, 4);
    return { bucket: 'textures', key: ctx.bake.name || job.id, value: { width: size, height: size, data: Buffer.from(small).toString('base64') } };
  },
  // A wide equirectangular sky/nebula texture.
  'sky'(job, ctx) {
    const png = ctx.files.get('result');
    if (!png) throw new Error('sky: no result file');
    const image = decodePng(png);
    const width = ctx.bake.width ?? 256, height = ctx.bake.height ?? 128;
    const small = resizeNearest(image.data, image.width, image.height, width, height, 4);
    return { bucket: 'sky', key: ctx.bake.name || job.id, value: { width, height, data: Buffer.from(small).toString('base64'), equirect: true } };
  },
  // The entanglement shader package: reflectance/transmittance LUTs.
  'material-lut'(job, ctx) {
    const zip = ctx.files.get('result');
    if (!zip) throw new Error('material-lut: no result file');
    const entries = unzip(zip);
    const find = (suffix) => { for (const [name, data] of entries) if (name.toLowerCase().endsWith(suffix)) return data; return null; };
    const r = find('r_lut.hdr'), t = find('t_lut.hdr');
    if (!r || !t) throw new Error('material-lut: R/T LUTs missing from archive');
    const size = ctx.bake.size ?? 24;
    const R = hdrToRgb8(decodeHdr(r), size), T = hdrToRgb8(decodeHdr(t), size);
    return { bucket: 'materials', key: ctx.bake.name || job.id, value: { size, r: Buffer.from(R).toString('base64'), t: Buffer.from(T).toString('base64') } };
  },
  // A normal map derived from a blur-core-v1 height grid (quantum-relaxed
  // macro shape under the original micro detail).
  'normal-map'(job, ctx) {
    const grid = gridOf(ctx.result);
    if (!grid) throw new Error('normal-map: blur-core grid missing');
    const size = ctx.bake.size ?? 32;
    const field = resampleGrid(grid, size, size);
    const normal = gridToNormal(field, size, size, ctx.bake.strength ?? 1.6);
    return { bucket: 'normals', key: ctx.bake.name || job.id, value: { width: size, height: size, data: Buffer.from(normal).toString('base64') } };
  },
  // One frame of an animated effect; frames merge into a single effects entry.
  'effect-frame'(job, ctx) {
    const grid = gridOf(ctx.result);
    if (!grid) throw new Error('effect-frame: blur-core grid missing');
    const size = ctx.bake.size ?? 48;
    const field = resampleGrid(grid, size, size);
    const rgba = gridToRamp(field, size, size, ctx.bake.tint || 'quantum');
    return { bucket: 'effects', key: ctx.bake.name || ctx.bake.effect || job.id, merge: 'frames', index: ctx.bake.index ?? 0, fps: ctx.bake.fps ?? 10, value: { width: size, height: size, data: Buffer.from(rgba).toString('base64') } };
  },
  // A quantum labyrinth graph, flattened into a deterministic room grid.
  'level-graph'(job, ctx) {
    const output = ctx.result?.result?.output || ctx.result?.result;
    if (!output?.grid_size || !output?.coupling_map) throw new Error('level-graph: unexpected result shape');
    const { rows, cols } = output.grid_size;
    const cells = Array.from({ length: rows * cols }, (_, i) => {
      const state = output.initial_states?.[String(i)] || {};
      return { i, x: Math.round((state.X || 0) * 1e4) / 1e4, y: Math.round((state.Y || 0) * 1e4) / 1e4, z: Math.round((state.Z || 0) * 1e4) / 1e4, radiating: state.radiating === true };
    });
    const coupling = (output.coupling_map || []).map(([a, b]) => [a, b]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const measurements = (output.results?.measurements || []).slice(0, 8).map((m) => ({ bits: m.bitstring, probability: Math.round((m.probability || 0) * 1e6) / 1e6 }));
    return {
      bucket: 'levels', key: ctx.bake.name || job.id,
      value: {
        rows, cols, numQubits: output.num_qubits ?? rows * cols, coupling, cells, measurements,
        metrics: {
          szSamp: Math.round((output.metrics?.sz_samp || 0) * 1e6) / 1e6,
          mode: output.metrics?.mode || 'emu',
          backend: output.metrics?.backend || 'aer',
          shots: output.metrics?.shots ?? 0,
        },
      },
    };
  },
  // A provably-fair seed: extracted random bytes plus the verifiable
  // commitment, Bell/CHSH witness and entropy report. The emulator can return
  // zero extractable bytes (the ordering penalty can consume the entropy
  // budget); the certificate is still recorded, with `seed: null`.
  'seed'(job, ctx) {
    const output = ctx.result?.result?.output || ctx.result?.result || {};
    const random = output.random || {};
    const hex = typeof random.hex === 'string' && /^[0-9a-f]+$/i.test(random.hex) ? random.hex.toLowerCase() : '';
    const bell = output.bell_witness && typeof output.bell_witness.S === 'number' ? Math.round(output.bell_witness.S * 1e6) / 1e6 : null;
    const report = output.entropy_report || output.entropy || null;
    const outputBits = report && Number.isFinite(report.output_bits) ? report.output_bits : (random.bytes ? random.bytes * 8 : 0);
    const commitment = output.commitment?.commit || output.pulse?.commitment?.commit || null;
    return {
      bucket: 'seeds', key: ctx.bake.name || job.id,
      value: {
        seed: hex.length >= 8 ? (parseInt(hex.slice(0, 8), 16) >>> 0) : null,
        hex: hex || null,
        bytes: Number.isFinite(random.bytes) ? random.bytes : (hex ? hex.length / 2 : 0),
        bell,
        classicalBound: output.bell_witness?.classical_bound ?? null,
        commitment,
        outputBits,
        backend: output.provenance?.backend ?? null,
        mode: output.provenance?.mode ?? output.mode ?? null,
        certificate: {
          commitment,
          bellWitness: bell,
          classicalBound: output.bell_witness?.classical_bound ?? null,
          outputBits,
          hBit: report && Number.isFinite(report.h_bit) ? report.h_bit : null,
          grade: report?.grade ?? null,
          healthPassed: report?.health_passed ?? null,
        },
      },
    };
  },
  // A reverb impulse response rendered by the retrocausal echo engine. The WAV
  // is served from our own public dir (the Moth download URL is presigned and
  // expires); the tap map rides along for cheap synth reverb fallbacks.
  'ir'(job, ctx) {
    const wav = ctx.files.get('result');
    if (!wav) throw new Error('ir: no result WAV');
    const info = wavInfo(wav);
    // Taps live at `extras.taps` (trajectory) or `extras.tap_map.taps` (media);
    // the recursive extractor finds either. The old shallow read left the
    // shipped `irs.cavern.taps` empty.
    let taps = null;
    const tapBuffer = ctx.files.get('taps') || ctx.files.get('ir');
    if (tapBuffer) {
      const found = tapsFrom(parseMaybeJson(tapBuffer));
      taps = found ? found.slice(0, ctx.bake?.maxTaps ?? 64).map((tap) => compactTap(tap, ctx.bake?.includeZ === true)) : null;
    }
    return {
      bucket: 'irs', key: ctx.bake.name || job.id,
      value: { url: `${ctx.publicDir}/result.wav`, seconds: round(info.seconds), sampleRate: info.sampleRate, channels: info.channels, taps },
    };
  },
  // A WAV clip (ambient bed, stinger, room-tone) decoded, trimmed, resampled and
  // peak-normalised into a descriptor. The game serves the processed WAV from
  // its own public dir and records a URL rather than embedding base64, so a
  // multi-second bed never bloats `game/moth-baked.mjs`; `embed: true` is still
  // available for tiny cues. Loop points are seconds from the start of the final
  // clip; `detectLoop` finds a seam deterministically when none are given.
  'audio-clip'(job, ctx) {
    const type = 'audio-clip';
    const options = ctx.bake ?? {};
    const slot = options.slot ?? 'result';
    const file = ctx.files.get(slot);
    if (!file) throw new Error(`${type}: output slot "${slot}" missing`);
    const decoded = decodeWav(file, { maxChannels: options.maxChannels ?? 8 });
    const sourceSampleRate = decoded.sampleRate;
    const inputFrames = decoded.frames;
    let sampleRate = sourceSampleRate;
    let channels = options.mixdown ? [mixdownChannels(decoded.channelData)] : decoded.channelData;

    const threshold = options.threshold ?? 0.001;
    if (typeof threshold !== 'number' || !(threshold >= 0)) throw new Error(`${type}.threshold must be a non-negative number`);
    const pad = options.pad ?? 0;
    if (typeof pad !== 'number' || !(pad >= 0)) throw new Error(`${type}.pad must be a non-negative number`);
    const explicitStart = options.trimStart == null ? null : Number(options.trimStart);
    const explicitEnd = options.trimEnd == null ? null : Number(options.trimEnd);
    const auto = options.trim === false ? null : autoTrim(decoded.channelData, threshold);
    let start = explicitStart !== null ? Math.round(explicitStart * sampleRate) : auto ? auto.first : 0;
    let end = explicitEnd !== null ? Math.round(explicitEnd * sampleRate) : auto ? auto.last + 1 : inputFrames;
    if (auto && options.trim !== false) {
      const padding = Math.round(pad * sampleRate);
      if (explicitStart === null) start -= padding;
      if (explicitEnd === null) end += padding;
    }
    start = clamp(start, 0, inputFrames);
    end = clamp(end, 0, inputFrames);
    if (end <= start) throw new Error(`${type}: trim range is empty (${start}..${end} of ${inputFrames} frames)`);
    channels = channels.map((channel) => channel.subarray(start, end));

    const userGain = options.gain == null ? 1 : Number(options.gain);
    if (!Number.isFinite(userGain) || userGain < 0) throw new Error(`${type}.gain must be a non-negative number`);
    channels = applyGain(channels, userGain);

    const targetSampleRate = options.targetSampleRate == null ? null : Number(options.targetSampleRate);
    if (targetSampleRate !== null) {
      if (!(targetSampleRate > 0)) throw new Error(`${type}.targetSampleRate must be a positive number`);
      channels = resampleLinear(channels, sampleRate, targetSampleRate);
      sampleRate = targetSampleRate;
    }
    const maxSeconds = options.maxSeconds == null ? null : Number(options.maxSeconds);
    if (maxSeconds !== null) {
      if (!(maxSeconds > 0)) throw new Error(`${type}.maxSeconds must be a positive number`);
      channels = limitFrames(channels, Math.max(1, Math.round(maxSeconds * sampleRate)));
    }
    const frames = channels[0].length;
    const seconds = frames / sampleRate;

    let loopStart = options.loopStart == null ? null : Number(options.loopStart);
    let loopEnd = options.loopEnd == null ? null : Number(options.loopEnd);
    let loopScore = null;
    if (loopStart === null && loopEnd === null && options.detectLoop) {
      const detected = detectLoop(channels, sampleRate, {
        searchSeconds: options.loopSearch == null ? undefined : Number(options.loopSearch),
        windowSeconds: options.loopWindow == null ? undefined : Number(options.loopWindow),
        threshold: options.loopThreshold == null ? undefined : Number(options.loopThreshold),
      });
      loopStart = detected.loopStart;
      loopEnd = detected.loopEnd;
      loopScore = detected.score;
    }
    if (loopStart !== null && (loopStart < 0 || loopStart > seconds)) throw new Error(`${type}.loopStart ${loopStart} is outside the clip (0..${round(seconds)})`);
    if (loopEnd !== null && (loopEnd < 0 || loopEnd > seconds)) throw new Error(`${type}.loopEnd ${loopEnd} is outside the clip (0..${round(seconds)})`);
    if (loopStart !== null && loopEnd !== null && loopStart >= loopEnd) throw new Error(`${type}.loopStart ${loopStart} must be less than loopEnd ${loopEnd}`);
    const loopCrossfade = options.loopCrossfade == null ? null : Number(options.loopCrossfade);
    if (loopCrossfade !== null && loopCrossfade > 0) {
      if (loopEnd === null) throw new Error(`${type}.loopCrossfade needs a loop window (set loopStart/loopEnd or detectLoop: true)`);
      channels = crossfadeAtSeam(channels, Math.round((loopStart ?? 0) * sampleRate), Math.round(loopEnd * sampleRate), Math.round(loopCrossfade * sampleRate));
    }

    const peak = peakOf(channels);
    const target = options.peak == null ? 1 : Number(options.peak);
    const preset = options.normalize === false || peak === 0 ? 1 : target / peak;
    channels = scaleChannels(channels, preset);
    const sampleFormat = options.sampleFormat ?? 'pcm16';
    if (!SAMPLE_FORMATS.has(sampleFormat)) throw new Error(`${type}.sampleFormat "${sampleFormat}" unsupported`);

    const fileName = typeof options.file === 'string' ? options.file : 'clip.wav';
    const value = {
      container: 'wav',
      format: sampleFormat.startsWith('float') ? 'float' : 'pcm',
      sampleFormat,
      sampleRate,
      channels: channels.length,
      frames,
      seconds: round(seconds),
      loopStart,
      loopEnd,
      gain: round(userGain * preset),
      peak: round(peak),
    };
    if (loopScore !== null) value.loopScore = loopScore;
    if (userGain !== 1) value.userGain = round(userGain);
    value.trimStart = round(start / sourceSampleRate);
    value.trimEnd = round(end / sourceSampleRate);
    if (targetSampleRate !== null) value.targetSampleRate = targetSampleRate;
    value.source = { sampleRate: sourceSampleRate, channels: decoded.channels, bits: decoded.bits, format: decoded.format, frames: inputFrames, seconds: round(inputFrames / sourceSampleRate) };
    const encoded = encodeWav(channels, { sampleRate, format: sampleFormat });
    if (options.embed === true) value.data = encoded.toString('base64');
    else {
      if (!ctx.dir) throw new Error(`${type}: embed:false needs a writeable ctx.dir`);
      fs.mkdirSync(ctx.dir, { recursive: true });
      fs.writeFileSync(path.join(ctx.dir, fileName), encoded);
      value.file = fileName;
    }
    value.url = resolveAudioUrl(options, ctx, fileName);
    if (options.meta != null) value.meta = options.meta;
    return { bucket: options.bucket ?? 'audio', key: options.name ?? job.id, value };
  },
  // A compact tap map reduced from an `otoc-echo`/`retrocausal-echo` envelope.
  // The envelope may arrive inline (`ctx.result`) or as a JSON output slot; taps
  // are read recursively (`extras.taps`, `extras.tap_map.taps`,
  // `data.extras.taps`). The record is small enough to drive a delay/feedback
  // graph or a synthetic reverb without shipping a WAV.
  'echo-map'(job, ctx) {
    const type = 'echo-map';
    const options = ctx.bake ?? {};
    const candidates = [];
    const seen = new Set();
    const push = (slot, value) => {
      if (value === undefined || value === null || seen.has(slot)) return;
      seen.add(slot);
      candidates.push({ slot, value });
    };
    push('result', ctx.result?.result ?? ctx.result);
    if (typeof options.slot === 'string' && ctx.files?.has(options.slot)) push(options.slot, parseMaybeJson(ctx.files.get(options.slot)));
    for (const slot of [options.tapsSlot ?? 'taps', 'ir', 'tap_map']) if (ctx.files?.has(slot)) push(slot, parseMaybeJson(ctx.files.get(slot)));
    if (ctx.files) for (const [slot, buffer] of ctx.files) push(slot, parseMaybeJson(buffer));
    let found = null;
    for (const candidate of candidates) {
      const taps = tapsFrom(candidate.value);
      if (taps && taps.length) { found = { source: candidate, taps }; break; }
    }
    if (!found) throw new Error(`${type}: no tap map found in the result or JSON slots`);
    const maxTaps = options.maxTaps ?? 64;
    if (!Number.isInteger(maxTaps) || maxTaps <= 0) throw new Error(`${type}.maxTaps must be a positive integer`);
    const meta = envelopeMeta(found.source.value);
    const includeZ = options.includeZ === true;
    const value = {
      lattice: meta.lattice,
      sites: meta.sites,
      depth: meta.depth,
      seed: meta.seed,
      count: found.taps.length,
      taps: found.taps.slice(0, maxTaps).map((tap) => compactTap(tap, includeZ)),
      irFile: null,
      irUrl: typeof options.url === 'string' || typeof options.urlBase === 'string' ? resolveAudioUrl(options, ctx, 'result.json') : null,
    };
    if (options.meta != null) value.meta = options.meta;
    return { bucket: options.bucket ?? 'spaces', key: options.name ?? job.id, value };
  },
  // A MIDI motif re-sequenced by the quantum reservoir, flattened to steps.
  'motif'(job, ctx) {
    const midi = ctx.files.get('result');
    if (!midi) throw new Error('motif: no result MIDI');
    const parsed = decodeMidi(midi);
    const sixteenth = (parsed.ppq || 480) / 4;
    const notes = parsed.notes.slice(0, 256).map((note) => ({ step: Math.round(note.step / sixteenth), midi: note.midi, dur: Math.max(1, Math.round(note.dur / sixteenth)), vel: note.vel }));
    return { bucket: 'motifs', key: ctx.bake.name || job.id, value: { bpm: parsed.bpm, ppq: parsed.ppq, notes } };
  },
};

function gridOf(result) {
  const output = result?.result?.output ?? result?.result ?? null;
  return Array.isArray(output) ? output : null;
}
function resampleGrid(grid, width, height) {
  const rows = grid.length, cols = grid[0]?.length || 0;
  const out = new Float64Array(width * height);
  let min = Infinity, max = -Infinity;
  for (const row of grid) for (const value of row) { if (value < min) min = value; if (value > max) max = value; }
  const span = max - min || 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sy = Math.min(rows - 1, Math.floor((y * rows) / height)), sx = Math.min(cols - 1, Math.floor((x * cols) / width));
    out[y * width + x] = (grid[sy][sx] - min) / span;
  }
  return out;
}
function gridToNormal(field, width, height, strength) {
  const rgb = new Uint8Array(width * height * 4);
  const at = (x, y) => field[((y + height) % height) * width + ((x + width) % width)];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const length = Math.hypot(-dx, -dy, 1) || 1;
    const i = (y * width + x) * 4;
    rgb[i] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
    rgb[i + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
    rgb[i + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
    rgb[i + 3] = 255;
  }
  return rgb;
}
function gridToRamp(field, width, height, tint = 'quantum') {
  const ramps = {
    quantum: [[10, 30, 40], [40, 210, 200], [180, 120, 255], [240, 250, 255]],
    ember: [[26, 8, 6], [180, 40, 20], [255, 150, 40], [255, 240, 200]],
    plasma: [[10, 4, 30], [110, 30, 190], [255, 90, 160], [255, 240, 255]],
  };
  const ramp = ramps[tint] || ramps.quantum;
  const rgb = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const t = Math.max(0, Math.min(0.9999, field[i])) * (ramp.length - 1);
    const a = ramp[Math.floor(t)], b = ramp[Math.min(ramp.length - 1, Math.floor(t) + 1)], f = t - Math.floor(t);
    rgb[i * 4] = Math.round(a[0] + (b[0] - a[0]) * f);
    rgb[i * 4 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
    rgb[i * 4 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
    rgb[i * 4 + 3] = 255;
  }
  return rgb;
}
// ---------------------------------------------------------------------------
// WAV codec + audio helpers (ported from the generic mothbake pipeline)
//
// Everything here is dependency-free and deterministic: PCM/float decode into
// normalised float channels, linear resampling is a documented approximation,
// loop detection is an amplitude-aware normalised difference, and the seam
// crossfade is equal-power. The game's `ir`/`audio-clip`/`echo-map` bakers and
// `makeSourceAudio` all share these, mirroring `mothbake/src/decoders/wav.mjs`
// and `mothbake/src/bakers/audio.mjs`.
// ---------------------------------------------------------------------------

const SAMPLE_FORMATS = new Set(['pcm8', 'pcm16', 'pcm24', 'pcm32', 'float32']);
const FORMAT_NAMES = { 1: 'pcm', 3: 'float', 6: 'alaw', 7: 'mulaw', 0xfffe: 'extensible' };
const PCM_BITS = new Set([8, 16, 24, 32]);
const TAP_KEYS = ['taps', 'tap_map', 'ir', 'feedback_taps'];

export const round = (value) => Math.round(value * 1e6) / 1e6;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function asBuffer(buffer) {
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength ?? buffer.length);
}

function parseWav(buffer) {
  const buf = asBuffer(buffer);
  if (buf.length < 44) throw new Error('wav: file too small');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('wav: not a RIFF/WAVE file');
  let offset = 12, formatCode = 1, channels = 1, sampleRate = 44100, bits = 16, blockAlign = 0, dataOffset = -1, dataBytes = 0, sawFmt = false, sawData = false;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.length) throw new Error('wav: truncated fmt chunk');
      formatCode = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      blockAlign = buf.readUInt16LE(body + 12);
      bits = buf.readUInt16LE(body + 14);
      if (formatCode === 0xfffe && size >= 40) formatCode = buf.readUInt16LE(body + 24);
      sawFmt = true;
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.length - body);
      dataOffset = body;
      sawData = true;
    }
    offset += 8 + size + (size % 2);
  }
  if (!sawFmt) throw new Error('wav: fmt chunk missing');
  if (!sawData) throw new Error('wav: data chunk missing');
  if (!channels || !sampleRate) throw new Error('wav: invalid channel count or sample rate');
  const bytesPerSample = Math.max(1, Math.ceil(bits / 8));
  const frameBytes = blockAlign || channels * bytesPerSample;
  return {
    format: FORMAT_NAMES[formatCode] || `code-${formatCode}`,
    formatCode, channels, sampleRate, bits, bytesPerSample, blockAlign: frameBytes, dataOffset, dataBytes,
    frames: Math.floor(dataBytes / frameBytes),
    seconds: dataBytes / Math.max(1, frameBytes * sampleRate),
  };
}

// Container inspection used by the `ir` baker (format, channels, rate, frames).
export function wavInfo(buffer) {
  const info = parseWav(buffer);
  return { format: info.format, channels: info.channels, sampleRate: info.sampleRate, bits: info.bits, dataBytes: info.dataBytes, frames: info.frames, seconds: info.seconds };
}

// Decode PCM (8/16/24/32) or 32-bit float samples into normalised float channels.
export function decodeWav(buffer, options = {}) {
  const { mixdown = false, maxChannels = 8 } = options;
  const info = parseWav(buffer);
  const buf = asBuffer(buffer);
  const { formatCode, bits, channels } = info;
  if (formatCode !== 1 && formatCode !== 3) throw new Error(`wav: format "${info.format}" is not supported (only PCM and 32-bit float)`);
  if (formatCode === 1 && !PCM_BITS.has(bits)) throw new Error(`wav: ${bits}-bit PCM unsupported (expected 8, 16, 24 or 32)`);
  if (formatCode === 3 && bits !== 32) throw new Error(`wav: ${bits}-bit float unsupported (only 32-bit float)`);
  if (channels > maxChannels) throw new Error(`wav: ${channels} channels exceed maxChannels=${maxChannels}`);
  const read = sampleReader(formatCode, bits);
  const channelData = Array.from({ length: channels }, () => new Float32Array(info.frames));
  for (let frame = 0; frame < info.frames; frame++) {
    const base = info.dataOffset + frame * info.blockAlign;
    for (let channel = 0; channel < channels; channel++) channelData[channel][frame] = read(buf, base + channel * info.bytesPerSample);
  }
  const result = { format: formatCode === 1 ? 'pcm' : 'float', sampleRate: info.sampleRate, bits, channels, frames: info.frames, seconds: info.seconds, dataBytes: info.dataBytes, channelData };
  if (mixdown) result.samples = mixdownChannels(channelData);
  return result;
}

function sampleReader(formatCode, bits) {
  if (formatCode === 3) return (buffer, offset) => buffer.readFloatLE(offset);
  if (bits === 8) return (buffer, offset) => (buffer.readUInt8(offset) - 128) / 128;
  if (bits === 16) return (buffer, offset) => buffer.readInt16LE(offset) / 32768;
  if (bits === 24) {
    return (buffer, offset) => {
      const value = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
      return (value & 0x800000 ? value - 0x1000000 : value) / 8388608;
    };
  }
  return (buffer, offset) => buffer.readInt32LE(offset) / 2147483648;
}

export function mixdownChannels(channelData) {
  if (channelData.length === 1) return channelData[0];
  const frames = channelData[0].length;
  const out = new Float32Array(frames);
  for (const channel of channelData) for (let i = 0; i < frames; i++) out[i] += channel[i];
  for (let i = 0; i < frames; i++) out[i] /= channelData.length;
  return out;
}

const ENCODE_BITS = { pcm8: 8, pcm16: 16, pcm24: 24, pcm32: 32, float32: 32 };

export function encodeWav(samples, options = {}) {
  const { sampleRate = 44100, format = 'pcm16' } = options;
  const bits = ENCODE_BITS[format];
  if (!bits) throw new Error(`wav: unknown encode format "${format}" (expected ${[...SAMPLE_FORMATS].join(', ')})`);
  let channelData;
  if (Array.isArray(samples)) channelData = samples;
  else if (ArrayBuffer.isView(samples)) channelData = [samples];
  else channelData = null;
  if (!channelData || !channelData.length) throw new Error('wav: encode needs at least one channel of samples');
  const channels = channelData.length;
  const frames = channelData[0].length;
  for (const channel of channelData) if (channel.length !== frames) throw new Error('wav: encode channels must all have the same length');
  const bytesPerSample = bits / 8;
  const dataBytes = frames * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(format === 'float32' ? 3 : 1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = channelData[channel][frame];
      if (format === 'float32') buffer.writeFloatLE(value, offset);
      else {
        const clamped = clamp(value, -1, 1);
        if (bits === 8) buffer.writeUInt8(Math.round(clamped * 127) + 128, offset);
        else if (bits === 16) buffer.writeInt16LE(Math.round(clamped * 32767), offset);
        else if (bits === 24) {
          const scaled = clamp(Math.round(clamped * 8388607), -8388608, 8388607);
          buffer.writeUInt8(scaled & 0xff, offset);
          buffer.writeUInt8((scaled >> 8) & 0xff, offset + 1);
          buffer.writeUInt8((scaled >> 16) & 0xff, offset + 2);
        } else buffer.writeInt32LE(Math.round(clamped * 2147483647), offset);
      }
      offset += bytesPerSample;
    }
  }
  return buffer;
}

export function applyGain(channelData, gain) {
  if (gain === 1) return channelData;
  return channelData.map((channel) => {
    const scaled = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) scaled[i] = channel[i] * gain;
    return scaled;
  });
}

export function scaleChannels(channelData, gain) {
  if (gain === 1) return channelData;
  return channelData.map((channel) => {
    const scaled = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) scaled[i] = clamp(channel[i] * gain, -1, 1);
    return scaled;
  });
}

export function limitFrames(channelData, maxFrames) {
  if (channelData[0].length <= maxFrames) return channelData;
  return channelData.map((channel) => channel.subarray(0, maxFrames));
}

export function peakOf(channelData) {
  let peak = 0;
  for (const channel of channelData) for (let i = 0; i < channel.length; i++) { const value = Math.abs(channel[i]); if (value > peak) peak = value; }
  return peak;
}

export function autoTrim(channelData, threshold) {
  const frames = channelData[0].length;
  let first = -1, last = -1;
  for (let i = 0; i < frames; i++) {
    let level = 0;
    for (const channel of channelData) { const value = Math.abs(channel[i]); if (value > level) level = value; }
    if (level >= threshold) { if (first < 0) first = i; last = i; }
  }
  return first < 0 ? null : { first, last };
}

export function resampleLinear(channelData, fromRate, toRate) {
  if (fromRate === toRate) return channelData;
  const frames = channelData[0].length;
  const outFrames = Math.max(1, Math.round((frames * toRate) / fromRate));
  if (outFrames === frames) return channelData;
  const last = frames - 1;
  const step = fromRate / toRate;
  return channelData.map((channel) => {
    const out = new Float32Array(outFrames);
    for (let i = 0; i < outFrames; i++) {
      const source = Math.min(i * step, last);
      const i0 = Math.floor(source);
      const i1 = Math.min(i0 + 1, last);
      const t = source - i0;
      out[i] = channel[i0] * (1 - t) + channel[i1] * t;
    }
    return out;
  });
}

// Deterministic loop-seam finder: scores seam continuity with an amplitude-aware
// normalised difference, walking back from the tail and accepting the first
// candidate above `threshold` (so the longest seamless loop wins).
export function detectLoop(channelData, sampleRate, options = {}) {
  const frames = channelData[0].length;
  const windowFrames = Math.max(1, Math.min(Math.round((options.windowSeconds ?? 0.02) * sampleRate), Math.max(1, Math.floor(frames / 2))));
  const searchFrames = Math.max(windowFrames, Math.min(frames, Math.round((options.searchSeconds ?? 1) * sampleRate)));
  const startAt = Math.max(2 * windowFrames, frames - searchFrames);
  const threshold = options.threshold ?? 0.5;
  let best = { end: frames, score: -Infinity };
  for (let end = frames; end >= startAt; end--) {
    let score = 0;
    for (const channel of channelData) {
      let diff = 0, energy = 0;
      for (let i = 0; i < windowFrames; i++) {
        const a = channel[i], b = channel[end - windowFrames + i];
        const delta = a - b;
        diff += delta * delta;
        energy += a * a + b * b;
      }
      score += energy > 0 ? 1 - diff / energy : 1;
    }
    score /= channelData.length;
    if (score > best.score) best = { end, score };
    if (score >= threshold) { best = { end, score }; break; }
  }
  return { loopStart: 0, loopEnd: round(best.end / sampleRate), score: round(Math.max(0, best.score)) };
}

export function crossfadeAtSeam(channelData, loopStartFrame, loopEndFrame, fadeFrames) {
  if (fadeFrames <= 0) return channelData;
  const frames = channelData[0].length;
  if (loopEndFrame + fadeFrames > frames) throw new Error(`audio: loopCrossfade needs ${fadeFrames} frames after loopEnd but only ${frames - loopEndFrame} remain`);
  if (loopStartFrame + fadeFrames > loopEndFrame) throw new Error('audio: loopCrossfade is longer than the loop window');
  return channelData.map((channel) => {
    const out = Float32Array.from(channel);
    for (let i = 0; i < fadeFrames; i++) {
      const angle = ((i + 1) / (fadeFrames + 1)) * (Math.PI / 2);
      out[loopStartFrame + i] = clamp(out[loopStartFrame + i] * Math.sin(angle) + out[loopEndFrame + i] * Math.cos(angle), -1, 1);
    }
    return out;
  });
}

// Recursive tap extractor. Engine envelopes place taps at `extras.taps`
// (trajectory), `extras.tap_map.taps` (media) or `data.extras.taps`, and some
// envelopes carry a numeric `extras.taps` count alongside the real array — so a
// shallow recursive search under known keys is the only robust read.
export function tapsFrom(value) {
  const queue = [[value, 0]];
  const seen = new Set();
  while (queue.length) {
    const [node, depth] = queue.shift();
    if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) continue;
    seen.add(node);
    for (const key of TAP_KEYS) if (Array.isArray(node[key]) && node[key].length) return node[key];
    for (const child of Object.values(node)) if (child && typeof child === 'object' && !Array.isArray(child)) queue.push([child, depth + 1]);
  }
  return null;
}

function firstNumber(...values) { for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) return value; return null; }
function firstString(...values) { for (const value of values) if (typeof value === 'string' && value) return value; return null; }

function envelopeMeta(value) {
  const extras = value?.extras ?? {};
  const spec = extras.spec ?? value?.spec ?? {};
  const params = value?.params ?? {};
  const provenance = value?.provenance ?? {};
  const data = value?.data ?? {};
  return {
    lattice: firstString(spec.lattice, extras.lattice, params.lattice),
    sites: firstNumber(spec.n_sites, extras.n_sites, extras.sites, data.sites, params.n_sites),
    depth: firstNumber(spec.depth, extras.depth, data.steps, params.depth),
    seed: firstNumber(provenance.seed, spec.seed, extras.seed, params.seed),
  };
}

function compactTap(tap, includeZ) {
  const compact = {
    site: round(tap.site),
    depth: round(tap.depth),
    level: round(tap.level),
    polarity: tap.polarity ?? 1,
    fRe: round(tap.F_re ?? tap.f_re ?? 0),
    fIm: round(tap.F_im ?? tap.f_im ?? 0),
  };
  if (typeof tap.x === 'number') compact.x = tap.x;
  if (typeof tap.y === 'number') compact.y = tap.y;
  if (includeZ && typeof tap.z === 'number') compact.z = tap.z;
  if (typeof tap.time_ms === 'number') compact.timeMs = tap.time_ms;
  else if (typeof tap.timeMs === 'number') compact.timeMs = tap.timeMs;
  return compact;
}

function parseMaybeJson(buffer) {
  if (!buffer) return undefined;
  if (typeof buffer === 'object' && !Buffer.isBuffer(buffer)) return buffer;
  try { return JSON.parse(buffer.toString('utf8')); } catch { return undefined; }
}

// Resolve the hosted URL for a processed clip: an explicit `url` template
// ({raw}/{slot}/{file}), `urlBase` plus the job's raw dir, or the job's public
// dir. Mirrors the mothbake `resolveUrl` convention.
export function resolveAudioUrl(options, ctx, fileName) {
  const rawName = ctx.rawName ?? ctx.job?.raw ?? ctx.job?.id ?? '';
  if (typeof options.url === 'string') {
    return options.url
      .replaceAll('{raw}', rawName)
      .replaceAll('{slot}', options.slot ?? 'result')
      .replaceAll('{file}', fileName);
  }
  if (typeof options.urlBase === 'string') return `${options.urlBase.replace(/\/+$/, '')}/${rawName}/${fileName}`;
  return `${ctx.publicDir}/${fileName}`;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function readManifest() {
  if (!fs.existsSync(MANIFEST)) throw new Error(`manifest not found: ${MANIFEST}`);
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}
function writeManifest(manifest) { fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n'); }

async function resolveResult(key, job, log, force = false) {
  // Reuse an already-paid job id when the manifest records one, unless the
  // caller explicitly asked for a fresh submission.
  if (job.jobId && !force) {
    log(`  reusing job ${job.jobId}`);
    const status = await jobStatus(key, job.jobId).catch(() => null);
    if (status?.status === 'completed') return jobResult(key, job.jobId);
  }
  let inputFiles;
  if (job.input) {
    inputFiles = {};
    for (const [slot, rel] of Object.entries(job.input)) {
      const file = path.join(ROOT, 'assets/moth', rel);
      if (!fs.existsSync(file)) throw new Error(`input ${slot} missing: ${file} (run "sources" first)`);
      inputFiles[slot] = await uploadAsset(key, file);
    }
  }
  const params = { ...(job.params || {}) };
  const generated = generateValues(job);
  if (generated) params.values = generated;
  const submitted = await submitJob(key, job.engine, { params, inputFiles, mode: job.mode });
  log(`  submitted ${submitted.job_id}`);
  await waitForJob(key, submitted.job_id, { log });
  job.jobId = submitted.job_id;
  return jobResult(key, submitted.job_id);
}

async function downloadOutputs(result, dir, log) {
  const files = new Map();
  fs.mkdirSync(dir, { recursive: true });
  for (const output of result.outputs || []) {
    const res = await fetch(output.url);
    const buffer = Buffer.from(await res.arrayBuffer());
    files.set(output.slot, buffer);
    const ext = (output.content_type || 'bin').split('/').pop().replace(/[^a-z0-9]/gi, '');
    const target = path.join(dir, `${rgba(output.slot)}.${ext}`);
    fs.writeFileSync(target, buffer);
    log(`  saved ${path.relative(ROOT, target)} (${buffer.length} bytes)`);
  }
  if (result.result !== undefined && result.result !== null) {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result.result, null, 2) + '\n');
  }
  return files;
}

export async function runManifest({ only, force = false, dry = false, strict = false, log = console.error } = {}) {
  const key = dry ? null : readKey();
  const manifest = readManifest();
  const baked = { version: manifest.version || 1, generator: 'scripts/moth-bake.mjs', textures: {}, normals: {}, materials: {}, sky: {}, effects: {}, levels: {}, seeds: {}, motifs: {}, irs: {}, audio: {}, spaces: {}, provenance: {} };
  const failures = [];
  for (const job of manifest.jobs || []) {
    if (job.enabled === false) { log(`- ${job.id}: disabled`); continue; }
    if (only && job.id !== only) continue;
    log(`\n> ${job.id} (${job.engine})`);
    if (dry) { log('  dry run — skipped'); continue; }
    const dir = path.join(FILES_DIR, job.raw || job.id);
    try {
      const result = await resolveResult(key, job, log, force);
      const files = await downloadOutputs(result, dir, log);
      const bake = job.bake;
      if (bake?.type) {
        const baker = BAKERS[bake.type];
        if (!baker) throw new Error(`unknown baker: ${bake.type}`);
        const out = baker(job, { files, result, bake, job, dir, rawName: job.raw || job.id, publicDir: `/moth/files/${job.raw || job.id}` });
        applyBaked(baked, out);
        log(`  baked ${out.bucket}.${out.key}${out.merge === 'frames' ? `[${out.index}]` : ''}`);
      }
      baked.provenance[job.id] = { engine: job.engine, jobId: job.jobId || null, mode: job.mode || job.params?.mode || 'emu', name: bake?.name || null, credits: job.credits ?? null };
    } catch (error) {
      log(`  FAILED: ${error.message}`);
      failures.push({ id: job.id, engine: job.engine, message: error.message });
      if (strict) throw error;
    }
  }
  writeManifest(manifest);
  if (!dry) writeModule(baked);
  if (failures.length) log(`\n${failures.length} job(s) failed: ${failures.map((f) => f.id).join(', ')}`);
  return { baked, failures };
}

function applyBaked(baked, out) {
  const bucket = baked[out.bucket] || (baked[out.bucket] = {});
  if (out.merge === 'frames') {
    const entry = bucket[out.key] || (bucket[out.key] = { fps: out.fps ?? 10, frames: [] });
    entry.fps = out.fps ?? entry.fps;
    entry.frames[out.index ?? 0] = out.value;
    return;
  }
  bucket[out.key] = out.value;
}

function writeModule(baked) {
  for (const effect of Object.values(baked.effects || {})) effect.frames = (effect.frames || []).filter(Boolean);
  const header = `// GENERATED by scripts/moth-bake.mjs — do not edit by hand.\n// Regenerate with: MOTH_API_KEY=... node scripts/moth-bake.mjs run\n// Source engines: Moth Quantum Atlas (https://api.mothquantum.com).\n\n`;
  fs.writeFileSync(MODULE_OUT, `${header}export const MOTH_BAKED = ${JSON.stringify(baked, null, 2)};\n\nexport default MOTH_BAKED;\n`);
  console.log(`wrote ${path.relative(ROOT, MODULE_OUT)}`);
}

// ---------------------------------------------------------------------------
// Offline repair: rebuild the purely local, file-derived records (`ir`,
// `echo-map`, `audio-clip`) from the raw results already committed under
// public/moth/files, without an API call or a credit. This is how the shallow-tap
// bug is fixed for the shipped `irs.cavern` record, how `echo-map` records are
// (re)generated, and how an `audio-clip` descriptor is corrected (for example an
// over-long loop window) without paying for another engine run.
// ---------------------------------------------------------------------------

// Purely local bake types whose inputs are all committed raw files. `audio-clip`
// joins them when `embed:false`: it decodes the downloaded `result.wav`, writes
// the processed clip next to it and records a URL, so a descriptor-only fix
// (e.g. a loop window that overran the real clip length) reparses offline.
const LOCAL_BAKE_TYPES = new Set(['ir', 'echo-map', 'audio-clip']);

// Map whatever the pipeline or an older download named a raw result onto the
// slot keys a baker expects: `result.wav`, `ir.json`/`ir-json`, etc.
export function readLocalResult(dir) {
  const files = new Map();
  let result = null;
  if (!fs.existsSync(dir)) return { files, result };
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;
    if (name === 'result.json') { try { result = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {} continue; }
    if (name === 'result.wav') { files.set('result', fs.readFileSync(full)); continue; }
    if (name.endsWith('.json')) { const slot = name.slice(0, -5); if (slot !== 'result') files.set(slot, fs.readFileSync(full)); continue; }
    if (name.endsWith('-json')) { files.set(name.slice(0, -5), fs.readFileSync(full)); continue; }
    if (name.endsWith('.wav')) { files.set(name.slice(0, -4), fs.readFileSync(full)); continue; }
  }
  return { files, result };
}

// Rebuild the `irs`/`spaces` records for every enabled local-type job that has a
// committed raw dir. Pure over the filesystem; exported for the regression tests.
export function rebuildLocalBakes({ only, filesDir = FILES_DIR, manifest = readManifest(), log = () => {} } = {}) {
  const out = { irs: {}, spaces: {}, audio: {} };
  for (const job of manifest.jobs || []) {
    if (job.enabled === false && job.id !== only) continue;
    if (only && job.id !== only) continue;
    const type = job.bake?.type;
    if (!LOCAL_BAKE_TYPES.has(type)) continue;
    const dir = path.join(filesDir, job.raw || job.id);
    if (!fs.existsSync(dir)) { log(`- ${job.id}: no raw dir, skipped`); continue; }
    const { files, result } = readLocalResult(dir);
    try {
      const record = BAKERS[type](job, { files, result, bake: job.bake, job, dir, rawName: job.raw || job.id, publicDir: `/moth/files/${job.raw || job.id}` });
      out[record.bucket][record.key] = record.value;
      log(`repaired ${record.bucket}.${record.key}`);
    } catch (error) {
      log(`- ${job.id}: ${error.message}`);
    }
  }
  return out;
}

// Patch the generated module in place with a fresh offline rebuild of the local
// records. The module is imported with a cache-busting query so repeated calls
// in one process see the current file.
export async function repairModule({ only, log = () => {} } = {}) {
  const mod = await import(`${pathToFileURL(MODULE_OUT).href}?v=${Date.now()}`);
  const baked = mod.MOTH_BAKED;
  const rebuilt = rebuildLocalBakes({ only, log });
  for (const bucket of ['textures', 'normals', 'materials', 'sky', 'effects', 'levels', 'seeds', 'motifs', 'irs', 'audio', 'spaces']) baked[bucket] ??= {};
  for (const bucket of ['irs', 'spaces', 'audio']) Object.assign(baked[bucket], rebuilt[bucket]);
  writeModule(baked);
  return { baked, rebuilt };
}

// ---------------------------------------------------------------------------
// Deterministic source art (value noise in the house style) for image engines.
// ---------------------------------------------------------------------------

const hash2 = (x, y, seed) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
const smoothStep = (t) => t * t * (3 - 2 * t);
const valueNoise = (x, y, seed) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed); const u = smoothStep(xf), v = smoothStep(yf); return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v; };
const fbm2 = (x, y, seed, octaves = 4) => { let total = 0, amp = 0.5, freq = 1, norm = 0; for (let i = 0; i < octaves; i++) { total += valueNoise(x * freq, y * freq, seed + i * 131) * amp; norm += amp; amp *= 0.5; freq *= 2; } return total / norm; };

const SOURCE_ART = {
  panel: { size: 256, palette: [0.62, 0.66, 0.72], pattern: 'noise', contrast: 0.45 },
  tile: { size: 64, palette: [0.55, 0.6, 0.66], pattern: 'noise', contrast: 0.45 },
  rock: { size: 256, palette: [0.5, 0.46, 0.4], pattern: 'noise', contrast: 0.7 },
  sand: { size: 256, palette: [0.8, 0.71, 0.5], pattern: 'noise', contrast: 0.22 },
  ice: { size: 256, palette: [0.68, 0.82, 0.96], pattern: 'noise', contrast: 0.3 },
  grass: { size: 256, palette: [0.32, 0.5, 0.28], pattern: 'noise', contrast: 0.42 },
  metal: { size: 256, palette: [0.64, 0.67, 0.72], pattern: 'noise', contrast: 0.22 },
  hull: { size: 256, palette: [0.26, 0.32, 0.42], pattern: 'panels', contrast: 0.5 },
  circuit: { size: 256, palette: [0.18, 0.42, 0.32], pattern: 'circuit', contrast: 0.6 },
  chitin: { size: 256, palette: [0.4, 0.72, 0.66], pattern: 'noise', contrast: 0.5 },
  hazard: { size: 256, palette: [0.86, 0.7, 0.16], pattern: 'stripes', contrast: 0.55 },
  nebula: { size: 256, wide: 2, palette: [0.26, 0.3, 0.5], pattern: 'stars', contrast: 0.6 },
  macro: { size: 256, palette: [0.62, 0.58, 0.5], pattern: 'noise', contrast: 0.95, freq: 2 },
  // Fidelity pass: offline source art for canonical kinds that had no baked
  // albedo, plus three atmosphere variants. `sources` renders these locally —
  // no API key and no credits — so they are free to iterate.
  steel: { size: 256, palette: [0.6, 0.63, 0.68], pattern: 'panels', panels: 6, contrast: 0.4, seed: 17 },
  stucco: { size: 256, palette: [0.82, 0.78, 0.7], pattern: 'noise', contrast: 0.24, freq: 7, seed: 137 },
  corrugated: { size: 256, palette: [0.62, 0.66, 0.71], pattern: 'corrugated', ribs: 12, contrast: 0.5, seed: 37 },
  grating: { size: 256, palette: [0.58, 0.61, 0.65], pattern: 'grating', cells: 8, contrast: 0.6, seed: 41 },
  diamond: { size: 256, palette: [0.6, 0.63, 0.67], pattern: 'diamond', cells: 5, contrast: 0.6, seed: 43 },
  carbon: { size: 256, palette: [0.22, 0.24, 0.28], pattern: 'weave', cells: 18, contrast: 0.6, seed: 47 },
  riveted: { size: 256, palette: [0.56, 0.6, 0.65], pattern: 'rivets', panels: 4, contrast: 0.45, seed: 53 },
  mesh: { size: 256, palette: [0.54, 0.58, 0.62], pattern: 'mesh', cells: 6, contrast: 0.7, seed: 59 },
  'sky-ashen': { size: 256, wide: 2, palette: [0.58, 0.5, 0.42], pattern: 'stars', contrast: 0.5, cloudFreq: 3.2, starDensity: 0.997, seed: 139 },
  'sky-frost': { size: 256, wide: 2, palette: [0.5, 0.62, 0.82], pattern: 'stars', contrast: 0.5, cloudFreq: 3.4, starDensity: 0.997, seed: 67 },
  'sky-void': { size: 256, wide: 2, palette: [0.26, 0.26, 0.42], pattern: 'stars', contrast: 0.5, cloudFreq: 3.6, starDensity: 0.997, seed: 149 },
};

// Wrapping value noise, so the source art tiles seamlessly and does not draw a
// hard seam grid when repeated across a surface.
const wrapIndex = (n, m) => ((n % m) + m) % m;
const valueNoiseT = (x, y, seed, period) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const x0 = wrapIndex(xi, period), x1 = wrapIndex(xi + 1, period), y0 = wrapIndex(yi, period), y1 = wrapIndex(yi + 1, period);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = smoothStep(xf), v = smoothStep(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};
const tileFbm = (u, v, seed, freq, octaves = 4) => {
  let total = 0, amp = 0.5, f = freq, norm = 0;
  for (let i = 0; i < octaves; i++) { total += valueNoiseT(u * f, v * f, seed + i * 131, f) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return total / norm;
};
const wrap01 = (t) => ((t % 1) + 1) % 1;

function makeSourceArt(name, spec = SOURCE_ART.panel) {
  const base = SOURCE_ART[name] || {};
  const merged = { ...base, ...spec };
  const seed = merged.seed ?? 7;
  const size = merged.size ?? 256;
  const width = merged.wide ? size * merged.wide : size;
  const height = size;
  const [pr, pg, pb] = merged.palette || [0.6, 0.6, 0.6];
  const contrast = merged.contrast ?? 0.4;
  const freq = merged.freq ?? 6;
  const industrial = merged.pattern !== 'noise' && merged.pattern !== 'stars';
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    let lum = 0.5 + (tileFbm(u, v, seed, freq, 4) - 0.5) * contrast;
    lum += (tileFbm(u, v, seed + 31, freq * 3, 3) - 0.5) * contrast * 0.35;
    if (merged.pattern === 'panels') {
      const panels = merged.panels ?? 8;
      const gx = Math.abs(((x / width) * panels) % 1 - 0.5) * 2, gy = Math.abs(((y / height) * panels) % 1 - 0.5) * 2;
      lum *= gx > 0.94 || gy > 0.94 ? 0.45 : 1;
    } else if (merged.pattern === 'rivets') {
      // Riveted armour: a coarse plate grid with a bolt head row riding each seam.
      const panels = merged.panels ?? 4;
      const lx = ((x / width) * panels) % 1, ly = ((y / height) * panels) % 1;
      const seam = Math.min(lx, 1 - lx, ly, 1 - ly);
      if (seam < 0.05) lum *= 0.45;
      const boltX = Math.abs((ly * 4) % 1 - 0.5) < 0.12 && Math.min(lx, 1 - lx) < 0.16;
      const boltY = Math.abs((lx * 4) % 1 - 0.5) < 0.12 && Math.min(ly, 1 - ly) < 0.16;
      if (boltX || boltY) lum = Math.min(1, lum + 0.5);
    } else if (merged.pattern === 'circuit') {
      const gx = Math.abs(((x / width) * 10) % 1 - 0.5) * 2, gy = Math.abs(((y / height) * 10) % 1 - 0.5) * 2;
      if (gx > 0.96 || gy > 0.96) lum = Math.min(1, lum + 0.5);
    } else if (merged.pattern === 'stripes') {
      lum = (((x + y) / height) * 4) % 1 < 0.5 ? lum + 0.25 : lum * 0.35;
    } else if (merged.pattern === 'corrugated') {
      // Rolled sheet: sinusoidal ribs running along the tile's height.
      const ribs = merged.ribs ?? 10;
      const wave = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * ribs);
      lum = lum * (0.45 + wave * 0.75) + wave * 0.16;
    } else if (merged.pattern === 'grating') {
      // Bar-and-hole grating: bright rails around dark square voids.
      const cells = merged.cells ?? 8;
      const fx = (u * cells) % 1, fy = (v * cells) % 1;
      const bar = Math.min(fx, 1 - fx, fy, 1 - fy) < 0.18;
      lum = bar ? 0.6 + lum * 0.5 : lum * 0.28;
    } else if (merged.pattern === 'diamond') {
      // Diamond tread plate: the raised lattice is a pair of diagonal bands.
      const cells = merged.cells ?? 5;
      const t1 = wrap01(((x + y) / size) * cells), t2 = wrap01(((x - y) / size) * cells);
      const tread = Math.min(t1, 1 - t1, t2, 1 - t2);
      lum = tread < 0.24 ? 0.7 + lum * 0.45 : lum * 0.5;
    } else if (merged.pattern === 'weave') {
      // 2x2 carbon twill: alternate the diagonal shading direction every cell.
      const cells = merged.cells ?? 16;
      const cx = Math.floor(u * cells), cy = Math.floor(v * cells);
      const fx = (u * cells) % 1;
      const twill = (cx + cy) % 2 === 0 ? fx : 1 - fx;
      lum = 0.3 + twill * 0.5 + ((y / height) * cells % 1) * 0.12 + (lum - 0.5) * 0.3;
    } else if (merged.pattern === 'mesh') {
      // Expanded metal: a diagonal slit lattice leaves bright strands.
      const cells = merged.cells ?? 6;
      const a = wrap01(((x + y) / size) * cells), b = wrap01(((x - y) / size) * cells);
      const strand = a < 0.3 || b < 0.3;
      lum = strand ? 0.6 + lum * 0.4 : lum * 0.22;
    } else if (merged.pattern === 'stars') {
      const band = Math.max(0, 1 - Math.abs((y / height) - 0.5) * 2.2);
      lum = 0.06 + band * (0.25 + tileFbm(u, v, seed, merged.cloudFreq ?? 3, 4) * 0.7);
      if (hash2(x * 3 + 1, y * 7 + 5, seed + 991) > (merged.starDensity ?? 0.9965)) lum = 1;
    }
    // Natural surfaces must read as one continuous material: no seam darkening.
    // Industrial patterns keep their hard edges so the grid reads on purpose.
    const scale = industrial ? 360 : 300;
    const i = (y * width + x) * 3;
    rgb[i] = Math.max(0, Math.min(255, Math.round(lum * pr * scale)));
    rgb[i + 1] = Math.max(0, Math.min(255, Math.round(lum * pg * scale)));
    rgb[i + 2] = Math.max(0, Math.min(255, Math.round(lum * pb * scale)));
  }
  return encodePng(width, height, rgb);
}

// A non-negative, seamlessly tiling 2D height field for blur-core-v1.
function heightGrid(size, seed, kind = 'noise') {
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => {
    const u = x / size, v = y / size;
    let h = tileFbm(u, v, seed, 8, 5);
    if (kind === 'ridge') h = 1 - Math.abs(h * 2 - 1);
    if (kind === 'cells') h = Math.abs(Math.sin(u * Math.PI * 4) * Math.cos(v * Math.PI * 4));
    return Math.round(h * 1000) / 1000;
  }));
}
// A radial "rift" field whose ring radius shifts with the frame index.
function radialGrid(size, frame = 0, seed = 3) {
  const c = (size - 1) / 2, radius = size * (0.18 + frame * 0.09);
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => {
    const d = Math.hypot(x - c, y - c);
    const ring = Math.max(0, 1 - Math.abs(d - radius) / (size * 0.16));
    return Math.round((ring * 0.8 + fbm2(x * 0.3, y * 0.3, seed + frame * 17, 3) * 0.2) * 1000) / 1000;
  }));
}
// A portal/arc burst: an expanding ring plus angular spokes and a hot core, so
// the sequence reads as an opening gate rather than the rift's plain shockwave.
function portalGrid(size, frame = 0, seed = 41) {
  const c = (size - 1) / 2, radius = size * (0.12 + frame * 0.13);
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    const ring = Math.max(0, 1 - Math.abs(d - radius) / (size * 0.11));
    const core = Math.max(0, 1 - d / (size * 0.14));
    const spokes = Math.pow(Math.abs(Math.cos(angle * 3 + frame * 0.9)), 6) * Math.max(0, 1 - d / (size * 0.5));
    const noise = fbm2(x * 0.35, y * 0.35, seed + frame * 23, 3) * 0.18;
    return Math.round(Math.min(1, ring * 0.75 + spokes * 0.35 + core * 0.9 + noise) * 1000) / 1000;
  }));
}
// A spark impact: a bright core with radiating needle rays that broaden with the
// frame index, for muzzle/impact flashes.
function sparkGrid(size, frame = 0, seed = 61) {
  const c = (size - 1) / 2, radius = size * (0.06 + frame * 0.16);
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy) || 1e-6, angle = Math.atan2(dy, dx);
    const core = Math.max(0, 1 - d / (size * (0.1 + frame * 0.03)));
    const ray = Math.pow(Math.abs(Math.sin(angle * 5 + seed)), 4) * Math.max(0, 1 - Math.abs(d - radius) / (size * 0.22));
    const noise = fbm2(x * 0.4, y * 0.4, seed + frame * 13, 2) * 0.15;
    return Math.round(Math.min(1, core + ray * 0.7 + noise) * 1000) / 1000;
  }));
}
export function generateValues(job) {
  const spec = job.generateValues;
  if (!spec || !spec.type) return null;
  if (spec.type === 'height') return heightGrid(spec.size || 32, spec.seed || 1, spec.kind || 'noise');
  if (spec.type === 'radial') return radialGrid(spec.size || 32, spec.frame || 0, spec.seed || 3);
  if (spec.type === 'portal') return portalGrid(spec.size || 32, spec.frame || 0, spec.seed || 41);
  if (spec.type === 'spark') return sparkGrid(spec.size || 32, spec.frame || 0, spec.seed || 61);
  return null;
}

// A minimal Standard MIDI File writer/reader, used to seed and read motif jobs.
function encodeMidi(notes, { ppq = 480, bpm = 60 } = {}) {
  const events = [];
  const microsPerBeat = Math.round(60000000 / bpm);
  const vlq = (n) => { const bytes = [n & 0x7f]; n >>= 7; while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; } return bytes; };
  const body = [0x00, 0xff, 0x51, 0x03, (microsPerBeat >> 16) & 255, (microsPerBeat >> 8) & 255, microsPerBeat & 255];
  let last = 0;
  for (const note of notes) {
    const start = note.tick, end = note.tick + note.dur;
    events.push([start, [0x90, note.midi, note.vel ?? 96]], [end, [0x80, note.midi, 0]]);
  }
  events.sort((a, b) => a[0] - b[0] || (a[1][0] === 0x80 ? -1 : 1));
  for (const [tick, data] of events) { body.push(...vlq(tick - last), ...data); last = tick; }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const track = Buffer.from(body);
  const header = Buffer.alloc(14);
  header.write('MThd', 0, 'ascii'); header.writeUInt32BE(6, 4); header.writeUInt16BE(0, 8); header.writeUInt16BE(1, 10); header.writeUInt16BE(ppq, 12);
  const chunk = Buffer.alloc(8); chunk.write('MTrk', 0, 'ascii'); chunk.writeUInt32BE(track.length, 4);
  return Buffer.concat([header, chunk, track]);
}
function decodeMidi(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'MThd') throw new Error('motif: not a MIDI file');
  const ppq = buffer.readUInt16BE(12);
  let bpm = 120, offset = 14, active = [], notes = [];
  const readVlq = () => { let value = 0, byte; do { byte = buffer[offset++]; value = (value << 7) | (byte & 0x7f); } while (byte & 0x80); return value; };
  let tick = 0, status = 0;
  while (offset < buffer.length) {
    if (buffer.toString('ascii', offset, offset + 4) === 'MTrk') { offset += 8; continue; }
    tick += readVlq();
    let byte = buffer[offset++];
    if (byte & 0x80) { status = byte; } else { offset--; }
    const type = status & 0xf0;
    if (type === 0x90 && buffer[offset + 1] > 0) { const midi = buffer[offset]; active[midi] = tick; offset += 2; }
    else if (type === 0x80 || (type === 0x90 && buffer[offset + 1] === 0)) { const midi = buffer[offset]; if (active[midi] !== undefined) { notes.push({ step: active[midi], midi, dur: Math.max(1, tick - active[midi]), vel: 96 }); delete active[midi]; } offset += 2; }
    else if (type === 0xff) { const meta = buffer[offset++]; const len = readVlq(); if (meta === 0x51 && len === 3) bpm = Math.round(60000000 / ((buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2])); offset += len; }
    else if (type === 0xb0) offset += 2;
    else offset += 1;
  }
  return { bpm, ppq, notes: notes.sort((a, b) => a.step - b.step) };
}

function writeSources(log = console.error) {
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  const manifest = readManifest();
  const wanted = new Set();
  for (const job of manifest.jobs || []) for (const rel of Object.values(job.input || {})) wanted.add(path.basename(rel));
  for (const [name, spec] of Object.entries(SOURCE_ART)) {
    const file = `${name}.png`;
    if (wanted.size && !wanted.has(file)) continue;
    const target = path.join(SOURCES_DIR, file);
    fs.writeFileSync(target, makeSourceArt(name, spec));
    log(`wrote ${path.relative(ROOT, target)}`);
  }
  if (!wanted.size || wanted.has('motif.mid')) {
    const target = path.join(SOURCES_DIR, 'motif.mid');
    fs.writeFileSync(target, encodeMidi(SEED_MOTIF, { ppq: 480, bpm: 60 }));
    log(`wrote ${path.relative(ROOT, target)}`);
  }
  // Free, deterministic seed audio for qrc-audio. Only written when a job
  // references it (or when no filter is active), matching the source-art rule.
  for (const [name, spec] of Object.entries(SOURCE_AUDIO)) {
    const file = `${name}.wav`;
    if (wanted.size && !wanted.has(file)) continue;
    const target = path.join(SOURCES_DIR, file);
    fs.writeFileSync(target, makeSourceAudio({ name, ...spec }));
    log(`wrote ${path.relative(ROOT, target)}`);
  }
}

// A slow, modal seed motif in D natural minor — original, for qrc-midi/blur-midi
// to re-sequence. MIDI note numbers: D4=62, F4=65, G4=67, A4=69, C5=72, D5=74.
const SEED_MOTIF = [
  { tick: 0, dur: 960, midi: 62, vel: 84 },
  { tick: 960, dur: 480, midi: 65, vel: 76 },
  { tick: 1440, dur: 960, midi: 69, vel: 88 },
  { tick: 2400, dur: 480, midi: 67, vel: 72 },
  { tick: 2880, dur: 1440, midi: 62, vel: 80 },
  { tick: 4320, dur: 480, midi: 60, vel: 70 },
  { tick: 4800, dur: 960, midi: 65, vel: 78 },
  { tick: 5760, dur: 1440, midi: 69, vel: 90 },
];

// ---------------------------------------------------------------------------
// Deterministic source audio (the audio analogue of the source art above).
//
// `qrc-audio-v1` consumes an audio file and returns a re-sequenced WAV, but it
// has no committed input. `makeSourceAudio` renders a small original mono WAV as
// a pure function of its spec (a seeded RNG, no external samples, no API call),
// so the qrc-audio input is free and reproducible. `writeSources` emits
// `assets/moth/sources/bed-seed.wav` for any job that references it.
// ---------------------------------------------------------------------------

const seedRng = (seed) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SOURCE_AUDIO = {
  'bed-seed': { kind: 'drone', seconds: 8, sampleRate: 22050, seed: 7, baseHz: 55 },
};

const AUDIO_KINDS = {
  // A slow evolving drone with gentle partial drift and soft pulses.
  drone({ frames, sampleRate, spec, rnd }) {
    const base = spec.baseHz ?? 55;
    const partials = spec.partials ?? [[1, 1], [2, 0.4], [3, 0.2], [4.5, 0.12], [6.01, 0.08]];
    const phases = partials.map(() => rnd() * Math.PI * 2);
    const drift = partials.map(() => (rnd() - 0.5) * (spec.detune ?? 0.4));
    const lfoRate = spec.lfoRate ?? 0.07;
    const lfoPhase = rnd() * Math.PI * 2;
    const pulseSeconds = Math.max(0.1, spec.pulseSeconds ?? 2.5);
    const pulseLevel = spec.pulseLevel ?? 0.22;
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      let value = 0;
      for (let p = 0; p < partials.length; p++) value += Math.sin(2 * Math.PI * base * (partials[p][0] + drift[p]) * t + phases[p]) * partials[p][1];
      const lfo = 0.6 + 0.4 * Math.sin(2 * Math.PI * lfoRate * t + lfoPhase);
      const pulse = Math.exp(-Math.pow(((t % pulseSeconds) - 0.05) / 0.12, 2)) * pulseLevel;
      out[i] = clamp(value * 0.3 * lfo + pulse * 0.6, -1, 1);
    }
    return out;
  },
  // A one-pole smoothed noise bed (a cheap, dependency-free texture).
  noise({ frames, sampleRate, spec, rnd }) {
    const smooth = Math.max(1, Math.round(((spec.smoothMs ?? 30) / 1000) * sampleRate));
    const out = new Float32Array(frames);
    let state = 0;
    for (let i = 0; i < frames; i++) { state += (rnd() * 2 - 1 - state) / smooth; out[i] = clamp(state * 2.4, -1, 1); }
    return out;
  },
  // Exponentially decaying pulses on a fixed period.
  pulse({ frames, sampleRate, spec }) {
    const period = Math.max(1, Math.round((spec.pulseSeconds ?? 0.5) * sampleRate));
    const width = Math.max(1, Math.round(((spec.pulseMs ?? 40) / 1000) * sampleRate));
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { const phase = i % period; out[i] = phase < width ? Math.exp(-phase / (width * 0.35)) : 0; }
    return out;
  },
};

// Render a deterministic, original mono WAV. Spec: `{ kind, seconds, sampleRate,
// seed, sampleFormat, fadeSeconds, ...kind knobs }`.
export function makeSourceAudio(spec = {}) {
  const merged = { ...(SOURCE_AUDIO[spec.name] || {}), ...spec };
  const kind = merged.kind ?? 'drone';
  const render = AUDIO_KINDS[kind];
  if (!render) throw new Error(`sources: unknown audio kind "${kind}" (expected ${Object.keys(AUDIO_KINDS).join(', ')})`);
  const seconds = merged.seconds ?? 8;
  const sampleRate = merged.sampleRate ?? 22050;
  if (!(seconds > 0)) throw new Error('sources: audio seconds must be a positive number');
  if (!(sampleRate > 0)) throw new Error('sources: audio sampleRate must be a positive number');
  const frames = Math.max(1, Math.round(seconds * sampleRate));
  const rnd = seedRng(merged.seed ?? 7);
  const out = render({ frames, sampleRate, spec: merged, rnd });
  const fade = Math.min(Math.round((merged.fadeSeconds ?? 0.05) * sampleRate), Math.floor(frames / 2));
  for (let i = 0; i < fade; i++) { const gain = i / fade; out[i] *= gain; out[frames - 1 - i] *= gain; }
  return encodeWav([out], { sampleRate, format: merged.sampleFormat ?? 'pcm16' });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force' || a === '--dry') args[a.slice(2)] = true;
    else if (a === '--only') args.only = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'run';
  if (command === 'catalog') {
    const key = readKey();
    const engines = await listEngines(key);
    for (const e of engines.sort((a, b) => a.engine_id.localeCompare(b.engine_id))) {
      console.log(`${String(e.credits_per_run).padStart(2)}cr  ${e.engine_id.padEnd(24)} ${e.input_type.split('/').pop()} -> ${e.output_type.split('/').pop().padEnd(8)} ${e.name}`);
    }
    return;
  }
  if (command === 'sources') { writeSources(); return; }
  if (command === 'repair') {
    const { rebuilt } = await repairModule({ only: args.only, log: (m) => console.error(m) });
    const counts = { irs: Object.keys(rebuilt.irs).length, spaces: Object.keys(rebuilt.spaces).length, audio: Object.keys(rebuilt.audio).length };
    console.error(`\nRepaired offline (no credits): ${JSON.stringify(counts)}`);
    return;
  }
  if (command === 'run') {
    const { baked, failures } = await runManifest({ only: args.only, force: args.force, dry: args.dry, log: (m) => console.error(m) });
    const buckets = ['textures', 'normals', 'materials', 'sky', 'effects', 'levels', 'seeds', 'motifs', 'irs', 'audio', 'spaces'];
    const counts = Object.fromEntries(buckets.map((key) => [key, Object.keys(baked[key] || {}).length]));
    console.error(`\nBaked: ${JSON.stringify(counts)} · jobs: ${Object.keys(baked.provenance).length} · failed: ${failures.length}`);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => { console.error(`\nmoth-bake: ${error.message}`); process.exit(1); });
}
