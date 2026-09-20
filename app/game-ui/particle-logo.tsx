'use client';
import * as T from 'three';
import {useEffect, useRef} from 'react';
import {createLogoParticles,particleAlpha,sampleMaskTargets,stepLogoParticles} from '../../game/particle-logo.mjs';

// Renders the title logo as a point cloud over the live scene: the glyphs are
// rasterised once to an offscreen canvas, sampled into particle targets, and a
// small CPU simulation adds the drift, wake and pointer repulsion. The DOM
// glyphs stay in place for layout and assistive tech and are hidden only once
// the first frame has rendered, so a WebGL failure simply keeps the original
// logo. Reduced motion renders a single assembled frame and stops.
export function ParticleLogo({label = 'COCS'}: {label?: string}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host || typeof window === 'undefined') return;
    let renderer: T.WebGLRenderer | null = null;
    const disposables: Array<{dispose?: () => void}> = [];
    let raf = 0, observer: ResizeObserver | null = null, disposed = false, ready = false, lastFrame = 0;
    let state: ReturnType<typeof createLogoParticles> | null = null;
    let geometry: T.BufferGeometry | null = null;
    let material: T.ShaderMaterial | null = null;
    let points: T.Points | null = null;
    let scene: T.Scene | null = null, camera: T.OrthographicCamera | null = null;
    const pointer = {x: 0, y: 0, active: false};
    let started = 0, resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true || host.closest('.motion-reduced') !== null;
    const rasterise = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 40) return null;
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.max(2, Math.round(rect.width * scale)), h = Math.max(2, Math.round(rect.height * scale));
      const mask = document.createElement('canvas');
      mask.width = w; mask.height = h;
      const ctx = mask.getContext('2d', {willReadFrequently: true});
      if (!ctx) return null;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      const local = (node: Element) => {
        const r = node.getBoundingClientRect();
        return {x: (r.left - rect.left) * scale, y: (r.top - rect.top) * scale, w: r.width * scale, h: r.height * scale};
      };
      for (const glyph of host.querySelectorAll('.logo-glyph')) {
        const box = local(glyph), style = getComputedStyle(glyph);
        const letter = [...glyph.childNodes].find(node => node.nodeType === 3 && node.textContent?.trim()) as Text | undefined;
        const size = parseFloat(style.fontSize) || box.h * .8;
        ctx.font = `${style.fontWeight || 900} ${size * scale}px ${style.fontFamily || 'Impact, sans-serif'}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // `.logo-glyph` is exactly the clipped letter box, so its centre is the
        // reliable anchor; range boxes are line boxes and include leading.
        ctx.fillText(letter?.textContent || glyph.textContent || '', box.x + box.w / 2, box.y + box.h / 2 + box.h * .03);
        const dot = glyph.querySelector('.logo-dot');
        if (dot) {
          const d = local(dot);
          ctx.beginPath();
          ctx.arc(d.x + d.w * .5, d.y + d.h * .58, Math.max(1.4, d.h * .17) * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const image = ctx.getImageData(0, 0, w, h);
      const budget = Math.round(Math.max(4500, Math.min(9000, rect.width * rect.height / 10)));
      const targets = sampleMaskTargets(image.data, w, h, {max: budget, threshold: 100, strideStart: 1, seed: 13});
      if (!targets.count || targets.count < 600) return null;
      if (scale !== 1) for (let i = 0; i < targets.count; i++) { targets.x[i] /= scale; targets.y[i] /= scale; }
      if (typeof location !== 'undefined' && location.search.includes('particleDebug')) {
        canvas.dataset.mask = mask.toDataURL('image/png');
        let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
        for (let i = 0; i < targets.count; i++) { minX = Math.min(minX, targets.x[i]); maxX = Math.max(maxX, targets.x[i]); minY = Math.min(minY, targets.y[i]); maxY = Math.max(maxY, targets.y[i]); }
        canvas.dataset.bounds = [minX, minY, maxX, maxY].map(v => Math.round(v)).join(',');
        canvas.dataset.glyphs = String(host.querySelectorAll('.logo-glyph').length);
        const cols = new Array(16).fill(0), rows = new Array(8).fill(0);
        for (let i = 0; i < targets.count; i++) {
          cols[Math.min(15, Math.max(0, Math.floor((targets.x[i] + rect.width / 2) / rect.width * 16)))]++;
          rows[Math.min(7, Math.max(0, Math.floor((rect.height / 2 - targets.y[i]) / rect.height * 8)))]++;
        }
        canvas.dataset.cols = cols.join(',');
        canvas.dataset.rows = rows.join(',');
        const qa = document.createElement('canvas'); qa.width = Math.round(rect.width); qa.height = Math.round(rect.height);
        const qctx = qa.getContext('2d');
        if (qctx) {
          qctx.fillStyle = '#04121a'; qctx.fillRect(0, 0, qa.width, qa.height);
          qctx.fillStyle = '#8affd8';
          for (let i = 0; i < targets.count; i++) qctx.fillRect(Math.round(targets.x[i] + rect.width / 2), Math.round(rect.height / 2 - targets.y[i]), 2, 2);
          canvas.dataset.targetsUrl = qa.toDataURL('image/png');
        }
      }
      return {rect, targets};
    };

    const build = () => {
      const sampled = rasterise();
      if (!sampled) return false;
      const {rect, targets} = sampled;
      state = createLogoParticles(targets, {width: rect.width, height: rect.height, seed: 23});
      canvas.dataset.particles = String(state.count);
      scene = new T.Scene();
      camera = new T.OrthographicCamera(-rect.width / 2, rect.width / 2, rect.height / 2, -rect.height / 2, -400, 400);
      const positions = new Float32Array(state.count * 3);
      const alphas = new Float32Array(state.count);
      const seeds = new Float32Array(state.count);
      for (let i = 0; i < state.count; i++) {
        positions[i * 3] = state.px[i]; positions[i * 3 + 1] = state.py[i]; positions[i * 3 + 2] = state.pz[i];
        alphas[i] = particleAlpha(state, i, 0);
        seeds[i] = state.seedA[i];
      }
      geometry = new T.BufferGeometry();
      const posAttr = new T.BufferAttribute(positions, 3);
      posAttr.setUsage(T.DynamicDrawUsage);
      geometry.setAttribute('position', posAttr);
      geometry.setAttribute('aAlpha', new T.BufferAttribute(alphas, 1));
      geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 1));
      material = new T.ShaderMaterial({
        transparent: true, depthTest: false, depthWrite: false, blending: T.NormalBlending,
        uniforms: {
          uSize: {value: 1.7},
          uDpr: {value: renderer?.getPixelRatio() ?? 1},
          uColorA: {value: new T.Color('#f2fff9')},
          uColorB: {value: new T.Color('#4fe0c3')},
        },
        vertexShader: `attribute float aAlpha; attribute float aSeed; varying float vAlpha; varying float vSeed; uniform float uSize; uniform float uDpr;
          void main(){ vAlpha=aAlpha; vSeed=aSeed; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=uSize*uDpr*(0.55+aSeed*0.95)*(1.0/(1.0+(-mv.z)*0.006)); }`,
        fragmentShader: `uniform vec3 uColorA; uniform vec3 uColorB; varying float vAlpha; varying float vSeed;
          void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.06,d)*vAlpha; if(a<=0.004) discard; gl_FragColor=vec4(mix(uColorA,uColorB,vSeed),a); }`,
      });
      points = new T.Points(geometry, material);
      points.frustumCulled = false;
      scene.add(points);
      disposables.push(geometry, material);
      return true;
    };

    const frame = (now: number) => {
      if (disposed || !renderer || !state || !geometry || !scene || !camera) return;
      const time = (now - started) / 1000;
      const rawDt = Math.min(.25, Math.max(0, (now - lastFrame) / 1000) || .016);
      lastFrame = now;
      const still = reduced();
      // Run fixed-step substeps so the assembly speed does not depend on the
      // frame rate (a slow first frame still settles the logo promptly).
      const steps = still ? 1 : Math.max(1, Math.min(8, Math.round(rawDt / .0166)));
      const dt = still ? 0 : rawDt / steps;
      for (let s = 0; s < steps && state; s++) stepLogoParticles(state, dt, {time, pointer: pointer.active && !still ? pointer : null, pointerRadius: Math.max(80, state.height * .5), reduced: still});
      const live = state;
      const pos = geometry.getAttribute('position') as T.BufferAttribute;
      const alpha = geometry.getAttribute('aAlpha') as T.BufferAttribute;
      for (let i = 0; i < live.count; i++) {
        pos.setXYZ(i, live.px[i], live.py[i], live.pz[i]);
        alpha.setX(i, particleAlpha(live, i, time));
      }
      pos.needsUpdate = true; alpha.needsUpdate = true;
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        host.classList.add('has-particle-logo');
        canvas.style.opacity = '1';
      }
      if (!still) raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      if (!renderer || !host) return;
      const rect = host.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 40) return;
      renderer.setSize(rect.width, rect.height, false);
      if (camera) { camera.left = -rect.width / 2; camera.right = rect.width / 2; camera.top = rect.height / 2; camera.bottom = -rect.height / 2; camera.updateProjectionMatrix(); }
      // Geometry targets scale with the CSS box, so a resize rebuilds the cloud.
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed) return;
        disposeScene();
        if (build()) { started = performance.now(); lastFrame = started; if (reduced()) frame(started); else raf = requestAnimationFrame(frame); }
      }, 180);
    };
    const disposeScene = () => {
      if (points && scene) scene.remove(points);
      points = null;
      for (const item of disposables.splice(0)) { try { item.dispose?.(); } catch {} }
      geometry = null; material = null; state = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    try {
      renderer = new T.WebGLRenderer({canvas, alpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: true});
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    } catch { renderer = null; }
    if (!renderer) return;

    if (!build()) { try { renderer.dispose(); } catch {} return; }
    const rect = host.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    started = performance.now();
    lastFrame = started;
    if (reduced()) frame(started); else raf = requestAnimationFrame(frame);
    // The display font can finish loading after the first raster; rebuild once
    // it is ready so the particle glyphs match the rendered logo exactly.
    try { document.fonts?.ready?.then(() => { if (!disposed) resize(); }); } catch {}

    const move = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      pointer.x = event.clientX - box.left - box.width / 2;
      pointer.y = box.height / 2 - (event.clientY - box.top);
      pointer.active = true;
    };
    const leave = () => { pointer.active = false; };
    window.addEventListener('pointermove', move, {passive: true});
    window.addEventListener('blur', leave);
    document.addEventListener('pointerleave', leave);
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
      host.classList.remove('has-particle-logo');
      disposeScene();
      try { renderer?.dispose(); } catch {}
      renderer = null;
    };
  }, [label]);

  return <canvas ref={canvasRef} className="particle-logo-canvas" aria-hidden="true" style={{opacity: 0}}/>;
}
