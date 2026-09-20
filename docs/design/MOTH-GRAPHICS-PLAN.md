# Moth graphics: material variety, surface identity, and an art-direction lab

**Research date:** 2026-09-20  
**Game baseline:** v8.5 HANDOFF (`4dafe28`), plus the local graphics-lab preview  
**Tool inspected:** `mothbake` at `3e25930` in `/home/mojo/projects/mothbake`  
**API inspected:** live public OpenAPI, `moth-api v0.41.0`  
**Fetched schema SHA-256:** `b0695071d500e28457a7d18fc4ef2e94cb60989761eeafff2cdd90f9bf553e39`  
**Status:** partially implemented (v8.6 PRISM). G0 bake integrity is in the game
runner **and** ported upstream to `mothbake` (`a35a2e67`: merge-safe, atomic,
validated publication; download validation). G2/G3 first slice is in: offline
deterministic variants for four kinds from archived raw bakes, per-surface
variant keys, structure-preserving wear, and an explicit sampling policy. The
graphics lab also gained three Moth-asset layers. Everything else below —
additional families, decals, higher-resolution/URL-backed textures, coating and
flow experiments needing new bakes — remains proposed. See
[../MOTH.md](../MOTH.md) for the implemented summary.

## 1. Recommendation

**Make Moth an offline material-variation workshop feeding a coherent three.js
material system.** The biggest gain is on repeated floors, wall panels, concrete,
and rock—not another full-screen filter over the same repeating image.

Build in this order:

1. Make partial bakes and artifact reuse safe and reproducible.
2. Establish measured texture scale, filtering, and complete material families.
3. Break repetition differently for natural surfaces and constructed surfaces.
4. Use Moth masks and numeric fields to produce related wear states, not unrelated
   textures randomly scattered across a map.
5. Layer selective iridescence, emissive patterns, atmospheric cards, and
   flipbooks over those materials.
6. Let the developer lab compare material treatments separately from screen
   treatments, and save the winning recipes.

The best initial art direction is **industrial science fiction with printed color
and localized interference**: grounded, readable structures; authored wear and
material variation; quantum-looking accents confined to energy-bearing surfaces.
The lab's Circuit Print and Ember Press recipes are useful directions to compare,
not a decision already made for the game.

### The three levers

| Lever | What changes | Owner |
|---|---|---|
| Asset generation | Grain, cracks, paint, masks, relief, LUT data, frame sequences | Moth API + offline mothbake |
| Material composition | Where variants appear, texture scale, normals, wetness, projection, semantic masks | Game's three.js renderer |
| Final art direction | Posterization, ink, halftone, palette, scanlines, grain | Graphics lab postprocessing |

Moth is not a per-frame browser graphics API. Bake results once, archive the
bytes, and play those assets locally. Screen filters cannot reconstruct missing
material diversity; new images alone cannot fix bad UV mapping.

## 2. What the game actually has

This inventory comes from code and generated data, rather than only older docs.

| Existing piece | Observed state | Implication |
|---|---|---|
| `assets/moth/manifest.json` | 80 jobs, all enabled | A full run is a broad rebuild, not a targeted graphics experiment |
| `game/moth-baked.mjs` | 1,068,859 bytes of generated module source | Do not multiply every texture into a large eager base64 bundle |
| Albedos | 20 records including `macro-organic`; 48×48 or 64×64 | Small patterns become recognizable quickly |
| Normals | 13 records, 32×32 | Increasing albedo alone will not improve relief coherence |
| Material LUTs | 3 (`entanglement` family) | Existing data is enough for first selective-iridescence experiments |
| Skies | 4, each 128×64 in the shipped bundle | Better treated as low-frequency atmosphere than detailed visible sky art |
| Effects | 9 sequences, generally 3 frames, one with 2; 48px wide | Extend the existing pools and format, rather than create another FX system |
| Other data | Level graph, seed record, motifs, IRs, audio, echo map | Preserve these when experimenting with graphics-only output |

### 2.1 Why surfaces still repeat

**A. One baked tile wins for each canonical kind.**
`mothSurfaceOverride(kind)` and `mothNormalOverride(kind)` select one record.
`surfaceTextures()` accepts a seed and includes it in its cache key, but the
baked albedo/normal lookup does not use that seed. Different seeds can therefore
produce different procedural roughness while re-uploading the same baked image.
There is no authored per-biome material-family variant selector.

**B. Most manufactured surfaces are exempt from anti-tiling.**
`MOTH_GRID_KINDS` excludes hazard stripes, hex panels, circuits, grating, diamond
plate, industrial mesh, corrugation, carbon fiber, riveted armor, and brushed
metal. Preserving their structural grid is correct. Exempting their paint,
roughness, stains, damage, and local color from variation is the missed opportunity.

**C. The current enhancer changes albedo, not a coordinated material.**
`enhanceMothMaterial()` adds macro noise, a ridged fracture term, and a rotated
second color sample after `map_fragment`. Normal and roughness samples do not
receive the same transformed secondary detail. This can make painted cracks,
reflections, and physical relief describe different surfaces.

**D. Broad variation is projected on XZ.**
`vMothWorld.xz` is fine for floors; on vertical walls it has no Y variation. A
wall rising several meters can read as the same vertical smear. Its world-position
calculation also needs an instancing-aware path before using it on instanced
geometry: `modelMatrix * transformed` alone omits `instanceMatrix`.

**E. The macro map is finite, despite “never repeats” comments.**
The macro sampler uses RepeatWrapping and world XZ × 0.0015: about a 667-world-unit
period. This is large, not nonperiodic. Its modulation (`0.5 + macro.rgb`) also
needs a documented neutral value and strength control.

**F. Filtering is implicit.**
Baked albedos/normals are `DataTexture`s without explicit mip/filter/anisotropy
configuration in their constructors. three.js DataTexture defaults differ from
ordinary image textures. Measure the shipped behavior at glancing angles before
increasing resolutions. Keep nearest filtering as a deliberate retro option.

**G. Shader patches do not compose safely yet.**
Both `moth-surface.mjs` and `moth-material.mjs` assign `onBeforeCompile`.
Applying both to one material can overwrite the first patch. Their missing-anchor
fallback appends executable fragments outside `main`, which is not a safe fallback.
Solve this before adding more patches, rather than relying on call order.

### 2.2 Pipeline gaps to fix before a batch

The in-game `scripts/moth-bake.mjs` is not equivalent to today's generic mothbake:

- `runManifest({only})` initializes an empty aggregate and writes it to
  `game/moth-baked.mjs`. A selected job can replace the entire registry with only
  its output. A non-strict failed batch can similarly emit an incomplete bundle.
- `resolveResult()` falls through to a new paid submission if a cached job is
  incomplete or its status request fails. Generic mothbake instead requires
  explicit `--force` for this case.
- The local download path reads output bodies without checking `res.ok` first.
  Add content-type, byte-count, and decode validation before publishing.
- The local `--dry` path skips jobs rather than doing full parameter validation;
  it still calls `writeManifest`. Do not call that a write-free, schema-checked plan.
- The current game runner shown here accepts local `input` paths, not generic
  mothbake's full recorded-fixture and `inputFrom` workflow.
- The generic tool's `repair` is also scoped: it currently covers audio/IR/echo
  records, and emits only rebuilt records. It is not a universal merge-safe
  texture-regeneration command.

**Action:** use a pinned generic mothbake build for isolated experiments and
introduce a reviewed game-specific merge/publish adapter. Existing files remain
the last-known-good registry until every selected replacement validates.

## 3. Verified Moth capabilities and how to use them

The public schema was fetched successfully. The engine catalog returned HTTP 401
without authentication, so account access and today's credit prices were not
verified. No jobs were submitted for this research. Old credit figures in
`docs/MOTH.md` are historical estimates, not a current quote.

### 3.1 Engine opportunity matrix

| Engine | Verified input/output behavior | Best use here | Priority |
|---|---|---|---|
| `blur-v1` | Image plus optional mask; soft per-pixel original/processed blend; `rx`/`ry`, strength/reach 0–1, size 8–1024; retains image dimensions/alpha | Related paint, corrosion, cloud, dust, and mineral variants while protecting structural features | First |
| `blur-core-v1` | Rectangular nonnegative N-D grids; optional axes, per-axis strength, exact probabilities when `shots` omitted; default 20-qubit cap, max 24 | Shared scalar height/wear fields, directional streaks, emissive masks, low-frequency variation | First |
| `deep-fryer-v1` | Image + optional mask; gate/intensity pairs, tile size 2–4; changes hue/lightness through a tiled transform | Localized oxidized paint, alien deposits, scorched trim, damaged displays | First, tightly masked |
| `entanglement-shader-v1` | ZIP with R/T LUTs and shader formats; reflectance, absorption, layers, rays, interaction, style, resolution | Thin-film coatings, energy glass, oily seams, chitin, shield surfaces | First, reuse existing LUTs |
| `telablur-v1` | Two images + optional mask; strength, full/vertical/horizontal direction | Authored transitions between clean/corroded or inert/energized states | Second |
| `qrc-image-v1` | ZIP of vocabulary images + training filename sequence, optional reusable state; emits an animated GIF and state/vocabulary | Curated decorative screen sequences, energy-flow motifs, ambient billboards | Second |
| `qrc-train-v2` / `qrc-gen-v2` | Token-sequence training and reusable state; generated sequences with temperature and generation seed | Offline decorative pattern ordering, e.g. panel motif sequences constrained after generation | Exploratory |
| `tessa-image-v1` | Image encode/transform/decode; fixed palette, shots, range correction, machine, distortion/Pauli controls | A controlled palette/noise study, not the main material factory | Exploratory |
| `qpixl-v1` | Numeric arrays, discretization, dynamic-range correction, machine and shots | Alternative small scalar-mask/threshold experiments against a classical baseline | Exploratory |
| `labyrinth-v1` / `graph-v1` | Structured graph/state data | Optional decoration zones only in this scope; avoid changing navigation or combat layout | Later |

### 3.2 Important contract distinctions

- `blur-v1.style` is **`rx` or `ry`**; `blur-core-v1.style` is a nonempty
  string over **`x` and `y`**. Do not copy one engine's parameters into the other.
- `blur-core` has axes and per-axis strengths: useful for directional wear.
  Pack channels thoughtfully—never blur across a channel axis by accident.
- `qrc-image` sequences supplied images; it does not invent arbitrary new
  texture pixels from a text prompt. Its `periodic` option concerns training
  windows, not a guarantee of a visually seamless last-to-first frame.
- `qrc-gen-v2` has `random_seed`; training has `seed`. They control different
  randomness. Archive outputs even with seeds; fresh remote execution is not the
  game's determinism contract.
- The current Tessa schema does not establish the old blanket 64×64 limit in our
  docs. Historical emulator distortion failures are useful evidence, but need a
  small current smoke test before describing them as today's universal behavior.
- Teleblur's operation description says mismatched dimensions are rejected;
  its `image2` description says resized. Submit equal-sized inputs and record
  that documentation inconsistency rather than betting on either behavior.
- QRC v2 paths contain v1 names in descriptions. Use the actual advertised path,
  archive the schema, and smoke-test state compatibility rather than infer it.
- `mode` is engine-specific. For QRC training it can mean window sampling, not
  emulator/QPU selection. Do not stamp `mode:'emu'` on every request.
- The entanglement output is **angle/phase material data**, not a standard 3D
  color-grading LUT and not a drop-in ShaderPass. Integrate documented LUT axes
  deliberately. The game's current Fresnel-plus-phase treatment is an artistic
  approximation, not a physically faithful use of every supplied shader.

## 4. The material-family system

### 4.1 Three spatial scales, one material language

| Scale | Initial world scale to evaluate | Purpose |
|---|---|---|
| Micro | 0.05–0.3 m | Grain, scratches, fine normal/roughness response |
| Meso | 0.5–3 m | Plates, aggregate, rock features, chips, material variants |
| Macro | 8–40 m | Dust accumulation, damp zones, geological bands, paint aging |

These are starting art parameters, not measured optimal values. Large, high-
contrast unique features belong in sparse overlays, not in the base tile that
repeats every meter. Texture scale should be expressed in world units, rather
than arbitrary repeat counts that vary with mesh dimensions.

### 4.2 Proposed material record (new schema, not accepted today)

```json
{
  "schemaVersion": 2,
  "id": "foundry/painted-metal",
  "unitsPerTile": 2,
  "structural": true,
  "projection": "face-planar",
  "variants": [
    {
      "id": "worn-01",
      "albedo": "painted-metal-worn-01-color",
      "normal": "painted-metal-worn-01-normal",
      "orm": "painted-metal-worn-01-orm",
      "masks": "painted-metal-worn-01-masks",
      "weight": 2
    }
  ],
  "variation": {
    "macroWorldSize": 24,
    "tintAmount": 0.06,
    "roughnessAmount": 0.12,
    "allowRotation": false,
    "allowMirror": false
  },
  "fallbackKind": "brushed_metal"
}
```

Keep existing canonical kinds and accessors working. Add family-aware lookups
alongside them; missing family/map data falls back to the canonical material.
Define every packed channel: **ORM = R ambient occlusion, G roughness, B
metalness**. A masks texture can use R wear, G dampness, B emissive eligibility,
A biome blend, if the family needs those channels. Unused channels have explicit
neutral values. AO from a height heuristic must be labeled approximate, not baked
mesh occlusion.

### 4.3 Stable assignment without extra draw calls per wall

- Derive a visual seed from arena identity + stable surface id + authored region
  id, separate from match RNG and actor state. Do not depend on draw traversal
  order, camera position, time, or load completion order.
- Assign a family and a small discrete variant id per surface/instance. For a
  long wall made of separate meshes, use one coherent parent-region mapping so
  corners and boundaries do not suddenly change scale or grime direction.
- Group geometry/instances by family; feed variant, tint, and offset through
  attributes or instance data. Do not clone one material for each panel.
- Cache underlying image data separately from UV sampler/material parameters.
  A seed change must not re-decode/re-upload identical base64 tiles.
- Begin with **four related variants per high-coverage family**. Add more only
  if side-by-side wall tests still reveal a repeated motif.

## 5. Anti-repetition techniques ranked by return

### 5.1 First: structural grid + independent wear

For panels, rivets, grating, tread plate, and stripes:

1. Preserve structural UVs, spacing, and orientation.
2. Create a source-art mask protecting seams, bolts, holes, text, stripes, and
   high-value trim.
3. Send paint/grime regions through masked blur or deep-fryer transformations.
4. Bake coherent clean, dusty, chipped, and oxidized variants with matching
   structural boundaries.
5. Select per panel or authored region; modulate roughness with a broad independent
   wear field. Keep panel boundaries aligned across all variants.
6. Add sparse decals: repair patches, serial motifs, water trails, weld scars.
   Use original procedural artwork and a small atlas; deduplicate mirrored repeats.

**Expected look:** manufactured repetition remains believable, while no corridor
looks like the same exact rusty panel copied 40 times.

**Do not simply remove every kind from `MOTH_GRID_KINDS`.** That would twist
hazard stripes, create doubled rivets, and blur the industrial construction.
Replace the binary grid/natural split with policies such as
`structure-preserving`, `organic-blend`, and `emissive-grid`.

### 5.2 Second: low-frequency variation on every appropriate surface

Use a world-oriented macro mask for dampness, dust, tint, and roughness with
separate bounded strengths. Use XYZ noise or face-aware projection on walls;
reserve XZ for horizontal surfaces. Handle instance transforms and normal space.

Keep the mean near neutral and normalize when necessary: anti-repetition should
not darken an entire map cumulatively. The current multiply-on-multiply albedo
approach should become an explicitly controlled blend.

### 5.3 Third: stochastic organic sampling

For rock, sand, concrete, stucco, and organic chitin:

- Evaluate triangular-grid blending of three deterministic transformed samples
  or a two-sample hashed-cell approximation for the lower tier.
- Blend related variants with the same weights across albedo, roughness, and
  normals. Linear-light blending for color; normal reorientation and normalization
  for normal data, not a plain RGB average.
- Rotate/reflect tangent-space normals consistently with UV transforms. A 90°
  texture rotation is not correct if the sampled XY normal stays unrotated.
- Preserve derivatives with `textureGrad` or equivalent derivative-aware
  sampling across discontinuous hash coordinates; select correct mips and avoid
  shimmering cell boundaries.
- Start with three samples only on a small set of high-coverage materials. A
  tri-planar three-sample blend across three channels can multiply bandwidth
  rapidly; do not deploy both everywhere by default.

### 5.4 Fourth: projection and mapping discipline

- **Terrain/irregular cliffs:** triplanar or slope-aware projection, with
  normalized axis blend weights and correctly transformed normals.
- **Box walls/roofs:** face-planar mapping at uniform texel density is cheaper
  and cleaner than general triplanar shading.
- **Thin grids and signs:** authored UVs with minimal perturbation.
- **Large floors:** world-planar base layer + region macro mask + sparse decals.
- **Instanced props:** instance-local UV detail plus true world-position macro
  variation, using both instance and model transforms.

### 5.5 Fifth: texture filtering and mip policy

Explicitly define `minFilter`, `magFilter`, `generateMipmaps`, and anisotropy
clamped to renderer capabilities. Evaluate 128px and 256px production tiles;
32px normals may become 64/128px where grazing-light comparisons show a benefit.
Use sRGB for albedo/emission artwork, linear/no-color-space for numeric masks,
normals, and ORM. Preserve separate nearest-filtered retro recipes.

For atlases, add gutters, safe mip generation, and region-aware sampling. A
sprite-sheet atlas is not automatically a repeatable material atlas. Consider
WebGL2 texture arrays for equal-sized variants after validating the renderer
and software fallback; do not require WebGPU for this project.

## 6. Specific Moth bake experiments

### Experiment A — worn industrial wall kit

**Inputs:** one procedural 256×256 panel sheet, one paint/wear mask, a protected
seam/rivet mask, and four named deterministic source seeds.

**Candidates:** original source; low-strength blur RX; low-strength blur RY;
masked deep-fry on corrosion-only zones. Explore strength 0.15/0.35/0.55 in a
small contact sheet, keeping reach initially 0. These are test values.

**Bake:** preserve 128px/256px albedo candidates, derive paired roughness from
the authored wear field, keep structural normal detail consistent. Use deep-
fried output primarily as a color variation, not as inferred surface height.

**Review:** a 12-panel wall, a 90° corner, an overhead light, and a moving
grazing light. Reject muddy seams, repeated bright scars, and color shifts that
look like team markers. Select four related variants, not four random winners.

### Experiment B — concrete with coherent cracks and dust

**Inputs:** periodic height + crack mask + aggregate field, generated locally.
Use blur-core with omitted `shots` for an exact scalar experiment. Compare
isotropic axes against one-axis diffusion for streaked wall wear.

**Bake locally from the same field:** height, a tangent-space normal, bounded
roughness, crack/wear masks, and an albedo modulation. Keep albedo's illumination
neutral: do not bake directional lighting into the diffuse map.

**Review:** a 20m floor with a camera approaching from standing height, a 5m
wall, and a sloped ramp. No “painted crack with shiny flat relief” mismatch.

### Experiment C — biome-linked natural family

Create dry/wet/mineral-rich versions of rock, and clean/dusty/worn concrete.
Use a shared macro field to blend between members. With Teleblur, pass matching
dimensions and protected masks; compare the result against a local classical
blend. Retain the remote result only where it produces useful structure.

Do not generate albedo and normal variants independently without checking their
spatial correspondence. Environmental wetness primarily lowers roughness and
changes reflectance; it should not simply tint everything blue.

### Experiment D — interference trim and energy glass

Start with existing `entanglement`, `entanglement-arcane`, and
`entanglement-ember` LUTs. Put them on a test wedge, roughness ladder, and
facing-angle sweep. Compare the current art-oriented Fresnel sampling with the
axes and units in an actual generated shader from the archived ZIP.

Add masks for thin film, exposed coating, and emissive eligibility. Give
material/region phases small stable offsets; freeze time animation under reduced
motion. Keep emission, reflective coating, and transmission as separate controls.

Only then bake a small `peaked` / `frustrated` / `3-body` study. Respect the
ray/layer and qubit budget together. If preserving HDR LUT values improves the
comparison, add a floating-point artifact path; the current RGB8 reduction should
not be presented as retaining all original dynamic range.

### Experiment E — animated machinery and environmental FX

- Build a vocabulary of original 64/128px screen glyphs, vents, and energy
  motifs; run `qrc-image` to sequence them. Reuse state and vocabulary output
  asset ids through generic mothbake `inputFrom`.
- Decode GIF with mothbake's tested full-frame/disposal support; emit a
  spritesheet and timing metadata. Inspect loop seams explicitly.
- Prefer shader frame interpolation, UV flow, or scrolling a static field for
  simple motion. Reserve multiple baked frames for meaningful silhouette changes.
- Extend `MothSpritePlayer` pools, caps, and fallbacks. Premultiplied/straight
  alpha and emissive blending must be defined per sheet.
- Keep decorative QRC sequences separate from factual terminal status,
  objective channels, warnings, and other combat information.

### Experiment F — Moth-authored filter inputs

Use an image/numeric bake as a *source texture for a local shader*: a subtle
paper field, interference mask, color ramp, or flow field. Potential lab layers:

| Toggle | Moth asset | Runtime treatment |
|---|---|---|
| Interference ink | Small numeric field/LUT-derived ramp | Bounded hue/ink variation within the selected palette |
| Quantum paper | Low-frequency grayscale bake | Screen-space print modulation with controlled mean/contrast |
| Energy flow | Two derived signed channels from scalar-field gradients | World/material UV advection at a bounded rate |
| Spectral coating | R/T LUT + coverage mask | View-angle material response |
| Living displays | QRC-selected sprite atlas | Decorative frame playback |

An entanglement LUT cannot be renamed to a color-grading LUT. A new grading LUT
would require a defined RGB-to-RGB transform, a color-space contract, and a
separate baker. Likewise, a scalar grid is not automatically a vector flow field;
derive and normalize its vector representation explicitly.

## 7. Getting more out of mothbake

### 7.1 Keep generic mechanisms upstream, game choices here

Pin mothbake to a revision rather than import a moving sibling checkout during
production builds. It remains an authoring tool; do not add its API client to the
browser bundle. Follow `mothbake/docs/SYNC.md` when implementing generic additions.

| Add to mothbake | Keep in this game |
|---|---|
| Multi-channel material baker; scalar/normal/ORM outputs | Canonical family ids, map/biome assignments |
| Tile seam checks, mip-aware resampling, atlas gutters | Team-color and objective-contrast rules |
| Image recorded-result rebakes and export manifests | `MOTH_BAKED` compatibility/merge adapter |
| Recipe provenance and content digests | Graphics lab presets and arena capture routes |
| Deterministic variation generators and optional mask recipes | Default texel density, material budgets, runtime shader patches |

### 7.2 Proposed bake/publish flow

```text
authored source + masks + named seeds
    → locally generated source review sheets
    → validated job manifest + current catalog cost estimate
    → Moth transformations (small selected experiments)
    → immutable archived outputs + request/schema provenance
    → deterministic local multi-channel bakes + seam checks
    → family contact sheets and tiled/grazing-angle review
    → isolated candidate manifest
    → explicit merge against last-known-good full registry
    → publish same-origin files + compact runtime descriptors
```

A single changed texture should be re-bakeable from recorded bytes without a
remote call. Use generic `recorded.outputs` for graphics today; extend repair
support separately if needed. A partial experiment writes to its own output dir.

### 7.3 Reproducibility and failure semantics

For every candidate record: source digest, mask digest, generator version/seed,
engine id, exact params, API schema digest/version, job id, output digest,
decoder/baker revision, dimensions, color space, channel packing, and intended
world scale. Record available server engine metadata without inventing a stable
engine revision field the API does not expose.

Publication should be atomic and fail on missing required channels, duplicate
keys, unexpected dimensions, corrupt downloads, or incomplete frame sequences.
An interrupted bake keeps old published assets. Cached-job failures do not imply
permission to submit again. Save ids promptly so a crash does not lose a paid job.

Use periodic source generators, but test **transformed outputs** for seam
continuity: a seamless input does not prove a quantum transform remains seamless.
If repair requires border blending or synthesis, review those operations and
record them as explicit local bake stages.

### 7.4 Practical commands available now

Run these from the pinned mothbake checkout, with an experiment-specific config
and an isolated output directory. Validation and dry run are offline:

```bash
node bin/mothbake.mjs validate --config /path/to/graphics-experiment.json
node bin/mothbake.mjs run --dry --config /path/to/graphics-experiment.json
node bin/mothbake.mjs run --config /path/to/recorded-graphics-experiment.json --out /path/to/candidate
```

Authenticated authoring later:

```bash
node bin/mothbake.mjs catalog
node bin/mothbake.mjs run --config /path/to/graphics-experiment.json --only wall-rx,wall-ry --out /path/to/candidate
```

These expect `MOTH_API_KEY` in the authoring environment. No key or presigned
output URL belongs in game preferences or published assets. Archive outputs and
publish same-origin URLs. No new paid run is needed to vary a runtime blend amount.

## 8. Developer lab roadmap

The current preview adds twelve independently stackable screen-space effects,
six starting recipes, palette choice, mix, A/B bypass, split comparison, reset,
local persistence, and JSON export at **Settings → Graphics lab · Preview**.
Those shaders are locally authored; they are not new Moth-generated assets.

Extend it with three explicit categories:

### Surfaces

- Original vs Moth family; per-kind inspector showing actual variant id/source.
- Structural-grid preservation, micro scale, macro scale/strength, variant blend.
- Roughness/normal strength, wetness, dust, sparse detail density.
- Debug channels: albedo, normals, roughness, masks, UV scale, variant ids.
- A stable visual-seed stepper independent of match seed.
- Mip/filter mode and anisotropy (capabilities-aware).

### Material and atmospheric accents

- Coating coverage, LUT family, phase offset, intensity, animated/static phase.
- Emissive flow, rift cards, decorative displays, ambient particle count.
- Separate static reduced-motion previews; no strobing style recipe.

### Capture and evaluation

- Fixed camera bookmarks on a material test wall and three representative maps.
- Pause only the visual preview clock, retaining a labeled online/live state.
- Original/styled/split capture, recipe import/export, build/material digest.
- Real draw calls, textures/estimated GPU bytes, shader count, resolution,
  median/p95 frame times, disjoint-aware GPU timing where supported.
- Show “pending shader/asset” or a real fallback reason instead of falsely
  reporting an active effect whose asset failed to load.

Keep material comparison separate from postprocessing so a strong palette does
not hide texture faults. Screenshot both with post disabled and with the selected
style. Keep interface text and first-person aiming legibility stable.

## 9. Performance and storage plan

These are **initial proposed budgets**, to be adjusted using the actual hardware
baseline, not claimed measured costs.

| Tier | Material approach | Proposed added resident texture budget | Proposed steady-frame GPU allowance |
|---|---|---|---|
| Software | Existing authored/procedural fallback | No new shader requirements | No additional material shader work |
| Low WebGL | 2 variants, simple macro mask, limited normal detail | ≤8 MiB per active arena | Target ≤0.75 ms at tier resolution |
| Medium WebGL | 4 variants, selected 2-sample blending | ≤16 MiB per active arena | Target ≤1.25 ms |
| High WebGL | 4 variants, selected 3-sample/triplanar materials, accents | ≤32 MiB per active arena | Target ≤2 ms |

For scale: one 256×256 RGBA8 texture with a full mip chain is approximately
0.333 MiB. Four variants × three maps ≈4 MiB per material family, before masks,
driver overhead, or duplicate allocations. A single 1024×1024 RGBA8 atlas with
mips is about 5.33 MiB. File compression size is not GPU residency.

- Load the active biome's family pack, not every arena's variations on title load.
- Prefer URL-backed textures/compact descriptors to an expanding eager base64 JS
  module. First migrate without changing the visible result.
- Reuse texture resources by content identity; reference-count across arena
  changes and dispose only when unused.
- Shader cost is samples × channels × projections, not “one material.” Capture
  both GPU time and CPU submission overhead.
- Existing adaptive quality can lower sampling complexity, normal detail, and
  accent density; it should not reshuffle variant identity during play.
- KTX2/Basis compression is a later option with explicit decoder/asset-tooling
  accounting, not a dependency assumed to exist today.

## 10. Acceptance evidence

### Material correctness

1. Render each family on a flat tile, a 12×12 repeat field, box corner, slope,
   vertical wall, and instanced row at matched world scale.
2. Check base-level edge continuity plus every generated mip level. Measure
   boundary discontinuity relative to interior gradients, not just equality of
   the first and last pixels.
3. Use translational autocorrelation to compare strong repeat peaks with the
   baseline. Record the method and crop; it is a diagnostic, not an art score.
4. Rotate a light around albedo/normal/roughness variants to verify channels
   describe the same cracks, seams, and wear.
5. Traverse with a moving camera: reject shimmer, texture swimming, sudden
   variant switching, hard hash-cell borders, or displaced structural markings.
6. Test patch composition: surface + LUT + instance transform + fog + shadows;
   shader anchor mismatch gives a surfaced fallback, not malformed GLSL.

### Runtime integration

- Deterministic assignments across reload, replay, and different asset load order.
- Procedural fallback with missing optional family data; malformed required
  records cannot publish.
- Stable resource counts over at least 20 map swaps and repeated recipe changes.
- Full graphics matrix: 1366×768, 1920×1080, 844×390, 390×844, and 844×390 at
  UI scale 1.4; add DPR 1/2 and dynamic-resolution checks for texture sampling.
- Fixed-route performance captures with baseline and one treatment at a time,
  then the chosen stack. Serialize expensive suites.
- Human art review for identity, enemy/objective readability, and comfort. Record
  preference as preference; automated rendering does not establish those claims.

## 11. Delivery plan with concrete ownership boundaries

| Package | Deliverable / primary files | Exit criterion |
|---|---|---|
| G0 — bake integrity | Adapter around `scripts/moth-bake.mjs`, manifests, isolated output/publish tooling; generic fixes in mothbake | Selected/failing jobs preserve unrelated assets; cached failures never silently re-submit; all graphics candidates rebuild offline |
| G1 — baseline and filtering | `game/textures.mjs`, `/moth` comparison gallery, capture script | Known world scale/filter/color-space behavior, before captures, allocation inventory |
| G2 — material families | `game/moth-assets.mjs`, new family descriptors, texture cache, surface assignment | Four related variants on one wall/floor family with coherent channels and stable IDs |
| G3 — industrial wear | Source masks/generators, `game/moth-surface.mjs`, view wiring | Seams and markings preserved; visible wear variation on a 12-panel wall |
| G4 — organic anti-tiling | Shared shader patch utility, organic sampler, normal transforms | Reduced repetition without seams/shimmer on rock/concrete and vertical surfaces |
| G5 — Moth accents | `game/moth-material.mjs`, `moth-sprite.mjs`, atlas loader, effect pools | Selective LUT/flow/display treatments with explicit resource and motion limits |
| G6 — lab expansion | `GraphicsLabPanel`, graphics preferences, material diagnostics | Saveable material+filter recipes; original/styled captures and clear asset status |
| G7 — promote winning look | Content manifest, per-biome assignments, verification docs | Chosen human-reviewed art direction, full render/performance gate, fallback coverage |

### First bounded vertical slice

Use **one industrial wall family and one concrete floor family** on Lattice
Foundry, plus a natural-rock comparison map. First reuse archived Moth outputs
and locally generated masks. Compare four variants, macro wear, and explicit
filtering. Only spend new credits where this comparison identifies a specific
missing kind of variation.

This answers the important question quickly: *does a corridor stop looking copied
and acquire a consistent authored identity?* If yes, extend by family and biome.

## 12. Research references

### Primary service and tool sources

1. [Moth live OpenAPI](https://api.mothquantum.com/openapi.json), fetched
   2026-09-20, `moth-api v0.41.0`: engine-specific paths, schemas, descriptions,
   input/output slots, and constraints. Authenticated prices were not checked.
2. [mothbake repository](https://github.com/mojomast/mothbake), local inspected
   revision `3e25930`: README, `docs/ARCHITECTURE.md`, `docs/SYNC.md`.
3. Game implementation: `scripts/moth-bake.mjs`, `assets/moth/manifest.json`,
   `game/moth-assets.mjs`, `game/moth-baked.mjs`, `game/textures.mjs`,
   `game/moth-surface.mjs`, `game/moth-material.mjs`, and `game/view.mjs`.
4. Existing game overview: [`../MOTH.md`](../MOTH.md). Treat its prices, engine
   limits, and “never repeats” claims in light of the findings above.

### Rendering and style references

5. [three.js ShaderPass](https://threejs.org/docs/pages/ShaderPass.html): custom
   GLSL passes and disposal.
6. [three.js OutputPass](https://threejs.org/docs/pages/OutputPass.html): tone
   mapping/color-space conversion; sRGB-input effects belong after this pass.
7. [three.js UnrealBloomPass](https://threejs.org/docs/pages/UnrealBloomPass.html):
   multiscale bloom and budget implications.
8. [three.js HalftonePass](https://threejs.org/docs/pages/HalftonePass.html): an
   available RGB print-pattern reference, not a new dependency requirement.
9. [Maxime Heckel, Shades of Halftone](https://blog.maximeheckel.com/posts/shades-of-halftone/)
   (2026): luminance-dependent dot fields, color separation, and pattern tradeoffs.

The proposed stochastic sampling, channel-coherent wear, and material-family
schema are game implementation work. They are not claimed as existing named
features of the Moth service.
