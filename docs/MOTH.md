# Moth Quantum asset pipeline

For the current graphics research and proposed material-variety work, see
[Moth graphics plan](design/MOTH-GRAPHICS-PLAN.md). It audits the runtime and
bake path, distinguishes live API contracts from historical limits, and
prioritizes structure-preserving wear, coherent material channels, and safe
partial publication. The in-game [Graphics lab](GRAPHICS-LAB.md) is the separate
opt-in preview for experimenting with screen-space style, including three
layers built directly from baked Moth assets.

## Material variety: what is implemented

The plan's first two slices are in the game today — an offline pass from
archived raw bakes, plus a paid 25-credit Moth batch (2026-09-20) that added
fifteen new assets:

- **Paid batch (v8.6, 15 jobs / 25 credits incl. two rejections and retries)** —
  nine masked surface variants (`weathered_concrete-worn`,
  `weathered_concrete-damp`, `metal-oxide`, `riveted_armor-scorched`,
  `hex_paneling-mottle`, `rock-moss`, `ice-cracked`, `circuit_board-etch`,
  `rough_stucco-weathered`) using blur-v1, deep-fryer-v1 and telablur-v1 with
  locally generated wrap-safe masks; two reflectance LUTs
  (`entanglement-ceramic`, `entanglement-void`); a warm `ember` sky; two
  quantum scalar fields (`dust-field`, `flow-field`) built by blur-core-v1 from
  the local `dust`/`flow` generators; and a 16-frame QRC glyph animation
  (`qrc-glyphs`) via qrc-image-v1. The GIF is decoded dependency-free
  (`scripts/moth-gif.mjs`) and baked whole in one paid job.
- **Local variants** — `scripts/moth-variants.mjs` derives three related,
  deterministic, tile-seam-safe variants for `metal`, `weathered_concrete`,
  `rock` and `riveted_armor` from the archived 256 px raw outputs, enforcing a
  mean-neutral, structure-preserving transform and a byte budget. The generated
  records live in `game/moth-variants.mjs`; `game/moth-variants-runtime.mjs` is
  the pure reader and now mixes the generated and baked variants behind one
  stable selection hash (no clock, RNG or load order), so a wall keeps its wear
  identity across visits.
- **Structure-preserving wear** — `game/moth-surface.mjs` treats grid kinds
  (paneling, grating, hazard stripes, riveted armor, …) with a `structure`
  policy that never distorts the structural UV sampling but modulates grime and
  roughness independently, protecting saturated markings. Organic kinds keep
  their break-up path but vary on vertical surfaces, respect instancing, and
  apply mean-neutral, strength-controlled macro modulation.
- **Per-surface keys** — `game/view.mjs` passes a replay-stable variant key
  (`arena|kind|repeat|region`), so repeated floors and walls no longer all share
  one wear image.
- **Arena dressing** — volcanic maps ride the `ember` sky and LUT, cold outposts
  the `ceramic` LUT, void/neon interiors the `void` LUT; `mothLutThemeFor` and
  `mothAtmosphereFor` are pure, contract-tested selectors.
- **Explicit sampling** — `game/textures.mjs` sets a documented sampling policy
  for every Moth DataTexture (trilinear mips plus clamped anisotropy by default,
  with a deliberate retro-nearest mode available through
  `configureMothSampling`).
- **Graphics lab** — three lab layers consume baked assets with an asset picker
  each (grain: macro tile / dust field / flow field; signals: arc burst / QRC
  glyphs; coat: all five LUTs).
- **Upstream port** — the bake-integrity mechanisms this game's runner now uses
  (merge-safe partial publication, atomic and JSON-safe writes, download
  validation) were ported to the generic
  [mothbake](https://github.com/mojomast/mothbake) pipeline as opt-in emitter
  `merge: true` plus always-on hardening, with docs, examples and tests.

The eager data module grew to ~1.7 MB with this batch and the budget test now
caps it at 2 MiB; per the plan, the next asset growth must move to URL-backed
textures instead of raising that number again.

Still open from the plan: per-biome family weights, decals/sparse detail, higher
resolution production tiles, URL-backed texture loading, and the coating/flow
experiments that need further bakes.

The game can bake presentation assets from [Moth Quantum](https://mothquantum.com)
engines and load them at runtime. Everything is generated **offline**, decoded
with zero dependencies, and committed as data, so the shipped game stays
deterministic, offline, and free of new runtime dependencies.

- `scripts/moth-bake.mjs` — submits jobs to the Moth Atlas API, polls them,
  downloads and decodes the results, and writes `game/moth-baked.mjs`.
- `assets/moth/manifest.json` — the list of jobs to run (engine, params, inputs,
  and how to turn each result into game data).
- `game/moth-assets.mjs` — the pure runtime reader the game imports.
- `game/moth-audio.mjs` — the Web Audio bank/player for baked beds, spaces and
  stingers (lazy, inert without an `AudioContext`).
- `game/moth-maps.mjs` — turns a baked quantum labyrinth graph into a playable
  arena.
- `scripts/moth-variants.mjs` — offline generator for local material variants
  derived from archived raw bakes (no API, deterministic, budget-checked).
- `scripts/moth-gif.mjs` — dependency-free GIF87a/89a decoder used by the
  QRC-glyph bake (composited frames, transparency, disposal modes).
- `game/moth-variants.mjs` — generated variant records; do not edit by hand.
- `game/moth-variants-runtime.mjs` — pure variant reader and stable selection.
- `game/moth-baked.mjs` — generated; do not edit by hand.

## Security

The API key is read from `MOTH_API_KEY` only. It is never written to the
manifest, the emitted module, or the repo. Keep it in your shell or a gitignored
`.env*` file:

```bash
export MOTH_API_KEY=moth_...
```

If a key is ever pasted into a shared surface, rotate it at
`platform.mothquantum.com`.

## Running a bake

```bash
# Show the engine catalog and the credit cost per run.
MOTH_API_KEY=... node scripts/moth-bake.mjs catalog

# Generate the local source art and seed audio that engines consume. This is
# free and deterministic: no key and no credits (writes sources/bed-seed.wav
# for qrc-audio via makeSourceAudio).
node scripts/moth-bake.mjs sources

# Run every enabled job in the manifest and rewrite game/moth-baked.mjs.
MOTH_API_KEY=... node scripts/moth-bake.mjs run

# Re-run a single job, or force a fresh submission (otherwise it reuses the
# recorded job id / looks for an existing result).
MOTH_API_KEY=... node scripts/moth-bake.mjs run --only blur-panel --force

# Rebuild the purely local records (`ir`, `echo-map`) from the raw results
# already committed under public/moth/files — offline, no key, no credits. This
# is how the cavern tap map was repaired after the shallow-extraction bug.
node scripts/moth-bake.mjs repair [--only ir-cavern]
```

The first successful run of a job records its `jobId` back into the manifest, so
a later `run` downloads that result instead of paying for another execution.
Set `enabled: false` on a job to skip it, and `--dry` to validate without
submitting anything.

## How a job becomes game data

1. **Submit.** `POST /api/v1/engines/{engine}/process` with `params` and, for
   file-consuming engines, `input_files` mapped to uploaded asset ids.
2. **Upload inputs.** `create asset` → presigned `PUT` → `complete`. Images must
   be PNG or JPEG, and must be real images (a 1×1 PNG fails server-side
   verification with a 502).
3. **Poll.** `GET /api/v1/jobs/{id}/status` until `completed`/`failed`.
4. **Download.** `GET /api/v1/jobs/{id}/result`; outputs carry presigned URLs and
   are saved under `public/moth/files/<job>/`.
5. **Bake.** A per-job `bake.type` decodes and downsamples the raw output into a
   compact record (see below) inside `game/moth-baked.mjs`.

Decoders are dependency-free: PNG (filters 0–4, truecolour/palette, 8-bit), ZIP
(stored + deflate), and Radiance RGBE `.hdr` (flat + RLE).

### Baker types

| `bake.type` | Input | Emits |
| --- | --- | --- |
| `texture-tile` | PNG | a small RGBA tile (base64) keyed by texture kind |
| `sky` | PNG | a wide equirectangular RGBA texture |
| `material-lut` | ZIP | reflectance/transmittance LUTs (small RGB, base64) |
| `normal-map` | blur-core grid | a tangent-space normal map derived from a blurred height field |
| `effect-frame` | blur-core grid | one frame of an animated effect (frames merge per name) |
| `level-graph` | inline JSON | a compact room grid: size, coupling, cell states, metrics |
| `motif` | MIDI | flattened note steps from a reservoir-reordered melody |
| `ir` | WAV (+ taps JSON) | a same-origin impulse-response descriptor for convolution reverb |
| `audio-clip` | WAV | a trimmed/resampled/normalised bed or stinger descriptor (`url`, `seconds`, `sampleRate`, `channels`, `loopStart`, `loopEnd`, `gain`); the processed WAV is written next to the raw result, never embedded |
| `echo-map` | trajectory JSON | a compact tap map (`spaces.*`) for a delay/feedback space, read recursively from `extras.taps` / `extras.tap_map.taps` / `data.extras.taps` |
| `seed` | inline JSON | random bytes, a uint32 seed, and the entropy witness |

## Engines and game use

| Engine | Credits | Produces | Used for |
| --- | --- | --- | --- |
| `labyrinth-v1` | 5 | quantum graph JSON | arena layout (`game/moth-maps.mjs`) |
| `entanglement-shader-v1` | 1 | LUTs + GLSL/HLSL/OSL | iridescent materials (`entanglement`, `-arcane`, `-ember`) |
| `blur-v1` | 1 | quantum-blurred PNG | albedo overrides for surface kinds |
| `deep-fryer-v1` | 1 | blown-out PNG | hull/panel, circuit and chitin albedos |
| `tessa-image-v1` | 1 | sphere-encoded PNG (≤64×64) | palette-quantized albedo overrides |
| `blur-core-v1` | 1 | blurred N-D grid JSON | **bump/normal maps and animated effects** (`normals.*`, `effects.*`) |
| `retrocausal-echo-v1` | 2 | WAV impulse response | **convolution reverb** for the soundtrack (`irs.*`) |
| `otoc-echo-v1` | 1 | trajectory JSON | **tap maps** (`spaces.*`) driving a delay/feedback space |
| `qrc-midi-v1` / `blur-midi-v1` | 5 / 1 | MIDI | **motif data** for the soundtrack (`motifs.*`) |
| `comet-qrng-v1` | 5 | random bytes + entropy certificate | provably-fair seeds |
| `qrc-image-v1` | 5 | animated GIF | animated textures, loading art |
| `qrc-audio-v1` | 5 | WAV | ambient beds, stingers and room-tone (`audio.*`) |

`mode: "emu"` runs on the Aer simulator (no QPU access needed). Real-hardware
runs use the top-level `mode: "qpu"` plus `backend_name`/`qpu_token`, cost more,
and are gated by your account. The default simulation cap is 20 qubits;
`tessa-image-v1` caps at a 64×64 lattice.

Two emulator behaviours worth knowing before you spend credits:

- `tessa-image-v1` rejects `distortion > 0` unless you target real IBM hardware.
- `comet-qrng-v1` can return **zero extractable bytes** on Aer even when the
  device health and Bell witness pass: the conservative ordering penalty can
  exceed the min-entropy budget. The bake still records the verifiable
  commitment, CHSH witness and entropy report (with `seed: null`). Raise `shots`,
  lower `epsilon_log2`, or run on a QPU to obtain actual bytes.

## Combating visible tiling

A small tile repeated across a large floor reads as a grid. Three things fix it:

1. **Seamless sources.** `makeSourceArt` builds natural surfaces from a wrapping
   value-noise field with no edge seam; only the industrial patterns keep hard
   edges on purpose.
2. **A macro tile.** `textures['macro-organic']` is a single low-frequency
   variation tile that never repeats across the world (`mothMacroTexture()`).
3. **A shader break.** `game/moth-surface.mjs` `enhanceMothMaterial(material, {kind, macro})`
   patches the material's UVs via `onBeforeCompile`: it multiplies albedo by a
   large-scale world-space noise, blends a second rotated/scaled sample of the
   same map, and optionally modulates with the macro tile. Grid kinds
   (`MOTH_GRID_KINDS`: hazard stripes, hex paneling, circuit board, grating,
   diamond plate, industrial mesh, corrugated metal, carbon fibre, riveted
   armour, brushed metal) are a no-op, so industrial surfaces keep their grid.

`game/view.mjs` applies the enhancer automatically to baked Moth surfaces on
WebGL, and only to natural kinds.

## In-world wiring

The baked assets are used, not just showcased:

- **Textures + normal maps** — arena floors, terrain and block surfaces.
- **Sky** — the quantum labyrinth gets a nebula dome (`mothSkyTexture`).
- **Materials + effects** — the labyrinth gets an iridescent landmark built with
  `createMothLutMaterial` (entanglement LUT) ringed by an animated rift that
  cycles the baked effect frames each frame (`updateMothRift`).
- **Effect sequences** — `effect-explosion`, `effect-teleport`,
  `effect-capture-ring`, `effect-heal`, `effect-shield` and
  `effect-weather-snow` drive blasts/vehicle kills, traversal teleports, flag
  and zone captures, heals and support pickups, shield breaks/walls/overshields
  and snow weather through the pooled `MothSpritePlayer`. `view._mothFx` prefers
  the dedicated sheet and falls back to the previous `arc-burst`/`spark-impact`
  cue when a sheet is missing.
- **Arena** — `moth-backrooms` is registered as a `variant` next-gen map
  (Quantum Labyrinth) so it appears in the normal rotation.
- **Motifs** — the baked `moth-oracle` motif is handed to `MusicEngine.setMotif`
  and the results scene opts into an external take (`leadMotif`), so the baked
  `moth-victory`/`moth-defeat` motifs replace the built-in COCS line on a win or
  loss and fall back to COCS when nothing is loaded.
- **Reverb IR** — `SynthAudio.setSpace(name)` swaps between the baked
  `open-air`, `tunnel`, `hall`, `cathedral`, `cavern` and `void` responses.
  `mothSpaceFor(arenaId)` picks one per map (interiors/tunnels/caverns override
  the open-air default, and the neon/void theatres map to `void`); `view`
  applies it on `setAudio` and on every arena build, and re-selecting the active
  space is a no-op. All six baked responses are reachable.
- **Echo map** — `SynthAudio.setEchoMap(name)` re-tunes the shared effects
  delay/feedback send (the tail gunfire, explosions and thunder already route
  into) from a baked `spaces.*` map. `mothEchoFor(arenaId)` defaults every arena
  to the baked `arena` map; `view` applies it beside `setSpace`.

  > **v7.1 space consolidation.** Pass 3 and the audio pipeline each baked an
  > open-air and a tunnel response under different job ids. The v7.1 merge keeps
  > exactly one record per real space:
  > `cavern`, `open-air`, `tunnel`, `hall`, `cathedral`, `void`. The audio
  > branch's `ir-openair` job and files were **deleted** — they were a
  > byte-identical duplicate of pass 3's `ir-open-air` (`result.wav` sha
  > `8ee9bccb…`) — so do not re-add `ir-openair`. The surviving `ir-tunnel` is
  > the audio branch's 3.5 s corridor response; pass 3's 2.2 s / 40 ms-tap take
  > was dropped. `hall` and `cathedral` come from pass 3, `void` from audio.

## Runtime API (`game/moth-assets.mjs`)

Nothing is active until `configureMothAssets()` is called; without it every
accessor returns `null` and the game falls back to its procedural generators.

```js
import { configureMothAssets, mothAssetsStatus } from './game/moth-assets.mjs';
configureMothAssets();               // defaults to the generated MOTH_BAKED
mothAssetsStatus();                  // { active, version, textures, normals, materials, sky, effects, levels, seeds, motifs, irs, audio, spaces }

mothSurfaceOverride('weathered_concrete'); // albedo { width, height, data } | null
mothNormalOverride('rock');                // baked normal map | null
mothMaterialLut('entanglement');           // { size, r, t } | null
mothSky('nebula');                         // equirect { width, height, data } | null
mothEffect('quantum-rift');                // { fps, frames:[{width,height,data}] } | null
mothIr('cavern');                          // { url, seconds, sampleRate, channels, taps } | null
                                           // also: open-air, tunnel, hall, cathedral, cavern, void
mothAudioClip('bed-ritual');               // { url, seconds, sampleRate, channels, loopStart, loopEnd, gain } | null
mothAudioNames();                          // ['bed-ritual', ...]
mothEchoMap('arena');                      // { lattice, sites, depth, seed, count, taps } | null
mothEchoMapNames();                        // ['arena', ...]
mothMotif('moth-oracle');                  // { bpm, notes:[{step,midi,dur,vel}] } | null
mothLevel('moth-backrooms');               // graph copy | null
mothSeed('moth-daily');                    // { seed, hex, bytes(), bell, certificate } | null
mothProvenance();                          // which engine/job produced each asset
```

`game/textures.mjs` consumes these automatically:

- `surfaceTextures(kind)` uses a baked tile as the albedo **and a baked normal
  map** when they exist, keeping procedural roughness only.
- `mothSkyTexture(name)` and `mothEffectTextures(name)` expose the baked sky and
  animated effect frames as `DataTexture`s.
- `MATERIAL_PRESETS.entanglement` plus `mothMaterialLutTexture(name)` expose the
  iridescent LUTs; `game/moth-material.mjs` (`createMothLutMaterial`) builds a
  `MeshStandardMaterial` that samples the LUT by Fresnel, and is unit-tested.

## Moth audio playback (`game/moth-audio.mjs`)

The baked `audio.*` beds and `spaces.*` echo maps are played through a small Web
Audio layer that mirrors the sampled bank's contract: lazy `fetch` +
`decodeAudioData`, one in-flight decode per clip, remembered failures, a decoded
bytes budget with oldest-first eviction, and loop points applied with
`AudioBufferSourceNode.loopStart/loopEnd`.

```js
import { MothAudioBank, MothAudio } from './game/moth-audio.mjs';
const bank = new MothAudioBank({ ctx });                       // ctx = AudioContext
const moth = new MothAudio({ ctx, bank, destinations: { ambience: syn.ambienceBus, effects: syn.effectsBus } });
await bank.preloadGroup(moth.desiredBeds());                   // per-scene preload
moth.setScene('game').setIntensity(0.6).setBedMood('storm');   // fixed, deterministic routing
moth.setSpace('arena');                                        // loads an echo map
moth.playStinger('sting-victory', { duck: 0.5 });
// once per frame: moth.tick();
```

- **Inert by default.** With no `AudioContext`, on reduced motion, before a clip
  has decoded, or with `enabled: false`, every method is a no-op and the
  procedural SFX, `MusicEngine`, and the CC0 sampled orchestra sound exactly as
  they do today.
- **Bounded.** At most `maxBeds` (3) looped beds are resident; oldest-first
  eviction fades and stops the oldest. The bank enforces a 12 MiB decoded-audio
  budget (`maxBytes`).
- **Deterministic.** Bed selection is a fixed scene/mood/weather table
  (`MOTH_SCENE_BEDS`/`MOTH_MOOD_BEDS`/`MOTH_WEATHER_BEDS`), never `Math.random`.
- **Additive wiring.** `SynthAudio.setMothAudio(instance)` attaches a layer and
  forwards `setScene`/`setIntensity`/`setBedMood`, `setEnabled`, `tick()` and
  disposal through guarded calls. The host may defer construction with
  `SynthAudio.setMothAudioFactory((ctx, syn) => instance)`: the factory runs once
  the first `AudioContext` and its buses exist, so nothing fetches or decodes
  before a user gesture. `audioStatus().moth` reports the attached layer's
  status; `audioStatus().echo` reports the selected echo map.

### In-world wiring (`app/page.tsx`)

The page registers a deferred factory that builds `MothAudioBank` + `MothAudio`
with the real context and the `ambience`/`effects` buses. The layer is inert
with no context, before a clip decodes, or under reduced motion; the settings
reduced-motion toggle forwards through `SynthAudio.setMothEnabled`.

| Asset | Bus | Where it plays | Notes |
| --- | --- | --- | --- |
| `bed-ritual` | `ambience` | menu, explore and results | low gain (`0.4`), loop points `0.5–10.5 s`; combat keeps the score/SFX space |
| `moth-victory` / `moth-defeat` | `music` (lead voice) | results screen | via `MusicEngine.setMotif` + the results `leadMotif`; a win and a loss load different takes |
| `arena` (echo map) | `effects` send | all arenas | `setEchoMap` retunes the gunfire/explosion delay tail; `depth` drives feedback |
| `void` IR | `music` convolver | `neon-vertical`, `aether`, `ironfall-megastructure` | the other five spaces come from the open-air default and the interior map table |

**Why a lead motif, not a stinger.** The baked `moth-victory`/`moth-defeat`
records are note data (MIDI), not decodable WAV clips, so
`MothAudio.playStinger` (which plays a decoded bank buffer) cannot voice them.
`MusicEngine.setMotif` is the contract that consumes motif records, and the
results arrangement already reacts to `setOutcome`; adding `leadMotif: true`
lets that scene prefer the outcome take while keeping `COCS_MOTIF` as its
static fallback. The arena echo map is applied to `SynthAudio`'s existing
effects send (the node graph gunfire already uses) rather than MothAudio's own
unconnected delay graph; `MothAudio.setSpace` still records the active map for
`status()`.

## Moth soundtrack (`game/music.mjs`)

The procedural soundtrack can play a **Halo-flavoured pack** selected with
`MusicEngine.setSoundtrack('halo')` (exposed on the audio host as
`SynthAudio.setSoundtrack`). It is deliberately original material — slow modal
ritual music in D natural minor with a choir-like detuned pad, a low open-fifth
drone, tribal taiko drums and glassy bell accents — and it does not reproduce any
existing theme. `SynthAudio.setReverbUrl(url)` fetches and decodes a baked
`retrocausal-echo` WAV into a `ConvolverNode` on the music bus, opening the mix
into the room; `SynthAudio.setSpace(name)` selects the baked response by name
and the view re-applies it whenever the arena changes. `app/page.tsx` opts the
game into the halo pack and a `cavern` fallback; the engine's baseline tables
are unchanged so unit tests stay pinned.

## Showcase (`/moth`)

`app/moth/page.tsx` renders the baked assets as a gallery: tiled textures, normal
maps, LUT swatches, the equirect sky, animated effect frames, the quantum arena
graph, the entropy certificate, playable motif previews, the IR player, and a
provenance table listing every engine and job id. It reads `MOTH_BAKED` directly
and decodes base64 to `data:` URLs client-side; no runtime dependencies.

## Level generation (`game/moth-maps.mjs`)

`buildMothArena(graph)` maps a labyrinth graph onto a room grid: nodes become
rooms, coupled neighbours become doorways, each node's measured Bloch vector
drives its decoration, and radiating qubits host objectives. Quantum couplings
author the doorways, and the builder adds the minimal extra doors needed so no
room is ever an island. Doors and cell centres are sized to the 6 m navigation
grid the simulation walks on, so every doorway is genuinely passable.

```js
import { mothArena } from './game/moth-maps.mjs';
const arena = mothArena();           // null until configureMothAssets() runs
```

The arena is deterministic: the same graph always yields the same geometry. It
is **not** auto-registered in `game/maps.mjs` — call `mothArena()` and add it to
the rotation yourself if you want it selectable.

## Costs and limits

The API exposes no credit balance, only per-engine `credits_per_run` (0–5) and a
storage quota (`GET /api/v1/me/storage`). Track spend from the manifest. Training
artifacts (`state`/`model`) can be reused via `input_files: { slot: "job:<id>/slot" }`
to generate many takes without re-paying for training.

## Adding a job

Append an entry to `assets/moth/manifest.json`:

```json
{
  "id": "blur-metal",
  "engine": "blur-v1",
  "enabled": true,
  "input": { "image": "sources/panel.png" },
  "params": { "strength": 0.6, "style": "ry", "reach": 0, "size": 256, "downscale": true },
  "raw": "blur-metal",
  "bake": { "type": "texture-tile", "name": "brushed_metal", "size": 48 }
}
```

Then `MOTH_API_KEY=... node scripts/moth-bake.mjs run --only blur-metal`. The
`bake.name` for a texture must be a canonical kind from `TEXTURE_KINDS` in
`game/textures.mjs` if you want it to override that surface.

### Source patterns and value generators

The image engines consume PNGs from `assets/moth/sources`. `makeSourceArt`
renders them locally and deterministically (no API key, no credits) from
wrapping value noise, so art iteration is free: edit `SOURCE_ART`, run
`sources`, and only pay when a job is submitted. `pattern` selects the family:
`noise` (wrapping natural material, the default), `panels` (`panels`: plate grid
with dark seams), `rivets` (`panels`: plate grid plus bolt rows along the seams),
`circuit`, `stripes`, `corrugated` (`ribs`: rolled sinusoidal sheet), `grating`
(`cells`: bright bars around dark square voids), `diamond` (`cells`: diamond
tread crosshatch), `weave` (`cells`: 2x2 carbon twill), `mesh` (`cells`:
expanded-metal slit lattice) and `stars` (`cloudFreq`, `starDensity`: equirect
star band for skies). Shared knobs: `seed`, `size`, `wide`, `palette`,
`contrast`, `freq`.

`makeSourceAudio` renders the deterministic, original mono seed WAV that
`qrc-audio-v1` consumes (`sources/bed-seed.wav`) — the audio analogue of
`makeSourceArt`. Kinds are `drone` (a slowly evolving partial stack with soft
pulses; the default), `noise` (a smoothed noise bed) and `pulse` (decaying
periodic pulses); shared knobs are `seconds`, `sampleRate`, `seed`,
`sampleFormat` and `fadeSeconds`, plus kind-specific ones. It is a pure function
of the spec, so the seed is free, committed and reproducible.

`audio-clip` writes its processed WAV next to the raw result and records a
descriptor (`url`, `seconds`, `sampleRate`, `channels`, `loopStart`, `loopEnd`,
`gain`) rather than base64, so beds never bloat `game/moth-baked.mjs`. Set
`embed: true` only for tiny cues. Useful bake options: `trim`/`threshold`/`pad`,
`trimStart`/`trimEnd`, `mixdown`, `maxChannels`, `targetSampleRate`,
`maxSeconds`, `normalize`/`peak`, `gain`, `loopStart`/`loopEnd`, `detectLoop`
with `loopSearch`/`loopWindow`/`loopThreshold`, `loopCrossfade`, `url`/`urlBase`
and `meta` (routing hints). `echo-map` reads the same envelopes recursively and
emits `{ lattice, sites, depth, seed, count, taps }` into the `spaces` bucket
with `maxTaps`/`includeZ`.

blur-core-v1 never receives a grid through the manifest; `generateValues`
synthesizes one so the job stays deterministic and offline: `height`
(`kind`: `noise` | `ridge` | `cells`) for normal-map relief, `radial`
(`frame`, `seed`) for the expanding shock ring behind `quantum-rift`, `portal`
(`frame`, `seed`) for expanding rings with angular spokes and a hot core behind
`arc-burst`, and `spark` (`frame`, `seed`) for a bright core with radiating
needle rays behind `spark-impact`.

The pass-3 effect sheets add six generators, each with a distinct silhouette;
all take `size`, `frame` and `seed` and return a bounded, deterministic grid:

| `type` | Silhouette | Effect sheet |
| --- | --- | --- |
| `bloom` | turbulent core inside an expanding shock ring | `effect-explosion` |
| `vortex` | swirling arms around a hot core | `effect-teleport` |
| `contract` | contracting ticked ring that fills inward | `effect-capture-ring` |
| `rise` | deterministic motes climbing a soft column | `effect-heal` |
| `shield` | expanding hexagonal facet shell | `effect-shield` |
| `snow` | flakes drifting down and sideways (wrapping) | `effect-weather-snow` |

Baked effect frames accept a `tint` (`quantum`, `ember`, `plasma`). The
pass-3 sequences are three frames each at 10–14 fps.

### Reverb spaces

`retrocausal-echo-v1` bakes one IR per `bake.name`. Besides `cavern` (the
original), the manifest carries `open-air` (short, early reflections),
`tunnel` (chain-lattice slapback, metallic), `hall` (medium square-lattice
diffusion) and `cathedral` (long, tall, slow build). Each is a small
same-origin WAV plus its tap map. `mothSpaceFor(arenaId)` maps arenas to a
space and `SynthAudio.setSpace(name)` swaps the convolution response on the
music bus, so the tail follows the room; an unknown or unbaked space falls
back to `cavern` and a missing registry leaves the wired URL untouched.
