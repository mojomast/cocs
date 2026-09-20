import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BUCKETS, emptyBaked, mergeBakedRecords, validateBakedForPublish, writeFileAtomic,
  writeModule, downloadOutputs, resolveResult, runManifest, planDryRun, normalizeContentType, encodePng,
} from '../scripts/moth-bake.mjs';

// These tests exercise the publish-integrity runner offline: every network call
// goes through an injected fetchImpl and every scratch file lives under
// /tmp/opencode.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Prefer the harness-scoped temp dir; fall back to the platform temp dir.
const TMP_ROOT = fs.existsSync('/tmp/opencode') ? '/tmp/opencode' : os.tmpdir();
const tmpDir = (name) => fs.mkdtempSync(path.join(TMP_ROOT, `moth-run-${name}-`));
const cleanup = (t, dir) => t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// A real run requires a key before it touches the (injected) network; the stub
// never sees it, so a fake value keeps the tests offline and deterministic.
async function withTestKey(fn) {
  const previous = process.env.MOTH_API_KEY;
  process.env.MOTH_API_KEY = 'test-key';
  try { return await fn(); } finally {
    if (previous === undefined) delete process.env.MOTH_API_KEY;
    else process.env.MOTH_API_KEY = previous;
  }
}

let importSeq = 0;
const loadModule = (file) => import(`${pathToFileURL(file).href}?v=test-${++importSeq}`);
const moduleText = (baked) => `export const MOTH_BAKED = ${JSON.stringify(baked, null, 2)};\n\nexport default MOTH_BAKED;\n`;

function responseLike({ status, headers, buffer, text }) {
  const map = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : '',
    headers: { get: (name) => map[String(name).toLowerCase()] ?? null },
    text: async () => text,
    arrayBuffer: async () => buffer,
  };
}
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const text = JSON.stringify(body);
  return responseLike({ status, headers: { 'content-type': 'application/json', ...headers }, buffer: Buffer.from(text), text });
}
function binaryResponse(buffer, contentType, { status = 200 } = {}) {
  return responseLike({ status, headers: contentType ? { 'content-type': contentType } : {}, buffer, text: buffer.toString('utf8') });
}

function tinyPng(size = 4) {
  const rgb = new Uint8Array(size * size * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37) % 256;
  return encodePng(size, size, rgb);
}

// ---------------------------------------------------------------------------
// Merge-safe publication
// ---------------------------------------------------------------------------

test('mergeBakedRecords replaces selected keys and preserves unrelated records', () => {
  const previous = emptyBaked(2);
  previous.textures.rock = { width: 1, data: 'old-rock' };
  previous.textures.sand = { width: 1, data: 'sand' };
  previous.sky.nebula = { width: 2 };
  previous.provenance['tex-rock'] = { engine: 'blur-v1', jobId: 'old-rock' };
  previous.provenance['tex-sand'] = { engine: 'blur-v1', jobId: 'sand' };

  const fresh = emptyBaked(2);
  fresh.textures.rock = { width: 2, data: 'new-rock' };
  fresh.textures.ice = { width: 3, data: 'new-ice' };
  fresh.materials.lut = { size: 4 };
  fresh.provenance['tex-rock'] = { engine: 'blur-v1', jobId: 'new-rock' };
  fresh.provenance['tex-ice'] = { engine: 'blur-v1', jobId: 'new-ice' };

  const merged = mergeBakedRecords(previous, fresh);
  assert.deepEqual(merged.textures.rock, { width: 2, data: 'new-rock' }, 'selected key replaced');
  assert.deepEqual(merged.textures.sand, { width: 1, data: 'sand' }, 'unrelated texture kept');
  assert.deepEqual(merged.textures.ice, { width: 3, data: 'new-ice' }, 'first-seen key added');
  assert.deepEqual(merged.materials.lut, { size: 4 }, 'first-seen bucket key added');
  assert.deepEqual(merged.sky.nebula, { width: 2 }, 'unrelated bucket kept');
  assert.deepEqual(merged.provenance['tex-rock'], { engine: 'blur-v1', jobId: 'new-rock' }, 'selected provenance replaced');
  assert.deepEqual(merged.provenance['tex-sand'], { engine: 'blur-v1', jobId: 'sand' }, 'unrelated provenance kept');
  assert.equal(mergeBakedRecords(null, fresh), fresh, 'no previous registry publishes the run as-is');

  // Effect frames accumulate per index across jobs and runs, so a partial run
  // must not drop or shift the frames it did not bake.
  previous.effects.rift = { fps: 10, frames: [{ i: 0 }, { i: 1 }] };
  const frameRun = emptyBaked(2);
  frameRun.effects.rift = { fps: 12, frames: [undefined, { i: 9 }] };
  const effect = mergeBakedRecords(previous, frameRun).effects.rift;
  assert.deepEqual(effect.frames, [{ i: 0 }, { i: 9 }], 'untouched frame 0 kept, selected frame 1 replaced');
  assert.equal(effect.fps, 12, 'fresh fps wins');
});

test('validateBakedForPublish rejects malformed, non-JSON-safe and unprovenanced aggregates', () => {
  const baked = emptyBaked(2);
  baked.provenance['job-a'] = { engine: 'blur-v1', jobId: 'j-a' };
  for (const bucket of BUCKETS) assert.ok(baked[bucket], `${bucket} is initialized`);
  assert.equal(validateBakedForPublish(baked, ['job-a']), baked, 'a valid aggregate passes');

  assert.throws(() => validateBakedForPublish({ ...baked, textures: undefined }), /textures/);
  assert.throws(() => validateBakedForPublish(baked, ['job-b']), /job-b/);

  const withFunction = emptyBaked(2);
  withFunction.provenance['job-a'] = { engine: 'blur-v1' };
  withFunction.textures.bad = { bake: () => {} };
  assert.throws(() => validateBakedForPublish(withFunction, ['job-a']), /function/);

  const withUndefined = emptyBaked(2);
  withUndefined.provenance['job-a'] = { engine: 'blur-v1' };
  withUndefined.normals.rock = { width: undefined };
  assert.throws(() => validateBakedForPublish(withUndefined, ['job-a']), /undefined/);

  const withHole = emptyBaked(2);
  withHole.provenance['job-a'] = { engine: 'blur-v1' };
  withHole.effects.rift = { frames: [undefined] };
  assert.throws(() => validateBakedForPublish(withHole, ['job-a']), /undefined|hole/);

  const withNaN = emptyBaked(2);
  withNaN.provenance['job-a'] = { engine: 'blur-v1' };
  withNaN.materials.lut = { gain: NaN };
  assert.throws(() => validateBakedForPublish(withNaN, ['job-a']), /NaN/);
});

test('writeModule validates before publishing and leaves the previous module intact', async (t) => {
  const dir = tmpDir('module');
  cleanup(t, dir);
  const modulePath = path.join(dir, 'moth-baked.mjs');
  const original = '// previous registry\n';
  fs.writeFileSync(modulePath, original);

  const baked = emptyBaked(2);
  baked.provenance['job-a'] = { engine: 'blur-v1', jobId: 'j-a' };
  baked.textures.good = { width: 4, height: 4, data: 'AAAA' };

  const text = writeModule(baked, { modulePath, expectedProvenance: ['job-a'], log: () => {} });
  assert.equal(fs.readFileSync(modulePath, 'utf8'), text);
  const mod = await loadModule(modulePath);
  assert.deepEqual(mod.MOTH_BAKED.textures.good, baked.textures.good);
  assert.deepEqual(Object.keys(mod.MOTH_BAKED), ['version', 'generator', ...BUCKETS, 'provenance']);

  // A validation failure must not touch the already-published bytes.
  const bad = emptyBaked(2);
  bad.textures.bad = { bake: () => {} };
  assert.throws(() => writeModule(bad, { modulePath, expectedProvenance: [], log: () => {} }));
  assert.equal(fs.readFileSync(modulePath, 'utf8'), text, 'previous module bytes unchanged');
  assert.ok(!fs.readdirSync(dir).some((name) => name.includes('.tmp')), 'no temp files left behind');
});

test('writeFileAtomic replaces the target via temp files and cleans up on failure', (t) => {
  const dir = tmpDir('atomic');
  cleanup(t, dir);
  const target = path.join(dir, 'out.bin');
  fs.writeFileSync(target, 'original');

  writeFileAtomic(target, 'replacement');
  assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
  assert.deepEqual(fs.readdirSync(dir), ['out.bin'], 'temp renamed away');

  assert.throws(() => writeFileAtomic(target, Symbol('not-a-chunk')));
  assert.equal(fs.readFileSync(target, 'utf8'), 'replacement', 'original survives a failed write');
  assert.deepEqual(fs.readdirSync(dir), ['out.bin'], 'temp removed after failure');
});

// ---------------------------------------------------------------------------
// Cached-job safety
// ---------------------------------------------------------------------------

test('cached status failures and non-completed states refuse to resubmit without --force', async () => {
  let submissions = 0;
  const trackPost = (respond) => async (url, init = {}) => {
    if (init.method === 'POST') { submissions++; return jsonResponse({ job_id: 'fresh' }); }
    return respond(url);
  };

  const cached = { id: 'tex-a', engine: 'blur-v1', jobId: 'cached-1', params: {} };
  const networkDown = trackPost(async () => { throw new Error('network down'); });
  await assert.rejects(resolveResult('key', cached, () => {}, false, { fetchImpl: networkDown }), (error) => {
    assert.match(error.message, /tex-a/);
    assert.match(error.message, /cached-1/);
    assert.match(error.message, /network down/);
    assert.match(error.message, /--force/);
    return true;
  });

  const stillFailed = trackPost(async () => jsonResponse({ status: 'failed', error: { message: 'engine boom' } }));
  await assert.rejects(resolveResult('key', cached, () => {}, false, { fetchImpl: stillFailed }), /cached-1.*failed.*--force/s);
  assert.equal(submissions, 0, 'no fresh paid job was submitted');
  assert.equal(cached.jobId, 'cached-1', 'the cached id is kept');

  // `--force` is the explicit escape hatch and does submit a fresh job.
  let forced = 0;
  const forceFetch = async (url, init = {}) => {
    if (init.method === 'POST') { forced++; return jsonResponse({ job_id: 'fresh-1' }); }
    if (String(url).includes('/status')) return jsonResponse({ status: 'completed' });
    if (String(url).includes('/result')) return jsonResponse({ output: { ok: true } });
    throw new Error(`unexpected request ${url}`);
  };
  const result = await resolveResult('key', { ...cached }, () => {}, true, { fetchImpl: forceFetch });
  assert.equal(forced, 1);
  assert.deepEqual(result, { output: { ok: true } });
});

test('the paid job id is persisted immediately after submit, before the wait', async () => {
  const saved = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST') return jsonResponse({ job_id: 'paid-7' });
    if (String(url).includes('/status')) return jsonResponse({ status: 'failed', error: { message: 'quota' } });
    throw new Error(`unexpected request ${url}`);
  };
  const job = { id: 'tex-b', engine: 'blur-v1', params: {} };
  await assert.rejects(
    resolveResult('key', job, () => {}, false, { fetchImpl, save: () => saved.push({ ...job }) }),
    /paid-7.*failed/s,
  );
  assert.equal(job.jobId, 'paid-7', 'the id survives the failed wait');
  assert.deepEqual(saved, [{ id: 'tex-b', engine: 'blur-v1', params: {}, jobId: 'paid-7' }], 'the manifest was written right after submit');
});

// ---------------------------------------------------------------------------
// Download validation
// ---------------------------------------------------------------------------

test('downloadOutputs rejects non-2xx, mismatched content types and empty bodies', async (t) => {
  const dir = tmpDir('download');
  cleanup(t, dir);
  const output = { slot: 'result', url: 'https://download.test/result.png', content_type: 'image/png' };
  const png = tinyPng();

  await assert.rejects(
    downloadOutputs({ outputs: [output] }, dir, () => {}, { fetchImpl: async () => binaryResponse(png, 'image/png', { status: 403 }) }),
    /download\.test\/result\.png -> 403/,
  );
  await assert.rejects(
    downloadOutputs({ outputs: [output] }, dir, () => {}, { fetchImpl: async () => binaryResponse(png, 'text/html') }),
    /content-type "text\/html" does not match the declared "image\/png"/,
  );
  await assert.rejects(
    downloadOutputs({ outputs: [output] }, dir, () => {}, { fetchImpl: async () => binaryResponse(Buffer.alloc(0), 'image/png') }),
    /empty body/,
  );
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing was written by the failures');

  const files = await downloadOutputs(
    { outputs: [output], result: { output: { value: 1 } } },
    dir,
    () => {},
    { fetchImpl: async () => binaryResponse(png, 'image/png; charset=binary') },
  );
  assert.deepEqual(files.get('result'), png, 'parameters in the response type are normalized');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'result.png')), png);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')), { output: { value: 1 } });
  assert.ok(!fs.readdirSync(dir).some((name) => name.includes('.tmp')), 'no temp files left behind');
  assert.equal(normalizeContentType('IMAGE/PNG; charset=utf-8'), 'image/png');
  assert.equal(normalizeContentType(null), '');
});

// ---------------------------------------------------------------------------
// Whole-run behavior: merge, atomic publish, empty runs
// ---------------------------------------------------------------------------

test('runManifest merges a selected job over the published registry', async (t) => {
  const dir = tmpDir('merge-run');
  cleanup(t, dir);
  const modulePath = path.join(dir, 'moth-baked.mjs');
  const manifestPath = path.join(dir, 'manifest.json');
  const filesDir = path.join(dir, 'files');

  const previous = emptyBaked(2);
  previous.textures.rock = { width: 1, height: 1, data: 'old-rock' };
  previous.textures.sand = { width: 1, height: 1, data: 'sand' };
  previous.provenance['tex-rock'] = { engine: 'blur-v1', jobId: 'old-rock', mode: 'emu', name: 'rock', credits: 1 };
  previous.provenance['tex-sand'] = { engine: 'blur-v1', jobId: 'sand', mode: 'emu', name: 'sand', credits: 1 };
  fs.writeFileSync(modulePath, moduleText(previous));

  const manifest = { version: 2, jobs: [
    { id: 'tex-rock', engine: 'blur-v1', jobId: 'cached-rock', raw: 'rock', params: { mode: 'emu' }, bake: { type: 'texture-tile', name: 'rock', size: 4 } },
    { id: 'tex-sand', engine: 'blur-v1', raw: 'sand', params: {}, bake: { type: 'texture-tile', name: 'sand', size: 4 } },
  ] };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, manifestText);

  const png = tinyPng();
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/status')) return jsonResponse({ status: 'completed' });
    if (target.includes('/process') || target.includes('/result')) {
      return jsonResponse({ result: {}, outputs: [{ slot: 'result', url: 'https://download.test/rock.png', content_type: 'image/png' }] });
    }
    if (target === 'https://download.test/rock.png') return binaryResponse(png, 'image/png');
    throw new Error(`unexpected request ${target}`);
  };

  const result = await withTestKey(() => runManifest({ only: 'tex-rock', manifestPath, modulePath, filesDir, fetchImpl, log: () => {} }));
  assert.deepEqual(result.failures, []);
  assert.equal(result.wrote, true);
  assert.equal(result.baked.textures.sand.data, 'sand', 'unselected record kept');
  assert.notEqual(result.baked.textures.rock.data, 'old-rock', 'selected record replaced');
  assert.equal(result.baked.provenance['tex-sand'].jobId, 'sand');
  assert.equal(result.baked.provenance['tex-rock'].jobId, 'cached-rock');

  const mod = await loadModule(modulePath);
  assert.equal(mod.MOTH_BAKED.textures.sand.data, 'sand');
  assert.equal(mod.MOTH_BAKED.textures.rock.width, 4);
  assert.equal(mod.MOTH_BAKED.provenance['tex-rock'].jobId, 'cached-rock');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestText, 'an unchanged manifest is left byte-identical');
});

test('a first bake with no published registry writes the run as-is', async (t) => {
  const dir = tmpDir('first-run');
  cleanup(t, dir);
  const modulePath = path.join(dir, 'moth-baked.mjs');
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ version: 2, jobs: [
    { id: 'tex-ice', engine: 'blur-v1', raw: 'ice', params: {}, bake: { type: 'texture-tile', name: 'ice', size: 4 } },
  ] }, null, 2)}\n`);

  const png = tinyPng();
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/process')) return jsonResponse({ job_id: 'fresh-ice' });
    if (target.includes('/status')) return jsonResponse({ status: 'completed' });
    if (target.includes('/result')) return jsonResponse({ outputs: [{ slot: 'result', url: 'https://download.test/ice.png', content_type: 'image/png' }] });
    if (target === 'https://download.test/ice.png') return binaryResponse(png, 'image/png');
    throw new Error(`unexpected request ${target}`);
  };

  const result = await withTestKey(() => runManifest({ manifestPath, modulePath, filesDir: path.join(dir, 'files'), fetchImpl, log: () => {} }));
  assert.deepEqual(result.failures, []);
  assert.equal(result.wrote, true);
  const mod = await loadModule(modulePath);
  assert.equal(mod.MOTH_BAKED.textures.ice.width, 4);
  assert.equal(mod.MOTH_BAKED.provenance['tex-ice'].jobId, 'fresh-ice');
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).jobs[0].jobId, 'fresh-ice', 'the paid id was written to the manifest');
  assert.deepEqual(Object.keys(mod.MOTH_BAKED.textures), ['ice'], 'no phantom records');
});

test('a run with no successful jobs leaves the published module byte-identical', async (t) => {
  const dir = tmpDir('failed-run');
  cleanup(t, dir);
  const modulePath = path.join(dir, 'moth-baked.mjs');
  const manifestPath = path.join(dir, 'manifest.json');

  const previous = emptyBaked(2);
  previous.textures.rock = { width: 1, height: 1, data: 'last-good' };
  previous.provenance['tex-rock'] = { engine: 'blur-v1', jobId: 'cached-rock' };
  const before = moduleText(previous);
  fs.writeFileSync(modulePath, before);
  fs.writeFileSync(manifestPath, `${JSON.stringify({ version: 2, jobs: [
    { id: 'tex-rock', engine: 'blur-v1', params: {}, bake: { type: 'texture-tile', name: 'rock' } },
  ] }, null, 2)}\n`);

  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST') return jsonResponse({ job_id: 'paid-fail' });
    if (String(url).includes('/status')) return jsonResponse({ status: 'failed', error: { message: 'engine exploded' } });
    throw new Error(`unexpected request ${url}`);
  };
  const result = await withTestKey(() => runManifest({ manifestPath, modulePath, filesDir: path.join(dir, 'files'), fetchImpl, log: () => {} }));
  assert.equal(result.failures.length, 1);
  assert.equal(result.wrote, false);
  assert.equal(fs.readFileSync(modulePath, 'utf8'), before, 'published bytes untouched');
  assert.match(fs.readFileSync(manifestPath, 'utf8'), /paid-fail/, 'the paid id was persisted');
});

// ---------------------------------------------------------------------------
// Dry-run planning
// ---------------------------------------------------------------------------

test('planDryRun reports unknown engines, bake types and missing inputs without writing', (t) => {
  const root = tmpDir('plan');
  cleanup(t, root);
  fs.mkdirSync(path.join(root, 'assets/moth/sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/moth/sources/panel.png'), 'source');

  const manifest = { version: 2, jobs: [
    { id: 'ok-reuse', engine: 'blur-v1', jobId: 'cached-2', input: { image: 'sources/panel.png' }, bake: { type: 'texture-tile', name: 'ok' } },
    { id: 'ok-submit', engine: 'blur-core-v1', generateValues: { type: 'height' }, bake: { type: 'normal-map', name: 'ok' } },
    { id: 'bad-engine', engine: 'blur-v9', bake: { type: 'texture-tile' } },
    { id: 'bad-bake', engine: 'blur-v1', bake: { type: 'not-a-baker' } },
    { id: 'bad-generator', engine: 'blur-core-v1', generateValues: { type: 'not-a-generator' }, bake: { type: 'normal-map' } },
    { id: 'bad-input', engine: 'blur-v1', input: { image: 'sources/missing.png' }, bake: { type: 'texture-tile' } },
    { id: 'disabled', engine: 'blur-v1', enabled: false, bake: { type: 'texture-tile' } },
  ] };

  const lines = [];
  const { plans, failures } = planDryRun({ manifest, root, log: (line) => lines.push(line) });
  assert.deepEqual(plans.map((plan) => plan.id), ['ok-reuse', 'ok-submit', 'bad-engine', 'bad-bake', 'bad-generator', 'bad-input']);
  assert.deepEqual(failures.map((failure) => failure.id), ['bad-engine', 'bad-bake', 'bad-generator', 'bad-input']);
  assert.equal(plans[0].action, 'reuse');
  assert.equal(plans[1].action, 'submit');
  assert.ok(lines.some((line) => line.includes('would reuse job cached-2')));
  assert.ok(lines.some((line) => line.includes('would submit a new job')));
  assert.ok(lines.some((line) => line.includes('unknown engine "blur-v9"')));
  assert.ok(lines.some((line) => line.includes('input image missing')));
  assert.ok(lines.some((line) => line.includes('disabled')));
  assert.deepEqual(fs.readdirSync(path.join(root, 'assets/moth/sources')), ['panel.png'], 'no plan files were written');
});

test('runManifest --dry plans without writing and an unknown --only id fails loudly', async (t) => {
  const dir = tmpDir('dry');
  cleanup(t, dir);
  const manifestPath = path.join(dir, 'manifest.json');
  const modulePath = path.join(dir, 'moth-baked.mjs');
  const before = `${JSON.stringify({ version: 2, jobs: [
    { id: 'tex-ghosty', engine: 'blur-v9', bake: { type: 'texture-tile' } },
    { id: 'tex-ok', engine: 'blur-v1', jobId: 'cached-3', bake: { type: 'texture-tile', name: 'ok' } },
  ] }, null, 2)}\n`;
  fs.writeFileSync(manifestPath, before);

  const result = await runManifest({ dry: true, manifestPath, modulePath, log: () => {} });
  assert.equal(result.wrote, false);
  assert.equal(fs.existsSync(modulePath), false, 'no module was written');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), before, 'the manifest was not rewritten');
  assert.deepEqual(result.failures.map((failure) => failure.id), ['tex-ghosty']);
  assert.equal(result.failures[0].message, 'unknown engine "blur-v9"');

  await assert.rejects(runManifest({ only: 'ghost', manifestPath, modulePath, log: () => {} }), /--only "ghost"/);
  assert.equal(fs.existsSync(modulePath), false, 'a failed --only writes nothing');
});

test('the CLI dry run exits 0 without writing and an unknown --only exits non-zero', () => {
  const modulePath = path.join(ROOT, 'game/moth-baked.mjs');
  const manifestPath = path.join(ROOT, 'assets/moth/manifest.json');
  const moduleBefore = fs.readFileSync(modulePath, 'utf8');
  const manifestBefore = fs.readFileSync(manifestPath, 'utf8');

  const dry = spawnSync(process.execPath, ['scripts/moth-bake.mjs', 'run', '--dry'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stderr, /Dry run: \d+ job\(s\) planned/);
  assert.equal(fs.readFileSync(modulePath, 'utf8'), moduleBefore, 'dry run left the module untouched');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestBefore, 'dry run left the manifest untouched');

  const missing = spawnSync(process.execPath, ['scripts/moth-bake.mjs', 'run', '--only', 'ghost'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(missing.status, 0, 'an unknown --only id must fail');
  assert.match(missing.stderr, /--only "ghost"/);
});
