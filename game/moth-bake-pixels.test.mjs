import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAKERS, decodePng, unzip, encodeZip, makeSourceArt, makeQrcVocabulary, generateValues, SOURCE_ART,
  emptyBaked, mergeBakedRecords,
} from '../scripts/moth-bake.mjs';
import { decodeGif, isGif } from '../scripts/moth-gif.mjs';

// ---------------------------------------------------------------------------
// GIF fixtures
// ---------------------------------------------------------------------------
// Small GIF87a/89a streams built offline (literal-code LZW: a clear code before
// every pixel keeps the code size fixed) and committed here as base64, so the
// decoder tests never touch the network or a fixture directory.
//
//   anim        4x4, 3 frames, delays 8cs, disposal keep, loops forever
//   transparent 2x2, frame 1 leaves (0,0) transparent over frame 0 and uses
//               disposal 2, frame 2 is a 1x1 rect that must start from a
//               cleared canvas
//   interlaced  4x4 single interlaced frame, stored rows are not row order
//   gif87a      2x2 GIF87a with no graphic control extension (zero delay)
//   local       2x2 with no global colour table; each frame carries a local
//               table and frame 1 uses disposal 3 (restore previous canvas)
const FIXTURES = {
  anim: 'R0lGODlhBAAEAPEAAAAAAP8AAAD/AAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQECAAAACwAAAAABAAEAAACDQRDcQzFERRHMBzBUAUAIfkEBAgAAAAsAAAAAAQABAAAAg0cRxAcQ1AEQVEMRTEFACH5BAQIAAAALAAAAAAEAAQAAAINDMMwFEVRHMdxBEEQBQA7',
  transparent: 'R0lGODlhAgACAPEAAAAAAP8AAAD/AAAA/yH5BAQKAAAALAAAAAACAAIAAAIEDMMwBQAh+QQJCgAAACwAAAAAAgACAAACBARHcAUAIfkEBAoAAAAsAAAAAAEAAQAAAgJUAQA7',
  interlaced: 'R0lGODlhBAAEAPAAAAAAAP///yH5BAQFAAAALAAAAAAEAAQAQAINBEMwBEMwDMEQDMEQBQA7',
  gif87a: 'R0lGODdhAgACAPAAAAAAAP///ywAAAAAAgACAAACBATDEAUAOw==',
  local: 'R0lGODlhAgACAHAAACH5BAQZAAAALAAAAAACAAIAgQAAAP8AAAD/AAAA/wIEDMMwBQAh+QQMGQAAACwAAAAAAgACAIEAAAAA/wD/AAAAAP8CBAzDMAUAIfkEBBkAAAAsAQABAAEAAQCBAAAAAP8A/wAAAAD/AgJcAQA7',
};
const fixture = (name) => Buffer.from(FIXTURES[name], 'base64');
const pixelAt = (frame, x, y) => Array.from(frame.data.subarray((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4));

// A small blur-core-shaped result for the grid bakers: 4x4 with values 0..3.
const GRID = [
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [3, 0, 1, 2],
];
const gridContext = (bake) => ({ result: { result: { output: GRID } }, bake, job: { id: 'grid-job' } });
const imageContext = (bake, name = 'anim') => ({ files: new Map([['result', fixture(name)]]), bake, job: { id: 'gif-job' } });

// ---------------------------------------------------------------------------
// GIF decoder
// ---------------------------------------------------------------------------

test('decodeGif reads a three-frame animation and composites every frame', () => {
  const gif = decodeGif(fixture('anim'));
  assert.equal(gif.version, '89a');
  assert.equal(gif.width, 4);
  assert.equal(gif.height, 4);
  assert.equal(gif.frames.length, 3);
  assert.equal(gif.loops, 0, 'the animation loops forever');
  assert.equal(gif.fps, 12.5, '8cs delays report 12.5 fps');
  for (const frame of gif.frames) {
    assert.equal(frame.width, 4, 'composited frames share the logical screen size');
    assert.equal(frame.height, 4);
    assert.equal(frame.delay, 0.08);
    assert.equal(frame.delayCs, 8);
    assert.equal(frame.disposal, 1);
    assert.ok(Buffer.isBuffer(frame.data), 'frame data is a Buffer');
    assert.equal(frame.data.length, 4 * 4 * 4);
  }
  assert.notDeepEqual(Buffer.from(gif.frames[0].data), Buffer.from(gif.frames[2].data), 'the frames differ');
  assert.deepEqual(pixelAt(gif.frames[0], 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixelAt(gif.frames[0], 1, 0), [255, 0, 0, 255]);
});

test('decodeGif keeps prior pixels through transparency and clears for disposal 2', () => {
  const gif = decodeGif(fixture('transparent'));
  assert.equal(gif.frames.length, 3);
  assert.equal(gif.fps, 10, '10cs delays report 10 fps');
  assert.equal(gif.frames[0].transparent, null);
  assert.equal(gif.frames[1].transparent, 0);
  assert.equal(gif.frames[1].disposal, 2);
  // Frame 0 painted everything red; frame 1 leaves index 0 transparent.
  assert.deepEqual(pixelAt(gif.frames[1], 0, 0), [255, 0, 0, 255], 'transparent pixel keeps the prior colour');
  assert.deepEqual(pixelAt(gif.frames[1], 1, 0), [0, 0, 255, 255], 'opaque pixel draws blue');
  assert.deepEqual(pixelAt(gif.frames[1], 0, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixelAt(gif.frames[1], 1, 1), [0, 0, 255, 255]);
  // Frame 1 used disposal 2, so frame 2's 1x1 draw starts from a cleared canvas.
  assert.deepEqual(pixelAt(gif.frames[2], 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixelAt(gif.frames[2], 1, 1), [0, 0, 0, 0], 'the cleared pixel stays transparent');
});

test('decodeGif de-interlaces stored rows back to row order', () => {
  const expected = [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0];
  const gif = decodeGif(fixture('interlaced'));
  assert.equal(gif.frames.length, 1);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const wanted = expected[y * 4 + x] * 255;
      assert.deepEqual(pixelAt(gif.frames[0], x, y), [wanted, wanted, wanted, 255], `pixel ${x},${y}`);
    }
  }
});

test('decodeGif guards a zero-delay GIF87a and isGif classifies buffers', () => {
  const gif = decodeGif(fixture('gif87a'));
  assert.equal(gif.version, '87a');
  assert.equal(gif.frames.length, 1);
  assert.equal(gif.frames[0].delayCs, 0);
  assert.equal(gif.fps, 10, 'a delay-less GIF reports the guarded 10 fps');
  assert.equal(gif.loops, null);
  assert.ok(isGif(fixture('gif87a')));
  assert.ok(isGif(fixture('anim')));
  assert.equal(isGif(Buffer.alloc(4)), false);
  assert.equal(isGif(Buffer.from('GIFXXa')), false);
  assert.equal(isGif('GIF89a'), false);
});

test('decodeGif reads per-frame local colour tables and restores for disposal 3', () => {
  const gif = decodeGif(fixture('local'));
  assert.equal(gif.frames.length, 3);
  assert.equal(gif.fps, 4, '25cs delays report 4 fps');
  assert.equal(gif.frames[0].disposal, 1);
  assert.equal(gif.frames[1].disposal, 3);
  assert.deepEqual(pixelAt(gif.frames[0], 0, 0), [255, 0, 0, 255], 'frame 0 reads its local table');
  assert.deepEqual(pixelAt(gif.frames[1], 0, 0), [0, 255, 0, 255], 'frame 1 reads its own local table');
  // Frame 1 used disposal 3, so its canvas is restored before frame 2 draws.
  assert.deepEqual(pixelAt(gif.frames[2], 0, 0), [255, 0, 0, 255], 'the pre-frame-1 canvas is restored');
  assert.deepEqual(pixelAt(gif.frames[2], 1, 1), [0, 0, 255, 255], 'frame 2 draws over the restored canvas');
});

test('decodeGif reports malformed input clearly', () => {
  assert.throws(() => decodeGif(Buffer.alloc(4)), /file too small/);
  assert.throws(() => decodeGif(Buffer.from('notagif!!!!!!')), /not a GIF/);
  const anim = fixture('anim');
  assert.throws(() => decodeGif(anim.subarray(0, 20)), /truncated|no image frames/);
  assert.throws(() => decodeGif(anim.subarray(0, anim.length - 1)), /missing trailer/);
  const badIntroducer = Buffer.from(anim);
  badIntroducer[25] = 0x99; // first byte after the 4-entry global colour table
  assert.throws(() => decodeGif(badIntroducer), /unknown block introducer/);
});

// ---------------------------------------------------------------------------
// Bakers
// ---------------------------------------------------------------------------

test('grid-texture writes a normalized grayscale RGBA record', () => {
  const record = BAKERS['grid-texture']({ id: 'grid-job' }, gridContext({ type: 'grid-texture', name: 'wear-mask', size: 8 }));
  assert.equal(record.bucket, 'textures');
  assert.equal(record.key, 'wear-mask');
  assert.equal(record.value.width, 8);
  assert.equal(record.value.height, 8);
  const data = Buffer.from(record.value.data, 'base64');
  assert.equal(data.length, 8 * 8 * 4);

  const values = new Set();
  for (let i = 0; i < 8 * 8; i++) {
    const [r, g, b, a] = data.subarray(i * 4, i * 4 + 4);
    assert.equal(r, g, `${i} is grayscale`);
    assert.equal(g, b, `${i} is grayscale`);
    assert.equal(a, 255, `${i} is opaque`);
    values.add(r);
  }
  assert.ok(values.has(0), 'the normalized field reaches 0');
  assert.ok(values.has(255), 'the normalized field reaches 255');

  const again = BAKERS['grid-texture']({ id: 'grid-job' }, gridContext({ type: 'grid-texture', name: 'wear-mask', size: 8 }));
  assert.equal(again.value.data, record.value.data, 'byte-identical across runs');

  assert.throws(
    () => BAKERS['grid-texture']({ id: 'grid-job' }, { result: {}, bake: { type: 'grid-texture' } }),
    /grid-texture: blur-core grid missing/,
  );
});

test('gif-frames bakes one composited GIF frame into the effects bucket', () => {
  const record = BAKERS['gif-frames']({ id: 'gif-job' }, imageContext({ type: 'gif-frames', name: 'gif-anim', index: 2, size: 8 }));
  assert.equal(record.bucket, 'effects');
  assert.equal(record.key, 'gif-anim');
  assert.equal(record.merge, 'frames');
  assert.equal(record.index, 2);
  assert.equal(record.fps, 12.5, 'the decoder delay rate is used when bake.fps is absent');
  assert.equal(record.value.width, 8);
  assert.equal(record.value.height, 8);
  const data = Buffer.from(record.value.data, 'base64');
  assert.equal(data.length, 8 * 8 * 4);
  for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, 'the composited frame is opaque where painted');

  const overridden = BAKERS['gif-frames']({ id: 'gif-job' }, imageContext({ type: 'gif-frames', name: 'gif-anim', index: 0, size: 4, fps: 20 }));
  assert.equal(overridden.index, 0);
  assert.equal(overridden.fps, 20);
  assert.equal(overridden.value.width, 4);

  // all:true emits the whole animation in one paid job instead of one per frame.
  const whole = BAKERS['gif-frames']({ id: 'gif-job' }, imageContext({ type: 'gif-frames', name: 'gif-anim', all: true, size: 6, fps: 9 }));
  assert.equal(whole.bucket, 'effects');
  assert.equal(whole.key, 'gif-anim');
  assert.equal(whole.merge, undefined, 'the complete entry is written as a whole value');
  assert.equal(whole.value.fps, 9);
  assert.equal(whole.value.frames.length, 3, 'every decoded frame is baked');
  for (const frame of whole.value.frames) {
    assert.equal(frame.width, 6);
    assert.equal(frame.height, 6);
    assert.equal(Buffer.from(frame.data, 'base64').length, 6 * 6 * 4);
  }

  assert.throws(() => BAKERS['gif-frames']({ id: 'gif-job' }, { files: new Map(), bake: {} }), /gif-frames: no result file/);
  assert.throws(
    () => BAKERS['gif-frames']({ id: 'gif-job' }, { files: new Map([['result', Buffer.from('not a gif')]]), bake: {} }),
    /gif-frames: result is not a GIF/,
  );
  assert.throws(
    () => BAKERS['gif-frames']({ id: 'gif-job' }, imageContext({ type: 'gif-frames', index: 9 })),
    /gif-frames: index 9 is outside the decoded GIF \(0\.\.2\)/,
  );
});

test('gif-frames records merge by index like effect frames', () => {
  const first = BAKERS['gif-frames']({ id: 'gif-job' }, imageContext({ type: 'gif-frames', name: 'gif-anim', index: 0, size: 4 }));
  const second = BAKERS['gif-frames']({ id: 'gif-job' }, imageContext({ type: 'gif-frames', name: 'gif-anim', index: 1, size: 4 }));
  const previous = emptyBaked(2);
  previous.effects['gif-anim'] = { fps: first.fps, frames: [first.value] };
  const fresh = emptyBaked(2);
  fresh.effects['gif-anim'] = { fps: second.fps, frames: [undefined, second.value] };
  const merged = mergeBakedRecords(previous, fresh).effects['gif-anim'];
  assert.equal(merged.frames.length, 2, 'both frames are present');
  assert.deepEqual(merged.frames[0], first.value, 'the earlier index is kept');
  assert.deepEqual(merged.frames[1], second.value, 'the selected index is replaced');
  assert.equal(merged.fps, second.fps);
});

// ---------------------------------------------------------------------------
// Local source art + the QRC vocabulary archive
// ---------------------------------------------------------------------------

test('the QRC vocabulary ZIP is store-only and readable by unzip', () => {
  const zip = makeQrcVocabulary();
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'the archive starts with a local file header');
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 10, 'ten central directory entries');
  const centralOffset = zip.readUInt32LE(eocd + 16);
  assert.equal(zip.readUInt16LE(centralOffset + 10), 0, 'every entry is stored (no compression)');

  const entries = unzip(zip);
  const names = [...entries.keys()];
  assert.deepEqual(names, Array.from({ length: 10 }, (_, i) => `glyph-${String(i + 1).padStart(2, '0')}.png`));
  for (const [name, data] of entries) {
    const glyph = name.slice(0, -4);
    assert.equal(Buffer.compare(data, makeSourceArt(glyph, SOURCE_ART[glyph])), 0, `${name} round-trips byte-for-byte`);
    const image = decodePng(data);
    assert.equal(image.width, 64, `${name} is 64px wide`);
    assert.equal(image.height, 64, `${name} is 64px tall`);
  }
  assert.equal(Buffer.compare(makeQrcVocabulary(), zip), 0, 'the archive is deterministic');
  assert.throws(() => encodeZip([]), /zip: no entries to write/);
});

test('new source art decodes with the documented dimensions and is deterministic', () => {
  const masks = ['mask-wear', 'mask-damp', 'mask-corrosion', 'mask-heat', 'mask-crack', 'mask-moss'];
  for (const name of masks) {
    const png = makeSourceArt(name, SOURCE_ART[name]);
    const image = decodePng(png);
    assert.equal(image.width, 256, `${name} is 256px wide`);
    assert.equal(image.height, 256, `${name} is 256px tall`);
    let dark = 0, bright = 0;
    for (let i = 0; i < 256 * 256; i++) {
      const [r, g, b, a] = image.data.subarray(i * 4, i * 4 + 4);
      assert.equal(r, g, `${name} is grayscale`);
      assert.equal(g, b, `${name} is grayscale`);
      assert.equal(a, 255, `${name} is opaque`);
      if (r < 10) dark++;
      if (r > 200) bright++;
    }
    assert.ok(dark > 0, `${name} has near-zero background pixels`);
    assert.ok(bright > 0, `${name} has near-full application pixels`);
    assert.equal(Buffer.compare(makeSourceArt(name, SOURCE_ART[name]), png), 0, `${name} is deterministic`);
  }

  const sky = makeSourceArt('sky-ember', SOURCE_ART['sky-ember']);
  const skyImage = decodePng(sky);
  assert.equal(skyImage.width, 512, 'the ember sky is 512px wide');
  assert.equal(skyImage.height, 256);
  assert.equal(Buffer.compare(makeSourceArt('sky-ember', SOURCE_ART['sky-ember']), sky), 0, 'the sky is deterministic');
  let skyMax = 0;
  for (let i = 0; i < 512 * 256; i++) skyMax = Math.max(skyMax, skyImage.data[i * 4]);
  assert.ok(skyMax > 200, 'the sky has a hot horizon');

  const glyphs = Object.keys(SOURCE_ART).filter((name) => SOURCE_ART[name].pattern === 'glyph');
  assert.equal(glyphs.length, 10, 'ten glyphs are registered');
  let previous = null;
  for (const name of glyphs) {
    const png = makeSourceArt(name, SOURCE_ART[name]);
    const image = decodePng(png);
    assert.equal(image.width, 64, `${name} is 64px wide`);
    assert.equal(image.height, 64, `${name} is 64px tall`);
    const values = new Set();
    for (let i = 0; i < 64 * 64; i++) {
      const [r, g, b] = image.data.subarray(i * 4, i * 4 + 4);
      assert.equal(r, g, `${name} is grayscale`);
      assert.equal(g, b, `${name} is grayscale`);
      values.add(r);
    }
    assert.ok(values.has(0), `${name} has a black background`);
    assert.ok([...values].some((value) => value > 200), `${name} has bright strokes`);
    assert.equal(Buffer.compare(makeSourceArt(name, SOURCE_ART[name]), png), 0, `${name} is deterministic`);
    if (previous) assert.notEqual(Buffer.compare(previous, png), 0, `${name} differs from its predecessor`);
    previous = png;
  }
});

// ---------------------------------------------------------------------------
// generateValues
// ---------------------------------------------------------------------------

test('dust and flow generators are bounded, rectangular and seed-sensitive', () => {
  for (const type of ['dust', 'flow']) {
    const grid = generateValues({ generateValues: { type } });
    assert.equal(grid.length, 64, `${type} defaults to 64 rows`);
    for (const row of grid) {
      assert.equal(row.length, 64, `${type} is rectangular`);
      for (const value of row) {
        assert.ok(Number.isFinite(value), `${type} is finite`);
        assert.ok(value >= 0 && value <= 1, `${type} stays in [0,1]`);
      }
    }
    const again = generateValues({ generateValues: { type } });
    assert.deepEqual(again, grid, `${type} is deterministic for equal inputs`);
    const seeded = generateValues({ generateValues: { type, seed: 5 } });
    assert.notDeepEqual(seeded, grid, `${type} changes with the seed`);
    assert.equal(generateValues({ generateValues: { type, size: 8 } }).length, 8, `${type} honours size`);
  }
});
