# Opt-in bounded Horde stages (contract 1)

Trusted map authors may pass `hordeArena` to `Match`. This constructor-only
option is not part of `normalizeConfig` or the network protocol. It requires
bounded Horde, target 1–30, and a finite `arena.hordeStagePlan`. No-plan matches
take their original branch and consume no additional RNG.

`game/horde-stages.mjs` validates stage IDs, supported spawn pools, supported
arrival rectangles, exactly two solid gates, and ordered clear-wave transitions.
The base arena omits gate blocks; construction clones it and adds both closed
gates before navigation/spawning. Stage pools contain 2–4 human and 4–32 enemy
anchors. A transition opens one or both gates and may later close other gates.
There are no arbitrary actions, teleports, wave compositions, damage, or timers
in map data. Source composition, champions 9/18/27, three lives, upgrades,
resupply, scoring and terminal rules remain the single implementation.

Source clear → resupply → terminal check → upgrade → intermission → transit
begin. Begin records the source clear event ID. At 180 simulation ticks the
route opens. At or after 240 ticks, 30 continuous living, grounded, supported
arrival ticks plus expired ordinary intermission and reachable destination
pools commit the stage. Wave start is on a later tick. Arrival dwell may begin
before the gate opens, but cannot waive warning or normal intermission.
Ticks accumulate `dt * 60`; the normal simulation is 1/60 second per step.

Closure warns for 180 ticks after entry, defers for living bodies, projectiles
or deployables, and cancels at 600 ticks. Safety padding is conservatively at
least 1.45m horizontally and 3m body height (larger actor fields respected).
The transit repeats guidance at 1200 ticks and opens both gates at 2400;
fallback never waives arrival. Authored emergency paths must remain connected
in all four masks; map compilation/tests are responsible for that invariant.

Gate transactions use a fresh arena identity and collision-keyed navigation,
then clear every bot route before the next simulation step. All block/ray/floor
queries consume that same arena. A completed Match is never transplanted by an
adapter. `singleplayer.stage` snapshots contain the complete gate mask, geometry
revision, committed stage, transit causality/dwell and pending closure; callers
receive a copy. Round identity belongs to the enclosing session snapshot.
Restart constructs a fresh Match; the immutable base cannot retain gate state.

Focused checks: `node --test --test-concurrency=1 game/horde-stages.test.mjs`
and `game/singleplayer.test.mjs`. Stage tests are controlled fixtures, not
natural-combat acceptance. Before upstream commit, an external comparison of
600 ordinary `Match.step(1/60,{})` ticks against source pin
`515daf07589150dd3241f4ae1425cc1b093912f5`, seed 731, found identical vanilla
Horde snapshots, event stream and RNG state/call count.
