# Phase 1 character worker handoff

## Scope and integration status

Bounded character batch complete. No commits, deployments, delegation, full suites, weapon-file writes, or phase-2 material/audio/HUD work. Other workers' edits were not reverted.

Files changed by this worker:
- `game/character-anim.mjs`
- `game/deaths.mjs`
- `game/models.mjs`
- `game/rig.mjs`
- NEW `game/phase1-characters.test.mjs`
- NEW `game/phase1-character-integration.test.mjs`
- `docs/phase1-characters-integration.patch`
- This handoff.

`game/view.mjs` was inspected read-only. The exact integration patch was generated without writing/applying to view.mjs, syntax-checked in memory, and initially passed `git apply --check`. During final verification the live lead-owned view acquired the character integration hooks and other concurrent changes. This worker did NOT apply them. Do not blindly reapply the patch to the now-integrated view. It records the proposed integration against the pre-integration view. The focused integration test now recognizes the integrated view and exercises it directly in memory, without editing it; before integration it reconstructs the candidate from the patch.

## Implemented runtime behavior

### Lifecycle / transform ownership

`CharacterLifecycle` in `rig.mjs` owns presentation only:
- `alive -> dying -> settled -> respawning -> alive`.
- Captures death position/yaw once; later simulation actor movement does not drag the corpse.
- Dying/settled joint updates and direct rig pose application are rejected by `CharacterRig`.
- Respawn restores captured hierarchy visibility/transforms/scales, resets rig joint bind transforms and all animation accumulators, clears the hit envelope, and places the model at the authoritative spawn position/yaw.
- Corpse shield/base/team marks are hidden; pre-death visibility is restored before live presentation recomputes it.
- Hidden/expired/evicted corpses do no ground sampling. Expired bodies cannot reappear before respawn.
- `release(model)` is a disposal hook; `clear()` is for match replacement/disposal, not revival of a retained model.

The view integration gates interpolation (including the one-frame respawning state), hit push offsets, and NPC style/scale writes while appropriate; clears/releases lifecycle storage on match/model disposal; replaces old corpse posing and revival. The actor loop and interpolation no longer add the old arbitrary 0.04 floor offset to refined operators.

### Grounding / death profiles

- Builds a conservative model-local body envelope from the articulated root's actual mesh bounds once per death. Floor rings and shield siblings are excluded.
- A fixed 27-point body contact lattice plus four slope samples determines support: **31 floor queries per visible corpse update**. No iterative physics, raycast forest, or per-frame geometry rebuild.
- Applies bounded slope alignment, then vertical support correction over the entire extent rather than pinning only the actor origin.
- `sampleGround(x, z, referenceY)` returns a finite world-space support height or `null` for void. Invalid values are treated as missing support. Supports uneven stairs and vertically moving platform callbacks. No support means bounded downward motion until expiry, not an invented zero-height floor.
- Reduced motion immediately selects the final grounded pose without tumble animation.
- All retained-body fall profiles, including crumple and sprawl, reach horizontal rest. Left/right/back retain distinct fall directions; spin only adds bounded yaw.
- Default active count 24 (configuration hard-clamped to 64); default maximum lifetime 4 seconds (hard-clamped to 8), further limited by each death plan. Oldest overflow is hidden deterministically. Void drop is capped at 20 units. Hidden/expired models retain weak-key lifecycle records until respawn or disposal.

The patch uses `floorAt(x,z,arena)` as the available default and exposes `view.characterGroundAt(x,z,referenceY,match)` for the shared spatial support selector. A custom callback's `null` is preserved, not replaced with the legacy fallback. **The lead must connect the final stacked-floor/platform support contract; legacy floorAt does not resolve stacked floors by reference height or all block-top cases.**

### Proportions / gait / details

`refineOperatorCharacter(model)` is idempotent and called once at the end of robotModel construction by the patch:
- Corrects the hip/sole relation to the measured 0.34 thigh + 0.35 shin + 0.0935 sole dimensions. Adjusts torso/chest/head joint spacing.
- Adds chest-attached sternum armor and inexpensive forearm-parented hands with named `grip-L` / `grip-R` sockets.
- Recaptures rig bind transforms after changing proportions.
- Adds exactly **5 meshes / 60 triangles** for these character details, measured on the real model. No weapon geometry changes or material retuning pass.
- Enables `joints.contactGait`; generic rigs retain the prior dimensional contract.
- Grounded ankle targets use analytical hip/knee angles and compensating ankle pitch. Pelvis compression and swing clearance are bounded, including crouch and landing. Idle no longer walks in place. Existing airborne tuck and landing envelope remain.

## Commands and evidence

Focused red/green checks first reproduced: missing lifecycle, corpse floor penetration, phantom idle stride, stale bind transforms, missing refinement, direct pose overwrite while dead, and hidden-body/disposal behavior. These were fixed and rerun.

Final focused command (no glob/full suite):

```sh
node --test game/phase1-characters.test.mjs game/phase1-character-integration.test.mjs game/character-anim.test.mjs game/deaths.test.mjs
```

A complete run before concurrent lead integration passed **42/42** (20 new tests plus 22 existing focused animation/death tests). A subsequent run caught patch-context drift as the lead integrated nearby changes: 40 passed / 2 integration-harness failures. The harness was updated to exercise the integrated view when hooks are present; its two tests then passed. Final rerun on the concurrently integrated tree: **42 tests, 42 passed, 0 failed, 0 skipped; exit code 0; 438.15877 ms reported by Node**. This runtime includes test/module setup and is not a game performance measurement.

Additional checks:
- `git diff --check -- game/character-anim.mjs game/deaths.mjs game/models.mjs game/rig.mjs` passed.
- `git apply --check docs/phase1-characters-integration.patch` passed before concurrent integration; no actual apply was performed by this worker.
- Proposed view source passed `node --input-type=module --check` via stdin before integration.
- Integration test loads the proposed/current view into an in-memory ES module and executes real robot construction, corpse/revive methods, hit-offset gating, and NPC scale gating. It checks the interpolation ownership guard and byte-identical on-disk view contents across execution.
- Grounding tests verify mesh vertices against flat, sloped and stepped support in normal/reduced motion; moving-platform height tracking and exact query count; all six final fall orientations; lifetime/eviction; respawn and joint ownership.
- Real Three.js operator tests check soles through grounded crouch/landing, not only symbolic pose fields.
- Geometry measurement returned `{"addedCharacterMeshes":5,"addedCharacterTriangles":60}`. This is geometry evidence, NOT hardware FPS or a rendering benchmark.

## Limitations / remaining visual review

This is not phase-1 visual sign-off and not per-map coverage.

1. The death solver is a conservative rigid body-envelope presentation, not an articulated ragdoll or wall collision solver. Bounds can bridge stairs or overhangs. A fixed lattice can miss narrow unsampled ridges. Backpack/gun/head extents can conservatively lift other body parts; review clearance visually across all character silhouettes, including headpop.
2. Connect the authoritative stacked-floor support callback before claiming rooftop, tunnel, overpass, or multi-level correctness. Test those actual maps after spatial integration. Moving platforms currently follow sampled vertical height, not horizontal platform velocity.
3. Grounded living gait is inexpensive local-flat-ground kinematics, not terrain-aware per-foot IK or world-space stance locking. Strafe foot placement, slope feet, deep crouch silhouette and transition smoothness need visual review. Crouch compression is intentionally modest to keep the measured short legs within bounds.
4. Hands provide grip sockets but do not yet solve weapon-specific two-hand grip alignment. Keep that integration coordinated with the weapon owner; no weapon file was touched.
5. Corpse limbs use a neutral static pose under the falling root; there is no new physically articulated crumple simulation. Profile direction/timing differs, while final support is stable.
6. No browser/WebGL/software screenshots, hardware frame-time comparisons, or all-character/all-map reviews were produced by this bounded worker. Check run/strafe, crouch, airborne/landing, death on steps and slopes, reduced motion, headpop/gibs, NPC scale, and respawn under interpolation at the lead's isolated preview.
7. The integration patch contains whole minified lines, so neighboring lead/weapon edits can invalidate context. It must not overwrite their work; hooks are already observed in the lead-owned file at handoff.
