# Moth Quantum asset pipeline

The game can bake presentation assets from [Moth Quantum](https://mothquantum.com)
engines and load them at runtime. Everything is generated **offline**, decoded
with zero dependencies, and committed as data, so the shipped game stays
deterministic, offline, and free of new runtime dependencies.

- `scripts/moth-bake.mjs` — submits jobs to the Moth Atlas API, polls them,
  downloads and decodes the results, and writes `game/moth-baked.mjs`.
- `assets/moth/manifest.json` — the list of jobs to run (engine, params, inputs,
  and how to turn each result into game data).
- `game/moth-assets.mjs` — the pure runtime reader the game imports.
- `game/moth-maps.mjs` — turns a baked quantum labyrinth graph into a playable
  arena.
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

# Generate the local source art that image engines consume.
MOTH_API_KEY=... node scripts/moth-bake.mjs sources

# Run every enabled job in the manifest and rewrite game/moth-baked.mjs.
MOTH_API_KEY=... node scripts/moth-bake.mjs run

# Re-run a single job, or force a fresh submission (otherwise it reuses the
# recorded job id / looks for an existing result).
MOTH_API_KEY=... node scripts/moth-bake.mjs run --only blur-panel --force
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
| `retrocausal-echo-v1` | 2 | WAV impulse response | **convolution reverb** for the soundtrack (`irs.cavern`) |
| `qrc-midi-v1` / `blur-midi-v1` | 5 / 1 | MIDI | **motif data** for the soundtrack (`motifs.*`) |
| `comet-qrng-v1` | 5 | random bytes + entropy certificate | provably-fair seeds |
| `qrc-image-v1` | 5 | animated GIF | animated textures, loading art |
| `qrc-audio-v1` | 5 | WAV | ambient beds, echo tails |

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

## Runtime API (`game/moth-assets.mjs`)

Nothing is active until `configureMothAssets()` is called; without it every
accessor returns `null` and the game falls back to its procedural generators.

```js
import { configureMothAssets, mothAssetsStatus } from './game/moth-assets.mjs';
configureMothAssets();               // defaults to the generated MOTH_BAKED
mothAssetsStatus();                  // { active, version, textures, normals, materials, sky, effects, levels, seeds, motifs, irs }

mothSurfaceOverride('weathered_concrete'); // albedo { width, height, data } | null
mothNormalOverride('rock');                // baked normal map | null
mothMaterialLut('entanglement');           // { size, r, t } | null
mothSky('nebula');                         // equirect { width, height, data } | null
mothEffect('quantum-rift');                // { fps, frames:[{width,height,data}] } | null
mothIr('cavern');                          // { url, seconds, sampleRate, channels, taps } | null
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

## Moth soundtrack (`game/music.mjs`)

The procedural soundtrack can play a **Halo-flavoured pack** selected with
`MusicEngine.setSoundtrack('halo')` (exposed on the audio host as
`SynthAudio.setSoundtrack`). It is deliberately original material — slow modal
ritual music in D natural minor with a choir-like detuned pad, a low open-fifth
drone, tribal taiko drums and glassy bell accents — and it does not reproduce any
existing theme. `SynthAudio.setReverbUrl(url)` fetches and decodes the baked
`retrocausal-echo` WAV into a `ConvolverNode` on the music bus, opening the mix
into a cavern. `app/page.tsx` opts the game into the halo pack and the `cavern`
IR; the engine's baseline tables are unchanged so unit tests stay pinned.

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
