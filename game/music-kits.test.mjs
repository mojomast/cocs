import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_MODES } from './config.mjs';
import {
  MusicEngine, ARRANGEMENTS, HALO_ARRANGEMENTS, MUSIC_GROOVES, MUSIC_KITS,
  MUSIC_ORNAMENTS, MUSIC_PALETTES, MUSIC_TIMBRES,
} from './music.mjs';

// A Web Audio mock with everything the colour/orchestral voices touch, so the
// kit/groove scheduling paths are exercised for real (samples stay inert in
// Node, which keeps the deterministic oscillator path).
function audioContext() {
  const nodes = [];
  const param = (v = 0) => ({ value: v, setValueAtTime(v2) { this.value = v2; }, linearRampToValueAtTime(v2) { this.value = v2; }, exponentialRampToValueAtTime(v2) { this.value = v2; }, setTargetAtTime(v2) { this.value = v2; }, cancelScheduledValues() {} });
  const node = (extra) => { const n = { frequency: param(), detune: param(), playbackRate: param(), gain: param(), Q: param(), pan: param(), delayTime: param(), type: '', buffer: null, loop: false, loopStart: 0, loopEnd: 0, connect() { this.connected = true; }, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; }, ...extra }; nodes.push(n); return n; };
  return {
    currentTime: 0, state: 'running', sampleRate: 44100, destination: {}, nodes,
    createGain: () => node(), createOscillator: () => node({ type: 'sine' }),
    createBufferSource: () => node(), createBiquadFilter: () => node({ type: 'lowpass' }),
    createStereoPanner: () => node(), createDelay: () => node({ delayTime: param() }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}

const theme = { root: 58, scale: [0, 3, 5, 7] };
const runTicks = (e, ctx, n) => { for (let i = 0; i < n; i++) { ctx.currentTime += 0.05; e.tick(); } };
const take = ({ palette = null, scene = 'combat', intensity = 1, seed = 7, maxVoices = 44, ticks = 400 } = {}) => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed, maxVoices });
  if (palette) e.setPalette(palette);
  e.setScene(scene);
  e.setIntensity(intensity);
  runTicks(e, ctx, ticks);
  return e;
};

// --- tables ------------------------------------------------------------------

test('every game mode authors a palette and a percussion kit; default is inert and frozen', () => {
  assert.ok(Object.isFrozen(MUSIC_KITS) && Object.isFrozen(MUSIC_GROOVES) && Object.isFrozen(MUSIC_PALETTES));
  assert.ok(Object.isFrozen(MUSIC_TIMBRES));
  assert.deepEqual({ ...MUSIC_KITS.default }, {}, 'the default kit overrides nothing');
  assert.deepEqual({ ...MUSIC_PALETTES.default }, { shaker: false, keys: false, pluck: false }, 'the default palette keeps exactly its original keys');
  assert.equal(MUSIC_GROOVES.default, null, 'the default palette selects no groove');
  const modes = GAME_MODES.map((mode) => mode.id);
  assert.ok(modes.length >= 20, 'the game publishes a full mode list');
  for (const mode of modes) {
    assert.ok(MUSIC_PALETTES[mode], `${mode} authors a palette`);
    assert.ok(MUSIC_KITS[mode], `${mode} authors a percussion kit`);
    assert.ok(Object.isFrozen(MUSIC_PALETTES[mode]) && Object.isFrozen(MUSIC_KITS[mode]), `${mode} tables are frozen`);
  }
  for (const [key, palette] of Object.entries(MUSIC_PALETTES)) {
    if (palette.arpTimbre != null) assert.ok(MUSIC_TIMBRES.includes(palette.arpTimbre), `${key} arpTimbre is a known oscillator type`);
    if (palette.leadTimbre != null) assert.ok(MUSIC_TIMBRES.includes(palette.leadTimbre), `${key} leadTimbre is a known oscillator type`);
    if (palette.rotation != null) {
      assert.ok(Number.isFinite(palette.rotation) && palette.rotation > 0, `${key} rotation is a positive ratio`);
      assert.ok(palette.rotation >= 0.25 && palette.rotation <= 4, `${key} rotation stays in the playable register`);
    }
  }
  const layers = ['kick', 'snare', 'hat', 'taiko', 'bell'];
  for (const [key, kit] of Object.entries(MUSIC_KITS)) {
    for (const [layer, value] of Object.entries(kit)) {
      assert.ok(layers.includes(layer), `${key}/${layer} is a known percussion layer`);
      const list = Array.isArray(value) ? value : value.add || value.replace;
      assert.ok(Array.isArray(list), `${key}/${layer} is a step list or { add|replace }`);
      assert.ok(list.every((step) => Number.isInteger(step) && step >= 0 && step < 16), `${key}/${layer} keeps steps inside the 16th bar`);
      assert.ok(Object.isFrozen(value), `${key}/${layer} is frozen`);
    }
  }
});

test('default palette and variation 0 still replay the pinned baseline take', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 7 });
  assert.equal(e.variation, 0);
  assert.equal(e.menuTabSeed, 0);
  assert.equal(e.kitName, 'default');
  assert.equal(e._groove, null);
  assert.deepEqual({ ...e.palette }, { shaker: false, keys: false, pluck: false });
  // Absolute pins captured from the pre-kit engine: a default take must stay
  // byte-identical (checksum and note counts) for every scene.
  const cases = [
    ['menu', (x) => x.setScene('menu'), -441319438, 223],
    ['explore', (x) => x.setScene('explore'), 1606279385, 407],
    ['combat', (x) => { x.setScene('combat'); x.setIntensity(1); }, 20018129, 537],
    ['results', (x) => x.setOutcome('victory'), -1217309427, 276],
  ];
  for (const [scene, setup, checksum, notes] of cases) {
    const c = audioContext();
    const run = new MusicEngine({ ctx: c, destination: c.destination, theme, seed: 7 });
    setup(run);
    runTicks(run, c, 400);
    assert.equal(run.scheduleChecksum, checksum, `${scene} default checksum is unchanged`);
    assert.equal(run.notesScheduled, notes, `${scene} default note count is unchanged`);
    assert.equal(run.variation, 0, `${scene} keeps variation off`);
    assert.ok(run.voices.length <= run.maxVoices);
    run.dispose();
  }
  e.dispose();
});

test('palette, kit and groove resolution fall back deterministically for unknown keys', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme });
  assert.equal(e.setPalette('not-a-mode'), 'default');
  assert.equal(e.kitName, 'default');
  assert.deepEqual({ ...e.kit }, {});
  assert.equal(e._groove, null);
  assert.deepEqual({ ...e.palette }, { ...MUSIC_PALETTES.default }, 'an unknown mode is the all-off default');
  assert.equal(e.setPalette('deathmatch'), 'deathmatch');
  assert.equal(e.kitName, 'deathmatch');
  assert.equal(e.kit, MUSIC_KITS.deathmatch);
  assert.equal(e._groove, null, 'only the vehicle modes author a groove');
  assert.equal(e.setPalette('puma-race'), 'puma-race');
  assert.equal(e.kit, MUSIC_KITS['puma-race']);
  assert.equal(e._groove, MUSIC_GROOVES['puma-race']);
  // A biome palette overlays timbre keys but never selects a kit or groove.
  e.setPalette('default');
  e.setBiomePalette('storm');
  assert.equal(e.kitName, 'default');
  assert.equal(e._groove, null);
  assert.equal(e.palette.rotation, 2, 'the biome authors its own register rotation');
  assert.equal(e.palette.arpTimbre, 'square');
  assert.equal(e.setBiomePalette('default'), 'default');
  assert.equal(e.palette.rotation, undefined, 'clearing the biome releases its timbre');
  e.dispose();
});

// --- kits --------------------------------------------------------------------

test('kits replace or union the authored grids and never mutate the arrangement', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme });
  const arr = { kick: [0, 8], snare: [4, 12], hat: [4, 12], taiko: null, bell: null };
  const grids = e._kitGridsFor({ kick: [0, 4, 8, 12], hat: { add: [1, 5, 5, 13] }, bell: { replace: [0] } }, arr);
  assert.deepEqual([...grids.kick], [0, 4, 8, 12], 'an array replaces the authored grid');
  assert.deepEqual([...grids.hat], [1, 4, 5, 12, 13], 'add unions, dedupes and sorts');
  assert.deepEqual([...grids.snare], [4, 12], 'an unauthored layer keeps the arrangement grid');
  assert.deepEqual([...grids.bell], [0], 'replace is explicit');
  assert.equal(grids.taiko, null);
  assert.deepEqual([...arr.hat], [4, 12], 'the authored grid is untouched');
  assert.ok(Object.isFrozen(grids.hat), 'the merged grid is frozen');
  // Merged grids are cached per scene and null outside the match scenes.
  e.setPalette('armsrace');
  assert.deepEqual([...e._kitGrids.explore.kick], [0, 2, 4, 6, 8, 10, 12, 14], 'armsrace pulses eighths in explore');
  assert.equal(e._kitGrids.menu, null, 'the menu keeps the pack identity');
  assert.equal(e._kitGrids.results, null, 'the results screen keeps the pack identity');
  e.dispose();
});

test('a mode kit changes the match take and stays inside the voice and sustain budgets', () => {
  const base = take();
  const kit = take({ palette: 'instagib' });
  assert.notEqual(kit.scheduleChecksum, base.scheduleChecksum, 'the kit forks the take');
  assert.ok(kit.notesBy.kick < base.notesBy.kick, 'instagib halves the combat kick pattern');
  assert.ok(kit.notesBy.hat > 0);
  const twin = take({ palette: 'instagib' });
  assert.equal(kit.scheduleChecksum, twin.scheduleChecksum, 'one palette and one seed reproduce one take');
  assert.ok(kit.voices.length <= kit.maxVoices);
  assert.ok(kit.peakVoices > 0 && kit.peakVoices <= 44);
  assert.ok(kit.sustainVoices <= kit.sustainBudget);
  // A tight cap still holds with an authored kit and a groove.
  for (const palette of ['armsrace', 'puma-race', 'puma-soccer', 'horde']) {
    const ctx = audioContext();
    const e = new MusicEngine({ ctx, destination: ctx.destination, theme, maxVoices: 10 });
    e.setPalette(palette);
    e.setScene('combat');
    e.setIntensity(1);
    for (let i = 0; i < 300; i += 1) {
      ctx.currentTime += 0.05;
      e.tick();
      assert.ok(e.voices.length <= 10, `${palette} respects a 10-voice cap at tick ${i}`);
    }
    assert.ok(e.sustainVoices <= e.sustainBudget, `${palette} keeps the sustain budget`);
    e.dispose();
  }
});

test('palette timbres and rotations are off by default and change the take only when selected', () => {
  const base = take();
  const unknown = take({ palette: 'not-a-palette' });
  assert.equal(unknown.scheduleChecksum, base.scheduleChecksum, 'an unknown palette keeps the baseline take');
  assert.deepEqual({ ...unknown.palette }, { ...MUSIC_PALETTES.default });
  const horde = take({ palette: 'horde' });
  assert.notEqual(horde.scheduleChecksum, base.scheduleChecksum, 'a raised palette forks the take');
  assert.equal(horde.palette.arpTimbre, 'sawtooth', 'the engine reads the authored arp timbre');
  assert.equal(horde.palette.rotation, 0.5, 'the engine reads the authored register');
  const twin = take({ palette: 'horde' });
  assert.equal(horde.scheduleChecksum, twin.scheduleChecksum, 'a palette take is reproducible');
  assert.ok(horde.voices.length <= horde.maxVoices);
  // An unknown timbre is ignored, never assigned to an oscillator.
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme });
  assert.equal(e._paletteTimbre('not-a-wave', 'triangle'), 'triangle');
  assert.equal(e._paletteTimbre(undefined, null), null);
  assert.equal(e._paletteTimbre('sine', 'triangle'), 'sine');
  e.dispose();
});

// --- race/soccer grooves -----------------------------------------------------

test('race and soccer grooves replace the in-match arrangements and stay in budget', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme });
  e.setPalette('puma-race');
  assert.equal(e._arrangement('explore'), MUSIC_GROOVES['puma-race'].explore);
  assert.equal(e._arrangement('combat'), MUSIC_GROOVES['puma-race'].combat);
  assert.equal(e._arrangement('menu'), ARRANGEMENTS.menu, 'the menu keeps its authored identity');
  assert.equal(e._arrangement('results'), ARRANGEMENTS.results);
  const race = MUSIC_GROOVES['puma-race'];
  assert.equal(race.explore.hat.length, 16, 'the race rides a driving 16th kit');
  assert.ok(race.explore.bass.length >= 8, 'the bass pulses like an engine');
  assert.equal(race.explore.leadRate, 0.5, 'the lead is an urgent eighth-note line');
  assert.equal(race.combat.bpm > ARRANGEMENTS.combat.bpm, true);
  const soccer = MUSIC_GROOVES['puma-soccer'];
  assert.notDeepEqual([...soccer.explore.hat], [...race.explore.hat], 'soccer is not the race kit');
  assert.notDeepEqual([...soccer.explore.bass], [...race.explore.bass], 'soccer is not the race bass');
  assert.ok(Object.isFrozen(race.explore) && Object.isFrozen(soccer.combat));
  // A swapped soundtrack pack wins over a groove.
  e.setSoundtrack('halo');
  assert.equal(e.arrangements, HALO_ARRANGEMENTS);
  assert.equal(e._arrangement('explore'), HALO_ARRANGEMENTS.explore, 'the halo pack is untouched by a mode groove');
  e.dispose();
});

test('the race and soccer kit grids are the same frozen material as their grooves', () => {
  for (const [mode, scene] of [['puma-race', 'explore'], ['puma-race', 'combat'], ['puma-soccer', 'explore'], ['puma-soccer', 'combat']]) {
    const kit = MUSIC_KITS[mode];
    const arr = MUSIC_GROOVES[mode][scene];
    for (const layer of ['kick', 'snare', 'hat', 'taiko']) {
      if (kit[layer] == null) continue;
      assert.equal(kit[layer], arr[layer], `${mode}/${scene} ${layer} cannot drift from its kit`);
      assert.ok(Object.isFrozen(arr[layer]));
    }
  }
});

test('every authored mode palette schedules deterministically inside the budget', () => {
  for (const mode of GAME_MODES.map((m) => m.id)) {
    const runs = [];
    for (let pass = 0; pass < 2; pass += 1) {
      const ctx = audioContext();
      const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 5 });
      e.setPalette(mode);
      e.setScene('combat');
      e.setIntensity(1);
      runTicks(e, ctx, 160);
      runs.push(e);
    }
    assert.equal(runs[0].kitName, mode, `${mode} resolves its kit`);
    assert.equal(runs[0].paletteName, mode, `${mode} resolves its palette`);
    assert.equal(runs[0].scheduleChecksum, runs[1].scheduleChecksum, `${mode} is deterministic`);
    assert.equal(runs[0].notesScheduled, runs[1].notesScheduled, `${mode} replays the same note count`);
    assert.ok(runs[0].voices.length <= runs[0].maxVoices, `${mode} respects the voice cap`);
    assert.ok(runs[0].sustainVoices <= runs[0].sustainBudget, `${mode} respects the sustain budget`);
    runs[0].dispose();
    runs[1].dispose();
  }
});

test('the race and soccer takes differ from explore/combat and from each other', () => {
  const baseExplore = take({ scene: 'explore', intensity: 0 });
  const raceExplore = take({ scene: 'explore', intensity: 0, palette: 'puma-race' });
  const soccerExplore = take({ scene: 'explore', intensity: 0, palette: 'puma-soccer' });
  assert.notEqual(raceExplore.scheduleChecksum, baseExplore.scheduleChecksum);
  assert.notEqual(soccerExplore.scheduleChecksum, baseExplore.scheduleChecksum);
  assert.notEqual(raceExplore.scheduleChecksum, soccerExplore.scheduleChecksum, 'the two vehicle modes are distinct');
  assert.ok(raceExplore.notesBy.hat > baseExplore.notesBy.hat, 'the race kit adds the 16th hats');
  assert.ok(raceExplore.notesBy.lead > 0 && soccerExplore.notesBy.lead > 0, 'both urgent leads sound');
  assert.ok(raceExplore.notesBy.kick > baseExplore.notesBy.kick, 'the race kick drives harder');
  const baseCombat = take();
  const raceCombat = take({ palette: 'puma-race' });
  const soccerCombat = take({ palette: 'puma-soccer' });
  assert.notEqual(raceCombat.scheduleChecksum, baseCombat.scheduleChecksum);
  assert.notEqual(soccerCombat.scheduleChecksum, baseCombat.scheduleChecksum);
  assert.notEqual(raceCombat.scheduleChecksum, soccerCombat.scheduleChecksum);
  for (const run of [raceExplore, soccerExplore, raceCombat, soccerCombat]) {
    assert.ok(run.voices.length <= run.maxVoices);
    assert.ok(run.peakVoices > 0 && run.peakVoices <= 44);
    assert.ok(run.sustainVoices <= run.sustainBudget);
  }
});

// --- menu tab ----------------------------------------------------------------

test('the menu tab varies only the menu ornaments and is off by default', () => {
  const base = take({ scene: 'menu', intensity: 0 });
  const off = take({ scene: 'menu', intensity: 0, palette: null });
  assert.equal(off.scheduleChecksum, base.scheduleChecksum);
  const cleared = (() => {
    const ctx = audioContext();
    const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 7 });
    e.setMenuTab('roster');
    e.setMenuTab(null);
    e.setScene('menu');
    runTicks(e, ctx, 400);
    return e;
  })();
  assert.equal(cleared.menuTabSeed, 0);
  assert.equal(cleared.scheduleChecksum, base.scheduleChecksum, 'clearing the tab restores the baseline take');
  const roster = (() => {
    const ctx = audioContext();
    const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 7 });
    e.setMenuTab('roster');
    e.setScene('menu');
    runTicks(e, ctx, 400);
    return e;
  })();
  const loadout = (() => {
    const ctx = audioContext();
    const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 7 });
    e.setMenuTab('loadout');
    e.setScene('menu');
    runTicks(e, ctx, 400);
    return e;
  })();
  assert.ok(roster.menuTabSeed > 0, 'a tab key resolves to a positive seed');
  assert.notEqual(roster.scheduleChecksum, base.scheduleChecksum, 'a tab forks the menu take');
  assert.notEqual(roster.scheduleChecksum, loadout.scheduleChecksum, 'different tabs select different ornaments');
  assert.ok(roster.voices.length <= roster.maxVoices);
  // Non-string and empty values are off, exactly like variation 0.
  const tabCtx = audioContext();
  const tabEngine = new MusicEngine({ ctx: tabCtx, destination: tabCtx.destination, theme, seed: 7 });
  assert.equal(tabEngine.setMenuTab(7), 0);
  assert.equal(tabEngine.setMenuTab(''), 0);
  assert.equal(tabEngine.menuTabSeed, 0);
  tabEngine.dispose();
});

test('a menu tab picks ornamental notes without rotating the menu voice', () => {
  const ctx = audioContext();
  const e = new MusicEngine({ ctx, destination: ctx.destination, theme, seed: 7 });
  e.setMenuTab('roster');
  e.bar = 3;
  const orn = e._ornament('menu');
  assert.deepEqual(orn.rotation, MUSIC_ORNAMENTS.rotations[0], 'the neutral rotation leaves the timbre alone');
  assert.ok(MUSIC_ORNAMENTS.arpDirections.includes(orn.arpDirection), 'direction is an ornament choice');
  assert.ok(orn.ghostSteps.length >= 2, 'ghost 16ths are ornamental note choice');
  assert.equal(e._ornCache.tabSeed, e.menuTabSeed);
  // A variation keeps the previous hash (the tab only joins it when selected).
  const plain = new MusicEngine({ ctx: audioContext(), destination: {}, theme, seed: 7 });
  plain.setVariation(5);
  plain.bar = 3;
  const varied = plain._ornament('combat');
  assert.equal(plain._ornCache.tabSeed, 0);
  assert.ok(MUSIC_ORNAMENTS.rotations.includes(varied.rotation), 'a variation still rotates the instrument');
  e.dispose();
  plain.dispose();
});

// --- purity ------------------------------------------------------------------

test('music.mjs never uses Math.random or a wall clock for scheduling decisions', () => {
  const source = readFileSync(new URL('./music.mjs', import.meta.url), 'utf8');
  // Strip comments so the documentation can name the rules it keeps.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.equal(/Math\.random/.test(code), false, 'no Math.random');
  assert.equal(/Date\.now|performance\.now/.test(code), false, 'no wall-clock music decisions');
});
