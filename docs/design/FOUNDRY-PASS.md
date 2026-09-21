# FOUNDRY — menu, operators and objective machinery

## Navigation

`SelectionScreen` owns a scoped responsive layout. Play is the calm default;
Loadout contains operator/harness choices, presets and kit detail; Library holds
recordings, reference and progression access. Featured LATTICE opens a briefing
before applying rules. Every quick start forwards the exact displayed config
and map to the parent launch function. Career expansion is deferred.

## Procedural operators

`operator-anatomy.mjs` builds nine authored identities from shared geometry.
Fixed hardware is merged per joint/material; close focal shapes use richer
geometry, and native LOD wrappers select reduced far geometry. Animation joints,
grips, ragdoll hierarchy and the standing hitbox envelope remain compatible.

CPU geometry accounting (including pulse weapon, excluding shadow passes):

| Path | Draw objects | Triangles per operator |
| --- | ---: | ---: |
| Near | 62–64 | 10,388–12,696 |
| Far | 47–51 | 4,900–5,472 |
| Software | 63–65 | 5,452–6,200 |

Shared operator geometry: 2,720,400 bytes. These are geometry/work counts, not
hardware FPS claims. `scripts/measure-operator-models.mjs` reproduces the budgets.

## Objective contract

All timings and rewards reuse published simulation values. ORACLE installation
provides local, uncloaked-enemy intel without SCOUT's damage bonus. Each authored
DEPLOY source provides one shard per team for the operation; losing and
reinstalling ORACLE cannot create another. Bots install and leave shards to
humans. Cargo is bounded to one per actor, returned on death, and banked at an
owned HQ. Withdrawal consumes the shard and FLUX together.

`terminalActionGate` is read-only and shared by server preflight. Simulation
channels revalidate range, ownership, elevation and contest. Additive protocol-3
fields expose actions, blocked reasons, effect timers, cargo/bank state and
ORACLE targets to the HUD and world machines. PRIME remains a node interaction,
with authored reach and progress exported in co-op snapshots.

World asset modules separate snapshot interpretation, geometry and view-owned
lifecycle. Machine status is shape-and-word readable as well as team-colored;
the geometry does not alter collision or navigation.

## Rendering budget

The authored full-budget Graphics Lab recipe remains intact. The renderer skips
empty bot source/encode/composite work, updates scene transforms once for styled
passes, and reconfigures targets only when settings/viewport change. Hidden
previews skip their render. Lab recovery backs off after failed probes; capped
frames include skipped-frame elapsed time in the budget estimate.

## Verification and release

Heavy tests, typecheck, builds and browser runs are serialized. Release gates and
production evidence are recorded in `docs/VERIFICATION.md`. Deploy from the
service checkout `/home/mojo/projects/tokenarena` with `--with-game-server`.
Served assets must match the freshly built bytes as well as service identity.
