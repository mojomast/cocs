#!/usr/bin/env node
// Music asset bake pipeline for the COCS procedural music engine.
//
// Bakes a small, CC0-only sampled-instrument set out of two public domain
// sample libraries, using only the system `ffmpeg` / `ffprobe` (no npm deps):
//
//   * VSCO 2 Community Edition  (github.com/sgossner/VSCO-2-CE, CC0-1.0)
//       - Violin / Viola / Cello *Section* sustained-vibrato string pads
//       - F Horn / Tenor Trombone / Tuba sustained brass
//   * VCSL                       (github.com/sgossner/VCSL, CC0-1.0)
//       - Glockenspiel, Timpani, Frame Drum, Bass Drum
//
// Raw source libraries are expected OUTSIDE the repository (default
// /home/mojo/music-src, override with MUSIC_SRC). Only the baked outputs, this
// script, the manifest and the attribution file are committed.
//
// Usage:
//   node scripts/music-bake.mjs                 # bake everything, verify, write docs
//   node scripts/music-bake.mjs --only strings-pad,low-brass
//   node scripts/music-bake.mjs --force         # re-encode even if outputs are fresh
//   node scripts/music-bake.mjs --dry           # analyse + report, write nothing
//   node scripts/music-bake.mjs --verify        # verify the existing manifest/outputs
//   node scripts/music-bake.mjs --audition      # build a non-committed audition mix
//
// Pipeline per sample:
//   1. decode the source WAV to a mono float32 buffer at 44.1 kHz
//   2. trim leading/trailing silence
//   3. for sustained notes: find a seamless loop window (correlation match on
//      zero-crossings over a full vibrato cycle); for one-shots: keep the hit
//   4. apply click-free fades, measure EBU R128 loudness + true peak, then
//      normalise to a per-velocity target: sustains soft/strong -> -22/-18 LUFS,
//      one-shots soft/strong -> -12/-1.5 dBFS true peak. This keeps soft layers
//      audible and guarantees soft < strong.
//   5. encode Ogg Vorbis (primary) and AAC/.m4a (Safari fallback)
//   6. collect a manifest entry pointing at the baked file + loop points + gain
//
// The manifest at assets/music/manifest.json is a frozen interface for the
// runtime audio engine. See assets/music/README.md for field semantics.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = process.env.MUSIC_SRC || '/home/mojo/music-src';
const OUT_DIR = path.join(ROOT, 'assets/music');
const SAMPLES_DIR = path.join(OUT_DIR, 'samples');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const LICENSES_PATH = path.join(OUT_DIR, 'THIRD_PARTY_LICENSES.md');
const README_PATH = path.join(OUT_DIR, 'README.md');
const TMP_DIR = process.env.MUSIC_TMP || '/tmp/opencode/music-bake';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

// ---------------------------------------------------------------------------
// Bake parameters
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;
const CHANNELS = 1; // mono: cheaper, and lets the runtime pan positionally
const VERSION = 1;

const PEAK_CEILING_DB = -1.5; // true-peak ceiling
const SILENCE_FLOOR_DB = -55; // relative to the source peak
const FADE_IN_MS = 5;
const FADE_OUT_MS = 15;

const LOOP = {
  minSeconds: 1.3,
  maxSeconds: 2.6,
  matchWindow: 4096, // correlation window for choosing loopEnd
  searchStep: 64,
  fadeSeconds: 0.04, // crossfade applied at loopStart (guarantees no click)
  maxStartCandidates: 3,
  startWindowSeconds: 0.15,
  tailSeconds: 0.2, // audio kept after loopEnd so loopEnd < duration
};

const VSCO_URL = 'https://github.com/sgossner/VSCO-2-CE';
const VCSL_URL = 'https://github.com/sgossner/VCSL';
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';
const LICENSE = 'CC0-1.0';

const VSCO_SRC = 'VSCO 2 CE';
const VCSL_SRC = 'VCSL';

// Per-instrument runtime balance (linear multiplier baked into the manifest).
// Sustained layers are loudness-normalised (-22/-18 LUFS), one-shots are
// peak-normalised (-12/-1.5 dBFS); the one-shot gains pull those transients
// into the same mix neighbourhood as the pads. Tune at runtime if desired.
const GAIN = {
  'strings-pad': 0.9,
  'low-brass': 0.85,
  timpani: 0.9,
  bells: 0.65,
  taiko: 0.9,
};

// ---------------------------------------------------------------------------
// Source selection map
//
// All paths are relative to $MUSIC_SRC. Notes are the actual recorded pitches
// (scientific pitch / MIDI); velocity 1 = soft (p), velocity 2 = strong (mf/f).
// ---------------------------------------------------------------------------

/** @typedef {{inst:string, tag:string, midi:number, vel:number, file:string, srcLabel:string, url:string, license:string}} SamplePlan */

/** @type {SamplePlan[]} */
const PLAN = [];

function add(inst, tag, midi, vel, file, srcLabel, url) {
  PLAN.push({ inst, tag, midi, vel, file, srcLabel, url, license: LICENSE });
}

// --- strings-pad: section sustains with vibrato, 2 layers (p / mf) ----------
const VSCO_VLN = 'Strings/Violin Section/susVib';
const VSCO_VLA = 'Strings/Viola Section/susvib';
const VSCO_VLC = 'Strings/Cello Section/susvib';
for (const [midi, note] of [[50, 'D3'], [57, 'A3'], [64, 'E4'], [71, 'B4']]) {
  add('strings-pad', 'violin', midi, 1, `vsco/${VSCO_VLN}/VlnEns_susVib_${note}_v1.wav`, `${VSCO_SRC} — Violin Section susVib`, VSCO_URL);
  add('strings-pad', 'violin', midi, 2, `vsco/${VSCO_VLN}/VlnEns_susVib_${note}_v2.wav`, `${VSCO_SRC} — Violin Section susVib`, VSCO_URL);
}
for (const [midi, note] of [[50, 'D3'], [53, 'F3'], [57, 'A3'], [60, 'C4']]) {
  add('strings-pad', 'viola', midi, 1, `vsco/${VSCO_VLA}/ViolaEns_susvib_${note}_v1_1.wav`, `${VSCO_SRC} — Viola Section susvib`, VSCO_URL);
  add('strings-pad', 'viola', midi, 2, `vsco/${VSCO_VLA}/ViolaEns_susvib_${note}_v2_1.wav`, `${VSCO_SRC} — Viola Section susvib`, VSCO_URL);
}
for (const [midi, note] of [[48, 'C3'], [55, 'G3'], [62, 'D4'], [65, 'F4']]) {
  add('strings-pad', 'cello', midi, 1, `vsco/${VSCO_VLC}/susvib_${note}_v1_1.wav`, `${VSCO_SRC} — Cello Section susvib`, VSCO_URL);
  add('strings-pad', 'cello', midi, 2, `vsco/${VSCO_VLC}/susvib_${note}_v3_1.wav`, `${VSCO_SRC} — Cello Section susvib`, VSCO_URL);
}

// --- low-brass: F Horn / Tenor Trombone / Tuba sustains, 2 layers -----------
const VSCO_HORN = 'Brass/F Horn/sus';
const VSCO_TBN = 'Brass/Tenor Trombone/sus';
const VSCO_TUBA = 'Brass/Tuba/sus';
for (const [midi, note] of [[41, 'F2'], [45, 'A2'], [48, 'C3']]) {
  add('low-brass', 'fhorn', midi, 1, `vsco/${VSCO_HORN}/MOHorn_sus_${note}_v1_1.wav`, `${VSCO_SRC} — F Horn sus`, VSCO_URL);
  add('low-brass', 'fhorn', midi, 2, `vsco/${VSCO_HORN}/MOHorn_sus_${note}_v3_1.wav`, `${VSCO_SRC} — F Horn sus`, VSCO_URL);
}
for (const [midi, note] of [[34, 'A#1'], [41, 'F2'], [48, 'C3'], [53, 'F3']]) {
  add('low-brass', 'trombone', midi, 1, `vsco/${VSCO_TBN}/tenortbn_sus_${note}_v1_1.wav`, `${VSCO_SRC} — Tenor Trombone sus`, VSCO_URL);
  add('low-brass', 'trombone', midi, 2, `vsco/${VSCO_TBN}/tenortbn_sus_${note}_v3_1.wav`, `${VSCO_SRC} — Tenor Trombone sus`, VSCO_URL);
}
for (const [midi, note] of [[34, 'A#1'], [38, 'D2'], [41, 'F2'], [46, 'A#2']]) {
  add('low-brass', 'tuba', midi, 1, `vsco/${VSCO_TUBA}/Tuba3_sus_${note}_v1_rr1_Mid.wav`, `${VSCO_SRC} — Tuba sus`, VSCO_URL);
  add('low-brass', 'tuba', midi, 2, `vsco/${VSCO_TUBA}/Tuba3_sus_${note}_v3_rr1_Mid.wav`, `${VSCO_SRC} — Tuba sus`, VSCO_URL);
}

// --- timpani: 4 drums x 2 dynamics (v2 soft, v4 loud) -----------------------
const VCSL_TIMP = 'vcsl/Membranophones/Struck Membranophones/Timpani 1/Hit';
for (const [n, midi] of [[1, 42], [2, 46], [3, 49], [4, 52]]) {
  add('timpani', `timp${n}`, midi, 1, `${VCSL_TIMP}/Timpani${n}_Hit_v2_rr1_Sum.wav`, `${VCSL_SRC} — Timpani ${n} Hit`, VCSL_URL);
  add('timpani', `timp${n}`, midi, 2, `${VCSL_TIMP}/Timpani${n}_Hit_v4_rr1_Sum.wav`, `${VCSL_SRC} — Timpani ${n} Hit`, VCSL_URL);
}

// --- bells: glockenspiel, 4 notes x 2 dynamics ------------------------------
const VCSL_GLOCK = 'vcsl/Idiophones/Struck Idiophones/Glockenspiel';
for (const [midi, note, soft] of [[67, 'G4', 'G4_01'], [72, 'C5', 'C5_02'], [79, 'G5', 'G5_01'], [84, 'C6', 'C6_01']]) {
  add('bells', 'glock', midi, 1, `${VCSL_GLOCK}/glock_soft_${soft}.wav`, `${VCSL_SRC} — Glockenspiel`, VCSL_URL);
  add('bells', 'glock', midi, 2, `${VCSL_GLOCK}/glock_loud_${note}_01.wav`, `${VCSL_SRC} — Glockenspiel`, VCSL_URL);
}

// --- taiko: frame drum + bass drum hits, 2 dynamics -------------------------
const VCSL_FRAME = 'vcsl/Membranophones/Struck Membranophones/Frame Drum';
const VCSL_BASS = 'vcsl/Membranophones/Struck Membranophones/Bass Drum 1';
add('taiko', 'bassdrum', 36, 1, `${VCSL_BASS}/BDrumNew_hit_v2_rr1_Sum.wav`, `${VCSL_SRC} — Bass Drum`, VCSL_URL);
add('taiko', 'bassdrum', 36, 2, `${VCSL_BASS}/BDrumNew_hit_v5_rr1_Sum.wav`, `${VCSL_SRC} — Bass Drum`, VCSL_URL);
add('taiko', 'framel', 41, 1, `${VCSL_FRAME}/HDrumL_Hit_v2_rr1_Sum.wav`, `${VCSL_SRC} — Frame Drum (low)`, VCSL_URL);
add('taiko', 'framel', 41, 2, `${VCSL_FRAME}/HDrumL_Hit_v3_rr1_Sum.wav`, `${VCSL_SRC} — Frame Drum (low)`, VCSL_URL);
add('taiko', 'framel-muted', 45, 1, `${VCSL_FRAME}/HDrumL_HitMuted_v2_rr1_Sum.wav`, `${VCSL_SRC} — Frame Drum (low, muted)`, VCSL_URL);
add('taiko', 'framel-muted', 45, 2, `${VCSL_FRAME}/HDrumL_HitMuted_v3_rr1_Sum.wav`, `${VCSL_SRC} — Frame Drum (low, muted)`, VCSL_URL);
add('taiko', 'frames', 50, 1, `${VCSL_FRAME}/HDrumS_Hit_v2_rr1_Sum.wav`, `${VCSL_SRC} — Frame Drum (high)`, VCSL_URL);
add('taiko', 'frames', 50, 2, `${VCSL_FRAME}/HDrumS_Hit_v3_rr1_Sum.wav`, `${VCSL_SRC} — Frame Drum (high)`, VCSL_URL);

const INSTRUMENT_META = {
  'strings-pad': { type: 'sustained', midiRange: [36, 84], blurb: 'Violin / viola / cello section sustains with vibrato; the harmonic bed.' },
  'low-brass': { type: 'sustained', midiRange: [33, 72], blurb: 'F Horn / Tenor Trombone / Tuba sustains; low melodic and tension lines.' },
  timpani: { type: 'oneshot', blurb: 'Four tuned timpani hits; downbeats, accents and transitions.' },
  bells: { type: 'oneshot', blurb: 'Glockenspiel strikes; high melodic sparkle and cues.' },
  taiko: { type: 'oneshot', blurb: 'Frame-drum and bass-drum hits; percussive pulse and impacts.' },
};

const VELOCITY_LABEL = { 1: 'p', 2: 'mf', 3: 'f' };
const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const noteName = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const noteSlug = (midi) => noteName(midi).replace('#', 's');
const sampleId = (p) => `${p.inst}-${p.tag}-${noteSlug(p.midi)}-${VELOCITY_LABEL[p.vel] || p.vel}`;

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'buffer', maxBuffer: 1 << 28, ...opts });
  if (res.error) throw new Error(`${cmd} failed to start: ${res.error.message}`);
  if (res.status !== 0) {
    const stderr = res.stderr ? res.stderr.toString('utf8') : '';
    throw new Error(`${cmd} ${args.join(' ')} -> exit ${res.status}\n${stderr.slice(-1200)}`);
  }
  return res;
}

function ffprobe(file) {
  const res = run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', file]);
  const json = JSON.parse(res.stdout.toString('utf8'));
  const stream = (json.streams || [])[0] || {};
  return {
    duration: Number(json.format?.duration || 0),
    codec: stream.codec_name,
    sampleRate: Number(stream.sample_rate || 0),
    channels: Number(stream.channels || 0),
  };
}

/** Decode any audio file to a mono float32 array at SAMPLE_RATE. */
function decodeMono(file) {
  const res = run(FFMPEG, ['-v', 'error', '-nostdin', '-i', file, '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1']);
  const buf = res.stdout;
  const n = buf.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i << 2);
  return out;
}

function f32Buffer(x) {
  const buf = Buffer.allocUnsafe(x.length * 4);
  for (let i = 0; i < x.length; i++) buf.writeFloatLE(x[i], i << 2);
  return buf;
}

/** EBU R128 integrated loudness + true peak of a float32 mono buffer. */
function measureLoudness(x) {
  const res = run(FFMPEG, ['-hide_banner', '-nostdin', '-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { input: f32Buffer(x) });
  const stderr = res.stderr.toString('utf8');
  const lufsMatches = [...stderr.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  const peakMatches = [...stderr.matchAll(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
  const lufs = lufsMatches.length ? Number(lufsMatches[lufsMatches.length - 1][1]) : -70;
  const peakDb = peakMatches.length ? Number(peakMatches[peakMatches.length - 1][1]) : -70;
  return { lufs, peakDb };
}

function encodeOgg(x, outFile) {
  run(FFMPEG, ['-v', 'error', '-nostdin', '-y', '-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '4', '-map_metadata', '-1', outFile], { input: f32Buffer(x) });
}

function encodeM4a(x, outFile) {
  run(FFMPEG, ['-v', 'error', '-nostdin', '-y', '-f', 'f32le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-map_metadata', '-1', outFile], { input: f32Buffer(x) });
}

const dbToGain = (db) => Math.pow(10, db / 20);

// ---------------------------------------------------------------------------
// Signal analysis
// ---------------------------------------------------------------------------

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
  return p;
}

/** Trim leading/trailing near-silence. Returns [start, end) sample indices. */
function trimSilence(x, floorDb = SILENCE_FLOOR_DB) {
  const peak = peakOf(x);
  if (peak <= 0) return { start: 0, end: x.length };
  const floor = peak * dbToGain(floorDb);
  let start = 0;
  while (start < x.length && Math.abs(x[start]) <= floor) start++;
  let end = x.length;
  while (end > start && Math.abs(x[end - 1]) <= floor) end--;
  return { start, end };
}

function snapPositiveZeroCrossing(x, i, limit) {
  for (let k = 0; k < limit; k++) {
    if (x[i + k] <= 0 && x[i + k + 1] > 0) return i + k;
  }
  return i;
}

/**
 * Find a seamless loop window inside a sustained note and bake a short
 * crossfade at the loop start. Returns { loopStart, loopEnd, start, end } in
 * sample indices relative to `x` (x is modified in place at the crossfade).
 *
 * loopEnd is picked by normalised cross-correlation against the loop start
 * (so the two boundaries already sound alike); a 40 ms equal-power-ish linear
 * crossfade at loopStart then blends in the audio just after loopEnd, which
 * removes any residual vibrato-phase discontinuity. Playback reaches
 * x[loopEnd-1] then jumps to the blended x[loopStart] == x[loopEnd].
 */
function findSustainLoop(x, onset, len) {
  const sr = SAMPLE_RATE;
  const win = LOOP.matchWindow;
  const steadyStart = Math.min(onset + Math.round(0.25 * sr), Math.max(onset, len - Math.round((LOOP.minSeconds + 0.3) * sr)));
  const steadyEnd = len - Math.round(0.05 * sr);

  // Candidate loop starts: positive zero crossings in the first 150 ms of the steady region.
  const startLimit = Math.min(steadyStart + Math.round(LOOP.startWindowSeconds * sr), steadyEnd - Math.round(LOOP.minSeconds * sr));
  const starts = [];
  for (let i = steadyStart; i < startLimit && starts.length < LOOP.maxStartCandidates; i++) {
    if (x[i] <= 0 && x[i + 1] > 0) starts.push(i);
  }
  if (!starts.length) starts.push(steadyStart);

  const minLen = Math.round(LOOP.minSeconds * sr);
  const maxLen = Math.round(LOOP.maxSeconds * sr);
  let best = null;

  for (const S of starts) {
    if (S + win >= x.length) continue;
    let ea = 0;
    for (let k = 0; k < win; k++) { const a = x[S + k]; ea += a * a; }
    if (ea <= 0) continue;
    const rMax = Math.min(steadyEnd, S + maxLen, x.length - win - 1);
    for (let R = S + minLen; R <= rMax; R += LOOP.searchStep) {
      const R2 = snapPositiveZeroCrossing(x, R, LOOP.searchStep);
      if (R2 + win >= x.length) continue;
      let dot = 0, eb = 0;
      for (let k = 0; k < win; k++) { const a = x[S + k], b = x[R2 + k]; dot += a * b; eb += b * b; }
      if (eb < 0.1 * ea) continue; // reject near-silent candidates
      const c = dot / Math.sqrt(ea * eb);
      if (!best || c > best.corr) best = { S, R: R2, corr: c };
    }
  }

  const S = best ? best.S : steadyStart;
  const LE = best ? best.R : Math.min(steadyEnd, S + Math.round(1.8 * sr));
  const F = Math.min(Math.round(LOOP.fadeSeconds * sr), Math.max(8, Math.floor((LE - S) / 4)));
  if (LE + F <= x.length) {
    for (let i = 0; i < F; i++) {
      const t = i / F;
      x[S + i] = x[LE + i] * (1 - t) + x[S + i] * t;
    }
  }
  return { loopStart: S, loopEnd: LE, start: onset, end: Math.min(len, LE + Math.round(LOOP.tailSeconds * sr)) };
}

function applyFades(x, inMs, outMs) {
  const n = x.length;
  const inN = Math.min(Math.round((inMs / 1000) * SAMPLE_RATE), n);
  const outN = Math.min(Math.round((outMs / 1000) * SAMPLE_RATE), n);
  for (let i = 0; i < inN; i++) x[i] *= i / inN;
  for (let i = 0; i < outN; i++) x[n - 1 - i] *= i / outN;
  return x;
}

// ---------------------------------------------------------------------------
// One sample
//
// Each sample is rendered then normalised to a PER-VELOCITY target:
//   sustained: soft (v1) -> -22 LUFS, strong (v2) -> -18 LUFS (4 dB apart)
//   one-shot : soft (v1) -> -12 dBFS peak, strong (v2) -> -1.5 dBFS peak
// One-shots are peak-normalised because their crest factor makes a LUFS target
// unreachable without hard limiting; the two layers sit ~10.5 dB apart. Giving
// every layer its own target keeps soft layers audible (the sources record some
// soft layers 20+ dB down) while guaranteeing soft < strong.
// ---------------------------------------------------------------------------

const SUSTAINED_LUFS = { 1: -22, 2: -18, 3: -15 };
// Peak targets leave room for AAC inter-sample overshoot (up to ~+2.5 dBFS).
const ONESHOT_PEAK_DB = { 1: -14, 2: -3.5, 3: -2.5 };

/** Decode + trim + loop-detect + fade one sample. Does not normalise yet. */
function renderSample(plan) {
  const meta = INSTRUMENT_META[plan.inst];
  const sustained = meta.type === 'sustained';
  const srcFile = path.join(SRC_ROOT, plan.file);
  if (!fs.existsSync(srcFile)) throw new Error(`missing source: ${srcFile}`);

  const x = decodeMono(srcFile);
  const trimmed = trimSilence(x);
  let region;
  let loopStart = null, loopEnd = null;

  if (sustained) {
    region = findSustainLoop(x, trimmed.start, trimmed.end);
    loopStart = (region.loopStart - region.start) / SAMPLE_RATE;
    loopEnd = (region.loopEnd - region.start) / SAMPLE_RATE;
  } else {
    const preRoll = Math.round(0.003 * SAMPLE_RATE);
    const post = Math.round(0.02 * SAMPLE_RATE);
    region = { start: Math.max(0, trimmed.start - preRoll), end: Math.min(x.length, trimmed.end + post) };
  }

  const out = x.slice(region.start, region.end);
  applyFades(out, sustained ? FADE_IN_MS : 1, sustained ? FADE_OUT_MS : Math.max(FADE_OUT_MS, 60));
  const measured = measureLoudness(out);

  return {
    plan, id: sampleId(plan), sustained, srcFile, out, measured,
    rel: `samples/${sampleId(plan)}.ogg`,
    relM4a: `samples/${sampleId(plan)}.m4a`,
    loopStart, loopEnd,
    sourceDuration: x.length / SAMPLE_RATE,
    duration: out.length / SAMPLE_RATE,
    trimmedSeconds: (region.end - region.start) / SAMPLE_RATE,
  };
}

/** Compute the normalisation gain for one rendered sample (see header note). */
function assignGain(r) {
  if (r.sustained) {
    const target = SUSTAINED_LUFS[r.plan.vel] ?? SUSTAINED_LUFS[2];
    // Cap by the true-peak ceiling so no layer can clip.
    r.gainDb = Math.min(target - r.measured.lufs, PEAK_CEILING_DB - r.measured.peakDb);
  } else {
    const target = ONESHOT_PEAK_DB[r.plan.vel] ?? ONESHOT_PEAK_DB[2];
    r.gainDb = Math.min(target, PEAK_CEILING_DB) - r.measured.peakDb;
  }
}

/** Apply the gain, encode both formats and build the manifest entry. */
function finaliseSample(r, { dry = false } = {}) {
  assignGain(r);
  const out = r.out;
  const normGain = dbToGain(r.gainDb);
  for (let i = 0; i < out.length; i++) out[i] *= normGain;

  if (!dry) {
    fs.mkdirSync(SAMPLES_DIR, { recursive: true });
    encodeOgg(out, path.join(OUT_DIR, r.rel));
    encodeM4a(out, path.join(OUT_DIR, r.relM4a));
  }

  return {
    entry: {
      id: r.id,
      instrument: r.plan.inst,
      midi: r.plan.midi,
      velocity: r.plan.vel,
      file: r.rel,
      mime: 'audio/ogg',
      fallback: r.relM4a,
      fallbackMime: 'audio/mp4',
      loopStart: r.sustained ? roundSample(r.loopStart) : null,
      loopEnd: r.sustained ? roundSample(r.loopEnd) : null,
      gain: GAIN[r.plan.inst] ?? 1,
      source: r.plan.srcLabel,
      license: r.plan.license,
      url: r.plan.url,
    },
    stats: {
      sourceDuration: r.sourceDuration,
      duration: r.duration,
      trimmedSeconds: r.trimmedSeconds,
      loopStart: r.loopStart,
      loopEnd: r.loopEnd,
      measuredLufs: r.measured.lufs,
      measuredPeakDb: r.measured.peakDb,
      gainDb: r.gainDb,
      finalPeakDb: r.measured.peakDb + r.gainDb,
      finalLufs: r.measured.lufs + r.gainDb,
    },
  };
}

const roundSample = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6);

// ---------------------------------------------------------------------------
// Manifest / docs
// ---------------------------------------------------------------------------

function buildManifest(entries) {
  const byInst = new Map();
  for (const e of entries) {
    if (!byInst.has(e.instrument)) byInst.set(e.instrument, []);
    byInst.get(e.instrument).push(e);
  }
  const instruments = {};
  for (const [inst, meta] of Object.entries(INSTRUMENT_META)) {
    const list = (byInst.get(inst) || []).slice().sort((a, b) => (a.midi - b.midi) || (a.velocity - b.velocity) || a.id.localeCompare(b.id));
    const obj = { type: meta.type, samples: list.map((s) => s.id) };
    if (meta.midiRange) obj.midiRange = meta.midiRange;
    instruments[inst] = obj;
  }
  const samples = entries.slice().sort((a, b) => a.instrument.localeCompare(b.instrument) || (a.midi - b.midi) || (a.velocity - b.velocity) || a.id.localeCompare(b.id));
  return { version: VERSION, generator: 'scripts/music-bake.mjs', sampleRate: SAMPLE_RATE, samples, instruments };
}

function writeDocs(manifest) {
  const vscoLicense = readLicense(path.join(SRC_ROOT, 'vsco/LICENSE'));
  const vcslLicense = readLicense(path.join(SRC_ROOT, 'vcsl/LICENSE'));
  const used = manifest.samples;
  const count = used.length;
  const bytes = used.reduce((n, s) => n + fileSize(s.file) + fileSize(s.fallback), 0);

  const lic = [];
  lic.push('# Third-party licences — assets/music');
  lic.push('');
  lic.push('All baked audio in this directory is derived from two **CC0 1.0** (public domain dedication)');
  lic.push('sample libraries. No attribution is legally required under CC0; it is provided here as good');
  lic.push('practice and to document provenance. No non-CC0 material is included.');
  lic.push('');
  lic.push(`Baked set: ${count} samples, ${(bytes / 1024 / 1024).toFixed(2)} MiB (Ogg + AAC fallback).`);
  lic.push('');
  lic.push('## Sources');
  lic.push('');
  for (const src of [VSCO_SRC, VCSL_SRC]) {
    const items = [...new Set(used.filter((s) => s.source.startsWith(src === VSCO_SRC ? 'VSCO 2 CE' : 'VCSL')).map((s) => s.source))].sort();
    const url = src === VSCO_SRC ? VSCO_URL : VCSL_URL;
    lic.push(`### ${src} — ${url}`);
    lic.push('');
    lic.push(`- **Author:** Versilian Studios LLC — ${src === VSCO_SRC ? 'VSCO 2 Community Edition' : 'Versilian Community Sample Library'}${src === VCSL_SRC ? ' (maintained by sgossner)' : ''}.`);
    lic.push(`- **Licence:** CC0-1.0 — ${CC0_URL}`);
    lic.push(`- **Source repository:** ${url}`);
    lic.push('- **Assets used:**');
    for (const item of items) lic.push(`  - ${item}`);
    lic.push('- **Changes made:** decoded to mono 44.1 kHz float; leading/trailing silence trimmed; sustained notes loop-point detected; click-free fades applied; normalised per velocity layer (sustains to −22/−18 LUFS by EBU R128 for soft/strong, one-shots peak-normalised to −14/−3.5 dBFS true peak); encoded to Ogg Vorbis (primary) and AAC/.m4a (Safari fallback). No pitch shifting, time stretching or re-tuning of one-shots.');
    lic.push('');
    lic.push('#### Upstream LICENSE snapshot');
    lic.push('');
    lic.push('```text');
    lic.push(src === VSCO_SRC ? vscoLicense : vcslLicense);
    lic.push('```');
    lic.push('');
  }
  fs.writeFileSync(LICENSES_PATH, lic.join('\n') + '\n');
}

function writeReadme(manifest) {
  const rows = [];
  for (const [inst, meta] of Object.entries(manifest.instruments)) {
    const list = manifest.samples.filter((s) => s.instrument === inst);
    const range = meta.midiRange ? `${meta.midiRange[0]}–${meta.midiRange[1]}` : '—';
    rows.push(`| \`${inst}\` | ${meta.type} | ${list.length} | ${range} | ${INSTRUMENT_META[inst].blurb} |`);
  }
  const total = manifest.samples.length;
  const bytes = manifest.samples.reduce((n, s) => n + fileSize(s.file) + fileSize(s.fallback), 0);
  const md = `# Music samples (CC0)

Baked sampled-instrument set for the COCS procedural music engine. All audio is
derived from **CC0-1.0** sources; see [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).

${total} samples, ${(bytes / 1024 / 1024).toFixed(2)} MiB committed (Ogg + AAC fallback).

| Instrument | Type | Samples | MIDI map | Role |
| --- | --- | ---: | --- | --- |
${rows.join('\n')}

## Re-baking

Raw sources live **outside** the repository (default \`/home/mojo/music-src\`):

\`\`\`bash
# one-time source checkout (sparse, blob-filtered; needs system git only)
git clone --filter=blob:none --no-checkout https://github.com/sgossner/VSCO-2-CE /home/mojo/music-src/vsco
cd /home/mojo/music-src/vsco
git sparse-checkout init --cone
git sparse-checkout set "Strings/Violin Section/susVib" "Strings/Viola Section/susvib" \
  "Strings/Cello Section/susvib" "Brass/F Horn/sus" "Brass/Tenor Trombone/sus" "Brass/Tuba/sus" "LICENSE"
git checkout

git clone --filter=blob:none --no-checkout https://github.com/sgossner/VCSL /home/mojo/music-src/vcsl
cd /home/mojo/music-src/vcsl
git sparse-checkout init --cone
git sparse-checkout set "Idiophones/Struck Idiophones/Glockenspiel" \
  "Membranophones/Struck Membranophones/Timpani 1" \
  "Membranophones/Struck Membranophones/Frame Drum" \
  "Membranophones/Struck Membranophones/Bass Drum 1" "LICENSE"
git checkout

# re-bake everything, verify, rewrite the manifest and docs
node scripts/music-bake.mjs

# other modes
node scripts/music-bake.mjs --only strings-pad,bells
node scripts/music-bake.mjs --verify
node scripts/music-bake.mjs --audition     # mix under /tmp/opencode, never committed
\`\`\`

Override the source root with \`MUSIC_SRC=/path/to/samples\`. The script needs only
the system \`ffmpeg\`/\`ffprobe\`; there are no npm dependencies.

## Manifest field semantics

\`assets/music/manifest.json\` is a frozen interface (\`version: 1\`). Every \`file\`
and \`fallback\` path is relative to \`assets/music/\`.

- \`instrument\`, \`midi\`, \`velocity\` — which note/layer the sample is; \`velocity\`
  1 is the soft layer, 2 the strong layer.
- \`loopStart\` / \`loopEnd\` — **seconds** into the file (6 decimal places, i.e.
  sample-accurate at 44.1 kHz). \`null\` for one-shots. For sustained samples,
  play \`[0, loopStart)\` once (attack) then loop \`[loopStart, loopEnd)\`. The
  bake already crossfaded the loop start with the audio at \`loopEnd\`, so the
  boundary is click-free: do **not** crossfade at runtime, and do not play the
  tail after \`loopEnd\` while the loop is active (it is the release tail).
- \`gain\` — linear playback multiplier for mixing balance; multiply the sample by
  it after the (already normalised) decode step. Strings 0.9, brass 0.85,
  timpani/taiko 0.9, bells 0.65.
- Normalisation is per velocity layer: sustained soft/strong are −22/−18 LUFS
  (EBU R128), one-shot soft/strong are peak-normalised to −14/−3.5 dBFS true
  peak. Every layer therefore keeps soft < strong and soft layers stay audible.
- One-shots are peak-normalised rather than loudness-normalised because a drum
  or bell transient has a high crest factor; hitting a LUFS target would need
  hard limiting that dulls the attack. The −3.5 dBFS target leaves headroom for
  AAC inter-sample overshoot in the \`.m4a\` fallback.
- Every sample ships Ogg Vorbis (\`mime: audio/ogg\`) plus an AAC \`.m4a\`
  fallback (\`fallback\`, \`fallbackMime: audio/mp4\`) for Safari/iOS. Prefer Ogg;
  fall back only if \`AudioContext.decodeAudioData\` rejects it.
- All audio is **mono 44.1 kHz** — pan positionally at runtime.
`;
  fs.writeFileSync(README_PATH, md);
}

function readLicense(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '(upstream LICENSE text unavailable at bake time; see the source repository)';
  }
}

function fileSize(rel) {
  try { return fs.statSync(path.join(OUT_DIR, rel)).size; } catch { return 0; }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

function verify() {
  if (!fs.existsSync(MANIFEST_PATH)) throw new Error(`no manifest at ${MANIFEST_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const problems = [];
  let total = 0;
  for (const s of manifest.samples) {
    for (const key of ['id', 'instrument', 'midi', 'velocity', 'file', 'mime', 'gain', 'source', 'license', 'url']) {
      if (!(key in s)) problems.push(`${s.id}: missing field ${key}`);
    }
    for (const [relKey, mimeKey] of [['file', 'mime'], ['fallback', 'fallbackMime']]) {
      const rel = s[relKey];
      if (!rel) continue;
      const abs = path.join(OUT_DIR, rel);
      if (!fs.existsSync(abs)) { problems.push(`${s.id}: missing ${rel}`); continue; }
      total += fs.statSync(abs).size;
      const probe = ffprobe(abs);
      const expected = s[mimeKey] === 'audio/ogg' ? 'vorbis' : 'aac';
      if (probe.codec !== expected) problems.push(`${s.id}: ${rel} codec ${probe.codec} != ${expected}`);
      if (probe.sampleRate !== manifest.sampleRate) problems.push(`${s.id}: ${rel} sample rate ${probe.sampleRate} != ${manifest.sampleRate}`);
      const dur = probe.duration;
      if (dur <= 0) problems.push(`${s.id}: ${rel} zero duration`);

      const pcm = decodeMono(abs);
      const peak = measureLoudness(pcm).peakDb;
      if (peak > -0.5) problems.push(`${s.id}: ${rel} peak ${peak.toFixed(2)} dBFS (clipping risk)`);

      if (s.loopStart != null) {
        if (!(s.loopStart >= 0 && s.loopStart < s.loopEnd)) problems.push(`${s.id}: bad loop [${s.loopStart}, ${s.loopEnd}]`);
        if (s.loopEnd > dur + 0.01) problems.push(`${s.id}: loopEnd ${s.loopEnd} > duration ${dur.toFixed(3)}`);
        const ls = Math.round(s.loopStart * manifest.sampleRate);
        const le = Math.round(s.loopEnd * manifest.sampleRate);
        if (ls < 0 || le > pcm.length || ls >= le) {
          problems.push(`${s.id}: loop indices ${ls}..${le} outside decoded length ${pcm.length}`);
        } else {
          // The bake crossfades the loop start with the audio at loopEnd, so a
          // seamless loop has pcm[loopStart] == pcm[loopEnd].
          const jump = Math.abs(pcm[ls] - pcm[le]);
          let local = 0;
          for (let i = -64; i <= 64; i++) local = Math.max(local, Math.abs(pcm[le + i] || 0), Math.abs(pcm[ls + i] || 0));
          const limit = Math.max(0.05, 0.25 * local);
          if (jump > limit) problems.push(`${s.id}: ${rel} loop boundary jump ${jump.toFixed(4)} > ${limit.toFixed(4)}`);
        }
      }
    }
  }
  const budget = 20 * 1024 * 1024;
  if (total > budget) problems.push(`total committed audio ${(total / 1024 / 1024).toFixed(2)} MiB exceeds ${(budget / 1024 / 1024).toFixed(0)} MiB budget`);

  const instConsistent = manifest.samples.every((s) => manifest.instruments[s.instrument]);
  if (!instConsistent) problems.push('a sample references an instrument missing from instruments{}');

  console.log(`verify: ${manifest.samples.length} samples, ${(total / 1024 / 1024).toFixed(2)} MiB`);
  if (problems.length) {
    for (const p of problems) console.error(`  FAIL ${p}`);
    throw new Error(`${problems.length} verification problem(s)`);
  }
  console.log('verify: OK (files present, codecs/durations/sample-rate correct, loops in range, no clipping, within budget)');
  return { total, count: manifest.samples.length };
}

// ---------------------------------------------------------------------------
// Audition (never committed)
// ---------------------------------------------------------------------------

function audition(manifest) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const listFile = path.join(TMP_DIR, 'audition.txt');
  const ordered = manifest.samples.filter((s) => manifest.instruments[s.instrument]?.type === 'sustained')
    .concat(manifest.samples.filter((s) => manifest.instruments[s.instrument]?.type !== 'sustained'));
  fs.writeFileSync(listFile, ordered.map((s) => `file '${path.join(OUT_DIR, s.file).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const out = path.join(TMP_DIR, 'audition.ogg');
  run(FFMPEG, ['-v', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libvorbis', '-q:a', '4', out]);
  console.log(`audition: ${out} (${ordered.length} samples, not committed)`);
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const value = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  if (has('--help') || has('-h')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 40).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return; }

  if (has('--verify')) { verify(); return; }

  const force = has('--force');
  const dry = has('--dry');
  const only = value('--only') ? new Set(value('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const plan = PLAN.filter((p) => !only || only.has(p.inst));
  if (!plan.length) throw new Error('no samples selected');

  const t0 = Date.now();

  // Phase 1: decode, trim, loop-detect, fade (all in memory; ~70 x few MB).
  const rendered = [];
  const skipped = [];
  let i = 0;
  for (const p of plan) {
    i++;
    const label = `${String(i).padStart(2)}/${plan.length} ${sampleId(p)}`;
    const srcFile = path.join(SRC_ROOT, p.file);
    const outOgg = path.join(OUT_DIR, `samples/${sampleId(p)}.ogg`);
    if (!force && !dry && fs.existsSync(outOgg) && fs.existsSync(path.join(OUT_DIR, `samples/${sampleId(p)}.m4a`))) {
      const s = fs.statSync(srcFile), o = fs.statSync(outOgg);
      if (o.mtimeMs >= s.mtimeMs) { skipped.push(sampleId(p)); console.log(`${label}  skipped (fresh)`); continue; }
    }
    try {
      rendered.push(renderSample(p));
    } catch (err) {
      console.error(`${label}  FAILED: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  // Phase 2: normalise per layer, encode and report.
  const fresh = [];
  let n = 0;
  for (const r of rendered) {
    const { entry, stats } = finaliseSample(r, { dry });
    if (entry) fresh.push(entry);
    n++;
    console.log(`${String(n).padStart(2)}/${rendered.length} ${r.id}  ${stats.sourceDuration.toFixed(2)}s -> ${stats.duration.toFixed(2)}s` +
      (stats.loopStart != null ? `  loop ${stats.loopStart.toFixed(3)}..${stats.loopEnd.toFixed(3)}` : '  one-shot') +
      `  ${stats.measuredLufs.toFixed(1)}+${stats.gainDb.toFixed(1)}dB -> ${stats.finalLufs.toFixed(1)} LUFS / ${stats.finalPeakDb.toFixed(2)} dBFS`);
  }

  if (dry) { console.log('dry run: no files written'); return; }

  // Merge freshly baked entries with the untouched part of the previous manifest.
  let entries = fresh;
  if (only && fs.existsSync(MANIFEST_PATH)) {
    const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    entries = prev.samples.filter((s) => !only.has(s.instrument)).concat(fresh);
  } else if (skipped.length) {
    const prev = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : { samples: [] };
    const have = new Map(prev.samples.map((s) => [s.id, s]));
    entries = fresh.concat(skipped.map((id) => have.get(id)).filter(Boolean));
  }

  const manifest = buildManifest(entries);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  writeDocs(manifest);
  writeReadme(manifest);
  console.log(`\nbaked ${manifest.samples.length} samples in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`manifest: assets/music/manifest.json`);
  verify();
  if (has('--audition')) audition(manifest);
}

main();
