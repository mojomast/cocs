# Music samples (CC0)

Baked sampled-instrument set for the COCS procedural music engine. All audio is
derived from **CC0-1.0** sources; see [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).

172 samples, 9.55 MiB committed (Ogg + AAC fallback).

Baked outputs live in the served static tree: audio under `public/music/samples/`
and the index at `public/music/manifest.json`. The browser loads them same-origin
from `/music/manifest.json` and `/music/samples/<name>.<ext>` (see
`game/sampler.mjs`). This file and `THIRD_PARTY_LICENSES.md` stay under
`assets/music/` as documentation; there is only one copy of every asset.

| Instrument | Type | Samples | MIDI map | Role |
| --- | --- | ---: | --- | --- |
| `strings-pad` | sustained | 24 | 36–84 | Violin / viola / cello section sustains with vibrato; the harmonic bed. |
| `low-strings-stacc` | oneshot | 36 | — | Violin / viola / cello section spiccato; low-string ostinato and high-string replies. |
| `low-brass` | sustained | 22 | 33–72 | F Horn / Tenor Trombone / Tuba sustains; low melodic and tension lines. |
| `brass-stacc` | oneshot | 32 | — | Trumpet / horn / trombone / tuba staccato; marcato accents and fanfare stabs. |
| `trumpet-pad` | sustained | 8 | 62–72 | Trumpet sustains; high-brass fanfare and brilliance above the low brass. |
| `timpani` | oneshot | 8 | — | Four tuned timpani hits; downbeats, accents and transitions. |
| `timpani-roll` | sustained | 4 | 42–52 | Looped timpani rolls; climax build and transition fill. |
| `bells` | oneshot | 8 | — | Glockenspiel strikes; high melodic sparkle and cues. |
| `tubular-bells` | oneshot | 6 | — | Tubular-bell tolls; sacred cues and the drop. |
| `gong` | oneshot | 2 | — | Tam-tam gong strikes; tension and impact. |
| `cymbal-swell` | oneshot | 4 | — | Suspended-cymbal crescendos; section transitions and climax fills. |
| `cymbal-crash` | oneshot | 4 | — | Crash-cymbal accents. |
| `harp` | oneshot | 6 | — | Harp plucks; arpeggio colour and menu sparkle. |
| `taiko` | oneshot | 8 | — | Frame-drum and bass-drum hits; percussive pulse and impacts. |

**No choir is baked.** Neither CC0 source library ships a choir (VSCO 2 CE and
VCSL have none), the FreePats General MIDI set is GPL-3.0, Sonatina Symphonic
Orchestra is CC Sampling Plus 1.0, Karoryfer's CC0 freebies contain no choir, the
Discord GM "Choir Aahs"/"Voice Oohs" patches are sine placeholders, and a
Freesound CC0 search returns only crowd walla or synth-derived loops. Rather than
mislabel a non-CC0 or unverifiable recording, `choir` is left to the runtime's
formant-synth fallback.

## Re-baking

Raw sources live **outside** the repository (default `/home/mojo/music-src`):

```bash
# one-time source checkout (sparse, blob-filtered; needs system git only)
git clone --filter=blob:none --no-checkout https://github.com/sgossner/VSCO-2-CE /home/mojo/music-src/vsco
cd /home/mojo/music-src/vsco
git sparse-checkout init --cone
git sparse-checkout set "Strings/Violin Section/susVib" "Strings/Viola Section/susvib" \
  "Strings/Cello Section/susvib" "Strings/Violin Section/Spic" "Strings/Viola Section/spic" \
  "Strings/Cello Section/spic" "Strings/Harp" "Brass/F Horn/sus" "Brass/F Horn/stac" \
  "Brass/Tenor Trombone/sus" "Brass/Tenor Trombone/stac" "Brass/Tuba/sus" "Brass/Tuba/stac" \
  "Brass/Trumpet/sus" "Brass/Trumpet/stac" "LICENSE"
git checkout

git clone --filter=blob:none --no-checkout https://github.com/sgossner/VCSL /home/mojo/music-src/vcsl
cd /home/mojo/music-src/vcsl
git sparse-checkout init --cone
git sparse-checkout set "Idiophones/Struck Idiophones/Glockenspiel" \
  "Idiophones/Struck Idiophones/Tubular Bells 1" "Idiophones/Struck Idiophones/Gong 1" \
  "Idiophones/Struck Idiophones/Suspended Cymbal 1" "Idiophones/Struck Idiophones/Suspended Cymbal 2" \
  "Idiophones/Struck Idiophones/Clash Cymbals 1" "Idiophones/Struck Idiophones/Clash Cymbals 2" \
  "Membranophones/Struck Membranophones/Timpani 1" \
  "Membranophones/Struck Membranophones/Frame Drum" \
  "Membranophones/Struck Membranophones/Bass Drum 1" "LICENSE"
git checkout

# re-bake everything, verify, rewrite the manifest and docs
node scripts/music-bake.mjs --force

# other modes
node scripts/music-bake.mjs --only strings-pad,bells
node scripts/music-bake.mjs --verify
node scripts/music-bake.mjs --audition     # mix under /tmp/opencode, never committed
```

Override the source root with `MUSIC_SRC=/path/to/samples`. The script needs only
the system `ffmpeg`/`ffprobe`; there are no npm dependencies.

The bake writes audio to `public/music/samples/` and the manifest to
`public/music/manifest.json` so the browser can stream it from `/music/*`; the
README and licence file are written back to `assets/music/`. Never copy the
samples into `assets/music/` as well — `scripts/music-bake.mjs` is the single
source of truth.

## Manifest field semantics

`public/music/manifest.json` is a frozen interface (`version: 1`). Every `file`
and `fallback` path is relative to `public/music/` (i.e. the served `/music/`
base).

- `instrument`, `midi`, `velocity` — which note/layer the sample is; `velocity`
  1 is the soft layer, 2 the strong layer.
- `loopStart` / `loopEnd` — **seconds** into the file (6 decimal places, i.e.
  sample-accurate at 44.1 kHz). `null` for one-shots. For sustained samples,
  play `[0, loopStart)` once (attack) then loop `[loopStart, loopEnd)`. The
  bake already crossfaded the loop start with the audio at `loopEnd`, so the
  boundary is click-free: do **not** crossfade at runtime, and do not play the
  tail after `loopEnd` while the loop is active (it is the release tail).
- `gain` — linear playback multiplier for mixing balance; multiply the sample by
  it after the (already normalised) decode step. Strings 0.9, low brass 0.85,
  staccato strings 0.9, staccato brass 0.85, trumpet pad 0.85, timpani/roll 0.9,
  taiko 0.9, bells 0.65, tubular bells/gong/cymbals 0.7, harp 0.8.
- Normalisation is per velocity layer: sustained soft/strong are −20/−16 LUFS
  (EBU R128), one-shot soft/strong are peak-normalised to −14/−3.5 dBFS true
  peak. Every layer therefore keeps soft < strong and soft layers stay audible.
- Long percussive one-shots (cymbals, gong, tubular bells, harp) are truncated to
  a per-instrument cap and faded out; the tail beyond the fade is intentionally
  discarded rather than looped.
- One-shots are peak-normalised rather than loudness-normalised because a drum
  or bell transient has a high crest factor; hitting a LUFS target would need
  hard limiting that dulls the attack. The −3.5 dBFS target leaves headroom for
  AAC inter-sample overshoot in the `.m4a` fallback.
- Every sample ships Ogg Vorbis (`mime: audio/ogg`) plus an AAC `.m4a`
  fallback (`fallback`, `fallbackMime: audio/mp4`) for Safari/iOS. Prefer Ogg;
  fall back only if `AudioContext.decodeAudioData` rejects it.
- All audio is **mono 44.1 kHz** — pan positionally at runtime.

## Runtime selection (deterministic)

`game/sampler.mjs` is the runtime reader. It picks the nearest `midi` sample,
prefers the requested velocity layer (falling back to the nearest available
one) and pitch-shifts with `playbackRate = targetFreq / recordedFreq`. The
round-robin pick among same-pitch samples and the default velocity layer come
from the `MusicEngine` seeded RNG, and the chosen `(midi, velocity, rate)` is
folded into `scheduleChecksum`, so one seed still reproduces one performance.
Decoding is lazy per instrument and never blocks the scheduler; any voice whose
buffer is not ready (or fails to decode) falls back to the oscillator engine.

Extra staccato/marcato samples at the same pitch and layer are round-robin
alternates by construction (the tag only changes the id), so the seeded pick
avoids machine-gun repetition without a new manifest field.

## Runtime mapping for new instruments (M2)

The runtime is owned by the M2 change; until it merges these instruments simply
sit unused in the manifest and the existing oscillator fallbacks still play.

| id | recorded MIDI | notes / layers | intended use |
| --- | --- | --- | --- |
| `low-strings-stacc` | cello 38/41/48, viola 50/53/60, violin 60/64/67 | 3 notes x 2 vel x 2 RR | low-string ostinato + high-string staccato reply |
| `brass-stacc` | trumpet 62/69, trombone 41/50, horn 41/48, tuba 38/50 | 2 notes x 2 vel x 2 RR | marcato/staccato brass accents |
| `trumpet-pad` | 62/65/69/72 | 4 notes x 2 vel (looped) | high-brass sustains and fanfare |
| `timpani-roll` | 42/52 | 2 rolls x 2 vel (looped) | climax build / transition fill |
| `cymbal-swell` | 60 | 2 swells x soft+strong | cymbal crescendos |
| `cymbal-crash` | 60 | 2 soft + 2 strong RR | crash accents |
| `tubular-bells` | 48/52/58 | 3 notes x 2 vel | bell tolls |
| `gong` | 60 | soft + loud | tam-tam impact |
| `harp` | 38/45/62/65/69/72 | 6 one-shots, soft layer only | arpeggio colour |

**Remove the runtime ×0.6 double-attenuation.** The old `_strings` path passed
`trim: 0.6` because the sustains were baked at −22/−18 LUFS; they are now
−20/−16 LUFS, so the extra 0.6 must be dropped (M2) or the pads will still sit
~4 dB under the intended level. The manifest `gain` is the only per-instrument
balance multiplier.
