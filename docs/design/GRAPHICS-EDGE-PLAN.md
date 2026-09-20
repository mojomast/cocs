# Graphics edge: research notes and applied improvements

**Date:** 2026-09-20
**Scope:** a best-practice pass over the WebGL renderer, and the concrete changes
that came out of it. Companion to [MOTH-GRAPHICS-PLAN.md](MOTH-GRAPHICS-PLAN.md)
(materials) and [../GRAPHICS-LAB.md](../GRAPHICS-LAB.md) (art-direction preview).

## Sources reviewed

1. [The Complete Guide to Three.js Post-Processing in 2026](https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026)
   — pass ordering, MRT, why `EffectComposer` re-renders for auxiliary buffers,
   and the WebGPU/`RenderPipeline` direction.
2. [Three.js manual: Post-Processing with WebGPURenderer](https://threejs.org/manual/en/webgpu-postprocessing.html)
   — tone mapping/color-space placement, MRT packing, FXAA in sRGB.
3. [100 Three.js Tips That Actually Improve Performance (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
   — shadow budgeting, tone mapping at pipeline end, capping pixel ratio,
   instancing/batching, baking static lighting, profiling.
4. [mrdoob/three.js post-processing pipeline reference](https://deepwiki.com/mrdoob/three.js/3.6-post-processing-pipeline)
   — built-in passes (SSAO/SAO/GTAO, SSR, SMAA, TRAA) and their inputs.
5. [Post-Processing Effects for Web Games](https://www.abratabia.com/game-shaders/post-processing.php)
   — SSAO costs and bilateral blur, LUT grading, half-resolution effects and
   the ≤4–5 ms post budget.
6. [Post-Processing Effects in Three.js](https://www.mysimulator.uk/content/tutorials/post-processing-threejs.html)
   — recommended order (scene → AO → bloom → grade/grain/vignette → AA →
   output), FXAA resolution uniforms, toggling vs rebuilding passes.
7. [three.js discourse: GLTF banding](https://discourse.threejs.org/t/gltf-smooth-white-surface-shows-contour-banding-rings-in-lit-areas/89873)
   and [Color banding issue](https://discourse.threejs.org/t/color-banding-issue/74177)
   — 8-bit sRGB has no more values to give; dithering (and shadow bias) are the
   fixes, not more geometry.
8. [Soft shadows in three.js](https://threejsdemos.com/demos/lighting/soft-shadows)
   and [shadow map comparison](https://threejsdemos.com/demos/rendering/shadowmap-types)
   — PCFSoft vs VSM tradeoffs and frustum/bias tuning.

## Audit: what this renderer already does right

- `ACESFilmicToneMapping`, exposure 1.2, `outputColorSpace = SRGBColorSpace`.
- `PCFSoftShadowMap`, tiered shadow map size (1024/1536/2048), tuned bias and
  normalBias, shadow refresh at 20–30 Hz instead of every frame.
- PMREM `RoomEnvironment` for image-based ambient/reflections.
- Correct composer order: scene → bloom → vignette → `OutputPass` → FXAA.
- Bloom at a budgeted half/quarter resolution; FXAA resolution uniforms updated
  on resize; dynamic resolution and a quality governor.
- Moth material sampling policy (mips + anisotropy) and structure-preserving
  wear; baked skies and a full art-direction lab.

## What the research says is missing here

1. **8-bit banding.** Smooth gradients (sky, fog, ground wash) have no more
   sRGB values; the fix is dithering at the very end of the chain. Static noise
   is preferred over animated grain so nothing shimmers.
2. **Sharpness recovery.** FXAA softens fine detail, and the game currently has
   no counter-sharpen. A low-amplitude, contrast-adaptive unsharp after FXAA is
   the cheap standard fix.
3. **Environment contribution is conservative** (intensity 0.5), leaving metals
   flatter than the tier could afford.
4. **No ambient occlusion.** SSAO/GTAO would need normals (a second scene
   render with `EffectComposer`, or MRT on the WebGPU path) and 1.5–3 ms per
   frame; rejected below.

## Applied in this pass

Post-processing in this game is opt-in (`postFx` and `bloom` default to off and
0 for a performance-first baseline), so these improvements activate whenever a
composer exists: the player's Post-processing toggle, or the graphics lab,
which brings its own composer. They never change the direct-render path.

- **`game/finish-pass.mjs`** — one fused pass after FXAA (and after the lab
  pass when the lab is on):
  - static triangular dither at ≤1/255, applied in display space where banding
    actually happens, identical on every frame;
  - contrast-adaptive unsharp (5-tap, clamped detail) for crispness, off on the
    low tier so weak GPUs pay nothing;
  - no extra render targets, no history, no time uniforms; ~0.1–0.3 ms.
- **Tier wiring** in `game/post.mjs`: `dither` on all tiers; `sharpen` 0 for
  low, 0.28 medium, 0.34 high; `environment` intensity 0.4/0.5/0.6.
- **`view.mjs`**: the finish pass joins the composer, is keyed into `_postKey`,
  resizes with the composer, and is disposed with it. Reduced motion keeps the
  existing no-post behavior.

## Deliberately not applied

- **SSAO / GTAO**: needs a normal buffer or MRT; with `EffectComposer` that is a
  second full scene render (~2× draw cost) for a subtle effect in a fast arena
  shooter. Revisit only if the renderer moves to `WebGPU`/`RenderPipeline`.
- **TAA / TRAA**: history buffers and ghosting on fast camera motion; wrong
  trade for a competitive shooter, and reduced-motion users would still see
  reprojection artifacts.
- **Depth of field, motion blur**: hurt target readability and competitive
  fairness.
- **Cascaded shadow maps**: the arena fits one directional frustum today; the
  shadow camera already tracks arena bounds.
- **Baked lightmaps**: arenas are dynamic and procedurally built.
- **WebGPU migration**: promising (MRT, native SSAO/SSR nodes), but WebGL2 is
  the shipping target and a migration is a separate project.

## Verification

- Node tests for the finish pass (uniforms, clamping, shader content).
- A/B screenshots of the same frame with the pass off/on, to confirm smoother
  gradients and no halo artifacts.
- The existing graphics-lab GPU/UI harness and the browser matrix must stay
  green; the pass only runs when post-processing already runs.
