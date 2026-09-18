# Moth audio plan

**Status:** RESEARCH + PLAN. No credits were spent and no live bakes were run while
producing this document. The only paid-tier call made was the free `catalog` command.

**Deliverables:** this plan and [`moth-audio-manifest.json`](./moth-audio-manifest.json)
(a proposed job list to merge into `assets/moth/manifest.json`).

> **Implementation status (offline plumbing landed).** The game pipeline now
> mirrors the generic `mothbake` mechanisms described in §4–§5:
> `scripts/moth-bake.mjs` carries a dependency-free WAV codec, a recursive
> `tapsFrom()` extractor (fixing the `extras.taps` bug so `irs.cavern.taps` is no
> longer `[]`), an `audio-clip` baker (descriptor + hosted URL, loop detection,
> resample/trim/gain), an `echo-map` baker, a deterministic `makeSourceAudio`
> seed generator, the `audio`/`spaces` buckets, and an offline `repair` command
> that rebuilds `ir`/`echo-map` records from committed raw results with no API
> call. The runtime readers live in `game/moth-assets.mjs`
> (`mothAudioClip`/`mothAudioNames`/`mothEchoMap`) and the Web Audio bank/player
> in `game/moth-audio.mjs`. The three minimum-pipeline-proof jobs
> (`ir-openair`, `echo-arena`, `bed-ritual`) are committed to the game manifest
> as `enabled: false`; the 8-credit proof batch runs them once. See `docs/MOTH.md`
> for the shipped API and options. The remaining §4.5 asset-id chaining and the
> §4.2 `audio-stitch` baker are still deferred.

**Method / sources**

1. Free `catalog` command (`node bin/mothbake.mjs catalog`, 2026-09-17) for credits and I/O types.
2. Public OpenAPI at `https://api.mothquantum.com/openapi.json` — `moth-api v0.41.0` (the
   prior research snapshot was v0.39.0; the audio parameter contracts are unchanged in
   substance). Read unauthenticated; no account traffic.
3. This repo: `docs/MOTH.md`, `scripts/moth-bake.mjs`, `assets/moth/manifest.json`,
   `game/music.mjs`, `game/feedback.mjs`, `game/moth-assets.mjs`, `game/moth-baked.mjs`,
   `game/environment.mjs`, `app/page.tsx`, `public/moth/files/ir-cavern/*` (actual result
   envelopes).
4. `mothbake` at `79a7684`: `README.md`, `docs/ARCHITECTURE.md`, `docs/SYNC.md`,
   `src/decoders/{wav,zip}.mjs`, `src/bakers/{audio-clip,ir}.mjs`, `src/emitters/{atlas,files}.mjs`,
   `src/runner.mjs`, `src/api.mjs`, `examples/manifest.json`.
5. The in-flight **sampled-orchestra** work on `feat/music-sampler` / `feat/music-samples2`
   (`game/sampler.mjs`, `scripts/music-bake.mjs`, the `MusicEngine` master chain). This work is
   **not in this worktree at `7be5f76`** — see §3.0.

> **Terminology.** "Bed" = a long, loopable ambience layer. "Stinger" = a short musical
> outcome/flourish cue. "Tail" = a decaying echo/depth send. "Space" = a convolution/
> delay configuration. "IR" = impulse response.

---

## 0. Executive summary

- The catalog exposes **five audio-relevant engines** with real value here, plus two
  sequence engines:
  | Engine | cr | I/O | Audio role |
  | --- | ---: | --- | --- |
  | `retrocausal-echo-v1` | 2 | form-data → wav | **spaces/IRs and echo tails** (WAV + `ir` + `taps` JSON) |
  | `otoc-echo-v1` | 1 | json → json | **tap maps** that drive delay scheduling (cheap, no audio) |
  | `qrc-audio-v1` | 5 | form-data → wav | **ambient beds, stingers, room-tone** (WAV from chunk vocabulary) |
  | `qrc-midi-v1` | 5 | form-data → midi | **motifs** with a reusable trained `model` |
  | `blur-midi-v1` | 1 | json → midi | **cheap motif variants** |
  | `qrc-train-v2` / `qrc-gen-v2` | 5 / 1 | json → json / form-data → json | token-sequence variation (P2; not audio assets) |
- **The cheapest way to prove the whole pipeline is `retrocausal-echo-v1`.** It needs no
  input audio, returns a WAV we already know how to serve/decode/reverb (the `cavern` IR),
  and is only 2 credits. One new space + one `otoc-echo` tap map (1 cr) + one `qrc-audio`
  bed (5 cr) exercises every new code path for **8 credits**.
- **`qrc-audio-v1` is the only engine that emits a *new* audio artifact.** It consumes an
  audio file (or a ZIP of WAV chunks) and returns a re-sequenced WAV. It has **no
  committed source input today**, so the pipeline needs a **deterministic, free, original
  source-audio generator** (the audio analogue of `sources/motif.mid`) before the first
  `qrc-audio` job can run.
- **Never embed beds in `game/moth-baked.mjs` as base64.** The module is already 733 KB.
  Audio must be same-origin files with a small descriptor (`url`, `seconds`, `sampleRate`,
  `channels`, `loopStart`, `loopEnd`), exactly like the existing `ir` record. The sampled
  bank already proves this pattern with `/music/manifest.json`.
- **Moth audio must be additive.** It must not replace the procedural SFX, the note-based
  `MusicEngine`, or the CC0 sampled orchestra. It should layer *under* them: an ambience/
  texture bed, extra spaces, more motif variants, and optional accents. With no
  `AudioContext`, on reduced-motion, or when the bank has not decoded, Moth audio stays
  inert and the game sounds exactly as it does today.
- **Concrete SYNC bug found:** the game's `ir` baker looks for taps at `parsed.taps` /
  `parsed.ir`, but the real envelope puts them at `extras.taps`. Result: the shipped
  `irs.cavern.taps` is `[]`. `mothbake`'s recursive `tapsFrom()` would find them. Fixing
  this is part of §5 parity.

### 0.1 Proposed first batch (20 credits, ~2–3 MiB)

| Job | Engine | cr | Output | Consumer |
| --- | --- | ---: | --- | --- |
| `ir-openair` | retrocausal-echo | 2 | 1.5 s stereo IR | `SynthAudio.setReverbUrl` / per-map space |
| `ir-tunnel` | retrocausal-echo | 2 | 3.5 s stereo IR | long corridor reverb for `substation`/`tunnel` |
| `ir-void` | retrocausal-echo | 2 | 5 s stereo IR | the Void/neon maps; also room-tone source |
| `echo-arena` | otoc-echo | 1 | tap map | drives `SynthAudio.space` delay/feedback |
| `echo-tunnel` | otoc-echo | 1 | tap map | drive-by gunfire tails |
| `motif-victory` | blur-midi | 1 | MIDI | `MusicEngine.setMotif` on the results screen |
| `motif-defeat` | blur-midi | 1 | MIDI | `MusicEngine.setMotif` on defeat |
| `bed-ritual` | qrc-audio | 5 | 12 s mono bed | `ambienceBus`, menu/explore |
| `bed-combat` | qrc-audio | 5 | 12 s mono bed | `ambienceBus`, combat intensity |

Deferred jobs (weather, per-biome, stingers, vocalisations, more IRs, `qrc-midi` fan-out,
`qrc-train`/`qrc-gen`) are listed in the proposed manifest and costed in §7. **Full audio
pass ≈ 160 credits / ~25–30 MiB**, staged.

---

## 1. Engine capability map

All run `mode: "emu"` (Aer) by default; only `otoc-echo-v1`/`retrocausal-echo-v1` expose a
`machine`/`via` path to IBM hardware, which this plan deliberately avoids. Credits are per
`/process` submission.

### 1.1 `retrocausal-echo-v1` — 2 cr — `form-data` → `wav`

The measurement (`quantum_echo.measure_ir`) turned into audio by `MultiTapDelay`. Two ways
in: no `ir` input → it measures in-process and renders; with an `ir` input → it rebuilds
the trajectory (`EchoIR.from_trajectory`) and re-renders, **every echo/measurement param is
ignored** (renderer params — audio, `bpm`, polarity, `feedback`, `mix`, `max_regen` — still
apply).

- **Input slots:** `audio` (WAV/MP3/OGG/FLAC; stereo summed to mono), `ir` (a previous
  trajectory JSON, by asset id).
- **Key params:** `emit` (`audio`|`map`), `ir_seconds` (default 3), `sr` (default 44100;
  ignored when `audio` supplied), `output_format` (`pcm_16`|`pcm_32`|`float_32`),
  `master_ms` (640), `bpm`/`division`, `depth` (8), `decay` (0.9), `feedback` (0–1, convergent),
  `feedback_source` (`kick`|`all`), `mix` (0.6), `diffusion_ms`, `min_level`, `max_regen`,
  `negative_mode` (`invert`|`reverse`|`phase`), `stereo_width`, `tail_ms`, `theta_x/z/zz`,
  `disorder`, `seed`, `kick`, `lattice` (`chain`|`square`), `n_sites`/`width`+`height`,
  `include_tap_map`, `ref_floor`, `shots`, `exact`, `twirls`, `machine`/`via`.
- **Outputs (verified from `public/moth/files/ir-cavern`):**
  - `result` → `result.wav`
  - `ir` → trajectory envelope `{ result_type:"trajectory", data:{observables,sites,steps,times,series}, extras:{taps,spec,summary,…}, provenance }`
  - `taps` → media envelope `{ result_type:"media", data:{media_type, sample_rate, channels, format, frames, duration_s, peak, rms, files}, extras:{taps,…} }`
- **Determinism:** Aer `exact: true` (default) ignores `shots`; `seed` + `disorder` (the
  only lever that makes `seed` audible) fix the realisation. Same params → same bytes, in
  principle. Confirm with a probe before relying on byte-equality.
- **Quirks:** `mix:1` = wet only; `feedback` normalises first, so 0.6 is stable;
  `negative_mode:"phase"` is the only mode that uses `F_im` (pair it with `theta_z>0`);
  `lattice:"square"` adds `x`/`y` to each tap (diffusion on y) and needs `width`+`height`.
- **Game use:** more convolution spaces; a second "space send" for the effects bus;
  echo/tail character for explosions; own-IR as a rough room-tone.

### 1.2 `otoc-echo-v1` — 1 cr — `json` → `json`

The **core** measurement (`measure_ir` → `EchoIR.to_trajectory`). No input files, output
is the same trajectory envelope as above (inline `result`, no WAV).

- **Key params:** `depth` (1–32, default 8), `lattice` (`chain`|`square`), `n_sites` (8) or
  `width`+`height`, `kick` (`X`|`Y`|`Z`), `kick_site`, `theta_x/z/zz` (defaults
  `0.9424777960769379` / `0` / `1.0995574287564276`), `disorder` (0), `seed`, `shots` (4096),
  `exact` (true), `include_taps` (true), `include_z` (false), `min_tap_level` (0.02),
  `ref_floor`, `twirls`, `machine`/`via`.
- **Tap shape:** `{ site, depth, F_re, F_im, level, polarity, x?, y? }`, filtered by
  `min_tap_level`. `include_z` completes a Bloch vector per site.
- **Determinism / quirks:** pure params, so trivially reproducible; `disorder` is the only
  seed-sensitive knob. `exact:true` on Aer makes shots irrelevant. 1 credit makes it the
  cheapest way to get a tap map.
- **Game use:** feed `SynthAudio`'s delay/feedback (`this.space`) — per-map tap times and
  pan/level instead of a fixed 160 ms delay — and provide cheap `ir` inputs to
  `retrocausal-echo` for re-renders without re-measuring.

### 1.3 `qrc-audio-v1` — 5 cr — `form-data` → `wav`

One call trains a reservoir over a vocabulary of audio **chunks**, generates a new ordering,
and concatenates them into one WAV. Chunk filenames are the tokens.

- **Input slots:** `audio` (a raw file it splits with `chunk_seconds`), `chunks` (a ZIP of
  WAV chunks), `model` (a pristine model from a prior run).
- **Params:** `chunk_seconds` (1), `length` (chunks, default 10, ≤500), `crossfade` (0–1000 ms),
  `loop` (default true; **learning only** — end flows into start), `quality`
  (`instant`|`fast`|`moderate`|`complete`, default `moderate`), `seed` (uint32|null),
  `training_sequence` (chunk filename order), `variation` (default 1).
- **Three paths:** no `model` + `quality!="instant"` → train and emit `model` **and** `state`;
  no `model` + `instant` → untrained shuffle, `state` only; `model` → an independent take
  varying `seed` (or `state` → continue a trajectory). `vocabulary` (the chunk ZIP) rides
  along.
- **Derived output:** WAV = `length × chunk_seconds` (minus/plus crossfade). Sample rate
  and channels are **inherited from the input** (inferred — `sr` is not exposed); control
  size by feeding mono 22.05 kHz. Formats/slots beyond `result` are not documented for this
  engine (the equivalent `qrc-midi` emits `result` + `model` + `state`); flag as unknown.
- **Determinism / quirks:** fixed `seed` fixes the reservoir; `variation` is musical, not
  stochastic. No `sr` knob; chunk boundaries at exact `chunk_seconds` unless crossfaded.
  Output is not guaranteed sample-seamless at the head/tail even with `loop:true`.
- **Game use:** ambient beds, weather loops, stingers, room-tone, vocalisations — all from
  one committed, original seed bed.

### 1.4 `qrc-midi-v1` — 5 cr — `form-data` → `midi`

Like `qrc-audio` but tokens are `pitch_duration` note pairs. Inputs `midi`, `model`.
Params `bpm` (120), `length` (notes, 10), `loop`, `quality`, `seed`, `variation`, `velocity`.
Outputs `result` (MIDI) + `model` (JSON) + `state` (JSON) — verified in
`public/moth/files/motif-oracle`. Reuse the recorded `model` to fan out takes without
re-training (saves *time*, not credits: each `process` is still 5 cr).

### 1.5 `blur-midi-v1` — 1 cr — `json` → `midi`

Unitary quantum blur of a MIDI piano roll. Params `strength` (0.5), `reach` (0),
`qubits` (4–20), `threshold` (0.1), `resolution` (0, auto), `margin` (0.15), `mask`.
Input `midi`. Output `result` (MIDI). No seed; deterministic (statevector). The cheapest
and best value-per-credit way to get **motif variants** that still resemble the seed motif.

### 1.6 `qrc-train-v2` (5 cr) / `qrc-gen-v2` (1 cr)

Train a QRC on a token `sequence` (inline JSON) and emit a reusable `state`; generate a new
sequence from `state`. No audio output. Useful for procedural *systems* (bot barks, level
tokens, drum-pattern tokens) but **not** an audio-asset engine; P2. Note the naming quirk:
the v2 engine IDs describe themselves as "qrc-train-v1"/"qrc-gen-v1" in their descriptions.

### 1.7 Cross-engine comparison

| | retrocausal-echo | otoc-echo | qrc-audio | qrc-midi | blur-midi |
| --- | --- | --- | --- | --- | --- |
| Credits | 2 | 1 | 5 | 5 | 1 |
| Input | WAV + IR json | none | WAV or ZIP | MIDI | MIDI |
| Output | WAV + json | json | WAV (+model/state?) | MIDI (+model/state) | MIDI |
| Deterministic key | seed + disorder | seed + disorder | seed + input | seed + input | none |
| QPU path | yes (avoid) | yes (avoid) | no | no | no |
| Size driver | `ir_seconds × sr × ch` | taps × 6 fields | `length × chunk_seconds` | negligible | negligible |

---

## 2. What audio this game should generate (prioritised)

Priority is value-to-effort for *this* game. **P0** = do in the first batch, **P1** = first
full pass, **P2** = later/conditional, **P3** = skip.

| Pri | Asset | Engine + param sketch | cr / clip | ~Size | In-game consumer (event → bus) |
| --- | --- | --- | ---: | --- | --- |
| **P0** | Additional convolution spaces (`open-air`, `tunnel`, `void`) | `retrocausal-echo`, `emit:audio`, `ir_seconds` 1.5–5, `sr:22050`, `pcm_16`, square/chain, `include_tap_map:true` | 2 | 0.3–0.7 MB each | per-map reverb → `SynthAudio.setReverbUrl(url, wet)` / `loadMusicReverb`; map → space mapping like `mothAtmosphereFor` |
| **P0** | Tap maps for the delay send | `otoc-echo`, `chain`/`square`, `depth` 8–12, `disorder` 0.15–0.25, fixed `seed` | 1 | ~5–20 KB | `SynthAudio.space` delay/feedback/gain; per-map echo character |
| **P0** | Motif variants (`victory`, `defeat`, `menu`) | `blur-midi`, `strength` 0.25–0.5, `reach` 0.15–0.35, `qubits:20` | 1 | ~1 KB | `MusicEngine.setMotif` for the results/defeat scenes |
| **P0** | Ambient beds (`ritual`, `combat`) | `qrc-audio`, seed WAV, `chunk_seconds:1`, `length:12`, `crossfade:120`, `loop:true`, `seed` fixed | 5 | ~0.4–0.9 MB each | `ambienceBus`; crossfaded by `setScene`/`setIntensity` |
| **P1** | Per-biome beds (`hot`, `cold`, `night`, `default`/`storm`) | `qrc-audio`, different `seed`/`variation`; map via `biomeAmbience(arena).mood` | 5 each | as above | `ambienceBus`; `SynthAudio.setBedMood(mood)` |
| **P1** | Weather loops (`rain`, `storm`, `ash`) | `qrc-audio`, `WEATHER_PRESETS[kind].audio` mood | 5 each | as above | `ambienceBus`; weather system (`selectWeather`) |
| **P1** | Outcome stingers (`victory`, `defeat`, `objective`) | `qrc-audio`, short (`chunk_seconds:0.5`, `length:3–4`) | 5 each | ~0.1 MB | layered with `SynthAudio.sting(outcome)`, routed to `effectsBus`/music bus with `setDuck` |
| **P1** | Room-tone beds | `retrocausal-echo` own IR or a very quiet `qrc-audio` bed | 2–5 | ~0.3 MB | `ambienceBus`, low gain, continuous |
| **P1** | `qrc-midi` motif fan-out (`mender`, `enemy-flank`) | `qrc-midi` train once, reuse `model`, vary `seed` | 5 / take | ~1 KB | `MusicEngine.setMotif` on enemy/boss beats |
| **P2** | Weapon/explosion **tails** | `retrocausal-echo` processing an uploaded SFX, or reuse an IR as a space send | 2 | 0.3–0.7 MB | a second convolver/send on the `effectsBus`; per-weapon `negative_mode` |
| **P2** | Creature/NPC vocalisations (mender, boss phases) | `qrc-audio` from a short vocal-ish seed | 5 | ~0.1 MB | boss-phase/event → `effectsBus`, panned, distance-attenuated |
| **P2** | UI/terminal/interaction cues | `qrc-audio`, ≤0.5 s | 5 | ~0.05 MB | HUD/menu only if a distinct quantum character is wanted |
| **P2** | Token sequences (patterns/barks) | `qrc-train-v2` + `qrc-gen-v2` | 5 + 1 | tiny | drives synth parameters, not audio files |
| **P3** | Whole adaptive music tracks | — | — | — | keep `MusicEngine`; use beds as texture only |

**Explicitly not Moth audio:** footsteps, gunshots, impacts, reloads, movement foley, the
procedural ambience noise bed, the note-based soundtrack, and the CC0 sampled orchestra.
Those are already deterministic, cheap, and tuned; Moth audio layers *behind* them.

### 2.1 Why beds should be mono 22.05 kHz

`AudioBufferSourceNode` + `decodeAudioData` handles WAV natively, and 22.05 kHz mono is
small and sufficient for ambience (the existing `cavern` IR is already 22.05 kHz). A 12 s
mono bed is 441 KB on disk / ~1.1 MB decoded as Float32; stereo at 44.1 kHz would be 3.5×
that. If the owner later wants Ogg, transcode with the existing `music-bake.mjs` ffmpeg
path (CC0 bank) rather than adding a codec to the zero-dependency pipeline.

---

## 3. Best application architecture

### 3.0 Protect what exists (and the branch it lives on)

The **CC0 sampled orchestra and the music-bus/limiter master chain live on
`feat/music-sampler` (tip `8229f89`) / `feat/music-samples2` (`9fa5231`), not in this
worktree at `7be5f76`.** At `7be5f76`, `game/sampler.mjs` does not exist and `MusicEngine`
has no `musicBus`/limiter/master chain. The plan therefore targets both:

- **Current tree (`7be5f76`):** `SynthAudio` owns `master → muteGain → destination`, with
  `effectsBus` + `ambienceBus` and a music engine wired directly to `master`.
- **Sampler tree:** `SynthAudio` gains a real `musicBus` between the engine and `master`
  (`this.musicBus → master`), plus `setOutcome`, reverb wet 0.30 and a limiter/soft-clip
  master chain; `MusicEngine` owns a `SampleBank` streaming `/music/*`.

**Moth audio must:**
1. Never touch `MusicEngine`'s note scheduling, sample selection, `scheduleChecksum`,
   or the sampled-instrument path.
2. Route beds to `ambienceBus` (or a new `mothBus` that feeds `master`), never into the
   orchestra's voice path.
3. Be entirely inert when `AudioContext` is missing, `reducedMotion` is on, the bank has
   not loaded, or the device is a low-memory tier.
4. Keep the sampled bank's deterministic contract: the bank never picks notes; Moth bed
   selection must use the engine's seeded RNG or a fixed scene mapping, never `Math.random`.
5. Stay out of Node tests (no decodable context → inert), so all pinned checksums survive.

### 3.1 Baked assets, no runtime API

Everything is generated offline, committed, and served same-origin. No runtime Moth API
call, no key, no new runtime dependency. This mirrors `docs/MOTH.md` and the sampled bank.

### 3.2 Runtime layout

```
public/moth/files/<job>/result.wav        # raw engine output (already how the IR works)
public/moth/audio/<job>/result.wav        # (optional preferred layout for new audio jobs)
game/moth-baked.mjs                       # descriptors only: url, seconds, rate, loop, gain
game/moth-assets.mjs                      # pure readers: mothAudio(name), mothEchoMap(name)
game/moth-audio.mjs                       # NEW: Web Audio bank + player (mirrors sampler.mjs)
game/feedback.mjs  SynthAudio              # owns a MothAudio instance; new hooks
app/page.tsx                               # opt-in wiring (per-map IR, bed, motif)
```

`game/moth-assets.mjs` stays pure (no I/O, no Web Audio), matching its current contract. The
new `game/moth-audio.mjs` is the Web Audio half:

```js
// Proposed (not implemented) public surface
export class MothAudioBank {          // like SampleBank: lazy fetch/decode cache
  loadManifest(url) / preload(name) / preloadGroup(group)
  isReady(name) / isPending(name) / state(name)
  clip(name) -> descriptor / buffer(name) -> AudioBuffer
  status() / dispose()
}
export class MothAudio {              // owned by SynthAudio, like musicEngine
  constructor({ctx, destinations:{ambience, effects, music}, manifest, seed})
  setScene(scene) / setIntensity(x) / setBedMood(mood) / setWeather(kind)
  playBed(name,{bus,fade,loop,gain}) / playStinger(name,{bus,duck,pan})
  setSpace(name)                      // loads echoMap into SynthAudio.space (or an IR convolver)
  update(dt) / status() / dispose()
}
```

Why a separate module: `moth-assets.mjs` must remain import-safe in Node and SSR;
`music.mjs`/`feedback.mjs` are already large. `MothAudio` mirrors the sampled bank's
`SampleBank` (lazy, non-blocking, remembered failures, best-effort fallback), so the two
audio systems read the same way.

### 3.3 Loop-point semantics

- Descriptors store `loopStart`/`loopEnd` in **seconds from the start of the trimmed clip**,
  matching both the `audio-clip` baker and `game/sampler.mjs` (`loopWindow()` →
  `AudioBufferSourceNode.loopStart/loopEnd`).
- Play a bed as: `source.loop = true; source.loopStart = d.loopStart ?? 0;
  source.loopEnd = d.loopEnd ?? d.seconds;` after a one-shot intro region `[0, loopStart)`
  if a lead-in is desired.
- Because `qrc-audio`'s `loop` is learning-only, the bake tool should find a seam
  (`detectLoop`) and, if needed, apply an equal-power crossfade of the tail into the head,
  then place the loop window *inside* the crossfade; this is exactly what `music-bake.mjs`
  does for sustained samples. Until that lands, bake beds with explicit loop points and a
  short `crossfade`.

### 3.4 Preloading and adaptive layering

- **Preload per scene, lazily.** `setScene('game')` preloads the explore/combat beds and the
  current map's space; `menu` preloads the menu bed + motif. Never preload all clips.
- **Adaptive layering** reuses `MusicEngine`'s proven `layers` easing: keep 2–3 bed layers
  (e.g. base texture + weather + combat tension) and crossfade each with an equal-power
  ramp by scene/intensity, exactly as `_approachLayers()` eases menu/explore/combat. Moth
  beds join the same intensity signal (`SynthAudio.setIntensity`), and duck under stingers
  via `MusicEngine.setDuck`/a dedicated gain ramp.
- **No new scheduler.** Beds are `AudioBufferSourceNode` loops; stingers are one-shots.
  The frame `tick()` already drives the music engine; `MothAudio.update(dt)` handles fades
  and voice pruning.

### 3.5 Memory, decode, and fallback budgets

| Budget | Target | Enforcement |
| --- | --- | --- |
| Concurrent decoded beds | ≤ 3 | `maxBeds`, oldest evicted with a fade |
| Decoded audio resident | ≤ 12 MiB | sum of `buffer.length × channels × 4`; evict/deny |
| Committed audio on disk | ≤ 15 MiB (first pass), ≤ 30 MiB (full) | CI size test |
| Per-file | ≤ 1 MiB (beds), ≤ 0.7 MiB (IRs), ≤ 0.15 MiB (stingers) | bake-tool soft caps + CI |
| Decode time | async, never blocks a frame | fire-and-forget + `isReady` polls |
| Load impact | no new blocking fetch before first frame | lazy, on `start()`/`unlock()` |

**Fallback order:** Moth bed → procedural `BED_MOODS` bed (always present) → silence. If
`decodeAudioData` fails, latch that clip as failed (don't retry every frame) and keep the
procedural bed. If `navigator.deviceMemory ≤ 4` or `reducedMotion`, don't load Moth audio.

### 3.6 Integration with motifs and IRs

- **Motifs:** unchanged in shape; add variants (`moth-victory`, `moth-defeat`, …) and let
  scenes call `MusicEngine.setMotif(mothMotif(name))`. `qrc-midi`'s `model`/`state` output
  ids should be recorded so takes can be fanned out later.
- **IRs:** expose `mothIrNames()` (exists) and add a **map → space** resolver analogous to
  `mothAtmosphereFor()` (currently in `view.mjs`), e.g. `mothSpaceFor(mapId)`. `app/page.tsx`
  then calls `audio.setReverbUrl(mothIr(name).url, wet)` on arena load instead of hard-coding
  `cavern`. On the sampler tree, `setReverb` should stay wet ≈ 0.30.
- **Tap maps:** `SynthAudio` currently hard-codes its `space` delay (0.16 s, fb 0.34,
  wet 0.55). A `mothEchoMap(name)` descriptor can set `delay.delayTime`, `fb.gain`,
  `wet.gain`, and pan/level per weapon/map, preserving the existing node graph.
- **Room-tone:** a low-gain looped bed on `ambienceBus`, layered under the procedural bed.

---

## 4. Piping into `mothbake` (generic, de-branded)

`audio-clip` and `ir` bakers already exist. The missing pieces, in priority order:

### 4.1 Extend the `audio-clip` baker (large clips without base64)

Current `audio-clip` always embeds a base64 WAV in `value.data`. Good for tiny cues, bad for
12 s beds. Add:

- `embed` (default `true`). When `false`, omit `data` and emit `value.file` (from
  `ctx.saved.get(slot).relative`) — the same relative-path convention as `ir`.
- `url` / `urlBase` (identical placeholder semantics to `ir`:
  `{raw}`/`{slot}`/`{file}`).
- `detectLoop` (`false`) + `loopSearch` (seconds), `loopCrossfade` (seconds),
  `loopThreshold`: deterministic head/tail correlation to place `loopStart`/`loopEnd` and,
  optionally, write an equal-power stitched WAV at the seam. Explicit `loopStart`/`loopEnd`
  still win; `detectLoop` is pure and deterministic.
- Optional `targetSampleRate` / `maxSeconds` decimation/trim so beds stay small (linear
  resample is enough for ambience; document the approximation).
- `meta` passthrough (`group`, `kind`, `tags`, `bus`) so the consumer's routing is baked, not
  hard-coded.

### 4.2 New `audio-stitch` baker (WAV concatenation/stitching)

Inputs: an ordered list of WAV slots (`slots`/`order`), `crossfadeMs`, optional per-slot
`gain`. Emits one `audio-clip`-shaped record (base64 or file reference). Needed to splice
several engine outputs or seed sections into one bed, and to build longer loops from short
model takes. Pure over decoded samples.

### 4.3 New `echo-map` baker

Reads the `otoc-echo` / `retrocausal-echo` trajectory envelope (inline result or a JSON
slot) and emits:

```jsonc
{ "bucket": "spaces", "key": "arena",
  "value": { "lattice": "square", "sites": 20, "depth": 8,
             "taps": [ { "site": 0, "depth": 4, "level": 0.998, "polarity": 1, "x": 0, "y": 0, "fRe": 0.998, "fIm": 0.0001 } ],
             "count": 135, "seed": 12345,
             "irFile": "raw/echo-arena/result.json", "irUrl": "/audio/spaces/echo-arena/result.json" } }
```

Options `slot`, `tapsSlot`, `maxTaps`, `includeZ`, `name`, `bucket`, `url`/`urlBase` (to keep
the trajectory for chaining). It must search `extras.taps` (and `data.extras.taps`), not just
top-level `taps` — see §5.

### 4.4 New `audio-pack` emitter

Writes audio records as files plus a manifest, so a consumer gets a `public/`-style bundle:

```
<outDir>/<dir>/<bucket>/<key>.wav      # audio-clip (from data or file), ir (copy), audio-stitch
<outDir>/<dir>/<bucket>/<key>.json     # echo-map / ir descriptor sidecar (optional)
<outDir>/<dir>/manifest.json           # { version, generator, provenance, clips:{...}, spaces:{...}, irs:{...} }
```

Options `dir`, `manifest` (filename or `false`), `pretty`, `sidecar`. Deterministic,
idempotent, composes with `files`/`json`/`esm`/`atlas`.

### 4.5 Retain output asset ids and chain jobs

The runner captures `response.outputs[].output_asset_id` but discards it. `qrc-audio`/
`qrc-midi` model reuse and `retrocausal-echo` `ir` re-renders need it.

- Persist `assetId` in `ctx.saved` (`{ file, relative, contentType, assetId }`) and in
  provenance.
- Add job `inputFrom: { model: { job: "qrc-train-x", slot: "state" } }`. Resolution order:
  the referenced job's recorded `outputs[slot].assetId` → download the raw output and
  re-upload → error. (The `job:<id>/slot` alias in the API docs "may not resolve", so prefer
  asset ids.)

### 4.6 A `chunks` input builder (optional, for the ZIP input path)

`qrc-audio` accepts `chunks` (a ZIP of WAVs). `zip()` already exists. Add a source/input
builder that splits a WAV into fixed-length chunks and zips them deterministically, so the
ZIP path is reproducible and needs no external tool. The simpler first pass can use the
`audio` slot (auto-split) and skip this.

### 4.7 Deterministic source audio (unblocks `qrc-audio`)

Add `makeSourceAudio(spec)` (the audio analogue of `makeSourceArt`): a pure function of
`{ seed, seconds, sampleRate, kind }` producing a small mono WAV (e.g. a slow evolving drone
with soft pulses; 4–16 s, 22.05 kHz) via the existing noise helpers + a WAV encoder and a
seeded RNG. Also expose it from the config's `sources` block so `mothbake sources` writes
`sources/seed-bed.wav`. This keeps the input 100% original and free, with no external
sample library.

### 4.8 Examples, docs, sync log

- Examples: `examples/audio.json` with recorded fixtures — an `audio-clip` (bed, `embed:false`),
  an `echo-map`, an `ir` re-render, an `audio-stitch`, and the `audio-pack` emitter. Reuse
  `test/fixtures/{clip-pcm16.wav,impulse.wav,impulse-taps.json}`.
- README: update the baker table (`audio-clip` options, `audio-stitch`, `echo-map`), the
  emitter table (`audio-pack`), and the "Animated images and audio" section.
- ARCHITECTURE: module map, decoder/baker tables, tests table.
- SYNC capability matrix: add rows for `audio-clip` `embed`/loop/url, `audio-stitch`,
  `echo-map`, `audio-pack`, output-asset-id chaining, `makeSourceAudio`.
- Sync log entry (proposed):

  > **2026-09-XX** — Audio pipeline pass. Extended `audio-clip` with `embed`/`url`/`urlBase`
  > and deterministic `detectLoop` stitching; added the `audio-stitch` and `echo-map` bakers,
  > the `audio-pack` emitter, output-asset-id capture with `inputFrom` chaining, and the
  > `makeSourceAudio` source generator. Ported generic; no engine/param choices baked in.
  > Examples and tests run offline from recorded fixtures.

---

## 5. Game-side parity (`scripts/moth-bake.mjs`)

The game pipeline must implement the *same* generic mechanisms (SYNC rule) while emitting
its own module shape. Concretely:

1. **Port the WAV codec.** Add `decodeWav`/`encodeWav`/`mixdownChannels` (and optional
   resample) from `mothbake/src/decoders/wav.mjs` — dependency-free, already tested there.
2. **Add the `audio-clip` baker**, option-compatible with mothbake (`slot`, `name`, `bucket`,
   `trim`, `threshold`, `pad`, `trimStart`, `trimEnd`, `normalize`, `peak`, `sampleFormat`,
   `loopStart`, `loopEnd`, `mixdown`, `maxChannels`, plus `embed`, `url`/`urlBase`,
   `detectLoop`), but with the game's emission convention: descriptor + same-origin URL, no
   base64 (the consumer-shape difference is the same one the `ir` baker already makes).
3. **Add the `echo-map` baker** (reads `extras.taps`, writes a compact `spaces`/`echoMaps`
   record).
4. **Fix the existing `ir` baker's tap extraction** to match mothbake: search the envelope
   recursively (`extras.taps`, `data.extras.taps`) rather than `parsed.taps || parsed.ir`.
   Today `irs.cavern.taps` is `[]` because the real taps live under `extras`.
5. **Add buckets** `audio` and `echoMaps` to the `baked` object, `writeModule`, and the
   `runManifest` bucket summary.
6. **Add `makeSourceAudio`** to `writeSources`, writing `assets/moth/sources/bed-seed.wav`
   (and, if used, a chunks ZIP), so `node scripts/moth-bake.mjs sources` is free and
   deterministic.
7. **Asset-id chaining:** record `outputAssetIds` in the manifest on write-back and accept
   `inputFrom` in `resolveResult` (reuse `model`/`ir` outputs without re-paying).
8. **Keep the module lean:** `moth-baked.mjs` carries descriptors + `/moth/files/...` URLs,
   never base64 audio.
9. **Runtime readers** in `game/moth-assets.mjs`: `mothAudio(name)`, `mothAudioNames()`,
   `mothEchoMap(name)`, `mothEchoMapNames()`, plus `audio`/`echoMaps` counts in
   `mothAssetsStatus()`.
10. **Docs:** update `docs/MOTH.md` (baker table, engine table, runtime API, "Adding a job")
    and, if the layout changes, the `public/moth` description.

### 5.1 Job manifest entries to add

See [`moth-audio-manifest.json`](./moth-audio-manifest.json). It uses the game's schema
(`input` singular, `credits`, `raw`, `bake`) and is ready to merge into
`assets/moth/manifest.json`; first-batch jobs are `enabled: true`, the rest `false` with a
`consumer` note. It deliberately reuses the existing `ir`/`motif` bakers and adds only
`audio-clip` and `echo-map`.

---

## 6. Licensing / redistribution

- **Owner's position:** treat Moth Atlas engine outputs as redistributable for this game.
  The game already commits baked outputs (`public/moth/files/*`), so the practical
  permission exists.
- **Risk:** Moth's public site publishes a privacy/compliance statement but no output
  license/terms. `mothbake` is MIT (the *tool*), and Moth's separately open-sourced tools
  (QuantumBrush, quantum-audio) are Apache-2.0, but neither automatically covers Atlas
  engine *outputs*. The owner's decision is a business/legal judgement, not a license grant.
- **Required documentation:**
  - Add a section to the repo's `THIRD_PARTY_LICENSES` (or a new
    `assets/moth/THIRD_PARTY_LICENSES.md`) recording: engine + engine version, `jobId`,
    `mode: emu`, `seed`, generation date, the output file, and the owner's decision.
    Regenerate the table from `mothProvenance()` (which already carries engine/jobId/mode/
    credits) plus a file SHA-256.
  - State plainly that Moth outputs are **not** relicensed under the game's license and are
    **not** claimed as CC0.
  - Keep the CC0 sampled orchestra attribution separate and intact
    (`assets/music/THIRD_PARTY_LICENSES.md`: VSCO-2-CE, VCSL — both CC0-1.0). Never mix the
    two attribution sets.
  - Prefer 100% original seed audio (`makeSourceAudio`) so `qrc-audio` has no third-party
    source-material obligations at all.
  - README note next to the Moth pipeline: outputs generated by Moth Quantum Atlas; rights
    subject to Moth's terms and the owner's recorded decision.

---

## 7. Budget & batching

Credits are per `/process`; model/state reuse saves training *time*, not credits.

### 7.1 Cheapest batch that proves the pipeline — **8 cr / ~0.5–1 MiB**

| Job | Engine | cr | Notes |
| --- | --- | ---: | --- |
| `ir-openair` | retrocausal-echo | 2 | exercises the existing `ir` baker + WAV serve/decode/reverb |
| `echo-arena` | otoc-echo | 1 | exercises the new `echo-map` baker + `SynthAudio.space` |
| `bed-ritual` | qrc-audio | 5 | exercises `makeSourceAudio` → upload → WAV → `audio-clip` (new path) |

(Optional free step first: `sources` generates `bed-seed.wav`; `run --dry` validates jobs.)

### 7.2 Proposed first batch — **20 cr / ~2–3 MiB**

The nine jobs in §0.1 (3 IRs + 2 echo maps + 2 blur-midi motifs + 2 beds). This covers every
engine, every new baker/emitter, both runtime consumers (reverb + ambience), and leaves the
pipeline in a state where the full pass is just more jobs.

### 7.3 Full audio pass — **≈ 150–200 cr / ~25–30 MiB**, staged

| Stage | Content | Jobs | Credits | ~MiB |
| --- | --- | ---: | ---: | ---: |
| A · Spaces & motifs | +5 IRs, +4 echo maps, +5 blur-midi motifs, +1 qrc-midi fan-out, +1 room-tone | 16 | ~26 | ~4 |
| B · Beds & weather | 6 biome beds + 3 scene beds + 3 weather loops + 2 room-tones | 14 | ~70 | ~12–15 |
| C · Stingers, cues, voices | 4 outcome stingers + 4 UI cues + 4 vocalisations + 2 slow re-renders | 14 | ~64 | ~7–9 |
| **Total** | | **44** | **≈160** | **~25–30** |

Deferral guidance: do Stage A before B/C (cheap, immediate, low risk); only do Stage C's UI
cues and vocalisations if the owner explicitly wants a distinctive Moth character in the
UI/creature space (the procedural cues are already good). Re-renders via a recorded `ir`
cost 2 cr each and need no re-measurement, so tails/spaces are the cheapest lever.

---

## 8. Verification

### 8.1 `mothbake` (offline, no key)

- **Unit tests** (`node --test`, recorded fixtures): `audio-clip` `embed:false` file/url
  emission; `detectLoop` determinism (same samples → same loop points) and crossfade output;
  `audio-stitch` concatenation/crossfade; `echo-map` extraction from `extras.taps` and
  `data.extras.taps`; `audio-pack` manifest + files (byte-for-byte golden); `zip()` chunk
  builder round-trip; `inputFrom` chaining against the mock API (asset id preferred,
  download+re-upload fallback).
- **Example** run offline (`examples/audio.json`) in `test/cli.test.mjs`.
- **Determinism:** a golden test for the emitted audio manifest; assert `zip()`/`encodeWav()`
  bytes are stable.
- **Docs drift:** the capability matrix and sync log are part of the change-set.

### 8.2 Game repo

- **Baker tests** (`game/moth-bake-audio.test.mjs`, imports the exported baker functions from
  `scripts/moth-bake.mjs`): `audio-clip` descriptor shape, loop seconds, url; `echo-map`
  extraction; `ir` taps from the real envelope; module buckets.
- **Runtime tests** (`game/moth-audio.test.mjs`, mirroring `game/sampler.test.mjs`): manifest
  parse/validation; `selectSample`-style deterministic routing; loop-window math; inert
  without a context; failed decode latched; `maxBeds`/memory eviction; `dispose`.
- **Wiring test** addition (`game/moth-wiring.test.mjs`): a fixture with an `audio` bucket +
  an `irs` bucket; assert `mothAudio('bed-ritual')` descriptor and `mothSpaceFor(map)` → IR
  selection.
- **Levels:** a dev-only `scripts/check-audio.mjs` computing peak/RMS/DC offset and an
  optional ffmpeg EBU R128 reading (mirroring `music-bake.mjs`); targets: beds −18…−14 LUFS,
  peak ≤ −3 dBFS; stingers peak ≤ −1 dBFS.
- **Size budgets (CI):** assert total `public/moth/**/*.wav` ≤ 15 MiB (first pass) / ≤ 30 MiB
  (full), each bed ≤ 1 MiB, and `game/moth-baked.mjs` growth ≤ 150 KB (descriptors only).
- **Determinism/reproducibility:** record `seed` + `jobId` + output SHA-256 in provenance;
  re-running a recorded job reproduces identical bytes.
- **Load-time impact:** a budget test asserting no Moth audio fetch/decode occurs before
  `SynthAudio.start()`, and that `MothAudio` is inert in Node (no fetch, no decode).

### 8.3 CI

- `mothbake`: keep the offline matrix (Node 20/22) green; add the new tests to the existing
  `npm test`.
- Game: `npm run test:game` picks up `game/*.test.mjs`; add a size-budget test and the audio
  fixture. No network in CI.

---

## 9. Risks and unknowns (unverifiable without spending credits)

1. **`qrc-audio-v1` result shape.** The OpenAPI documents params and the "model/state/
   vocabulary" paths, but not the concrete output slots, WAV sample format, or whether it
   emits `model`/`state` like `qrc-midi`. **Needs one 5 cr probe** before finalising the
   baker. Also confirm sample-rate/channel inheritance from the input (assumed).
2. **`qrc-audio` loop seamlessness.** `loop:true` is "learning only"; the head/tail may not
   be sample-seamless. Mitigation: `detectLoop` + crossfade (new baker feature).
3. **Aer determinism at `quality: moderate/complete`.** Fixed `seed` should reproduce a
   take, but sampling/ordering could still differ. **Needs two identical runs** (10 cr) to
   confirm byte-equality; otherwise record hashes and treat each bake as canonical.
4. **`otoc-echo` → `retrocausal-echo` chaining.** The API says an `ir` slot takes a prior
   job's trajectory, and `job:<id>/ir` "may not resolve". Need to capture the `output_asset_id`
   (planned) and verify one chained re-render (1 + 2 cr).
5. **Credits for model-reuse takes.** Assumed 5 cr per `qrc-audio`/`qrc-midi` run regardless
   of model reuse. Confirm with `catalog`/estimate if the API exposes it.
6. **Output licensing.** No published Atlas output terms; owner decision stands. Document it.
7. **Storage quota.** `GET /api/v1/me/storage` exists but wasn't queried; a full pass adds
   ~25–30 MiB, which the committed repo absorbs.
8. **Exact `qrc-audio` chunk token semantics** (filenames, ordering, per-chunk format) for the
   `chunks` ZIP path — not needed if we use the `audio` auto-split path.
9. **Size of stereo/44.1k output.** If the engine ignores a mono/22.05k seed and emits stereo
   44.1k, beds triple in size; cap with `targetSampleRate` and/or an offline transcode.
10. **`retrocausal-echo` own-IR as room-tone** is unproven as a *steady* floor; a quiet
    `qrc-audio` bed is the safer room-tone source.
11. **`qrc-train-v2`/`qrc-gen-v2` naming** (v2 IDs, v1 descriptions) suggests churn; treat as
    P2 and probe before building a sequence baker.

---

## Appendix A — Existing result envelope (verified, for baker authors)

`public/moth/files/ir-cavern/ir-json` (the trajectory, feedable back as `ir`):

```jsonc
{ "result_type": "trajectory", "schema_version": 1,
  "provenance": { "engine_id": "retrocausal-echo-v1", "backend": "aer", "mode": "emu",
                  "seed": 12345, "fractional_gates": false, "twirls": 1, "ref_floor": 0.02 },
  "data": { "observables": ["F_re", …], "sites": 20, "steps": 8, "times": [1, …],
            "series": { "F_re": […], "F_im": […], "X_kick": […], … } },
  "extras": { "lattice": "square", "width": 4, "height": 5, "kick_site": 10,
              "taps": [ { "site": 0, "depth": 4, "F_re": 0.998, "F_im": 0.0001,
                          "level": 0.998, "polarity": 1, "x": 0, "y": 0 } ],
              "summary": { "live": 135, "inverted": 8, "complex": 19, … },
              "spec": { "n_sites": 20, "depth": 8, "theta_zz": 0.785, … } },
  "warnings": [] }
```

`public/moth/files/ir-cavern/taps-json` (the media envelope):

```jsonc
{ "result_type": "media", "schema_version": 1,
  "data": { "media_type": "audio", "rendered": "impulse_response",
            "files": { "audio": "result", "ir": "ir", "taps": "taps" },
            "sample_rate": 22050, "channels": 2, "format": "pcm_16",
            "frames": 88200, "duration_s": 4, "peak": 0.3667, "rms": 0.0033 },
  "extras": { "taps": [ … ], "step_ms": …, "master_ms": …, "tail_ms": …, "echo_summary": …, "spec": … } }
```

Note `extras.taps` — the location the game's current `ir` baker misses.

## Appendix B — Proposed first-batch params (see JSON for the full list)

```jsonc
// retrocausal-echo-v1 (2 cr), e.g. ir-openair
{ "emit": "audio", "ir_seconds": 1.5, "sr": 22050, "output_format": "pcm_16",
  "lattice": "square", "width": 6, "height": 3, "depth": 4,
  "theta_zz": 0.7853981634, "theta_x": 0.85, "theta_z": 0.2, "kick": "Z",
  "disorder": 0, "seed": 101, "decay": 0.6, "feedback": 0.25,
  "feedback_source": "kick", "diffusion_ms": 60, "min_level": 0.05,
  "max_regen": 12, "negative_mode": "phase", "stereo_width": 1, "mix": 1,
  "ref_floor": 0.02, "include_tap_map": true }

// otoc-echo-v1 (1 cr), e.g. echo-arena
{ "lattice": "square", "width": 5, "height": 5, "depth": 8, "kick": "Z",
  "theta_zz": 0.7853981634, "theta_x": 0.6, "theta_z": 0.4,
  "disorder": 0.15, "seed": 12345, "exact": true, "shots": 4096,
  "include_taps": true, "include_z": false, "min_tap_level": 0.03 }

// qrc-audio-v1 (5 cr), e.g. bed-ritual (input: sources/bed-seed.wav, generated free)
{ "chunk_seconds": 1, "length": 12, "crossfade": 120, "loop": true,
  "quality": "moderate", "seed": 11, "variation": 0.6 }
```

The `qrc-audio` params in `mothbake/examples/manifest.json` (`prompt`/`seconds`/
`output_format`) are **placeholders for the recorded fixture and are not the real engine
schema**; the real schema is the one above.
