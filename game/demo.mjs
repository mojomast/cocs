export const DEMO_VERSION = 1;

const ROUNDED_KEYS = new Set(['x', 'y', 'z', 'yaw', 'pitch', 'vx', 'vy', 'vz', 'roll', 'pitchBody', 'turretYaw']);
const ACTOR_SMOOTH = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'pitch'];
const ACTOR_ANGLE = ['yaw'];
const VEHICLE_SMOOTH = ['x', 'y', 'z', 'roll', 'pitchBody', 'turretYaw'];
const VEHICLE_ANGLE = ['yaw'];
const TAU = Math.PI * 2;

export function roundNumber(value, places = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function demoHeader(state) {
  return {
    version: DEMO_VERSION,
    mapId: state?.mapId ?? null,
    mapName: state?.mapName ?? null,
    modeName: state?.modeName ?? null,
    config: state?.config ? { ...state.config } : {},
    teamScores: state?.teamScores ? { ...state.teamScores } : {},
  };
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clonePlain(value[key]);
    return out;
  }
  return value;
}

function cloneRounded(value) {
  if (Array.isArray(value)) return value.map(cloneRounded);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key === 'bot') continue;
      const child = value[key];
      out[key] = ROUNDED_KEYS.has(key) && typeof child === 'number' ? roundNumber(child, 2) : cloneRounded(child);
    }
    return out;
  }
  return value;
}

function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}

function lerpAngle(a, b, alpha) {
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return a + delta * alpha;
}

function applySmooth(target, next, keys, angle, alpha) {
  for (const key of keys) {
    const a = target[key];
    const b = next[key];
    if (Number.isFinite(a) && Number.isFinite(b)) target[key] = angle ? lerpAngle(a, b, alpha) : lerp(a, b, alpha);
  }
}

function indexById(list) {
  const map = new Map();
  if (Array.isArray(list)) for (const item of list) if (item && item.id !== undefined) map.set(item.id, item);
  return map;
}

function mergeList(target, list, key, smooth, angle, alpha, rocket) {
  if (!Array.isArray(list)) return;
  const next = indexById(list);
  const existing = Array.isArray(target[key]) ? target[key] : [];
  const merged = [];
  const present = new Set();
  for (const item of existing) {
    const to = item && next.get(item.id);
    if (!to) continue;
    present.add(item.id);
    if (rocket) {
      if (to.pos && item.pos) for (const axis of smooth) {
        const a = item.pos[axis];
        const b = to.pos[axis];
        if (Number.isFinite(a) && Number.isFinite(b)) item.pos[axis] = lerp(a, b, alpha);
      }
    } else {
      applySmooth(item, to, smooth, false, alpha);
      if (angle) applySmooth(item, to, angle, true, alpha);
    }
    merged.push(item);
  }
  for (const to of list) {
    if (!to || present.has(to.id)) continue;
    merged.push(clonePlain(to));
  }
  target[key] = merged;
}

function interpolate(target, k1, alpha) {
  mergeList(target, k1.actors, 'actors', ACTOR_SMOOTH, ACTOR_ANGLE, alpha, false);
  mergeList(target, k1.vehicles, 'vehicles', VEHICLE_SMOOTH, VEHICLE_ANGLE, alpha, false);
  mergeList(target, k1.rockets, 'rockets', ['x', 'y', 'z'], null, alpha, true);
}

function readStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  const pump = () => reader.read().then(({ done, value }) => {
    if (done) {
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }
    chunks.push(value);
    total += value.length;
    return pump();
  });
  return pump();
}

export class DemoRecorder {
  constructor(options = {}) {
    this.recordHz = Number.isFinite(options.recordHz) && options.recordHz > 0 ? options.recordHz : 18;
    this.meta = { ...(options.meta || {}) };
    this.maxSeconds = Number.isFinite(options.maxSeconds) ? options.maxSeconds : 600;
    this.initialState = options.state || null;
    this.keyframes = [];
    this.events = [];
    this.eventIds = new Set();
    this.lastKeyframeTime = null;
    this.lastTime = null;
  }

  get frameCount() {
    return this.keyframes.length;
  }

  get duration() {
    if (this.keyframes.length < 2) return 0;
    return this.keyframes[this.keyframes.length - 1].time - this.keyframes[0].time;
  }

  sampleTime() {
    return this.lastTime;
  }

  pushEvents(events, maxTime) {
    for (const event of events) {
      if (!event) continue;
      if (maxTime !== null && (typeof event.time !== 'number' || event.time > maxTime)) continue;
      if (event.id !== undefined) {
        if (this.eventIds.has(event.id)) continue;
        this.eventIds.add(event.id);
      }
      this.events.push({ ...event });
    }
  }

  frame(state, events = []) {
    this.lastTime = state?.time ?? this.lastTime;
    const hasTime = !!state && typeof state.time === 'number';
    const first = this.keyframes[0];
    if (hasTime && this.maxSeconds > 0 && first && state.time - first.time > this.maxSeconds) {
      this.pushEvents(events, first.time + this.maxSeconds);
      return false;
    }
    this.pushEvents(events, null);
    if (!hasTime) return false;
    const interval = 1 / this.recordHz;
    if (this.lastKeyframeTime === null || state.time - this.lastKeyframeTime >= interval - 1e-9) {
      this.keyframes.push({ time: state.time, state: cloneRounded(state) });
      this.lastKeyframeTime = state.time;
      return true;
    }
    return false;
  }

  finish(meta = {}) {
    const first = this.keyframes[0];
    const source = first ? first.state : this.initialState;
    return {
      version: DEMO_VERSION,
      createdAt: meta.createdAt || new Date().toISOString(),
      header: demoHeader(source),
      meta: { ...this.meta, ...meta },
      keyframes: this.keyframes,
      events: this.events,
    };
  }
}

export class DemoPlayer {
  constructor(demo) {
    this.demo = demo || {};
    this.keyframes = Array.isArray(this.demo.keyframes) ? this.demo.keyframes : [];
    this.events = Array.isArray(this.demo.events) ? this.demo.events : [];
  }

  get duration() {
    if (this.keyframes.length < 2) return 0;
    return this.keyframes[this.keyframes.length - 1].time - this.keyframes[0].time;
  }

  get header() {
    return this.demo.header || null;
  }

  get frameCount() {
    return this.keyframes.length;
  }

  sample(time) {
    if (this.keyframes.length === 0) return null;
    const first = this.keyframes[0];
    const last = this.keyframes[this.keyframes.length - 1];
    const duration = this.duration;
    let requested = Number.isFinite(time) ? time : 0;
    if (requested < 0) requested = 0;
    if (requested > duration) requested = duration;
    const absolute = first.time + requested;
    if (this.keyframes.length === 1) {
      const only = clonePlain(first.state);
      only.time = requested;
      return only;
    }
    let k0 = first;
    let k1 = last;
    for (let i = 1; i < this.keyframes.length; i++) {
      if (this.keyframes[i].time >= absolute) {
        k0 = this.keyframes[i - 1];
        k1 = this.keyframes[i];
        break;
      }
    }
    const span = k1.time - k0.time;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (absolute - k0.time) / span)) : 0;
    const out = clonePlain(k0.state);
    interpolate(out, k1.state, alpha);
    out.time = requested;
    return out;
  }

  eventsBetween(t0, t1) {
    return this.events
      .filter(event => typeof event.time === 'number' && event.time > t0 && event.time <= t1)
      .sort((a, b) => a.time - b.time)
      .map(event => ({ ...event }));
  }

  nextEventTime(afterTime) {
    let best = null;
    for (const event of this.events) {
      if (typeof event.time !== 'number' || event.time <= afterTime) continue;
      if (best === null || event.time < best) best = event.time;
    }
    return best;
  }
}

export function serializeDemo(demo) {
  return JSON.stringify(demo);
}

export function parseDemo(textOrBytes) {
  let text;
  if (typeof textOrBytes === 'string') text = textOrBytes;
  else if (textOrBytes instanceof Uint8Array) text = new TextDecoder().decode(textOrBytes);
  else throw new Error('parseDemo expects a JSON string or Uint8Array');
  let demo;
  try {
    demo = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid demo JSON: ${error.message}`);
  }
  if (!demo || typeof demo !== 'object') throw new Error('Invalid demo payload');
  if (demo.version !== DEMO_VERSION) throw new Error(`Unsupported demo version: ${demo.version}`);
  return demo;
}

export async function compressDemo(demo) {
  const bytes = new TextEncoder().encode(serializeDemo(demo));
  if (typeof CompressionStream === 'undefined') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return readStream(stream);
}

export async function decompressDemo(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('gzip demo requires DecompressionStream');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
    return parseDemo(await readStream(stream));
  }
  return parseDemo(data);
}

export function trimDemo(demo, maxSeconds) {
  const frames = Array.isArray(demo?.keyframes) ? demo.keyframes : [];
  const events = Array.isArray(demo?.events) ? demo.events : [];
  if (frames.length === 0) return { ...demo, keyframes: [], events: clonePlain(events) };
  const start = frames[0].time;
  const cutoff = start + Math.max(0, Number.isFinite(maxSeconds) ? maxSeconds : 0);
  const keyframes = frames.filter(frame => frame.time <= cutoff);
  if (keyframes.length === 0) keyframes.push(frames[0]);
  return {
    ...demo,
    keyframes: clonePlain(keyframes),
    events: clonePlain(events.filter(event => typeof event.time !== 'number' || event.time <= cutoff)),
  };
}
