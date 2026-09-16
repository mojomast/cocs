// Frame-time accounting and a reproducible benchmark preset.
//
// CPU submission time is measured with `performance.now()` around the phases the
// host controls (simulation, snapshot/recording, render submission). GPU timings
// are only ever populated from an asynchronous timer query; the CPU number is
// never relabeled as GPU time.

import {createFrameWindow, pushFrameTime, framePercentiles} from './post.mjs';

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export class PerfTracker {
  constructor({ window = 120 } = {}) {
    this.frames = 0;
    this.lastFrameAt = 0;
    this.frameWindow = createFrameWindow(window);
    this.phases = Object.create(null);
    this.gpu = null;
    this.enabled = false;
  }
  // Call once per presented frame with the current timestamp (ms).
  frame(at = nowMs()) {
    if (Number.isFinite(this.lastFrameAt) && this.lastFrameAt > 0) pushFrameTime(this.frameWindow, at - this.lastFrameAt);
    this.lastFrameAt = at;
    this.frames++;
    this.enabled = true;
  }
  // Time a synchronous block and accumulate it under `name`.
  time(name, fn) {
    const start = nowMs();
    try { return fn(); } finally { this.add(name, nowMs() - start); }
  }
  add(name, ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.phases[name] = (this.phases[name] || 0) + ms;
  }
  get(name) { return this.phases[name] || 0; }
  reset() {
    this.frames = 0;
    this.lastFrameAt = 0;
    this.frameWindow.values.length = 0;
    this.phases = Object.create(null);
    this.gpu = null;
  }
  // Asynchronous GPU timing is optional and only set by callers that actually
  // query it (WebGL timer extensions). Kept distinct from CPU phases on purpose.
  setGpu(ms) { this.gpu = Number.isFinite(ms) ? ms : null; }
  snapshot() {
    const [median, p95] = framePercentiles(this.frameWindow, [0.5, 0.95]);
    const frames = Math.max(1, this.frames);
    return {
      frames: this.frames,
      frameMs: { median, p95, last: this.frameWindow.values.at(-1) || 0 },
      fps: median > 0 ? 1000 / median : 0,
      cpu: {
        sim: this.get('sim'),
        scene: this.get('scene'),
        snapshot: this.get('snapshot'),
        render: this.get('render'),
        total: Object.values(this.phases).reduce((sum, value) => sum + value, 0),
        meanPerFrame: this.frames ? Object.values(this.phases).reduce((sum, value) => sum + value, 0) / frames : 0,
      },
      gpu: this.gpu,
    };
  }
  // Compact, copyable multi-line report for bug reports and benchmark runs.
  report(extra = {}) {
    const s = this.snapshot();
    const lines = [
      `COCS perf · ${s.frames} frames`,
      `frame ms: median ${s.frameMs.median.toFixed(2)} · p95 ${s.frameMs.p95.toFixed(2)} · last ${s.frameMs.last.toFixed(2)}`,
      `cpu ms total: sim ${s.cpu.sim.toFixed(1)} · scene ${s.cpu.scene.toFixed(1)} · snapshot ${s.cpu.snapshot.toFixed(1)} · render ${s.cpu.render.toFixed(1)}`,
      `gpu ms: ${s.gpu === null ? 'n/a (asynchronous timing not queried)' : s.gpu.toFixed(2)}`,
    ];
    for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${typeof value === 'number' ? value.toFixed(1) : String(value)}`);
    return lines.join('\n');
  }
}

// A fixed benchmark scenario: same map, seed, roster, weather and camera path
// every run, exercised once without post-processing and once with it on so the
// two are directly comparable. The world render resolution is never lowered.
export const BENCHMARK_PRESET = Object.freeze({
  mapId: 'crosswire',
  mode: 'deathmatch',
  seed: 12345,
  botCount: 8,
  difficulty: 'normal',
  weather: 'clear',
  durationSeconds: 20,
  cameraPath: Object.freeze([
    Object.freeze({ x: 0, y: 6, z: -16 }),
    Object.freeze({ x: 12, y: 5, z: 0 }),
    Object.freeze({ x: -10, y: 4, z: 12 }),
  ]),
  variants: Object.freeze([
    Object.freeze({ id: 'direct', postFx: false, bloom: 0 }),
    Object.freeze({ id: 'postfx', postFx: true, bloom: 0.5 }),
  ]),
});

export function benchmarkDisplay(variant) {
  return { postFx: variant?.postFx === true, bloom: Number(variant?.bloom) || 0, quality: 'high', resolutionScale: 1 };
}

export function benchmarkReport(results = []) {
  const lines = ['COCS benchmark', `preset: ${BENCHMARK_PRESET.mapId} · ${BENCHMARK_PRESET.botCount} bots · seed ${BENCHMARK_PRESET.seed} · ${BENCHMARK_PRESET.durationSeconds}s`];
  for (const result of results) {
    const stats = result?.stats || {};
    lines.push(`${result?.id || 'variant'}: median ${(stats.median || 0).toFixed(2)} ms · p95 ${(stats.p95 || 0).toFixed(2)} ms · calls ${result?.calls ?? 'n/a'} · tris ${result?.triangles ?? 'n/a'}`);
  }
  return lines.join('\n');
}

export const BENCHMARK_EXPORTS = Object.freeze(['PerfTracker', 'BENCHMARK_PRESET', 'benchmarkDisplay', 'benchmarkReport', 'GpuTimer']);

// Asynchronous GPU timing through the WebGL2 disjoint timer query extension.
// GPU time is only ever populated when the extension is genuinely available and
// a query result has come back; otherwise `latest()` stays null so a caller can
// never mistake a CPU estimate for a GPU measurement.
export class GpuTimer {
  constructor(renderer) {
    this.gl = null; this.ext = null; this.pending = null; this.queue = []; this.last = null; this.maxPending = 4;
    try { this.gl = renderer?.getContext?.() || null; this.ext = this.gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null; } catch { this.ext = null; }
  }
  get available() { return !!this.ext; }
  begin() {
    if (!this.ext || this.pending) return false;
    try { const q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.pending = q; return true; } catch { this.pending = null; return false; }
  }
  end() {
    if (!this.pending) return false;
    try { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.queue.push(this.pending); } catch {}
    this.pending = null;
    // Bound outstanding query resources so a renderer that never reports a result
    // cannot accumulate GPU queries without limit.
    while (this.queue.length > this.maxPending) { const stale = this.queue.shift(); try { this.gl.deleteQuery(stale); } catch {} }
    return true;
  }
  // Poll the oldest outstanding query. Returns the latest available elapsed
  // milliseconds, or null when nothing has resolved yet (or timing is absent).
  poll() {
    if (!this.ext) return null;
    try {
      const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (disjoint) { for (const q of this.queue) this.gl.deleteQuery(q); this.queue.length = 0; this.last = null; return null; }
      const q = this.queue[0];
      if (q && this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)) {
        this.last = this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6;
        this.gl.deleteQuery(q); this.queue.shift();
      }
    } catch { this.queue.length = 0; this.last = null; }
    return this.last;
  }
  dispose() {
    try { for (const q of this.queue) this.gl.deleteQuery(q); if (this.pending) this.gl.deleteQuery(this.pending); } catch {}
    this.queue.length = 0; this.pending = null; this.ext = null; this.gl = null;
  }
}
