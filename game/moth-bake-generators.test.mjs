import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateValues} from '../scripts/moth-bake.mjs';

// The new effect sequences reuse the existing blur-core-v1 `effect-frame` bake
// type; only the deterministic `generateValues` field generator is new. These
// tests pin the shape the baker and the game both rely on.
const GENERATORS = [
  ['bloom', 23],
  ['vortex', 37],
  ['contract', 53],
  ['rise', 71],
  ['shield', 89],
  ['snow', 107],
];

test('new blur-core generators are bounded, deterministic and distinct per frame', () => {
  for (const [type, seed] of GENERATORS) {
    const frames = [0, 1, 2].map((frame) => generateValues({ generateValues: { type, size: 32, frame, seed } }));
    for (const grid of frames) {
      assert.equal(grid.length, 32, `${type} has 32 rows`);
      for (const row of grid) {
        assert.equal(row.length, 32, `${type} has 32 columns`);
        for (const value of row) {
          assert.ok(Number.isFinite(value), `${type} is finite`);
          assert.ok(value >= 0 && value <= 1, `${type} stays in [0,1]`);
        }
      }
    }
    assert.notDeepEqual(frames[0], frames[1], `${type} frame 0 and 1 differ`);
    assert.notDeepEqual(frames[1], frames[2], `${type} frame 1 and 2 differ`);
    assert.deepEqual(generateValues({ generateValues: { type, size: 32, frame: 1, seed } }), frames[1], `${type} is deterministic`);
  }
});

test('unknown or absent generators return null', () => {
  assert.equal(generateValues({ generateValues: { type: 'not-a-generator' } }), null);
  assert.equal(generateValues({}), null);
});

test('the manifest registers the new effect sequences and reverb spaces', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/moth/manifest.json', import.meta.url), 'utf8'));
  const byId = new Map(manifest.jobs.map((job) => [job.id, job]));
  const sequences = {
    'effect-explosion': 'bloom',
    'effect-teleport': 'vortex',
    'effect-capture-ring': 'contract',
    'effect-heal': 'rise',
    'effect-shield': 'shield',
    'effect-weather-snow': 'snow',
  };
  for (const [name, type] of Object.entries(sequences)) {
    for (let index = 0; index < 3; index++) {
      const job = byId.get(`${name}-${index}`);
      assert.ok(job, `${name}-${index} is registered`);
      assert.equal(job.engine, 'blur-core-v1');
      assert.equal(job.bake.type, 'effect-frame');
      assert.equal(job.bake.name, name);
      assert.equal(job.bake.index, index);
      assert.equal(job.generateValues.type, type);
      assert.ok(job.bake.fps >= 10 && job.bake.fps <= 14, `${name} runs at 10-14 fps`);
    }
  }
  for (const name of ['open-air', 'tunnel', 'hall', 'cathedral']) {
    const job = byId.get(`ir-${name}`);
    assert.ok(job, `ir-${name} is registered`);
    assert.equal(job.engine, 'retrocausal-echo-v1');
    assert.equal(job.bake.type, 'ir');
    assert.equal(job.bake.name, name);
    assert.equal(job.params.emit, 'audio');
  }
  // `cavern` is the pre-existing response and must stay available as the fallback.
  assert.ok(byId.get('ir-cavern'), 'the cavern IR is still registered');
});
