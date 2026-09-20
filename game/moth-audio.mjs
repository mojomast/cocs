// Runtime playback layer for Moth audio (ambient beds, spaces and stingers).
//
// This is the Web Audio half of the Moth audio pipeline; `game/moth-assets.mjs`
// stays a pure reader. It mirrors the intended sampled-instrument bank contract
// (lazy fetch/decode, remembered failures, best-effort fallback) without
// touching `MusicEngine`, its note scheduling, or the sampled orchestra.
//
// Everything here is inert unless a real AudioContext exists:
//   - Node tests and SSR import it with no context and every call is a no-op;
//   - reduced motion (or an explicit `enabled: false`) disables playback;
//   - a clip only plays once it has decoded, so a frame never blocks on fetch.
//
// Determinism: routing is a fixed scene/mood/weather table, never Math.random,
// so the same game state always selects the same bed.

import { mothAudioClip, mothEchoMap } from './moth-assets.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const bufferBytes = (buffer) => (buffer?.length || 0) * (buffer?.numberOfChannels || 1) * 4;

// A context is usable only if it can decode and play buffers.
const usableContext = (ctx) => Boolean(ctx && typeof ctx.createBufferSource === 'function' && typeof ctx.decodeAudioData === 'function');

// Fixed routing tables. Callers may override them; nothing is chosen at random.
export const MOTH_SCENE_BEDS = Object.freeze({
  menu: 'bed-menu',
  game: 'bed-explore',
  explore: 'bed-explore',
  combat: 'bed-combat',
});
export const MOTH_MOOD_BEDS = Object.freeze({
  default: 'bed-default',
  night: 'bed-night',
  cold: 'bed-cold',
  hot: 'bed-hot',
  storm: 'bed-storm',
});
export const MOTH_WEATHER_BEDS = Object.freeze({
  rain: 'weather-rain',
  storm: 'weather-rain',
  ash: 'weather-ash',
  snow: 'weather-snow',
});

// Lazy fetch + decodeAudioData cache for the `audio` bucket. Mirrors the sampled
// bank: one in-flight decode per clip, failures latched (never retried every
// frame), and a decoded-bytes budget with oldest-first eviction.
export class MothAudioBank {
  constructor({ ctx = null, resolve = mothAudioClip, fetchImpl = typeof fetch === 'function' ? fetch : null, maxBytes = 12 * 1024 * 1024, reducedMotion = false } = {}) {
    this.ctx = ctx;
    this.resolve = typeof resolve === 'function' ? resolve : mothAudioClip;
    this.fetch = fetchImpl;
    this.maxBytes = Math.max(0, Number(maxBytes) || 0);
    this.enabled = !reducedMotion && usableContext(ctx) && typeof this.fetch === 'function';
    this.buffers = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.descriptors = new Map();
    this.decodedBytes = 0;
    this.decoded = 0;
    this.evictions = 0;
  }

  descriptor(name) {
    if (this.descriptors.has(name)) return this.descriptors.get(name);
    let value = null;
    try { value = this.resolve(name) || null; } catch { value = null; }
    this.descriptors.set(name, value);
    return value;
  }

  state(name) {
    if (this.buffers.has(name)) return 'ready';
    if (this.pending.has(name)) return 'loading';
    if (this.failed.has(name)) return 'failed';
    if (!this.enabled) return 'unsupported';
    return this.descriptor(name) ? 'idle' : 'missing';
  }

  isReady(name) { return this.buffers.has(name); }
  isPending(name) { return this.pending.has(name); }
  buffer(name) { return this.buffers.get(name) || null; }

  // Loop points in seconds within the decoded buffer. Falls back to the whole
  // buffer when a descriptor is missing an endpoint or the window is inverted.
  loopWindow(name) {
    const descriptor = this.descriptor(name);
    const buffer = this.buffers.get(name);
    const duration = buffer && Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : (Number.isFinite(descriptor?.seconds) ? descriptor.seconds : 0);
    const requestedStart = Number(descriptor?.loopStart);
    const requestedEnd = Number(descriptor?.loopEnd);
    let start = Number.isFinite(requestedStart) ? clamp(requestedStart, 0, duration) : 0;
    let end = Number.isFinite(requestedEnd) ? clamp(requestedEnd, 0, duration) : duration;
    if (!(end > start)) { start = 0; end = duration; }
    return { start, end, duration };
  }

  // Fire-and-forget decode. Resolves to the buffer, or null when unavailable,
  // unsupported, failed, or over budget.
  preload(name) {
    if (!this.enabled) return Promise.resolve(null);
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name));
    if (this.pending.has(name)) return this.pending.get(name);
    if (this.failed.has(name)) return Promise.resolve(null);
    const descriptor = this.descriptor(name);
    if (!descriptor || typeof descriptor.url !== 'string' || !descriptor.url) { this.failed.add(name); return Promise.resolve(null); }
    const task = this._fetchAndDecode(descriptor)
      .then((buffer) => {
        if (!buffer) { this.failed.add(name); return null; }
        const size = bufferBytes(buffer);
        if (size > this.maxBytes) { this.failed.add(name); return null; }
        while (this.decodedBytes + size > this.maxBytes && this.buffers.size) {
          const [oldest, old] = this.buffers.entries().next().value;
          this.buffers.delete(oldest);
          this.decodedBytes -= bufferBytes(old);
          this.evictions++;
        }
        this.buffers.set(name, buffer);
        this.decodedBytes += size;
        this.decoded++;
        return buffer;
      })
      .catch(() => { this.failed.add(name); return null; })
      .finally(() => this.pending.delete(name));
    this.pending.set(name, task);
    return task;
  }

  async _fetchAndDecode(descriptor) {
    const response = await this.fetch(descriptor.url, { cache: 'force-cache' });
    if (!response || response.ok === false) return null;
    const bytes = await response.arrayBuffer();
    return new Promise((resolve, reject) => {
      const maybe = this.ctx.decodeAudioData(bytes, resolve, reject);
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
    });
  }

  // Preload a fixed set of clips (per-scene preloading). Never rejects.
  preloadGroup(names = []) { return Promise.all(names.map((name) => this.preload(name))); }

  status() {
    return { active: this.enabled, ready: this.buffers.size, pending: this.pending.size, failed: this.failed.size, decodedBytes: this.decodedBytes, maxBytes: this.maxBytes, evictions: this.evictions };
  }

  dispose() {
    this.buffers.clear();
    this.pending.clear();
    this.failed.clear();
    this.descriptors.clear();
    this.decodedBytes = 0;
    this.decoded = 0;
    this.enabled = false;
  }
}

// The player layer owned by the audio host. Selects and crossfades up to
// `maxBeds` looped beds, fires one-shot stingers, and owns an optional
// delay/feedback "space" graph. It never touches MusicEngine.
/**
 * @typedef {Object} MothAudioOptions
 * @property {object|null} [ctx] Live AudioContext (null keeps the layer inert)
 * @property {object|null} [bank] A MothAudioBank; one is built when omitted
 * @property {Record<string, object>} [destinations] Bus names to destination nodes
 * @property {Record<string, string|null>|null} [sceneBeds] Scene routing overrides
 * @property {Record<string, string|null>|null} [moodBeds] Mood routing overrides
 * @property {Record<string, string|null>|null} [weatherBeds] Weather routing overrides
 * @property {number} [maxBeds] Concurrent looped beds
 * @property {number} [gain] Layer output gain
 * @property {boolean} [reducedMotion] Disables playback entirely
 * @property {boolean} [enabled] Host opt-in
 * @property {boolean} [buildSpaceGraph] Own a delay graph for setSpace()
 */
export class MothAudio {
  /** @param {MothAudioOptions} [options] */
  constructor({
    ctx = null,
    bank = null,
    destinations = {},
    sceneBeds = null,
    moodBeds = null,
    weatherBeds = null,
    maxBeds = 3,
    gain = 0.8,
    reducedMotion = false,
    enabled = true,
    buildSpaceGraph = true,
  } = {}) {
    this.ctx = ctx;
    this.bank = bank || new MothAudioBank({ ctx, reducedMotion });
    this.destinations = destinations || {};
    this.maxBeds = Math.max(1, Math.round(maxBeds) || 1);
    this.gain = Number.isFinite(gain) ? gain : 0.8;
    this.reducedMotion = reducedMotion === true;
    this.requestedEnabled = enabled !== false;
    this.enabled = this.requestedEnabled && !this.reducedMotion && usableContext(ctx);
    this.buildSpaceGraph = buildSpaceGraph !== false;
    this.sceneBeds = Object.freeze({ ...MOTH_SCENE_BEDS, ...(sceneBeds || {}) });
    this.moodBeds = Object.freeze({ ...MOTH_MOOD_BEDS, ...(moodBeds || {}) });
    this.weatherBeds = Object.freeze({ ...MOTH_WEATHER_BEDS, ...(weatherBeds || {}) });
    this.scene = 'menu';
    this.intensity = 0;
    this.bedMood = 'default';
    this.weather = null;
    this.beds = [];
    this.stingers = [];
    this.space = null;
    this.spaceGraph = null;
    this.plays = 0;
    this.failures = 0;
    this.preloads = 0;
  }

  // Effective per-clip gain: the host layer gain, the caller's option and the
  // baked descriptor's own gain. `sampler.mjs` honours the same descriptor
  // field for the orchestral bank, so a quiet clip no longer has to be fought
  // with a bespoke caller multiplier.
  _clipGain(name, gain) {
    const baked = Number(this.bank?.descriptor?.(name)?.gain);
    return this.gain * (Number.isFinite(gain) ? gain : 1) * (Number.isFinite(baked) ? baked : 1);
  }

  // Queue a decode only for clips that exist in the bake. A missing descriptor
  // stays a silent no-op instead of latching a bank failure, so a later
  // registry/bake change can still bring the bed in.
  _requestClip(name) {
    if (!this.bank?.descriptor?.(name)) return false;
    this.bank.preload(name);
    return true;
  }

  _destination(kind) {
    const destinations = this.destinations || {};
    return destinations[kind] || destinations.ambience || destinations.effects || destinations.master || null;
  }

  // Runtime gate for reduced motion / constrained hosts. Disabling stops every
  // bed and tears down the space graph so no new sound starts; re-enabling is
  // only possible when the layer was not requested off and the context is usable.
  _syncEnabled() {
    const next = this.requestedEnabled && !this.reducedMotion && usableContext(this.ctx);
    if (next === this.enabled) return this.enabled;
    this.enabled = next;
    if (!next) {
      for (const bed of [...this.beds]) this._stopBed(bed);
      this._teardownSpace();
    } else {
      this._reconcile();
    }
    return this.enabled;
  }

  // Host opt-in/out (e.g. the reduced-motion toggle). Returns the live state.
  setEnabled(on) {
    this.requestedEnabled = on !== false;
    return this._syncEnabled();
  }

  // Reduced motion always wins: it disables playback and keeps it disabled
  // until the preference is cleared, then restores the requested state.
  setReducedMotion(on) {
    this.reducedMotion = on === true;
    return this._syncEnabled();
  }

  // The ordered bed set for the current scene/intensity/mood/weather. Pure and
  // deterministic; capped at `maxBeds`.
  desiredBeds() {
    const scene = this.scene === 'menu' ? 'menu' : this.intensity >= 0.34 ? 'combat' : 'explore';
    const out = [];
    const base = this.sceneBeds[scene];
    if (base) out.push(base);
    const mood = this.bedMood === 'default' ? null : this.moodBeds[this.bedMood];
    if (mood && mood !== base && scene !== 'menu') out.push(mood);
    const weather = this.weather ? this.weatherBeds[this.weather] : null;
    if (weather && !out.includes(weather)) out.push(weather);
    return out.slice(0, this.maxBeds);
  }

  setScene(scene) { this.scene = scene === 'menu' ? 'menu' : scene || 'game'; this._reconcile(); return this.scene; }
  setIntensity(value) { this.intensity = clamp(Number(value) || 0, 0, 1); this._reconcile(); return this.intensity; }
  setBedMood(mood) { this.bedMood = mood && this.moodBeds[mood] ? mood : 'default'; this._reconcile(); return this.bedMood; }
  setWeather(kind) { this.weather = kind && this.weatherBeds[kind] ? kind : null; this._reconcile(); return this.weather; }

  // Preload the beds the current state wants (per-scene preloading). Returns the
  // number of clips that were not already ready or pending.
  preloadScene() {
    if (!this.enabled) return 0;
    let requested = 0;
    for (const name of this.desiredBeds()) {
      if (!this.bank.descriptor?.(name)) continue;
      const state = this.bank.state(name);
      if (state === 'idle' || state === 'missing') { requested++; this.bank.preload(name); }
    }
    this.preloads += requested;
    return requested;
  }

  _reconcile() {
    if (!this.enabled) return 0;
    const wanted = this.desiredBeds();
    for (const bed of [...this.beds]) if (!wanted.includes(bed.name)) this._stopBed(bed);
    let started = 0;
    for (const name of wanted) {
      if (this.beds.some((bed) => bed.name === name)) continue;
      if (this.playBed(name)) started++;
      else this._requestClip(name);
    }
    return started;
  }

  // Start a looped bed. Returns false (and kicks off a decode) until it is ready.
  playBed(name, { bus = 'ambience', fade = 1, gain = 1, loop = true } = {}) {
    if (!this.enabled) return false;
    const buffer = this.bank.buffer(name);
    if (!buffer) { this._requestClip(name); return false; }
    const destination = this._destination(bus);
    if (!destination) return false;
    if (this.beds.length >= this.maxBeds) this._stopBed(this.beds.shift());
    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const window = this.bank.loopWindow(name);
      if (loop) { source.loop = true; source.loopStart = window.start; source.loopEnd = window.end; }
      const node = this.ctx.createGain();
      const target = this._clipGain(name, gain);
      const time = this.ctx.currentTime || 0;
      if (fade > 0 && typeof node.gain.setTargetAtTime === 'function') {
        node.gain.value = 0.0001;
        node.gain.setTargetAtTime(target, time, fade);
      } else node.gain.value = target;
      source.connect(node);
      node.connect(destination);
      source.start(time);
      this.beds.push({ name, source, gain: node, target, started: time });
      this.plays++;
      return true;
    } catch { this.failures++; return false; }
  }

  // Fire a one-shot stinger. Returns false (and kicks off a decode) until ready.
  playStinger(name, { bus = 'effects', gain = 1, fade = 0.01, pan = 0, duck = 0 } = {}) {
    if (!this.enabled) return false;
    const buffer = this.bank.buffer(name);
    if (!buffer) { this._requestClip(name); return false; }
    const destination = this._destination(bus);
    if (!destination) return false;
    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const node = this.ctx.createGain();
      const target = this._clipGain(name, gain);
      const time = this.ctx.currentTime || 0;
      if (fade > 0 && typeof node.gain.setTargetAtTime === 'function') {
        node.gain.value = 0.0001;
        node.gain.setTargetAtTime(target, time, fade);
      } else node.gain.value = target;
      source.connect(node);
      let tail = node;
      if (pan && typeof this.ctx.createStereoPanner === 'function') {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        node.connect(panner);
        tail = panner;
      }
      tail.connect(destination);
      source.start(time);
      this.stingers.push({ name, source, gain: node, tail, target, end: time + (Number(buffer.duration) || 0) });
      this.plays++;
      if (duck > 0) this._duck(duck);
      return true;
    } catch { this.failures++; return false; }
  }

  // Own a delay/feedback "space" graph from a baked echo map. Optional: without
  // a destination or DelayNode support it just records the map for a host that
  // owns its own space send.
  setSpace(name) {
    const descriptor = mothEchoMap(name);
    if (!descriptor) return null;
    const taps = Array.isArray(descriptor.taps) ? descriptor.taps : [];
    const first = taps.find((tap) => Number.isFinite(tap?.timeMs));
    this.space = {
      name,
      count: descriptor.count ?? taps.length,
      taps,
      delay: first ? clamp(first.timeMs / 1000, 0.001, 1) : 0.16,
      feedback: clamp(0.25 + (Number(descriptor.depth) || 8) * 0.02, 0, 0.7),
      wet: 0.5,
    };
    this._applySpace();
    return this.space;
  }

  _applySpace() {
    if (!this.enabled || !this.buildSpaceGraph || !this.space || typeof this.ctx.createDelay !== 'function') return false;
    const destination = this._destination('effects');
    if (!destination) return false;
    try {
      this._teardownSpace();
      const send = this.ctx.createGain();
      const delay = this.ctx.createDelay(1);
      const feedback = this.ctx.createGain();
      const wet = this.ctx.createGain();
      send.gain.value = 1;
      delay.delayTime.value = this.space.delay;
      feedback.gain.value = this.space.feedback;
      wet.gain.value = this.space.wet;
      send.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(destination);
      this.spaceGraph = { send, delay, feedback, wet };
      return true;
    } catch { this.spaceGraph = null; return false; }
  }

  // A short gain dip on the bed bus when a stinger lands. Deliberately local to
  // MothAudio so it never calls MusicEngine.setDuck.
  _duck(amount) {
    const depth = clamp(1 - amount * 0.6, 0, 1);
    const time = this.ctx?.currentTime || 0;
    for (const bed of this.beds) {
      const base = Number.isFinite(bed.target) ? bed.target : this.gain;
      try { bed.gain.gain.setTargetAtTime(base * depth, time, 0.04); bed.gain.gain.setTargetAtTime(base, time + 0.35, 0.18); } catch {}
    }
  }

  // Prune finished stingers. Called once per frame by the audio host.
  tick() {
    const time = this.ctx?.currentTime || 0;
    let pruned = 0;
    for (const stinger of [...this.stingers]) {
      if (stinger.end <= time) { this._stopStinger(stinger); pruned++; }
    }
    return pruned;
  }

  _stopBed(bed) {
    if (!bed) return;
    this.beds = this.beds.filter((entry) => entry !== bed);
    try { bed.source?.stop?.(); } catch {}
    try { bed.source?.disconnect?.(); } catch {}
    try { bed.gain?.disconnect?.(); } catch {}
  }

  _stopStinger(stinger) {
    if (!stinger) return;
    this.stingers = this.stingers.filter((entry) => entry !== stinger);
    if (stinger.source) { try { stinger.source.onended = null; } catch {} }
    try { stinger.source?.stop?.(); } catch {}
    try { stinger.source?.disconnect?.(); } catch {}
    try { stinger.gain?.disconnect?.(); } catch {}
    try { stinger.tail?.disconnect?.(); } catch {}
  }

  _teardownSpace() {
    if (!this.spaceGraph) return;
    for (const node of Object.values(this.spaceGraph)) { try { node.disconnect?.(); } catch {} }
    this.spaceGraph = null;
  }

  status() {
    return {
      active: this.enabled,
      scene: this.scene,
      intensity: this.intensity,
      mood: this.bedMood,
      weather: this.weather,
      beds: this.beds.map((bed) => bed.name),
      bedCount: this.beds.length,
      maxBeds: this.maxBeds,
      stingers: this.stingers.length,
      space: this.space?.name ?? null,
      plays: this.plays,
      failures: this.failures,
      preloads: this.preloads,
      bank: this.bank.status(),
    };
  }

  dispose() {
    for (const bed of [...this.beds]) this._stopBed(bed);
    for (const stinger of [...this.stingers]) this._stopStinger(stinger);
    this._teardownSpace();
    this.bank?.dispose?.();
    this.space = null;
    this.requestedEnabled = false;
    this.enabled = false;
  }
}

export const MOTH_AUDIO_EXPORTS = Object.freeze(['MothAudioBank', 'MothAudio', 'MOTH_SCENE_BEDS', 'MOTH_MOOD_BEDS', 'MOTH_WEATHER_BEDS']);
