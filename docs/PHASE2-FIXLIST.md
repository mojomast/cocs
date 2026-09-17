# Phase 2 fix list — must land before deploy

Production currently runs the phase-1 checkpoint (`ee6a929`, branch tip `36cfba1`).
Phase 2 (materials, music, gameplay sound, restrained HUD) is in progress on
`improvement/phase2-audio-visual`. This list tracks regressions and decisions
found while deploying/validating phase 1 and integrating phase 2.

Nothing here is closed until it has a focused test or captured evidence. Do not
weaken or delete an assertion to close an item.

---

## F1 — Reduced motion presents as "animations are broken" (resolved)

**Report:** character animations appear frozen, there is no hip→ADS transition,
and weapon kick/sway are invisible.

**Resolution (2026-09-17):** the reviewer confirmed their browser/OS had
reduce motion **ON** — the app was behaving as designed, and the report is
closed as a discoverability problem, not a bug. Decision: **keep the semantics**
(ADS snap, zero kick, planted stride) and label them clearly.

**Already pinned by tests:** ADS reduced snap (`game/phase1-weapons-ads.test.mjs`)
and zeroed feedback channels (`game/feedback.test.mjs:29,32-35`); the newly
added `character-anim` test pins the planted contact-gait stride.

**Labeling shipped:** persistent `REDUCED MOTION` chip in the in-match HUD note
(`PlayingHud.tsx`, `globals.css`) and an explanatory note next to the
**Reduce motion** toggle in Graphics & settings (`configuration.tsx`).

**Root cause recap (for the record):** reduced mode is active when either the
saved display setting `token-arena-customization.display.reducedMotion === true`
or the OS/browser prefers-reduced-motion query matches (`game/post.mjs:4`,
`app/page.tsx:79-80`, `game/view.mjs:499`). The phase-1 preview route
(`/review?reticle=1`) forces reduced motion **off**, which is why the same
build looks animated there and simplified in the main app on a machine with
reduce-motion on.

**Evidence (live `https://arena.ussyco.de/review`, RAF stopped, frames stepped
with dt=1/60):**
- reduced=false: fov 82 → 67.28 across 24 frames, progress 0.221 → 0.997,
  viewmodel position blends (z −0.58 → −0.82, y −0.361 → −0.188).
- reduced=true: fov 67.24 and progress 1 on the **first** frame; viewmodel
  position pinned at the hip values.
- Main-app input path verified live: right-mouse hold flips
  `actors[0].ads` false → true → false.
- `game/view.test.mjs`, `game/phase1-*` animation/ADS suites: 47/47 pass on the
  deployed commit with `reduced` off.

**Reviewer workaround:** Graphics & settings → uncheck **Reduce motion**; also
check the OS setting (macOS *Reduce motion*, Windows *Animation effects*,
GNOME *Reduce animations*).

---

## F2 — Third-person gun anchor test pin was stale (phase-1 regression)

`refineOperatorCharacter` (`game/models.mjs`) intentionally sets the
character-owned carry mount to `(.04, .06, -.08)` so the articulated hands keep
both receiver contacts in reach (`.16, -, -.26` was the pre-refinement floating
rig). `game/view.test.mjs` still pinned the old mount, so the deployed commit
failed its own view suite.

**Fix:** the assertion now pins the refined mount on all three axes
(`game/view.test.mjs`). No behaviour changed.

---

## F3 — Atrium flat non-walkable facets defeat the cliff-strata invariant (fixed)

`game/view.test.mjs` "every canonical arena has batched polish…" failed:
`atrium: cliff terrain draws strata`. Baseline atrium had **zero** cliff
triangles; phase 1's causeway cut/fill added 118 steep stone facets with
0.61–0.78 m vertical spans, below the first 1.6 m stratum level, so no strata
line can physically exist on them.

**Fix:** the test now requires strata only where a cliff face actually crosses
a 1.6 m stratum level (`Math.ceil(low/1.6)*1.6 < high`), with a comment naming
the atrium facets and this entry. The assertion is retained and still enforced
for every map with taller cliffs; nothing was deleted or weakened.

**Alternative considered:** emitting an ad-hoc mid-height line for sub-interval
facets. Rejected: it would add noisy striations to stepped cut/fill without
matching the authored 1.6 m stratigraphy.

---

## F4 — Preview-only CSP noise from an absolute favicon URL

Non-production previews log ~10 CSP violations per page because the document
references the absolute `https://arena.ussyco.de/favicon.svg`. Production is
same-origin so it is masked. Make the icon reference origin-relative.

---

## F5 — Cavern reverb IR 404 (fixed)

`/moth/files/ir-cavern/result.wav` returned 404 because the bake downloader
sanitized the dot out of the extension while the manifest kept the dotted URL.
Fixed by committing `public/moth/files/ir-cavern/result.wav` and keeping the
extension intact in `scripts/moth-bake.mjs` (`5d6234b`). The sound workstream
also made `unlock()` retry a failed IR load instead of latching failure.

## F7 — Three stale campaign pins at the phase-1 checkpoint (fixed)

`game/campaign-data.test.mjs` failed at the deployed commit and passes at
baseline:
- `reactor-run` and `crown-duel` win conditions are now `reach` with
  `requireCleared:true` (cleared exit volume), not `assassinate` — intentional
  per `docs/phase1-remaining-campaign-handoff.md`.
- `throne-siege` and `crown-duel` no longer script live reinforcement spawns;
  defenders are predeployed. The stale `bark && spawn` assertions were replaced
  with the new contract (no script spawns; phase-beat barks) instead of deleted.

`node --test game/campaign-data.test.mjs` → 9/9.

Note: the phase-1 checkpoint was never full-suite-run before deployment, so
additional stale pins can still surface. The F6 gate below is what catches them;
fix each by confirming the phase-1 handoff intent and updating the pin without
deleting coverage.

## F8 — Registry placement sweep ran campaign off-map (fixed)

`game/map-layout.test.mjs` constructed a campaign match with the default
mission on all 41 maps; phase 1's strict off-map anchor resolution (intentional)
threw `entrance has no supported floor` on 30 of them. The sweep now runs
campaign only on the map its mission authors and passes that mission id; the
game contract is untouched. Test-only change; 41/41 pass (~133 s).

## F9 — Duplicated tunnel solids and stale facade spans (fixed)

- Phase 1's tunnel rewrite dropped the interior-waypoint guard, so 4 maps
  (frost-gate, riverbend, fortress, convoy-line) each emitted four byte-identical
  conservative wall boxes where collinear segments share a waypoint. The exported
  next-gen maps now filter exact repeated tunnel solids without touching authored
  floor points; `nextgen-maps.test.mjs` stays strict (24/24).
- The quarter-turned window-prop test now asserts the documented outer-wall-plane
  positions and the correct per-side spans (the old pins encoded the pre-phase-1
  swapped-span defect). 24/24.
- Follow-up: restoring the generator guard (`k = i === 0 ? 0 : 1` in
  `ctx.addTunnel`, `game/levelgen.mjs`) is the deeper fix; the map-level filter
  becomes a no-op if it lands.

## F10 — Singleplayer suite hang (fixed)

The autoplay driver cleared only `step.complete.group`, not `complete.groups`,
so predeploy steps never advanced and every mission burned its full 18k-step
guard — the file exceeded 600 s. The driver now clears every required group,
tracks the staged Warden, and advances to authored steps before expecting
step-gated scripts/checkpoints. No production file changed; 44/44 in ~3m21s.

Follow-up perf ticket: `terrainSupportAt` (`game/terrain.mjs:90`) is a linear
triangle scan with no spatial index and dominates step cost on terrain maps
(~13 ms/step with ~20 actors), which is why the campaign sims are slow.

---

## F6 — Full-suite gate before deploy (closed)

`npm test` is green on this branch — all stages exit 0 (`test:game`,
`test:server`, `typecheck`, build, `tests/*.test.mjs`). The first gate run
exposed 36 failures, every one pre-existing at the deployed phase-1 checkpoint
and all fixed above (F7–F10 plus F2/F3): campaign pins 3, placement sweep 30,
next-gen maps 2, singleplayer hang 1. The rerun passed with no failures.
