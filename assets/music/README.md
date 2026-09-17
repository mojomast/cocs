# Music samples (CC0)

Baked sampled-instrument set for the COCS procedural music engine. All audio is
derived from **CC0-1.0** sources; see [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md).

70 samples, 4.51 MiB committed (Ogg + AAC fallback).

| Instrument | Type | Samples | MIDI map | Role |
| --- | --- | ---: | --- | --- |
| `strings-pad` | sustained | 24 | 36–84 | Violin / viola / cello section sustains with vibrato; the harmonic bed. |
| `low-brass` | sustained | 22 | 33–72 | F Horn / Tenor Trombone / Tuba sustains; low melodic and tension lines. |
| `timpani` | oneshot | 8 | — | Four tuned timpani hits; downbeats, accents and transitions. |
| `bells` | oneshot | 8 | — | Glockenspiel strikes; high melodic sparkle and cues. |
| `taiko` | oneshot | 8 | — | Frame-drum and bass-drum hits; percussive pulse and impacts. |

## Re-baking

Raw sources live **outside** the repository (default `/home/mojo/music-src`):

```bash
# one-time source checkout (sparse, blob-filtered; needs system git only)
git clone --filter=blob:none --no-checkout https://github.com/sgossner/VSCO-2-CE /home/mojo/music-src/vsco
cd /home/mojo/music-src/vsco
git sparse-checkout init --cone
git sparse-checkout set "Strings/Violin Section/susVib" "Strings/Viola Section/susvib"   "Strings/Cello Section/susvib" "Brass/F Horn/sus" "Brass/Tenor Trombone/sus" "Brass/Tuba/sus" "LICENSE"
git checkout

git clone --filter=blob:none --no-checkout https://github.com/sgossner/VCSL /home/mojo/music-src/vcsl
cd /home/mojo/music-src/vcsl
git sparse-checkout init --cone
git sparse-checkout set "Idiophones/Struck Idiophones/Glockenspiel"   "Membranophones/Struck Membranophones/Timpani 1"   "Membranophones/Struck Membranophones/Frame Drum"   "Membranophones/Struck Membranophones/Bass Drum 1" "LICENSE"
git checkout

# re-bake everything, verify, rewrite the manifest and docs
node scripts/music-bake.mjs

# other modes
node scripts/music-bake.mjs --only strings-pad,bells
node scripts/music-bake.mjs --verify
node scripts/music-bake.mjs --audition     # mix under /tmp/opencode, never committed
```

Override the source root with `MUSIC_SRC=/path/to/samples`. The script needs only
the system `ffmpeg`/`ffprobe`; there are no npm dependencies.

## Manifest field semantics

`assets/music/manifest.json` is a frozen interface (`version: 1`). Every `file`
and `fallback` path is relative to `assets/music/`.

- `instrument`, `midi`, `velocity` — which note/layer the sample is; `velocity`
  1 is the soft layer, 2 the strong layer.
- `loopStart` / `loopEnd` — **seconds** into the file (6 decimal places, i.e.
  sample-accurate at 44.1 kHz). `null` for one-shots. For sustained samples,
  play `[0, loopStart)` once (attack) then loop `[loopStart, loopEnd)`. The
  bake already crossfaded the loop start with the audio at `loopEnd`, so the
  boundary is click-free: do **not** crossfade at runtime, and do not play the
  tail after `loopEnd` while the loop is active (it is the release tail).
- `gain` — linear playback multiplier for mixing balance; multiply the sample by
  it after the (already normalised) decode step. Strings 0.9, brass 0.85,
  timpani/taiko 0.9, bells 0.65.
- Normalisation is per velocity layer: sustained soft/strong are −22/−18 LUFS
  (EBU R128), one-shot soft/strong are peak-normalised to −14/−3.5 dBFS true
  peak. Every layer therefore keeps soft < strong and soft layers stay audible.
- One-shots are peak-normalised rather than loudness-normalised because a drum
  or bell transient has a high crest factor; hitting a LUFS target would need
  hard limiting that dulls the attack. The −3.5 dBFS target leaves headroom for
  AAC inter-sample overshoot in the `.m4a` fallback.
- Every sample ships Ogg Vorbis (`mime: audio/ogg`) plus an AAC `.m4a`
  fallback (`fallback`, `fallbackMime: audio/mp4`) for Safari/iOS. Prefer Ogg;
  fall back only if `AudioContext.decodeAudioData` rejects it.
- All audio is **mono 44.1 kHz** — pan positionally at runtime.
