# Phase 2 — Cinematic music handoff (`game/music.mjs`)

Worker: PHASE-2 MUSIC workstream. Ownership respected: only `game/music.mjs`,
`game/music.test.mjs` and this document were written. `game/feedback.mjs`,
`game/view.mjs` and `app/**` were read, never edited. No commits, no full
suites, no deployment.

## 1. What changed musically

The public API, `MUSIC_SCENES` order and `MUSIC_EXPORTS` are unchanged. All
changes are arrangement content, dynamics and synthesis texture inside the same
step-sequencer model.

### 1.1 Richer writing, both packs

- **Eight-bar phrases.** `CHORD_PROGRESSIONS` and `HALO_PROGRESSIONS` are now
  eight bars (were four). Each half answers the other; `fills` land on bar 4
  (small) and bar 8 (big) instead of every fourth bar. Pinned assertions only
  required `length >= 4`, so this was an additive change.
- **Real lead lines.** The default pack gained multi-bar lead themes:
  `ARRANGEMENTS.menu.lead` and `ARRANGEMENTS.combat.lead` are 16 quarter notes
  (four bars), `explore.lead` is 8. The halo explore line is 16 notes; the halo
  combat `lead: 'motif'` keeps the baked motif but gained a 16-note
  `leadFallback` so it still sings when no motif is loaded.
- **Lead phrasing bug fixed.** The old engine indexed `lead[i % lead.length]`
  with `i = step / 4` inside one bar, so only the first four notes of any line
  (or baked motif) were ever heard, repeated every bar. Lead indexing is now
  `_leadIndex(arr, step)` = absolute quarter count (`bar * quartersPerBar +
  step/4`) modulo the line length: 16-note themes and the qrc-midi motif now
  develop across four bars.
- **Counter-lines.** New optional `counter` arrays play on the eighth-note
  offbeats in every scene of both packs, an octave away from the arpeggio and
  panned opposite it (halo counter sits an octave above its low arpeggio). This
  is the interlocking reply voice the old arrangements lacked.
- **Bass movement.** Bass patterns gained in-bar movement (third/fourth/octave
  passing tones) instead of one root per half bar, and the halo combat line now
  moves through scale degrees 5 and 4 for tension/release.
- **Halo material.** Progressions are `i–VI–iv–v` variants over D natural minor
  with a `i–VI–VII–v` menu cadence; the arrangement keeps the original taiko,
  bell, choir and drone palette, but bells ring at phrase turns, taiko fills
  accent the larger phrase end, and the choir is panned in pairs.

### 1.2 Dynamic layering and transitions

- `layers = { menu, explore, combat }` eases 0→1 per resolved scene
  (combat rise ~0.45 s; combat release ~1.8 s, explore/menu release ~1.1 s).
  Bus gains now scale with these layers, so menu → explore → combat is a
  deliberate build and combat exits with a tail.
- Combat layers enter in bands while `layers.combat` rises:
  kick always → snare at 0.22 → hats at 0.40 → taiko 0.32 / bell 0.45 →
  counter-line 0.28 → lead 0.42 → choir 0.12. The same thresholds gate layers
  back out after the eased release.
- **Transition state machine** (`transition = { from, to, phase, ... }`,
  `phase ∈ outro → enter → idle`):
  - `outro`: when the resolved scene changes without a transport reset (the
    normal in-game path via `setIntensity`), the remainder of the old bar gets
    a rising filtered-noise swell and a percussion crescendo.
  - `enter`: the downbeat of the new scene lands an entrance accent —
    sub-boom + kick + noise impact + bell accent into combat, taiko/pad swell
    into explore/menu. The first bar of the new scene keeps accent emphasis,
    then the machine goes `idle`.
  - `transitions` counts resolved-scene changes; `transition.accents` counts
    entrance hits. `preview(...)` drives the same machine.
  - Note: `setScene()` still resets the transport (unchanged contract), so a
    page-level mode change restarts the phrase and its entrance lands
    immediately on the first downbeat.
- **Phrase swells.** The eighth bar of each phrase crescendos over its last
  four 16ths with a noise/string riser plus a snare (combat) or taiko roll,
  scaled by per-arrangement `swell` (0.35–0.85).

### 1.3 Cinematic texture, bounded and synthesized

- `_scheduleNoise()` uses the shared noise buffer with a biquad sweep for
  risers/impacts; when the host has not supplied a buffer, the engine
  self-provisions a **seeded** 0.6 s noise buffer (or falls back to a tonal saw
  swell when `createBuffer`/`createBufferSource` is missing).
- Gentle stereo width via optional `createStereoPanner` on arps, counter, lead,
  bells, pads and choir; skipped cleanly when the node type is unavailable.
- Reverb sends on pads (0.35–0.4), lead (0.28), bells (0.6) and choir (0.5), so
  the existing cavern IR opens the melodic layers without washing out the bass
  and drums. Ducking, mute and bus topology are unchanged.
- **CPU bounded as before**: same look-ahead (`< 8` steps/tick) and voice cap
  (`maxVoices`, default 26). Measured in a 30 s virtual run: peak 26 voices;
  ~1–5 % of notes drop at the cap and they are the pads/choir/drone, which are
  scheduled last, so the beat and melody never starve.
- **Determinism**: no `Math.random()`; velocities/ornaments come from a
  mulberry32 seeded from `seed`. `_resetTransport()` re-seeds, so the same seed
  and same schedule replay identically. `scheduleChecksum` is a cheap rolling
  fingerprint of scheduled (freq, gain) used by the determinism test.

## 2. Exports

No new exports. `MUSIC_EXPORTS` is byte-for-byte unchanged:

```
['MusicEngine', 'MUSIC_SCENES', 'CHORD_PROGRESSIONS', 'ARRANGEMENTS',
 'SOUNDTRACKS', 'HALO_THEME', 'HALO_ARRANGEMENTS', 'HALO_PROGRESSIONS']
```

Existing exports were enriched in place and stay deeply frozen (`frozen()`
helper freezes nested bass steps and fill objects too):
`CHORD_PROGRESSIONS`, `ARRANGEMENTS`, `HALO_PROGRESSIONS`,
`HALO_ARRANGEMENTS`, `HALO_THEME`, `SOUNDTRACKS` (each pack now also carries a
frozen `fills` table; `SOUNDTRACKS.default.arrangements === ARRANGEMENTS`).

Private arrangement schema additions (optional, so third-party data still
works): `counter`, `counterShift`, `leadShift`, `leadFallback`, `leadType`,
`leadGain`, `swell`. Internal engine state available for tests/debug:
`layers`, `transition`, `transitions`, `peakVoices`, `notesBy`,
`scheduleChecksum`, `fills`.

## 3. Integration points (lead)

No wiring changes are required for the new music; the existing graph already
feeds every new dynamic.

| Point | Signature | Status |
| --- | --- | --- |
| `app/page.tsx:183` | `audio.setSoundtrack('halo'); audio.setMotif(mothMotif('moth-oracle')); audio.setReverbUrl(cavernIr.url, 0.42);` | Already wired. Picks up the new 8-bar halo material, multi-bar motif phrasing and richer reverb sends automatically. |
| `app/page.tsx:223-224` | `r.audio?.setScene?.(...); r.audio?.tick?.();` once per frame | Already wired. `tick()` signature/return unchanged (steps scheduled, 0 when idle). |
| `game/view.mjs:1372`, `game/view.mjs:1514` | `audio.setIntensity?.(value)` from `_noteNearAction` / `_updateAudio` | Already wired. Threshold semantics unchanged (`>= 0.34` resolves combat; feedback calls `setIntensity` then `setScene`). This is the path that exercises `outro → enter` crossfades in-game. |
| `game/feedback.mjs:375` | `new MusicEngine({ctx, destination, theme, noiseBuffer, seed})` | Already wired. `_ensureBuses()` currently runs before `SynthAudio` creates its shared noise buffer, so `noiseBuffer` is `null` there; the engine self-provisions a seeded buffer, so swells work with no change. Optional polish for the audio owner: move `this.noiseBuffer ??= this._makeNoise()` before the `MusicEngine` construction and pass it (same timbre, one shared buffer). |
| `game/feedback.mjs:408/410/412/540` | `previewMusic`, `setSoundtrack`, `setMotif`, `tick` | Unchanged contracts; the Settings "Preview" action now plays the menu theme with its lead line. |

If the lead wants a menu audition of the new combat transition, calling
`audio.previewMusic('combat', 6)` already triggers the full transition machine
(no new method).

## 4. Verification

From the worktree:

```
node --test --test-timeout=120000 game/music.test.mjs game/weather.test.mjs
# tests 29, pass 28, fail 0, skipped 1 (OfflineAudioContext render)
```

The skip is the pre-existing real-render test; it was not removed or weakened.

New focused tests added in `game/music.test.mjs`:

- 8-bar phrasing, multi-bar themes, counter-lines, deep-frozen pack data.
- `_leadIndex` develops across bars (16-note theme wraps after four bars; a
  16-note motif reads its second quarter in bar 2).
- Intensity bands: quiet exploration has a counter-line but no combat snare;
  loud combat adds percussion and lead; leaving combat releases the layer
  (still > 0.5 after 0.2 s) and eventually settles (< 0.02).
- Transition machine edges: no transition in a steady scene, `outro` on an
  intensity-driven change, accent resolution, `idle`, one transition per
  resolved scene change, and preview drives both directions.
- Voice cap under 500 ticks of max-intensity combat at `maxVoices: 12`.
- Seed determinism: same seed ⇒ identical checksum/counters; different seed ⇒
  different checksum.
- Noise/stereo texture only when the context supports it, with a tonal
  fallback that does not crash a minimal mock.

## 5. Pinned-expectation updates

None. Every pre-existing assertion in `game/music.test.mjs` and
`game/weather.test.mjs` is untouched and passes. Additions are new tests only.

## 6. Risks and unknowns

1. **Browser audio was not auditioned here.** No `OfflineAudioContext` in this
   Node environment, so the render test skips as before. Mix balance (music vs
   the concurrently rewritten SFX bus), true voice load on hardware, and the
   subjective feel of the transitions need a listening pass.
2. **`game/feedback.mjs` is being edited by another workstream** and currently
   has 5 pre-existing `feedback.test.mjs` failures in `SynthAudio._bed`
   (`Cannot read properties of undefined (reading 'gain')`). They reproduce
   with the HEAD `music.mjs`, so they are not from this workstream; do not
   attribute them to phase-2 music. `feedback.test.mjs` is outside the focused
   command.
3. **Voice-cap drops.** Dense halo passages reach 26 voices; ~3–5 % of notes
   are dropped and they are the pads/choir/drone (scheduled last). If the lead
   prefers zero drops, raise `maxVoices` when constructing `MusicEngine`
   (e.g. 30); no test pins the default beyond "bounded".
4. **`setScene()` resets the phrase** (pre-existing behavior). A mode change
   restarts at bar 0 with an immediate entrance accent; intensity changes
   inside a mode keep the phrase running and crossfade through the transition
   machine. This is intentional but worth a listening check.
5. **Reverb level.** New sends on pads/lead/bells/choir could make the cavern
   IR more present than before, particularly in halo combat. The engine-level
   `wet` passed by `SynthAudio.setReverbUrl` is unchanged (0.42).
6. **Lead type/register are stylistic choices.** Default leads use triangle in
   menu/explore and square in combat; halo explore shifts its lead up an octave
   (`leadShift: 12`). These are data only and easy to retune in
   `ARRANGEMENTS`/`HALO_ARRANGEMENTS` without touching the engine.
