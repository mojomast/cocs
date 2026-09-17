// Procedural soundtrack engine.
//
// A small step sequencer layered over the Web Audio graph. It owns its own
// gain buses and schedules notes with a bounded look-ahead window measured in
// `AudioContext.currentTime`, so note timing is independent of the render frame
// rate and the tab can be suspended without firing a backlog of notes.
//
// Musical material is shared across arrangements: every arrangement reads the
// same mode theme (root + scale) and the same chord progression, so the menu,
// exploration and combat moods are recognisably the same piece of music. The
// engine exposes three sub-buses (menu/explore/combat) that are crossfaded by
// scene and intensity, plus a shared percussion bus. Dynamic layers ease in and
// out of those buses: the combat grid (kick -> snare -> hats), the melodic
// counter-line and lead, taiko/bell accents and choir pads each have their own
// entry threshold, and a small transition state machine carries a rising swell
// out of the old scene and an entrance accent into the new one.
//
// Arrangement schema (all soundtrack data is deeply frozen):
//   bpm, steps, gain        tempo / 16th grid length / layer gain
//   kick/snare/hat          arrays of 16th-note steps
//   bass                    [step, scaleDegree, lengthInSteps]
//   arp                     one scale degree per eighth note
//   counter                 optional one degree per eighth-note offbeat
//   counterShift/leadShift  optional semitone transpositions
//   lead                    one degree per quarter note, 'motif', or null
//   leadFallback            degrees used when 'motif' has no motif loaded
//   leadType / leadGain     optional timbre overrides
//   pad / choir / drone     sustained ensemble toggles
//   taiko / bell            optional percussion and accent grids
//   swell                   0..1 phrase-swell depth on the final bar
//
// No three.js import and no DOM: the class is exercised in unit tests through a
// minimal mock context, and a real OfflineAudioContext can render it for a
// non-silence check. Noise uses a seeded PRNG, voice allocation is bounded and
// every voice is pruned by schedule time, so one seed reproduces one take.

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Recursively freeze plain data so exported soundtrack tables cannot drift.
const frozen = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  const out = {};
  for (const [key, entry] of Object.entries(value)) out[key] = frozen(entry);
  return Object.freeze(out);
};

// Scale-degree helper: wraps degrees into octaves.
const degree = (scale, i) => {
  const len = scale.length;
  const octave = Math.floor(i / len);
  return scale[((i % len) + len) % len] + octave * 12;
};
const noteFreq = (root, scale, i) => root * Math.pow(2, degree(scale, i) / 12);

// Seeded PRNG (mulberry32) for humanised velocities and ornament choices. A
// fixed seed always produces the same performance; nothing here uses
// Math.random(), so two engines fed the same schedule sound identical.
const mulberry32 = (seed) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Eight-bar chord progressions in scale degrees. Each degree becomes a modal
// stack (root/third/fifth/octave) so the progressions drive tension and release
// by harmony and register. `menu` is gentle, `explore` moves, `combat` sits on
// a pedal tone then lifts. The second half of each phrase answers the first.
export const CHORD_PROGRESSIONS = frozen({
  menu: [0, 3, 5, 3, 0, 3, 4, 3],
  explore: [0, 3, 4, 3, 0, 3, 5, 4],
  combat: [0, 0, 3, 4, 0, 5, 3, 4],
});

// Arrangement data. `bass` is [step, degree, lengthInSteps]; `arp`/`counter`
// are one degree per eighth note (counter on the offbeats); `lead` is one
// degree per quarter note and spans bars, so a sixteen-note line breathes over
// four bars instead of looping every bar. Phrase fills live in FILLS.
export const ARRANGEMENTS = frozen({
  menu: {
    bpm: 84, steps: 16, gain: 0.5,
    kick: [0, 8], snare: [], hat: [4, 12],
    bass: [[0, 0, 6], [8, 4, 6], [14, 3, 2]],
    arp: [0, 2, 4, 2, 3, 5, 4, 2],
    counter: [4, 2, 0, 2, 3, 2, 0, 2], counterShift: -12,
    lead: [0, 2, 4, 2, 3, 4, 5, 4, 2, 0, 2, 3, 2, 0, 2, 0], leadType: 'triangle', leadGain: 0.02,
    pad: true, swell: 0.35,
  },
  explore: {
    bpm: 112, steps: 16, gain: 0.42,
    kick: [0, 8], snare: [], hat: [4, 12],
    bass: [[0, 0, 4], [4, 3, 2], [8, 4, 4], [12, 3, 2], [14, 2, 2]],
    arp: [0, 4, 7, 4, 3, 5, 8, 5],
    counter: [5, 4, 3, 4, 5, 7, 5, 4], counterShift: -12,
    lead: [4, 2, 0, 2, 4, 5, 7, 5], leadType: 'triangle', leadGain: 0.026,
    pad: true, swell: 0.55,
  },
  combat: {
    bpm: 128, steps: 16, gain: 0.55,
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14],
    bass: [[0, 0, 2], [2, 0, 2], [4, 3, 2], [6, 2, 2], [8, 0, 2], [10, 0, 2], [12, 4, 2], [14, 3, 2]],
    arp: [0, 2, 4, 6, 4, 2, 0, 2],
    counter: [7, 6, 4, 2, 0, 2, 4, 6], counterShift: -12,
    lead: [4, 2, 0, 2, 4, 5, 4, 2, 4, 7, 5, 4, 2, 0, 2, 4], leadType: 'square', leadGain: 0.034,
    pad: false, swell: 0.8,
  },
});

// A Halo-flavoured soundtrack pack, selected with setSoundtrack('halo'). It is
// deliberately original material — slow modal ritual music in D natural minor
// with a choir-like pad, a low open-fifth drone, tribal taiko drums and glassy
// bell accents — rather than any existing theme. The default tables above stay
// untouched so the engine's baseline behavior is unchanged.
export const HALO_THEME = frozen({ root: 73.415, scale: [0, 2, 3, 5, 7, 8, 10] });
export const HALO_PROGRESSIONS = frozen({
  menu: [0, 5, 3, 4, 0, 5, 6, 4],
  explore: [0, 3, 5, 4, 0, 5, 3, 4],
  combat: [0, 0, 5, 4, 0, 6, 5, 4],
});
export const HALO_ARRANGEMENTS = frozen({
  menu: {
    bpm: 62, steps: 16, gain: 0.5,
    kick: [0, 8], snare: [], hat: [],
    taiko: [0, 10], bell: [8], choir: true, drone: true,
    bass: [[0, 0, 6], [6, 2, 2], [8, 4, 6], [14, 5, 2]],
    arp: [0, 2, 4, 2, 3, 5, 4, 2],
    counter: [4, 2, 0, 2, 4, 5, 4, 2], counterShift: 12,
    lead: null, leadType: 'triangle', leadGain: 0.024,
    pad: true, swell: 0.4,
  },
  explore: {
    bpm: 70, steps: 16, gain: 0.44,
    kick: [0, 8], snare: [], hat: [],
    taiko: [0, 6, 10], bell: [12], choir: true, drone: true,
    bass: [[0, 0, 4], [4, 2, 4], [8, 5, 6], [14, 4, 2]],
    arp: [0, 2, 4, 2, 3, 4, 5, 4],
    counter: [4, 5, 4, 2, 0, 2, 3, 2], counterShift: 12,
    lead: [7, 5, 4, 5, 7, 9, 7, 5, 4, 2, 4, 5, 4, 2, 0, 2],
    leadType: 'triangle', leadGain: 0.028, leadShift: 12,
    pad: true, swell: 0.5,
  },
  combat: {
    bpm: 84, steps: 16, gain: 0.55,
    kick: [0, 6, 8, 14], snare: [4, 12], hat: [2, 6, 10, 14],
    taiko: [0, 3, 8, 11], bell: null, choir: true, drone: true,
    bass: [[0, 0, 2], [2, 0, 2], [4, 3, 2], [6, 2, 2], [8, 0, 2], [10, 0, 2], [12, 5, 2], [14, 4, 2]],
    arp: [0, 2, 4, 6, 4, 2, 0, 2],
    counter: [4, 5, 4, 2, 0, 2, 4, 5], counterShift: 12,
    lead: 'motif',
    leadFallback: [7, 5, 4, 5, 7, 4, 2, 4, 5, 7, 9, 7, 5, 4, 2, 4],
    leadType: 'square', leadGain: 0.034,
    pad: false, swell: 0.85,
  },
});

// Fill patterns replace the arpeggio (and add percussion accents / a crescendo
// roll) on the last bar of each four-bar half-phrase; the eighth bar of the
// eight-bar phrase is the big fill. `roll` scales the percussion crescendo.
const FILLS = frozen({
  menu: { arp: [7, 5, 4, 2], hat: [14, 15], roll: 0.25 },
  explore: { arp: [8, 7, 5, 3], hat: [14, 15], roll: 0.45 },
  combat: { arp: [8, 6, 4, 2], snare: [14, 15], roll: 0.7 },
});
const HALO_FILLS = frozen({
  menu: { arp: [5, 4, 2, 0], bell: [14], roll: 0.3 },
  explore: { arp: [5, 4, 2, 0], taiko: [14, 15], roll: 0.5 },
  combat: { arp: [8, 7, 6, 4], taiko: [13, 15], snare: [15], roll: 0.8 },
});
export const SOUNDTRACKS = frozen({
  default: { arrangements: ARRANGEMENTS, progressions: CHORD_PROGRESSIONS, fills: FILLS, theme: null },
  halo: { arrangements: HALO_ARRANGEMENTS, progressions: HALO_PROGRESSIONS, fills: HALO_FILLS, theme: HALO_THEME },
});

export const MUSIC_SCENES = Object.freeze(['menu', 'explore', 'combat']);

// Dynamic-layer entry points. Combat percussion, melodies and accents come in
// stages as the layer rises; on the way down the same thresholds gate them out
// after the eased release has had time to breathe.
const LAYER_THRESHOLDS = Object.freeze({ snare: 0.22, hat: 0.4, taiko: 0.32, bell: 0.45, counter: 0.28, lead: 0.42, choir: 0.12 });

export class MusicEngine {
  constructor({ ctx, destination, theme = null, noiseBuffer = null, seed = 1, maxVoices = 26, lookahead = 0.24 } = {}) {
    this.ctx = ctx || null;
    this.theme = theme || { root: 58, scale: [0, 3, 5, 7] };
    this.noiseBuffer = noiseBuffer || null;
    this.seed = (seed >>> 0) || 1;
    this.rng = mulberry32(this.seed);
    this.enabled = true;
    this.muted = false;
    this.scene = 'menu';
    this.intensity = 0;
    this.duck = 0;
    this.maxVoices = Math.max(6, maxVoices | 0);
    this.lookahead = clamp(Number(lookahead) || 0.24, 0.05, 0.5);
    this.step = 0;
    this.bar = 0;
    this.nextTime = null;
    this.voices = [];
    this.notesScheduled = 0;
    this.peakVoices = 0;
    // A cheap rolling fingerprint of every scheduled (freq, gain) pair; used by
    // tests to prove seeded determinism without rendering audio.
    this.scheduleChecksum = 0;
    this.notesBy = { kick: 0, snare: 0, hat: 0, taiko: 0, bell: 0, bass: 0, arp: 0, counter: 0, lead: 0, pad: 0, choir: 0, drone: 0, swell: 0, riser: 0, roll: 0, impact: 0 };
    this.previewUntil = 0;
    this.previewScene = 'menu';
    // Soundtrack tables are swapped wholesale by setSoundtrack(); default keeps
    // the baseline arrangements. Reverb is opt-in via setReverb().
    this.arrangements = ARRANGEMENTS;
    this.progressions = CHORD_PROGRESSIONS;
    this.fills = FILLS;
    this.motif = null;
    this.motifLead = null;
    this.reverbSend = null;
    this.reverbReturn = null;
    this.reverb = null;
    // Dynamic layer state: `layers` eases between 0 and 1 per scene so the menu
    // hands over to exploration and combat instead of hard switching. The
    // transition record tracks the outro swell / entrance accent machine.
    this.layers = { menu: 1, explore: 0, combat: 0 };
    this.transition = null;
    this.transitions = 0;
    this._lastActiveScene = 'menu';
    this._lastTime = null;
    // Gain buses. menu/explore/combat feed the music bus; the music bus feeds
    // the engine destination (which the host wires to its master gain).
    this.musicBus = null;
    this.buses = null;
    this._buildBuses(destination);
  }

  _buildBuses(destination) {
    if (!this.ctx || typeof this.ctx.createGain !== 'function') return;
    try {
      const mk = (gain) => { const g = this.ctx.createGain(); g.gain.value = gain; g.connect(this.musicBus); return g; };
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.0001;
      this.musicBus.connect(destination || this.ctx.destination);
      this.buses = {
        menu: mk(0.0001),
        explore: mk(0.0001),
        combat: mk(0.0001),
        // A dedicated percussion bus keeps kick/snare/hat together for ducking.
        drums: this.ctx.createGain(),
      };
      this.buses.drums.gain.value = 0.0001;
      this.buses.drums.connect(this.musicBus);
      // A reverb send/return lets a convolution impulse response (e.g. baked
      // from Moth's retrocausal echo) open the whole mix into a hall.
      if (typeof this.ctx.createConvolver === 'function') {
        this.reverbSend = this.ctx.createGain();
        this.reverbSend.gain.value = 1;
        this.reverbReturn = this.ctx.createGain();
        this.reverbReturn.gain.value = 0.0001;
        this.reverbReturn.connect(this.musicBus);
      }
    } catch { this.ctx = null; this.buses = null; }
  }

  setTheme(theme) {
    if (theme && Array.isArray(theme.scale) && Number.isFinite(theme.root)) this.theme = { root: theme.root, scale: theme.scale };
    return this.theme;
  }
  // Swap the whole arrangement/progression/fill pack. Unknown names fall back to
  // the baseline tables, and a pack's own theme (if any) is applied.
  setSoundtrack(name = 'default') {
    const pack = SOUNDTRACKS[name] || SOUNDTRACKS.default;
    this.arrangements = pack.arrangements;
    this.progressions = pack.progressions;
    this.fills = pack.fills || FILLS;
    if (pack.theme) this.setTheme(pack.theme);
    if (this.motif) this.setMotif(this.motif);
    this._resetTransport();
    return SOUNDTRACKS[name] ? name : 'default';
  }
  // A recorded motif (e.g. baked from qrc-midi) whose notes drive any
  // arrangement with `lead: 'motif'`, quantised to the active scale degrees.
  setMotif(motif) {
    this.motif = motif && Array.isArray(motif.notes) ? motif : null;
    const scale = this.theme.scale || [0, 3, 5, 7];
    const len = scale.length;
    const degrees = [];
    for (const note of this.motif?.notes || []) {
      const midi = Number(note?.midi);
      if (!Number.isFinite(midi)) continue;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const semi = 12 * Math.log2(freq / this.theme.root);
      let best = 0, bestError = Infinity;
      for (let d = -len; d <= len * 3; d++) {
        const value = scale[((d % len) + len) % len] + 12 * Math.floor(d / len);
        const error = Math.abs(value - semi);
        if (error < bestError) { bestError = error; best = d; }
      }
      degrees.push(best);
    }
    this.motifLead = degrees.length ? degrees : null;
    return this.motifLead?.length ?? 0;
  }
  _leadFor(arr) {
    if (Array.isArray(arr.lead)) return arr.lead;
    if (arr.lead === 'motif') return this.motifLead?.length ? this.motifLead : (Array.isArray(arr.leadFallback) ? arr.leadFallback : null);
    return null;
  }
  // Quarter-note position inside the lead line. Indexing by absolute quarter
  // count (rather than by step inside one bar) lets a sixteen-note theme or a
  // baked motif develop across four bars.
  _leadIndex(arr, step) {
    const lead = this._leadFor(arr);
    if (!lead?.length) return 0;
    const perBar = Math.max(1, Math.round((arr.steps || 16) / 4));
    const quarters = this.bar * perBar + Math.floor(step / 4);
    return ((quarters % lead.length) + lead.length) % lead.length;
  }
  // Route a convolution impulse response onto the reverb return. Safe to call
  // without a convolver (returns false) and safe to call before audio unlock.
  setReverb(buffer, { wet = 0.45 } = {}) {
    if (!this.ctx || !this.reverbSend || typeof this.ctx.createConvolver !== 'function') return false;
    try {
      const convolver = this.ctx.createConvolver();
      if (buffer) convolver.buffer = buffer;
      try { convolver.normalize = true; } catch {}
      this.reverbSend.disconnect?.();
      this.reverbSend.connect(convolver);
      convolver.connect(this.reverbReturn);
      const t = this._time();
      if (typeof this.reverbReturn.gain.setTargetAtTime === 'function') this.reverbReturn.gain.setTargetAtTime(wet, t, 0.3);
      else this.reverbReturn.gain.value = wet;
      this.reverb = convolver;
      return true;
    } catch { return false; }
  }
  setEnabled(on) { this.enabled = on !== false; return this.enabled; }
  setMuted(on) { this.muted = on === true; return this.muted; }
  setScene(scene) {
    const next = MUSIC_SCENES.includes(scene) ? scene : 'menu';
    if (next !== this.scene) { this.scene = next; this._resetTransport(); }
    return this.scene;
  }
  setIntensity(value) { this.intensity = clamp(Number(value) || 0, 0, 1); return this.intensity; }
  setDuck(value) { this.duck = clamp(Number(value) || 0, 0, 1); return this.duck; }
  preview(scene = 'menu', seconds = 8) {
    this.previewUntil = (this.ctx?.currentTime || 0) + Math.max(0, seconds);
    this.previewScene = MUSIC_SCENES.includes(scene) ? scene : 'menu';
    return this.previewScene;
  }
  status() {
    if (!this.ctx) return 'unavailable';
    if (this.muted) return 'muted';
    if (!this.enabled) return 'off';
    const state = this.ctx.state;
    return state === 'running' ? 'playing' : state === 'suspended' ? 'suspended' : (state || 'idle');
  }
  _resetTransport() {
    this.step = 0;
    this.bar = 0;
    this.nextTime = null;
    this.rng = mulberry32(this.seed);
  }
  // The active scene honours a running preview, then the engine scene with a
  // combat crossfade from intensity.
  _activeScene() {
    const t = this.ctx?.currentTime || 0;
    if (this.previewUntil > t) return this.previewScene || 'menu';
    if (this.scene === 'menu') return 'menu';
    return this.intensity >= 0.34 ? 'combat' : 'explore';
  }
  _time() { return this.ctx ? Number(this.ctx.currentTime) || 0 : 0; }
  _bpm(scene) { return (this.arrangements[scene] || this.arrangements.menu).bpm; }
  _stepDur(scene) { return 60 / (this._bpm(scene) * 4); }

  _vel() { return 0.93 + this.rng() * 0.14; }

  // Ease each scene layer toward its target. Rising layers move quickly enough
  // to feel responsive (combat enters over ~0.45 s); falling layers take much
  // longer, so a fight ends with a tail rather than a cut.
  _approachLayers(dt) {
    const scene = this._activeScene();
    const targets = { menu: scene === 'menu' ? 1 : 0, explore: scene === 'explore' ? 1 : 0, combat: scene === 'combat' ? 1 : 0 };
    for (const key of MUSIC_SCENES) {
      const target = targets[key];
      if (dt <= 0) continue;
      const tau = target > this.layers[key] ? (key === 'combat' ? 0.45 : 0.5) : (key === 'combat' ? 1.8 : 1.1);
      this.layers[key] += (target - this.layers[key]) * (1 - Math.exp(-dt / tau));
      if (Math.abs(target - this.layers[key]) < 0.001) this.layers[key] = target;
    }
  }

  // Watch for resolved-scene changes and open a transition. The exit swell fills
  // the rest of the old bar and an entrance accent lands on the next downbeat.
  _detectTransition(scene, time) {
    if (scene === this._lastActiveScene) return;
    const from = this._lastActiveScene;
    this._lastActiveScene = scene;
    this.transition = { from, to: scene, phase: 'outro', at: time, bar: this.bar, step: this.step, accents: 0 };
    this.transitions++;
  }

  _advanceDynamics(time) {
    const dt = this._lastTime === null ? 0 : clamp(time - this._lastTime, 0, 1);
    this._lastTime = time;
    this._approachLayers(dt);
    this._detectTransition(this._activeScene(), time);
  }

  // Apply bus gains for the resolved scene, layer state and intensity. Called
  // every tick and whenever scene/intensity changes; gains are eased so
  // transitions are smooth.
  _applyGains(time) {
    if (!this.buses) return;
    const t = Math.max(0, time);
    const on = this.enabled && !this.muted;
    const scene = this._activeScene();
    const target = { menu: 0.0001, explore: 0.0001, combat: 0.0001 };
    if (on) {
      const menuGain = this.arrangements.menu.gain || 0.5;
      const exploreGain = this.arrangements.explore.gain || 0.42;
      const combatGain = this.arrangements.combat.gain || 0.55;
      if (scene === 'menu') {
        target.menu = menuGain * (0.6 + 0.4 * this.layers.menu);
      } else {
        const combatMix = scene === 'combat' ? clamp((this.intensity - 0.34) / 0.3, 0, 1) : 0;
        const exploreFloor = scene === 'combat' ? 1 - combatMix * 0.7 : 1;
        target.explore = exploreGain * exploreFloor * (0.5 + 0.5 * this.layers.explore);
        if (scene === 'combat') target.combat = combatGain * (0.55 + 0.45 * this.layers.combat) * (0.6 + combatMix * 0.4);
      }
    }
    const duck = 1 - this.duck * 0.62;
    const driveHold = scene === 'combat' ? this.layers.combat : scene === 'explore' ? this.layers.explore : this.layers.menu;
    for (const [key, bus] of Object.entries(this.buses)) {
      if (key === 'drums') { try { bus.gain.setTargetAtTime(on ? 0.5 * duck * (0.7 + 0.3 * driveHold) : 0.0001, t, 0.14); } catch {} continue; }
      try { bus.gain.setTargetAtTime((target[key] || 0.0001) * duck, t, 0.25); } catch {}
    }
    try { this.musicBus.gain.setTargetAtTime(on ? 0.9 : 0.0001, t, 0.3); } catch {}
  }

  // A seeded noise buffer so swells and impacts work even when the host does not
  // hand one over. Safe to call in any context; returns null when unavailable.
  _noise() {
    if (this.noiseBuffer) return this.noiseBuffer;
    if (!this.ctx || typeof this.ctx.createBuffer !== 'function') return null;
    try {
      const rate = Number(this.ctx.sampleRate) || 44100;
      const length = Math.max(1, Math.floor(rate * 0.6));
      const buffer = this.ctx.createBuffer(1, length, rate);
      const data = buffer.getChannelData(0);
      const rng = mulberry32(this.seed ^ 0x85ebca6b);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = rng() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = white * 0.75 + last * 0.5;
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch { return null; }
  }

  _scheduleNote(time, bus, freq, dur, type, gain, end = 0, attack = 0.008, reverb = 0, pan = 0) {
    if (!this.ctx || !bus || this.voices.length >= this.maxVoices) return false;
    try {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, freq), time);
      if (end) o.frequency.exponentialRampToValueAtTime(Math.max(20, end), time + dur);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), time + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      const extra = [];
      o.connect(g);
      if (pan && typeof this.ctx.createStereoPanner === 'function') {
        const p = this.ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        g.connect(p); p.connect(bus);
        extra.push(p);
      } else {
        g.connect(bus);
      }
      if (reverb > 0 && this.reverbSend) {
        const send = this.ctx.createGain();
        send.gain.value = reverb;
        g.connect(send); send.connect(this.reverbSend);
        extra.push(send);
      }
      o.start(time); o.stop(time + dur + 0.04);
      const rec = { o, g, extra, end: time + dur + 0.05 };
      try { o.onended = () => { try { o.disconnect(); } catch {} try { g.disconnect(); } catch {} for (const n of extra) { try { n.disconnect(); } catch {} } }; } catch {}
      this.voices.push(rec);
      this.notesScheduled++;
      if (this.voices.length > this.peakVoices) this.peakVoices = this.voices.length;
      this.scheduleChecksum = (Math.imul(this.scheduleChecksum, 31) + ((Math.round(Math.max(20, freq)) ^ Math.round(gain * 4096)) | 0)) | 0;
      return true;
    } catch { return false; }
  }

  // Filtered noise voice: used for risers, impacts and swells. Returns false
  // when the context or buffer is unavailable, so callers can fall back to a
  // tonal swell and tests stay meaningful with a minimal mock.
  _scheduleNoise(time, bus, { dur = 0.3, gain = 0.08, type = 'bandpass', freq = 500, q = 0.8, sweep = 0, attack = 0.01, pan = 0, reverb = 0 } = {}) {
    if (!this.ctx || !bus || this.voices.length >= this.maxVoices) return false;
    const buffer = this._noise();
    if (!buffer || typeof this.ctx.createBufferSource !== 'function') return false;
    try {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buffer; src.loop = true;
      let node = src;
      const extra = [];
      if (typeof ctx.createBiquadFilter === 'function') {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(Math.max(30, freq), time);
        f.Q.value = q;
        if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweep), time + dur);
        src.connect(f); node = f; extra.push(f);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), time + Math.max(0.001, attack));
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      node.connect(g);
      if (pan && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        g.connect(p); p.connect(bus);
        extra.push(p);
      } else g.connect(bus);
      if (reverb > 0 && this.reverbSend) {
        const send = ctx.createGain();
        send.gain.value = reverb;
        g.connect(send); send.connect(this.reverbSend);
        extra.push(send);
      }
      src.start(time); src.stop(time + dur + 0.04);
      const rec = { o: src, g, extra, end: time + dur + 0.05 };
      try { src.onended = () => { try { src.disconnect(); } catch {} try { g.disconnect(); } catch {} for (const n of extra) { try { n.disconnect(); } catch {} } }; } catch {}
      this.voices.push(rec);
      this.notesScheduled++;
      if (this.voices.length > this.peakVoices) this.peakVoices = this.voices.length;
      this.scheduleChecksum = (Math.imul(this.scheduleChecksum, 31) + ((Math.round(freq) ^ Math.round(gain * 4096)) | 0)) | 0;
      return true;
    } catch { return false; }
  }

  _kick(time, bus, gain = 0.42) {
    if (this._scheduleNote(time, bus, 132, 0.17, 'sine', gain, 44, 0.002)) this.notesBy.kick++;
  }
  _snare(time, bus, gain = 0.16) {
    let ok = this._scheduleNote(time, bus, 210, 0.09, 'triangle', gain, 120, 0.002);
    ok = this._scheduleNote(time, bus, 1500, 0.05, 'square', gain * 0.5, 900, 0.002) || ok;
    if (ok) this.notesBy.snare++;
  }
  _hat(time, bus, gain = 0.05) {
    if (this._scheduleNote(time, bus, 7800, 0.03, 'square', gain * (0.88 + this.rng() * 0.24), 5200, 0.001)) this.notesBy.hat++;
  }
  // Tribal/taiko drum: a low pitched body plus a short noisy frame crack.
  _taiko(time, bus, gain = 0.5) {
    let ok = this._scheduleNote(time, bus, 150, 0.3, 'sine', gain * this._vel(), 48, 0.002, 0.2, -0.08);
    ok = this._scheduleNote(time, bus, 82, 0.34, 'sine', gain * 0.6, 40, 0.002, 0.2, 0.08) || ok;
    ok = this._scheduleNote(time, bus, 1700, 0.045, 'triangle', gain * 0.16, 950, 0.001, 0.2, 0) || ok;
    if (ok) this.notesBy.taiko++;
  }
  // Glassy FM-ish bell: a fundamental plus an inharmonic partial.
  _bell(time, bus, gain = 0.06) {
    let ok = this._scheduleNote(time, bus, 1320, 1.4, 'sine', gain * this._vel(), 1318, 0.005, 0.6, -0.3);
    ok = this._scheduleNote(time, bus, 1979, 0.9, 'sine', gain * 0.45, 1977, 0.005, 0.62, 0.3) || ok;
    if (ok) this.notesBy.bell++;
  }
  // Bass: a saw body plus a sine sub, so the low end stays defined under the
  // pads. Callers move the line with root/third/fourth/octave degrees.
  _bass(time, bus, freq, dur, gain) {
    let ok = this._scheduleNote(time, bus, freq, dur, 'sawtooth', gain, freq * 0.985, 0.006);
    ok = this._scheduleNote(time, bus, freq / 2, dur * 0.95, 'sine', gain * 0.5, freq / 2 * 0.99, 0.006) || ok;
    if (ok) this.notesBy.bass++;
  }
  // Choir-like pad: detuned voices per chord tone that beat gently, panned in
  // pairs for width and drenched in the reverb send. Shrinks to four voices
  // when the engine is close to its cap so it can never starve the beat.
  _choir(time, bus, root, scale, chord, dur) {
    const available = this.maxVoices - this.voices.length;
    if (available < 4) return false;
    const pairs = available >= 10 ? 4 : 2;
    const offsets = [0, 2, 4, 7];
    let scheduled = false;
    for (let i = 0; i < pairs; i++) {
      const f = noteFreq(root / 2, scale, chord + offsets[i]);
      const pan = i % 2 ? 0.3 : -0.3;
      if (this._scheduleNote(time, bus, f, dur, 'sawtooth', 0.016 * this._vel(), f * 0.999, 0.9, 0.5, pan)) scheduled = true;
      if (this._scheduleNote(time, bus, f * 1.003, dur, 'triangle', 0.01 * this._vel(), f * 1.001, 1.1, 0.5, -pan)) scheduled = true;
    }
    return scheduled;
  }
  // Rising filtered-noise swell with a tonal fallback for contexts without a
  // noise buffer (unit-test mocks, renderers without buffer sources).
  _riser(time, bus, dur, gain, pan = 0) {
    if (this._scheduleNoise(time, bus, { dur, gain, type: 'bandpass', freq: 420, q: 0.7, sweep: 4200, attack: dur * 0.6, pan })) { this.notesBy.riser++; return true; }
    const root = this.theme.root;
    if (this._scheduleNote(time, bus, root * 2, dur, 'sawtooth', gain * 0.5 * this._vel(), root * 3, dur * 0.55, 0.15, pan)) { this.notesBy.swell++; return true; }
    return false;
  }
  // Entrance accent for a scene change: a sub boom plus (when available) a noise
  // impact, topped with a bell/open-fifth hit for the combat downbeat.
  _entrance(time, transition, bus, drumBus, chord) {
    const root = this.theme.root, scale = this.theme.scale;
    if (transition.to === 'combat') {
      this._kick(time, drumBus, 0.62);
      if (this._scheduleNote(time, drumBus, 58, 0.9, 'sine', 0.22, 26, 0.004, 0.1, 0)) this.notesBy.impact++;
      if (this._scheduleNoise(time, drumBus, { dur: 0.5, gain: 0.1, type: 'lowpass', freq: 900, q: 0.7, sweep: 70, attack: 0.004 })) this.notesBy.riser++;
      if (this._scheduleNote(time, bus, noteFreq(root, scale, chord + 7), 1.2, 'sine', 0.05, 0, 0.01, 0.5, 0.2)) this.notesBy.impact++;
    } else {
      this._taiko(time, drumBus, transition.to === 'explore' ? 0.4 : 0.24);
      if (this._scheduleNote(time, bus, noteFreq(root / 2, scale, chord), 1.4, 'sine', 0.045, 0, 0.4, 0.5, -0.12)) this.notesBy.impact++;
    }
    transition.accents++;
  }

  _prune(time) {
    if (!this.voices.length) return;
    const kept = [];
    for (const rec of this.voices) if (rec.end > time) kept.push(rec);
    if (kept.length !== this.voices.length) this.voices = kept;
  }

  // Phrase position: the fourth bar of each half-phrase is a small fill and the
  // eighth bar is the big one.
  _fillLevel() {
    if (this.bar % 8 === 7) return 2;
    if (this.bar % 4 === 3) return 1;
    return 0;
  }

  _scheduleStep(time, scene, step) {
    const arr = this.arrangements[scene];
    if (!arr) return;
    const bus = this.buses?.[scene] || this.musicBus;
    const drumBus = this.buses?.drums || bus;
    const prog = this.progressions[scene] || this.progressions.menu;
    const chord = prog[this.bar % prog.length];
    const root = this.theme.root;
    const scale = this.theme.scale;
    const stepDur = this._stepDur(scene);
    const hold = scene === 'combat' ? this.layers.combat : scene === 'explore' ? this.layers.explore : this.layers.menu;
    const fillLevel = this._fillLevel();
    const fill = fillLevel > 0 ? (this.fills[scene] || null) : null;
    const stepsLeft = Math.max(1, arr.steps - step);
    // Drums: the combat grid enters in stages (kick -> snare -> hats) as the
    // layer rises, so a fight builds instead of slamming in.
    const drumGrid = (list, kind) => { if (!list) return; for (const s of list) if ((s + arr.steps) % arr.steps === step) kind(); };

    // 1. Scene-transition edges: the rest of the old bar carries a rising swell,
    //    the downbeat of the new scene lands an entrance accent.
    const transition = this.transition;
    let entering = false;
    if (transition) {
      if (transition.phase === 'outro') {
        if (step === 0) {
          this._entrance(time, transition, bus, drumBus, chord);
          transition.phase = 'enter';
          transition.enteredBar = this.bar;
          entering = true;
        } else if (stepsLeft <= 4) {
          const amount = (5 - stepsLeft) / 4;
          this._riser(time, drumBus, stepDur * 1.6, 0.015 + 0.05 * amount, step % 2 ? 0.22 : -0.22);
        }
      } else if (transition.phase === 'enter' && step === 0 && this.bar !== transition.enteredBar) {
        transition.phase = 'idle';
      }
    }
    const boosted = entering || Boolean(transition && transition.phase === 'enter');

    // 2. Percussion.
    if (scene === 'combat') {
      drumGrid(arr.kick, () => this._kick(time, drumBus, 0.5));
      if (entering || hold >= LAYER_THRESHOLDS.snare) drumGrid(arr.snare, () => this._snare(time, drumBus, 0.2));
      if (entering || hold >= LAYER_THRESHOLDS.hat) drumGrid(arr.hat, () => this._hat(time, drumBus, 0.055));
    } else {
      drumGrid(arr.kick, () => this._kick(time, drumBus, 0.34));
      drumGrid(arr.snare, () => this._snare(time, drumBus, 0.13));
      drumGrid(arr.hat, () => this._hat(time, drumBus, 0.035));
    }
    if (fill && (scene !== 'combat' || boosted || hold >= LAYER_THRESHOLDS.snare)) {
      if (fill.hat) drumGrid(fill.hat, () => this._hat(time, drumBus, 0.05));
      if (fill.snare) drumGrid(fill.snare, () => this._snare(time, drumBus, fillLevel === 2 ? 0.2 : 0.16));
    }

    // 3. Tribal and bell accents.
    const taikoOn = scene !== 'combat' || boosted || hold >= LAYER_THRESHOLDS.taiko;
    const bellOn = scene !== 'combat' || boosted || hold >= LAYER_THRESHOLDS.bell;
    if (arr.taiko && taikoOn) drumGrid(arr.taiko, () => this._taiko(time, drumBus, scene === 'combat' ? 0.5 : 0.34));
    if (fill && fill.taiko && taikoOn) drumGrid(fill.taiko, () => this._taiko(time, drumBus, 0.4));
    if (arr.bell && bellOn) drumGrid(arr.bell, () => this._bell(time, bus, scene === 'combat' ? 0.06 : 0.05));
    if (fill && fill.bell && bellOn) drumGrid(fill.bell, () => this._bell(time, bus, 0.04));

    // 4. Bass movement (root/fourth/octave passing tones inside the bar).
    for (const [s, deg, len] of arr.bass) if ((s + arr.steps) % arr.steps === step) {
      const f = noteFreq(root / 2, scale, deg + chord);
      this._bass(time, bus, f, len * stepDur * 0.94, scene === 'combat' ? 0.12 : 0.09);
    }

    // 5. Lead: a quarter-note line that develops across bars. Gated by the layer
    //    hold so the melody arrives after the groove has established itself.
    const lead = this._leadFor(arr);
    if (lead && step % 4 === 0 && hold >= LAYER_THRESHOLDS.lead) {
      const f = noteFreq(root, scale, lead[this._leadIndex(arr, step)] + chord) * Math.pow(2, (Number(arr.leadShift) || 0) / 12);
      const type = arr.leadType || 'square';
      const gain = (Number(arr.leadGain) || 0.032) * (scene === 'combat' ? 1 : 0.9) * this._vel();
      if (this._scheduleNote(time, bus, f, stepDur * 3.4, type, gain, 0, 0.02, 0.28, 0.06)) this.notesBy.lead++;
    }

    // 6. Counter-line on the offbeats, answering the lead an octave away and
    //    panned opposite the arpeggio.
    if (arr.counter && step % 2 === 1 && hold >= LAYER_THRESHOLDS.counter) {
      const i = (step - 1) / 2;
      const f = noteFreq(root, scale, arr.counter[i % arr.counter.length] + chord) * Math.pow(2, (Number(arr.counterShift) || 0) / 12);
      const pan = step % 4 === 1 ? 0.22 : -0.22;
      if (this._scheduleNote(time, bus, f, stepDur * 1.6, 'triangle', 0.018 * this._vel(), 0, 0.012, 0.22, pan)) this.notesBy.counter++;
    }

    // 7. Arpeggio: one degree per eighth note with a soft octave shimmer off the
    //    menu, spread gently across the stereo field.
    const arp = fill?.arp || arr.arp;
    if (arp && step % 2 === 0) {
      const i = step / 2;
      const f = noteFreq(root, scale, arp[i % arp.length] + chord);
      const pan = i % 2 ? -0.2 : 0.2;
      if (this._scheduleNote(time, bus, f, stepDur * 1.7, 'triangle', (scene === 'combat' ? 0.055 : 0.045) * this._vel(), 0, 0.01, 0.12, pan)) this.notesBy.arp++;
      if (scene !== 'menu' && this._scheduleNote(time, bus, f * 2, stepDur * 1.1, 'sine', 0.016 * this._vel(), 0, 0.012, 0.2, -pan)) this.notesBy.arp++;
    }

    // 8. Phrase swells: the last four 16ths of the big fill bar crescendo with a
    //    noise/string riser and a percussion roll, then resolve on the downbeat.
    if (fillLevel === 2 && stepsLeft <= 4 && !(transition && transition.phase === 'outro') && Number(arr.swell) > 0) {
      const amount = (5 - stepsLeft) / 4;
      this._riser(time, drumBus, stepDur * 1.5, 0.012 + 0.05 * Number(arr.swell) * amount, step % 2 ? 0.18 : -0.18);
      if (scene !== 'menu' && (scene !== 'combat' || hold >= LAYER_THRESHOLDS.snare)) {
        const grow = (0.07 + 0.11 * amount) * (Number(fill?.roll) || 0.4);
        if (scene === 'combat') this._snare(time, drumBus, grow); else this._taiko(time, drumBus, 0.12 + grow * 0.5);
        this.notesBy.roll++;
      }
    }

    // 9. Pads: a sustained root+fifth at the top of each bar with a slow swell.
    if (arr.pad && step === 0) {
      const padDur = stepDur * arr.steps * 0.96;
      const r = noteFreq(root / 2, scale, chord), fifth = noteFreq(root / 2, scale, chord + 4);
      if (this._scheduleNote(time, bus, r, padDur, 'sine', 0.03 * this._vel(), 0, 0.5, 0.35, -0.15)) this.notesBy.pad++;
      if (this._scheduleNote(time, bus, fifth, padDur, 'sine', 0.022 * this._vel(), 0, 0.6, 0.4, 0.15)) this.notesBy.pad++;
    }
    if (arr.choir && step === 0 && hold >= LAYER_THRESHOLDS.choir) {
      if (this._choir(time, bus, root, scale, chord, stepDur * arr.steps * 0.98)) this.notesBy.choir++;
    }
    // Low drone: a slow root+fifth every other bar, mostly dry so the bass
    // stays defined under the wash.
    if (arr.drone && step === 0 && this.bar % 2 === 0) {
      const droneDur = stepDur * arr.steps * 2 * 0.98;
      const f = noteFreq(root / 4, scale, 0);
      if (this._scheduleNote(time, bus, f, droneDur, 'sine', 0.05 * this._vel(), 0, 0.4, 0.08, -0.1)) this.notesBy.drone++;
      if (this._scheduleNote(time, bus, noteFreq(root / 4, scale, 4), droneDur, 'sine', 0.034 * this._vel(), 0, 0.5, 0.08, 0.1)) this.notesBy.drone++;
    }
  }

  // Advance the 16th-note grid by one step and roll the bar counter. Called
  // after each scheduled step so phrase fills land on the fourth/eighth bar.
  _advance() {
    this.step++;
    const arr = this.arrangements[this._activeScene()] || this.arrangements.menu;
    if (this.step >= arr.steps) { this.step = 0; this.bar++; }
  }

  // The only entry point the host calls, once per frame. Returns the number of
  // steps scheduled this call (0 when idle or fully scheduled ahead).
  tick() {
    if (!this.ctx || !this.buses) return 0;
    const t = this._time();
    this._advanceDynamics(t);
    this._applyGains(t);
    if (!this.enabled || this.muted) { this.nextTime = null; this._prune(t); return 0; }
    const scene = this._activeScene();
    if (this.nextTime === null || this.nextTime < t - 0.4) this.nextTime = t + 0.06;
    let scheduled = 0;
    while (this.nextTime < t + this.lookahead && scheduled < 8) {
      this._scheduleStep(this.nextTime, scene, this.step);
      this.nextTime += this._stepDur(scene);
      this._advance();
      scheduled++;
    }
    this._prune(t);
    return scheduled;
  }

  _stopVoice(rec) {
    try { rec.o.onended = null; } catch {}
    try { rec.o.stop(); } catch {}
    try { rec.o.disconnect(); } catch {}
    try { rec.g.disconnect(); } catch {}
    for (const n of rec.extra || []) { try { n.disconnect(); } catch {} }
  }

  dispose() {
    for (const rec of this.voices) this._stopVoice(rec);
    this.voices = [];
    if (this.buses) { for (const bus of Object.values(this.buses)) { try { bus.disconnect(); } catch {} } this.buses = null; }
    try { this.reverbSend?.disconnect(); } catch {}
    try { this.reverbReturn?.disconnect(); } catch {}
    try { this.reverb?.disconnect(); } catch {}
    this.reverbSend = null; this.reverbReturn = null; this.reverb = null;
    try { this.musicBus?.disconnect(); } catch {}
    this.musicBus = null;
    this.transition = null;
    this._lastTime = null;
    this.ctx = null;
  }
}

export const MUSIC_EXPORTS = Object.freeze(['MusicEngine', 'MUSIC_SCENES', 'CHORD_PROGRESSIONS', 'ARRANGEMENTS', 'SOUNDTRACKS', 'HALO_THEME', 'HALO_ARRANGEMENTS', 'HALO_PROGRESSIONS']);
