# Legacy UI

The v2.x menu layer has been superseded by the redesign in `app/ui/`.

## What is new (`app/ui/`)

- `app/ui/contract.ts` — `UiBag`, the prop bag the runtime owner (`app/page.tsx`)
  passes into every new screen.
- `app/ui/primitives.tsx` — `Shell`, `TopBar`, `PageHead`, `Panel`, `Btn`,
  `Segmented`, `Tabs`, `Stats`, `Field`, `Chip`, `Meter`, `Empty`, `Banner`,
  `Modal`, `ActionRail`, `SelectCard`.
- `app/ui/screens/TitleScreen.tsx`, `SelectionScreen.tsx`, `ProgressionScreen.tsx`,
  `NetScreens.tsx` (Browse + Lobby).
- `app/styles/ui.css` — the namespaced `ui-*` / `shell-*` / `panel-*` / `btn-*`
  design system, imported from `app/globals.css`.

## What remains legacy

These are still rendered by `app/page.tsx` and are scheduled for the next
redesign phase (modals/theater/in-match HUD):

- `app/game-ui/configuration.tsx` (Match setup / display / presets / keybinds —
  pinned by `game/race-ui.test.mjs`).
- `app/game-ui/race-hud.tsx`, `soccer-hud.tsx`, `singleplayer-hud.tsx`,
  `game-chat.tsx`, `touch-controls.tsx` (in-match HUD — pinned by
  `game/race-ui.test.mjs` and `game/touch-ui.test.mjs`).
- The theater, pause, results, settings, onboarding and setup markup still
  lives inline in `app/page.tsx`.

The old selection/progression/browse/lobby markup that used to live inline in
`app/page.tsx` is preserved in git history (commit before the v3.0 redesign);
it was replaced rather than duplicated so it cannot drift.

## Compatibility

`game/race-ui.test.mjs`, `game/touch-ui.test.mjs` and `game/scoreboard.test.mjs`
render the legacy `app/game-ui/*.tsx` and `game/scoreboard.mjs` directly by
path. Those exports, prop signatures and class strings are a hard contract and
must not change until those tests are updated in the same change.
