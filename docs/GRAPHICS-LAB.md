# Graphics lab · developer preview

Open **Graphics & settings → Graphics lab · Preview**. During a match, pause
first, then open Graphics & settings. The side drawer exposes the live world;
on portrait screens it becomes a bottom sheet. Closing it keeps the effects on.

This is an opt-in art-direction preview, off by default. Preferences are saved
on this device under `token-arena-graphics-lab-v1`.

## Try these first

| Recipe | Direction |
|---|---|
| Circuit Print | Posterized color, halftone dots, violet/coral/mint palette, ink contours |
| Neon Cathedral | Dark surfaces with cyan contrast traces, soft light bleed, prism split |
| Pocket Arena | Chunky pixels, pine/moss/lime palette, ordered dithering |
| Field Sketch | Warm paper palette, crosshatching, grain, ink |
| Ghost Signal | Cyan phosphor, stationary scanlines/grille, subtle channel separation |
| Ember Press | Plum/vermilion/gold science-fiction paperback treatment |

Loading a recipe replaces the current mix. After that, every layer is
independently switchable: pixel mosaic, prism split, light bleed, color bands,
palette remap, print dots, crosshatch, ink contours, neon contours, ordered
dither, phosphor screen, and paper grain. Each has its own parameter.

- **Enable graphics lab:** master on/off, retaining the chosen layers.
- **Overall mix:** blend the shader result with the original world.
- **A/B · Show original:** bypass without losing your recipe.
- **Split comparison:** original on the left, styled on the right; adjustable divider.
- **Previous / next look:** cycle through the starting recipes.
- **Export recipe:** download JSON to keep or share your preferred settings.
- **Reset all / off:** restore the original world and clear the layer choices.

Bypass and split comparison are transient and do not persist on reload. Recipe
controls, palette, mix, and master state do persist. If browser storage is
unavailable, the drawer says that the mix lasts only for the current visit.

## Render contract

The existing EffectComposer owns the pipeline. The lab is one fused GLSL
ShaderPass after OutputPass and FXAA, operating on display-space RGB. Effect
switches and sliders change uniforms; switching individual layers does not
compile twelve shaders or render the scene twelve times. Ink and neon share
their Sobel samples. Light bleed uses eight short-radius bright-neighbor reads;
it is a compact local glow rather than a replacement for multiscale bloom.

The lab styles the world, including the menu's arena showcase. DOM HUD text,
reticle, and the isolated first-person weapon remain crisp; the standalone
loadout model is not the material preview target. Patterns use CSS-pixel scale
and no time uniform, so DPR/resolution changes do not alter their intended size
and reduced-motion users receive stationary effects. No shader runs in the CPU
software fallback; the drawer reports that WebGL is required.

Color bands are image posterization, not a change to the lighting BRDF. Contours
are contrast-based, not hidden-object/depth outlines. These intentionally strong
experiments can alter team colors and darken detail: they are selectable preview
looks, not an approved competitive palette.

## Verification

```bash
node --test game/graphics-lab.test.mjs game/post.test.mjs
npm run dev -- --host 0.0.0.0 --port 4173
# In another terminal, with the dev server running:
npm run test:graphics-lab
```

The graphics harness renders a deterministic color/checker fixture through the
actual GPU shader and proves all twelve effects, all six recipes, and the full
stack change pixels. It verifies zero-mix and the original half of split mode
match exactly and all combinations reuse one shader program. It then exercises
the actual UI, stacking, bypass, reset, persistence, and drawer layout at the
five required viewport/UI-scale cases. Screenshots/results land in ignored
`artifacts/graphics-lab/`. This harness imports source modules through Vite and
therefore targets a dev preview, not a production server.

For the researched next step—richer Moth material families, coordinated surface
wear, and less tiling—see [Moth graphics plan](design/MOTH-GRAPHICS-PLAN.md).
That plan also records the API references behind these art-direction options.
