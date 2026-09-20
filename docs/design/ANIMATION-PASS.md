# Animation pass: death variety, hit feedback, viewmodel and UI motion

**Date:** 2026-09-20
**Scope:** a full animation pass across character deaths, hit reactions, the
first-person viewmodel, world loops and the UI. Companion to
[GRAPHICS-LAB.md](../GRAPHICS-LAB.md) (art direction) and
[GRAPHICS-EDGE-PLAN.md](GRAPHICS-EDGE-PLAN.md) (post-processing).

## What happened to the death variety

It was not deleted — it was **narrowed by the corpse-lifecycle refactor**. The
old renderer posed every corpse from the killing shot: yaw from the shot
direction, `plan.roll`, a distinct tilt per fall pose, and a hashed limb splay
so no two corpses shared a silhouette (the removed code survives in
`docs/phase1-characters-integration.patch`). The replacement lifecycle owned the
transform safely (slope alignment, support, eviction) but pinned the limbs to a
neutral rest pose and reduced the fall to `crumple ? 1.05 s : 0.55 s` with one
rotation curve. Three more leaks compounded it:

- the simulation's authoritative `style` was ignored and recomputed;
- `headshot` never reaches the planner, so the documented head-pop bias never
  fires in live play;
- hit flinch stored `strength`/`lean` and then fed the rig a binary `hit` flag.

## What was restored and added

### Deaths (`deaths.mjs`, `rig.mjs`, `character-anim.mjs`, `view.mjs`)

- **Authoritative style** is honoured (`isDeathStyle`, `deathPlan({style})`,
  with the hashed planner as fallback).
- **Killing direction** orients the fall: `yaw = atan2(-dir.x, -dir.z)` when the
  sim provides it; void and self deaths keep the actor yaw.
- **Per-pose arcs**: faceplant, back slam with a bounded bounce, left/right
  shoulder rolls, crumple buckle and sprawl drop each have their own duration
  (0.45–1.15 s), easing and tilt axis; settled corpses consume `plan.roll`;
  `spinout` tumbles ×1.35 while `crumple`/`collapse` stay near-upright.
- **Seeded corpse silhouettes**: `deathLimbPose` writes a deterministic,
  bounded asymmetric limb pose per pose/style/seed, so corpses no longer share
  one outline. The lifecycle keeps sole ownership of the transform.
- **Style treatments**: head-pop head removal timing, gibs body hiding, energy
  and vaporize scale-out, combust sink, splatter low-and-wide; reduced motion
  settles instantly.
- **Hygiene**: `deathContext`, `deathPool`, `hitPool`, casings and debug
  corpses are cleared on match change, and the Moth rift freezes under reduced
  motion.

### Hit feedback

Flinch strength and lean are now bounded 0..1 from the damage amount: grazes
nudge, heavy hits saturate, with a short directional lean that expires with the
220 ms window. Kill confirmations now accept the simulation's `killer` field
(they previously read `source`, which deaths never emit, so the chirp was
dormant).

### Viewmodel

- **Melee swing** on the existing melee press: a 180–260 ms deterministic arc,
  reduced motion snaps.
- **Shell casings**: a pooled ballistic case per local ballistic shot with a
  quality-tier budget, skipped for energy weapons, software renderer and
  reduced motion.

### Death audio

The planner's `sound` family (`thud/pop/splat/burst/boom/zap`) selects a
distinct deterministic synthesis voice instead of one generic death noise, with
seed-derived pitch/level only, and a bounded high-damage hit bell.

### UI motion

- A `motion-reduced` root class (mirrored on `<html>`) makes the in-game
  reduced-motion setting as authoritative as the OS query for every CSS
  animation and transition.
- Entrance motion for modals, toasts, notices and screen shells (140–280 ms,
  paint-only so hit-target geometry is unchanged); cocs notices also fade out.
- Fixed: the terminals panel always received `reducedMotion: true`, the
  low-health pulse had no reduced override, the orphaned `fadeIn` rule, and
  Radix select keyframes under reduced motion.
- Damage numbers rise harder for criticals and settle with a ≤7% scale pop.

## Verification

- `game/deaths.test.mjs`, `game/phase1-characters.test.mjs`,
  `game/character-anim.test.mjs`, `game/view.test.mjs`,
  `game/phase1-character-integration.test.mjs`, `game/feedback.test.mjs` — all
  green, with new coverage for style fidelity, direction yaw, per-pose arcs,
  seeded silhouettes, treatments, strength-scaled flinch, cleanup, rift gating,
  melee/casing bounds, the `killer`-field confirmation and the audio families.
- `tests/ui-motion.test.mjs` and the existing UI/SSR suites for the motion work.
- Screenshots through the test-only `tokenArenaDebug.death(...)` hook show one
  frame with eleven styles producing distinct silhouettes, splays and debris,
  with no floor or shadow artifacts against a clean baseline.

## Deliberately not done

- No changes to `game/core.mjs`: headshot/critical flags do not exist in the
  simulation, so the renderer cannot invent them without balance work.
- No per-style corpse meshes or spawned head props; head removal is visibility
  timing.
- Casings have no floor collision; they follow a deterministic arc and fade.
- No ragdoll physics — poses remain deterministic and replay-consistent.
