# Phase 2 materials handoff

Workstream: procedural materials, PBR presets, Moth anti-tiling and environment
palettes. Branch `improvement/phase2-audio-visual`, worktree
`/home/mojo/projects/tokenarena-phase2`.

One writer per file. This workstream owns and changed only:

- `game/textures.mjs`
- `game/moth-surface.mjs`
- `game/environment.mjs`
- `game/textures.test.mjs`, `game/moth-surface.test.mjs`, `game/environment.test.mjs`
- this document

`game/view.mjs`, `app/**` and every other file were intentionally left alone.

---

## 1. What changed

### `game/textures.mjs` — natural surfaces

The generic (non-pattern) surface path was rewritten around **one shared,
multi-scale height/wear field per tile**:

- Three detail scales plus domain warp: a broad `macro` weathering blotch, a
  warped meso `base`, a fine `tooth`, and a per-pixel micro grain. The meso
  field is warped by a second noise sample, so features bend instead of
  marching in straight noise rows. The fine grain is capped at two texels per
  cell so it stays material tooth instead of aliasing at small tile sizes.
- **Periodic noise** (`pnoise`/`pfbm`): the integer lattice wraps at the tile
  edge, so `repeat` tiling is seamless. Measured edge-step ratio dropped from
  **3.8–11.3× a normal texel step (visible seams) to ~0.74–0.95×** on natural
  kinds.
- Albedo, roughness and the tangent-space normal are all derived from that one
  field. The normal is a one-texel forward difference of the same array, so a
  pit in the albedo has matching relief and roughness. The pinned coherence
  test still passes with margin: concrete albedo/roughness luminance
  correlation **r = 0.874** (threshold `> 0.75`), other natural kinds 0.84–0.91.
- Weathering is data-driven per kind (`stain`, `streak`, `dust`,
  `temperature` in `LAYERS`): damp/dirt patches, vertical wash marks from
  gravitational water, dry deposits, and a warm/cool channel drift tied to the
  macro field. All ride the same field family as the height, so weathering
  reads as part of the material rather than a decal layer.
- Normal maps now carry real relief instead of being flat: raw R-channel std
  went from **~0.007 to 0.08–0.23** on natural kinds, with 0% clipped texels on
  concrete and < 1% on most kinds (weathered concrete ~9% at crack edges,
  which is intentional).
- `weathered_concrete` now uses one coherent crack/aggregate height field for
  albedo, roughness and normal, with crack edges, damp stains and run-off
  streaks. `rough_stucco` gained broad trowel patches over the pebble field.
  `corrugated_metal` rusts in rain-collecting troughs and polishes the exposed
  crests.
- Grid/structural kinds (`hazard_stripes`, `hex_paneling`, `circuit_board`,
  `metal_grating`, `diamond_plate`, `industrial_mesh`, `carbon_fiber`,
  `riveted_armor`, `brushed_metal`, `holographic_grid`, `alien_chitin`) keep
  their pattern generators, `canonicalTextureKind` aliases, cache keys and
  disposal semantics unchanged.

`surfaceTextures(kind, options)` keeps its exact contract (options, returned
`{map, roughnessMap, normalMap, bumpMap}`, `userData.surfaceKind`, cache key
`kind|size|seed|repeat|normal|roughness|bump`, `clearSurfaceTextures`
exactly-once disposal). `wetSheenTexture` is unchanged. Nothing here needs
WebGL: the software renderer still skips textures as before.

### `game/textures.mjs` — `MATERIAL_PRESETS`

Values moved to physically plausible ranges. Names, freezing and the
`materialPreset(name) -> paintedArmor` fallback are unchanged.

| preset | before | after | rationale |
| --- | --- | --- | --- |
| `paintedArmor` | .14 / .55 | **.08 / .58** | paint is a dielectric layer over metal |
| `exposedSteel` | .90 / .34 | **.95 / .30** | near-bare metal, tight highlight |
| `rubber` | .05 / .92 | **.03 / .94** | dielectric, very rough |
| `stone` | .02 / .95 | **.01 / .96** | dielectric, unpolished |
| `energy` | .20 / .30 / 1.6 | **.08 / .32 / 1.9** | emissive dielectric core, not a metal |
| `entanglement` | .62 / .12 / .7 | **.68 / .10 / .8** | sharp metallic LUT film |

No code imports `MATERIAL_PRESETS` yet; they are ready for the lead to wire
into `view.mjs` material creation.

### `game/moth-surface.mjs` — macro/fracture

- The uniform macro noise was replaced with a **two-scale region field**
  (`mothNoise(p) * .72 + mothNoise(p * .37 + offset) * .28`) so large surfaces
  get patchy regions rather than one uniform octave mix.
- Added a ridged `mothRidge` layer (two ridged octaves) masked by the region
  field (`smoothstep(0.3, 0.74, region)`), so fracture detail concentrates in
  raised/worn patches instead of covering everything uniformly.
- New `fractureStrength` per kind (`mothSurfaceBreakConfig` now returns it),
  new `enhanceMothMaterial(..., { fractureStrength })` option, new live setter
  `material.userData.setMothFractureStrength(v)` and uniform
  `uMothFractureStrength`. Defaults: rock .55, weathered_concrete .55,
  alien_chitin .42, concrete .5, rough_stucco .35, grass/ice .3, metal .25,
  sand .2.
- `MOTH_GRID_KINDS`, the grid no-op, `customProgramCacheKey` semantics, the
  injected marker, `vMothWorld`/`vMapUv` usage and `updateMothSurface` are
  unchanged. The rotated second map sample (`breakScale`/`breakStrength`) is
  unchanged.

### `game/environment.mjs` — sky / time-of-day / fog / ambience

- `skyPalette(background, phase)` returns the same keys/hex format but with
  natural cinematic targets:
  - **day**: saturated blue zenith over a warm dust haze horizon, warm disk
    glow.
  - **dusk**: violet zenith, burnt-orange horizon, thicker warm haze band,
    larger sun glow.
  - **night**: near-black indigo zenith, faint cool airglow at the horizon,
    near-black ground (no hard black sky edge).
- `skyGradientAt` eases slightly more steeply into the zenith and uses a
  thicker, stronger near-horizon haze band (`1 - u/.26`, ×.32). Clamping and
  finiteness are unchanged; the pinned "zenith brighter than horizon for the
  day palette on a dark background" relation still holds.
- `addSky` haze-band opacity is now phase-aware (dusk .26 / day .16 / night
  .09), and the dusk sun glow is larger and slightly stronger. No signature
  change.
- `addMountains` blends less background haze into distant ridges
  (16–48% instead of 35–75%), so the backdrop keeps silhouette and depth
  instead of washing out.
- Ambient motes and weather tints were moved off the cool/neon end: dust is a
  warm mineral tone, ash a warm gray, spores a muted green; snow stays cold.
  Overcast fog is slightly less dense/blue, ash precipitation is warmer.
- Exported shapes, determinism, biome/id regex tables, `WEATHER_KINDS`,
  `selectWeather`, `timeOfDayAt`, lightning, wind and wet-sheen contracts are
  unchanged.

### Tests added (no existing assertion weakened or deleted)

- `game/textures.test.mjs`: macro+micro band variation, seamless tile edge,
  normal relief (and relief on both sides of neutral), restrained saturation
  with per-pixel channel drift.
- `game/moth-surface.test.mjs`: `fractureStrength` default/override/setter,
  the fracture uniform and ridged function reaching the shader, two-scale
  masked region injection.
- `game/environment.test.mjs`: warm/cool balance per phase, night airglow and
  ground tone, the horizon haze band fading upward, warm/cool weather and
  biome mote tints.

**Intentional pinned-expectation updates: none.** No existing expectation was
changed.

---

## 2. Lead integration points in `game/view.mjs`

`view.mjs` is lead-owned; nothing below is required for correctness, but these
are the exact call sites that turn the data-level improvements into the
in-game look. **Required to realize this workstream's goals:** (1) the enhancer
gate and (4) the phase propagation to the CPU renderer. (2), (3), (5) and (6)
are recommended look decisions.

1. **`_buildArena`, `applyTextures` (view.mjs:808)** — the enhancer is
   currently gated on a Moth-baked albedo:

   ```js
   if(maps?.map?.userData.source==='moth'&&this.renderer?.isWebGLRenderer===true)
     enhanceMothMaterial(mat,{kind,macro:mothMacroTexture()});
   ```

   `enhanceMothMaterial` works with any `map` and already no-ops for grid
   kinds, so dropping the `source==='moth'` condition applies the new
   macro/fracture variation to every natural surface on WebGL:

   ```js
   if(this.renderer?.isWebGLRenderer===true)
     enhanceMothMaterial(mat,{kind,macro:mothMacroTexture()});
   ```

   Optional: pass an explicit value, e.g.
   `enhanceMothMaterial(mat,{kind,macro:mothMacroTexture(),fractureStrength:.4})`,
   or call `material.userData.setMothFractureStrength(v)` after build.

2. **`applyTextures` normal scale (same line)** — `normalScale` is `.4`.
   Procedural normals used to be nearly flat (std ≈ .007); they now carry
   std ≈ .1–.23 raw, so `.4` understates them. Suggested `.55–.7`, e.g.
   `mat.normalScale=new T.Vector2(.6,.6);`. This is a look decision, not a
   regression fix.

3. **`_applyArenaLook` (view.mjs:1385)** — fog/background currently track only
   the authored arena color plus the weather tint. Tinting them toward the
   phase palette makes time-of-day read at ground level:

   ```js
   const haze=new T.Color(palette.haze);
   this.scene.background.copy(new T.Color(base.background))
     .lerp(new T.Color(material.tint),wet*.5+dark*.5).lerp(haze,.10);
   this.scene.fog.color.copy(new T.Color(base.fog))
     .lerp(new T.Color(material.tint),wet*.5+dark*.5).lerp(haze,.14);
   ```

   Leave `this.scene.fog.density=base.fogDensity*fogScale;` as-is.

4. **`_applyArenaLook` (view.mjs:1391)** — the CPU renderer reads
   `scene.userData.sky.phase` in `software.mjs:_paintSky`, which is only set
   at build time. Add:

   ```js
   if(this.scene?.userData?.sky)this.scene.userData.sky.phase=state.phase;
   ```

   so the improved palette actually reaches the software renderer as the
   day/dusk/night cycle runs.

5. **`addSky` call (view.mjs:925)** — the WebGL dome vertex gradient is baked
   at build time; `_tintSky` only retints the haze band/disk/stars. A full
   phase-following dome would rewrite the `color` attribute from
   `skyGradientAt(t, _blendedSkyPalette(tod))` when `state.phase` changes.
   Optional; the palette/haze/disc path already changes with the phase.

6. **`MATERIAL_PRESETS`** — no imports today. Where `material(color, metal,
   rough, emissive)` is chosen for armour, steel, rubber, stone and energy
   surfaces, spread `materialPreset(name)` to give them distinct PBR values.

No signature changes are required anywhere; `surfaceTextures`,
`enhanceMothMaterial`, `skyPalette`, `addSky`, `addMountains`, `addScatter`
keep their existing shapes.

---

## 3. Verification

Focused command (run from the worktree):

```
node --test --test-timeout=120000 game/textures.test.mjs game/material-presets.test.mjs game/moth-surface.test.mjs game/environment.test.mjs game/sky.test.mjs game/view.test.mjs
```

Result: **162 tests, 160 pass, 2 fail**. The two failures are in
`game/view.test.mjs` and are pre-existing on this branch — reproduced with
this workstream's files stashed (test numbers #22/#74 when `view.test.mjs`
runs alone; #85/#137 in the combined run above):

- `not ok 22 — every canonical arena has batched polish...`
  (`atrium: cliff terrain draws strata`, map geometry).
- `not ok 74 — operator model adds shoulder, visor and backpack detail...`
  (`the gun anchor keeps its mount point`, character rig).

Both belong to map/character work, not materials, and were left untouched.

Measured on the final code (scratch harness, same mock canvas the tests use):

- Pinned concrete case (size 48, seed 5): albedo/roughness correlation
  **0.874**; albedo macro band std 0.027 and micro band std 0.017; normal
  R/G std 0.133; 0% normal texels clipped.
- Natural kinds (size 96, seed 11): correlation 0.84–0.91, seam edge ratio
  0.74–0.95 (was 2.8–11.3), normal R std 0.08–0.23 (was 0.004–0.009).
- Procedural generation cost at 96 px: **~28–35 ms per kind** for all three
  channels (12 kinds ≈ 0.35–0.45 s one-time during arena build), no new
  dependencies, no `Math.random()`.
- Visual before/after swatches and a sky-palette strip were rendered from the
  real generators to `/tmp/opencode/phase2-materials/preview.png`,
  `preview-baseline.png` and `sky-preview.png` during this session (scratch,
  not committed). The baseline shows flat normals and cloudy albedo for the
  generic kinds; the current build shows multi-scale relief and weathering.

---

## 4. Risks / unknowns

- **No GPU verification here.** The `mothRidge`/region shader injection is
  string-inspected by tests, not compiled; the harness has no WebGL. The GLSL
  is WebGL1-safe (constant loop bounds, no derivatives) and only uses
  functions already present in the existing injection, but the lead should
  smoke it on a real WebGL renderer before shipping.
- **Normal strength is now meaningful.** Anyone who calibrated `normalScale`
  for the old flat normals should re-check .4–.7. Normal `+Y` orientation
  follows the previous convention.
- **Build-time cost.** ~0.35–0.45 s of texture baking per arena on top of the
  previous cost. If that shows up in load timing, lowering the default
  `size` from 96 to 64 roughly halves it.
- **`fractureStrength` is a new field** on `mothSurfaceBreakConfig()` results.
  Nothing in the repo deep-equals that object, but any external snapshot test
  would need the new key.
- **WebGL dome gradient is static per build** (see integration point 5);
  time-of-day currently reads through the haze band, sun disk, stars, fog and
  ambient/weather tints. The CPU renderer will follow the phase once
  integration point 4 lands.
- **Pre-existing view.test failures** (strata, gun anchor) still fail and are
  outside this workstream; do not attribute them to materials.
