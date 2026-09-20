# Physics, animation and audio pass

**Date:** 2026-09-20
**Scope:** ragdoll physics, deterministic animation depth, a major music and
dynamic-audio expansion, plus a final graphics/gameplay/UX wave (backdrop
identity, vehicle kits, prop staging, team-status HUD, vehicle counterplay).
Companion to [QOL-PASS.md](QOL-PASS.md), [COMBAT-PASS.md](COMBAT-PASS.md) and
[ANIMATION-PASS.md](ANIMATION-PASS.md).

## Ragdoll physics (presentation-side, deterministic)

`game/ragdoll.mjs` adds a Verlet particle solver that drives the existing
actor skeleton after death. The simulation, protocol and snapshot are
untouched: the ragdoll is seeded entirely from data the death event already
carries (`style`, `seed`, `direction`, `overkill`, plus the actor's velocity
and the hit lean left by the last flinch).

- **16 particles / 19 distance constraints** with radii taken from the model
  meshes, two Gauss-Seidel iterations, preallocated typed arrays per pool slot.
- **Root stays kinematic:** `CharacterLifecycle` still writes
  `model.position`/`rotation`, slope alignment and the settled envelope, so
  every root/arc/seek pin survives; the solver writes only joint quaternions
  through a new `CharacterRig.applyRagdoll(pose, blend)` channel.
- **Fixed 1/60 step** with ≤4 substeps, ≤6 awake corpses, ground queries via
  the existing support adapter, AABB contacts against `arena.blocks` (no world
  raycasts), and deterministic seeded impulses (never `Math.random`).
- **Sleep** after ~20 quiet steps or 4 s; replay/seek pre-rolls up to 240 fixed
  steps and snaps to the authored `deathLimbPose` if still moving. Late
  authoritative plans reseed within the existing 0.12 s window.
- **Fallbacks:** reduced motion, the software renderer, `hideBody` styles and
  hidden corpses use the byte-identical authored pose path and keep the
  pinned sample budgets.
- **Hit-to-death continuity:** the live pose and the last hit lean blend into
  the fall over ~0.1 s instead of snapping.

## Animation depth

- **Secondary motion:** deterministic springs drive antenna/sensor-mast flex,
  backpack sway, wing fins and head/chest lag on living actors, with reduced
  motion snapping to rest and no per-frame allocation.
- **Foot planting:** per-foot world plants (0.25 m step budget, replant on
  exceed) with slope stance/pelvis compensation, keeping the existing
  two-sample query budget per model.
- **Lean model:** damped turn bank, acceleration lean, asymmetric landing
  roll, a slide stance, and a rig-level hit pitch/roll driven by the hit
  direction.
- **First-person depth:** a bounded weapon-inertia spring, a support hand that
  travels with reload choreography, and per-weapon reload timing (magazine,
  bolt, cell) on top of the existing ADS/punch channels.

## Music and dynamic audio

- **`setTension` / `setEscalation`:** continuous danger layers (low-string
  tremolo, detuned pad, shorter form) that default to zero and therefore keep
  the previous take bit-identical.
- **New instruments:** `_shaker` (filtered-noise tick/ride), `_keys` (two-op
  FM electric piano/bell inside one voice slot), `_pluck`/`_pizz`
  (sampled spiccato, Karplus-Strong or triangle fallback) and a tremolo string
  stroke, all gated by thresholds so they are dropped first under budget.
- **Palettes and variation:** frozen `MUSIC_PALETTES` per mode/biome toggle
  authored colours; `setVariation` selects ornaments (fills, ghost notes,
  counter octave, arp direction, lead turns, instrument rotation) from a pure
  `(seed, scene, bar)` hash and folds a fingerprint into the schedule
  checksum — variation 0 leaves the baseline untouched.
- **Event-driven music:** low health raises tension, boss/escalation/horde
  raise escalation, clears release it, killstreaks answer with an accent when
  the announcer is off, captures/losses resolve harmonically on the next step,
  and the final-10-seconds warning adds a tension pulse — each beat owned by
  exactly one voice (music, earcon or announcer, never two).

## Graphics and gameplay wave

- **Per-biome backdrop kits:** city/neon towers, canyon mesas, snow shards,
  foundry stacks and a void orbital ring replace the one-cone-ring horizon for
  the matching biomes, instanced and WebGL-only, with `addMountains` intact.
- **Vehicle identity:** titan/scout/transport gain build-time silhouette kits
  and emissive accents on the shared hull (no scaling that would break the
  sim-owned seat offsets); the Puma stays byte-identical.
- **Prop damage staging:** crates/barrels shrink and darken through
  `applyPropDamage` health before the existing break, with a pure
  `propDamageStage` helper.
- **Readability riders:** every pickup kind gets its colour burst, and
  vehicles below 40% health emit pooled smoke/sparks.
- **Options consumed:** `display.fpsCap` gates the render loop only (the
  1/60 simulation keeps stepping), `display.shadows` maps to off/low/high
  shadow casting, and the spectated actor now drives the audio intensity
  origin instead of the local player.
- **Vehicle counterplay:** rear (×1.35) and flank (×1.2) direct-hit weak
  points by bearing, a speed-scaled dismount slow-stun, and passenger
  personal fire with a spread/recoil penalty — no new snapshot fields, net
  budget byte-identical.
- **Horde XP:** horde/campaign score and best wave pay a bounded XP rider
  (≤250), wired through the local award and the results breakdown.
- **Team status and economy HUD:** lives/tickets, ally health, zone/hold/
  payload/VIP progress, weapon-upgrade countdown and sentry health, plus
  captions for the economy events.

## Verification

- Gate: see `docs/VERIFICATION.md` for the current counts (game, server,
  SSR/UI, typecheck, build, lint).
- Graphics-lab harness green; local and production browser matrices 5/5.
- Ragdoll tests cover pool caps, reduced/software gating, typed-array
  determinism, fixed-step frame-rate independence, sleep, seek, eviction and
  no floor/block penetration. Music tests cover bit-identity defaults, voice
  budgets, palette/variation determinism and event idempotency.
