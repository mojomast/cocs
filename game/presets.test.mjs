import test from 'node:test';
import assert from 'node:assert/strict';
import {DISPLAY_PRESETS,PRESET_LIMIT,addPreset,applyDisplayPreset,descriptivePresetName,findPreset,normalizeLoadout,normalizePreset,normalizePresets,removePreset} from './presets.mjs';

const options = {characters: ['chatgpt', 'claude'], harnesses: ['openclaw', 'cline'], maps: ['exchange', 'forge']};

test('preset normalization validates ids and sanitizes names', () => {
  const preset = normalizePreset({name: '  My\tSetup  ', character: 'chatgpt', harness: 'cline', mapId: 'forge', config: {mode: 'koth'}}, options, () => 'fixed1');
  assert.deepEqual(preset, {id: 'fixed1', name: 'MySetup', character: 'chatgpt', harness: 'cline', mapId: 'forge', config: {mode: 'koth'}, loadout: {gear: {}, attachments: {}, finish: null, crosshair: null}});
  assert.equal(normalizePreset({character: 'nope', harness: 'cline', mapId: 'forge'}, options, () => 'x'), null);
  assert.equal(normalizePreset({character: 'chatgpt', harness: 'cline', mapId: 'ghost'}, options, () => 'x'), null);
  assert.equal(normalizePresets([null, {character: 'chatgpt', harness: 'cline', mapId: 'forge'}, {character: 'bad', harness: 'cline', mapId: 'forge'}], options, i => `p${i}`).length, 1);
});

test('adding a same-name preset replaces it and the list is capped', () => {
  let list = [];
  for (let i = 0; i < PRESET_LIMIT + 3; i++) list = addPreset(list, {id: `id${i}`, name: `P${i}`});
  assert.equal(list.length, PRESET_LIMIT);
  assert.equal(list.at(-1).name, `P${PRESET_LIMIT + 2}`);
  const replaced = addPreset(list, {id: 'new', name: list[0].name.toUpperCase()});
  assert.equal(replaced.filter(p => p.name.toLowerCase() === list[0].name.toLowerCase()).length, 1);
});

test('loadouts capture gear, attachments, finish and crosshair', () => {
  const full = {...options, gearSlots: ['primary', 'armor', 'utility'], gearIds: ['scope', 'plating'], attachmentSlots: ['optic', 'barrel'], attachmentIds: ['holo-sight'], finishes: ['finish-ion', 'finish-ember'], crosshairs: ['cross', 'dot']};
  const preset = normalizePreset({character: 'chatgpt', harness: 'cline', mapId: 'forge', loadout: {gear: {primary: 'scope', armor: 'plating', bogus: 'x'}, attachments: {optic: 'holo-sight', barrel: 'nope'}, finish: 'finish-ion', crosshair: 'dot'}}, full, () => 'load1');
  assert.deepEqual(preset.loadout, {gear: {primary: 'scope', armor: 'plating'}, attachments: {optic: 'holo-sight'}, finish: 'finish-ion', crosshair: 'dot'});
  assert.deepEqual(normalizeLoadout({gear: {primary: 'scope'}, finish: 'finish-void', crosshair: 'ring'}, full), {gear: {primary: 'scope'}, attachments: {}, finish: null, crosshair: null});
  assert.deepEqual(normalizeLoadout({gear: {primary: 'scope'}}, {}), {gear: {}, attachments: {}, finish: null, crosshair: null});
});

test('unnamed presets fall back to a descriptive name', () => {
  assert.equal(descriptivePresetName({character: 'chatgpt', harness: 'openclaw', config: {mode: 'koth'}}), 'Chatgpt · Openclaw · KOTH');
  assert.equal(descriptivePresetName({}), 'Loadout');
  const preset = normalizePreset({character: 'claude', harness: 'cline', mapId: 'forge', config: {mode: 'ctf'}}, options, () => 'named1');
  assert.equal(preset.name, 'Claude · Cline · CTF');
  assert.deepEqual(normalizePresets([{character: 'chatgpt', harness: 'cline', mapId: 'forge'}], options, i => `p${i}`).map(p => p.name), ['Chatgpt · Cline']);
});

test('removing and finding presets works by id', () => {
  const list = [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}];
  assert.equal(findPreset(list, 'b').name, 'B');
  assert.equal(findPreset(list, 'z'), null);
  assert.deepEqual(removePreset(list, 'a').map(p => p.id), ['b']);
});

test('display presets apply quality tiers without dropping unrelated options', () => {
  assert.deepEqual(DISPLAY_PRESETS.map(p => p.id), ['performance', 'balanced', 'quality']);
  const base = {fov: 90, crosshair: 'dot', color: '#fff', resolutionScale: .5, postFx: false, bloom: 0};
  const quality = applyDisplayPreset(base, 'quality');
  assert.equal(quality.resolutionScale, 1.25);
  assert.equal(quality.postFx, true);
  assert.equal(quality.bloom, .5);
  assert.equal(quality.quality, 'high');
  assert.equal(quality.fov, 90, 'custom values survive the preset');
  assert.equal(quality.crosshair, 'dot');
  assert.equal(base.resolutionScale, .5, 'input is not mutated');
  const performance = applyDisplayPreset({}, 'performance');
  assert.equal(performance.resolutionScale, .5);
  assert.equal(performance.quality, 'low');
  assert.equal(performance.showFps, true);
  assert.deepEqual(applyDisplayPreset({fov: 70}, 'nope'), {fov: 70});
  assert.deepEqual(applyDisplayPreset(undefined, 'balanced'), {resolutionScale: .85, postFx: true, bloom: .34, quality: 'medium', showFps: false});
});
