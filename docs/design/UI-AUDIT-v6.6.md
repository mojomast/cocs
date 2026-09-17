# COCS v6.6 UI/UX audit — moth worktree (`feat/moth-fidelity`)

Source audited: `/home/mojo/projects/tokenarena-moth` (app/ui, app/game-ui, app/styles/ui.css, app/globals.css, app/page.tsx).
Server: `http://127.0.0.1:5174`. Browser: headless Chromium + Playwright/CDP, software GL (~1.5 fps).
Read-only audit: no repo files touched. All artifacts under `/tmp/opencode/ui-audit/`.

## 1. Screenshot index

| Screen | Files |
|---|---|
| Title | `01-title-1440x900.png`, `02-title-1920x1080.png`, `03-title-1280x800.png` |
| Selection (main menu) | `04-selection-1440x900.png`, `05-selection-1440-bottom.png`, `06-selection-1920x1080.png`, `07-selection-1280x800.png`, `08-selection-1024x768.png`, `09-selection-768x1024.png`, `10-selection-390x844.png`, `11-selection-zoom110.png`, `12-selection-zoom125.png`, `13-selection-highcontrast.png` |
| Match setup modal | `14-setup-1440.png`, `15-setup-1440-bottom.png` |
| Settings dialog (Game/Help/Arsenal/About) | `16-settings-game-1440.png`, `17-settings-help-1440.png`, `18-settings-arsenal-1440.png`, `19-settings-about-1440.png` |
| Online / room browser | `20-online-1440.png`, `21-online-1440-bottom.png` |
| Demo mode (dock / options / free roam) | `22-demo-1440.png`, `23-demo-options-1440.png`, `24-demo-dock-1440.png`, `25-demo-free-1440.png`, `29-demo-dock-1440b.png`, `30-demo-dock-1280.png`, `31-demo-dock-1024.png` |
| In-match HUD | `40-inmatch-1024.png`, `40b-inmatch-640.png` (paused modal not captured; reviewed statically) |
| Results (match complete) | `41-results-1440.png` (Summary), `42-results-scoreboard-1440.png`, `42-results-your-stats-1440.png` |
| Focus / overflow probes | `50-rail-*.png`, `51-head-*.png`, `60-focus-ring-390.png` |

Machine-readable: `metrics-*.json` (per-screen scroll + geometry), `rail-reachability.json`, `selection-detail.json`, `head-390.json`, `overflow-390.json`, `tab-order.json`, `demo-dock.json`, `reduced-motion.json`, `small-targets-390.json`.

## 2. Measured baseline (evidence for every claim below)

Chrome height (header + rail) vs viewport:

| Viewport | Header | Bottom rail | Chrome total | Body viewport |
|---|---|---|---|---|
| 1920×1080 | 81 | 135 | 216 (20%) | 864 |
| 1440×900 | 77 | 138 | 215 (24%) | 685 |
| 1280×800 | 77 | 181 | 258 (32%) | 542 |
| 1024×768 | 77 | 173 | 250 (33%) | 518 |
| 768×1024 | 129 | 227 | 356 (35%) | 668 |
| 390×844 | 176 | 436 | 612 (72%) | 232 |

Scroll depth (`.shell-body` scrollHeight / clientHeight):

| Screen | Viewport | Content | Screens of scroll |
|---|---|---|---|
| Selection 1920×1080 | 864 | 1558 | **1.8×** |
| Selection 1440×900 | 685 | 1684 | **2.5×** |
| Selection 1280×800 | 542 | 1683 | **3.1×** |
| Selection 1024×768 | 518 | 2309 | **4.5×** |
| Selection 768×1024 | 668 | 2822 | **4.2×** |
| Selection 390×844 | 232 | 4071 | **17.5×** |
| Match setup modal | 695 | 4812 | **6.9×** |
| Settings → Game | 678 | 3084 | **4.5×** |
| Settings → Help | 678 | 1944 | **2.9×** |
| Settings → Arsenal | 678 | 953 | 1.4× |
| Rooms (browse) | 742 | 974 | 1.3× |

Selection column composition at 1440×900 (`.layout--lead`): left column = Operator 664 + Harness 506 + Dailies 272 + gaps = **1474**; right column = Preview 329 + Quick Start 683 + Presets 140 + gaps = **1434**, i.e. the right column ends ~310 px before the left (392 px at 1280×800, ~3 100 px of empty left column inside the setup modal).

Header control measurements at 1440 (`.head-actions` = 397×44, `scrollHeight` 67, header `scrollHeight` 89 vs `clientHeight` 76):

| Button | Box | Content |
|---|---|---|
| Patch notes | 44×44 | scrollHeight **66** (label on a 2nd grid row, below the icon) |
| Graphics & settings | 189×44 | fits (`.settings-trigger{width:auto}`) |
| Fullscreen | 44×44 | scrollWidth **81** (11 px label runs under the mute/GitHub buttons) |
| Mute | 44×44 | fits (icon only) |
| GitHub | 44×44 | fits (span is clipped by `globals.css:619`) |

---

## 3.0 R1 — P0: The results "Summary" card collapses to a 100 px column (legacy cascade collision)

**Impact:** The single most important screen (post-match results) is visibly broken: KILLS / DEATHS / K/D / TIME / XP EARNED stack **vertically** in a ~100 px column, centered, with ~500 px of empty space to their right; the LEVEL/PRESTIGE meters shrink to ~200 px; the result line and context are cramped, and the panel grows past the viewport (in `41-results-1440.png` the modal footer is cut off at the bottom edge), while the sibling tab needs no scroll at all (`metrics-results-1440.json`: Your-stats body = 133 px in a 133 px body).

**Root cause (exact):** two `.match-summary` rules collide and the cascade merges their properties:
- `app/globals.css:690` (legacy): `.match-summary{display:flex;align-items:center;flex-wrap:wrap;gap:8px;...}`
- `app/styles/ui.css:282` (v6): `.match-summary{display:flex;flex-direction:column;gap:var(--ui-gap-3);padding:16px;...}`

`ui.css` is imported after `globals.css`, so `flex-direction:column` wins, but the legacy **`align-items:center`** and `flex-wrap:wrap` are *not* overridden. In a column flex container, `align-items:center` makes every child shrink to its min-content width — so `.stats` (`ui.css:153`, `repeat(auto-fit,minmax(100px,1fr))`) computes a single 100 px column and the 5 stats stack.

**Proposed fix (one rule in `app/styles/ui.css:282`):**
```css
.match-summary{display:flex;flex-direction:column;gap:var(--ui-gap-3);padding:16px;
  align-items:stretch;          /* override legacy align-items:center */
  flex-wrap:nowrap;             /* override legacy flex-wrap:wrap */
  font:inherit;letter-spacing:normal;color:var(--text);cursor:default;text-align:left}
```
(Verifying the whole family with `grep -n '^\.match-summary' app/globals.css app/styles/ui.css` and deleting the legacy block is the cleaner long-term fix — see I15.)
**Effort** S · **Risk** low · **Collision** `app/globals.css` is a Phase-4 file; the ui.css variant avoids it.

**Verified live:** injecting the rule above into the running page makes `.stats` 732 px wide with 5 × 137 px columns (was `align-items:center` / single `100px` column). See `71-results-summary-fixed-sim.png` for the corrected card.

---

## 3. The three user-reported issues


### A. P0 — Main-menu top-right buttons draw wrong (labels escape the 44 px buttons)

**Impact:** On every menu (selection, rooms, theater, progression, changelog) the top-right controls are visibly broken: "Patch notes" wraps to two lines below the sparkle icon and bleeds over the header's bottom border; "Fullscreen" text paints outside its button and collides with the mute button (1440) and the GitHub button (1920/390); the header's content box overflows by 13 px at all sizes; at ≤768 px the GitHub button is pushed to a second row and the header grows to 129–176 px, cutting the content area.

**Root cause (exact):**
- `app/page.tsx:624` — `headActions` renders `<span>` labels inside `.icon-button` elements.
- `app/globals.css:45` — `.icon-button{display:grid;place-items:center;width:36px;height:36px}` and `app/globals.css:149` — `.icon-button{min-width:44px;min-height:44px}`. A CSS grid with two children (svg + span) creates two auto rows: the label is drawn *under* the icon inside a 44 px box (measured `scrollHeight:66`), and long labels overflow horizontally (`scrollWidth:81`).
- `app/globals.css:619` hides a span only for the GitHub link (`a.icon-button.github-link>span`); `app/globals.css:151` `.settings-trigger` is the only button that widens to fit its label.
- `app/styles/ui.css:14` `.shell-head` has no `flex-wrap` control at ≥721 px, and `.brand-name em` (`ui.css:33`) wraps to 2 lines at 768 px, which is what makes the header 129 px tall there.

**Proposed fix (CSS-only, lowest risk; `app/styles/ui.css` next to `.head-actions:37`):** keep the `.settings-trigger` override **after** the sr-only rule (same specificity, later wins):
```css
.head-actions .icon-button>span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.head-actions .settings-trigger>span{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto}
.head-actions{flex-wrap:nowrap}
.brand-name em{white-space:nowrap}
@media (max-width:900px){.brand-name em{display:none}}
@media (max-width:480px){
  .settings-trigger{width:44px;padding:0}
  .settings-trigger>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .head-actions{gap:6px}
}
```
Also missing (same selector, requested in the brief): `.icon-button` has **no hover state and no `aria-pressed` style** anywhere (`grep ':hover'` on `.icon-button` → only `.icon-button.danger`, `globals.css:646`). Add:
```css
.icon-button{transition:border-color .16s,background .16s,color .16s}
.icon-button:hover{background:rgba(131,244,213,.08);border-color:var(--accent-soft);color:var(--text)}
.icon-button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:rgba(131,244,213,.1)}
```
(this also gives the fullscreen toggle a visible on/off state).

**Verified live:** after injecting the rules above, the header's `scrollHeight` drops from 89 → 76 (no overflow), every control measures 44×44 with 42 px content, and the "Patch notes"/"Fullscreen" labels are visually hidden but remain in the accessibility tree. Before/after: `04-selection-1440x900.png` / `70-header-proposed-fix-1440.png`.

Alternative (JSX): delete the `<span>` children in `app/page.tsx:624` — all five controls already have `aria-label` and `title`, so nothing is lost for AT. Prefer the CSS variant because it also protects future `.icon-button` call sites (demo dock, theater).
**Effort** S · **Risk** low · **Collision** ⚠ the JSX variant edits `app/page.tsx` (Phase 4 file); the CSS variant only touches `app/styles/ui.css`, which is *not* in the Phase 4 list.

---

### B. P0 — Demo dock reads as a floating blob instead of a top bar

**Measured:** `.demo-controls` at 1440×900 = **720×252 at x=360, y=30**; every row is `justify-content:center` with ragged widths (row widths 694/694/694/694, last row 36 px tall); with Free Roam the dock adds a 5th row (~300 px total); at ≤600 px it wraps (`ui.css:596`).
It *is* pinned to the top (`top:calc(var(--safe-top)+18px)`), so the reported "pools in the middle" is a **centering** artefact, not a vertical-centering bug: the island is centered horizontally (360 px of dead margin each side at 1440) and each row is centered independently, producing a diamond of controls hanging in the top-middle of the viewport.

**Root cause (exact):**
- `app/styles/ui.css:582` — `.demo-controls{position:fixed;top:calc(var(--safe-top)+18px);left:50%;transform:translateX(-50%)}`.
- `app/styles/ui.css:586` — `.demo-controls__row{...justify-content:center}` and `ui.css:592` — `.demo-options{...justify-content:center}`.
- `app/ui/DemoControls.tsx:31-79` renders 4–5 stacked rows + a help line; `app/page.tsx:644-649` mounts it only while `demoOnly`.

**Proposed fix (CSS-only):**
```css
/* app/styles/ui.css:582 */
.demo-controls{
  top:calc(var(--safe-top) + 10px);
  left:max(var(--edge), var(--safe-left));
  right:max(var(--edge), var(--safe-right));
  transform:none; max-width:none; align-items:stretch;
}
.demo-controls__row{justify-content:flex-start;flex-wrap:wrap;row-gap:6px}
.demo-controls .demo-controls__enter{margin-left:auto}     /* ENTER ARENA hugs the right edge */
.demo-options{justify-content:flex-start}
@media (max-width:900px){.demo-controls{left:12px;right:12px}}
```
Optional follow-up (M): collapse rows 3–4 behind a "CAMERA ▾" disclosure; keep row 1 + PAUSE + DEMO OPTIONS always visible. That takes the dock from ~250 px to ~100 px and keeps the 3D view clear.
**Effort** S · **Risk** low · **Collision** DemoControls.tsx is not in the Phase 4 list, but `app/globals.css` is — keep the change in `app/styles/ui.css`.

---

### C. P1 — Too much scrolling and wasted horizontal space (measured, with the exact decluttering)

Scroll table in §2. Concrete causes and fixes, in priority order:

**C1. Selection grid density** — `app/styles/ui.css:54` `.grid-cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))}`. At 1440 the operator column is 723 px → only **2 columns**, 9 operators = 5 rows × 85 px (`selection-detail.json` card = 356×85) → Operator panel = 664 px. Change to `minmax(min(100%,190px),1fr)` → 3 columns at 1440, 4 at 1920; Operator panel drops to ~430 px. Add a compact card at `≤1024px` by hiding `.card-tag` and reducing `.card` padding to `8px 10px` (keeps name + stats). **Effort** S · **Risk** low (visual only).

**C2. Column balance** — move `DAILY CHALLENGES` (SelectionScreen.tsx:59-64) under `LOADOUT PRESETS` in the right column, and make the right column sticky (§I1). Left 1474→~1200, right 1434→~1700 at 1440; both columns then fill the scroll instead of leaving 300–400 px of dead space at the bottom of the right column.

**C3. Match setup modal = 6.9 screens** (`metrics-setup-1440.json`, 4812 px inside a 695 px body). Causes: (a) 11 arena cards in 2 columns of ~285 px with 4-line descriptions (`SetupModals.tsx:14`, `SelectCard` tag); (b) mode picker renders 10 full cards (`MatchConfiguration`, `configuration.tsx:94-102`); (c) all rules/modifiers in one column ~590 px wide.
Fixes: (i) clamp `.card-tag` to 2 lines (`-webkit-line-clamp:2`) and shrink `MapPlan` art; (ii) render modes as the existing `Segmented`/chip row + one detail panel; (iii) at ≥1100 px put `.match-configuration .config-grid` in `grid-template-columns:repeat(2,minmax(0,1fr))` and modifier toggles in `columns:2`; (iv) move `PresetsConfiguration` into the empty left column under the arena list (`SetupModals.tsx:11-20`). Estimated 4812 → ~1800 px (2.6× less scroll).

**C4. Settings dialog** — `SettingsDialog.tsx:73` uses `size="xl"` (1120 px, `ui.css:192`) for what is a single-column form: Game tab 3084 px and sliders stretched 1024 px wide. Use `size="lg"` (840) and a 2-column body at ≥900 px (preferences | Display), `max-width:420px` on `.config-field`/sliders. Arsenal already fits in 1.4 screens.

**C5. Rail dominance on small screens** — rail = 181 px at 1280×800, 227 px at 768, **436 px at 390 (52 % of the viewport)**; combined with the header only 232 px is left for content at 390 (content needs 4071 px). `SelectionScreen.tsx:21-39` puts 10 actions + 6 chips in one wrapping flex rail (`ui.css:23,206`, mobile override `ui.css:311`).
Fix: at ≤900 px collapse to two rows: `[chips]` + `[ENTER ARENA]` full width, with a `<details>`/"MORE ▾" that expands `SINGLE PLAYER / ONLINE / THEATER / SPECTATE / RANK / PATCH NOTES / ARSENAL / BACK TO DEMO / MATCH SETUP`. Removes ~280 px of chrome on phones and duplicates seen in I7.

**C6. Rooms toolbar** — `NetScreens.tsx:40-44`: the `.ui-input` is `flex:1 1 180px` but widens to 1240 px, forcing QUICK JOIN onto its own row; `21-online-1440-bottom.png` shows a full-width row of input + empty space. Set `.toolbar .ui-input{flex:1 1 320px;max-width:480px}`.

---

## 4. Additional improvements, ranked by impact / effort

| ID | Pri | Title | Impact | Root cause (file:line / selector) | Proposed fix | Effort | Risk | Phase-4 collision |
|---|---|---|---|---|---|---|---|---|
| I1 | P1 | Sticky 3D preview column | Keeps the operator model visible while scrolling 2–4 screens; kills right-column dead space | `SelectionScreen.tsx:67` `.preview-stage` in a normal grid; `ui.css:234` | `.layout--lead>.stack:last-child{position:sticky;top:calc(var(--safe-top)+92px);align-self:start}` at ≥1101 px | S | low | no |
| I2 | P1 | Fill setup-modal left-column void | ~3 100 px of empty left column today | `SetupModals.tsx:11-20` | Move `PresetsConfiguration` + the "match rules summary" under the arena list; or `grid-template-columns:minmax(0,1fr)` → single column with accordions | S | low | no |
| I3 | P1 | Rail buttons below 44 px touch target | On phones 10 rail actions are 36 px tall (`rail-reachability.json`, 176×36 at 390) | `ui.css:101` `.btn-sm{min-height:36px}` used for every rail action | `@media(max-width:900px){.rail-actions .btn{min-height:44px}}` | S | low | no |
| I4 | P1 | 12 px horizontal overflow at 390 px | Body scrolls sideways on phones | `SelectionScreen.tsx:46` "SHUFFLE LOADOUT / MAP" `btn-sm` = 203 px, right edge 402 > 390; `.panel-head` (`ui.css:71`) has no wrap | `.panel-head{flex-wrap:wrap}`; `.panel-head .btn{min-width:0;white-space:normal}`; label → "SHUFFLE" ≤480 px | S | low | no |
| I5 | P1 | Disabled controls fail contrast | Disabled text = 4.04:1, small text | `ui.css:92` `.btn:disabled{opacity:.45}`, `ui.css:112` `.card:disabled{opacity:.45}` | raise to `.6` (5.4:1) or use a flat `#8fa8a0` color with 1:1 layout | S | low | no |
| I6 | P1 | Pause menu embeds the entire settings form | Escape mid-match drops the player into a 3 000+ px scrollable settings form (same `prefs` node as the settings dialog) with the full Display/Keybinds sections | `ResultModals.tsx:22-36` (`<Panel label="SETTINGS">{prefs}</Panel>`) + `page.tsx:604` (`prefs` = preferences + `DisplayConfiguration` + `AccessibilityConfiguration` + `KeybindsConfiguration`) | In the pause modal render only the quick block (sensitivity, audio, mute, reduce motion) + a `Btn` "OPEN GRAPHICS & SETTINGS" that calls `setSettings(true)`; keep the full form in `SettingsDialog` | S | low | ⚠ `ResultModals.tsx` is not on the Phase-4 list, but `page.tsx:604` is |
| I7 | P1 | Duplicate navigation | Two routes to the same screens (header "Patch notes" + rail "PATCH NOTES"; header "Graphics & settings" + rail "ARSENAL"; rail "RANK") — 15 chrome buttons on the selection screen | `page.tsx:622-624` + `SelectionScreen.tsx:29-38` | Keep utility in the header and match actions in the rail: delete rail `PATCH NOTES`, `RANK`, `ARSENAL` (they already exist in the header / a profile entry), or fold them into the rail "MORE" (C5) | S | low | no |
| I8 | P1 | Title screen: broadcast bar clips the meta chips on short viewports | Measured at 1440×900: chips 638–665 vs broadcast bar top 662 → the bar clips the chip row; at 1280×800 the overlap grows to ~25 px (`03-title-1280x800.png`) | `TitleScreen.tsx:19-24` + `.demo-broadcast{bottom:safe+84px}` `ui.css:541` | `@media (max-height:820px){.title-stage{padding-bottom:calc(var(--safe-bottom) + 180px)}}` (or move chips above the CTA) | S | low | no |
| I9 | P1 | Phase-4 wing/verb/combo preview placement | Adds no scroll | `.preview-stage` (`ui.css:234`, 220–420 px, holds only the model + caption) | Turn the preview card into a 2-tab strip: `MODEL` / `KIT`. The KIT tab renders wing, verb, combo summary inside the existing height; "OPEN ARSENAL" link reuses `openSettings('arsenal')`. No new sections → no new scroll | M | med (data shape) | data comes from Phase-4 `game/harness-profiles.mjs`; coordinate |
| I10 | P1 | Movement HUD slot for 4.1 without clutter | Avoids a new overlay row | `PlayingHud.tsx:87` already renders `.hud-pills` above the vitals card (`hud-corner--left`); mid-left edge is empty | Add the movement readout (dash charges / air time / slide) as `.hud-pill`s inside `hud-corner--left` (above `.stat-card--vitals`), or a 3rd mini-bar inside the vitals card. Reuses existing tokens; no new absolute layer | S | med | ⚠ `PlayingHud.tsx`, `app/page.tsx`, `app/globals.css` are being edited by the Phase-4 agent — this one **will** collide; land it after their branch |
| I11 | P2 | Setup-modal map descriptions | Long 4-line blurbs are the main height driver in the arena grid | `SetupModals.tsx:14`, `.card-tag` `ui.css:118` | `-webkit-line-clamp:2;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden`, full text in `title` | S | low | no |
| I12 | P2 | Demo dock button sizes | `.demo-option` is ~27 px tall; hard to hit | `ui.css:593` `.demo-option{padding:6px 10px}` | `padding:8px 12px;min-height:32px` (still secondary) | S | low | no |
| I13 | P2 | Captions / reduced-motion discoverability | Both are buried in Settings → Display; no in-HUD affordance | `configuration.tsx:112` (`Subtitles / audio captions`, `Reduce motion`); HUD caption `PlayingHud.tsx:69` | Add "CC" and "MOTION" pills to `.hud-bottom-note` (or the pause modal footer) that call the same `setDisplay`; reduced-motion already has a HUD badge (`PlayingHud.tsx:108`) | S | low | ⚠ PlayingHud.tsx (Phase 4) |
| I14 | P2 | Stale version string on the title footer | Users see v6.5 while `RELEASE_VERSION` exists | `page.tsx:643` hardcodes `v6.5 · MOMENTUM` | use `RELEASE_VERSION`/`RELEASE_CODENAME` from the ui bag | S | low | ⚠ page.tsx (Phase 4) |
| I15 | P2 | Dead legacy CSS (≈40 KB) | Already caused the `.icon-button` conflict (globals.css:45 vs 149 vs 619); every ui.css rule has to out-specify it | `app/globals.css` lines 45–700: `.title-screen`, `.title-letter`, `.loadout-grid`, `.operator-card`, `.harness-card`, `.settings-panel`, `.preview-corner`, `.harness-key`, `.action-bar`… none referenced by the v6 UI (`app/legacy/README.md` says so) | Delete the unused blocks after one grep pass over `app/**/*.tsx`; keep `.game-hud`, `.race-*`, `.sp-*`, `.touch-*`, `.demo-broadcast` | L | med | globals.css is a Phase-4 file — defer |
| I16 | P2 | Contrast of legacy muted micro-copy | `#53786b`/`#5b776a`/`#4f6f63` are 3.4–3.9:1 | `globals.css` legacy `.preview-corner`, `.harness-key`, `.pool-label` etc. (dead per I15) | Remove with I14; if kept, raise to `--text-mute` (6.1:1) | S | low | no |

**Accessibility positives worth keeping:** tab order starts in the header and is logical (`tab-order.json`); Escape closes every modal and returns to the previous mode (`page.tsx:547`); modals trap Tab and restore focus to `[data-setup-trigger]` (`page.tsx:545,547`); focus ring `2px #b9ffe3` offset 4 px is global (`globals.css:45`); `prefers-reduced-motion` leaves zero running animations on the menus (`reduced-motion.json`); text contrast on dark panels is 9–15:1 (`--text-dim` 9.0, `--text-mute` 6.1); high-contrast palette works (`13-selection-highcontrast.png`); touch buttons are 46–74 px except the 42 px util pair (`globals.css:834`).

## 5. Suggested execution order (for the implementation agent)

1. **R1** (results Summary card) — one CSS declaration block; fixes a visibly broken payoff screen.
2. A (header labels + hover states) — one CSS block in `ui.css`, fixes the most visible defect on every screen.
3. B (demo dock) — one CSS block in `ui.css`.
4. C1 + I4 + I3 (selection density, overflow, touch targets) — three small CSS edits; cuts ~2 screens of scroll at 1440 and unblocks phones.
5. C3 + I11 + I2 (setup modal) — biggest scroll win (6.9× → ~2.6×).
6. C4 + I1 (settings dialog, sticky preview) + I6 (pause modal).
7. C5 + I7 (rail/header consolidation) — needs a design decision; do it last so it doesn't conflict with the Phase-4 branch.
8. I9/I10 (Phase-4 surfaces) — after the Phase-4 agent lands; use the `.preview-stage` tabs and the `.hud-pills` slot above the vitals card.

## 6. Screenshot highlights (why each screenshot is in the set)

- `04-selection-1440x900.png`: the reported header defect (labels under/outside the 44 px buttons).
- `13-selection-highcontrast.png`: same defect persists in high-contrast mode (borders thicken, labels still escape).
- `22-demo-1440.png` / `25-demo-free-1440.png`: 4–5-row centered dock; `demo-dock.json` proves the 720×252 @ (360,30) geometry.
- `08-selection-1024x768.png` / `09-selection-768x1024.png` / `10-selection-390x844.png`: rail grows to 33–52–72 % of the viewport; operator panel is 1 column at 390 (1145 px).
- `14-setup-1440.png` + `15-setup-1440-bottom.png`: 6.9-screen modal and the empty left column at the bottom.
- `16-settings-game-1440.png`: 1024 px-wide sliders in a 1120 px dialog, 4.5 screens.
- `21-online-1440-bottom.png`: 1240 px input, wrapped QUICK JOIN.
- `40-inmatch-1024.png`: HUD reference; the bottom-left vitals corner is the free slot for the Phase-4.1 movement readout.
- `41-results-1440.png`: **R1** — the collapsed Summary card (stats stacked in a 100 px column, empty right half) versus the correctly flowing `42-results-your-stats-1440.png`.

## 7. Evidence completeness and residual gaps

- Results modal captured (`41-results-1440.png` + two tabs). It exposed **R1**, the highest-priority layout break in this audit. The footer (PLAY AGAIN / NEXT ARENA / SURPRISE ME / WATCH REPLAY / CHANGE LOADOUT) fits in one row at 1440; at ≤900 px it will wrap into 3+ rows — re-check if the rail work (C5) touches the footer.
- The paused modal was **not** captured (the first capture run died on the match-start click); its structure was reviewed statically (`ResultModals.tsx:22-36`) and the I6 finding is based on the code path (`page.tsx:604` `prefs` = the whole settings form), not on a screenshot. The pause modal is the only screen in the brief without a visual.
- 125 % browser zoom was emulated by shrinking the CSS viewport (1152×720, `12-selection-zoom125.png`); real browser zoom uses the same reflow, so the same defects appear (header text overlap is visible there too).
- The production CSS bundle (`/tmp/opencode/ui-audit/prod.css`, fetched from arena.ussyco.de) matches the moth `.demo-controls`, `.icon-button` and `.match-summary` rules verbatim, so all reported issues reproduce in production.
- The 1024/768/390 captures are 87 px shorter than the emulated viewport (headless window-size artefact); layout metrics come from `page.evaluate(innerHeight)`, and `rail-reachability.json` proves no primary action is off-screen at any size (the earlier appearance of a clipped ENTER ARENA was the screenshot crop, not the layout).
