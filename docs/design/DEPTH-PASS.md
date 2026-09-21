# Depth and dynamics pass

**Date:** 2026-09-20
**Scope:** vehicle and sentry depth, audio dynamics and foley, per-mode music
kits and palettes, world/weapon graphics, combat HUD depth, online lobby UX —
plus a **music stability fix** for the intermittent "no music / stacked menu"
regression reported against `v8.6-d9411c3`. Companion to
[PHYSICS-AND-AUDIO-PASS.md](PHYSICS-AND-AUDIO-PASS.md) and
[QOL-PASS.md](QOL-PASS.md).

## Music stability (reported regression)

Two defects combined to make the soundtrack intermittent and, at the menu,
sound like several takes stacked on top of each other:

1. **Late steps were fired as a burst.** The scheduler advances a 16th-note
   grid against the AudioContext clock, but it was driven only by the render
   frame. When a frame arrived late (a hidden/throttled tab, a GC pause, the
   results transition) it scheduled every step that had already come due, and
   Web Audio clamps a past start time to "now" — so a whole missed phrase
   sounded in one instant. `tick()` now advances past-due steps silently and
   schedules only steps that can still start on time; the transport never
   replays a backlog.
2. **The music clock stopped with the frame clock.** A throttled tab starved
   the scheduler (long stretches with almost no notes). The engine now owns an
   opt-in 120 ms fallback clock (`setAutoTick`, enabled by the host once the
   graph exists and cleared on dispose), so scheduling no longer depends on
   RAF cadence.
3. **The results take was being overwritten.** The page mapped the results
   screen to the live `game` scene every frame, and intensity re-resolved the
   live scene between explore/combat; both stomped the victory/defeat
   arrangement. The results scene is now preserved by `setScene` and
   `setIntensity`, so the outcome music actually plays through the results
   screen and releases cleanly at the menu.

The `audioStatus()` diagnostic now also reports kit, live/sustain/peak voice
counts, crossfade layers, transition count and pending harmonic responses, so
a future report can be diagnosed without a reload.

## Vehicle and sentry depth

- **Per-chassis mounted-gun ballistics.** Every chassis previously fired the
  Puma chaingun's damage and range: the Titan cannon was doing roughly a sixth
  of its authored DPS and the Puma/Transport volleys doubled their listed
  sustained DPS across two barrels. Guns now resolve from the vehicle's own
  config and split the authored volley across the barrels that fire
  (Puma 111, Titan 37.8, Scout 50 sustained DPS).
- **Driver repair is real.** Codex (12/s) and Qwen (4/s) vehicle repair was
  computed but never applied; it now heals the hull while driving and emits a
  throttled `vehicle-repair` heartbeat.
- **Oriented hitboxes and face weak points.** Vehicle rays rotate into the
  chassis frame, so side-on shots connect and damage uses the struck face
  (rear ×1.35, flank ×1.2) instead of only the attacker bearing; splash stays
  neutral.
- **Sentry counterplay.** Sentries are finally damageable (hitscan fire and
  alt-fire, enemies only), emit `deployable-destroyed`, and can be repaired by
  the owner/allies inside a 1.2 m interact ring with a throttled
  `deployable-repaired` beat and a capped repair rate.
- **Heat and respawn.** All mounted guns accrue heat per their table and can
  overheat; vehicles respawn at their authored spawn yaw and announce
  `vehicle-respawn`.
- **Ramming.** Deterministic mass-scaled vehicle separation plus above-threshold
  ram damage (`vehicle-ram`), conservative against wedging; slow contact is
  harmless.

## Audio dynamics and foley

- **Silent telegraphs fixed.** Enemy ability, sapper, artillery, phalanx and
  flank events carry `x`/`z`, but the mixer only read `pos`/`from`, so every
  player-facing telegraph was inaudible. Position normalisation now covers both
  spellings, and each telegraph kind has its own one-voice motif plus
  `overseer-aura`/`lattice-support` cues.
- **Mix treatments.** A bounded duck on announcer cues and local explosions, an
  optional health/killcam/spectator master filter (neutral by default, with
  full fallback when biquads are unavailable), `setKillcam` and `setSpectating`
  gain profiles.
- **Foley.** Seeded shell-casing tinkle, per-kind engine timbres with gear-shift
  banding and boost overtone, a Puma skid loop from lateral slip, three thunder
  recipes behind an optional seed, and weather/time-change onset cues.
- **Announcer.** Coverage extended to objectives, sudden death, missions waves,
  boss phases, VIP/payload/assault beats, weapon upgrades, bounties and
  telegraphs, behind the existing opt-in flag with a per-cue cooldown and a
  1.2 s global cadence guard.

## Music depth

- **Per-mode percussion kits** (`MUSIC_KITS`) for every game mode, inert on the
  default palette; race/soccer grooves; palettes now cover all 23 modes with
  authored arp/lead timbres and register rotation; biome palettes overlay
  colour without erasing the mode. `default` and variation 0 remain
  bit-identical to the previous take.

## Graphics

- **World:** deployable sentries are rendered (shared-geometry turret, team
  tint, emissive eye, blob/contact shadow, spawn/fire/expire VFX); interior
  volumes height-fog and damp light with static dust shafts; objective beacons
  scale with capture progress; non-breaking shield hits flare the shield mesh
  (never its colour) and low-health actors smoke/spark.
- **Weapons:** barrel heat glow and occasional muzzle smoke; surface-aware
  impact accents (terrain dust vs metal sparks) with terrain-tinted decals; a
  hold-then-fade decal curve; combat particles follow the effects-quality tier.

## Combat HUD and lobby UX

- **Killfeed depth:** ASSIST, STREAK ENDED, OVERKILL and ×N STREAK badges from
  authoritative-ish page-side metadata; shield-break hit marker and damage tint.
- **Death recap:** a bounded last-3-hits ledger on the death card and respawn
  overlay, plus assists credited from local damage within 5 s.
- **Quality of life:** ability/movement card tooltips, `J`/`L` network quality
  in the HUD note, per-kind telegraph/economy captions with objective-band
  priority, and deeper crosshair options (outline, gap, thickness, dot, ADS
  colour).
- **Online:** chat timestamps with mention highlighting and an unread count,
  a lobby connection-diagnostics block, room search/sort/hide-in-progress and a
  truthful refresh stamp, proportional map-vote rows with a server-gated
  countdown and rematch action, and earned copy confirmations.

## Verification

- Gate counts are recorded in `docs/VERIFICATION.md`; new focused suites cover
  ragdoll-free vehicle math, `vehicle-ram`, combat visuals, feedback mix,
  music kits and the lobby/chat UI.
- The music stability fix was validated against a deliberately throttled
  headless browser: before the fix most menu starts were scheduled 50-400 ms
  late (bursts); after it, zero late starts and continuous scheduling at 1 fps.

## Announcer voice pack

The OmniVoice pack (`public/audio/announcer`, 12 cues x 3 seeded takes, from
the `feat/omnivoice-announcer-pack` PR) is now wired into `SynthAudio`:

- the manifest loads on the first audio start (opt-in with the announcer
  preference) and each cue's three takes decode on first use;
- a decoded take replaces the procedural motif, deterministic seeded selection
  rotates takes without immediate repeats, and speech never overlaps a second
  cue;
- the motif remains the fallback for the first hearing and any fetch/decode
  failure, and mute/preference/effects-volume/cadence gates apply unchanged;
- `audioStatus().announcerVoice` reports `{loaded, ready, pending, failed}`,
  the debug hook `tokenArenaDebug.announcer(cue)` auditions any cue, and
  `dispose()` drops decoded takes.

Verified in a live browser: manifest + three capture takes requested, `ready`
reaching 3 by the second cue, zero console errors.

## Menu FIGHT replay and announcer audibility

Two follow-up defects from player reports:

- **The FIGHT fanfare replayed continuously at the menu.** Leaving a round
  leaves the page holding the last match while the render loop keeps calling
  `audio.update(match, …)`, and the menu scene calls `matchEnd()` every frame —
  so `setMatchState` re-armed `matchStart()` on every frame and `_fightSting`
  stacked dozens of takes (player report: "a bunch of noise when I return to
  the menu"). The page now only feeds the local match to `update()` while it
  owns the screen (`playing`/`paused`/`results`, matching `selectRenderState`),
  and `setMatchState` refuses to start a match unless the host scene is the game
  scene. `setScene('menu')` also releases any running engine/skid loop. A
  throttled-browser stack capture that previously attributed ~10 FIGHT stings
  and ~100 sources to the transition now shows zero.
- **The announcer was inaudible in combat.** Announcer cues shared the 30-voice
  SFX budget with gunfire, so a busy fight silently dropped them. `_play` now
  accepts a `priority` reservation used by the sampled takes and the procedural
  fallback (bounded to the announcer's own single-voice rule), the fallback
  motif is louder, and sampled takes play at a slightly higher gain. Team
  Deathmatch score calls and kill-streak calls are therefore audible over a
  firefight.

## Particle title logo

The title mark is a point cloud over the live menu/showcase scene: letters
rasterised from the DOM glyphs, sampled into 700-2200 particle targets, assembled
from a loose haze, drifting with per-particle noise, pouring a wake off to the
left, and shoving away from the pointer before settling home. Ambient dust motes
drift through the box. It renders as a **lightweight 2D canvas field**: no extra
WebGL context, no shader compilation, pre-rendered glow sprites, a 30 fps cap and
a visibility pause. That keeps the look while cutting the per-frame particle
count by roughly 4x versus the earlier WebGL points version.

- `game/particle-logo.mjs` is the pure half: deterministic mask sampling
  (single-grid scan with even thinning, deterministic jitter), particle state,
  the fixed-step simulation with wake/dust shares, and per-particle render
  alpha. Covered by `game/particle-logo.test.mjs` (sampling bounds,
  determinism, settling, pointer repulsion, reduced snap, wake fade, PRNG).
- `app/game-ui/particle-logo.tsx` is the canvas host: it measures the DOM logo
  shell, rasterises the glyphs from their computed fonts, decodes targets into
  700-2200 particles, pre-renders two glow sprites and draws one `drawImage`
  per particle on a 2D canvas at a capped 30 fps, pausing while the document is
  hidden. Fixed 16.6 ms substeps keep assembly speed independent of frame rate,
  and observers/listeners are removed on unmount.
- Gates: reduced motion renders one fully assembled static frame (no drift, no
  pointer); a missing 2D context, a raster with fewer than 300 targets, or a
  missing canvas keeps the original DOM logo (the glyphs are hidden only after a
  frame has rendered). The canvas is `aria-hidden`, the `h1` keeps its
  accessible name, and a soft radial vignette behind the mark keeps it readable
  over bright scenery.
- Budget: no new assets (the raster is generated at runtime from system fonts),
  and no second WebGL context is created; the 2D canvas and its sprites exist
  only while the title screen is mounted.
  `?particleDebug=1` exposes the mask, target histogram and a QA render of the
  targets on the canvas dataset.
