# Graphics lab · developer preview

Open **Graphics & settings → Graphics lab · Preview**. During a match, pause
first, then open Graphics & settings. The side drawer exposes the live world;
on portrait screens it becomes a bottom sheet. Closing it keeps the effects on.

This is an opt-in art-direction preview, off by default. Preferences are saved
on this device under `token-arena-graphics-lab-v1`.

## Hotkeys

- **` (backquote)** — toggle the lab on/off instantly from anywhere, including
  mid-match, with a short banner that names the current mix. This is the fast
  A/B; it never pauses, never opens a menu, and never types into a field.
- **Shift + `** — open or close this drawer from anywhere. While playing it
  releases the pointer through the normal Settings surface, so the world keeps
  rendering behind the drawer for live comparison.

Both keys are ignored while a text field, chat or the command board owns input.

## Try these first

| Recipe | Direction |
|---|---|
| Circuit Print | Posterized color, halftone dots, violet/coral/mint palette, ink contours |
| Neon Cathedral | Dark surfaces with cyan contrast traces, soft light bleed, prism split |
| Pocket Arena | Chunky pixels, pine/moss/lime palette, ordered dithering |
| Field Sketch | Warm paper palette, crosshatching, grain, ink |
| Ghost Signal | Cyan phosphor, stationary scanlines/grille, subtle channel separation |
| Ember Press | Plum/vermilion/gold science-fiction paperback treatment |
| Blueprint | Navy drafting field, steel ink contours, white margin falloff |
| Thermal | Infrared recon: hot edges, solarized highlights, video gain |
| Moth Print | Baked Moth grain, signal glyphs and an iridescent spectral coat |

Loading a recipe replaces the current mix. After that, every layer is
independently switchable. The catalogue has 23 layers:

- **Geometry and light:** pixel mosaic, hex mosaic, row glitch, prism split,
  light bleed, vignette.
- **Color:** contrast, saturation, white balance, sharpen, solarize, color
  bands, palette remap.
- **Print and screen:** halftone dots, crosshatch, ink contours, neon contours,
  ordered dither, phosphor screen, paper grain.
- **Moth assets:** Moth grain, signal glyphs, spectral coat — built from baked
  Moth assets. Each of the three has an asset picker: grain can use the
  `macro-organic` tile or the quantum `dust-field`/`flow-field`; signals can use
  the `arc-burst` frame or the QRC `qrc-glyphs` frame; the spectral coat can use
  any of the five entanglement LUTs (`entanglement`, `-arcane`, `-ember`,
  `-ceramic`, `-void`). A missing asset silently no-ops that one layer, and the
  drawer says so when the baked registry is inactive.

Each layer has its own parameter. The rest of the controls:

- **Enable graphics lab:** master on/off, retaining the chosen layers.
- **Surprise me:** roll a new mix. About half the rolls start from a starting
  recipe with jittered values and the rest freeform; every roll is a valid,
  immediately usable stack. Press again to keep rolling.
- **Overall mix:** blend the shader result with the original world.
- **A/B · Show original:** bypass without losing your recipe.
- **Split comparison:** original on the left, styled on the right; adjustable divider.
- **Previous / next look:** cycle through the starting recipes.
- **Copy recipe:** put the JSON on the clipboard, ready to paste into a chat or
  a note. **Paste a recipe JSON:** apply a recipe back verbatim — this is the
  tuning loop.
- **Export recipe:** download JSON to keep or share your preferred settings.
- **Reset all / off:** restore the original world and clear the layer choices.

Bypass and split comparison are transient and do not persist on reload. Recipe
controls, palette, mix, and master state do persist. If browser storage is
unavailable, the drawer says that the mix lasts only for the current visit.

## Render contract

The existing EffectComposer owns the pipeline. The lab is one fused GLSL
ShaderPass after OutputPass and FXAA, operating on display-space RGB. Effect
switches and sliders change uniforms; switching individual layers does not
compile extra shaders or render the scene more than once. Ink and neon share
their Sobel samples. Light bleed uses eight short-radius bright-neighbor reads;
it is a compact local glow rather than a replacement for multiscale bloom.
Sharpen and prism split add four and two reads. The three Moth-asset layers
read up to three small baked textures that are created once, cached for the
page, and never re-uploaded.

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
actual GPU shader and proves every catalogue layer (including the Moth-asset
layers), every starting recipe, and the full stack change pixels. It verifies
zero-mix and the original half of split mode match exactly and all combinations
reuse one shader program. It then exercises the actual UI: recipes, randomizer,
layer stacking, A/B bypass, split comparison, clipboard copy, JSON apply,
hotkeys, reset, persistence, and drawer layout at the five required
viewport/UI-scale cases. Screenshots/results land in ignored
`artifacts/graphics-lab/`. This harness imports source modules through Vite and
therefore targets a dev preview, not a production server.

For the Moth material work behind these effects—material variants, coordinated
surface wear, and less tiling—see the
[Moth graphics plan](design/MOTH-GRAPHICS-PLAN.md).
