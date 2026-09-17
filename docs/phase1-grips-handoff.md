# Phase 1 living grips / foot support handoff

## Ownership and integration

This follow-up changed ONLY `game/character-anim.mjs`, `game/rig.mjs`, `game/models.mjs`, new `game/phase1-grips.test.mjs`, this handoff, and `docs/phase1-grips-integration.patch`. Existing edits in those files were preserved. Previous character handoff, weapon chassis, and view were read-only. No weapon/map/campaign/test-owner files were edited; no commits, deployment, delegation, full suite, or phase-2 material/audio/HUD work.

The view patch was generated but NEVER applied by this worker. Its original version passed `git apply --check`. During verification the lead-owned view acquired exactly those hooks (the original patch passed `git apply --reverse --check`). Do NOT apply the complete patch again to an integrated view.

IMPORTANT compatibility detail: the older `phase1-character-integration.test.mjs` detects integration by an exact import string. The combined import initially proposed in this patch caused its two tests to fall back to their obsolete patch. The final handoff patch instead preserves the old import and adds a separate import:

```js
import {CharacterLifecycle} from './rig.mjs';
import {alignLivingCharacter} from './rig.mjs';
```

The lead's current view still has the combined import. During the final rerun the lead-owned older integration test was updated to recognize combined imports (verified read-only); no import-only fix is now required on that tree. The split-import form in the supplied patch remains backward compatible with the older detector. This worker did not edit the view or that older test. Do not reapply the full integration patch: the hooks are already integrated.

## Implemented contract

`alignLivingCharacter(model, {grounded = true, sampleGround})` in `rig.mjs` is an explicit final post-pose pass. It returns `{hands, feet}` with world targets and residual distances for diagnostics. It never writes actor/model root transforms, weapon transforms, or weapon anchors. Call once after base rig pose, aim rotation, weapon replacement, interpolation, character scale/style, and hit push offsets.

The supplied view patch calls `_alignLivingCharacters(match)` immediately after `_updateHitReactions()`, before rendering. It skips hidden, dead, mounted, and lifecycle-non-alive actors. No menu/showcase pass is added. Its ground adapter is:

```js
const sampleGround = (x, z, referenceY) =>
  typeof this.characterGroundAt === 'function'
    ? this.characterGroundAt(x, z, referenceY, match)
    : presentationSupportAt(x, z, arena, referenceY);
```

This matches the shared support selector already present in the read-only view. A custom callback's null remains void. The solver itself has no terrain/module dependency and needs no raycasts.

### Hands

- Closed-form two-bone solve for both arms, including wrist orientation and actual `grip-L` / `grip-R` socket offset; no bone stretching or iterative solver.
- Distinct authored `leftGrip`/`rightGrip` weapon anchors are used directly. Current detailed weapons have coincident generic defaults; chassis-specific receiver/grip offsets are evaluated through those anchor frames without modifying them. Simple third-person weapons have no grip nodes, so the same contacts use the weapon transform under the existing character gun mount.
- Weapon-specific contact dimensions come from the existing read-only `chassisFor(type)` table. Offhand support is at the receiver side, not the far handguard, because the short operator arms cannot reach the far fore-end.
- Character refinement sets its carry mount to `(0.04, 0.06, -0.08)` and includes that node in bind capture. View still owns mount aim rotation. No new geometry/materials were added by this follow-up.
- All ten neutral third-person weapons align both grip sockets within 1e-5 world units in the focused test, including translated/yawed/uniformly scaled actors.
- Each base pose clears wrist IK rotations. Weapon switches use the currently attached model, not cached stale targets.

### Feet

- Exactly two support queries per eligible full two-foot grounded model: one at each current ankle's world X/Z, with the final presentation origin's world Y as `referenceY`.
- Accepted finite support must be within 0.12 character-scale units vertically of the model origin. Null, undefined, NaN, infinity, or distant floor levels leave the base gait unchanged. Airborne actors make zero queries.
- Fixed-length analytical leg solve targets floor + measured 0.0935 sole height + existing gait swing clearance. Feet remain level; no expensive slope-normal sampling.
- The base pose records contact lift, so repeated contact evaluation does not accumulate artificial lift. Reduced-motion contact gait supplies zero swing lift; this pass adds no time/oscillation/spring state.
- Weaponless refined models can still solve feet.

### Lifecycle

- `corpse` or non-alive rig lifecycle rejects all solver writes and queries.
- The view additionally skips the lifecycle's one-frame respawning state.
- Existing reset restores all solved joints, hand rotations, carry mount, and animation accumulators; it now also clears the last pose used for swing clearance.
- Existing death support and transform ownership remain unchanged.

## Focused evidence

Red/green checks reproduced missing alignment, missing per-foot sampling, and stale wrist rotations before implementation. Tests use actual Three.js robot and weapon construction.

Command (five explicit files, no full suite):

```sh
node --test game/phase1-grips.test.mjs game/phase1-characters.test.mjs game/phase1-character-integration.test.mjs game/character-anim.test.mjs game/deaths.test.mjs
```

Before adding the final view-integration check, this run passed 50/50. A subsequent expanded run caught two failures in the older integration harness's exact-import detection after concurrent lead integration. The lead then updated that unowned test's detector; final rerun on the live tree: **51 tests, 51 passed, 0 failed, exit code 0; 515.747204 ms**. This includes the new 9-test grip file, an in-memory syntax check/import and actual invocation of the integrated view method with callback, visibility/mount/death/respawning gates, plus unchanged on-disk view bytes during that test. Duration is test execution evidence, not a rendering benchmark.

Existing focused animation/death/lifecycle/geometry assertions passed. `git diff --check` for the three owned production files passed. Original patch forward check passed before lead integration, and original patch reverse check passed after lead integration. The final split-import patch records the compatible full integration against the pre-integration view; it is not a request to reapply already-integrated hooks. Its final contents also passed an in-memory reverse/forward roundtrip against the live integration normalized to split imports, and the reconstructed module passed `node --input-type=module --check` (exit 0). No view write occurred.

## Remaining limits — NOT visual sign-off

- No browser screenshots, all-map/character coverage, GPU/CPU frame-time benchmarks, or hardware performance claims.
- Extreme weapon pitch/yaw or arbitrary authored anchors may be unreachable. The solver clamps reach and reports nonzero residual rather than stretching arms or moving the gun/root. There is no chest/shoulder compensation, hand/body collision avoidance, finger articulation, or shoulder-stock contact guarantee.
- Grip pass keeps both hands attached during reload/airborne poses; it does not implement a magazine-hand release/reload choreography. Wrist orientation is shared with the weapon frame, not weapon-specific palm roll art direction.
- Foot support is per-frame height placement, not persistent world-space stance locking. Sliding, stair-edge discontinuities and popping are still possible; no foot normals, slope roll, pelvis compensation, toe/heel probes, strafe footstep planner, or horizontal moving-platform inheritance.
- Deep drops, large steps, steep slopes and unreachable ankle targets remain reach-clamped. A single ankle sample cannot guarantee full sole mesh clearance on uneven terrain. The support callback is responsible for selecting the correct stacked platform; its selection accuracy was not re-audited here.
- Uniform actor scaling is supported. Non-uniform ancestor scaling is outside the IK contract.
- Allocations and matrix updates are bounded but not zero-allocation or benchmarked. Work is at most two arm and two leg analytical solves per eligible model, with two support queries; no iterative physics or per-frame geometry creation.
