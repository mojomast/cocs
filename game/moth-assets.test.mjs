import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureMothAssets, resetMothAssets, mothAssetsStatus,
  mothSurfaceOverride, mothTextureNames, mothMaterialLut, mothMaterialNames,
  mothLevel, mothLevelNames, mothSeed, mothSeedNames, mothMotif, mothProvenance,
} from './moth-assets.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const rgba = (pixels) => Uint8Array.from(pixels.flatMap(([r, g, b, a]) => [r, g, b, a]));

const fixture = () => ({
  version: 9,
  textures: {
    weathered_concrete: { width: 2, height: 2, data: b64(rgba([[1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255], [10, 11, 12, 255]])) },
  },
  materials: {
    entanglement: { size: 2, r: b64(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), t: b64(Uint8Array.from([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])) },
  },
  levels: {
    'moth-backrooms': {
      rows: 1, cols: 2, numQubits: 2, coupling: [[0, 1]],
      cells: [{ i: 0, x: 0.1, y: 0, z: -0.2, radiating: true }, { i: 1, x: 0, y: 0, z: 0.4, radiating: false }],
      measurements: [{ bits: '01', probability: 0.5 }], metrics: { szSamp: 0.25, mode: 'emu', backend: 'aer', shots: 128 },
    },
  },
  seeds: { 'moth-daily': { seed: 16909060, hex: '01020304', bell: 0.9231, certificate: { minEntropy: 0.5 }, mode: 'emu' } },
  motifs: { theme: { notes: [0, 3, 5, 7], bpm: 96 } },
  provenance: { 'blur-panel': { engine: 'blur-v1', jobId: 'job-1', mode: 'emu' } },
});

test('moth assets are inert until configured', () => {
  resetMothAssets();
  assert.equal(mothAssetsStatus().active, false);
  assert.equal(mothSurfaceOverride('weathered_concrete'), null);
  assert.equal(mothMaterialLut('entanglement'), null);
  assert.equal(mothLevel('moth-backrooms'), null);
  assert.equal(mothSeed('moth-daily'), null);
  assert.equal(mothMotif('theme'), null);
  assert.equal(mothProvenance(), null);
  assert.deepEqual(mothTextureNames(), []);
  assert.deepEqual(mothMaterialNames(), []);
  assert.deepEqual(mothLevelNames(), []);
  assert.deepEqual(mothSeedNames(), []);
});

test('configuring exposes decoded textures and material LUTs', () => {
  configureMothAssets(fixture());
  const status = mothAssetsStatus();
  assert.equal(status.active, true);
  assert.equal(status.version, 9);
  assert.deepEqual([status.textures, status.materials, status.levels, status.seeds, status.motifs], [1, 1, 1, 1, 1]);

  const texture = mothSurfaceOverride('weathered_concrete');
  assert.ok(texture.data instanceof Uint8Array);
  assert.deepEqual([texture.width, texture.height, texture.data.length], [2, 2, 16]);
  assert.deepEqual([...texture.data.slice(0, 4)], [1, 2, 3, 255]);
  assert.deepEqual([...texture.data.slice(12, 16)], [10, 11, 12, 255]);
  assert.equal(mothSurfaceOverride('concrete'), null, 'unknown texture kind returns null');

  const lut = mothMaterialLut('entanglement');
  assert.equal(lut.size, 2);
  assert.deepEqual([...lut.r], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual([...lut.t], [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(mothMaterialLut('missing'), null);

  assert.deepEqual(mothTextureNames(), ['weathered_concrete']);
  assert.deepEqual(mothMaterialNames(), ['entanglement']);
  resetMothAssets();
});

test('levels and seeds are returned as isolated copies', () => {
  configureMothAssets(fixture());
  const level = mothLevel('moth-backrooms');
  assert.equal(level.rows, 1);
  assert.equal(level.coupling[0][1], 1);
  level.cells[0].radiating = false;
  level.coupling[0][0] = 99;
  const fresh = mothLevel('moth-backrooms');
  assert.equal(fresh.cells[0].radiating, true, 'mutating a returned level does not touch the registry');
  assert.equal(fresh.coupling[0][0], 0);

  const seed = mothSeed('moth-daily');
  assert.equal(seed.seed, 16909060);
  assert.equal(seed.bell, 0.9231);
  assert.deepEqual([...seed.bytes()], [1, 2, 3, 4]);
  seed.certificate.minEntropy = 0;
  assert.equal(mothSeed('moth-daily').certificate.minEntropy, 0.5, 'seed metadata is copied');

  const motif = mothMotif('theme');
  assert.deepEqual(motif.notes, [0, 3, 5, 7]);
  assert.deepEqual(Object.keys(mothProvenance()), ['blur-panel']);
  resetMothAssets();
});

test('deferred decode results are cached per configuration', () => {
  configureMothAssets(fixture());
  assert.equal(mothSurfaceOverride('weathered_concrete'), mothSurfaceOverride('weathered_concrete'), 'decoded texture is memoized');
  assert.equal(mothMaterialLut('entanglement'), mothMaterialLut('entanglement'), 'decoded LUT is memoized');
  configureMothAssets(fixture());
  assert.notEqual(mothSurfaceOverride('weathered_concrete'), null, 'reconfiguring rebuilds the cache');
  resetMothAssets();
});

test('a malformed configuration degrades to inert rather than throwing', () => {
  configureMothAssets(null);
  assert.equal(mothAssetsStatus().active, false);
  assert.equal(mothSurfaceOverride('weathered_concrete'), null);
  configureMothAssets({ version: 1, textures: { broken: { width: 1, height: 1, data: null } } });
  assert.equal(mothSurfaceOverride('broken'), null, 'undecodable base64 yields null');
  resetMothAssets();
});
