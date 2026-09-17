// Sampled-instrument bank for the procedural soundtrack engine.
//
// The bake pipeline (scripts/music-bake.mjs) writes a frozen manifest plus mono
// Ogg/AAC one-shots and sustains into public/music, so the browser can stream
// them same-origin from /music. This module is deliberately split in two:
//
//   * pure manifest helpers (parse/select/loop math) — no Web Audio, no DOM, no
//     fetch, safe to import in Node tests;
//   * `SampleBank` — the lazy fetch/decode cache the MusicEngine drives.
//
// Determinism contract: the bank never chooses a note on its own. Callers pass
// the engine's seeded RNG into `selectSample`, so one seed reproduces one take,
// and the engine folds the selected (midi, velocity, round-robin index) into
// its `scheduleChecksum`. Because Node tests never have a decodable context the
// bank stays inert there and the existing oscillator path (and its pinned
// checksums) is unchanged.

export const MUSIC_BASE = '/music';
export const MUSIC_MANIFEST_URL = `${MUSIC_BASE}/manifest.json`;

// Validate + normalise a manifest.json payload. Returns null for anything that
// is not a version-1 manifest with at least one usable sample. Junk entries are
// dropped rather than poisoning the whole bank, so a partial re-bake still runs.
export function parseManifest(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.samples)) return null;
  const samples = [];
  for (const s of data.samples) {
    if (!s || typeof s.id !== 'string' || typeof s.instrument !== 'string') continue;
    const midi = Number(s.midi);
    if (!Number.isFinite(midi)) continue;
    const velocity = Number(s.velocity);
    const loopStart = Number(s.loopStart);
    const loopEnd = Number(s.loopEnd);
    const looped = Number.isFinite(loopStart) && Number.isFinite(loopEnd) && loopStart >= 0 && loopEnd > loopStart;
    samples.push({
      id: s.id,
      instrument: s.instrument,
      midi,
      velocity: velocity === 2 ? 2 : 1,
      file: typeof s.file === 'string' ? s.file : null,
      mime: typeof s.mime === 'string' ? s.mime : 'audio/ogg',
      fallback: typeof s.fallback === 'string' ? s.fallback : null,
      fallbackMime: typeof s.fallbackMime === 'string' ? s.fallbackMime : 'audio/mp4',
      gain: Number.isFinite(Number(s.gain)) ? Number(s.gain) : 1,
      loopStart: looped ? loopStart : null,
      loopEnd: looped ? loopEnd : null,
      looped,
    });
  }
  if (!samples.length) return null;
  const instruments = {};
  for (const s of samples) {
    if (!instruments[s.instrument]) instruments[s.instrument] = { type: s.looped ? 'sustained' : 'oneshot', samples: [] };
    instruments[s.instrument].samples.push(s.id);
  }
  return {
    version: 1,
    generator: typeof data.generator === 'string' ? data.generator : null,
    sampleRate: Number.isFinite(Number(data.sampleRate)) ? Number(data.sampleRate) : 44100,
    samples,
    instruments,
  };
}

// All samples closest in pitch to `midi`, stable-sorted by id. The caller then
// picks one deterministically (round-robin) from this list, so two samples at
// the same pitch (e.g. viola vs. violin unison) alternate instead of flamming.
export function nearestSamples(manifest, instrument, midi) {
  if (!manifest || !Array.isArray(manifest.samples)) return [];
  let best = Infinity;
  const list = [];
  for (const s of manifest.samples) {
    if (s.instrument !== instrument) continue;
    const d = Math.abs(s.midi - midi);
    if (d < best) { best = d; list.length = 0; list.push(s); }
    else if (d === best) list.push(s);
  }
  return list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Deterministic sample choice. `pick` is a seeded [0,1) value from the engine
// RNG; it selects the round-robin member of the pool. `layer` (1 soft / 2
// strong) is a preference, not a filter: an instrument with only one layer
// still plays, and the nearest-pitch pool is used when no layer matches.
export function selectSample(manifest, instrument, midi, layer, pick) {
  const near = nearestSamples(manifest, instrument, midi);
  if (!near.length) return null;
  const preferred = layer === 1 || layer === 2 ? near.filter((s) => s.velocity === layer) : [];
  const pool = preferred.length ? preferred : near;
  const u = Number.isFinite(Number(pick)) ? Number(pick) - Math.floor(Number(pick)) : 0;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(u * pool.length)));
  return pool[index];
}

// Playback ratio from the note frequency to the sample's recorded pitch. A
// sample at exactly `entry.midi` needs no shift; anything else is pitch-shifted
// with the AudioBufferSourceNode playbackRate (the bake does not time-stretch).
export function sampleRateFor(freq, entryMidi) {
  const target = Math.max(1e-6, Number(freq) || 0);
  const recorded = 440 * Math.pow(2, (Number(entryMidi) - 69) / 12);
  return target / recorded;
}

// The bake crossfades the loop start into the audio at loopEnd, so the runtime
// simply plays [0, loopStart) once then loops [loopStart, loopEnd): that is
// exactly AudioBufferSourceNode.loop semantics. Returns null for one-shots.
export function loopWindow(entry) {
  if (!entry || entry.loopStart == null || entry.loopEnd == null) return null;
  if (!(entry.loopEnd > entry.loopStart)) return null;
  return { loopStart: entry.loopStart, loopEnd: entry.loopEnd };
}

const joinUrl = (base, rel) => `${String(base || MUSIC_BASE).replace(/\/+$/, '')}/${String(rel || '').replace(/^\/+/, '')}`;

// Lazy fetch/decode cache. One instance per AudioContext (the MusicEngine owns
// it). Decoding is asynchronous and never awaited by the scheduler: a voice
// whose instrument is not ready yet falls back to the oscillator and the bank
// keeps loading in the background. A failed decode is remembered so it is not
// retried every note; a failed manifest fetch is retried because it is cheap.
export class SampleBank {
  constructor({ ctx = null, baseUrl = MUSIC_BASE, fetchImpl = null, manifest = null } = {}) {
    this.ctx = ctx || null;
    this.baseUrl = baseUrl || MUSIC_BASE;
    this.fetchImpl = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.manifest = manifest ? parseManifest(manifest) : null;
    this._buffers = new Map();
    this._state = new Map();
    this._pending = new Map();
    this._manifestPromise = null;
    this._manifestError = false;
    this.disposed = false;
  }

  setContext(ctx) { this.ctx = ctx || null; return this.ctx; }

  has(instrument) { return Boolean(this.manifest && this.manifest.instruments[instrument]); }

  get(instrument) {
    if (!this.manifest || !this.manifest.instruments[instrument]) return null;
    return this.manifest.instruments[instrument];
  }

  state(instrument) { return this._state.get(instrument) || 'idle'; }

  isReady(instrument) { return this.state(instrument) === 'ready'; }

  isPending(instrument) { const s = this.state(instrument); return s === 'loading'; }

  bufferFor(entry) { return entry ? (this._buffers.get(entry.id) || null) : null; }

  // Fetch + parse the manifest once. Safe to call repeatedly and safe to call
  // without a context; resolves false on any failure so callers can stay inert.
  loadManifest(url = `${this.baseUrl.replace(/\/+$/, '')}/manifest.json`) {
    if (this.manifest) return Promise.resolve(true);
    if (this._manifestPromise) return this._manifestPromise;
    if (!this.fetchImpl) return Promise.resolve(false);
    this._manifestError = false;
    this._manifestPromise = (async () => {
      try {
        const res = await this.fetchImpl(url, { cache: 'force-cache' });
        if (!res || res.ok === false) throw new Error(`manifest ${res ? res.status : 'offline'}`);
        const parsed = parseManifest(await res.json());
        if (!parsed) throw new Error('manifest invalid');
        if (this.disposed) return false;
        this.manifest = parsed;
        return true;
      } catch {
        this._manifestError = true;
        this._manifestPromise = null;
        return false;
      }
    })();
    return this._manifestPromise;
  }

  // Lazily decode every sample of an instrument. Idempotent and non-blocking:
  // the returned promise settles after all samples have been attempted, but a
  // caller that ignores it loses nothing (the scheduler polls isReady()).
  preload(instrument) {
    if (!this.manifest || !this.has(instrument)) return null;
    if (this.state(instrument) === 'ready' || this.state(instrument) === 'failed') return Promise.resolve(this.isReady(instrument));
    if (this._pending.has(instrument)) return this._pending.get(instrument);
    this._state.set(instrument, 'loading');
    const entries = this.manifest.samples.filter((s) => s.instrument === instrument);
    const promise = Promise.all(entries.map((entry) => this._loadEntry(entry))).then((loaded) => {
      this._pending.delete(instrument);
      if (this.disposed) return false;
      const ok = loaded.some(Boolean);
      this._state.set(instrument, ok ? 'ready' : 'failed');
      return ok;
    }).catch(() => {
      this._pending.delete(instrument);
      this._state.set(instrument, 'failed');
      return false;
    });
    this._pending.set(instrument, promise);
    return promise;
  }

  // Decode every instrument in the manifest. Bounded and best-effort; used by
  // an optional warm-up so a scene's palette is decoded before it is needed.
  preloadAll() {
    if (!this.manifest) return Promise.resolve(false);
    return Promise.all(Object.keys(this.manifest.instruments).map((name) => this.preload(name))).then((results) => results.some(Boolean));
  }

  _loadEntry(entry) {
    if (this._buffers.has(entry.id)) return Promise.resolve(Boolean(this._buffers.get(entry.id)));
    if (!this.ctx || typeof this.ctx.decodeAudioData !== 'function') return Promise.resolve(false);
    return (async () => {
      let buffer = entry.file ? await this._fetchDecode(joinUrl(this.baseUrl, entry.file)) : null;
      if (!buffer && entry.fallback) buffer = await this._fetchDecode(joinUrl(this.baseUrl, entry.fallback));
      if (this.disposed) return false;
      this._buffers.set(entry.id, buffer || null);
      return Boolean(buffer);
    })();
  }

  async _fetchDecode(url) {
    try {
      const res = await this.fetchImpl(url, { cache: 'force-cache' });
      if (!res || res.ok === false) return null;
      const bytes = await res.arrayBuffer();
      return await this._decode(bytes);
    } catch {
      return null;
    }
  }

  _decode(bytes) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (buffer) => { if (!settled) { settled = true; resolve(buffer || null); } };
      try {
        const maybe = this.ctx.decodeAudioData(bytes, done, () => done(null));
        if (maybe && typeof maybe.then === 'function') maybe.then(done, () => done(null));
      } catch { done(null); }
    });
  }

  // Read-only status for the `tokenArenaAudio()` hook. Cheap: no allocation
  // beyond the small summary. `ready` counts fully decoded instruments.
  status() {
    const instruments = {};
    let ready = 0, loading = 0, failed = 0, loaded = 0, total = 0;
    for (const name of Object.keys(this.manifest?.instruments || {})) {
      const state = this.state(name);
      if (state === 'ready') ready++;
      else if (state === 'loading') loading++;
      else if (state === 'failed') failed++;
      const entries = this.manifest.samples.filter((s) => s.instrument === name);
      total += entries.length;
      for (const entry of entries) if (this._buffers.get(entry.id)) loaded++;
      instruments[name] = { state, loaded: entries.filter((e) => this._buffers.get(e.id)).length, total: entries.length };
    }
    return { manifest: Boolean(this.manifest), ready, loading, failed, loaded, total, instruments };
  }

  dispose() {
    this.disposed = true;
    this._buffers.clear();
    this._state.clear();
    this._pending.clear();
    this._manifestPromise = null;
    this.manifest = null;
    this.ctx = null;
  }
}

// The instruments the engine can voice from samples, in one place so the
// scheduler and docs cannot drift apart.
export const SAMPLED_INSTRUMENTS = Object.freeze(['strings-pad', 'low-brass', 'timpani', 'bells', 'taiko']);
