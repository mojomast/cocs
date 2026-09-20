import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAKERS, tapsFrom, decodeWav, encodeWav, mixdownChannels, wavInfo,
  detectLoop, crossfadeAtSeam, resampleLinear, makeSourceAudio, rebuildLocalBakes, readLocalResult,
} from '../scripts/moth-bake.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAVERN = path.join(ROOT, 'public/moth/files/ir-cavern');
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `moth-${name}-`));

function toneWav(seconds = 2, sampleRate = 8000, amplitude = 0.5) {
  const samples = new Float32Array(sampleRate * seconds);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.017) * amplitude;
  return encodeWav([samples], { sampleRate, format: 'pcm16' });
}

// ---------------------------------------------------------------------------
// Taps regression: real envelopes carry taps under `extras`, not top level.
// ---------------------------------------------------------------------------

test('tapsFrom finds taps in every envelope flavour', () => {
  assert.equal(tapsFrom({ extras: { taps: [{ site: 0 }] } })?.[0].site, 0, 'extras.taps');
  assert.equal(tapsFrom({ data: { extras: { taps: [{ site: 1 }] } } })?.[0].site, 1, 'data.extras.taps');
  assert.equal(
    tapsFrom({ extras: { taps: 135, tap_map: { taps: [{ site: 2 }] } } })?.[0].site,
    2,
    'a numeric extras.taps count must not shadow extras.tap_map.taps',
  );
  assert.equal(tapsFrom({ result: { extras: { taps: [{ site: 3 }] } } })?.[0].site, 3, 'nested under a job result');
  assert.equal(tapsFrom({ taps: [] }), null, 'an empty tap list is not a match');
  assert.equal(tapsFrom(null), null);
});

test('the committed cavern envelopes extract 135 taps (the shipped bug)', () => {
  const media = JSON.parse(fs.readFileSync(path.join(CAVERN, 'taps-json'), 'utf8'));
  const trajectory = JSON.parse(fs.readFileSync(path.join(CAVERN, 'ir-json'), 'utf8'));
  assert.equal(Array.isArray(media.extras.taps), false, 'the media envelope stores a count, not an array');
  assert.equal(tapsFrom(media).length, 135, 'the media envelope extracts via extras.tap_map.taps');
  assert.equal(tapsFrom(trajectory).length, 135, 'the trajectory envelope extracts via extras.taps');

  const record = BAKERS.ir(
    { id: 'ir-cavern' },
    {
      files: new Map([['result', fs.readFileSync(path.join(CAVERN, 'result.wav'))], ['taps', Buffer.from(JSON.stringify(media))]]),
      result: null,
      bake: { type: 'ir', name: 'cavern' },
      job: { id: 'ir-cavern' },
      publicDir: '/moth/files/ir-cavern',
    },
  );
  assert.equal(record.bucket, 'irs');
  assert.equal(record.value.url, '/moth/files/ir-cavern/result.wav');
  assert.equal(record.value.taps.length, 64, 'the ir record caps taps as before');
  assert.ok(record.value.taps[0].fRe > 0, 'taps carry the compact fRe/fIm shape');
});

test('the regenerated module carries the cavern taps and no embedded audio', async () => {
  const { MOTH_BAKED } = await import('../game/moth-baked.mjs');
  assert.ok(MOTH_BAKED.irs.cavern.taps.length > 0, 'the shipped cavern record is no longer empty');
  for (const bucket of ['audio', 'spaces', 'irs']) {
    for (const record of Object.values(MOTH_BAKED[bucket] || {})) {
      assert.notEqual(typeof record.data, 'string', `${bucket} descriptors must not embed base64 audio`);
    }
  }
});

test('the audio-completion batch descriptors are baked without embedded audio', async () => {
  const { MOTH_BAKED } = await import('../game/moth-baked.mjs');
  const arena = MOTH_BAKED.spaces.arena;
  assert.equal(arena.lattice, 'square');
  assert.equal(arena.sites, 24, 'the 6x4=24 echo map keeps its site count');
  assert.equal(arena.depth, 8);
  assert.equal(arena.seed, 12345);
  assert.ok(arena.count > 0 && arena.taps.length > 0);

  const tunnel = MOTH_BAKED.irs.tunnel;
  assert.equal(tunnel.url, '/moth/files/ir-tunnel/result.wav');
  assert.ok(tunnel.seconds > 3 && tunnel.seconds < 4, 'the 3.5 s corridor IR');
  assert.ok(tunnel.taps.length > 0, 'the IR carries a compact tap map');

  for (const name of ['moth-victory', 'moth-defeat']) {
    const motif = MOTH_BAKED.motifs[name];
    assert.ok(motif, `${name} is baked`);
    assert.ok(motif.notes.length > 0, `${name} has notes`);
    assert.equal(motif.bpm, 120);
  }
  for (const bucket of ['audio', 'spaces', 'irs']) {
    for (const record of Object.values(MOTH_BAKED[bucket] || {})) {
      assert.notEqual(typeof record.data, 'string', `${bucket} descriptors must not embed base64 audio`);
    }
  }
});

// ---------------------------------------------------------------------------
// WAV codec
// ---------------------------------------------------------------------------

test('the WAV codec round-trips PCM and mixdowns channels', () => {
  const left = Float32Array.from([0, 0.5, -0.5, 1, -1]);
  const right = Float32Array.from([0, -0.5, 0.5, -1, 1]);
  const wav = encodeWav([left, right], { sampleRate: 8000, format: 'pcm16' });
  const decoded = decodeWav(wav);
  assert.equal(decoded.channels, 2);
  assert.equal(decoded.frames, 5);
  assert.ok(Math.abs(decoded.channelData[0][3] - 1) < 1e-4);
  const mono = mixdownChannels(decoded.channelData);
  assert.equal(mono.length, 5);
  assert.ok(Math.abs(mono[3]) < 1e-4, 'opposite channels cancel in the mixdown');

  const floatWav = encodeWav([left], { sampleRate: 8000, format: 'float32' });
  const floatDecoded = decodeWav(floatWav);
  assert.equal(floatDecoded.format, 'float');
  assert.ok(Math.abs(floatDecoded.channelData[0][2] + 0.5) < 1e-6);
});

test('loop detection and seam crossfade are deterministic', () => {
  const sampleRate = 8000;
  const samples = new Float32Array(sampleRate * 2);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 220 * (i / sampleRate)) * 0.4;
  const first = detectLoop([samples], sampleRate, { searchSeconds: 0.25, windowSeconds: 0.01 });
  const second = detectLoop([samples], sampleRate, { searchSeconds: 0.25, windowSeconds: 0.01 });
  assert.deepEqual(first, second);
  assert.ok(first.loopEnd > 0 && first.loopEnd <= 2);

  const loopEnd = Math.round(1.5 * sampleRate);
  const faded = crossfadeAtSeam([samples], 0, loopEnd, 400);
  assert.equal(faded[0].length, samples.length);
  assert.notDeepEqual([...faded[0].subarray(0, 8)], [...samples.subarray(0, 8)], 'the seam head is blended');
});

test('linear resampling changes the frame count deterministically', () => {
  const samples = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 40));
  const resampled = resampleLinear([samples], 1000, 500);
  assert.equal(resampled[0].length, 500);
  const doubled = resampleLinear([samples], 500, 1000);
  assert.equal(doubled[0].length, 2000);
});

// ---------------------------------------------------------------------------
// audio-clip
// ---------------------------------------------------------------------------

test('audio-clip writes a hosted WAV and a descriptor with loop math', () => {
  const dir = tmpDir('clip');
  try {
    const ctx = {
      files: new Map([['result', toneWav(2, 8000)]]),
      dir,
      rawName: 'bed-ritual',
      publicDir: '/moth/files/bed-ritual',
      bake: { type: 'audio-clip', name: 'bed-ritual', bucket: 'audio', mixdown: true, normalize: true, peak: 0.9, loopStart: 0.25, loopEnd: 1.5, targetSampleRate: 4000 },
    };
    const record = BAKERS['audio-clip']({ id: 'bed-ritual' }, ctx);
    assert.equal(record.bucket, 'audio');
    assert.equal(record.key, 'bed-ritual');
    const value = record.value;
    assert.equal(value.url, '/moth/files/bed-ritual/clip.wav');
    assert.equal(value.sampleRate, 4000);
    assert.equal(value.channels, 1);
    assert.equal(value.loopStart, 0.25);
    assert.equal(value.loopEnd, 1.5);
    assert.equal(value.sampleFormat, 'pcm16');
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'data'), false, 'large clips are not embedded');
    assert.ok(value.gain > 0);
    assert.ok(fs.existsSync(path.join(dir, 'clip.wav')), 'the processed WAV is written next to the raw result');
    const written = decodeWav(fs.readFileSync(path.join(dir, 'clip.wav')));
    assert.equal(written.sampleRate, 4000);
    assert.ok(Math.abs(wavInfo(fs.readFileSync(path.join(dir, 'clip.wav'))).seconds - value.seconds) < 1e-3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('audio-clip detectLoop and maxSeconds are deterministic', () => {
  const dir = tmpDir('clip-loop');
  try {
    const make = (bake) => BAKERS['audio-clip']({ id: 'bed' }, {
      files: new Map([['result', toneWav(2, 8000)]]),
      dir,
      rawName: 'bed',
      publicDir: '/moth/files/bed',
      bake: { type: 'audio-clip', name: 'bed', mixdown: true, detectLoop: true, loopSearch: 0.3, loopWindow: 0.01, maxSeconds: 1.75, normalize: false, ...bake },
    }).value;
    const first = make({});
    const second = make({});
    assert.deepEqual([first.loopStart, first.loopEnd, first.seconds], [second.loopStart, second.loopEnd, second.seconds]);
    assert.ok(first.loopStart >= 0 && first.loopEnd <= first.seconds + 1e-9);
    assert.ok(first.seconds <= 1.75 + 1e-6, 'maxSeconds trims the clip');
    assert.ok(first.loopScore !== undefined, 'a detected loop records its score');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('audio-clip rejects an out-of-range loop window', () => {
  const dir = tmpDir('clip-bad');
  try {
    assert.throws(() => BAKERS['audio-clip']({ id: 'x' }, {
      files: new Map([['result', toneWav(1, 8000)]]),
      dir,
      rawName: 'x',
      publicDir: '/moth/files/x',
      bake: { type: 'audio-clip', name: 'x', loopStart: 0.5, loopEnd: 0.25 },
    }), /loopStart/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// echo-map
// ---------------------------------------------------------------------------

test('echo-map compacts a trajectory envelope from extras.taps', () => {
  const envelope = {
    result_type: 'trajectory',
    provenance: { seed: 12345 },
    data: { sites: 20, steps: 8 },
    extras: { lattice: 'square', spec: { n_sites: 20, depth: 8, lattice: 'square', seed: 12345 }, taps: [{ site: 4, depth: 2, F_re: 0.8123, F_im: -0.004, level: 0.8123, polarity: 1, x: 1, y: 2, time_ms: 160 }] },
  };
  const record = BAKERS['echo-map']({ id: 'echo-arena' }, {
    result: envelope,
    bake: { type: 'echo-map', name: 'arena', bucket: 'spaces', maxTaps: 128 },
    job: { id: 'echo-arena' },
    rawName: 'echo-arena',
    publicDir: '/moth/files/echo-arena',
  });
  assert.equal(record.bucket, 'spaces');
  assert.equal(record.value.count, 1);
  assert.equal(record.value.lattice, 'square');
  assert.equal(record.value.sites, 20);
  assert.equal(record.value.depth, 8);
  assert.equal(record.value.seed, 12345);
  assert.equal(record.value.taps[0].fRe, 0.8123);
  assert.equal(record.value.taps[0].timeMs, 160);
});

test('echo-map reads metadata from the real otoc-echo { output } envelope', () => {
  const envelope = {
    output: {
      result_type: 'trajectory',
      data: { sites: 24, steps: 8 },
      extras: {
        lattice: 'square', width: 6, height: 4,
        spec: { n_sites: 24, depth: 8, lattice: 'square', seed: 777 },
        taps: [{ site: 0, depth: 5, F_re: 0.9, F_im: 0.01, level: 0.9, polarity: 1, x: 0, y: 0 }],
      },
      provenance: { seed: 777 },
    },
  };
  const record = BAKERS['echo-map']({ id: 'echo-arena' }, {
    result: envelope,
    bake: { type: 'echo-map', name: 'arena', bucket: 'spaces', maxTaps: 128 },
    job: { id: 'echo-arena' },
    rawName: 'echo-arena',
    publicDir: '/moth/files/echo-arena',
  });
  assert.equal(record.bucket, 'spaces');
  assert.equal(record.value.lattice, 'square', 'the wrapper is unwrapped for lattice');
  assert.equal(record.value.sites, 24);
  assert.equal(record.value.depth, 8);
  assert.equal(record.value.seed, 777);
  assert.equal(record.value.count, 1);
});

test('echo-map reads a data.extras.taps envelope from a JSON slot', () => {
  const record = BAKERS['echo-map']({ id: 'echo-x' }, {
    result: null,
    files: new Map([['result', Buffer.from(JSON.stringify({ data: { extras: { taps: [{ site: 1, depth: 1, level: 0.5, F_re: 0.5 }] } } }))]]),
    bake: { type: 'echo-map', name: 'x' },
    job: { id: 'echo-x' },
    rawName: 'echo-x',
    publicDir: '/moth/files/echo-x',
  });
  assert.equal(record.value.count, 1);
  assert.equal(record.value.taps[0].fRe, 0.5);
});

// ---------------------------------------------------------------------------
// makeSourceAudio + offline repair
// ---------------------------------------------------------------------------

test('makeSourceAudio is a deterministic original mono WAV', () => {
  const first = makeSourceAudio({ name: 'bed-seed' });
  const second = makeSourceAudio({ name: 'bed-seed' });
  assert.ok(first.equals(second), 'the same spec yields byte-identical audio');
  const info = wavInfo(first);
  assert.equal(info.sampleRate, 22050);
  assert.equal(info.channels, 1);
  assert.ok(info.seconds > 7.9 && info.seconds < 8.1);
  assert.ok(info.frames > 0);
  assert.notDeepEqual([...first.subarray(44, 64)], new Array(20).fill(0), 'the seed is not silence');
});

test('rebuildLocalBakes repairs ir/echo-map records from committed raw files', () => {
  const dir = tmpDir('repair');
  try {
    const jobDir = path.join(dir, 'ir-test');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'result.wav'), toneWav(1, 8000));
    fs.writeFileSync(path.join(jobDir, 'taps-json'), JSON.stringify({ extras: { taps: [{ site: 0, depth: 1, F_re: 0.9, F_im: 0, level: 0.9 }] } }));
    const manifest = { jobs: [{ id: 'ir-test', engine: 'retrocausal-echo-v1', enabled: true, raw: 'ir-test', bake: { type: 'ir', name: 'test' } }] };
    const rebuilt = rebuildLocalBakes({ filesDir: dir, manifest, log: () => {} });
    assert.equal(rebuilt.irs.test.taps.length, 1);
    assert.equal(rebuilt.irs.test.url, '/moth/files/ir-test/result.wav');
    assert.ok(rebuilt.irs.test.seconds > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rebuildLocalBakes repairs an audio-clip descriptor from a committed result.wav', () => {
  const dir = tmpDir('repair-clip');
  try {
    const jobDir = path.join(dir, 'bed-test');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'result.wav'), toneWav(2, 8000));
    const manifest = {
      jobs: [{
        id: 'bed-test', engine: 'qrc-audio-v1', enabled: true, raw: 'bed-test',
        bake: { type: 'audio-clip', name: 'bed-test', bucket: 'audio', mixdown: true, embed: false, urlBase: '/moth/files', loopStart: 0.25, loopEnd: 1.5, normalize: true, peak: 0.9 },
      }],
    };
    const rebuilt = rebuildLocalBakes({ filesDir: dir, manifest, log: () => {} });
    const record = rebuilt.audio['bed-test'];
    assert.ok(record, 'the audio bucket is rebuilt offline');
    assert.equal(record.url, '/moth/files/bed-test/clip.wav');
    assert.equal(record.file, 'clip.wav');
    assert.equal(record.loopStart, 0.25);
    assert.equal(record.loopEnd, 1.5);
    assert.equal(Object.prototype.hasOwnProperty.call(record, 'data'), false, 'a repaired clip is not embedded');
    assert.ok(fs.existsSync(path.join(jobDir, 'clip.wav')), 'the processed WAV is written next to the raw result');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readLocalResult maps legacy and current download names to slots', () => {
  const dir = tmpDir('local');
  try {
    fs.writeFileSync(path.join(dir, 'result.wav'), Buffer.from([1]));
    fs.writeFileSync(path.join(dir, 'ir-json'), Buffer.from('{"a":1}'));
    fs.writeFileSync(path.join(dir, 'result.json'), Buffer.from('{"result_type":"x"}'));
    const { files, result } = readLocalResult(dir);
    assert.ok(files.has('result') && files.has('ir'));
    assert.equal(files.get('result').length, 1, 'result.wav wins slot result');
    assert.deepEqual(result, { result_type: 'x' });
    assert.equal(files.has('result-envelope'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

test('committed audio and the generated module stay within budget', async () => {
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() ? [full] : [];
    });
  };
  const wavBytes = walk(path.join(ROOT, 'public/moth')).filter((file) => file.endsWith('.wav')).reduce((sum, file) => sum + fs.statSync(file).size, 0);
  assert.ok(wavBytes <= 15 * 1024 * 1024, `committed Moth WAVs are ${wavBytes} bytes (budget 15 MiB)`);
  const moduleBytes = fs.statSync(path.join(ROOT, 'game/moth-baked.mjs')).size;
  // Raised from 1.5 MiB for the v8.6 paid Moth batch (nine surface variants, two
  // LUTs, one sky, two scalar fields and a 16-frame QRC sheet). The next asset
  // growth must move to URL-backed textures instead of raising this again — see
  // docs/design/MOTH-GRAPHICS-PLAN.md §9.
  assert.ok(moduleBytes < 2 * 1024 * 1024, `moth-baked.mjs is ${moduleBytes} bytes (budget 2 MiB)`);
});
