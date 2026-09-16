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
// scene and intensity, which layers combat material over exploration material
// instead of switching abruptly.
//
// No three.js import and no DOM: the class is exercised in unit tests through a
// minimal mock context, and a real OfflineAudioContext can render it for a
// non-silence check.

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Scale-degree helper: wraps degrees into octaves.
const degree = (scale, i) => {
  const len = scale.length;
  const octave = Math.floor(i / len);
  return scale[((i % len) + len) % len] + octave * 12;
};
const noteFreq = (root, scale, i) => root * Math.pow(2, degree(scale, i) / 12);

// Four-bar chord progressions in scale degrees. `menu` is gentle, `explore`
// moves, `combat` sits on a pedal tone for urgency. All three start on the tonic
// so they blend when layered.
export const CHORD_PROGRESSIONS = Object.freeze({
  menu: Object.freeze([0, 3, 5, 3]),
  explore: Object.freeze([0, 3, 4, 3]),
  combat: Object.freeze([0, 0, 3, 4]),
});

// Arrangement data. `bass` is [step, degree, lengthInSteps]; `arp`/`lead` are one
// degree per eighth note (two steps). `kick`/`snare`/`hat` are 16-step grids.
export const ARRANGEMENTS = Object.freeze({
  menu: Object.freeze({
    bpm: 84, steps: 16, gain: 0.5,
    kick: Object.freeze([0, 8]), snare: Object.freeze([]), hat: Object.freeze([4, 12]),
    bass: Object.freeze([[0, 0, 6], [8, 4, 6]]),
    arp: Object.freeze([0, 2, 4, 2, 3, 5, 7, 5]),
    lead: Object.freeze([4, 7, 9, 7, 5, 4, 2, 0]),
    pad: true,
  }),
  explore: Object.freeze({
    bpm: 112, steps: 16, gain: 0.42,
    kick: Object.freeze([0, 8]), snare: Object.freeze([]), hat: Object.freeze([4, 12]),
    bass: Object.freeze([[0, 0, 8], [8, 3, 8]]),
    arp: Object.freeze([0, 4, 7, 4, 3, 5, 8, 5]),
    lead: null,
    pad: true,
  }),
  combat: Object.freeze({
    bpm: 128, steps: 16, gain: 0.55,
    kick: Object.freeze([0, 4, 8, 12]), snare: Object.freeze([4, 12]), hat: Object.freeze([2, 6, 10, 14]),
    bass: Object.freeze([[0, 0, 2], [2, 0, 2], [4, 3, 2], [6, 3, 2], [8, 0, 2], [10, 0, 2], [12, 4, 2], [14, 3, 2]]),
    arp: Object.freeze([0, 2, 4, 6, 4, 2, 0, 2]),
    lead: Object.freeze([7, 9, 11, 9, 7, 4, 7, 4]),
    pad: false,
  }),
});

// Fill patterns replace the last bar of each four-bar phrase so a short loop
// does not become exhausting.
const FILLS = Object.freeze({
  menu: Object.freeze({ arp: Object.freeze([7, 5, 4, 2]), hat: Object.freeze([14, 15]) }),
  explore: Object.freeze({ arp: Object.freeze([8, 7, 5, 3]), hat: Object.freeze([14, 15]) }),
  combat: Object.freeze({ arp: Object.freeze([8, 6, 4, 2]), snare: Object.freeze([14, 15]) }),
});

export const MUSIC_SCENES = Object.freeze(['menu', 'explore', 'combat']);

export class MusicEngine {
  constructor({ ctx, destination, theme = null, noiseBuffer = null, seed = 1, maxVoices = 26, lookahead = 0.24 } = {}) {
    this.ctx = ctx || null;
    this.theme = theme || { root: 58, scale: [0, 3, 5, 7] };
    this.noiseBuffer = noiseBuffer || null;
    this.seed = (seed >>> 0) || 1;
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
    this.previewUntil = 0;
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
    } catch { this.ctx = null; this.buses = null; }
  }

  setTheme(theme) {
    if (theme && Array.isArray(theme.scale) && Number.isFinite(theme.root)) this.theme = { root: theme.root, scale: theme.scale };
    return this.theme;
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
  _bpm(scene) { return (ARRANGEMENTS[scene] || ARRANGEMENTS.menu).bpm; }
  _stepDur(scene) { return 60 / (this._bpm(scene) * 4); }

  // Apply bus gains for the resolved scene and intensity. Called every tick and
  // whenever scene/intensity changes; gains are eased so transitions are smooth.
  _applyGains(time) {
    if (!this.buses) return;
    const t = Math.max(0, time);
    const on = this.enabled && !this.muted;
    const scene = this._activeScene();
    const target = { menu: 0.0001, explore: 0.0001, combat: 0.0001 };
    if (on) {
      if (scene === 'menu') target.menu = (ARRANGEMENTS.menu.gain || 0.5);
      else if (scene === 'explore') target.explore = (ARRANGEMENTS.explore.gain || 0.42);
      else { const k = clamp((this.intensity - 0.34) / 0.3, 0, 1); target.explore = (ARRANGEMENTS.explore.gain || 0.42) * (1 - k * 0.7); target.combat = (ARRANGEMENTS.combat.gain || 0.55) * (0.6 + k * 0.4); }
    }
    const duck = 1 - this.duck * 0.62;
    for (const [key, bus] of Object.entries(this.buses)) {
      if (key === 'drums') { try { bus.gain.setTargetAtTime(on ? 0.5 * duck : 0.0001, t, 0.12); } catch {} continue; }
      try { bus.gain.setTargetAtTime((target[key] || 0.0001) * duck, t, 0.25); } catch {}
    }
    try { this.musicBus.gain.setTargetAtTime(on ? 0.9 : 0.0001, t, 0.3); } catch {}
  }

  _scheduleNote(time, bus, freq, dur, type, gain, end = 0, attack = 0.008) {
    if (!this.ctx || !bus || this.voices.length >= this.maxVoices) return false;
    try {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, freq), time);
      if (end) o.frequency.exponentialRampToValueAtTime(Math.max(20, end), time + dur);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), time + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(bus);
      o.start(time); o.stop(time + dur + 0.04);
      const rec = { o, g, end: time + dur + 0.05 };
      try { o.onended = () => { try { o.disconnect(); } catch {} try { g.disconnect(); } catch {} }; } catch {}
      this.voices.push(rec);
      this.notesScheduled++;
      return true;
    } catch { return false; }
  }
  _kick(time, bus, gain = 0.42) {
    this._scheduleNote(time, bus, 132, 0.17, 'sine', gain, 44, 0.002);
  }
  _snare(time, bus, gain = 0.16) {
    this._scheduleNote(time, bus, 210, 0.09, 'triangle', gain, 120, 0.002);
    this._scheduleNote(time, bus, 1500, 0.05, 'square', gain * 0.5, 900, 0.002);
  }
  _hat(time, bus, gain = 0.05) {
    this._scheduleNote(time, bus, 7800, 0.03, 'square', gain, 5200, 0.001);
  }
  _prune(time) {
    if (!this.voices.length) return;
    const kept = [];
    for (const rec of this.voices) if (rec.end > time) kept.push(rec);
    if (kept.length !== this.voices.length) this.voices = kept;
  }

  _scheduleStep(time, scene, step) {
    const arr = ARRANGEMENTS[scene];
    if (!arr) return;
    const bus = this.buses?.[scene] || this.musicBus;
    const drumBus = this.buses?.drums || bus;
    const chord = (CHORD_PROGRESSIONS[scene] || CHORD_PROGRESSIONS.menu)[this.bar % (CHORD_PROGRESSIONS[scene] || CHORD_PROGRESSIONS.menu).length];
    const root = this.theme.root;
    const scale = this.theme.scale;
    const stepDur = this._stepDur(scene);
    const fill = this._isFill() ? FILLS[scene] : null;
    // Drums
    const drumGrid = (list, kind) => { for (const s of list) if ((s + 16) % arr.steps === step) kind(); };
    if (scene !== 'menu' || true) {
      drumGrid(arr.kick, () => this._kick(time, drumBus, scene === 'combat' ? 0.5 : 0.34));
      drumGrid(arr.snare, () => this._snare(time, drumBus, scene === 'combat' ? 0.2 : 0.13));
      drumGrid(arr.hat, () => this._hat(time, drumBus, scene === 'combat' ? 0.055 : 0.035));
    }
    if (fill?.hat) drumGrid(fill.hat, () => this._hat(time, drumBus, 0.06));
    if (fill?.snare) drumGrid(fill.snare, () => this._snare(time, drumBus, 0.18));
    // Bass
    for (const [s, deg, len] of arr.bass) if ((s + 16) % arr.steps === step) {
      const f = noteFreq(root / 2, scale, deg + chord);
      this._scheduleNote(time, bus, f, len * stepDur * 0.94, 'sawtooth', scene === 'combat' ? 0.12 : 0.09, f * 0.985, 0.006);
      this._scheduleNote(time, bus, f / 2, len * stepDur * 0.9, 'sine', 0.06, f / 2 * 0.99, 0.006);
    }
    // Arpeggio: one degree per eighth note.
    const arp = fill?.arp || arr.arp;
    if (arp && step % 2 === 0) {
      const i = step / 2;
      const deg = arp[i % arp.length] + chord;
      const f = noteFreq(root, scale, deg);
      this._scheduleNote(time, bus, f, stepDur * 1.7, 'triangle', scene === 'combat' ? 0.055 : 0.045, 0, 0.01);
      if (scene !== 'menu') this._scheduleNote(time, bus, f * 2, stepDur * 1.1, 'sine', 0.018, 0, 0.012);
    }
    // Lead: a melodic counter-line, only once the combat layer is established.
    if (arr.lead && scene === 'combat' && step % 4 === 0) {
      const i = step / 4;
      const f = noteFreq(root, scale, arr.lead[i % arr.lead.length] + chord);
      this._scheduleNote(time, bus, f, stepDur * 3.4, 'square', 0.032, 0, 0.02);
    }
    // Pad: a sustained root+fifth at the top of each bar for menu/explore.
    if (arr.pad && step === 0) {
      const padDur = this._stepDur(scene) * arr.steps * 0.96;
      const r = noteFreq(root / 2, scale, chord), fifth = noteFreq(root / 2, scale, chord + 4);
      this._scheduleNote(time, bus, r, padDur, 'sine', 0.03, 0, 0.5);
      this._scheduleNote(time, bus, fifth, padDur, 'sine', 0.022, 0, 0.6);
    }
  }

  _isFill() { return this.bar % 4 === 3; }

  // Advance the 16th-note grid by one step and roll the bar counter. Called after
  // each scheduled step so phrase fills land on the fourth bar.
  _advance() {
    this.step++;
    const arr = ARRANGEMENTS[this._activeScene()] || ARRANGEMENTS.menu;
    if (this.step >= arr.steps) { this.step = 0; this.bar++; }
  }

  // The only entry point the host calls, once per frame. Returns the number of
  // steps scheduled this call (0 when idle or fully scheduled ahead).
  tick() {
    if (!this.ctx || !this.buses) return 0;
    const t = this._time();
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

  dispose() {
    for (const rec of this.voices) { try { rec.o.onended = null; } catch {} try { rec.o.stop(); } catch {} try { rec.o.disconnect(); } catch {} try { rec.g.disconnect(); } catch {} }
    this.voices = [];
    if (this.buses) { for (const bus of Object.values(this.buses)) { try { bus.disconnect(); } catch {} } this.buses = null; }
    try { this.musicBus?.disconnect(); } catch {}
    this.musicBus = null;
    this.ctx = null;
  }
}

export const MUSIC_EXPORTS = Object.freeze(['MusicEngine', 'MUSIC_SCENES', 'CHORD_PROGRESSIONS', 'ARRANGEMENTS']);
