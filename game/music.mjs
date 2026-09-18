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
//   brass / timpani         optional low-brass and timpani lines
//   swell                   0..1 phrase-swell depth on the final bar
//
// Orchestral voices (pad/brass/taiko/bells/timpani) are served by the baked CC0
// sample set (game/sampler.mjs, streamed from /music/*) when it has decoded, and
// fall back to the oscillator voices otherwise. The choice is seeded from this
// engine's RNG and folded into `scheduleChecksum`, so one seed reproduces one
// take with or without samples.
//
// No three.js import and no DOM: the class is exercised in unit tests through a
// minimal mock context, and a real OfflineAudioContext can render it for a
// non-silence check. Noise uses a seeded PRNG, voice allocation is bounded and
// every voice is pruned by schedule time, so one seed reproduces one take.

import { MUSIC_BASE, SampleBank, loopWindow, sampleRateFor, selectSample } from './sampler.mjs';

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
  results: [0, 3, 2, 3, 0, 4, 3, 0],
});

// Chord-tone intervals in semitones above the chord root, keyed by quality.
// The pad, choir and brass read these so a borrowed major V and a Picardy I are
// audible; the melodic layers keep following scale degrees.
export const CHORD_TONES = frozen({
  m: [0, 3, 7, 12],
  M: [0, 4, 7, 12],
  sus: [0, 5, 7, 12],
  dim: [0, 3, 6, 12],
});

// The recurring COCS leitmotif (D natural minor scale degrees, one quarter note
// each): a rising i-triad, a climb to the minor seventh, a stepwise fall and a
// leading-tone cadence. Every scene derives from it (augmentation, sequence,
// inversion, diminution, Picardy major, bell fragmentation).
export const COCS_MOTIF = frozen([0, 2, 4, 3, 2, 4, 6, 4, 5, 4, 3, 2, 1, 2, 0, 0]);

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
  results: {
    bpm: 84, steps: 16, gain: 0.46,
    kick: [0, 8], snare: [], hat: [4, 12],
    bass: [[0, 0, 6], [8, 3, 6]],
    arp: [0, 2, 4, 2, 3, 5, 4, 2],
    counter: [4, 2, 0, 2, 3, 2, 0, 2], counterShift: -12,
    lead: [0, 2, 4, 2, 3, 4, 5, 4, 2, 0, 2, 3, 2, 0, 2, 0], leadType: 'triangle', leadGain: 0.02,
    pad: true, swell: 0.3,
  },
});

// A Halo-flavoured soundtrack pack, selected with setSoundtrack('halo'). It is
// deliberately original material — slow modal ritual music in D natural minor
// with a choir-like pad, a low open-fifth drone, tribal taiko drums and glassy
// bell accents — rather than any existing theme. The default tables above stay
// untouched so the engine's baseline behavior is unchanged.
export const HALO_THEME = frozen({ root: 73.415, scale: [0, 2, 3, 5, 7, 8, 10] });

// Functional 8-bar progressions in D natural minor. Each bar carries a root
// scale degree plus a quality (m/M) so the third and fifth can be fixed:
//   menu    i   VI  III VII | i   VI  iv  v
//   explore i   VI  iv  v   | i   VII VI  v
//   combat  i   VI  III VII | iv  v   V   i   (borrowed major V)
//   results i   VI  III IV  | V   i   V   i   (Picardy tonic at the close)
export const HALO_PROGRESSIONS = frozen({
  menu: [0, 5, 2, 6, 0, 5, 3, 4],
  explore: [0, 5, 3, 4, 0, 6, 5, 4],
  combat: [0, 5, 2, 6, 3, 4, 4, 0],
  results: [0, 5, 2, 3, 4, 0, 4, 0],
});
export const HALO_QUALITIES = frozen({
  menu: ['m', 'M', 'M', 'M', 'm', 'M', 'm', 'm'],
  explore: ['m', 'M', 'm', 'm', 'm', 'M', 'M', 'm'],
  combat: ['m', 'M', 'M', 'M', 'm', 'm', 'M', 'm'],
  results: ['m', 'M', 'M', 'M', 'M', 'm', 'M', 'M'],
});
// Halo arrangements. Every scene voices the COCS leitmotif through a different
// development: augmented and sequenced in the menu, stated then sequenced in
// exploration, stated, sequenced and inverted in combat, and turned to the
// Picardy major at the results screen. `strings: true` gives a scene the sampled
// string bed even when it is not a chorale (combat), and the optional
// `stringsStaccato`/`brassMarcato`/`cymbals`/`timpaniRoll`/`bellToll`/`gong`/
// `trumpet` flags ask for the M1 baked instruments, falling back gracefully.
export const HALO_ARRANGEMENTS = frozen({
  menu: {
    bpm: 62, steps: 16, gain: 0.5,
    kick: [0, 8], snare: [], hat: [],
    taiko: [0, 10], bell: [8], bellToll: true, bellFragment: true, gong: true, harp: true, timpani: [0], choir: true, drone: true,
    bass: [[0, 0, 6], [6, 2, 2], [8, 4, 6], [14, 5, 2]],
    brass: [[4, 4, 4], [12, 2, 4]],
    arp: [0, 2, 4, 2, 3, 5, 4, 2],
    counter: [4, 2, 0, 2, 4, 5, 4, 2], counterShift: 12,
    // Augmentation: the first four degrees at half speed (one note per two
    // bars), sequenced up a third in the second half of the phrase.
    lead: COCS_MOTIF.slice(0, 4), leadRate: 2, leadSequence: 2, leadOctave: 1,
    leadType: 'triangle', leadGain: 0.02,
    strings: true, pad: true, swell: 0.4,
  },
  explore: {
    bpm: 72, steps: 16, gain: 0.44,
    kick: [0, 8], snare: [], hat: [],
    taiko: [0, 6, 10], bell: [12], bellToll: true, timpani: [0, 8], choir: true, drone: true,
    bass: [[0, 0, 4], [4, 2, 4], [8, 5, 6], [14, 4, 2]],
    brass: [[0, 0, 4], [8, 5, 6]],
    arp: [0, 2, 4, 2, 3, 4, 5, 4],
    counter: [4, 5, 4, 2, 0, 2, 3, 2], counterShift: 12,
    // Statement + sequence: the full motif, raised a third in bars 5–8.
    lead: 'cocs', leadRate: 1, leadSequence: 2, leadOctave: 1,
    leadType: 'triangle', leadGain: 0.024,
    strings: true, pad: true, swell: 0.5,
  },
  combat: {
    bpm: 96, steps: 16, gain: 0.55,
    kick: [0, 6, 8, 14], snare: [4, 12], hat: [2, 6, 10, 14],
    taiko: [0, 3, 8, 11], bell: null, timpani: [0, 8], choir: true, drone: true,
    stringsStaccato: true, brassMarcato: true, cymbals: true, timpaniRoll: true, trumpet: true,
    bass: [[0, 0, 2], [2, 0, 2], [4, 3, 2], [6, 2, 2], [8, 0, 2], [10, 0, 2], [12, 5, 2], [14, 4, 2]],
    brass: [[0, 0, 2], [4, 3, 2], [8, 0, 2], [12, 5, 2]],
    arp: [0, 2, 4, 6, 4, 2, 0, 2],
    counter: [4, 5, 4, 2, 0, 2, 4, 5], counterShift: 12,
    // Inversion: statement in bars 1–4, the mirrored line in bars 5–8.
    lead: 'cocs', leadRate: 1, leadSequence: 2, leadInvertSecondHalf: true, leadOctave: 1,
    leadFallback: [0, 2, 4, 3, 2, 4, 6, 4, 5, 4, 3, 2, 1, 2, 0, 0],
    leadType: 'square', leadGain: 0.024,
    strings: true, pad: false, swell: 0.85,
  },
  results: {
    bpm: 84, steps: 16, gain: 0.5,
    kick: [0, 8], snare: [], hat: [],
    taiko: [0, 8], bell: [8, 12], bellToll: true, bellFragment: true, gong: true, harp: true, timpani: [0, 8], timpaniRoll: true,
    cymbals: true, trumpet: true, brassMarcato: true, choir: true, drone: true,
    bass: [[0, 0, 6], [8, 4, 6]],
    brass: [[0, 0, 4], [8, 4, 4], [12, 0, 4]],
    arp: [0, 2, 4, 2, 3, 5, 4, 2],
    counter: [4, 2, 0, 2, 4, 5, 4, 2], counterShift: 12,
    // Picardy: the motif with every minor third raised, ending major. A baked
    // victory/defeat motif, when one is loaded, replaces the built-in line here.
    lead: 'cocs', leadMotif: true, leadRate: 1, leadMajor: true, leadOctave: 1,
    leadType: 'triangle', leadGain: 0.024,
    strings: true, pad: true, swell: 0.35,
  },
});

// Fill patterns replace the arpeggio (and add percussion accents / a crescendo
// roll) on the last bar of each four-bar half-phrase; the eighth bar of the
// eight-bar phrase is the big fill. `roll` scales the percussion crescendo.
const FILLS = frozen({
  menu: { arp: [7, 5, 4, 2], hat: [14, 15], roll: 0.25 },
  explore: { arp: [8, 7, 5, 3], hat: [14, 15], roll: 0.45 },
  combat: { arp: [8, 6, 4, 2], snare: [14, 15], roll: 0.7 },
  results: { arp: [5, 4, 2, 0], hat: [14, 15], roll: 0.3 },
});
const HALO_FILLS = frozen({
  menu: { arp: [5, 4, 2, 0], bell: [14], roll: 0.3 },
  explore: { arp: [5, 4, 2, 0], taiko: [14, 15], roll: 0.5 },
  combat: { arp: [8, 7, 6, 4], taiko: [13, 15], snare: [15], roll: 0.8 },
  results: { arp: [5, 4, 2, 0], bell: [14, 15], gong: [0], roll: 0.4 },
});
export const SOUNDTRACKS = frozen({
  default: { arrangements: ARRANGEMENTS, progressions: CHORD_PROGRESSIONS, qualities: null, fills: FILLS, theme: null },
  halo: { arrangements: HALO_ARRANGEMENTS, progressions: HALO_PROGRESSIONS, qualities: HALO_QUALITIES, fills: HALO_FILLS, theme: HALO_THEME },
});

export const MUSIC_SCENES = Object.freeze(['menu', 'explore', 'combat', 'results']);

// The 32-bar form shared by every scene. Development accumulates across scene
// changes instead of restarting at bar 1: intro (strings + drone), build (motif
// and low brass), climax (ostinato, marcato brass, rolls, cymbals), a four-bar
// transition (sequence) and a four-bar outro that resolves back into the loop.
export const FORM_BARS = Object.freeze({ intro: 8, build: 8, climax: 8, transition: 4, outro: 4 });

// Dynamic-layer entry points. Combat percussion, melodies and accents come in
// stages as the layer rises; on the way down the same thresholds gate them out
// after the eased release has had time to breathe.
const LAYER_THRESHOLDS = Object.freeze({ snare: 0.22, hat: 0.4, taiko: 0.32, bell: 0.45, counter: 0.28, lead: 0.42, choir: 0.12, ostinato: 0.25, marcato: 0.32, highBrass: 0.55, timpaniRoll: 0.6, cymbal: 0.5 });

export class MusicEngine {
  constructor({ ctx, destination, theme = null, noiseBuffer = null, seed = 1, maxVoices = 44, lookahead = 0.24, samples = true, sampleBaseUrl = MUSIC_BASE, sampleManifestUrl = null, sampleFetch = null, sampleBank = null } = {}) {
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
    // Sustained voices (pad/choir/drone/strings) get their own budget so a long
    // string bed can never starve the short melodic and percussive notes. Four
    // slots are always reserved for the transient layer.
    this.sustainBudget = Math.max(4, Math.min(12, this.maxVoices - 4));
    this.sustainVoices = 0;
    this.lookahead = clamp(Number(lookahead) || 0.24, 0.05, 0.5);
    this.step = 0;
    this.bar = 0;
    this.nextTime = null;
    this.voices = [];
    this.notesScheduled = 0;
    this.peakVoices = 0;
    // Tempo ramps over four bars when the scene (and therefore the target bpm)
    // changes, so a menu-to-combat hand-over accelerates instead of jumping.
    this.currentBpm = null;
    this._bpmScene = null;
    // A cheap rolling fingerprint of every scheduled (freq, gain) pair; used by
    // tests to prove seeded determinism without rendering audio. Sampled voices
    // fold their selected (midi, velocity, playbackRate) into the same stream.
    this.scheduleChecksum = 0;
    this.notesBy = { kick: 0, snare: 0, hat: 0, taiko: 0, bell: 0, bass: 0, arp: 0, counter: 0, lead: 0, pad: 0, choir: 0, drone: 0, swell: 0, riser: 0, roll: 0, impact: 0, brass: 0, timpani: 0, ostinato: 0, marcato: 0, trumpet: 0, cymbal: 0, toll: 0, gong: 0 };
    // Sampled-instrument bank: lazy, optional and inert without a decodable
    // context, so Node tests keep the deterministic oscillator path.
    this.samplesEnabled = samples !== false;
    this.sampleBaseUrl = sampleBaseUrl || MUSIC_BASE;
    this.sampleManifestUrl = sampleManifestUrl || `${this.sampleBaseUrl.replace(/\/+$/, '')}/manifest.json`;
    this.sampleFetch = sampleFetch;
    this._sampleBank = sampleBank || null;
    this._samplePreloadStarted = false;
    this.previewUntil = 0;
    this.previewScene = 'menu';
    // Soundtrack tables are swapped wholesale by setSoundtrack(); default keeps
    // the baseline arrangements. Reverb is opt-in via setReverb().
    this.arrangements = ARRANGEMENTS;
    this.progressions = CHORD_PROGRESSIONS;
    this.qualities = null;
    this.fills = FILLS;
    this.soundtrackName = 'default';
    this.outcome = null;
    this.motif = null;
    this.motifLead = null;
    this.reverbSend = null;
    this.reverbReturn = null;
    this.reverb = null;
    this.reverbPreDelay = null;
    this.reverbHpf = null;
    this.masterChain = null;
    // A chorus send (short modulated delay) sits alongside the convolution
    // reverb so sampled strings and the choir can widen without smearing.
    this.chorusSend = null;
    this.chorusReturn = null;
    // Dynamic layer state: `layers` eases between 0 and 1 per scene so the menu
    // hands over to exploration and combat instead of hard switching. The
    // transition record tracks the outro swell / entrance accent machine.
    this.layers = { menu: 1, explore: 0, combat: 0, results: 0 };
    this.transition = null;
    this.transitions = 0;
    this._lastActiveScene = 'menu';
    this._lastTime = null;
    // Gain buses. menu/explore/combat feed the music bus; the music bus feeds
    // the engine destination (which the host wires to its master gain).
    this.musicBus = null;
    this.buses = null;
    this._buildBuses(destination);
    // Start the lazy sample load once the graph exists. Inert in Node tests and
    // when the AudioContext cannot decode; never blocks construction.
    this.preloadSamples();
  }

  // Master output chain: the summed music bus passes through a gentle limiter
  // (−10 dB, 4:1) with +6 dB makeup and a hard −1 dBFS ceiling, so the denser
  // orchestral mix sits at a game-appropriate loudness without clipping. Nodes
  // are skipped entirely on minimal contexts that cannot build a compressor.
  _buildMasterChain(destination) {
    const ctx = this.ctx;
    const out = destination || ctx.destination;
    const set = (p, v) => { try { p.value = v; } catch {} };
    if (typeof ctx.createDynamicsCompressor !== 'function' || typeof ctx.createGain !== 'function') {
      this.musicBus.connect(out);
      return;
    }
    try {
      const limiter = ctx.createDynamicsCompressor();
      set(limiter.threshold, -10); set(limiter.knee, 6); set(limiter.ratio, 4);
      set(limiter.attack, 0.01); set(limiter.release, 0.25);
      const makeup = ctx.createGain();
      set(makeup.gain, Math.pow(10, 6 / 20));
      const ceiling = ctx.createDynamicsCompressor();
      set(ceiling.threshold, -1); set(ceiling.knee, 0); set(ceiling.ratio, 20);
      set(ceiling.attack, 0.001); set(ceiling.release, 0.05);
      this.musicBus.connect(limiter); limiter.connect(makeup); makeup.connect(ceiling);
      // A tanh soft-clip is the actual brickwall: a compressor alone still lets
      // transients past. The curve asymptotes at −1 dBFS (0.891 linear), so the
      // soundtrack can never clip the destination.
      if (typeof ctx.createWaveShaper === 'function') {
        const shaper = ctx.createWaveShaper();
        const ceil = Math.pow(10, -1 / 20);
        const n = 1024;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ceil * Math.tanh(x / ceil); }
        try { shaper.curve = curve; } catch {}
        try { shaper.oversample = '4x'; } catch {}
        ceiling.connect(shaper); shaper.connect(out);
        this.masterChain = { limiter, makeup, ceiling, shaper };
      } else {
        ceiling.connect(out);
        this.masterChain = { limiter, makeup, ceiling };
      }
    } catch {
      try { this.musicBus.connect(out); } catch {}
    }
  }

  _buildBuses(destination) {
    if (!this.ctx || typeof this.ctx.createGain !== 'function') return;
    try {
      const mk = (gain) => { const g = this.ctx.createGain(); g.gain.value = gain; g.connect(this.musicBus); return g; };
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.0001;
      this.masterChain = null;
      this._buildMasterChain(destination);
      this.buses = {
        menu: mk(0.0001),
        explore: mk(0.0001),
        combat: mk(0.0001),
        results: mk(0.0001),
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

  // Chorus send, built on first use: an 18 ms delay swept by a 0.35 Hz LFO.
  // Lazy so graphs that never ask for chorus (every Node mock, and the effect
  // bus tests) allocate no delay line. Returns null when unsupported.
  _ensureChorus() {
    if (this.chorusSend) return this.chorusSend;
    if (this._chorusUnavailable) return null;
    const ctx = this.ctx;
    if (!ctx || typeof ctx.createDelay !== 'function' || typeof ctx.createOscillator !== 'function') { this._chorusUnavailable = true; return null; }
    try {
      const send = ctx.createGain();
      send.gain.value = 1;
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = 0.018;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.35;
      const depth = ctx.createGain();
      depth.gain.value = 0.004;
      const wet = ctx.createGain();
      wet.gain.value = 0.6;
      lfo.connect(depth); depth.connect(delay.delayTime);
      send.connect(delay); delay.connect(wet); wet.connect(this.musicBus);
      this.chorusSend = send; this.chorusReturn = wet; this.chorusLfo = lfo;
      lfo.start();
      return send;
    } catch { this._chorusUnavailable = true; return null; }
  }

  // Lazily create the sample bank on first use. Inert unless the context can
  // decode and a fetch implementation is available, which keeps tests and
  // blocked-autoplay paths on the deterministic oscillator path.
  _ensureSampleBank() {
    if (this._sampleBank) return this._sampleBank;
    if (this.samplesEnabled === false) return null;
    const ctx = this.ctx;
    if (!ctx || typeof ctx.decodeAudioData !== 'function') return null;
    const fetchImpl = this.sampleFetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return null;
    this._sampleBank = new SampleBank({ ctx, baseUrl: this.sampleBaseUrl, fetchImpl });
    return this._sampleBank;
  }

  // Start fetching the manifest and decode the instruments the active pack can
  // actually voice. Called automatically after a soundtrack swap; safe when the
  // bank is inert. Decoding never blocks the scheduler.
  preloadSamples() {
    const bank = this._ensureSampleBank();
    if (!bank || !bank.manifest) {
      if (!bank) return null;
      return bank.loadManifest(this.sampleManifestUrl).then((ok) => { if (ok) this._preloadPackSamples(bank); return ok; });
    }
    this._preloadPackSamples(bank);
    return Promise.resolve(true);
  }

  _preloadPackSamples(bank) {
    if (this._samplePreloadStarted) return;
    this._samplePreloadStarted = true;
    for (const name of this._packSampleNeeds()) bank.preload(name);
  }

  // Which sampled instruments the current arrangements reference. `drone` and
  // `choir` both read the strings bed; `brass`/`taiko`/`bell` are explicit.
  _packSampleNeeds() {
    const needs = new Set();
    for (const arr of Object.values(this.arrangements || {})) {
      if (!arr) continue;
      if (arr.pad || arr.choir || arr.drone || arr.strings) needs.add('strings-pad');
      // No choir sample is baked (see the M1 sample audit), so the choir keeps
      // its formant-synth fallback and is deliberately not preloaded.
      if (arr.stringsStaccato) needs.add('low-strings-stacc');
      if (arr.brass) needs.add('low-brass');
      if (arr.brassMarcato) needs.add('brass-stacc');
      if (arr.trumpet) needs.add('trumpet-pad');
      if (arr.taiko) needs.add('taiko');
      if (arr.bell) needs.add('bells');
      if (arr.bellToll) needs.add('tubular-bells');
      if (arr.timpani) needs.add('timpani');
      if (arr.timpaniRoll) needs.add('timpani-roll');
      if (arr.cymbals) { needs.add('cymbal-swell'); needs.add('cymbal-crash'); }
      if (arr.gong) needs.add('gong');
      if (arr.harp) needs.add('harp');
    }
    return [...needs];
  }

  // True when the bank has decoded the requested instrument. Triggers a lazy
  // per-instrument preload (and the manifest fetch) the first time it is asked,
  // without consuming RNG or scheduling a voice.
  _sampleReady(instrument) {
    const bank = this._ensureSampleBank();
    if (!bank) return false;
    if (!bank.manifest) { bank.loadManifest(this.sampleManifestUrl); return false; }
    if (bank.isReady(instrument)) return true;
    if (!bank.isPending(instrument)) bank.preload(instrument);
    return false;
  }

  sampleStatus() {
    const bank = this._sampleBank;
    return {
      enabled: this.samplesEnabled !== false,
      baseUrl: this.sampleBaseUrl,
      ...(bank ? bank.status() : { manifest: false, ready: 0, loading: 0, failed: 0, loaded: 0, total: 0, instruments: {} }),
    };
  }

  // Shared routing tail for every voice: dry -> panner -> bus, plus optional
  // reverb and chorus sends. Keeps pan/reverb/chorus wiring in one place so the
  // sampled and oscillator voices stay interchangeable.
  _route(g, bus, pan, reverb, chorus, extra) {
    const ctx = this.ctx;
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p); p.connect(bus);
      extra.push(p);
    } else {
      g.connect(bus);
    }
    if (reverb > 0 && this.reverbSend) {
      const send = ctx.createGain();
      send.gain.value = clamp(reverb, 0, 1);
      g.connect(send); send.connect(this.reverbSend);
      extra.push(send);
    }
    if (chorus > 0) {
      const bus = this._ensureChorus();
      if (bus) {
        const send = ctx.createGain();
        send.gain.value = clamp(chorus, 0, 1);
        g.connect(send); send.connect(bus);
        extra.push(send);
      }
    }
  }

  // Voice admission. The total cap is shared, but sustained voices also draw on
  // a smaller separate budget so a whole-bar string bed can never consume every
  // slot and starve the transient/melodic layers.
  _canVoice(sustain = false) {
    if (this.voices.length >= this.maxVoices) return false;
    if (sustain && this.sustainVoices >= this.sustainBudget) return false;
    return true;
  }

  _commitVoice(rec, sustain = false) {
    this.voices.push(rec);
    if (sustain) { rec.sustain = true; this.sustainVoices++; }
    this.notesScheduled++;
    if (this.voices.length > this.peakVoices) this.peakVoices = this.voices.length;
  }

  // Velocity layer for a sampled voice: an explicit 1/2 hint wins, otherwise a
  // seeded coin flip chooses the soft or strong layer (both are baked and
  // normalised, so either is a valid performance).
  _sampledLayer(opts, pick) {
    const explicit = Number(opts?.velocity ?? opts?.layer);
    if (explicit === 1 || explicit === 2) return explicit;
    return pick < 0.5 ? 2 : 1;
  }

  // Sampled voice with the SAME contract as _scheduleNote: (time, bus, freq, dur,
  // gain, reverb, pan), plus an optional instrument/selection bag. Returns false
  // when the bank is not decoded yet so the caller can fall back to the synth
  // voice. Selection is seeded from the engine RNG and folded into the checksum.
  _scheduleSampled(time, bus, instrument, freq, dur, gain, reverb = 0, pan = 0, opts = null) {
    if (!this.ctx || !bus) return false;
    if (!this._canVoice(!!opts?.sustain)) return false;
    if (!this._sampleReady(instrument)) return false;
    const bank = this._sampleBank;
    const pick = this.rng();
    const layer = this._sampledLayer(opts, pick);
    const note = Math.max(20, Number(freq) || 440);
    const midi = 69 + 12 * Math.log2(note / 440);
    const entry = selectSample(bank.manifest, instrument, midi, layer, pick);
    const buffer = entry && bank.bufferFor(entry);
    if (!entry || !buffer) return false;
    try {
      const ctx = this.ctx;
      const rate = sampleRateFor(note, entry.midi);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      try { src.playbackRate.setValueAtTime(rate, time); } catch { try { src.playbackRate.value = rate; } catch {} }
      const loop = loopWindow(entry);
      const srcDur = Math.max(0.02, Number(buffer.duration) || 0);
      const endTime = loop ? time + Math.max(0.06, dur) : time + Math.max(srcDur / Math.max(0.25, rate), 0.05);
      if (loop) {
        src.loop = true;
        src.loopStart = loop.loopStart;
        src.loopEnd = loop.loopEnd;
      }
      const g = ctx.createGain();
      const peak = Math.max(0.0002, gain * (Number(entry.gain) || 1) * (opts?.trim ? opts.trim : 1));
      const span = Math.max(0.01, endTime - time);
      const attack = Math.min(Math.max(0.001, Number(opts?.attack) || (loop ? 0.03 : 0.0015)), span * 0.5);
      const release = Math.min(loop ? 0.06 : 0.04, span * 0.5);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + attack);
      g.gain.setValueAtTime(peak, Math.max(time + attack, endTime - release));
      g.gain.exponentialRampToValueAtTime(0.0001, endTime);
      const extra = [];
      src.connect(g);
      this._route(g, bus, pan, reverb, opts?.chorus || 0, extra);
      src.start(time, 0);
      src.stop(endTime + 0.03);
      const rec = { o: src, g, extra, end: endTime + 0.05 };
      try { src.onended = () => { try { src.disconnect(); } catch {} try { g.disconnect(); } catch {} for (const n of extra) { try { n.disconnect(); } catch {} } }; } catch {}
      this._commitVoice(rec, !!opts?.sustain);
      // The chosen round-robin entry is part of the take, so its id is folded in
      // alongside the note, velocity layer and playback rate.
      let idHash = 0;
      for (let i = 0; i < entry.id.length; i++) idHash = (Math.imul(idHash, 31) + entry.id.charCodeAt(i)) | 0;
      this.scheduleChecksum = (Math.imul(this.scheduleChecksum, 31) + ((((entry.midi & 0xff) << 12) ^ ((entry.velocity & 0x3) << 10) ^ (Math.round(Math.max(20, freq)) & 0x3ff) ^ (Math.round(rate * 512) & 0x1ff) ^ (idHash & 0xfff)) | 0)) | 0;
      return true;
    } catch { return false; }
  }

  setTheme(theme) {
    if (theme && Array.isArray(theme.scale) && Number.isFinite(theme.root)) this.theme = { root: theme.root, scale: theme.scale };
    return this.theme;
  }
  // Swap the whole arrangement/progression/fill pack. Unknown names fall back to
  // the baseline tables, and a pack's own theme (if any) is applied. The
  // transport is deliberately NOT reset here: scene and pack changes crossfade
  // layers and keep the phrase position, so the 32-bar form accumulates across
  // menu -> explore -> combat -> results instead of restarting at bar 1.
  setSoundtrack(name = 'default') {
    const key = SOUNDTRACKS[name] ? name : 'default';
    const pack = SOUNDTRACKS[key];
    this.soundtrackName = key;
    this.arrangements = pack.arrangements;
    this.progressions = pack.progressions;
    this.qualities = pack.qualities || null;
    this.fills = pack.fills || FILLS;
    if (pack.theme) this.setTheme(pack.theme);
    if (this.motif) this.setMotif(this.motif);
    this._samplePreloadStarted = false;
    this.preloadSamples();
    return key;
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
  // The developed leitmotif for a bar. `lead: 'cocs'` always reads the built-in
  // recurring motif; `lead: 'motif'` reads an externally baked motif with the
  // arrangement's fallback. Development is diatonic and per-bar so the phrase
  // accumulates: a sequence up N degrees in the second half of every section,
  // optional inversion there, and (handled when scheduling) a Picardy raise.
  _leadFor(arr, bar = this.bar) {
    let lead = null;
    if (Array.isArray(arr.lead)) lead = arr.lead;
    // `leadMotif` lets a scene that normally voices the built-in leitmotif defer
    // to an externally baked motif (e.g. the Moth victory/defeat takes) while
    // keeping `COCS_MOTIF` as the static fallback when none is loaded.
    else if (arr.lead === 'cocs') lead = arr.leadMotif && this.motifLead?.length ? this.motifLead : COCS_MOTIF;
    else if (arr.lead === 'motif') lead = this.motifLead?.length ? this.motifLead : (Array.isArray(arr.leadFallback) ? arr.leadFallback : null);
    if (!lead?.length) return null;
    const secondHalf = (((bar % 8) + 8) % 8) >= 4;
    const transpose = secondHalf ? (Number(arr.leadSequence) || 0) : 0;
    const invert = arr.leadInvert === true || (arr.leadInvertSecondHalf === true && secondHalf);
    if (!transpose && !invert) return lead;
    return lead.map((d) => {
      let n = d;
      if (transpose) n += transpose;
      if (invert) n = -n;
      return n;
    });
  }
  // Note position inside the lead line. Indexing by absolute quarter count
  // (rather than by step inside one bar) lets a sixteen-note theme or a baked
  // motif develop across four bars. `leadRate` is the note length in quarters:
  // 2 = augmentation (menu), 1 = quarters, 0.5 = diminution (eighth ostinato).
  _leadIndex(arr, step) {
    const lead = this._leadFor(arr);
    if (!lead?.length) return 0;
    const perBar = Math.max(1, Math.round((arr.steps || 16) / 4));
    const quarters = this.bar * perBar + Math.floor(step / 4);
    const rate = Math.max(0.25, Number(arr.leadRate) || 1);
    const slot = Math.floor(quarters / rate);
    return ((slot % lead.length) + lead.length) % lead.length;
  }
  // Scale degree of an explicit chord tone. Tone 0 root, 1 third, 2 fifth,
  // 3 octave. With a quality table the interval is fixed in semitones so a
  // borrowed major V or a Picardy I is exact; without one the legacy modal
  // degree stack is used and the baseline pack is unchanged.
  _chordTone(scale, chord, quality, tone, octave = 0) {
    const base = degree(scale, chord);
    const intervals = quality ? CHORD_TONES[quality] : null;
    const semi = intervals ? base + intervals[tone] : degree(scale, chord + [0, 2, 4, 7][tone]);
    return semi + 12 * octave;
  }
  // Final scale-relative semitone for a developed lead note: the diatonic degree
  // plus, for the Picardy (major) development, a raised minor third (F -> F#).
  // Exposed so arrangement tests can assert the transformation without audio.
  _leadTone(arr, note, chord) {
    const semi = degree(this.theme.scale, note + chord);
    const mod = ((semi % 12) + 12) % 12;
    return arr.leadMajor && mod === 3 ? semi + 1 : semi;
  }
  // Route a convolution impulse response onto the reverb return. Safe to call
  // without a convolver (returns false) and safe to call before audio unlock.
  // Wet path: a 30 ms pre-delay and a 250 Hz high-pass keep the pitch-shifted
  // lows out of the tail before the convolver, then the return blends at `wet`.
  setReverb(buffer, { wet = 0.3 } = {}) {
    if (!this.ctx || !this.reverbSend || typeof this.ctx.createConvolver !== 'function') return false;
    try {
      const ctx = this.ctx;
      let tail = this.reverbSend;
      if (typeof ctx.createDelay === 'function') {
        const preDelay = this.reverbPreDelay || ctx.createDelay(0.2);
        preDelay.delayTime.value = 0.03;
        this.reverbPreDelay = preDelay;
        tail.connect(preDelay); tail = preDelay;
      }
      if (typeof ctx.createBiquadFilter === 'function') {
        const hpf = this.reverbHpf || ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 250;
        try { hpf.Q.value = 0.7; } catch {}
        this.reverbHpf = hpf;
        tail.connect(hpf); tail = hpf;
      }
      const convolver = ctx.createConvolver();
      if (buffer) convolver.buffer = buffer;
      try { convolver.normalize = true; } catch {}
      tail.connect(convolver);
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
  // Scene selection keeps the transport running (see setSoundtrack); the
  // layer crossfade and transition machine handle the musical hand-over.
  setScene(scene) {
    this.scene = MUSIC_SCENES.includes(scene) ? scene : 'menu';
    return this.scene;
  }
  // Victory/defeat selects the results arrangement through the same layer
  // crossfade; the arrangement already voices the Picardy (victory) motif.
  setOutcome(outcome) {
    this.outcome = outcome === 'victory' || outcome === 'defeat' ? outcome : null;
    if (this.outcome) this.setScene('results');
    return this.outcome;
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
    if (this.scene === 'menu' || this.scene === 'results') return this.scene;
    return this.intensity >= 0.34 ? 'combat' : 'explore';
  }
  _time() { return this.ctx ? Number(this.ctx.currentTime) || 0 : 0; }
  _bpm(scene) {
    const target = (this.arrangements[scene] || this.arrangements.menu).bpm;
    if (this.currentBpm == null || scene !== this._activeScene()) return target;
    return this.currentBpm;
  }
  _stepDur(scene) { return 60 / (this._bpm(scene) * 4); }
  // Ease the tempo toward the active scene's target over roughly four bars. A
  // scene change therefore accelerates/decelerates instead of jumping.
  _approachTempo(dt) {
    const scene = this._activeScene();
    const target = (this.arrangements[scene] || this.arrangements.menu).bpm;
    if (this.currentBpm == null) this.currentBpm = target;
    if (this._bpmScene !== scene) { this._bpmScene = scene; }
    if (dt > 0 && this.currentBpm !== target) {
      const tau = 4 * (60 / Math.max(30, target));
      this.currentBpm += (target - this.currentBpm) * (1 - Math.exp(-dt / tau));
      if (Math.abs(target - this.currentBpm) < 0.05) this.currentBpm = target;
    }
    return this.currentBpm;
  }
  // Position in the shared 32-bar form: intro 8 / build 8 / climax 8 /
  // transition 4 / outro 4. Used for fills and the extra orchestral colours.
  _formSection() {
    const b = ((this.bar % 32) + 32) % 32;
    if (b < FORM_BARS.intro) return 'intro';
    if (b < FORM_BARS.intro + FORM_BARS.build) return 'build';
    if (b < FORM_BARS.intro + FORM_BARS.build + FORM_BARS.climax) return 'climax';
    if (b < FORM_BARS.intro + FORM_BARS.build + FORM_BARS.climax + FORM_BARS.transition) return 'transition';
    return 'outro';
  }
  // A gentle loudness curve over the 32-bar form: the intro is held back, the
  // climax peaks and the outro eases. This is what gives the piece a real
  // dynamic range (and a build) without adding or removing instruments.
  _formLevel() {
    switch (this._formSection()) {
      case 'intro': return 0.62;
      case 'build': return 0.82;
      case 'climax': return 1;
      case 'transition': return 0.9;
      default: return 0.66;
    }
  }

  _vel() { return 0.93 + this.rng() * 0.14; }

  // Ease each scene layer toward its target. Rising layers move quickly enough
  // to feel responsive (combat enters over ~0.45 s); falling layers take much
  // longer, so a fight ends with a tail rather than a cut.
  _approachLayers(dt) {
    const scene = this._activeScene();
    const targets = { menu: scene === 'menu' ? 1 : 0, explore: scene === 'explore' ? 1 : 0, combat: scene === 'combat' ? 1 : 0, results: scene === 'results' ? 1 : 0 };
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
    this._approachTempo(dt);
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
    const target = { menu: 0.0001, explore: 0.0001, combat: 0.0001, results: 0.0001 };
    const form = this._formLevel();
    if (on) {
      const menuGain = this.arrangements.menu.gain || 0.5;
      const exploreGain = this.arrangements.explore.gain || 0.42;
      const combatGain = this.arrangements.combat.gain || 0.55;
      const resultsGain = this.arrangements.results?.gain || 0.5;
      if (scene === 'menu') {
        target.menu = menuGain * (0.6 + 0.4 * this.layers.menu) * form;
      } else if (scene === 'results') {
        target.results = resultsGain * (0.6 + 0.4 * this.layers.results) * form;
      } else {
        const combatMix = scene === 'combat' ? clamp((this.intensity - 0.34) / 0.3, 0, 1) : 0;
        const exploreFloor = scene === 'combat' ? 1 - combatMix * 0.7 : 1;
        target.explore = exploreGain * exploreFloor * (0.5 + 0.5 * this.layers.explore) * form;
        if (scene === 'combat') target.combat = combatGain * (0.55 + 0.45 * this.layers.combat) * (0.6 + combatMix * 0.4) * form;
      }
    }
    const duck = 1 - this.duck * 0.62;
    const driveHold = scene === 'combat' ? this.layers.combat : scene === 'explore' ? this.layers.explore : scene === 'results' ? this.layers.results : this.layers.menu;
    for (const [key, bus] of Object.entries(this.buses)) {
      if (key === 'drums') { try { bus.gain.setTargetAtTime(on ? 0.36 * duck * (0.7 + 0.3 * driveHold) * form : 0.0001, t, 0.14); } catch {} continue; }
      try { bus.gain.setTargetAtTime((target[key] || 0.0001) * duck, t, 0.25); } catch {}
    }
    try { this.musicBus.gain.setTargetAtTime(on ? 1.5 : 0.0001, t, 0.3); } catch {}
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

  // Oscillator voice. `opts` optionally turns it into a detuned unison stack
  // (count/detune), inserts a velocity-scaled lowpass (filter/filterEnd/q) and
  // adds a chorus send — all guarded so minimal test contexts ignore them. The
  // positional contract and the single-oscillator checksum are unchanged.
  _scheduleNote(time, bus, freq, dur, type, gain, end = 0, attack = 0.008, reverb = 0, pan = 0, opts = null) {
    if (!this.ctx || !bus) return false;
    if (!this._canVoice(!!opts?.sustain)) return false;
    try {
      const ctx = this.ctx;
      const g = ctx.createGain();
      const extra = [];
      let dest = g;
      if (opts && opts.filter && typeof ctx.createBiquadFilter === 'function') {
        const f = ctx.createBiquadFilter();
        f.type = opts.filterType || 'lowpass';
        f.frequency.setValueAtTime(Math.max(30, Number(opts.filter) || 800), time);
        if (opts.filterEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, Number(opts.filterEnd)), time + dur);
        if (opts.q != null) { try { f.Q.setValueAtTime(Number(opts.q) || 0.7, time); } catch {} }
        f.connect(g);
        dest = f;
        extra.push(f);
      }
      const count = opts && Number(opts.count) > 1 ? Math.min(4, Math.round(Number(opts.count))) : 1;
      const detune = opts ? Number(opts.detune) || 0 : 0;
      const oscs = [];
      for (let i = 0; i < count; i++) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(Math.max(20, freq), time);
        if (end) o.frequency.exponentialRampToValueAtTime(Math.max(20, end), time + dur);
        if (detune) { try { o.detune.setValueAtTime((i - (count - 1) / 2) * detune, time); } catch {} }
        o.connect(dest);
        o.start(time); o.stop(time + dur + 0.04);
        oscs.push(o);
      }
      // A sub oscillator rides inside the SAME voice slot (used by the bass so
      // its sine sub no longer spends a second voice).
      if (opts && opts.sub) {
        const subG = ctx.createGain();
        subG.gain.value = Number(opts.subGain) || 0.5;
        const so = ctx.createOscillator();
        so.type = opts.subType || 'sine';
        const subFreq = Math.max(20, freq * (Number(opts.sub) || 0.5));
        so.frequency.setValueAtTime(subFreq, time);
        so.connect(subG); subG.connect(dest);
        so.start(time); so.stop(time + dur + 0.04);
        oscs.push(so); extra.push(subG);
      }
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), time + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      this._route(g, bus, pan, reverb, opts ? Number(opts.chorus) || 0 : 0, extra);
      const rec = { o: oscs[0], oscs, g, extra, end: time + dur + 0.05 };
      const cleanup = () => { for (const o of oscs) { try { o.disconnect(); } catch {} } try { g.disconnect(); } catch {} for (const n of extra) { try { n.disconnect(); } catch {} } };
      try { oscs[oscs.length - 1].onended = cleanup; } catch {}
      this._commitVoice(rec, !!opts?.sustain);
      // Unison stacks keep the single-oscillator checksum so existing seeded
      // takes are unchanged when the stack collapses to one voice.
      this.scheduleChecksum = (Math.imul(this.scheduleChecksum, 31) + ((Math.round(Math.max(20, freq)) ^ Math.round(gain * 4096)) | 0)) | 0;
      return true;
    } catch { return false; }
  }

  // Filtered noise voice: used for risers, impacts and swells. Returns false
  // when the context or buffer is unavailable, so callers can fall back to a
  // tonal swell and tests stay meaningful with a minimal mock.
  _scheduleNoise(time, bus, { dur = 0.3, gain = 0.08, type = 'bandpass', freq = 500, q = 0.8, sweep = 0, attack = 0.01, pan = 0, reverb = 0 } = {}) {
    if (!this.ctx || !bus || !this._canVoice(false)) return false;
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
      this._commitVoice(rec, false);
      this.scheduleChecksum = (Math.imul(this.scheduleChecksum, 31) + ((Math.round(freq) ^ Math.round(gain * 4096)) | 0)) | 0;
      return true;
    } catch { return false; }
  }

  _kick(time, bus, gain = 0.42, opts = null) {
    // Tribal arrangements layer a sampled bass drum under the synth kick.
    if (opts?.sampled && this._scheduleSampled(time, bus, 'taiko', 70, 0.24, gain, 0.14, opts.pan || 0, { velocity: opts.strong ? 2 : 1 })) { this.notesBy.kick++; return; }
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
  // Tribal/taiko drum. Sampled frame/bass drums when decoded; otherwise the
  // original pitched body plus a short noisy frame crack. `freq` lets callers
  // keep the drum in the arrangement's register.
  _taiko(time, bus, gain = 0.5, opts = null) {
    const strong = opts?.strong ?? gain >= 0.4;
    if (this._scheduleSampled(time, bus, 'taiko', opts?.freq ?? 150, 0.32, gain, 0.22, opts?.pan ?? -0.08, { velocity: strong ? 2 : 1 })) { this.notesBy.taiko++; return; }
    let ok = this._scheduleNote(time, bus, 150, 0.3, 'sine', gain * this._vel(), 48, 0.002, 0.2, -0.08);
    ok = this._scheduleNote(time, bus, 82, 0.34, 'sine', gain * 0.6, 40, 0.002, 0.2, 0.08) || ok;
    ok = this._scheduleNote(time, bus, 1700, 0.045, 'triangle', gain * 0.16, 950, 0.001, 0.2, 0) || ok;
    if (ok) this.notesBy.taiko++;
  }
  // Tuned timpani hit for downbeats, entrance accents and cadences. Sampled
  // where available; falls back to a low sine body.
  _timpani(time, bus, freq, gain = 0.4, opts = null) {
    if (this._scheduleSampled(time, bus, 'timpani', freq, 0.8, gain, 0.3, opts?.pan || 0, { velocity: (opts?.strong ?? gain >= 0.4) ? 2 : 1 })) { this.notesBy.timpani++; return true; }
    if (this._scheduleNote(time, bus, freq, 0.7, 'sine', gain, freq * 0.98, 0.004, 0.3, opts?.pan || 0)) { this.notesBy.timpani++; return true; }
    return false;
  }
  // Glassy bell. Sampled glockenspiel where available; otherwise a fundamental
  // plus three inharmonic partials with progressively shorter decays, which
  // reads far closer to struck metal than the old two-sine stack.
  _bell(time, bus, gain = 0.06, freq = 1320) {
    if (this._scheduleSampled(time, bus, 'bells', freq, 1.6, gain, 0.55, -0.25, { velocity: gain >= 0.05 ? 2 : 1, chorus: 0.18 })) { this.notesBy.bell++; return true; }
    let ok = this._scheduleNote(time, bus, freq, 1.5, 'sine', gain * this._vel(), freq * 0.999, 0.005, 0.6, -0.3);
    for (const [ratio, level, life] of [[2.76, 0.42, 0.9], [5.4, 0.22, 0.5], [8.93, 0.1, 0.3]]) {
      ok = this._scheduleNote(time, bus, freq * ratio, life, 'sine', gain * level * this._vel(), freq * ratio, 0.004, 0.6, 0.3) || ok;
    }
    if (ok) this.notesBy.bell++;
    return ok;
  }
  // Bass: a detuned saw body through a velocity-brightened lowpass plus a sine
  // sub, so the low end stays defined under the pads. The sub rides inside the
  // same voice slot as the body, so one note spends exactly one voice.
  _bass(time, bus, freq, dur, gain) {
    const cut = 300 + 620 * Math.min(1, gain * 14);
    const ok = this._scheduleNote(time, bus, freq, dur, 'sawtooth', gain, freq * 0.985, 0.006, 0, 0, { count: 2, detune: 6, filter: cut, filterEnd: cut * 0.5, q: 0.8, chorus: 0.06, sub: 0.5, subGain: 0.5, subType: 'sine' });
    if (ok) this.notesBy.bass++;
  }
  // Strings bed: the sampled section sustains when the bank is warm, otherwise
  // a detuned, velocity-brightened saw stack stands in so the orchestral beds
  // still work before (or without) any decode.
  _strings(time, bus, freq, dur, gain, pan = 0, opts = null) {
    if (this._scheduleSampled(time, bus, 'strings-pad', freq, dur, gain, 0.22, pan, { velocity: opts?.velocity, chorus: 0.35, attack: 0.07, sustain: true })) return true;
    const cut = 480 + 1500 * Math.min(1, gain * 16);
    return this._scheduleNote(time, bus, freq, dur, 'sawtooth', gain * 0.8, 0, 0.35, 0.22, pan, { count: 2, detune: 9, filter: cut, filterEnd: cut * 0.7, q: 0.6, chorus: 0.3, sustain: true });
  }
  // Low-string staccato ostinato (combat): M1 `low-strings-stacc` (spiccato)
  // when baked, else a short bowed `strings-pad` slice, else a synth stab.
  _stringsOstinato(time, bus, freq, dur, gain, pan = 0) {
    if (this._scheduleSampled(time, bus, 'low-strings-stacc', freq, dur, gain, 0.2, pan, { velocity: 2, attack: 0.006 })) { this.notesBy.ostinato++; return true; }
    if (this._scheduleSampled(time, bus, 'strings-pad', freq, dur, gain * 0.8, 0.2, pan, { velocity: 2, attack: 0.01 })) { this.notesBy.ostinato++; return true; }
    const cut = 700 + 1800 * Math.min(1, gain * 16);
    if (this._scheduleNote(time, bus, freq, dur, 'sawtooth', gain, 0, 0.006, 0.2, pan, { count: 2, detune: 7, filter: cut, filterEnd: cut * 0.6, q: 1.1, chorus: 0.12 })) { this.notesBy.ostinato++; return true; }
    return false;
  }
  // Low brass: sampled F Horn / Trombone / Tuba sustains for the low melodic
  // and tension lines, with a dark saw fallback.
  _brass(time, bus, freq, dur, gain, pan = 0, opts = null) {
    if (this._scheduleSampled(time, bus, 'low-brass', freq, dur, gain, 0.18, pan, { velocity: opts?.velocity, chorus: 0.15, attack: 0.06, sustain: opts?.sustain === true })) { this.notesBy.brass++; return true; }
    const cut = 320 + 820 * Math.min(1, gain * 18);
    const ok = this._scheduleNote(time, bus, freq, dur, 'sawtooth', gain, 0, 0.07, 0.18, pan, { count: 2, detune: 7, filter: cut, filterEnd: cut * 0.8, q: 0.9, sustain: opts?.sustain === true });
    if (ok) this.notesBy.brass++;
    return ok;
  }
  // Brass marcato (combat): short, accented stabs. M1 `brass-stacc` first,
  // then a short low-brass slice, then a filtered saw stab.
  _brassMarcato(time, bus, freq, dur, gain, pan = 0) {
    if (this._scheduleSampled(time, bus, 'brass-stacc', freq, dur, gain, 0.16, pan, { velocity: 2, attack: 0.004 })) { this.notesBy.marcato++; return true; }
    if (this._scheduleSampled(time, bus, 'low-brass', freq, dur, gain * 0.9, 0.16, pan, { velocity: 2, attack: 0.005 })) { this.notesBy.marcato++; return true; }
    const cut = 900 + 2200 * Math.min(1, gain * 16);
    if (this._scheduleNote(time, bus, freq, dur, 'square', gain, 0, 0.005, 0.16, pan, { count: 2, detune: 5, filter: cut, filterEnd: cut * 0.5, q: 1.2 })) { this.notesBy.marcato++; return true; }
    return false;
  }
  // High brass fanfare (results/climax): M1 `trumpet-pad` when baked, else a
  // brighter saw stab.
  _trumpet(time, bus, freq, dur, gain, pan = 0) {
    if (this._scheduleSampled(time, bus, 'trumpet-pad', freq, dur, gain, 0.25, pan, { velocity: 2, attack: 0.03, sustain: true })) { this.notesBy.trumpet++; return true; }
    if (this._scheduleNote(time, bus, freq, dur, 'sawtooth', gain, 0, 0.04, 0.25, pan, { count: 2, detune: 4, filter: 1200 + 2400 * Math.min(1, gain * 12), filterEnd: 2400, q: 1.0, chorus: 0.1, sustain: true })) { this.notesBy.trumpet++; return true; }
    return false;
  }
  // Cymbal swell/crash: `cymbals` when baked, else filtered noise.
  _cymbal(time, bus, dur = 1.2, gain = 0.1, pan = 0, kind = 'swell') {
    const id = kind === 'crash' ? 'cymbal-crash' : 'cymbal-swell';
    if (this._scheduleSampled(time, bus, id, 1200, dur, gain, 0.4, pan, { velocity: 2 })) { this.notesBy.cymbal++; return true; }
    if (this._scheduleNoise(time, bus, { dur, gain, type: 'highpass', freq: 4200, q: 0.6, sweep: 9000, attack: dur * 0.7, pan, reverb: 0.4 })) { this.notesBy.cymbal++; return true; }
    return false;
  }
  // Timpani roll: `timpani-roll` when baked, else a low noise roll plus a hit.
  _timpaniRoll(time, bus, freq, dur, gain, pan = 0) {
    if (this._scheduleSampled(time, bus, 'timpani-roll', freq, dur, gain, 0.3, pan, { velocity: 2 })) { this.notesBy.roll++; return true; }
    let ok = this._scheduleNoise(time, bus, { dur, gain: gain * 0.5, type: 'lowpass', freq: 260, q: 0.7, sweep: 120, attack: dur * 0.8, pan, reverb: 0.3 });
    ok = this._timpani(time, bus, freq, gain, { strong: true, pan }) || ok;
    if (ok) this.notesBy.roll++;
    return ok;
  }
  // Deep bell toll: M1 `tubular-bells` when baked, else the glockenspiel a
  // register down. The menu/results use it for the sacred accents.
  _bellToll(time, bus, freq, gain = 0.1, pan = -0.2) {
    if (this._scheduleSampled(time, bus, 'tubular-bells', freq, 2.4, gain, 0.55, pan, { velocity: 2, chorus: 0.15 })) { this.notesBy.toll++; return true; }
    if (this._bell(time, bus, gain, freq)) { this.notesBy.toll++; return true; }
    return false;
  }
  // Sparse harp colour (menu/results): M1 `harp` plucks when baked, else a soft
  // triangle pluck. One voice per note; used only on odd bars so it stays a
  // colour, not a part.
  _harp(time, bus, freq, dur, gain, pan = 0) {
    if (this._scheduleSampled(time, bus, 'harp', freq, dur, gain, 0.3, pan, { velocity: 2 })) { this.notesBy.arp++; return true; }
    if (this._scheduleNote(time, bus, freq, dur, 'triangle', gain, 0, 0.004, 0.3, pan, { count: 2, detune: 3, filter: 2400, filterEnd: 1200, q: 1.0, chorus: 0.06 })) { this.notesBy.arp++; return true; }
    return false;
  }
  // Tam-tam/gong swell: `gong` when baked, else a dark metallic noise bloom.
  _gong(time, bus, dur = 2.0, gain = 0.08, pan = 0) {
    if (this._scheduleSampled(time, bus, 'gong', 200, dur, gain, 0.5, pan, { velocity: 2 })) { this.notesBy.gong++; return true; }
    if (this._scheduleNoise(time, bus, { dur, gain, type: 'bandpass', freq: 320, q: 0.5, sweep: 120, attack: 0.05, pan, reverb: 0.5 })) { this.notesBy.gong++; return true; }
    return false;
  }
  // Choir: sampled "ahh/ooh" sustains once the M1 bank is warm; otherwise
  // two-to-four chord tones doubled with detuned saws and shaped by a three-peak
  // formant bank (620/1180/2600 Hz). One voice slot, on the sustained budget.
  _choir(time, bus, root, scale, chord, dur, quality = null) {
    const sampleFreq = noteFreq(root * 2, scale, chord);
    // Choir pairs seat off-centre (up to ±0.5) so the wordless ensemble widens
    // instead of sitting in a mono lump behind the lead.
    const choirPan = clamp(((chord % 4) - 1.5) * 0.22, -0.5, 0.5);
    if (this._scheduleSampled(time, bus, 'choir', sampleFreq, dur, 0.07, 0.3, choirPan, { velocity: 1, chorus: 0.3, attack: 0.2, sustain: true })) { this.notesBy.choir++; return true; }
    const available = Math.min(this.maxVoices - this.voices.length, this.sustainBudget - this.sustainVoices);
    if (available < 4) return false;
    try {
      const ctx = this.ctx;
      const pairs = available >= 10 ? 4 : 2;
      const hasFilter = typeof ctx.createBiquadFilter === 'function';
      const g = ctx.createGain();
      const extra = [];
      const oscs = [];
      let dest = g;
      if (hasFilter) {
        const sum = ctx.createGain();
        for (const [freq, q] of [[620, 6], [1180, 9], [2600, 12]]) {
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.setValueAtTime(freq, time);
          try { f.Q.setValueAtTime(q, time); } catch {}
          sum.connect(f); f.connect(g);
          extra.push(f);
        }
        const body = ctx.createGain();
        body.gain.value = 0.5;
        sum.connect(body); body.connect(g);
        extra.push(sum, body);
        dest = sum;
      }
      for (let i = 0; i < pairs; i++) {
        const semi = this._chordTone(scale, chord, quality, i % 4, Math.floor(i / 4));
        const f = root * 2 * Math.pow(2, semi / 12);
        for (const det of [-2.8, 3.2]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(Math.max(20, f * (1 + det / 1000)), time);
          o.connect(dest);
          o.start(time); o.stop(time + dur + 0.05);
          oscs.push(o);
        }
      }
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.02 * this._vel(), time + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      this._route(g, bus, choirPan, 0.5, 0.3, extra);
      const rec = { o: oscs[0], oscs, g, extra, end: time + dur + 0.05 };
      const cleanup = () => { for (const o of oscs) { try { o.disconnect(); } catch {} } try { g.disconnect(); } catch {} for (const n of extra) { try { n.disconnect(); } catch {} } };
      try { oscs[oscs.length - 1].onended = cleanup; } catch {}
      this._commitVoice(rec, true);
      this.notesBy.choir++;
      return true;
    } catch { return false; }
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
    // A tuned timpani hit marks the moment, with the old sub boom kept as a
    // fallback/body so the downbeat reads even before samples decode.
    const timpFreq = noteFreq(root, scale, chord);
    this._timpani(time, drumBus, timpFreq, transition.to === 'combat' ? 0.5 : 0.34, { strong: true });
    if (transition.to === 'combat') {
      this._kick(time, drumBus, 0.62, { sampled: true, strong: true });
      if (this._scheduleNote(time, drumBus, 58, 0.9, 'sine', 0.22, 26, 0.004, 0.1, 0)) this.notesBy.impact++;
      if (this._scheduleNoise(time, drumBus, { dur: 0.5, gain: 0.1, type: 'lowpass', freq: 900, q: 0.7, sweep: 70, attack: 0.004 })) this.notesBy.riser++;
      if (this._scheduleNote(time, bus, noteFreq(root, scale, chord + 7), 1.2, 'sine', 0.05, 0, 0.01, 0.5, 0.2)) this.notesBy.impact++;
    } else {
      this._taiko(time, drumBus, transition.to === 'explore' ? 0.4 : 0.24, { strong: true });
      if (this._scheduleNote(time, bus, noteFreq(root, scale, chord), 1.4, 'sine', 0.045, 0, 0.4, 0.5, -0.12)) this.notesBy.impact++;
    }
    transition.accents++;
  }

  _prune(time) {
    if (!this.voices.length) return;
    const kept = [];
    let sustain = 0;
    for (const rec of this.voices) if (rec.end > time) { kept.push(rec); if (rec.sustain) sustain++; }
    if (kept.length !== this.voices.length) this.voices = kept;
    this.sustainVoices = sustain;
  }

  // Phrase/forms position: the fourth bar of each half-phrase is a small fill;
  // bars 8/16/24/28/32 (1-based) are the big section-landmark fills.
  _fillLevel() {
    const b = ((this.bar % 32) + 32) % 32;
    if (b === 7 || b === 15 || b === 23 || b === 27 || b === 31) return 2;
    if (b % 4 === 3) return 1;
    return 0;
  }

  _scheduleStep(time, scene, step) {
    const arr = this.arrangements[scene];
    if (!arr) return;
    const bus = this.buses?.[scene] || this.musicBus;
    const drumBus = this.buses?.drums || bus;
    const prog = this.progressions[scene] || this.progressions.menu;
    const chord = prog[this.bar % prog.length];
    const quality = this.qualities?.[scene]?.[this.bar % (this.qualities[scene]?.length || 1)] || null;
    const root = this.theme.root;
    const scale = this.theme.scale;
    const stepDur = this._stepDur(scene);
    const hold = scene === 'combat' ? this.layers.combat : scene === 'explore' ? this.layers.explore : scene === 'results' ? this.layers.results : this.layers.menu;
    const section = this._formSection();
    const fillLevel = this._fillLevel();
    const fill = fillLevel > 0 ? (this.fills[scene] || null) : null;
    const stepsLeft = Math.max(1, arr.steps - step);
    const bar = this.bar;
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

    // 2. Percussion. Tribal arrangements layer a sampled bass drum under the
    //    synth kick; the sample bank's `kick` is what makes the entrance read.
    const sampledDrums = Boolean(arr.taiko);
    if (scene === 'combat') {
      drumGrid(arr.kick, () => this._kick(time, drumBus, 0.32, { sampled: sampledDrums, strong: true }));
      if (entering || hold >= LAYER_THRESHOLDS.snare) drumGrid(arr.snare, () => this._snare(time, drumBus, 0.16));
      if (entering || hold >= LAYER_THRESHOLDS.hat) drumGrid(arr.hat, () => this._hat(time, drumBus, 0.045));
    } else {
      drumGrid(arr.kick, () => this._kick(time, drumBus, 0.24, { sampled: sampledDrums, strong: false }));
      drumGrid(arr.snare, () => this._snare(time, drumBus, 0.12));
      drumGrid(arr.hat, () => this._hat(time, drumBus, 0.03));
    }
    if (fill && (scene !== 'combat' || boosted || hold >= LAYER_THRESHOLDS.snare)) {
      if (fill.hat) drumGrid(fill.hat, () => this._hat(time, drumBus, 0.05));
      if (fill.snare) drumGrid(fill.snare, () => this._snare(time, drumBus, fillLevel === 2 ? 0.2 : 0.16));
    }

    // 3. Tribal and bell accents. Bells sit an octave-plus above the strings so
    //    the high register stays clear of the brass and bass.
    const taikoOn = scene !== 'combat' || boosted || hold >= LAYER_THRESHOLDS.taiko;
    const bellOn = scene !== 'combat' || boosted || hold >= LAYER_THRESHOLDS.bell;
    if (arr.taiko && taikoOn) drumGrid(arr.taiko, () => this._taiko(time, drumBus, scene === 'combat' ? 0.34 : 0.24, { strong: scene === 'combat' }));
    if (fill && fill.taiko && taikoOn) drumGrid(fill.taiko, () => this._taiko(time, drumBus, 0.3, { strong: true }));
    if (arr.bell && bellOn) drumGrid(arr.bell, () => this._bell(time, bus, scene === 'combat' ? 0.06 : 0.05, noteFreq(root, scale, chord + 7) * 4));
    if (fill && fill.bell && bellOn) drumGrid(fill.bell, () => this._bell(time, bus, 0.04, noteFreq(root, scale, chord + 7) * 4));
    if (arr.timpani && taikoOn) drumGrid(arr.timpani, () => this._timpani(time, drumBus, noteFreq(root, scale, chord), scene === 'combat' ? 0.5 : 0.34));
    // Bell fragmentation: at every eight-bar turn the menu/results answer with
    // the motif's last four degrees [1,2,0,0] as a high bell tag.
    if (arr.bellFragment && (bar % 8) === 7) {
      const frag = [1, 2, 0, 0];
      const idx = [12, 13, 14, 15].indexOf(step);
      if (idx >= 0) this._bell(time, bus, 0.06, noteFreq(root, scale, frag[idx] + chord) * 4);
    }

    // 3b. The 32-bar form adds orchestral colour on top of the arrangement:
    //     deep bell tolls in the intro/outro, a low-string staccato ostinato
    //     (the motif in diminution) through the build/climax, marcato brass and
    //     timpani rolls at the climax, cymbal landmarks and a gong at the turns.
    const inClimax = section === 'climax';
    const inBuild = section === 'build';
    const inTransition = section === 'transition';
    const inOutro = section === 'outro';
    const inIntro = section === 'intro';
    const ostinatoOn = arr.stringsStaccato && (inBuild || inClimax || inTransition) && hold >= LAYER_THRESHOLDS.ostinato;
    if (ostinatoOn && step % 2 === 0) {
      const perBar = Math.max(1, Math.round(arr.steps / 4));
      const slot = Math.floor((bar * perBar + step / 4) / 0.5);
      const deg = COCS_MOTIF[((slot % COCS_MOTIF.length) + COCS_MOTIF.length) % COCS_MOTIF.length];
      const f = noteFreq(root, scale, deg + chord);
      this._stringsOstinato(time, bus, f, stepDur * 0.85, 0.22, step % 4 === 0 ? -0.35 : 0.05);
    }
    if (arr.brassMarcato && (inClimax || inTransition) && hold >= LAYER_THRESHOLDS.marcato && step % 4 === 0) {
      const tone = this._chordTone(scale, chord, quality, (step / 4) % 2 === 0 ? 0 : 2, 0);
      const f = root * Math.pow(2, tone / 12);
      const pan = clamp((tone % 12 - 3) * 0.04, -0.25, 0.2);
      this._brassMarcato(time, bus, f, stepDur * 1.6, 0.2, pan);
    }
    if (arr.trumpet && (inClimax || inOutro || scene === 'results') && hold >= LAYER_THRESHOLDS.highBrass && step === 0) {
      const tone = this._chordTone(scale, chord, quality, bar % 8 >= 4 ? 2 : 0, 1);
      const f = root * Math.pow(2, tone / 12);
      this._trumpet(time, bus, f, stepDur * 6, 0.16, 0.25);
    }
    if (arr.timpaniRoll && (inTransition || inOutro || (inBuild && bar % 4 === 3)) && step === 0) {
      this._timpaniRoll(time, drumBus, noteFreq(root, scale, chord), stepDur * arr.steps, 0.4, 0);
    }
    if (arr.bellToll && step === 0 && (inIntro || inOutro || scene === 'results')) {
      this._bellToll(time, bus, noteFreq(root, scale, chord + 7) * 2, 0.1, -0.2);
    }
    if (arr.cymbals) {
      // A sustained swell opens the build and the climax; a crash punctuates the
      // big fill bars.
      if (step === 0 && (bar % 32 === 8 || bar % 32 === 16)) {
        this._cymbal(time, drumBus, stepDur * arr.steps * 1.4, scene === 'combat' ? 0.09 : 0.07, 0.3, 'swell');
      } else if (fillLevel === 2 && step === 0) {
        this._cymbal(time, drumBus, stepDur * arr.steps * 0.6, scene === 'combat' ? 0.1 : 0.07, 0.3, 'crash');
      }
    }
    if (arr.gong && fillLevel === 2 && step === 0 && (inTransition || inOutro || scene === 'results')) {
      this._gong(time, drumBus, stepDur * arr.steps * 1.2, 0.08, -0.1);
    }
    // Sparse harp colour in the menu/results: one pluck on the third beat of odd
    // bars so the sacred texture glints without becoming an arpeggio part.
    if (arr.harp && bar % 2 === 1 && step === 8) {
      const tone = this._chordTone(scale, chord, quality, bar % 4 === 1 ? 2 : 1, 1);
      this._harp(time, bus, root * Math.pow(2, tone / 12), stepDur * 3, 0.05, 0.1);
    }

    // 4. Bass movement (root/fourth/octave passing tones inside the bar) with an
    //    optional low-brass line above it for tension and cadences.
    // Bass sits at the theme root (D2) so it is audible above laptop speakers,
    // and its sub rides in the same voice. The low-brass line is raised into the
    // sampled horns' range and seated horn(-0.25) .. tuba(+0.20).
    for (const [s, deg, len] of arr.bass) if ((s + arr.steps) % arr.steps === step) {
      const f = noteFreq(root, scale, deg + chord);
      this._bass(time, bus, f, len * stepDur * 0.94, 0.09);
    }
    if (arr.brass) for (const [s, deg, len] of arr.brass) if ((s + arr.steps) % arr.steps === step) {
      const f = noteFreq(root, scale, deg + chord);
      const brassPan = clamp((deg - 2) * 0.09, -0.25, 0.2);
      this._brass(time, bus, f, len * stepDur * 0.92, scene === 'combat' ? 0.16 : 0.13, brassPan, { velocity: scene === 'combat' ? 2 : 1 });
    }

    // 5. Lead: a quarter-note line that develops across bars. Gated by the layer
    //    hold so the melody arrives after the groove has established itself.
    const lead = this._leadFor(arr);
    const leadRate = Math.max(0.25, Number(arr.leadRate) || 1);
    const leadEvery = Math.max(1, Math.round(leadRate * 4));
    if (lead && step % leadEvery === 0 && hold >= LAYER_THRESHOLDS.lead) {
      const idx = this._leadIndex(arr, step);
      const semi = this._leadTone(arr, lead[idx], chord);
      const f = root * Math.pow(2, semi / 12) * Math.pow(2, Number(arr.leadOctave) || 0) * Math.pow(2, (Number(arr.leadShift) || 0) / 12);
      const type = arr.leadType || 'square';
      const gain = (Number(arr.leadGain) || 0.024) * this._vel();
      const cut = 1200 + 3200 * Math.min(1, gain * 24);
      if (this._scheduleNote(time, bus, f, stepDur * leadRate * 3.4, type, gain, 0, 0.02, 0.2, 0.08, { count: 2, detune: 9, filter: cut, filterEnd: cut * 0.75, q: 1.1, chorus: 0.12 })) this.notesBy.lead++;
    }

    // 6. Counter-line on the offbeats, answering the lead an octave away and
    //    panned opposite the arpeggio. A soft unison keeps it from sounding thin
    //    against the sampled strings.
    if (arr.counter && step % 2 === 1 && hold >= LAYER_THRESHOLDS.counter) {
      const i = (step - 1) / 2;
      const f = noteFreq(root, scale, arr.counter[i % arr.counter.length] + chord) * Math.pow(2, (Number(arr.counterShift) || 0) / 12);
      const pan = step % 4 === 1 ? 0.12 : -0.12;
      if (this._scheduleNote(time, bus, f, stepDur * 1.6, 'triangle', 0.014 * this._vel(), 0, 0.012, 0.2, pan, { count: 2, detune: 5, chorus: 0.1 })) this.notesBy.counter++;
    }

    // 7. Arpeggio: one degree per eighth note with a soft octave shimmer off the
    //    menu, spread gently across the stereo field and chorused for width.
    const arp = fill?.arp || arr.arp;
    if (arp && step % 2 === 0) {
      const i = step / 2;
      const f = noteFreq(root, scale, arp[i % arp.length] + chord);
      const pan = i % 2 ? -0.12 : 0.12;
      if (this._scheduleNote(time, bus, f, stepDur * 1.7, 'triangle', (scene === 'combat' ? 0.034 : 0.028) * this._vel(), 0, 0.01, 0.12, pan, { count: 2, detune: 4, chorus: 0.08 })) this.notesBy.arp++;
      if (scene !== 'menu' && this._scheduleNote(time, bus, f * 2, stepDur * 1.1, 'sine', 0.014 * this._vel(), 0, 0.012, 0.2, -pan)) this.notesBy.arp++;
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

    // 9. Strings: a chord triad (root/third/fifth, quality-aware) plus an octave
    //    swelling over the bar, raised into the sampled section's natural range
    //    (D3+). `strings: true` gives combat the bed even when it is not a
    //    chorale. Seating: cello -0.35 / viola +0.05 / violin +0.35.
    if ((arr.pad || arr.strings) && step === 0) {
      const padDur = stepDur * arr.steps * 0.96;
      const tone = (t, oct) => root * Math.pow(2, this._chordTone(scale, chord, quality, t, oct) / 12);
      const r = tone(0, 1), third = tone(1, 1), fifth = tone(2, 1), octave = tone(0, 2);
      if (this._strings(time, bus, r, padDur, 0.16 * this._vel(), -0.35, { velocity: 1 })) this.notesBy.pad++;
      if (this._strings(time, bus, third, padDur, 0.11 * this._vel(), 0.05, { velocity: 1 })) this.notesBy.pad++;
      if (this._strings(time, bus, fifth, padDur, 0.12 * this._vel(), 0.35, { velocity: 1 })) this.notesBy.pad++;
      // The octave only joins on the stronger half of the phrase so the bed
      // breathes instead of sitting at one dynamic.
      if (bar % 4 >= 2 && this._strings(time, bus, octave, padDur, 0.1 * this._vel(), -0.03, { velocity: 2 })) this.notesBy.pad++;
    }
    if (arr.choir && step === 0 && hold >= LAYER_THRESHOLDS.choir) {
      this._choir(time, bus, root, scale, chord, stepDur * arr.steps * 0.98, quality);
    }
    // Low drone one octave under the bass (D1), mostly dry so the bass stays
    // defined. The root doubles with low brass so the floor has weight.
    if (arr.drone && step === 0 && bar % 2 === 0) {
      const droneDur = stepDur * arr.steps * 2 * 0.98;
      const f = noteFreq(root / 2, scale, 0);
      if (this._scheduleNote(time, bus, f, droneDur, 'sine', 0.05 * this._vel(), 0, 0.4, 0.08, -0.1, { sustain: true })) this.notesBy.drone++;
      if (this._scheduleNote(time, bus, noteFreq(root / 2, scale, 4), droneDur, 'sine', 0.034 * this._vel(), 0, 0.5, 0.08, 0.1, { sustain: true })) this.notesBy.drone++;
      if (bar % 4 === 0) this._brass(time, bus, noteFreq(root / 2, scale, 0), droneDur * 0.9, 0.13, -0.05, { velocity: 1 });
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
    const sources = rec.oscs?.length ? rec.oscs : [rec.o];
    for (const o of sources) {
      try { o.onended = null; } catch {}
      try { o.stop(); } catch {}
      try { o.disconnect(); } catch {}
    }
    try { rec.g.disconnect(); } catch {}
    for (const n of rec.extra || []) { try { n.disconnect(); } catch {} }
  }

  dispose() {
    for (const rec of this.voices) this._stopVoice(rec);
    this.voices = [];
    if (this.buses) { for (const bus of Object.values(this.buses)) { try { bus.disconnect(); } catch {} } this.buses = null; }
    try { this.reverbSend?.disconnect(); } catch {}
    try { this.reverbReturn?.disconnect(); } catch {}
    try { this.reverbPreDelay?.disconnect(); } catch {}
    try { this.reverbHpf?.disconnect(); } catch {}
    try { this.reverb?.disconnect(); } catch {}
    this.reverbSend = null; this.reverbReturn = null; this.reverbPreDelay = null; this.reverbHpf = null; this.reverb = null;
    if (this.masterChain) { for (const node of Object.values(this.masterChain)) { try { node.disconnect(); } catch {} } this.masterChain = null; }
    try { this.chorusLfo?.stop(); } catch {}
    try { this.chorusLfo?.disconnect(); } catch {}
    try { this.chorusSend?.disconnect(); } catch {}
    try { this.chorusReturn?.disconnect(); } catch {}
    this.chorusSend = null; this.chorusReturn = null; this.chorusLfo = null;
    try { this._sampleBank?.dispose(); } catch {}
    this._sampleBank = null;
    try { this.musicBus?.disconnect(); } catch {}
    this.musicBus = null;
    this.transition = null;
    this._lastTime = null;
    this.ctx = null;
  }
}

export const MUSIC_EXPORTS = Object.freeze(['MusicEngine', 'MUSIC_SCENES', 'CHORD_PROGRESSIONS', 'ARRANGEMENTS', 'SOUNDTRACKS', 'HALO_THEME', 'HALO_ARRANGEMENTS', 'HALO_PROGRESSIONS', 'HALO_QUALITIES', 'COCS_MOTIF', 'CHORD_TONES', 'FORM_BARS']);
