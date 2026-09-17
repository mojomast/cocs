# Phase 1 weapons handoff

## Scope and ownership

Bounded weapons batch only. This worker did not write `view.mjs`, `feedback.mjs`, `rig.mjs`, `models.mjs`, any HUD/audio/material-system files, existing tests, or another worker's files. No commits, deployments, delegation, full suites, npm test, or production replacement.

IMPORTANT concurrent-integration status: `docs/phase1-weapons-integration.patch` was generated as an exact unified patch and was NOT applied by this worker. Its initial `git apply --check` succeeded. While verification was running, the shared live view gained the AdsController and simple-body integration from concurrent work. The historical patch now fails forward/reverse checks where shared context changed; DO NOT reapply it blindly. It is retained as the precise proposed changes against its generation-time snapshot, not regenerated to reverse anyone's work. The new focused runtime test accepts pending integration (reconstruct/parse in memory only) OR verifies the already-integrated live source. No protected file is written by that test.

The original SMG sight test initially failed because it required the previous high sight position. A concurrent owner changed that existing test to measure actual receiver clearance; this worker did not edit it. The final focused sight run is green.

## Files changed by this worker

- `game/weapon-models/chassis.mjs` (new): bounded shared chassis construction and five-mesh simple bodies.
- `game/weapon-models/index.mjs`: correct nested assembly contract comment.
- Ten builder entry modules now dispatch their own type into the chassis builder: `pulse-rifle.mjs`, `rocket-launcher.mjs`, `rail-lance.mjs`, `scattergun.mjs`, `plasma-driver.mjs`, `grenade-launcher.mjs`, `shock-beam.mjs`, `flak-cannon.mjs`, `marksman-rifle.mjs`, `submachine-gun.mjs`.
- `game/sights.mjs`: short physical iron-sight feet, scope-foot tags, front tip fully below its reported aiming point, mounted attachment optics, hide replaced iron assemblies instead of stacking obstructing sights; preserve integrated precision scopes.
- `game/weapon-ads.mjs` (new): AdsController and ten frozen enter/exit profiles.
- New focused tests: `game/phase1-weapons-geometry.test.mjs`, `game/phase1-weapons-ads.test.mjs`, `game/phase1-weapons-runtime.test.mjs`.
- `docs/phase1-weapons-integration.patch` and this handoff.

`game/attachments.mjs` and `game/weapon-models/legacy.mjs` were left unchanged. Other files shown by git status are concurrent work, not part of this worker's ownership.

## Weapon changes and bounds

All ten bodies have connected receiver/lower receiver, grip/trigger guard, shoulder support, barrel, feed or power system, carrier race/charging handle, and mounted open sights. Receivers were lowered rather than raising sights to evade clipping. The flash/muzzle anchors remain owned by the view and agree with the existing muzzle table; the rocket no longer projects an ornamental warhead far ahead of that table.

Distinct silhouettes:
- Pulse: carbine receiver, box feed, conventional stock.
- Rocket: broad launch bore, rear venturi, shoulder rest and breech latch.
- Rail: long paired accelerator rails, centered replaceable cell, integrated open scope.
- Scatter: twin separated barrels, breech/extractor block, actual breech pivot.
- Plasma: vented chamber rings and replaceable power pack.
- Grenade: indexed cylindrical drum and wide long bore.
- Shock: forked emitter rails and capacitor pack.
- Flak: heavy wide breech/barrel and offset ammunition box.
- Marksman: slim receiver, precision barrel/cheek rest, integrated open scope.
- SMG: short receiver, telescoping stock and longer narrow magazine.

Default body-only metrics from actual `weaponModel()` assembly, excluding the shared muzzle-flash tail:

| Type | Body meshes | Triangles |
|---|---:|---:|
| Pulse | 27 | 708 |
| Rocket | 25 | 1068 |
| Rail | 38 | 2388 |
| Scatter | 26 | 1080 |
| Plasma | 31 | 1872 |
| Grenade | 28 | 756 |
| Shock | 32 | 768 |
| Flak | 27 | 708 |
| Marksman | 33 | 2328 |
| SMG | 28 | 720 |

Simple variants are five meshes each and retain ten distinct envelopes. With the existing simple flash, the view uses six meshes. The patch routes pickups and actors to this path without constructing/discarding detailed bodies. Full body builds use ctx-owned caches, including one shared open-tube geometry. Actual renderer cache after all ten defaults: 132 geometry entries, 12 materials; rebuilding all ten adds no cache entries. These are geometry/resource counts, NOT GPU time, FPS, or a benchmark against the old models. The view's existing transient flash resources are outside these body-only counts.

## Runtime contracts

### Models / mechanisms

- Existing `buildWeaponBody(type,g,ctx)` and individual exports remain compatible.
- `buildSimpleWeaponBody(type,g,ctx)` exports from chassis.mjs; writes `userData.muzzlePoint` for the shared simple tail to anchor, not a new muzzle object.
- Detailed `userData.parts` supplies actual `magazine`, `bolt`, `barrel`, and energy `cell` groups. Rail-cell rotation and scatter break-action rotation have local physical pivots, not world-origin orbits.
- The integration patch enables feed withdrawal for non-scatter weapons with a smaller breech-latch travel for rockets, and changes bolt kick toward +Z. Existing animator retains authoritative reload timing. No animation timer or resource allocation is introduced inside builders.
- `userData.sights` still contains real rear/front local points. `userData.sightAssembly` allows replacement optics to hide only the original sights. `userData.chassis` exposes receiver/top/muzzle information for bounded mounts and tests.
- No builder disables depth tests. The patch removes the pre-existing software-viewmodel depth-test override as well. Software overlap behavior still needs visual review.

### ADS helper

- Construct one `AdsController` per view, not per frame.
- Call `update(deltaSeconds, {weapon, aiming, visible, reloading, swapping, sprinting, reduced, baseFov, sight, aim})` ONCE per rendered frame, after selecting the current displayed weapon. `aim` is that model's solved sight pose; `sight` comes from the existing resolver.
- The same exact exponential blend updates neutral translation, quaternion, FOV, and reticle progress. Fixed target + elapsed time is frame-partition independent. All ten profiles have distinct enter/exit rates, with heavy launchers slower than the SMG.
- Reversal continues from current pose. Reload, active swap, sprint, hidden weapon, or a changed weapon index target hip rather than snapping/reusing a stale aim pose. Continue passing `swapping:true` for the whole swap animation; a changed index alone is only an immediate interruption signal, not a substitute for the lifecycle flag.
- `compose(position,quaternion,feedbackPose,feedbackChannels)` adds current translation/recoil channels once AFTER neutral interpolation. Its output is never fed back into the ADS state. Do not also apply pose pitch/roll to the neutral quaternion, or separately re-add recoil.
- Camera yaw/pitch remains in the existing immediate mouse-look path; the helper neither accepts nor filters authoritative look angles.
- `state.reticle` exposes `adsOpacity`, `hipOpacity`, `ready`, `kind`. The patch publishes opacity/readiness on `_activeSight`; existing HUD consumers may choose how to use them. This worker did not implement or validate HUD changes.
- `reset(baseFov)` clears zoom/pose at match reset. Reduced motion snaps to the current valid target, including hip during reload/swap.
- Returned state and scratch objects are borrowed/mutable. Copy values before retaining a historical sample. No geometry/material allocations occur per update.
- Director/free camera/killcam keep camera-FOV ownership in the patch; player FOV is updated alongside the weapon pose before rendering.

## Focused verification evidence

Only explicitly named weapon/sight files were run.

1. `node --test game/phase1-weapons-ads.test.mjs game/phase1-weapons-geometry.test.mjs game/phase1-weapons-runtime.test.mjs`
   - Final result: 10 passed, 0 failed.
   - Tests cover all ten geometry envelopes, actual moving meshes/pivots, repeated cache reuse, physical short mounts, open target rays, real sight projection, five-mesh simple bodies, optic replacement, frame partition invariance, repeated rapid reversals, reload/swap/hidden/sprint interruption, recoil once, invalid delta, long elapsed time, reduced motion, reset, and real renderer assembly.
   - The runtime test confirmed lead integration already present, syntax-checked the live view and checked the immediate camera-look/single-composition contract without modifying it.
2. `node --test game/sights.test.mjs`
   - Final live-tree result: 12 passed, 0 failed.
   - Includes screen-space ray bundles across FOV/aspect variants, attachment bores, camera outside receiver/stock, and all-weapon ADS clearance.
   - Earlier run: 11 passed, 1 old SMG height assertion failed; resolved by the concurrent owner's existing-test change, not hidden or edited by this worker.
3. `git diff --check -- game/weapon-models game/sights.mjs` passed.
4. Initial forward patch check passed; subsequent check correctly rejected changed/already-integrated live context. Do not describe the historical patch as currently forward-applicable.

## Limits and manual review still required

- Automated geometry and source-contract checks are not an artistic approval or a playable browser test. No captured visual review or hardware performance claim from this worker.
- Lead should review all ten hip/ADS silhouettes in the isolated preview, normal depth and software rendering, at supported FOV/aspect ratios and 100% render scale. Verify rear-stock/near-plane clearance under movement, recoil and reload, not just rest rays.
- Review front-post thickness, open-scope eye relief/field visibility, optic-foot seating, grip/hand contact, reduced-motion swaps, sprint interruption, rapid weapon/optic changes, and ADS during reload completion. Check recoil is not duplicated by any downstream integration.
- Existing magazine/barrel/underbarrel attachment visuals in the view are not comprehensively redesigned here; combinations can still stack over default feed geometry and need loadout-level review. No phase-2 material, audio or HUD work was taken on.
- The five-mesh distant variants intentionally omit twin rail detail, separate scatter bores, sights and moving mechanisms. They prioritize readable envelope/cost, not close-up fidelity.
- Animation is representational rather than a physical firearm simulation. The existing renderer owns lifecycle and authoritative timing.
- Concurrent changes can invalidate patch contexts and source-contract tests. Preserve the live owners' changes; do not revert to this worker's generation snapshot.

No full-suite gate or phase-1 approval is claimed.
