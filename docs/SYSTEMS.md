# COCS — Systems Reference

Engineer-facing description of how each gameplay system works in the code. Symbols
are named by module, not line number. Where the historical spec disagrees with the
current code, this document follows the code. Values are quoted from source; anything
unverified is called out explicitly in [Uncertainties](#uncertainties).

Canonical sources: `game/*.mjs`, `server/*.mjs`, with cross-checks against
`README.md`, `docs/spec/SPEC.md`, `docs/spec/DEVPLAN.md`, and `docs/VERIFICATION.md`.

---

## 1. Overview and determinism

The simulation is a fixed 60 Hz step. `RULES.dt` in `game/data.mjs` is `1/60`; every
authoritative consumer advances by that delta:

- `Match.step(dt, inputs)` in `game/core.mjs` is the single entry point for simulation.
- `server/room.mjs` `Room.tick(dt)` accumulates real time and runs at most 5
  `RULES.dt` sub-steps per call (`while (this.tickAcc >= RULES.dt && steps < 5)`).
- `app/page.tsx` clamps its accumulator to `RULES.dt * 5` in both the local and
  network playing loops.
- `Race` and `Soccer` re-slice large host ticks internally into `1/60` slices
  (`stepRace`, `stepSoccer`).
- `server/game-server.mjs` drives `RoomRegistry.tickAll(tickDt)` on a `setInterval`
  whose default period is `1000 / 60` ms.

Bounded catch-up means a slow frame cannot spiral: excess elapsed time is discarded
rather than simulated unboundedly.

Randomness is injected, never an ambient global inside the core:

- `new Match(character, harness, random, mapId, options)` takes a `random` function.
  It defaults to `Math.random`, but a seeded generator produces byte-identical match
  traces. It is used for spawn scoring, bot aim error/reaction jitter, and spread.
- `game/net.mjs` `NetHarness` uses a deterministic LCG so prediction and
  reconciliation can be asserted frame-for-frame.
- `game/levelgen.mjs` uses `mulberry32(seed)`; `game/challenges.mjs` uses its own
  `mulberry32`; `game/environment.mjs` uses a seeded `rng`.

Because state is seeded and fixed-step, the same inputs and seed reproduce the same
outcome. That property is load-bearing for three systems:

1. **Netcode** — the client runs a local shadow `Match` and reconciles it to server
   snapshots, so prediction and server must agree on exactly one trajectory.
2. **Replays/theater** — `game/demo.mjs` records keyframes and plays them back with
   deterministic interpolation.
3. **Tests** — `game/core.test.mjs` and friends assert exact damage, scoring, and full
   bot matches without a browser or GPU.

The renderer is never authoritative. `game/view.mjs` reads snapshots only; damage,
scoring, and collision are decided in `game/core.mjs`.

---

## 2. Match lifecycle and state ownership

`Match` (`game/core.mjs`) owns authoritative match state: `arena`, `actors`,
`vehicles`, `pickups`, `rockets`, `deployables`, `objectiveState`, `race`, `flags`,
`teamScores`, `events`, `feed`, `stats`, and `over`. It does not own menu flow.

The UI lifecycle lives in `app/page.tsx` as
`type Mode = 'selection' | 'browse' | 'lobby' | 'theater' | 'playing' | 'paused' | 'results' | 'progression'`.
Pause is a UI mode: it freezes simulation by not stepping `Match`. `changeMode` clears
input and pointer lock when leaving `playing`.

Match end:

- `Match.endMatch(reason)` sets `over = true` and `overReason`.
- `Match.step` returns immediately when `over`; `Room.tick` then stops stepping and
  emits `results` once, recording history and (if configured) progression.
- Rematch constructs a fresh `Match`; it never mutates the previous instance.

Snapshot/event model:

- `Match.emit(type, data)` appends `{ type, id: ++serial, time, ...data }` to
  `events`. The buffer is capped at 300 entries (`events.shift()`).
- `Match.snapshot()` returns a plain, detached view: config, mode/map names, time,
  `over`, `overReason`, `suddenDeath`, `feed`, actors (with `scoreStats`, serialized
  `ammo` where `Infinity` becomes the string `'∞'`, and a trimmed `bot` block),
  vehicles, pickups, deployables, flags, team scores, winner, `objectives`, projectile
  counts, rockets, stats, leaders, and single-player state.
- `server/room.mjs` `wireState()` sends `quantizedCopy(this.match.snapshot())` so the
  wire payload is rounded and the live tree is never mutated (the snapshot shares
  frozen/mutable nested branches such as `powerups`).
- The React UI receives HUD snapshots at roughly 10 Hz; the renderer reads events by
  serial (`view.lastEvent`), not by diffing full state.

---

## 3. Movement and traversal

Entry point: `moveActor(a, input, dt, arena, config)` in `game/core.mjs`.

### 3.1 Constants

`RULES` (`game/data.mjs`): `dt 1/60`, `speed 8`, `radius .42`, `height 1.8`,
`gravity 26`, `jump 8.6`, `respawn 2`, `protection 1.5`.

`MOVE` (`game/core.mjs`): friction `6`, stopSpeed `2`, groundAccel `10`,
airAccel `3.5`, airCap `1.6`, sprint `1.375`, crouch `.4`, slideBoost `9.6`,
slideMin `.35`, slideFriction `2.5`, slideCooldown `.5`, terminal `2.2`,
eyeStanding `1.45`, eyeCrouch `.95`, baseHeight `1.8`.

### 3.2 Ground movement

Speed is composed multiplicatively:
`moveSpeed × config.speed × harnessSpeedMultiplier × speedMultiplier × active-rush × slow × gearSpeed × carrySpeed`.
Crouch forces `MOVE.crouch`; sprint requires grounded, non-crouched, non-zero input
and applies `MOVE.sprint`; ADS applies `×.9` and is disabled while sprinting.

Ground friction is Quake/Source style: `drop = max(horizontal, stopSpeed) * friction * dt`
and horizontal velocity scales down by the remainder. Held hop input or a buffered
jump skips friction on the landing frame so bunny-hops preserve speed.

Acceleration uses `accelerate`: only adds when the wish direction projects positive,
capped at `accel * dt * wishSpeed` and at the projection deficit. Slide acceleration
is `groundAccel * .4`.

### 3.3 Air movement and strafe jumps

Air acceleration caps the per-step add at `MOVE.airCap` (`1.6`) rather than the full
wish speed, so holding a straight line preserves momentum while strafing converts
direction changes into gains. A terminal clamp is `max(maxSpeed * MOVE.terminal, preInputSpeed)`.

### 3.4 Crouch, slide, coyote, buffer

- Crouch is sticky while `canStand` fails (no headroom), otherwise follows input.
- Sprint + crouch while grounded and moving above `6` starts a slide. If below
  `slideBoost`, horizontal velocity is scaled up to it; the slide has a `slideMin`
  timer, `slideFriction`, and a `slideCooldown` that is set on jump.
- Coyote time is `0.1 s`; jump buffer is `0.12 s`. A jump consumes both, sets
  `vy = RULES.jump`, and clears the slide.
- Variable jump: releasing a held jump while rising trims `vy *= .45` once.
- Apex hang: gravity is scaled to `×.6` when `|vy| < 2.5`, `config.gravity >= 1`, and
  the actor is not in a traversal flight.

### 3.5 Collision and terrain

- `floorAt(x, z, arena)` resolves the support height: terrain via `terrainSupportAt`,
  else platform surfaces, else raised-block decks and legacy ramps.
- `obstructed(x, y, z, r, arena)` tests block AABBs plus terrain wall segments.
- `supportAt` combines terrain/surfaces with solid block tops for "standable" queries.
- Move resolution uses sub-stepped, axis-separated sweeps. `steps` is chosen from the
  largest displacement divided by `.18`, bounding tunnel-through. Each axis moves only
  when `obstructed` is clear; blocked axes zero their velocity.
- Vertical motion is integrated after axes; solid tops become landings only when feet
  cross them while falling. Bounds clamp per axis per step.
- `rayWorld(o, d, max, arena)` is a slab/AABB ray test plus terrain ray hit plus a
  bounded ray march for analytic floors; `visible(a, b)` uses it with a small epsilon.
- `walkEdge(a, b, arena)` samples a straight segment at `.2` spacing, rejecting drops
  over `.3` and obstructions; it underpins the navigation graph.

### 3.6 Traversal devices

`traversalTables(arena)` builds and caches a per-arena view over `arena.traversal`
(and legacy `jumpPads`/`pads`/`launchers`):

- **Trampolines** set `vy = max(vy, power ?? RULES.jump * 1.5)`.
- **Boost launchers** solve a ballistic arc to their `target`: given launch `vy` and
  gravity, horizontal speed and direction are derived from the time of flight. The
  actor enters `traversalFlight` and snaps to the target floor within `.9`.
- **Teleporters** move the actor to `to` (or `target`), zero velocity, and set
  `traversalCooldown` (default `1`); they are blocked while riding a vehicle.
- **Ziplines** interpolate `from`→`to` over `distance / (speed ?? 9)` seconds
  (minimum `.35`) while `grounded=false`; cooldown default `1.2`.
- Pads/teleporters fire once per pad id while `traversalCooldown > 0`. Traversal
  events (`teleport`, `zipline`) are re-emitted through the match event stream.

Void maps set `arena.voidY`; falling below it calls `Match.fall`, dropping any flag,
counting a death, and emitting a `death` with a fall death plan.

---

## 4. Combat and weapons

### 4.1 Weapon table (`game/data.mjs` `WEAPONS`)

| # | Name | Damage | Pellets | Interval | Range | Ammo/cap | Reload | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 0 | Pulse Rifle | 11 | 1 | .10 | 70 | ∞/∞ | 0 | Hitscan, falloff 16→70 min .6 |
| 1 | Rocket Launcher | 35 + 60 splash | 1 | .85 | 60 | 6/18 | 2.5 | Projectile speed 22, radius 4 |
| 2 | Rail Lance | 82 | 1 | 1.20 | 90 | 6/18 | 2.2 | Hitscan pierce, no falloff |
| 3 | Scattergun | 8.5 | 8 | .78 | 24 | 10/30 | 1.9 | Spread .115, falloff 6→24 |
| 4 | Plasma Driver | 25 + 12 splash | 1 | .26 | 65 | 28/84 | 1.7 | Projectile speed 34, radius 1.6 |
| 5 | Grenade Launcher | 30 + 44 splash | 1 | .90 | 55 | 6/18 | 2.5 | Speed 18, gravity .65, bounce .45, life 3 |
| 6 | Shock Beam | 44 | 1 | .60 | 52 | 10/30 | 1.9 | Hitscan, falloff 14→52 |
| 7 | Flak Cannon | 6 | 12 | .84 | 22 | 12/36 | 2.0 | Spread .19, falloff 5→22 |
| 8 | Marksman Rifle | 38 | 1 | .46 | 80 | 10/30 | 2.0 | Hitscan, falloff 32→80 min .72 |
| 9 | SMG | 7.5 | 1 | .058 | 35 | 32/96 | 1.4 | Hitscan, falloff 11→35 |

Each entry also carries `recoil` (`kick`, `recover`, `pattern`), `bloom`
(`base`/`perShot`/`max`/`recovery`/`moveFactor`), and `feel` (synthesized audio and
visual metadata). `game/weapons.mjs` exposes derived `WEAPON_ROLES`, `weaponDPS`, and
`weaponTTK`; Pulse TTK against 100 HP is about 0.9 s at full falloff-free range.

### 4.2 Firing pipeline

`Match.fire(a, direction)`:

1. Rejects when `over`, dead, `shotWait > 0`, reloading, or weapon-switching.
2. Pins the weapon to the mode loadout / Arms Race ladder when one is active, and
   falls back if a restricted loadout forbids the current gun.
3. On empty ammo, starts a reload or emits `dryfire`.
4. Applies harness handling (`harnessWeaponHandling`), mutator `noRecoil`, and any
   charge behavior (`chargeTime`, `chargeDamage`).
5. Sets `shotWait = interval × handling.interval × cooldownMultiplier × activeFireRate`
   plus `difficulty.fireDelay` for bots. OpenCode's active ability divides interval.
6. Adds recoil punch (`punchYaw`/`punchPitch` + velocities), increments the spray
   burst index, and grows `spread` by `bloom.perShot` up to `bloom.max`.
7. For each pellet, computes spread from base + bloom + movement factor via the
   shared `effectiveSpread` helper, perturbs the aim in the plane perpendicular to
   it (`aimBasis`/`spreadDirection`), then ray-tests world, actors (`hitActor`,
   `hitBox` scale `.85 × hitScale`) and vehicles. The HUD crosshair reads the same
   `effectiveSpread`, so the reticle matches the real cone.
8. Muzzle clearance is verified so shots cannot originate inside walls.
9. Hitscan applies `damageFalloff` then `damage`. Projectiles (`w.speed`) push a
   rocket record with owner, direction, `vy`, damage multiplier, life, bounces, and
   homing parameters.

Recoil recovery is a damped spring in `Match.step`: `punchVel += (-punch * recover² - punchVel * 2 * recover) * dt`.
Spread recovers by `bloom.recovery` per second. ADS multiplies spread by `.35`;
sprinting by `1.3`. Precision weapons keep small `bloom.moveFactor` values so
walking does not dominate the base cone. Weapon changes go through
`Match.switchWeapon` (mode/loadout/ammo validation, `.45 s` delay, reload cancel,
`weapon-switch` event), used by both human requests and bot decisions.

### 4.3 Projectiles

`Match.step` advances `rockets` with swept actor/vehicle/world tests. Gravity
weapons integrate `vy`; bouncy weapons reflect off floors up to 3 bounces.
`explode(r, hit)` applies direct damage, radial splash with line-of-sight checks,
and knockback (`+8` horizontal, `+4` vertical). Self-splash is allowed and uses the
normal protection/armor/suicide path. `blastUnsafe(weapon, distance)` is
`distance < radius * SELF_BLAST_MARGIN` (`1.15`), used by bots to avoid self-harm.

### 4.4 Reload, ammo, ADS, melee, grenade

- `startReload` requires `reload > 0`, finite `cap`, non-full magazine, and not
  already reloading. Completion adds `reloadAmount` up to `cap` (or `Infinity` under
  unlimited ammo) and emits `reload` start/end.
- `spawnInventory` (`game/config.mjs`) builds the ammo belt; slot 0 starts at
  `Infinity`, other weapons carry `ammo` and cap at `cap`.
- ADS is a level input (`controls.ads`) that tightens spread and lowers sensitivity;
  loadouts with `noAds` strip it. Presentation-side, the first-person ADS transform
  is solved from the weapon's real rear-aperture and front-tip anchors
  (`game/sights.mjs` `solveSightPose` / `sightAlignmentError`), so the active sight
  line is aligned to the weapon camera's centre ray; sights themselves are open
  (notch/aperture/front post, thin holo frame, open-ended scope) and the optic
  attachment mounts on the same interpolated sight line.
- `Match.melee(a)` uses `MELEE = { range: 2.4, damage: 45, cooldown: .6, arc: .2 }`,
  selecting the nearest enemy inside the arc with line of sight.
- `Match.throwGrenade(a)` launches the slot-5 launcher's grenade physics with a flat
  aim, `vy 5.5`, life `2.6`, and a 7 s actor cooldown.

### 4.5 Attachments (`game/attachments.mjs`)

Attachments occupy one of four slots (`optic`, `barrel`, `magazine`, `underbarrel`).
Each has a `level` gate, an optional `weapons` allow-list, multiplicative modifiers
(`damage`, `spread`, `interval`, `range`, `bloomPerShot`, `bloomMax`, `recoilKick`,
`reload`) and additive modifiers (`cap`, `pellets`, `burst`), plus an optional behavior
mode. Behavior modes: `burst`, `charge`, `pierce`, `explosive`, `homing`, `chain`.
`resolveAttachments` folds modifiers, clamps them to `MODIFIER_RANGES`, and collects
visual overrides. `applyAttachmentsToWeapon` returns a fresh weapon object;
`Match.weaponForIndex` caches the applied weapon per actor/attachment reference.

### 4.6 Damage resolution and death styles

`Match.damage(target, amount, source)`:

- Instagib / One Shot replaces the amount with `10000`.
- Applies `mutators.damageMultiplier`, source `damageMultiplier`, mitigation
  (`min(.5, max(harnessResistance, claudecode guardrail .5))`), and Berserk `×1.2`
  at a 3+ streak.
- Facing shields (NPC `npcShield`) reduce frontal damage and amplify flanking.
- Absorbs from `temporaryShield`, then `juggernautShield`, then armor (armor absorbs
  `damage * .6`, capped by available armor), then health.
- The `damage` event carries `shield` (temporary shield absorbed this hit) and
  `shieldBreak` (true when the summed temporary/Juggernaut shield plus armor fell
  from positive to zero on a still-living target).
- Life steal heals the source for 25% of actual health damage.
- Shots at bots set threat memory, target, suppression, and a fast replan.

On death, `Match.emit('death', ...)` includes a deterministic `seed` and a death
`style` from `deathPlan` (`game/deaths.mjs`). Styles are `ragdoll`, `headpop`, `gibs`,
`burst`, `combust`, `vaporize`, `splatter`, `electrocute`, `crumple`, `spinout`,
`collapse`. A weapon's style pool is hashed with overkill/headshot/fall context;
`hitReaction` produces a pure, presentation-only flinch/spray for non-lethal hits.
`HEADSHOT_MULTIPLIER` (`1.5`) exists in `game/constants.mjs` but the core damage path
does not consume it (see [Uncertainties](#uncertainties)).

Armor absorption is hard-coded to `0.6` in `Match.damage`, matching
`COMBAT_CONSTANTS.ARMOR_ABSORPTION`; that constant table is otherwise not imported by
the core.

---

## 5. Operators, harnesses, gear

### 5.1 Operators (`game/data.mjs` `CHARACTERS`)

| Operator | Health | Spawn armor | Speed |
|---|---:|---:|---:|
| ChatGPT | 100 | 0 | 8.0 |
| Claude | 115 | 10 | 8.2 |
| Grok | 110 | 0 | 8.3 |
| Meta | 100 | 20 | 7.6 |
| Gemini | 95 | 10 | 8.5 |
| DeepSeek | 120 | 0 | 7.4 |
| Mistral | 85 | 0 | 9.4 |
| Kimi | 90 | 15 | 8.7 |
| Qwen | 100 | 5 | 8.4 |

`resolveLoadout` and `validLoadout` enforce the Claude restriction: Claude can only
select `claudecode`; every other operator may pick any of the seven harnesses.
`Match.spawn` reads `CHARACTERS.stats` for max health/armor/speed and applies gear and
NPC profile overrides.

### 5.2 Harnesses

`HARNESSES` (`game/data.mjs`) defines the active power; `game/harness-profiles.mjs`
adds passives, weapon handling, vehicle skills, and bot hints.

| Harness | Power | Duration | Cooldown | Effect |
|---|---|---:|---:|---|
| OpenClaw | Claw Burst | instant | 10 | 5 m LOS pulse, 24 damage, knockback 12, lift 4 |
| Hermes | Courier Rush | 3 s | 12 | speed ×1.6 |
| OpenCode | Parallel Burst | 3 s | 14 | fire interval ÷.6 |
| Claude Code | Guardrail | 3 s | 14 | incoming damage ×.5 (never invulnerable) |
| Codex | Recompile | 2 s | 16 | heal 35 |
| Cline | Phase Step | .35 s | 11 | 6 m collision-sampled dash |
| Roo Code | Context Jam | 3 s | 15 | 7 m LOS slow to 55% |

Passives (speed/damage/resistance roughly 0.98–1.05) are small and bounded.
`harnessWeaponHandling` returns `{ affinity, damage, interval, spread, favored }`
where favored weapons get affinity `1.08 × 1.03`; damage/interval/spread are clamped to
`.9–1.12`, `.88–1.08`, `.88–1.14`. Each harness also carries a `bot` block
(personality, range band, retreat health, power trigger). `harnessVehicle` exposes
skill perks: auto-gunner, gunner damage, armor/repair, boost, traverse, speed.

`Match.power(a)` starts the active timer, consumes protection, emits `power`, and
implements the special cases: Codex heals (`ability.heal`), Cline dashes with `.12`
step collision samples and clamping, Roo applies a slow to visible enemies inside
range, OpenClaw damages and knocks back visible enemies inside range. Powers are
disabled under the Instagib mutator and while carrying a flag.

### 5.3 Operator and harness bot identities

`game/operator-profiles.mjs` maps each operator to a `role` (`adaptive`, `anchor`,
`disruptor`, `connector`, `duelist`, `ambusher`, `flanker`, `orbiter`, `optimizer`),
preferred weapon indices, and a strafe factor. `preferredOperatorWeapon` picks the
first available preference. `game/bot-personalities.mjs` blends the operator role with
the harness personality to produce the concrete behavior profile (see section 8).

### 5.4 Gear and loadouts (`game/progression.mjs`)

`GEAR` has three slots (`primary`, `armor`, `utility`) and eight items unlocked by
level. `resolveGear` sums health/armor and multiplies speed/damage/spread, then clamps
speed to `.5–1.6`, damage to `.5–2`, spread to `.5–1.6`, and armor to `≥0`.
`normalizeGear` keeps one item per slot and respects level gating. Gear is attached
per actor in `Match` (`a.gear = resolveGear(loadout.gear).modifiers`) and folded into
spawn stats and movement (`gearSpeed`, `gearDamage`, `gearSpread`).

Mode loadouts (`game/config.mjs`) are a separate layer: `GAME_MODES[].loadout`
pins weapons, infinite ammo, `noAds`, or `noPickups`. `loadoutFor` merges a mode rule
with an override; `spawnLoadout`/`spawnInventory` produce the spawn weapon and belt;
`loadoutAllows` gates weapon switches, pickups, bots, and upgrading. Presets:
`sniperOnly` (`[2,8]`) and `pistols` (`[0,9]`).

---

## 6. Vehicles (`game/vehicles.mjs`)

Five chassis are defined and frozen. `GUNTRUCK` is an alias of `PUMA` for legacy
call sites. `createVehicle` instantiates an independent runtime vehicle; `vehicleConfig`
resolves the template by kind.

| Chassis | Class | Health | Respawn | Top speed | Boost | Seats | Turret |
|---|---|---:|---:|---:|---:|---:|---|
| Puma (`GUNTRUCK`) | standard | 300 | 5 | 20 | 26 | 4 | Chaingun (2 barrels, dmg 5, .045 s) |
| Hornet | flight | 240 | 8 | 36 | 54 | 3 | Chaingun |
| Titan | heavy | 650 | 10 | 13 | 17 | 3 | Cannon (dmg 34, .9 s, heat .6) |
| Scout | light | 140 | 4 | 30 | 40 | 2 | Light gun (dmg 3, .06 s) |
| Transport | transport | 480 | 9 | 17 | 22 | 6 | Chaingun |

### 6.1 Ground handling

`stepVehicle`:

- Decomposes velocity into forward speed and lateral slip using `heading`.
- Engine thrust is `throttle × acceleration` (boost uses `boostAcceleration`), minus
  quadratic drag. Top speed is `speed` or `boostSpeed`, scaled by harness `speed`.
- Handbrake adds braking and raises steering/yaw; grip is speed-independent but
  drops with slope and lateral drift.
- Steering is `(speed / wheelBase) × tan(steer × maxSteer)` plus low-speed assist,
  clamped to `maxYawRate` (and `maxHandbrakeYawRate` under handbrake).
- Four wheel samples (front/rear/left/right) produce ground height, normal, pitch,
  and roll; body pitch/roll blend toward them plus acceleration/steer terms.
- Collision is delegated to `match.vehicleCollision`, which keeps the chassis inside
  arena bounds and out of solids.

### 6.2 Flight (`HORNET`)

`stepFlight` uses thrust/drag with a `turnRadius`-based yaw model. `lift` input
maps to climb or descend; hover holds altitude above `hoverHeight` (1.6) and below
`maxAltitude` (58). Roll/pitch are derived from yaw rate and vertical speed.

### 6.3 Turret, heat, and firing

The mounted gun fires when `vehicle.lastStep.fired` is set. Heat accrues
`heatPerShot`, cools at `coolRate`, and overheats at `maxHeat` for
`overheatCooldown`. `Match.fireVehicle` fires paired muzzles, ray-tracing actors and
other vehicles (friendly-fire aware) from each barrel with a small spread, applying
harness gunner damage (`gunnerDamage`) and heat. A gunner-occupied vehicle steps its
weapon through `stepVehicleWeapon` so heat/cooldown advance once.

### 6.4 Seats and boarding

`seatLayout` names `driver`, optional `gunner`, and passenger offsets.
`vehicleSeatFor` picks the first open seat; `vehicleMounted` reports a role.
`Match.enterVehicle` requires a free seat within `2.4` units (Hornet vertical
tolerance `3.2`) and forbids flag carriers. `Match.releaseVehicle` places the actor
to the side of the chassis on valid ground (or in place while flying). Bots ride
drivers/gunners and bail when stuck.

### 6.5 Destruction, respawn, run-over

`Match.damageVehicle` scales by `config.damage` and harness vehicle armor. On
destruction, occupants are released; the driver takes `70`, other occupants `40`;
the vehicle enters `respawnTimer` from `config.respawn`. `Match.step` decrements
timers and calls `respawnVehicle` with a `vehicle-respawn` event.

Run-over: when a grounded vehicle's speed exceeds `5`, actors inside
`vehicleRadius × .9` take `25 × (speed - 5)` with an impulse and a `vehicle-splatter`
event; each vehicle/target pair is throttled by `vehicleHits` to `.5 s`.

`Match.vehicleCollision` returns the resolved position or `false`; it also clamps
flight altitude. Team ownership is inferred from occupants for friendly-fire checks.

Spawn selection (`Match.spawn`) rejects blocked/unsupported points first, then
scores survivors by enemy clearance minus exposure (enemy line of sight), nearby
hostile projectiles, a decaying death heatmap (`_spawnHeatAdd`/`_spawnHeatAt`) and
a bonus for useful (non-overlapping) teammate proximity. A validated fallback
keeps the result finite and clear.

---

## 7. Game modes and objectives

`GAME_MODES` (`game/config.mjs`) is the canonical mode list. `modeRule(mode)` returns
`rules`; `teamMode` derives team framing from `rules.team`. `DIFFICULTIES` defines
bot reaction/think/error/fireDelay. `MUTATORS` composes on top of any mode.

| Mode id | Teams | Score | Win condition |
|---|---|---|---|
| `deathmatch` | no | frags | First to 15 frags or highest on time |
| `teamdeathmatch` | yes | teamFrags | First team to 30 frags |
| `ctf` | yes | captures | 3 flag captures; carrier speed `.9` |
| `koth` | yes | hillTime | 100 points, one per second on the hill; rotation every 30 s |
| `domination` | yes | zoneTime | 100 points from owned zones; zone buffs overshield/haste/overcharge |
| `assault` | yes | sectors | Attackers capture `fragLimit` sectors in order; breach the last |
| `combined-arms` | yes | zoneTime | Domination zones with vehicles, limit 200 |
| `payload` | yes | payload | Attackers deliver the cart; defenders win on the clock |
| `instagib` | no | frags | Rail only, infinite ammo, one-shot, no pickups |
| `rockets` | no | frags | Unlimited rockets |
| `arsenal` | no | frags | Every weapon, infinite ammo |
| `armsrace` | no | ladder | Ladder promotions; finish the last rung (limit 10) |
| `juggernaut` | no | juggernaut | Points bank; carrier has shield/damage aura; first to 30 |
| `team-elimination` | yes | elimination | Shared lives, 3 s respawn; attrition after 45 s every 9 s |
| `vip-escort` | yes | extraction | Escort a VIP to a beacon; defenders win if the VIP dies or time expires |
| `holdout` | yes | zoneTime | Hold `holdCount 2` zones for `holdSeconds 30` |
| `uplink` | yes | hillTime | Capture 3 sequential relay nodes |
| `puma-race` | no | laps | Cross every gate in order; first to `fragLimit` laps |
| `puma-soccer` | yes | goals | First to `fragLimit` goals or higher score at time |
| `horde` | yes | waves | Survive `fragLimit` waves (or endless) |
| `campaign` | yes | missions | Complete the scripted mission |

### 7.1 Objective templates (`game/mode-data.mjs`)

`objectiveTemplate(mode, arena, config)` dispatches on `rules.objective.kind`:

- `koth` — one hill, snapped to the nav graph; if authored `objectiveZones` exist,
  builds a rotation. **Uplink** reuses `koth` with `sequence` (default 3) to produce
  ordered stages and a stage race.
- `domination` — three zones (`alpha`/`bravo`/`charlie`), moved clear of solids and
  terrain. **Holdout** adds `holdCount`/`holdSeconds`.
- `assault` — `assaultTemplate` with `fragLimit` sectors.
- `payload` — `payloadTemplate` builds a walked route anchored to attacker/defender
  spawns with `fragLimit` checkpoints.
- `elimination` — `livesPerTeam = fragLimit`.
- `juggernaut` — points map, initial carrier id 0.
- `extraction` — VIP escort from first to last authored point.

### 7.2 Generic capture loop (`game/objectives.mjs` `updateObjectives`)

For KOTH/Domination/Holdout/Uplink:

- Actors inside a zone radius (and within 5 vertical units) count.
- One team present captures at `100 × dt / captureSeconds`; contested zones decay
  (`rate × .75` for neutralization, `rate` otherwise).
- Ownership changes at 100; losing progress to zero neutralizes a zone.
- Each owned zone scores every tick while not contested; events
  `zone-capture`, `zone-neutralized`, `zone-progress`, `zone-score` fire with
  progress buckets. KOTH rotates on `rotationSeconds` and emits `hill-rotate`.

### 7.3 Mode handlers

- `updateAssault` accumulates `objectiveTime` for attackers in the active sector and
  credits `objectiveCaptures` on sector captures; a breach ends the match.
- `updatePayload` accumulates cart time for attackers standing on the cart, credits
  checkpoints, and ends on delivery.
- `updateElimination` counts team deaths against a ticket pool, adds periodic
  attrition to the trailing team after `eliminationAttritionStart` every
  `eliminationAttritionEvery`, mirrors survivors into `teamScores`, and resolves a
  winner on tickets or time.
- `updateJuggernaut` banks survival points (`juggernautRate`), awards
  `juggernautKillBonus`/`juggernautBounty`, transfers the role on death, and ends on
  the point limit or sudden death.
- `updateExtraction` spawns a VIP NPC (health 260, armor 60), moves it toward the
  beacon while a friendly escort is within `escortRadius`, fills a progress bar, and
  resolves on extraction, VIP death, or time.
- `updateHoldout` tracks continuous quorum hold and wins at `holdSeconds`.
- `updateUplink` banks a stage on each capture, teleports the hill to the next node,
  and wins after all stages.

### 7.4 CTF (`Match` in `game/core.mjs`)

`Match.objective(a)` handles flag logic: flags carry state `at-base`/`dropped`/
`carried`; dropped flags only return home when the owner touches them; carriers set
`carryingFlag` and a `carrySpeedMultiplier`; captures require the enemy flag and a
home flag at base. Events: `flag-pickup`, `flag-drop`, `flag-return`, `capture`.
`dropFlag` places a dropped flag on the highest surface below the drop point, or the
carrier's last valid ground, or resets it to base.

### 7.5 Race (`game/race.mjs`)

`initializeRace` requires `arena.race.gates` and a grid. Racers are PUMA chassis;
`crossRaceGates` only advances the expected gate using a swept forward-plane test,
gate half-width, and a 0–3 height window. Progress is `passed - 1 + fraction`.
Items (`ITEMS`) are rolled with rank-weighted probabilities; hazards (oil/mine) slow
opponents. Rubber-band pace scales speed `0.93→1.10` from leader to trailer; coins
give up to `+1.2%` each. Car collisions use equal-radius circles (`CAR_RADIUS 1.7`)
with elastic-ish normal velocity matching. Reset returns a stuck racer to its last
anchor.

### 7.6 Soccer (`game/soccer.mjs`)

Two Pumas per team drive a ball on a pitch defined by `arena.race`. `stepBall`
applies friction, board/block bounces, and goal-line crossing (swept, half-width and
height validated). `resolveBallCars` transfers chassis normal velocity plus a glance
slice. Anti-stuck shoves a resting contacted ball and resets after 8 escapes.
`scoreGoal` credits the last touch, resets the ball, and ends at the goal limit.

---

## 8. Bot AI

Entry: `botInput(match, a, dt)` in `game/bots.mjs`. Bots and NPCs share the entire
movement/combat/power/pickup surface with humans.

### 8.1 Decision cadence and perception

- `b.think` counts down; on replan it becomes
  `clamp((difficulty.think + random()*.15) * behavior.thinkScale, difficulty.think*.6, (difficulty.think+.15)*1.4)`.
- Scan range `a.botScan` comes from `BOT_SCAN` (base 33–39, scale with arena diagonal,
  cap 44–60) by difficulty.
- A target must be alive, within scan, and `match.visible(eye(a), eye(t))`, with a
  cloak exception inside 4 units. Locked teammates' targets are de-weighted so the
  squad spreads fire.
- `difficulty.reaction` (plus jitter) gates firing after first sight; `difficulty.error`
  feeds a per-think aim error vector; `difficulty.fireDelay` is added to bot shot
  intervals only.

### 8.2 Behavior profiles (`game/bot-personalities.mjs`)

`botBehavior(actor)` blends the operator role and harness personality into one frozen
profile: `strafePattern`/`strafePeriod`/`strafePhase`, `weaponBand`, `engageBand`,
`thinkScale`, `aggression`, `hold`, `flank`, `objective`, `supply`, `vehicle`,
`strafe`, `range`, `spacing`, and `retreat`. A deterministic combat archetype
(`rusher`, `flanker`, `defender`, `support`, `sharpshooter`) is voted by role and
personality with a stable per-id hash tiebreak (`botArchetype`, `botNoise`).
`botWeaponBandPick` maps the band to weapon preferences; the core requires ammo.
Weapon selection goes through `Match.switchWeapon` (the same operation humans
use) with an explicit `chooseWeaponIndex` scan and a `weaponCommitUntil` window,
so a bot cannot assign `a.weapon` directly and does not oscillate around a
distance band.

### 8.3 Navigation and pathing

- `navigation(arena)` builds a node grid (`step 3`, or `6` for `nextGen`), adds
  nav nodes, pickups, spawns, traversal pads, and link edges for jump links and
  teleporters. `navigationEdges` uses a spatial bucket for large maps; a
  `pruneToLargestComponent` pass removes isolated islands except where a traversal
  link reconnects them.
- `astar(a, b, nodes, edges)` is weighted A* (distance edge costs, straight-line
  admissible heuristic) returning `{route, cost, reachable}`; `path` returns the
  node-index route or an empty route for an unreachable destination. Bots advance
  along `b.route`, shifting nodes within `.8`. Routes are cached per destination
  and replanned on a staggered per-bot cadence (`b.routeDest`/`b.routeAt`).
- `walkEdge` validates a direct step; `match.separation` pushes bots apart.

### 8.4 Objective play

- CTF: carry to home, return/defend the home flag, attack the enemy flag; defenders
  use `defensivePost`.
- KOTH/Domination/Combined Arms/Holdout/Uplink: `objectiveAssignment` sorts teammates
  by id, assigns a defending prefix, and round-robins attackers over contested then
  enemy zones; `zoneSlot` places a slot on reachable ground; `zoneDefense` picks an
  undefended owned zone; scattered squads regroup to `teamCentroid`.
- Assault/Payload: attack the active sector or push the cart, defend as assigned.
- Juggernaut: hunters bias toward the carrier.
- `coverPoint` finds reachable cover that breaks line of sight: one Dijkstra flood
  from the bot gives route cost to every node, and candidates are scored by cost,
  a capped safety-distance benefit (farther from the threat is safer) and whether
  the threat stays inside the bot's weapon range. `flankDestination` picks a node
  with real lateral separation from the direct route, keyed to the current target
  and expired/invalidated when the target changes.

### 8.5 Vehicles, threats, recovery

- Bots board a vehicle when `behavior.vehicle > .32`, a non-passenger seat is open,
  and it is within `2.4` units (or within `16` if the destination is far); stuck
  drivers bail and set a cooldown.
- Being shot sets `b.memory`, `b.seen`, `b.target`, `b.threat`, and `b.suppressed`,
  forcing a fast replan.
- Stuck detection (`b.stuck > 1.3 s` and moved under `.35`) clears the route, jumps,
  or triggers a short `recover` fuzz. Void maps steer grounded bots away from
  unsupported ground and nudge falling bots toward a nav node.
- NPC zones (`npcZone`) are hard for `patrol`/`hold` and soft for `spawn`; NPCs are
  clamped to their leash or returned home (`confineDestination`, `clampToZone`).

---

## 9. Single-player

Modes `horde` and `campaign` are local only. `initializeSinglePlayer(match)` drops
all actors except the human (`id 0`), sets `humanCount = 1`, `botCount = 0`, and
builds `match.modeState`. `updateSinglePlayer(match, dt)` steps enemy role abilities,
health regeneration, and the mode handler, and loses on the match clock.

### 9.1 Horde (`game/singleplayer.mjs`)

- `HORDE_CONFIG` per difficulty: base wave, growth, `maxAlive` (12–24), intermission
  (7–3 s), `eliteEvery`, `countScale`.
- `HORDE_COMPOSITION` is a wave-indexed archetype table; `hordeWaveComposition`
  scales it and caps at `maxAlive`. Past the table, husks grow by `growth`.
- `HORDE_WAVE_MODIFIERS` cycles a deterministic twist per wave (`swarm`, `mixed`,
  `artillery`, `shielded`, `elite`, `flanked`, `fortified`, `champion`).
  `hordeWavePlan` swaps (never inflates) bodies to express the twist. Endless runs
  escalate a boss every fifth wave, alternating Warden/Harbinger.
- Scoring: `hordeWaveScore = round((100 + wave*25) * countScale)` plus
  `HORDE_BOSS_BONUS 500` on boss waves; `hordeWaveScoreTotal` is the run total.
- Intermission resupplies full health/armor/ammo and reapplies banked upgrades.
  Every 3–5 waves (`HORDE_UPGRADE_GAPS`) offers a choose-one powerup that lasts the
  run. `hordeSummary` banks the final record.
- Player lives default to 3; death decrements a life and out-of-lives loses.

### 9.2 Campaign (`game/campaign-data.mjs`, `game/singleplayer.mjs`)

Five missions in three acts: `convoy-run`, `reactor-run`, `throne-siege`,
`ghost-wire`, `crown-duel`. Each has `mapId`, `weather`, `start`, `intro`/`outro`,
`win` fallback, ordered `steps`, and `script` events.

- Step completion kinds: `enter-zone`, `group-dead`, `boss-dead`, `timer`, `hold`.
- Step actions and script fields: `story`, `bark`, `bossPhase`, `weather`,
  `timeOfDay`, `announce`, `objective`, `spawn`, `ally`, `win`, `lose`, `lives`,
  `checkpoint`.
- Script triggers: `at`, `after`, `when: 'cleared'`, `'boss-dead'`,
  `'player-in-zone'`, `'enemiesAtMost:N'`, `'boss-hp:<fraction>'`.
- Win conditions: `eliminate`, `survive`, `assassinate`, `reach`, `defend`.
- `story.mjs` `MISSION_LORE` appends timed transmissions (`lore:true`) that play as
  `story-line` events; `SPEAKERS` names DISPATCH, RELAY, WARDEN, HARBINGER, ECHO.
  `singlePlayerSnapshot` resolves a speaker to `{speaker, callsign, color, tag}` so
  the HUD renders the callsign, tag chip and speaker colour; barks use their own
  class and a redacted `[CALLSIGN]` prefix.

Health regen (`updateHealthRegen`): after `REGEN_DELAY 4.5 s` without taking damage,
heal `REGEN_RATE 14` HP/s; firing delays regen (`>= 2.0 s`).

### 9.3 Enemy types (`game/enemy-types.mjs`)

Thirteen classes, all frozen: `husk`, `spitter`, `brute`, `warden` (boss), `mender`,
`sapper`, `overseer`, `bulwark`, `mortar`, `lancer`, `sentinel`, `harbinger` (boss).
Each carries health/armor/speed/damage multipliers, a range band, `hold`, aggression,
leash, scale, colors, and points. Role abilities ticked by `updateEnemyRoles`:

- Overseer: damage/speed aura with a telegraphed pulse.
- Mender: heals nearby allies for `heal` on an interval.
- Sapper: melee detonation with a fuse when inside `trigger`.
- Mortar: marks the player's position and drops a telegraphed AoE.
- Lancer: seeks cover, telegraphs, then bursts speed/damage.
- Sentinel: pulses a temporary front shield to nearby allies.
- Bulwark: facing shield reduces frontal damage and rewards flanking.
- Harbinger: summons husks on a cooldown; count grows with boss phase.

Boss phases are pure data. Warden phases: WARDEN (stomp 6.5/28, telegraph 1.1),
OVERCLOCKED (7.5/38), LEGION (9/50). Harbinger phases: HARBINGER, SWARMLORD,
OBLIVION. `bossPhaseProfile` resolves the active stat/attack overlay.

### 9.4 Progress (`game/campaign-progress.mjs`)

Local campaign progress tracks completed missions (`wins`, `attempts`, `bestTime`,
`bestScore`, `at`), sequential unlocks (`isMissionUnlocked`), a banked `checkpoint`,
stars (par time `120 + 45 × steps`; score target 60% of authored enemy budget), and
medals (GOLD at 3 stars). `recordMission`, `setCheckpoint`, and `checkpointFor`
persist through the page's local storage.

---

## 10. Progression and meta

### 10.1 XP and levels (`game/progression.mjs`)

- `MAX_LEVEL 60`; `xpForLevel(l) = 500 + (l-1)*250`; `levelFromXp` walks the curve.
- `matchXp` = `max(10, round(40 + frags*12 + objective + (win ? 80 : 0))) + bonusXp`.
  Objective credit is `objectiveTime*1.5 + objectiveCaptures*30 + captures*120 +
  flagPickups*15 + flagReturns*10`. The local award path passes challenge XP as
  `bonusXp`.
- `awardMatch` adds XP, kills, wins, flawless wins, best streak, mode stats, and
  achievement XP, then recomputes level, prestige, and unlocks.
- `RANK_TITLES` names levels 1/5/10/20/35/50.

### 10.2 Prestige

`prestigeFromXp` banks one rank per `PRESTIGE_XP 6000` past the level-cap total,
capped at `PRESTIGE_MAX_TIER 6` (Bronze…Apex). Each tier grants a match-XP bonus of
`5% × tier`.

### 10.3 Unlocks, achievements, challenges, history

- `UNLOCKS` folds gear, attachments, weapon finishes, and crosshairs by level.
  `normalizeProgression` reconciles level-granted unlocks.
- `ACHIEVEMENTS` (12) are deterministic predicates over a derived context
  (`achievementContext`); `unlockedAchievements` and `awardMatch` unlock once and pay
  flat XP bounties.
- `game/challenges.mjs` rotates 3 daily and 3 weekly objectives from seeded pools
  (`daySeedFor`, `weekSeedFor` anchored to Monday 2024-01-01 UTC). `applyMatchAll`
  advances both and pays bonus XP once per objective.
- `game/history.mjs` stores local match summary cards; `server/history.mjs`
  `MatchHistory` persists server matches as `{id, roomId, mapId, mode, fragLimit,
  timeLimit, endedBy, duration, leader, players}` to JSON atomically (temp rename),
  capped at `HISTORY_CAP 50`.
- `server/progression.mjs` `ProgressionStore` is the server mirror, keyed by player
  id and owned by a progress token, with `sanityCheckResult` clamps
  (`SANITY.maxKills 1000`, `maxDeaths 1000`, `maxObjectiveTime 3600`,
  `maxCaptures 80`, `maxStreak 1000`, `maxMatchSeconds 3600`, `maxXpPerMatch 20000`)
  and a `PLAYER_CAP 500` profile limit.
- `game/presets.mjs` stores up to 8 named loadout presets (`PRESET_LIMIT`) and
  display presets (Performance/Balanced/Quality).

---

## 11. Maps, levelgen, and schema

### 11.1 Registries

`game/maps.mjs` composes `MAPS` from authored arenas and packs: `exchange`,
`crosswire`, `foundry`, `launchpad`, `citadel`, `blood-gulch`, `ISLAND_MAPS`,
`EXPANSION_MAPS`, `CTF_MAPS`, `BATTLE_MAPS`, `ARSENAL_MAPS`, `NEXTGEN_MAPS`,
`RACE_MAPS`, and `PUMA_PITCH`. `getMap(id)` falls back to `MAPS[0]`.
`pickupWeapon(kind)` maps pickup kinds to weapon indices; `SUPPLY_KINDS` lists
non-weapon supplies (`health`, `armor`, `ammo`, `megahealth`, `weaponUpgrade`,
`deployable`).

`game/arenas.mjs` adds selection metadata: `ARENA_GROUPS`, `ARENA_SCALES`,
per-map `AUTHOR` entries (group/scale/legacy/play), `arenaSupportsMode`,
`mapsForMode`, `maxBotsFor`, and `recommendedBots`. `Match` falls back to a
mode-appropriate map when the chosen map does not support the mode.

### 11.2 Authored geometry and schema

`game/map-schema.mjs` provides builders (`wall`, `cover`, `platform`, `pad`, `tp`,
`teleporter`, `zone`, `teamSpawns`, `flagSpawns`) and `validateMapSchema`, which
checks `id`, `name`, finite positive bounds, required arrays, block dimensions,
in-bounds spawns/pickups/nav nodes/objective zones, and team/flag spawn shapes.
`LEVELGEN_SCHEMA_VERSION 2`. `freeze` deep-freezes map templates.

### 11.3 Procedural levels (`game/levelgen.mjs`)

`createLevel(spec)` builds a deterministic map from a seed:

- `terrainField` triangulates a heightfield from `fbm` value noise, groups triangles
  into biome material surfaces, and emits steep cell edges as collision walls plus
  visible cliff faces.
- Feature builders: `addBuilding` (walls, doorway, roof, windows, nav chain),
  `addCompound` (interior partitions), `addTerrace`, `addTower`, `addTunnel`,
  `addCavern`, `addArch`, `addColumn`, `addBridge`, and biome prop scatter
  (`addRock`, `addTree`, `addCrate`, `addBarrel`, `addRuin`, `addBiomeProps`).
- Default spawns/objectives, route nav chains between objectives and team spawns,
  required supply placement, and a clearance pass (`clearSpot`) nudge pickups,
  spawns, objectives, and flags out of solids.
- Validation runs at the end; `spec.validate === false` opts fixtures out.
  `degenerateLayout` is a tooling/test rejection helper.

### 11.4 Biomes, weather, and environment (`game/environment.mjs`)

- `skyPhase` picks `day`/`dusk`/`night` from an authored `sky`, a night-map set, or
  background luminance; `skyPalette` derives a pure palette; `skyGradientAt` produces
  the dome gradient.
- `addSky` builds a vertex-colored dome with optional stars, sun disc, haze band, and
  halo; `addMountains` is a single instanced ridge mesh.
- `addScatter` places instanced grass/rock/fern plus biome families under a hard
  `SCATTER_TRIANGLE_BUDGET` (120000), trimming whole families largest-first.
- `ambientProfile` and `biomeAmbience` map biomes to motes, tint, and audio mood.
- `WEATHER_KINDS` presets define particle counts, fog density, tint, exposure,
  lightning, and wind. `selectWeather` is a deterministic biome/seed roll;
  `timeOfDayAt` runs a 90 s menu cycle or 600 s play cycle.
- Pure, replay-safe generators: `precipParticleAdds`, `lightningSchedule`,
  `windGustAt`, `wetSheen`, and `smokeAnchors`.

`game/terrain.mjs` is the deterministic geometry layer: `terrainTriangles`,
`terrainWallTriangles`, `terrainWallSegments` (all cached), `terrainSupportAt`
(highest walkable triangle under a slope limit), `terrainRayHit` (Möller–Trumbore),
and `terrainBounds`.

---

## 12. Rendering and performance

Entry: `game/view.mjs` `ArenaView`.

### 12.1 Renderer selection and scene graph

`ArenaView` tries `canvas.getContext('webgl2')`. With WebGL2 it builds a Three.js
`WebGLRenderer` with ACES tone mapping, `SRGBColorSpace`, `PCFSoftShadowMap`, a
PMREM `RoomEnvironment`, PCF shadows, and a directional sun plus hemisphere/rim
lights. Without WebGL2 it constructs `game/software.mjs` `SoftwareRenderer`, a CPU
painter that consumes the same scene and camera, paints a gradient sky and ridge
silhouette, and rasterizes projected triangles with painter sorting.

The scene is organized under `worldGroup` with separate groups for blocks, terrain,
detail batches, traversal devices, next-gen structures, props, sky/mountains/scatter,
and objective/pickup/vehicle/actor models. `buildArena` disposes the previous world
and rebuilds it from immutable map templates; `setMatch` keys actor models by id.

First-person weapons render through a dedicated `weaponScene` + `weaponCamera`
(`weaponFov`) rather than the main camera. The active weapon is parented to a
`weaponRoot` mirrored on the camera, the world depth is cleared before the
weapon draw, and weapon meshes keep `depthTest`, so the gun's parts occlude each
other correctly without clipping into world geometry. The CPU renderer keeps the
legacy in-camera path (`depthTest` off). `assembleWeapon` exposes named anchors
(`muzzle`, `rearSight`, `frontSight`, `leftGrip`, `rightGrip`, `magazine`,
`bolt`, `hinge`) and a sight-derived `userData.aim`; `_animateWeaponParts` drives
reload/bolt motion from authoritative state, and weapon changes run a two-phase
lower/swap/raise (`_swap`).

### 12.2 Procedural assets

- `game/textures.mjs` `surfaceTextures` generates cached value-noise/FBM albedo,
  roughness, and normal maps per surface kind; `clearSurfaceTextures` disposes them
  on rebuild. `wetSheenTexture` supplies a shared wet blotch overlay. Besides the
  noise kinds it has hand-written pattern generators — `carbon_fiber`,
  `metal_grating`, `hex_paneling`, `hazard_stripes`, `weathered_concrete`,
  `holographic_grid`, `diamond_plate`, `riveted_armor`, `circuit_board`,
  `brushed_metal`, `corrugated_metal`, `alien_chitin`, `rough_stucco`,
  `industrial_mesh` (`TEXTURE_KINDS`) — with alias names resolved by
  `canonicalTextureKind`. `surfaceTextures({bump:true})` also emits a dedicated
  `bumpMap`; the cache key encodes the normal/roughness/bump flags. Every generated
  map is tagged `userData.surfaceKind` so `disposeObject` never frees a shared
  cached map. Albedo, roughness and normal share one height/wear field so relief
  and roughness line up; `MATERIAL_PRESETS` (painted armour, exposed steel,
  rubber, stone, energy) describe the common surfaces.
- `paintGeometry` adds deterministic per-vertex/per-triangle color variation.
- `ArenaView.buildArena` picks a surface kind per map for the floor and non-race
  blocks (e.g. `holographic_grid` on `neon-vertical`/`crosswire`, `diamond_plate`
  on `foundry`, `riveted_armor` on `citadel`/bunkers, `metal_grating` on the
  megastructure maps, `carbon_fiber` on the pads), and `terrainTextureKind` maps
  terrain (  `industrial_mesh` for metal, `rough_stucco` for stone, `corrugated_metal`
  for lava). `assembleWeapon` owns per-weapon anchors and the sight-derived ADS
  transform; `hornetModel`/`vehicleModel`/`robotModel` add Hornet
  fins/skids/pod/beacons, a Puma front splitter, hood vents, tail-lights and
  exhaust pipes, and forearm/lower-leg armour plates.
- `EffectPool` (`game/feedback.mjs`) is an allocation-free pooled particle system:
  recycling scans linearly for the oldest slot (no `filter().sort()`) and each slot
  keeps persistent scratch `Vector3`/`Color` instances. `add` supports `fade`
  (`linear`/`smooth`/`exp`/`pop`), `damping`, `gravity`, `spin`, `startOpacity`
  and `endColor`; rockets trail exhaust, shield breaks shed spinning debris, and
  rail impacts fade superheated white into the beam colour.
- `robotModel`, `weaponModel`, and `vehicleModel` build models from primitives with
  cached `ModelAssets`; `buildWeaponBody` and `legacyWeaponBody` are separate weapon
  body registries. `game/models.mjs` adds material enhancement, thruster exhaust,
  shield meshes, and reusable conduit/armor-plating/muzzle-brake/radiator builders;
  `game/rig.mjs` adds `ProceduralSpring`, `WeaponRig`, and `solveTwoBoneIK`.
- `game/character-anim.mjs` is Three.js-free: `characterPose` produces a bounded
  pose from gait phase, speed, grounded, crouch, ADS, strafe, bank, hit flinch,
  `land` (landing compression) and `reload`; every emitted rig angle is clamped.
  `CharacterRig` damps and applies it, auto-detecting touchdown via
  `lastGrounded`. `advancePhase`/`strideFrequency` drive stride from accumulated
  phase.
- `WeaponRig.recoilImpulse` drives `recoilSpring.z.vel` (a `VectorSpring3D` has no
  top-level `vel`), and the rig adds stride bob, a strafe roll, and procedural
  reload/swap dips (`triggerReload`/`triggerSwap`). The active first-person path
  drives the weapon from `WeaponFeedback` plus the model's own anchors
  (`_animateWeaponParts`); `WeaponRig` is not used by that rendering path.
- `buildNextGen` replaces collision box proxies (`cave`, `tunnel`, `rock`, `tree`,
  `crate`, `column`) with smooth or instanced geometry, gable roofs, windows, arches,
  bridges, tunnel tubes, and cavern domes. Destructible crates/barrels are instanced
  and hidden by zeroing their matrix (`breakPropsAt`, presentation only).

### 12.3 Post-processing and quality

`game/post.mjs` defines `QUALITY_LEVELS = low/medium/high` and the `QUALITY_TABLE`
(particle/decals/deaths/splats/legacy shadow cadence/shadow map size/stars/scatter/
ambient motes/tracers/bloom strength/`triangleBudget` 90000/140000/200000) plus the
controls that change real GPU work at a fixed resolution: `bloomScale`/`bloomMax`
(independent bloom extraction budget), `fxaa`/`vignette` (whole-pass enable),
`shadowHz` (elapsed-time dynamic-shadow budget), and `modelDetail`/`lodDistance`
(geometry LOD). `normalizeQuality` chooses a tier (software defaults low, reduced
motion medium, hardware high). `normalizeQualityOverride` returns a fixed tier or
`null`, so the saved `auto` value is never stored as an override.

`ArenaView` runs a sustained-threshold governor (`nextQualityState`) that requires
the frame time to stay past 45/58 FPS for ~1.5 s before switching and holds a 4 s
cooldown, so quality cannot oscillate; fixed low/medium/high tiers never move. The
`auto` ceiling is low on software, medium under reduced motion, high otherwise.

`postStage` gates the composer on hardware, `postFx` and non-reduced motion only —
independent of both bloom strength and resolution scale. A zero-strength bloom pass
is omitted entirely (not left running). The chain is RenderPass → UnrealBloom (only
when strength > 0) → Vignette (tier-gated) → OutputPass → FXAA (tier-gated).
`applyComposerSize` and `disposeComposer` handle composer sizing and explicit pass
disposal. `bloomResolution` caps the bloom base size and is re-applied after any
composer resize. The CPU path sets a hard triangle budget and screen-area cull;
shadows and post are disabled.

Performance accounting: `renderer.info.autoReset` is disabled and the counters are
reset once at the start of `render()` and read after all passes, so the totals
include the world, post-processing and the first-person weapon pass.
`PerfTracker` (`game/perf.mjs`) accumulates CPU phases (simulation/snapshot/render
submission), keeps a bounded frame-time window with median and p95, and keeps GPU
time as an optional separate number. `BENCHMARK_PRESET` fixes the map, seed, bot
count, weather and camera path, with direct and post-processed variants.

Camera: first-person eye height plus punch recoil, dynamic FOV (sprint +5°, ADS
`max(55, fov*0.82)`), camera-occlusion clearing, `CameraShake` (scaled by the
`cameraShake` display control), low-health overlay, a pooled muzzle light, and a
short killcam (`KILLCAM_DURATION 2.2`). Spectator and free-cam poses are separate.
Dynamic shadow maps refresh on the tier's `shadowHz` budget (20–30 Hz by elapsed
time) rather than a frame cadence.

First-person viewmodel: the ADS pose is solved from each weapon's real rear
aperture and front-tip anchors after scale and attachments (`solveSightPose`),
blending from the hip layout by a frame-rate-independent factor; reduced motion
snaps straight to the solved pose. Assembled viewmodels are cached and reused
across switches. Actor shield
meshes read the energy state — cyan for `temporaryShield`, amber for
`juggernautShield` — and a `shieldBreak` damage event spawns a wireframe shard burst.
Boosting/turbo vehicles emit pooled nitro exhaust behind the chassis (hardware,
non-reduced motion only).

`game/software.mjs` honors `setPixelRatio`, `setSize`, `setTriangleBudget`, and
`setScreenArea`; the README and `docs/VERIFICATION.md` record that it is approximate
and slower and not frame-pacing verified. It also exposes an `info` object shaped
like `WebGLRenderer.info` (`render`/`memory`/`programs`) with a compatible
`reset()`, so the shared host frame accounting does not throw in a software-only
environment.

### 12.4 Sights, reticles and magnification (`game/sights.mjs`, `game/reticle.mjs`)

`game/sights.mjs` builds the open sight geometry (`attachRearNotch`,
`attachRearAperture`, `attachFrontPost`, `attachIronSights`, `attachHoloSight`,
`attachScope`, `attachOptic`). `attachScope` optionally emits a physical mount
(base plate, paired support posts, clamp rings) below/outside the bore, so a raised
optic is attached rather than floating; the aperture and bore stay open.
`solveSightPose` derives the ADS translation/quaternion from the real rear aperture
and front tip at the runtime `VIEWMODEL_SCALE` and a fixed `VIEWMODEL_GUN_DISTANCE`,
and `composeAdsQuaternion` blends a neutral hip orientation with the solved ADS
orientation first, then composes movement-sway/recoil/reload/switch channels exactly
once (so recoil is never doubled through the transition).

`game/reticle.mjs` has no three.js import, so the React HUD can resolve the active
sight too. `resolveActiveSight({weapon, optic, aiming})` combines a weapon's
built-in sight (`BUILTIN_SIGHT`), an equipped optic override and the aiming state;
`adsFieldOfView`/`sightFovFloor` drive the ADS camera FOV (scopes divide the base
FOV by their magnification, irons keep a floored mild pull-in), and `reticleWarp`
gives scopes their lens bow. `app/ui/screens/SightReticle.tsx` owns both the hip
crosshair and the ADS reticle and toggles between them in its own
`requestAnimationFrame` loop, so the aim switch is immediate without re-rendering
the HUD; scope reticles are native-resolution SVG using non-scaling strokes.

### 12.5 Batching, shadows and performance tooling

Third-person operators and pickups build a simplified weapon silhouette
(`simpleWeaponModel`, at most a handful of meshes) that still exposes `userData.type`
and a barrel-tip `userData.muzzle` for remote tracers; the detailed first-person
weapon is reserved for `_acquireWeapon`'s bounded cache. Shadow casting excludes
transparent effects and meshes tagged `userData.lodDetail`.

Static architecture is batched on real WebGL only: `_mergeFloorTiles` merges the
5-unit floor tiles into one material mesh, and `_batchArenaBlocks` groups visible
block meshes by material and coarse spatial cell (24 units) and merges each group,
recording `world.userData.blockBatches`. The CPU renderer and the test mock keep
individual tiles/blocks (`isWebGLRenderer !== true`) so painter depth ordering and
representation tests are unaffected; `arena.blocks` collision data is untouched.
`game/terrain-normals.mjs` supplies crease-aware `smoothNormals` (faces are
averaged only within `angleCos`) and `positionColors` for coherent terrain tint.

`game/perf.mjs` `PerfTracker` accumulates named CPU phases and keeps asynchronous
GPU time distinct; `GpuTimer` fills the GPU number only from a real
`EXT_disjoint_timer_query_webgl2` result and bounds outstanding queries
(`maxPending`), clearing them on a disjoint event. `ArenaView.warmup()` compiles
world and viewmodel variants; `prepareScene()` additionally builds the requested
viewmodel, ensures the post variants, and compiles under a bounded, token-guarded
timeout that reports `ok`/`reason` instead of pretending success. `rendererInfo()`
reports backend/GPU/texture limits, the per-frame `_beginGpu`/`_endGpu` query spans
the world, post and first-person weapon pass, CPU submission is split into
`submitMs` and `weaponSubmitMs`, and `getPerformance()` reports viewport, drawing
buffer, tier, passes, draw calls, triangles and frame-time median/p95.
`app/page.tsx` `tokenArenaBenchmark.run()` applies `BENCHMARK_PRESET` (map, seed,
bots, camera path), runs direct and post-processed variants at `resolutionScale:1`,
warms up, measures a bounded window and restores the previous display and match.

`game/interpolation.mjs` is the pure presentation-interpolation core (shortest-path
yaw, snap-on-discontinuity, `interpolatePose`). The host calls
`ArenaView.capturePresentation(match)` after **every** fixed step (including
catch-up) and `setInterpolation({enabled, alpha})` before rendering; the view then
blends the previous/current tick for the local camera, actor meshes, vehicles and
projectile visuals. `resetPresentation()` clears history on match/map changes,
respawns, teleports, actor replacement, vehicle transitions and replay seeking.
It never mutates simulation state and is not applied to the multiplayer
interpolation path.

---

## 13. Audio and presentation

### 13.1 Synthesized audio (`game/feedback.mjs`)

`SynthAudio` is a layered Web Audio synth created on a user gesture. It owns a voice
cap (30), a filtered-noise ambience bed with mood profiles (`default`, `night`,
`cold`, `hot`, `storm`), a dynamic combat drone, and per-event routines:

- Weapons: per-weapon report tables plus style families
  (`rifle`/`heavy`/`zap`/`burst`/`plasma`/`sharp`/`rapid`), mounted chaingun, muzzle
  launches, explosions, dry fire, reload foley, melee, footsteps, and landings.
- Distance falloff and stereo panning use the local or spectator actor.
- `MODE_THEMES` gives each mode a root and scale; `setModeTheme` retunes the running
  drone in place. `STING_CUES` and `sting(outcome)` play victory/defeat arpeggios.
- `announcerCue(type)` plays optional two-note motifs for capture, goals, streaks,
  sprees, boss phases, and objective events.
- `thunder` plays distance-panned rumbles from the deterministic lightning schedule.
- Combat feedback layers: a critical hit (or `amount >= 48`) gets a brighter two-tone
  ping, `shieldBreak` adds a bandpass crack with a saw decay, a low-health actor
  raises a periodic heartbeat (`heartbeatTimer`), and a boosting vehicle multiplies
  the engine oscillator/sub/lowpass pitch and gain.

`CalloutQueue` (`game/voice.mjs`) is a bounded, deduped, priority-aware bus for
announcer callouts.

### 13.2 Soundtrack (`game/music.mjs`)

`MusicEngine` is a small step sequencer layered over the Web Audio graph. It owns
three sub-buses (`menu`, `explore`, `combat`) plus a shared percussion bus, all
under a music bus fed to `SynthAudio`'s master. `ARRANGEMENTS` and
`CHORD_PROGRESSIONS` are pure data sharing the active `MODE_THEMES` root/scale, so
menu, exploration and combat are recognisably the same piece; each arrangement
carries bass, kick/snare/hat, an arpeggio and (combat) a lead, with four-bar phrase
fills. `tick()` — called once per rendered frame by `ArenaView`/`app/page.tsx`,
including in menus — schedules notes with a bounded look-ahead using
`AudioContext.currentTime`, so timing is frame-rate independent and a suspended tab
resumes without a backlog. `setScene`/`setIntensity` crossfade the buses,
`setDuck` eases the music under stings, `preview` forces a scene for an audition,
and `dispose` stops and disconnects every held note and bus.

`SynthAudio` builds the bus graph in `_ensureBuses` (master → mute gain →
destination, with effects/ambience/music children), exposes `setMuted` (which sets
the mute gain synchronously and pauses scheduling), `setVolume`/`getVolume`,
`setScene`, `setMusicEnabled`, `previewMusic`, `audioStatus`, and `tick`.
`ArenaView.setAudio` connects the engine at startup; combat intensity is fed from
the single event-dispatch stage (`_noteCombatEvent`) before `lastEvent` advances,
and announcer cues are deduped with a short per-cue cooldown. Announcer ownership:
`ArenaView` owns capture/flag/goal cues, `app/page.tsx` owns kill/score/objective
cues.

### 13.3 HUD, radar, scoreboard

- `game/hud.mjs` is a set of pure derivations covering vehicle prompts, reload
  progress, dynamic crosshair gap, low-ammo/posture/hit markers, damage numbers and
  bearings, kill banners/feed/callouts, the match and objective announcer, sudden
  death, ladder/streak/spree status, `audioCaption` (captions), `connectionQuality`,
  spectator boards/target cyclers, mode goal/target/columns/primary text, and
  `objectiveCopy`.
- `hitMarker` has three tiers — `hit`, `critical` (gold, from `hud.critical`), and
  `kill`. Damage numbers carry a `.critical` class; the health card pulses below 30%
  and the armor card dims at zero; `singlePlayerDisplay` surfaces `regen` and `bark`.
- `game/radar.mjs` `radarContacts(hud, player, {range})` projects actors, zones,
  waypoints, markers, the payload, and flags onto a yaw-relative unit circle
  (`+y` ahead, `+x` right); `place(..., always)` clamps off-screen contacts to the
  rim with a bearing. `radarBlip` returns SVG-ready shapes; `RADAR_COLORS` has
  default and colorblind palettes.
- `game/scoreboard.mjs` `scoreboardGroups` and `renderScoreboard` build
  React elements: team grouping/winning-first ordering, `compareActors`, mode
  columns, streak and ping chips, race standings, and soccer standings.

### 13.4 Director and cameras

`game/director.mjs` `CinematicDirector` drives eight rigs (`CAMERA_RIGS`: orbit,
chase, dolly, crane, tripod, follow, firstperson, flyover). It picks targets and rigs
on a `cutEvery` cadence or on highlight events, damps poses between cuts, and reads
interior volumes for flyover (`buildInteriors`, `interiorAt`). `game/camera-modes.mjs`
adds presentation modes (`cinematic`, `overshoulder`, `freelook`, `tactical`) plus
`auto`/`free`, with frame-rate-independent `smoothPose`/`smoothAngle` helpers and
`extraModePose` geometry.

### 13.5 Weather presentation

`ArenaView` owns a deterministic weather state: `_updateWeather` resolves a preset per
time-of-day phase, eases wetness, and applies palette/tint/lighting; `_updateWeatherFx`
spawns precipitation from `precipParticleAdds`; `_updateLightning` fires scheduled
strikes with a flash envelope and thunder; `_applyWetSheen` tints floor materials;
`windGust` scales vegetation sway and particle drift. All are skipped on the CPU
renderer and under reduced motion.

---

## 14. Networking

### 14.1 Protocol (`game/protocol.mjs`)

`PROTOCOL_VERSION 2`. `MESSAGE` is the shared wire-type list
(`join`/`create`/`list`/`history`/`host`/`gear`/`start`/`input`/`chat`/`leave`/`ping`,
server `welcome`/`lobby`/`rooms`/`snapshot`/`events`/`results`/`progression`/`error`,
voice `voice-state`/`voice-signal`/`voice-config`, plus the additive v2
`snapshot-delta`). `parseInputEnvelope` validates and clamps input fields. Snapshot
deltas: `snapshotDelta(base, next)` walks JSON trees and emits changed leaves with
`$a`/`$o` container tags and `$d` deletions; `applySnapshotDelta` rebuilds. `wireSize`
and `BandwidthMeter` account for bytes.

### 14.2 Client (`game/net.mjs`)

`NetClient` connects over WebSocket, persists a session token, room code, player id,
and progress token in local storage, and maintains lobby/rooms/history/progression
state. `join`/`create`/`list`/`history`/`host`/`start`/`input`/`chat`/`voiceState`/
`voiceSignal`/`leave` map to server messages.

Prediction and reconciliation:

- On `start`, `createShadow(mapId, config)` builds a local `Match` (`humanCount: 1`,
  `botCount: 0`), except in vehicle modes (`puma-race`/`puma-soccer`) where race
  inventory/standings stay server-owned.
- `input(input)` assigns a sequence, stores it in `pendingInputs` (capped at 240), and
  sends it. `predict(input)` steps the shadow.
- Each snapshot resyncs the own actor (`resync`) and vehicle positions
  (`resyncVehicles`), restores the shadow clock/`over`, drops acknowledged inputs by
  `acks`, and replays the remainder.
- `renderState(now)` picks two buffered snapshots around a render time and
  interpolates actors/rockets/vehicles (`interpolateSnapshots`), substituting the
  predicted own actor and its vehicle. Yaw uses shortest-arc interpolation.
- Adaptive timing: `renderDelay` eases between `RENDER_DELAY_MIN 90` and
  `RENDER_DELAY_MAX 160` ms from jitter and loss; buffer target eases `4→16`
  snapshots. `_observeArrival` tracks jitter and loss; `_adapt` drives both.
- Delta frames are accepted only when their base sequence is retained
  (`DELTA_HISTORY 64`); misses are counted and the next full snapshot resyncs.

`NetHarness` is an in-process deterministic server+client used by tests: it applies
inputs, steps an authoritative `Match`, encodes snapshots (optionally deltas with
keyframes), models latency/jitter/loss deterministically, and exposes `divergence()`
between the shadow and server actors.

### 14.3 Server (`server/room.mjs`, `server/rooms.mjs`, `server/game-server.mjs`)

`Room` is socket-agnostic:

- Peers join with name/character/harness; `resolveLoadout` enforces the Claude
  restriction. First non-spectator is host. `PLAYER_LIMIT 8`, `SPECTATOR_LIMIT 24`.
- `host` validates and normalizes config; single-player modes are rejected on the
  wire and forced to `deathmatch`. `start` builds a `Match` with one actor slot per
  player plus bots and per-player gear/attachments/finish.
- `input` rate-limits at `INPUT_RATE_LIMIT 120`/s, accepts only modest forward
  sequence progress (`seq > receivedSeq + 600` is rewritten), and converts `jump`,
  `power`, `interact`, `reload`, `melee`, `grenade` to one-shot edges.
- `tick(dt)` accumulates to `RULES.dt`, steps at most 5 sub-steps, delivers event
  deltas by per-peer serial, and broadcasts quantized snapshots at
  `snapshotHz` (default 30). On match end it records history, awards owned
  progression, and broadcasts `results` once.
- Lifecycle: `phase` is `lobby`/`warmup`/`live`/`results`; warmup countdown is
  `WARMUP_SECONDS 5`; `REMATCH_RATIO 0.5` ready quorum skips warmup; rematch needs a
  strict majority; map votes are one live vote per player.
- Reconnection: joins carry a token; a matching token reattaches the peer and seat,
  replays a `start` plus a fresh snapshot mid-match, or `results` if over. A dropped
  peer's seat is held for `graceMs` (default 20000); expiry or explicit leave hands
  the actor to a bot (`· BOT`) and migrates host. Host migration runs
  `nextConnectedHost`.
- Chat: `sanitizeText(text, 200)`, one message per 300 ms per peer, broadcast to the
  room only.
- Voice: `voiceState` enables/disables a session UUID; `voiceSignal` validates room,
  membership, sessions, and SDP/ICE payload shapes, with a per-peer budget (128 signals
  or 256 KB per 10 s).

`RoomRegistry` owns the default `local` room plus on-demand 4-letter-coded rooms
(`CODE_ALPHABET` excludes ambiguous letters), enforces `maxRooms` (64 default), and
drives tick/grace/drain across rooms, retiring empty on-demand rooms.

`Matchmaker` queues by `ratingFor(profile) = xp/100 + wins*8 + kills*0.5`;
`balanceTeams` snake-drafts by rating then minimizes the summed rating gap with a
bounded swap pass. `draft()` pops `teamSize*2` and seats players into a fresh room.

`createGameServer` exposes HTTP status plus a WebSocket server on one port (default
4000). It enforces `CONTROL_RATE_LIMIT 60`/`CONTROL_RATE_WINDOW 1000 ms` for
non-input control messages, `MAX_CLIENTS 256`, a 64 KB max payload, heartbeat pings
every 15 s, and replaceable-vs-essential outbound queuing (`REPLACEABLE` snapshots/
events/voice are dropped under backpressure; essential protocol transitions are
queued and coalesced by type). `voiceConfig` adds TURN credentials from
`TURN_URLS`/`TURN_SECRET` when present.

### 14.4 Anti-cheat bounds

Bounds are enforced in several places, not one system: input rate and sequence
clamping in `Room.input`; control-message rate limiting and protocol-error
disconnect in `game-server`; progression clamps in `server/progression.mjs`
`sanityCheckResult`/`withinSanity`; chat sanitization and rate limits; voice signal
budget and SDP/ICE validation; and loadout/weapon legality in `Match` (`loadoutAllows`
fallbacks prevent a stale switch from bypassing a restricted mode).

---

## 15. Replay and theater

`game/demo.mjs`:

- `DemoRecorder` samples `recordHz` (default 18 Hz), rounds movement fields
  (`ROUNDED_KEYS`), drops the `bot` block, dedupes events by id, and caps recording
  at `maxSeconds` (default 600). `finish(meta)` returns a versioned document with
  `header`, `meta`, `keyframes`, and `events`.
- `DemoPlayer.sample(time)` interpolates actors, vehicles, and rockets between
  keyframes (shortest-arc for yaw) and clamps to duration. `eventsBetween`,
  `nextEventTime`, and `replaySummary` derive kill feed, objective timeline, and
  highlights.
- `DemoPlayback` is a deterministic cursor with seek/speed/step/advance, independent
  of the wall clock. Speeds are `.25/.5/1/2/4` (`REPLAY_SPEEDS`).
- `serializeDemo`/`parseDemo` validate `DEMO_VERSION 1`;
  `compressDemo`/`decompressDemo` use `CompressionStream('gzip')` when available;
  `trimDemo` cuts to a time bound.

`game/demo-store.mjs` persists demos in IndexedDB (`meta` + gzip `data` stores),
derives summaries (`demoSummary`, `demoHighlights`, `demoOutcome`), supports
filter/sort, and exports/imports replays as JSON files
(`exportDemo`, `importDemo`, `importDemoToStore`). Storage is injectable via
`setDemoStorage` for tests.

---

## 16. Accessibility and input

- **Keybinds (`game/keybinds.mjs`)**: 13 remappable actions with `DEFAULT_BINDINGS`;
  shell-owned keys are reserved (`RESERVED_CODES`: Tab, Escape, Enter, T, C, bracket,
  digits). `normalizeBindings` guarantees unique valid codes; `rebindAction` swaps an
  occupied key; `bindingConflicts` reports duplicates. Persisted under
  `token-arena-keybinds`.
- **Touch (`game/touch.mjs`)**: `TOUCH_DEADZONE .14`, `TOUCH_SPRINT .9`,
  `TOUCH_LOOK_SCALE .004`. `stickAxis` clamps the stick radius (28–96) so a collapsed
  base cannot phantom-tilt; `moveAxis` applies the deadzone and sprint threshold;
  `lookStep`/`applyLook` map drag to yaw/pitch with invert. `TOUCH_BUTTONS` lists the
  on-screen cluster; `applyTouchAction` tracks held actions and latches one-shots.
  `isTouchDevice` uses coarse pointer or touch points.
- **Palettes (`game/presets.mjs`)**: `ACCESSIBILITY_PALETTES` includes default,
  deuteranopia, protanopia, and tritanopia using the Okabe-Ito-safe hues; `teamColorsFor`,
  `radarPaletteFor`, and `enginePaletteFor` feed the 2D UI and the 3D engine hint.
  `HIGH_CONTRAST_CLASS 'ui-contrast'`.
- **Captions**: `display.captions` gates `audioCaption(event)` in the page loop.
- **Reduced motion**: `post.reducedMotion` combines the app preference and the OS
  `prefers-reduced-motion` query; it disables weapon motion, shadows/post, weather
  particles/sway, camera shake, and menu motion.
- **Remote play/voice**: `VoiceChat` (`game/voice.mjs`) does WebRTC peer connections
  with PTT and voice-activity modes, a 200 ms VAD release, spatial gain from actor
  distance, and strict session validation. `CalloutQueue` handles announcer callouts.

Input assembly is in `game/input.mjs`: `controlsFromState` builds a control object
from key codes, touch state, and one-shot flags; `posture` reads sprint/crouch;
`cycleWeapon`, `hasAmmo`, `isEditable`, and `blocksGameplay` cover swaps, editable
focus, and menu/chat gating.

---

## 17. Testing map

Counts at time of writing: 115 `game/*.test.mjs`, 15 `server/*.test.mjs`, 3
`tests/*.test.mjs`. `npm run test:game` runs `node --test game/*.test.mjs`;
`npm run test:server` runs `node --test server/*.test.mjs`; `npm run test` also runs
`tsc --noEmit`, the production build, and `tests/*.test.mjs`. Slow integration sweeps
live in `game/archive/` (`npm run test:archive`).

| System | Test file(s) | What is asserted (examples) |
|---|---|---|
| Core state, damage, scoring | `game/core.test.mjs`, `game/core-fixes.test.mjs`, `game/core-alloc.test.mjs`, `game/core-perf.test.mjs` | Roster/harness compatibility; armor/Guardrail/protection and one-time kill scoring; suicide deduction; ties; ray occlusion and muzzle checks; rocket swept splash; power expiry; allocation/perf guards |
| Determinism / fixed step | `game/gameplay.test.mjs`, `game/core.test.mjs`, `game/weapon-simulation.test.mjs` | Full seeded bot matches; projectile travel independent of step frequency; swept walls cannot tunnel |
| Movement / traversal | `game/arena-movement.test.mjs`, `game/traversal.test.mjs`, `game/ray-safety.test.mjs` | Ramp/deck seam traversal, bounds, void recovery, traversal devices and ray safety |
| Combat weapons | `game/weapon-falloff.test.mjs`, `game/weapon-simulation.test.mjs`, `game/melee.test.mjs`, `game/grenade.test.mjs`, `game/legacy-weapons.test.mjs`, `game/rail-effect.test.mjs`, `game/weapon-presentation.test.mjs` | Falloff linearity and full damage in range; swept projectile clearance; team splash never friendly-fires; melee arc/cooldown/teammate rules; grenade arc and cooldown; rail visuals |
| Attachments / gear | `game/attachments.test.mjs`, `game/attachment-behavior.test.mjs`, `game/economy.test.mjs` | Unique ids/slots/levels; modifier aggregation, clamping, order independence; behavior fields; weapon-upgrade/sentry economy |
| Powerups / killstreaks / mutators | `game/powerups.test.mjs`, `game/killstreak.test.mjs`, `game/mutators.test.mjs` | Apply/refresh/expire/reset; overshield absorption order; 3/5/7 streak rewards; one-shot/random/bounty/berserk |
| Operators / harnesses | `game/content.test.mjs`, `game/harness-profiles.test.mjs`, `game/operator-profiles.test.mjs`, `game/multihuman.test.mjs` | 63 loadout pairs validate; profile bounds; per-actor multi-human inputs and determinism |
| Vehicles | `game/vehicles.test.mjs`, `game/vehicle-gameplay.test.mjs`, `game/vehicle-seats.test.mjs`, `game/vehicle-flight.test.mjs`, `game/vehicle-presentation.test.mjs` | Handling on flat/slope, handbrake slip, suspension, turret traverse; seats/boarding; Hornet flight |
| Modes / objectives | `game/modes.test.mjs`, `game/mode-data.test.mjs`, `game/extra-modes.test.mjs`, `game/assault.test.mjs`, `game/assault-match.test.mjs`, `game/payload.test.mjs`, `game/payload-layout.test.mjs`, `game/objective-occlusion.test.mjs` | CTF lifecycle; KOTH placement/rotation; assault sector count/breach; payload path/pace/rollback; objective occlusion |
| Race | `game/race.test.mjs`, `game/race-match.test.mjs`, `game/race-maps.test.mjs`, `game/race-camera.test.mjs`, `game/race-ui.test.mjs`, `game/race-presentation.test.mjs`, `server/race.test.mjs` | Ordered directional gates, handbrake/slow/items, seeded items, car collisions; race camera/UI |
| Soccer | `game/soccer.test.mjs`, `server/race.test.mjs` | Two-per-team seating, goal crossing, goal/time wins, deterministic stepping, anti-pin, bot controllers |
| Bots / AI | `game/bot-behavior.test.mjs`, `game/bot-archetypes.test.mjs`, `game/bot-coordination.test.mjs`, `game/bot-facing.test.mjs`, `game/bot-suppression.test.mjs`, `game/bots-flanker.test.mjs` | Behavior blends, archetypes, coordination, facing, suppression, flanking |
| Single-player | `game/singleplayer.test.mjs`, `game/sp-improvements.test.mjs`, `game/enemy-types.test.mjs`, `game/campaign-data.test.mjs`, `game/campaign-progress.test.mjs`, `game/singleplayer-ui.test.mjs` | Horde waves/lives/respawn; campaign steps and scripted events to a win; enemy classes; unlocks/checkpoints/stars |
| Progression / meta | `game/progression.test.mjs`, `game/challenges.test.mjs`, `game/history.test.mjs`, `game/presets.test.mjs`, `game/cosmetics.test.mjs`, `server/progression.test.mjs`, `server/history.test.mjs`, `server/matchmaking.test.mjs` | XP curve and boundaries; award once; challenge rotation/payout; history persistence; presets; server sanity clamps and leaderboard; team balancing |
| Maps / levelgen / schema | `game/maps.test.mjs`, `game/arenas.test.mjs`, `game/map-schema.test.mjs`, `game/map-layout.test.mjs`, `game/classic-layout.test.mjs`, `game/levelgen` (via content/map tests), `game/blood-gulch.test.mjs`, `game/ctf-maps.test.mjs`, `game/island-maps.test.mjs`, `game/expansion-maps.test.mjs`, `game/battle-maps.test.mjs`, `game/nextgen-maps.test.mjs`, `game/arsenal-maps.test.mjs` | Registry integrity, mode support, schema validation, layout connectivity, per-pack authored contracts |
| Terrain / environment | `game/terrain.test.mjs`, `game/environment.test.mjs`, `game/weather.test.mjs`, `game/sky.test.mjs`, `game/interiors.test.mjs`, `game/structures.test.mjs` | Support/ray/bounds determinism; sky/mountain/scatter finiteness and budgets; weather presets and lightning; interiors and destructibles |
| Rendering | `game/view.test.mjs`, `game/software.test.mjs`, `game/post.test.mjs`, `game/textures.test.mjs`, `game/character-anim.test.mjs`, `game/models` (via view), `game/presentation.test.mjs`, `game/showcase.test.mjs`, `game/spectate-build.test.mjs` | DPR/size/camera aspects; CPU fallback sizing; disposal dedupe; quality/post policy; texture determinism; rig/pose bounds |
| Audio / HUD / radar | `game/feedback.test.mjs`, `game/hud.test.mjs`, `game/radar.test.mjs`, `game/scoreboard.test.mjs`, `game/team-presentation.test.mjs`, `game/camera-modes.test.mjs`, `game/director.test.mjs` | Kick recovery and pooled effects; audio routing identity/falloff; HUD prompts/reload/captions; radar projection/palettes; scoreboard grouping; camera smoothing and director rigs |
| Networking (engine) | `game/net.test.mjs`, `game/protocol.test.mjs`, `game/quantize.test.mjs`, `game/net-voice.test.mjs` | Shadow prediction step-for-step, resync convergence, ack/replay, out-of-order snapshots, token persistence; delta encode/apply; quantization; voice signaling |
| Networking (server) | `server/room.test.mjs`, `server/rooms.test.mjs`, `server/network.test.mjs`, `server/resilience.test.mjs`, `server/security.test.mjs`, `server/spectator.test.mjs`, `server/transport.test.mjs`, `server/chat.test.mjs`, `server/voice.test.mjs`, `server/vehicle.test.mjs`, `server/extra-modes.test.mjs` | Join/host/start/input; registry create/join/list/expire; real two-socket matches; reconnection/host migration; rate/payload/security bounds; spectators; chat; voice |
| Replay / theater | `game/demo.test.mjs`, `game/demo-store.test.mjs`, `game/replay.test.mjs` | Decimation, cloning, interpolation, seek/speed, gzip round-trip, IndexedDB summaries, export/import |
| Accessibility / input | `game/keybinds.test.mjs`, `game/touch.test.mjs`, `game/touch-ui.test.mjs`, `game/onboarding.test.mjs`, `game/presets.test.mjs` | Binding normalization/swaps/conflicts; joystick deadzone/sprint/knob clamp; touch UI actions; first-run coach; accessibility palettes |
| UI / shell | `tests/rendered-html.test.mjs`, `tests/ui-contract.test.mjs`, `tests/deployment-assets.test.mjs` | Server-rendered HTML and UI contract; deployment asset presence |

---

## Uncertainties

The following were not fully verifiable from the code inspected and are flagged rather
than guessed:

- `COMBAT_CONSTANTS.HEADSHOT_MULTIPLIER` (`1.5`) in `game/constants.mjs` is not read
  by the core damage path I traced (`Match.damage`, `Match.fire`); no infantry hitbox
  differentiates head from body, and no `headshot` flag reaches `deathPlan` from the
  simulation. Treatment here is "defined but effectively unused." Confirm if a
  separate hit-zone system was intended.
- `app/page.tsx` and the `app/ui/**` screens were only spot-checked (the mode union
  and loop). Descriptions of menu flow, modals, and the settings dialog are derived
  from `README.md` and the `Mode` type, not a full read of every component.
- Exact per-mode HUD rendering and the settings-dialog bindings beyond
  `game/keybinds.mjs` were not exhaustively traced.
- `docs/VERIFICATION.md` records hardware/GPU frame-pacing, real pointer-lock, and
  manual browser playtesting gaps; those remain unverified by this document.
- Some authored map packs (`game/*-maps.mjs`) were read only through their
  registries and tests, not every literal coordinate.
