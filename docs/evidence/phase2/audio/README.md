# Phase 2 audio evidence

Six-second mono 22.05 kHz excerpts of the halo soundtrack rendered offline from
the real `MusicEngine` (`game/music.mjs`) with the phase-2 arrangements.

## Method

- `OfflineAudioContext` render at 44.1 kHz stereo with `suspend()`/`resume()`
  scheduling every 100 ms so the engine's look-ahead covers the whole window
  (a plain tick loop finishes faster than the scheduler and leaves silence).
- Scenes: `menu` (12 s), `explore` (12 s), `combat` (14 s); excerpts are the
  first 6 s, mono-folded and decimated for size. Full renders and JSON stats
  were kept in the session scratch space.
- Measured (full renders): menu rms 0.0158 / peak 0.333, explore rms 0.0311 /
  peak 0.505, combat rms 0.0316 / peak 0.510; per-second RMS non-zero in every
  second; 138–355 note events scheduled per render.

## Limits

- Synthesized evidence only: no hardware listening pass, no loudness or stereo
  balance review, and no in-game mix (music versus effects) verification here.
- The excerpts are lossy-by-decimation; they are for timbre/arrangement review,
  not mix measurement.
