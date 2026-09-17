# Phase 2 map material captures

Six representative arenas re-captured after the phase-2 materials work, plus
labeled before/after sheets against the committed phase-1 atlas.

## Method

- Real `Match`/`ArenaView` through the review harness (`/review?map=<id>&seed=42&overview=1&paused=1`).
- 1280×720, DPR 1, 100% render scale, high quality pinned, paused overview —
  identical parameters to `docs/evidence/phase1/maps/`.
- Chromium SwiftShader (software WebGL). **Compatibility evidence only, not
  hardware FPS.** Overviews cannot prove interior traversal or ground-level look.
- Captured from a locally built preview of the phase-2 branch, not production.

## Files

| File | Contents |
| --- | --- |
| `<map>-overview.png` | Phase-2 capture (after) |
| `after-<map>-metrics.json` | Harness metrics for the after capture |
| `compare-<map>.png` | Top: committed phase-1 overview. Bottom: phase-2 capture |

Maps: `colosseum`, `convoy-line`, `blood-gulch`, `catacombs`, `frost-gate`,
`moth-backrooms`.

## What changed

Procedural surfaces now derive albedo, roughness and normal from one seamless
multi-scale height/wear field, so tiling repetition is much less visible (see
`blood-gulch`: the repeating ground rows in the phase-1 capture are gone) and
normals carry real relief. Geometry, block layout, collision boxes and the
phase-1 portals/causeways are unchanged — the before/after frames are
pixel-aligned apart from material shading.

Mean absolute luminance difference per map (mostly shading, not geometry):
colosseum 0.68, convoy-line 0.54, blood-gulch 2.95, catacombs 0.81,
frost-gate 0.67, moth-backrooms 0.61.

## Limits

- Software capture: not a hardware performance or aesthetic approval.
- Interior/ground-level material review, close-range texture inspection and
  seasonal/time-of-day sweeps remain open.
- The pixel diffs above measure change, not quality; human review of the sheets
  is still required.
