# Combat pass: alt-fire, abilities, movement and their feedback

**Date:** 2026-09-20
**Scope:** every weapon gets a held alt-fire mode that transforms its model and
behaviour; every harness active and operator signature verb lands harder and is
visible; movement verbs are tuned and hardened; all of it is wired through sim,
protocol, view, audio and HUD. Companion to
[CLASS_OVERHAUL.md](CLASS_OVERHAUL.md) (the ability model) and
[ANIMATION-PASS.md](ANIMATION-PASS.md).

## Alt fire

### Input

Alt fire is a **held trigger**: hold to transform the weapon and fire its alt
mode, release to stow. Bindings:

- `KeyZ` (remappable action `altFire`, label "Alt fire") and middle mouse.
- Touch gets a held `ALT FIRE` button in the combat and lattice clusters.
- `altFire` rides the input envelope as a held field next to `mobility`; the
  room forwards it through `peer.latest`, the shadow predicts it, and the
  protocol stays version 3 (the envelope is additive).

### Simulation

`game/alt-fire.mjs` is the single frozen table (`ALT_FIRE`, one spec per weapon
index). `Match.altFire(a)` mirrors the primary guards and spends the **same
`shotWait` cadence**, so the two triggers can never stack DPS. Events and
snapshot:

- `a.alt` boolean on the snapshot; `alt-state {actor,weapon,alt,pos}` on flips.
- `shot {alt:true, altId, pellet}` per pellet; `launch {alt:true, altId, id,
  projectile, ...}` for projectiles; `explosion {alt, altId, projectile}`.
- Deterministic mine/cluster/flak behaviours in the rocket step (no RNG).

| # | Weapon | Mode | Behaviour | Appearance |
|---|--------|------|-----------|------------|
| 0 | Pulse Rifle | SALVO | 3-pellet fan, 9 dmg each, 0.5 s | barrel splits to three prongs |
| 1 | Rocket Launcher | CLUSTER | slower rocket, 3 bomblets on impact | tri-tube cluster pod unfolds |
| 2 | Rail Lance | OVERLOAD | 68 dmg pierces 3, 1.5 s | coils separate and glow |
| 3 | Scattergun | SLUG | single 38 dmg slug, holds at range | long single-bore choke |
| 4 | Plasma Driver | MORTAR | lobbed orb, wider blast | emitter dome tilts and rounds |
| 5 | Grenade Launcher | PROXIMITY MINE | sticks, arms 0.45 s, triggers at 2.6 m, max 2 | drum seals, sensor eye blinks |
| 6 | Shock Beam | CHAIN | 32 dmg arcs to 3 targets | antenna prongs rise and crackle |
| 7 | Flak Cannon | FLAK BOMB | lobbed shell bursts into 8 shrapnel rays | flak funnel opens |
| 8 | Marksman Rifle | DOUBLE TAP | two precise 26 dmg shots | scope folds for canted sights |
| 9 | Submachine Gun | TWIN | two barrels, 4.5 dmg each, double ammo | second barrel + foregrip fold out |

### Presentation, audio, HUD

- `game/weapon-models/alt-parts.mjs` holds the ten morph tables and extra
  meshes; the view lerps a per-model 0..1 amount (~0.16 s, instant under
  reduced motion), tints the muzzle flash with the spec tracer, and adds
  alt-projectile visuals (cluster pod, mortar orb with trail, flak shell,
  persistent blinking mine) with pooled lifetimes and disposal.
- `game/feedback.mjs` gives every alt id its own deterministic voice, plus a
  short deploy/stow foley on `alt-state`; the generic gunshot is replaced, not
  layered.
- The HUD shows the held mode chip (`SALVO`) in place of AUTO/SEMI, a live
  `ALT <key>` hint, and the arsenal inspector lists each mode's label and
  summary. Captions announce alt mode changes and alt shots.

## Abilities

### Harness actives (stand out more, hit harder)

| Harness | Change |
|---------|--------|
| OpenClaw Claw Burst | radius 6 m, 30 damage, knockback 14, lift 5 |
| Hermes Courier Rush | duration 3.5 s (speed stays at the +60% cap) |
| OpenCode Parallel Burst | 1.82× fire rate, 3.5 s |
| Claude Code Guardrail | 3.5 s (resistance stays at the 50% mitigation clamp) |
| Codex Recompile | heals 45 |
| Cline Phase Step | 7 m dash |
| Roo Context Jam | 8 m radius, 50% slow |

### Operator signature verbs (visible at last)

Nine verbs now have presentation derived from the snapshot: Heat weapon glow,
Deep Compute charge ring/visor with a full-charge flare, Alignment Review meter
+ pool pips + spend flash, Braced regen motes, Tool Use window ring, Long
Context ground trails, Adaptive first-mag swap flash, Effortless air streaks
and Revision swap flash. A new HUD `verbMeters` row renders the numeric
readings (heat %, charge %, review pool, braced window, first-mag, tool-use,
trails) next to the ability card.

Tuning: Heat +16% at 5 hits, Deep Compute +40% built in 1.0 s, Braced 6/s,
Review 45 absorb over 3 s, Adaptive .93/.94, Long Context range 1.10, Tool Use
window 3.5 s and interval .88, Effortless air accel 1.4 / buffer .05. The
§4.7 caps (speed +60%, single hit ≤ min(90, 0.9×HP), intel TTL ≤1.5 s) hold.

### Movement verbs (all nine, tuned and hardened)

Air-dash 6 m / 2.2 s, double-jump 7.8 impulse, super-jump .45 s wind-up / 5 s
cooldown, hover jets 3 s fuel / 1.6 s recharge, brace-slam .12 s wind-up / 7 s
cooldown / 4.5 m radius, safety glide 1.7 m/s descent / 4.5 steer / 3 s pool,
grapple 6 s cooldown / 2.5 s miss, blink step .25 s wind-up / 5 s cooldown,
deployable rope 10 s cooldown / 10 m/s ride. Fixed a real bug: an interrupted
blink wind-up banked its chain link and inflated the next blink; the link is
now banked only when the translation fires.

## Verification

- New `game/alt-fire.test.mjs` (16 tests) plus protocol/room/net/input pins for
  the held field; `game/ability-vfx.test.mjs` (10) and
  `game/alt-fire-presentation.test.mjs` (12); audio families in
  `game/feedback.test.mjs`; HUD/verb/caption pins in `game/hud*.test.mjs`,
  `game/keybinds.test.mjs`, `game/touch.test.mjs` and the SSR suites.
- Ability parity fixture regenerated through the documented
  `COCS_UPDATE_ABILITY_PARITY=1` path; TTK envelope, single-hit clamp and §4.7
  bounds stay green.
- Browser evidence: alt morph/alt chip, middle-mouse hold, a placed proximity
  mine, harness activation, grapple HUD countdown, and cleaned HUD layout at
  1366×768, 1920×1080, 390×844 and 844×390, with zero console/page errors.
- Fixed while testing: the PlayingHud assistive live-region effect called
  `setState` on every snapshot commit and could trip React's update-depth
  guard after ~20 s of play; it now writes only when the rendered text changes.
