# Phase 2 progress — materials, music, gameplay sound, HUD

Branch: `improvement/phase2-audio-visual`. **Deployed to production as
`v6.4 · SPECTRUM` on 2026-09-17** (web-only restarts; the game server was not
restarted because no changed file is in its import graph). The resolution
budget/dynamic-resolution work shipped in the same release.

Scope per `docs/PHASE2-HANDOFF.md`: natural/credible materials, cinematic music,
substantial gameplay sound, restrained HUD — preserving phase-1 geometry, ADS,
characters, campaign behaviour, accessibility and reduced motion at 100% render
scale. No new weapons, maps, modes or dependencies.

## Delivered

### Materials (`game/textures.mjs`, `game/moth-surface.mjs`, `game/environment.mjs`)
- Natural surfaces derive albedo/roughness/normal from one seamless multi-scale
  height/wear field; measured concrete albedo/roughness correlation 0.874
  (pin > 0.75), tile edge-step ratio 0.74–0.95 (was 3.8–11.3), normal R std
  0.08–0.23 (was ~0.007). Weathering is per-kind data (stain/streak/dust/temperature).
- Enhancer macro is a two-scale masked region field with a ridged fracture layer
  and a new `fractureStrength` option/setter; grid kinds stay no-ops.
- Cinematic day/dusk/night sky palettes, stronger horizon haze, de-neoned
  ambience/weather tints.
- Wired in `view.mjs`: enhancer now applies to every natural surface (no longer
  Moth-albedo-only), `normalScale` 0.6, day/dusk/night phase reaches the CPU sky.

### Music (`game/music.mjs`)
- Eight-bar progressions with fills, absolute-quarter lead phrasing (full themes
  now sound instead of a restarted 4-note fragment), staged combat layers,
  outro/enter/idle transitions, seeded noise risers, panning and reverb sends.
- Public API, `MUSIC_EXPORTS` and `MUSIC_SCENES` unchanged; no page wiring needed.

### Gameplay sound (`game/feedback.mjs`, `game/sfx-design.mjs`)
- Single-token layered reports (crack/body/thump/sub/family/tail) with
  deterministic variation and distance darkening; surface-aware impacts,
  ricochets and bounded explosion debris; surface footstep/landing/jump/slide
  foley; wind and tension ambience; retuned objective cues and announcer motifs;
  shared space send; retry-safe cavern IR load.
- Wired: solo movement foley resolves terrain material per frame; authored
  weather wind forwards to the ambience bed. All optional (`setSurfaceResolver`,
  `setWind`, optional event fields) with unchanged defaults.

### HUD (`app/ui/screens/PlayingHud.tsx`, `app/globals.css`)
- One vitals card (health+armor), grouped action gauges, one contextual
  objective chip, kill feed capped at 4, de-duplicated clock line, control
  hints settle after the opening minute.
- `REDUCED MOTION` chip while that mode is active, plus explanatory copy at the
  Graphics & settings toggle (see F1).

### Deploy fixes (`docs/PHASE2-FIXLIST.md`)
- F1 resolved: reduced motion was ON in the reviewer's browser; semantics kept,
  labelled, and the planted-stride behaviour pinned by a new test.
- F2 fixed: stale third-person gun-anchor pin from phase 1.
- F3 fixed: atrium strata invariant now matches the authored 1.6 m interval.
- F4 open (preview-only absolute favicon CSP). F5 fixed (IR 404).
- F7 fixed: three stale campaign pins (cleared-exit wins, predeployed
  reinforcements).
- F8 fixed: the registry placement sweep ran campaign off-map; it now pairs each
  mission with its own map (41/41).
- F9 fixed: duplicated tunnel solids on four maps (data-level filter) and the
  stale quarter-turn facade-span pins; generator-level follow-up noted.
- F10 fixed: the singleplayer suite hang — the autoplay driver ignored
  `complete.groups`, so predeploy steps never advanced (44/44 in ~3m21s).
- F6: the first full gate ran 1612 game tests with 36 failures, every one
  pre-existing at the deployed phase-1 checkpoint (baseline passes). All are
  fixed; the gate is being rerun for a green record.

## Verification

Focused per workstream (all green after integration):
- `game/textures.test.mjs`, `material-presets`, `moth-surface`, `environment`,
  `sky` — 160 pass plus the two phase-1 failures fixed separately.
- `game/music.test.mjs`, `game/weather.test.mjs` — 29 tests, 28 pass, 1 skipped
  (OfflineAudioContext render, browser-only in Node).
- `game/feedback.test.mjs`, `game/weather.test.mjs` — 50/50.
- `game/view.test.mjs` — 99/99 after F2/F3 fixes; `game/character-anim.test.mjs`
  includes the new reduced-stride pin; HUD/UI contract suites 83/83.
- Preview smoke (built branch, localhost): 10/10 checks — title/setup, bot
  match, campaign entry, HUD; reduced-motion chip verified with an emulated
  reduced profile; no page errors (preview-only favicon CSP warnings noted).
- Map evidence: six before/after sheets in `docs/evidence/phase2/maps/`
  (same seed/resolution/quality as the committed phase-1 atlas); geometry
  unchanged, tiling repetition visibly reduced.
- Audio evidence: offline renders of the halo soundtrack for
  menu/explore/combat with non-zero RMS in every second, peaks ≤ 0.51; six
  second excerpts in `docs/evidence/phase2/audio/`.
- Full suite: `npm test` green on this branch (all stages exit 0). The first run
  exposed 36 pre-existing phase-1 failures, all fixed (F7–F10 plus F2/F3).

## Deployment

- `npm run deploy` (web-only) succeeded: build + restart + `verify:deployment`
  against `https://arena.ussyco.de` (12 linked assets, 200s).
- Live asset hashes match this checkout's `dist/` byte-for-byte for the entry
  JS, page chunk and CSS.
- Live browser smoke: **13/13 checks, 0 console errors, 0 page errors** — title,
  match setup, playable bot match with HUD, campaign entry (convoy-run), and a
  network match hosted through `wss://arena.ussyco.de/ws`; the cavern IR now
  serves 200 so the long-standing 404 is gone.
- Web service restarted at 06:18:06 UTC; game server untouched (`04:12:11`),
  so multiplayer sessions were preserved.

## Not verified / limitations

- SwiftShader software capture only: no hardware FPS, no GPU shader-compile
  smoke for the new macro/fracture injection, no headphone/mix review.
- Material bake cost ~28–35 ms/kind (~0.4 s per arena) — watch load timing.
- Normal maps now carry real relief; `normalScale` was raised to 0.6 and may
  need taste review on hardware.
- Phase-1 open items carried forward: ground-level visual/play review, campaign
  combat pacing, close character motion, causeways are ground ramps not bridges.
- Preview-only favicon CSP noise (F4).
