# Phase 2 fix list — must land before deploy

Production currently runs the phase-1 checkpoint (`ee6a929`, branch tip `36cfba1`).
Phase 2 (materials, music, gameplay sound, restrained HUD) is in progress on
`improvement/phase2-audio-visual`. This list tracks regressions and decisions
found while deploying/validating phase 1 and integrating phase 2.

Nothing here is closed until it has a focused test or captured evidence. Do not
weaken or delete an assertion to close an item.

---

## F1 — Reduced motion presents as "animations are broken" (user-reported)

**Report:** character animations appear frozen, there is no hip→ADS transition,
and weapon kick/sway are invisible.

**Root cause:** all three are the app's intentional reduce-motion behaviour, not
a broken build:
- `WeaponFeedback.update(..., reduced=true)` returns `EMPTY_CHANNELS` — no kick,
  landing, bob or sway (`game/feedback.mjs:30`).
- `AdsController.update` uses `blend = 1` when reduced — ADS snaps in one frame
  (`game/weapon-ads.mjs:35`).
- `characterPose` uses `motion = reduced ? 0 : speed` — locomotion stride is
  frozen (`game/character-anim.mjs:210`).

Reduced mode is active when either the saved display setting
`token-arena-customization.display.reducedMotion === true` **or** the OS/browser
prefers-reduced-motion query matches (`game/post.mjs:4`,
`app/page.tsx:79-80`, `game/view.mjs:499`). The phase-1 preview route
(`/review?reticle=1`) forces reduced motion **off**, which is why the same
build looks animated there and "broken" in the main app on a machine with
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

**Fixes before deploy:**
1. **Done:** persistent `REDUCED MOTION` chip in the in-match HUD note so the
   mode is never a silent mystery (`PlayingHud.tsx`, `globals.css`).
2. **Decision needed:** soften reduce-motion so gameplay stays readable —
   recommended: keep locomotion stride (damp it, don't zero it), keep a short
   ADS blend (~80-100 ms) while keeping FOV zoom instant, keep a reduced weapon
   kick, and continue to suppress camera shake/bob/decorative particles.
   Alternatives: keep current semantics and only label them, or fully opt-in
   per effect.
3. Add a regression test that reduce-motion still communicates state (ADS
   reticle opacity, enemy stride), so a future change cannot silently regress
   readability.
4. Consider a one-time, dismissible hint when the OS preference is detected
   ("Reduce motion is on — animations are simplified. Change it in Graphics &
   settings.").

**Reviewer workaround today:** Graphics & settings → uncheck **Reduce motion**;
also check the OS setting (macOS *Reduce motion*, Windows *Animation effects*,
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

## F3 — Atrium flat non-walkable facets defeat the cliff-strata invariant

`game/view.test.mjs` "every canonical arena has batched polish…" fails:
`atrium: cliff terrain draws strata`. Atrium has 118 non-walkable facets whose
normals are horizontal (span 0.61–0.78 m, material `stone`) left by the
causeway cut/fill work; the test treats every non-walkable triangle as a cliff,
but the strata generator only draws horizontal lines through faces with real
vertical extent, so no strata mesh is produced.

**Options (pick one, keep the assertion meaningful):**
- Refine the test predicate to steep faces (e.g. `|normal.y| < .7`) and record
  the flat facet count with a comment explaining why they are not cliffs; or
- Reclassify/rework the atrium facets so they are walkable or part of a real
  cliff face.

Do not simply delete the strata assertion.

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

---

## F6 — Full-suite gate before deploy

After both phases are integrated: `npm test` on this branch must be green
(`test:game` + `test:server` + `typecheck` + build + `tests/*.test.mjs`), with
exact counts recorded in the final report. Two known failures at the deployed
phase-1 checkpoint (F2, F3) are being worked here; F2 is fixed.
