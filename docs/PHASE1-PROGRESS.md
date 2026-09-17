# Phase 1 integration progress

## Current user authorization
The user reviewed the preview and explicitly requested committing/pushing the current work with labeled map screenshots, then a handoff for the next agent to deploy it live and begin phase 2. This supersedes the historical approval block below. It authorizes the next stages, not a claim that all visual/balance/performance checks have passed. This agent is committing/pushing only, not deploying or starting phase 2. See PHASE2-HANDOFF.md and evidence/phase1/maps/README.md. Historical worker statuses and limits remain recorded below.

Baseline and starting HEAD: e79fcc048d7d97e7418d2e6fdbdd304b69362fa0. Preserve subsequent changes. Phase 2 is blocked pending explicit user approval. Production must not be replaced. No full test suites until BOTH phases complete.

## Ownership (one writer per file)
Lead: game/view.mjs, game/core.mjs, game/spawn-placement.mjs, game/phase1-spawn.test.mjs, game/review.mjs, app/page.tsx, app/review/page.tsx, scripts/map-review-audit.mjs, scripts/review-capture.py, review route/tooling, progress and integration; shared runtime integration exclusively lead-owned.
Spatial and weapon foundation workers: completed and released their files; renderer integrations applied by lead. Retained patches are historical and must not be blindly reapplied.
Character followup: completed; lead integrated final living foot/grip pass in view.mjs. Production character files released. Lead changed old integration-test import detection to accept combined imports without relaxing behavior assertions.
Bridge correction worker: game/levelgen.mjs, game/terrain.mjs, game/structures.mjs, game/nextgen-maps.mjs, NEW game/phase1-bridge-access.test.mjs and docs/phase1-bridge-*; core/view remain lead-owned.
Legacy map reviewer: game/island-maps.mjs, expansion-maps.mjs, ctf-maps.mjs, battle-maps.mjs, arsenal-maps.mjs, blood-gulch.mjs, NEW game/phase1-legacy-review.test.mjs and docs/phase1-legacy-handoff.md.
Remaining-campaign worker: game/campaign-data.mjs, game/singleplayer.mjs, game/story.mjs, game/campaign-anchors.mjs, NEW game/phase1-remaining-campaign.test.mjs and docs/phase1-remaining-campaign-handoff.md. Preserve completed Convoy Run. No map/core/view writes.
Later batches: map-family files partitioned after spatial contracts stabilize; campaign-data/singleplayer/campaign/story then assigned together.

## Contracts
Legacy blocks remain ground-to-top solids. Elevated surfaces require explicit shared representation across simulation, rendering and navigation. Facade details use local frame and parent transform. Tunnel authored floor and portals agree across consumers. Deterministic generation, software compatibility, and authoritative simulation remain required.
100% render scale remains supported; no automatic quality reductions to disguise regressions. Renderer metrics require identical scene/seed/resolution/DPR/settings. Software evidence is not hardware FPS.

## Coverage
Registry inventory: 41 playable maps, including moth-backrooms, puma-circuit, puma-pitch. Baseline audit completed for all 41 with actual navigation travel/exposure/elevation data at ../cocs-evidence/baseline/map-audit.json. All marker support/obstruction/distance checks pass at baseline; this does NOT establish route quality or visual coherence. Family review/ledger pending. Shared fixes alone are not per-map review.

## Completed and verification
Initial HEAD inspection: e79fcc048d7d97e7418d2e6fdbdd304b69362fa0 remains HEAD; all prior uncommitted work preserved.
Foundation, weapon ADS and character lifecycle runtime integrations applied. Resume verification: spatial renderer integration + weapon ADS/runtime focused command passed 7/7. Typecheck passed before subsequent worker changes. Initial campaign focused run 1 pass / 1 failure (entrance anchor not yet integrated); campaign worker still owns unfinished changes, not accepted as complete.
Added scripts/review-weapons.py: all ten real ArenaView weapon hip/ADS checks, reversal, reload interruption and reduced-motion snap passed in Chromium SwiftShader at 1280x720 DPR1 100% scale. Captured 20 PNGs and JSON at ../cocs-evidence/weapons-runtime. This is compatibility only, not hardware performance or visual approval. A sentinel render exception verifies caught runtime errors are exported. Capture now fails on exported runtime errors. HMR interrupted two development runs; isolated browser WebSocket interception now freezes loaded modules during this offline smoke (not a multiplayer test).
Visual inspection of weapons 0-3: clear central aperture in scoped rail; rocket rear exhaust is below aim but visually resembles a misleading sight ring; rifle/scatter rear blocks remain bulky. Requires geometry review, not approved. No production deployment or full suites; phase2 untouched.

## Latest resumed integration evidence
- Convoy Run verified directly: 11/11 focused checks passed, including bounded real Match.step and checkpoint restoration.
- Living foot/grip pass applied in ArenaView after hit/interpolation updates; old exact-import detection fixed in test harness, preserving behavioral assertions. Character/grip/lifecycle command: 29/29 passed.
- Post-integration browser weapon run: all ten hip/ADS, reversal, reload interruption and reduced-motion checks passed; 20 screenshots at ../cocs-evidence/weapons-grips-integrated.
- New scripts/review-characters.py verified real-renderer death/settled/respawn in normal/reduced motion, including upright restored transforms and no caught runtime errors. Six screenshots plus JSON at ../cocs-evidence/characters-runtime. Initial camera angle was occluded; revised selector requires clear floor/body/camera LOS. Current image is usable for whole-character visibility, not fine grip/sole approval; closer side angles still required.
- Current typecheck passed. Nextgen changed-map regressions: 12/12 passed. Worker reviewed 17 map exports and corrected six layouts; documented bridge/cavern issues remain in docs/phase1-nextgen-handoff.md and are NOT approved.
- Special-map bounded check: two race gate/furniture tests passed; marker/nav audit for puma-circuit, puma-pitch and moth-backrooms has zero marker issues (not full route proof). Each rendered at 1280x720 DPR1 100% high pinned with empty page/runtime errors, captures at ../cocs-evidence/special-maps. SwiftShader only, not hardware performance. Embedded zero frame-time fields are not measurements; use separate RAF fields with compatibility-only caveat.

## Consolidated latest status (supersedes historical pending-worker entries)
All bridge, legacy, remaining-campaign and portal workers completed and released ownership. Lead verified their changes; reference integration patches are historical, not an unapplied queue.

- Legacy: lead verified 19 focused checks. Bridge plus remaining-campaign focused batch: 36 passed. Causeways are ground-supported, not elevated pass-under bridges. Campaign placement/checkpoint evidence is not human combat balance.
- Portal proposal applied after bridge completion. Frost removes a rock/nav-clearance conflict; Catacombs widens real tunnels. Portal, nextgen and Convoy combined batch: 30 passed. Catacombs radius-8 center-avoiding traversal works but still uses the central chamber annulus; no independent outer flank exists.
- Classic review: 5 focused checks passed after correcting ramp landmarks and Launchpad/Citadel pickup spacing. See phase1-classic-handoff.md.
- Weapon rear geometry reduced. All ten built-preview hip/ADS checks passed with actual reticle, 20 screenshots at ../cocs-evidence/built-weapons. Actual ADS simulation video in ../cocs-evidence/motion.
- Repository build command passed; isolated built preview on port 4321, /review HTTP 200. No production service replacement. Bundle-size warnings remain.
- Fixed character capture's development-only module import by exposing the existing spatial queries through the review harness. Built-preview death/settled/respawn smoke now passes normal and reduced motion: six screenshots at ../cocs-evidence/built-characters. Improved staging synchronizes bodyYaw and aim yaw, removes spawn-protection/status shields for an unobscured neutral inspection, and moves camera nearer. This changes only evidence staging, not gameplay shield behavior.
- Gallery generated at ../cocs-evidence/index.html, served separately on port 4322 (HTTP 200). Verified 41 map PNGs and 41 map metric records, with no recorded browser/runtime errors. Seven revised maps were recaptured from built preview; remaining atlas images are development captures. Not all overviews have received detailed visual inspection.

## Outstanding
Ground-level visual/play review, close grip/sole and moving-character inspection, campaign combat pacing, attachment combinations and a qualified baseline/performance comparison. SwiftShader evidence is compatibility only; zero embedded frame metrics are invalid. Current overview/neutral character screenshots do not prove aesthetic quality or balance. Phase 1 is not approved or declared complete. Phase 2 and full required suites remain deferred.
