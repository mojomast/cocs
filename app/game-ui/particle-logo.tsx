'use client';
import {useEffect, useRef} from 'react';
import {createLogoParticles,particleAlpha,sampleMaskTargets,stepLogoParticles} from '../../game/particle-logo.mjs';

// Lightweight title mark: the DOM glyphs are rasterised once, sampled into a
// small particle field (700-2200), and drawn as pre-rendered glow sprites on a
// 2D canvas. No WebGL context, no shader compilation, a capped 30 fps and a
// visibility pause keep it cheap; the DOM logo stays as the fallback and is
// only hidden after the first frame. The simulation itself is the shared pure
// particle-logo module, so assembly, wake and pointer behaviour are unchanged.
export function ParticleLogo({label = 'COCS'}: {label?: string}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host || typeof window === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0, observer: ResizeObserver | null = null, disposed = false, ready = false, lastFrame = 0, started = 0;
    let state: ReturnType<typeof createLogoParticles> | null = null;
    let spriteA: HTMLCanvasElement | null = null, spriteB: HTMLCanvasElement | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const pointer = {x: 0, y: 0, active: false};

    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true || host.closest('.motion-reduced') !== null;

    // A one-time 18 px glow sprite in two tints; every particle is one drawImage.
    const makeSprite = (color: string) => {
      const sprite = document.createElement('canvas');
      const size = 18;
      sprite.width = size; sprite.height = size;
      const sctx = sprite.getContext('2d');
      if (!sctx) return null;
      const grad = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, color);
      grad.addColorStop(.35, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, size, size);
      return sprite;
    };

    const rasterise = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 40) return null;
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.max(2, Math.round(rect.width * scale)), h = Math.max(2, Math.round(rect.height * scale));
      const mask = document.createElement('canvas');
      mask.width = w; mask.height = h;
      const mctx = mask.getContext('2d', {willReadFrequently: true});
      if (!mctx) return null;
      mctx.clearRect(0, 0, w, h);
      mctx.fillStyle = '#ffffff';
      const local = (node: Element) => {
        const r = node.getBoundingClientRect();
        return {x: (r.left - rect.left) * scale, y: (r.top - rect.top) * scale, w: r.width * scale, h: r.height * scale};
      };
      for (const glyph of host.querySelectorAll('.logo-glyph')) {
        const box = local(glyph), style = getComputedStyle(glyph);
        const letter = [...glyph.childNodes].find(node => node.nodeType === 3 && node.textContent?.trim()) as Text | undefined;
        const size = parseFloat(style.fontSize) || box.h * .8;
        mctx.font = `${style.fontWeight || 900} ${size * scale}px ${style.fontFamily || 'Impact, sans-serif'}`;
        mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
        // `.logo-glyph` is exactly the clipped letter box, so its centre is the
        // reliable anchor; range boxes are line boxes and include leading.
        mctx.fillText(letter?.textContent || glyph.textContent || '', box.x + box.w / 2, box.y + box.h / 2 + box.h * .03);
        const dot = glyph.querySelector('.logo-dot');
        if (dot) {
          const d = local(dot);
          mctx.beginPath();
          mctx.arc(d.x + d.w * .5, d.y + d.h * .58, Math.max(1.4, d.h * .17) * scale, 0, Math.PI * 2);
          mctx.fill();
        }
      }
      const image = mctx.getImageData(0, 0, w, h);
      // A 2D field stays light: ~700-2200 particles instead of thousands.
      const budget = Math.round(Math.max(700, Math.min(2200, rect.width * rect.height / 120)));
      const targets = sampleMaskTargets(image.data, w, h, {max: budget, threshold: 100, seed: 13});
      if (!targets.count || targets.count < 300) return null;
      if (scale !== 1) for (let i = 0; i < targets.count; i++) { targets.x[i] /= scale; targets.y[i] /= scale; }
      return {rect, targets};
    };

    const build = () => {
      const sampled = rasterise();
      if (!sampled) return false;
      const {rect, targets} = sampled;
      state = createLogoParticles(targets, {width: rect.width, height: rect.height, seed: 23, streamRatio: .18, dustRatio: .06});
      canvas.dataset.particles = String(state.count);
      spriteA = makeSprite('#eafff5') ?? spriteA;
      spriteB = makeSprite('#57e3c6') ?? spriteB;
      if (!spriteA || !spriteB) return false;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(2, Math.round(rect.width * dpr));
      canvas.height = Math.max(2, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const draw = (time: number) => {
      if (!state || !spriteA || !spriteB) return;
      const width = state.width, height = state.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < state.count; i++) {
        const alpha = particleAlpha(state, i, time);
        if (alpha <= .015) continue;
        const size = 3 + state.seedA[i] * 3.8;
        ctx.globalAlpha = Math.min(.95, alpha);
        ctx.drawImage(state.seedA[i] > .5 ? spriteA : spriteB, state.px[i] - size / 2, -state.py[i] - size / 2, size, size);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    const frame = (now: number) => {
      if (disposed || !state) return;
      if (document.hidden) { raf = 0; return; }
      // Capped to ~30 fps: the mark stays lively without a per-frame cost.
      if (now - lastFrame < 32) { raf = requestAnimationFrame(frame); return; }
      const rawDt = Math.min(.25, Math.max(0, (now - lastFrame) / 1000) || .016);
      lastFrame = now;
      const time = (now - started) / 1000;
      const still = reduced();
      const steps = still ? 1 : Math.max(1, Math.min(6, Math.round(rawDt / .0166)));
      const dt = still ? 0 : rawDt / steps;
      for (let s = 0; s < steps && state; s++) {
        stepLogoParticles(state, dt, {time, pointer: pointer.active && !still ? pointer : null, pointerRadius: Math.max(60, state.height * .45), reduced: still});
      }
      draw(time);
      if (!ready) {
        ready = true;
        host.classList.add('has-particle-logo');
        canvas.style.opacity = '1';
      }
      if (!still) raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 40) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed) return;
        // Cancel any live loop before rebuilding: overwriting `raf` without
        // cancelling would leave the old chain running alongside the new one.
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        state = null;
        if (build()) { started = performance.now(); lastFrame = started; if (reduced()) frame(started); else raf = requestAnimationFrame(frame); }
        else { host.classList.remove('has-particle-logo'); canvas.style.opacity = '0'; }
      }, 180);
    };

    const move = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      pointer.x = event.clientX - box.left - box.width / 2;
      pointer.y = box.height / 2 - (event.clientY - box.top);
      pointer.active = true;
    };
    const leave = () => { pointer.active = false; };
    // Hidden tabs stop the loop entirely instead of ticking a no-op callback.
    const visibility = () => {
      pointer.active = false;
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; return; }
      if (!disposed && state && !reduced() && !raf) { lastFrame = performance.now(); raf = requestAnimationFrame(frame); }
    };

    if (!build()) return;
    started = performance.now();
    lastFrame = started;
    if (reduced()) frame(started); else raf = requestAnimationFrame(frame);
    // The display font can finish loading after the first raster; rebuild once so
    // the field matches the rendered glyphs exactly.
    try { document.fonts?.ready?.then(() => { if (!disposed) resize(); }); } catch {}

    window.addEventListener('pointermove', move, {passive: true});
    window.addEventListener('blur', leave);
    document.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', visibility);
    if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(resize); observer.observe(host); }
    else window.addEventListener('resize', resize);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', leave);
      document.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', visibility);
      host.classList.remove('has-particle-logo');
      state = null;
      spriteA = null; spriteB = null;
    };
  }, [label]);

  return <canvas ref={canvasRef} className="particle-logo-canvas" aria-hidden="true" style={{opacity: 0}}/>;
}
