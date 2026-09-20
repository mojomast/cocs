# COCS verification report

## Release 8.6 - PRISM

**Production deployment (2026-09-20).** Commit `f030685` was fast-forwarded to
`improvement/phase2-audio-visual` (pushed to origin) and deployed to
<https://arena.ussyco.de> with a web-only `npm run deploy`; no game-server code
changed, so the game server was not restarted and connected clients were not
disconnected. The first attempt failed the HTML gate with a transient
`502`/stale-footer window during the restart and rolled back to the previous
web bundle automatically; a retry deployed cleanly. The deploy gate then
verified the served footer `v8.6 · PRISM`, all 13 linked stylesheet/script
assets returning 200, and the compatible identity pair: web `f030685`
`v8.6-f030685`, game server `b9c7a0a` `v8.5-b9c7a0a`, protocol 3.
`https://arena.ussyco.de/api/version` reports the same web identity, and the
public document carries the exact `v8.6 · PRISM` footer. The tracked browser
matrix re-ran against production at **5/5 viewports** with a clean tree
(`commitDirty:false`), zero console/page errors, and the same hit-testing,
reticle-corridor and overflow assertions as the local run.

**Production update — Moth material pack (2026-09-20).** Commit `4375be4` was
fast-forwarded to `improvement/phase2-audio-visual` and deployed web-only to the
same URL. The verification gate again saw one transient `502`/stale-footer
attempt during the restart and passed on the retry, publishing footer
`v8.6 · PRISM`, all 13 linked assets, and the compatible identity pair (web
`4375be4` `v8.6-4375be4`, game server `b9c7a0a` `v8.5-b9c7a0a`, protocol 3).
The new raw assets (`sky-ember`, `tex-metal-oxide`, the `qrc-glyphs` GIF and the
`entanglement-void` archive) and the `/moth` gallery all return 200. The tracked
browser matrix re-ran against production at **5/5 viewports** with a clean tree
(`commitDirty:false`), zero console/page errors, and the usual hit-testing,
reticle-corridor and overflow assertions. No game-server restart.

**Production update — per-target stacks and the graphics-edge pass (2026-09-20).**
Commit `9928d2b` was fast-forwarded to `improvement/phase2-audio-visual` and
deployed web-only. The verification gate again saw one transient `502` during
the restart and passed on the retry: footer `v8.6 · PRISM`, all 13 linked
assets, and the compatible identity pair (web `9928d2b` `v8.6-9928d2b`, game
server `b9c7a0a` `v8.5-b9c7a0a`, protocol 3). The tracked browser matrix re-ran
against production at **5/5 viewports** with a clean tree
(`commitDirty:false`), zero console/page errors, and the usual hit-testing,
reticle-corridor and overflow assertions. No game-server restart.

**Scope (web presentation, data and documentation, 2026-09-20).** An opt-in
developer graphics preview, a global hotkey, a randomizer and a clipboard recipe
loop, 23 stackable effects (three built from baked Moth assets with selectable
sources), eleven starting recipes, per-target WORLD / WEAPON / BOTS stacks with
depth-tested bot compositing and an isolated weapon pass, a research-backed
finish pass (static dithering for 8-bit banding, contrast-adaptive sharpening,
tier-scaled environment reflections), and an animation pass that restores death
variety (direction topple, per-pose arcs, seeded silhouettes, style treatments)
alongside strength-scaled hit flinches, a melee swing, shell casings,
style-aware death audio and gated UI motion. This sits on top of a paid 15-job
Moth batch and the material variety that consumes it: nine masked surface
variants, two reflectance LUTs, an ember sky, two quantum scalar fields and a
16-frame QRC glyph animation, wired into surface variants, arena skies/LUTs and
the lab. No simulation, server, protocol or dependency change; the game server
does not need a restart. Default rendering is unchanged: the lab is off until a
player enables it, post-processing remains opt-in, and target stacks allocate
nothing until enabled.

- `docs/GRAPHICS-LAB.md` — hotkeys, controls, render contract and limitations.
- `docs/design/GRAPHICS-EDGE-PLAN.md` — the graphics-edge research notes,
  audit, applied finish pass and the techniques deliberately rejected.
- `docs/MOTH.md` — implemented material slices, the paid batch and module map.
- `docs/design/MOTH-GRAPHICS-PLAN.md` — Moth API/mothbake audit and the
  material-variety roadmap, annotated with what is implemented.
- Upstream `mothbake` commit `a35a2e67` — merge-safe, atomic and validated
  publication with `merge: true` emitters, download validation, docs, an example
  and 180 passing offline tests.

**Automated release gate (2026-09-20).**

- `npm test`: pass. Game tests: 2,693 pass, 8 approved skips, 0 fail (2,701
  tests); server tests: 209 pass, 0 fail; TypeScript: pass; verified production
  build: pass; SSR/UI and deployment-contract tests: 90 pass, 0 fail.
- Moth-focused suites are part of that run: bake-runner integrity
  (`moth-bake-run.test.mjs`), GIF decode / grid-texture / GIF-frame bakers and
  generated sources (`moth-bake-pixels.test.mjs`), variant generation and mixed
  generated+baked selection (`moth-variants.test.mjs`), texture variant
  consumption and sampling (`moth-texture-variants.test.mjs`), and the
  structure-preserving surface policy (`moth-surface.test.mjs`). The eager
  `game/moth-baked.mjs` budget test now allows the paid batch's ~1.7 MB under a
  documented 2 MiB cap.
- Paid Moth batch record: 15 manifest jobs accepted; one LUT job exceeded the
  21-qubit budget and the QRC job was rejected for a too-short training
  sequence, both corrected and retried with `--force` (the hardened runner
  refused to resubmit silently and left the published registry unchanged each
  time). Every new record decodes through the runtime accessors, provenance grew
  80→95 jobs, and the merge preserved every prior key. Total spend: 25 credits.
- `npm run lint`: 0 errors; warning-level findings only.
- `npm run test:graphics-lab` (against the running dev preview): **pass**. The
  harness executes the real `GraphicsLabPass` on a headless WebGL renderer with
  a deterministic color/checker input and proves every catalogue layer (23,
  including the three built from baked Moth assets with every non-default asset
  option) and every starting recipe (11) and the full stack change pixels;
  zero-mix and the original half of split mode match the untouched image
  exactly; and all combinations reuse one shader program. It then drives the
  real UI: recipe loading, the randomizer, layer stacking, A/B bypass, split
  comparison, clipboard copy, JSON apply, the backquote toggles, reset, drawer
  geometry at 1366×768, 1920×1080, 844×390, 390×844 and 844×390 at UI scale
  1.4, device-local persistence across reload, and opening the lab from a paused
  match as the single `aria-modal` dialog without losing the pause state.
  Recorded deltas are in `artifacts/graphics-lab/verification.json` (gitignored).
- `npm run test:browser` (against the running app): **5/5 viewports pass** at
  1366×768, 1920×1080, 844×390, 390×844 and 844×390 at UI scale 1.4, with hit
  testing, reticle-corridor checks, overflow checks and console/page-error
  assertions.

**Boundary.** The graphics-lab harness proves shader execution, pixel change
and UI behavior in headless Chromium (SwiftShader). It does not prove frame
rate, artistic quality, colour accuracy on real panels, or physical-device
behaviour. The Moth material slice is limited to the four offline variant
families, structure-preserving wear and sampling; per-biome families, decals,
higher-resolution/URL-backed textures and the new-bake coating/flow experiments
remain proposals in the plan, and no new paid Moth run was submitted.

## Release 8.5 - HANDOFF

**Production deployment (2026-09-20).** Commit `b9c7a0a` was fast-forwarded to
`improvement/phase2-audio-visual` (pushed to origin) and deployed to
<https://arena.ussyco.de> with
`PREVIOUS_SERVER_COMMIT=1d292fb npm run deploy -- --with-game-server`. This is
the first identified deploy: both services reported `release v8.5`,
`codename HANDOFF`, `commit b9c7a0a`, `buildId v8.5-b9c7a0a`, `protocol 3`;
the deploy gate verified exact web/server identities after restart. The public
verifier returned 200 for the strict title footer and all 13 linked assets;
`wss://arena.ussyco.de/ws` accepted a connection; the tracked browser matrix
re-ran against production at 5/5 viewports with zero console/page errors.
The deploy recorded `1d292fb` as the rollback target and the rollback path is
web+server with an announced reconnect, not zero-downtime.

**Scope.** The post-v8.4 reliability implementation on `feat/fieldwork-plan`:
round-scoped idempotent COCS actions and honest outcome feedback, identified
web/server builds with paired rollback, production-backed route guidance,
authored Operations fronts, a complete personal REQ purchase loop, touch and
keyboard reachability fixes, binding-complete prompts, viewer-scoped results,
one modal stack, event-gated assistive announcements, versioned title-first
onboarding, a protected completion-safe training scenario, a governed playtest
worksheet and an optional device-local study recorder. No balance was tuned.

**Automated release gate (2026-09-20).**

- `npm test`: pass on the integrated tree. Game tests: 2,571 pass, 8 approved
  skips, 0 fail; server tests: 209 pass, 0 fail; TypeScript: pass; verified
  production build: pass; SSR/UI and deployment-contract tests: 82 pass, 0 fail.
- `npm run test:browser` against the running app: **5/5 viewports pass** at
  1366×768, 1920×1080, 844×390, 390×844 and 844×390 at UI scale 1.4, including
  hit testing, reticle-corridor containment, overflow and console/page-error
  assertions. The first candidate run failed 5/5 with a real post-match crash
  (`studyOutcomes(r.match.events)` after the match cleared); the guard fix was
  re-verified with the same harness and the contract layer.
- The frame-loop guard fix was re-verified with `npx tsc --noEmit`,
  `node --test tests/*.test.mjs` (82/82) and the full browser matrix; the
  simulation, game modules and server were untouched by that fix.
- `npm run lint`: 0 errors at the unchanged warning baseline.

**Human and device evidence boundary.** NVDA/VoiceOver listening, physical
iOS/Android multi-touch, hardware pointer lock and the five-first-time / two-
experienced participant protocol remain manual gates. The governed worksheet is
[`reports/playtest-v8.4-template.md`](../reports/playtest-v8.4-template.md);
use it with the release-of-record build identity. No balance or fun claim is
authorized by automated evidence.

## Release 8.4 - FIELDCRAFT

**Scope.** The fieldwork implementation on `feat/fieldwork-plan` adds public
dominance/Operations outcome state, relevant prioritized objective feedback, one
navigation-backed target model, passive standings and death summaries,
effective-rules launch previews, objective-first short-screen HUDs, remapped and
touch task controls, contribution/reward explanations and focused next-match
actions. Public snapshot fields are additive and backward-tolerant;
`PROTOCOL_VERSION` is unchanged. The game-server process still requires a
restart because its imported authoritative simulation and visibility behavior
changed.

**Automated release gate (2026-09-20).**

- `npm test`: pass. Game tests: 2,507 pass, 8 skipped, 0 fail; server tests:
  192 pass, 0 fail; TypeScript: pass; verified production build: pass; SSR/UI and
  deployment-contract tests: 31 pass, 0 fail.
- Focused release rerun: 43 changelog, spend/board, cursor/input and results SSR
  tests pass; `npx tsc --noEmit --pretty false` and `git diff --check` pass.
- `npm run lint`: 0 errors. The repository retains 604 pre-existing warning-level
  findings; the release-critical React-hook errors found in the spend panel were
  fixed rather than waived.
- The integrated diff adds no `Math.random`, `Date.now` or `performance.now` use
  to deterministic simulation code and adds no project dependency or asset.

**Browser/device smoke (ephemeral).** A temporary Playwright Chromium 140
install outside the repository exercised a fresh profile, Operations
briefing/deploy and live LATTICE combat at 1366×768, 1920×1080, 844×390 touch,
390×844 touch and the 844×390 UI-scale-1.4 stress case. Captures cover
effective-rule setup copy, objective/command/Director hierarchy, touch
movement/actions and contextual interaction. Measured bounding boxes confirm
that the final HUD leaves the reticle clear and keeps objective, HQ/wave truth,
vitals, interaction and touch actions in the viewport. The pass found and fixed
short-landscape objective and portrait panel/chip overlap. Generated map-plan
coordinates are quantized so the local SSR/client pass no longer emits React
hydration mismatch warnings. The localhost-only absolute favicon CSP warning
does not occur on the canonical same-origin production host. This was a one-off
local run: the runner and captures live outside the repository, no trace or
screenshot manifest is committed and there is no CI artifact or pinned browser
matrix, so it is a smoke observation rather than a reproducible browser gate.
WP1.1's tracked runner and artifact manifest remain required before this release
can claim browser/input coverage.

**Human evidence boundary.** The five first-time participants, two experienced
comparison players, real-touch participant and remapped-keyboard participant
required by F10 were not available in this coding environment. Automated checks
are not relabelled as human fun evidence. The raw-observation worksheet is
[`reports/playtest-v8.4-template.md`](../reports/playtest-v8.4-template.md).
No combat, weapon, reward, roster-pressure or D1-D4 Director balance change was
made; D2-D4 measurement remains deferred. Complete that protocol before using
this release as evidence for tuning.

**Production deployment.** The recorded deploy commit `1d292fb` was
fast-forwarded to `improvement/phase2-audio-visual` and deployed to
<https://arena.ussyco.de> with `npm run deploy -- --with-game-server` on
2026-09-20. Both user services reported active. The public deployment verifier
returned 200 with correct content types for the document and all 13 linked
CSS/JavaScript assets; `/api/version` returned `v8.4`; rendered HTML contained
the exact title footer `v8.4 · FIELDCRAFT`; `wss://arena.ussyco.de/ws` accepted a
connection; and a fresh headless Chromium production load emitted no console or
page errors. These checks are connectivity and release-label evidence: the host
serves a v8.4-labelled document with live assets and accepts a WebSocket
connection. They are not deployed-commit proof — `/api/version` exposes only a
release string, so the served commit SHA and any web/server build pairing cannot
be independently verified from the public endpoint. The deploy record above is
local evidence, not a remote attestation.

## Release 7.2 - ECHO (the Moth audio assets wired into the game)

**Scope.** The Moth-audio wiring on `feat/moth-audio-wiring` (tip `4b9862b`),
merged **fast-forward** into the production line
(`improvement/phase2-audio-visual`, previously `86822be` = v7.1). Presentation
and audio only: `game/core.mjs`, `game/protocol.mjs` and `server/**` are
untouched, so this is a **web-only** deploy and connected multiplayer clients
are not disconnected. The feature work arrived with the fast-forward merge; the
only production-side code change in the release commit is the version footer
and digest.

- **Lazy mount (`4b9862b`, `app/page.tsx`):** `SynthAudio` gains
  `setMothAudioFactory`/`setMothEnabled` and builds the layer in `_ensureBuses`
  once the real context and its `ambience`/`effects` buses exist. The page
  registers a factory that returns `null` without a usable `AudioContext`,
  `decodeAudioData` or `fetch`, so nothing fetches or decodes before the first
  user gesture and the layer stays inert in Node. `dispose()` releases and
  disables it.
- **`bed-ritual` ambience:** the 10.68 s baked clip plays on the ambience bus
  at layer gain `0.4` - chosen against the raw clip's `-12.46 dBFS` peak - and
  is routed to `menu`/`explore`/`results` while `combat` is deliberately left
  to the score and SFX.
- **Outcome motifs:** `SynthAudio.setOutcome` selects `moth-victory`/
  `moth-defeat` from `moth-assets` and hands it to `MusicEngine.setMotif`; the
  results arrangement opts in with `leadMotif` and keeps `COCS_MOTIF` as the
  static fallback. The real path is the victory/defeat sting, which routes
  through `setOutcome`.
- **Echo map:** `SynthAudio.setEchoMap(name)` re-tunes the shared effects
  delay/feedback/wet send from the baked `spaces.arena` map (`count: 153`,
  `taps: 128`, `depth: 8`); `mothEchoFor(arenaId)` defaults every arena to it
  and `view` applies it beside `setSpace` in `setAudio` and `_buildArena`. The
  map is remembered before the buses exist and applied in `_ensureBuses`.
- **Six spaces reachable:** `mothSpaceFor` routes `neon-vertical`, `aether` and
  `ironfall-megastructure` to `void`, so open-air, tunnel, hall, cathedral,
  cavern and void are each selected by some arena.
- **Silent-safe / reduced motion:** `MothAudio` gains
  `setEnabled`/`setReducedMotion`, which stop every live bed and tear down the
  owned space graph; reduced motion always wins and the host toggle forwards
  through `SynthAudio.setMothEnabled`. `audioStatus()` adds `echo` beside
  `space`/`moth`/`samples`.
- **Gate (full merged-tree run in `/home/mojo/projects/tokenarena-w15`):**
  `npm run test:game` **2018 tests: 2011 pass, 0 fail, 7 skipped** across 182
  `game/*.test.mjs` files (553 s); `npm run test:server` **159/159**;
  `node --test tests/*.test.mjs` **7/7**; `npx tsc --noEmit` clean;
  `npm run lint` 0 errors (488 warnings); bounded `vinext build` green. The 7
  skips are the same opt-in long simulations plus the browser-only
  `OfflineAudioContext` render. New coverage lands in
  `game/moth-audio-wiring.test.mjs` (deferred factory mount/dispose, scene
  routing, outcome motif selection, echo-map selection, reduced motion and the
  no-context path) and extends `game/moth-wiring.test.mjs` with the per-arena
  echo map.
- **Production targeted gate:** `game/changelog.test.mjs` **3/3**,
  `npm run test:server` **159/159**, `npx tsc --noEmit` clean and
  `npm run lint` 0 errors (488 warnings) in `/home/mojo/projects/tokenarena`.
- **Deploy:** `npm run deploy` (**web-only**) rebuilt the working tree (with the
  v7.2 bump uncommitted) and restarted `token-arena-web.service` only -
  `ActiveEnterTimestamp` `Fri 2026-09-18 15:49:10 UTC`.
  `token-arena-server.service` stayed active on its v7.0 start
  (`Thu 2026-09-17 23:50:18 UTC`) because no `server/`, `core.mjs` or
  `protocol.mjs` file changed, so connected multiplayer clients were not
  disconnected. As in v7.0/v7.1 the first HTML fetch during the restart returned
  a transient 502 and `scripts/deploy.sh` retried to success.
  `npm run verify:deployment` verified the served HTML (footer `v7.2 · ECHO`)
  and its 12 linked CSS/JS assets, and `GET /api/version` returns
  `{"version":"v7.2"}`.
- **Live deploy smoke (production `arena.ussyco.de`, after the deploy):** a
  bounded headless Chromium/SwiftShader run (`/tmp/opencode/live-smoke-v72.cjs`,
  adapted from the v7.1 script, exit 0, JSON in
  `/tmp/opencode/release-v72-smoke.json`) - footer `v7.2 · ECHO`;
  `GET /api/version` 200 `{"version":"v7.2"}`; the attract reel rendered a
  planned shot (subject `ChatGPT`, reason `zone alpha capturing`); the
  selection screen showed the v7.0 wing chip (`TACTICIAN`); ENTER ARENA started
  a 3-actor bot match (`mode: playing`, match clock advancing 0.433 -> 1.133 s).
  **Asset checks:** `GET /music/manifest.json` 200 `application/json` with
  **172 samples**, `GET /music/samples/bells-glock-g4-p.ogg` 200 (36,211 bytes,
  `OggS`), `GET /moth/files/bed-ritual/clip.wav` 200 (471,032 bytes, `RIFF`)
  and `GET /moth/files/ir-void/result.wav` 200 (441,044 bytes, `RIFF`). Zero
  console errors and zero page errors across the whole run. The live
  `window.tokenArenaAudio()` after the first gesture reported `echo: "arena"`,
  `space: "hall"` and `moth.active: true` (scene `game`, bank active), with
  `samples.loaded` 172/172 - the deferred factory mounted and the echo map was
  applied in production. Screenshots: `/tmp/opencode/release-v72-smoke.png`
  (title + footer), `/tmp/opencode/release-v72-smoke-selection.png` and
  `/tmp/opencode/release-v72-smoke-match.png`. The `fps` figure is SwiftShader,
  not hardware-GPU evidence.
- **Rollback point:** `86822be` (v7.1 · CHORUS), the last production commit
  before the fast-forward merge; `scripts/deploy.sh` additionally restores the
  previous `dist/` and restarts the web service automatically if a deploy step
  fails.
- **Limitations (honest scope):** the live smoke is a SwiftShader/CPU render,
  not hardware-GPU or frame-rate evidence. Browser audio was not auditioned in
  CI: this Node environment has no `OfflineAudioContext`, so loudness, stereo
  image and the transition feel remain a manual listening pass (see the
  checklist below). Decode on real hardware is best-effort and falls back
  cleanly; the Moth layer is inert without an `AudioContext` by design; and the
  published assets are committed offline bakes (no runtime API, no key, no
  network fetch).
- **Human listening check:** with sound on and reduced motion off, (1) the
  menu, explore and results screens sit on a low ritual ambience bed that stops
  in combat; (2) winning and losing the results lead now resolve on different
  baked motifs (a Picardy-style win, a darker defeat) instead of the same COCS
  line, with the built-in line as the fallback if the motif is missing; (3)
  gunfire and explosions in an arena carry a slightly longer, tap-driven tail;
  and (4) the neon/void theatres audition the long `void` reverb rather than
  the default open-air tail. A user gesture is still required before any of
  this starts.

## Release 7.1 - CHORUS (the soundtrack overhaul, Moth pass 3 and the Moth audio pipeline)

**Scope.** The music overhaul, Moth pass 3 and the Moth audio pipeline on
`feat/v71-chorus` (tip `185ab8f`), merged **fast-forward** into the production
line (`improvement/phase2-audio-visual`, previously `636f609` = v7.0).
Presentation and audio only: `game/core.mjs`, `game/protocol.mjs` and
`server/**` are untouched, so this is a **web-only** deploy and connected
multiplayer clients are not disconnected. The only production-side code change
in the release commit is the version footer and digest; the feature work arrived
with the fast-forward merge.

- **Composition (`8229f89`):** `game/music.mjs` gains a per-bar chord-quality
  table and functional eight-bar progressions in D natural minor for
  menu/explore/combat/results (i-VI-III-VII, i-VI-iv-v, borrowed major V,
  Picardy I), a recurring COCS leitmotif developed per scene (augmented
  statement, +2 sequence in bars 5-8, combat inversion, staccato diminution as
  the low-string ostinato, Picardy results, bell fragment `[1,2,0,0]` at every
  eight-bar turn), a shared 32-bar form with fills at 4/8/16/24/28/32 and a
  four-bar bpm ramp. The transport no longer resets on
  `setScene`/`setSoundtrack`, registers rise into the samples' natural range,
  combat plays sampled strings, and `maxVoices` moves 26 -> 44 with a separate
  sustained-voice budget. The mix adds a `musicBus`, a -10 dB / 4:1 / +6 dB
  limiter with a tanh ceiling, orchestral seating pans and a retuned reverb
  send (wet 0.30, 250 Hz high-pass, 30 ms pre-delay). `setOutcome` gives the
  results screen its own arrangement.
- **Sampled orchestra (`662eab5`, `92f5fd0`, `9fa5231`):** 172 CC0 samples
  (9.55 MiB, mono 44.1 kHz) baked from VSCO 2 CE and VCSL by
  `scripts/music-bake.mjs` and served same-origin from `/music/*`. New
  `game/sampler.mjs` is a lazy `SampleBank` that decodes Ogg (AAC `.m4a`
  fallback) without blocking the scheduler; selection is seeded (nearest midi,
  preferred velocity layer, same-pitch round-robin) and folded into
  `scheduleChecksum`, and an undecoded or failed buffer falls back to the
  oscillator voice, so Node tests and blocked autoplay stay inert. Instrument
  ids: strings-pad, low-strings-stacc, low-brass, brass-stacc, trumpet-pad,
  timpani, timpani-roll, bells, tubular-bells, gong, cymbal-swell,
  cymbal-crash, harp and taiko. No choir is baked (no CC0 source exists), so
  the formant-synth fallback remains.
- **Moth pass 3 (`f44c778`, merged `349a1b4`):** six new generated effect
  sequences - bloom (explosions), vortex (teleports), contract (capture rings),
  rise (heals and support pickups), shield (shield breaks, walls and
  overshields) and snow (weather drift), 18 jobs at three frames each - wired
  through `_mothFx` with fallback to arc-burst/spark-impact. Four new
  `retrocausal-echo-v1` spaces join cavern and void: open-air (short early
  reflections), tunnel (chain slapback), hall (medium square diffusion) and
  cathedral (long 7 s build). `mothSpaceFor(arenaId)` picks one per arena and
  `SynthAudio.setSpace(name)` swaps it on `setAudio` and every arena build,
  defaulting to open-air with a cavern fallback.
- **Moth audio (`339e731`, `8cb8ff0`, `a8f41d3`, `a4333aa`, merged
  `a134f68`):** `scripts/moth-bake.mjs` gains a dependency-free WAV codec, the
  `audio-clip` and `echo-map` bakers, `makeSourceAudio` and `audio`/`spaces`
  buckets; the `ir` baker now extracts taps recursively (`extras.taps`,
  `extras.tap_map.taps`, `data.extras.taps`), fixing the long-empty
  `irs.cavern.taps`. New `game/moth-audio.mjs` holds a lazy `MothAudioBank`
  (fetch/decode cache, budget eviction, loop windows) and a `MothAudio` layer
  for beds, spaces and stingers (at most three concurrent beds, fixed scene
  routing), inert without an `AudioContext`, before decode or under reduced
  motion; `SynthAudio` forwards through guarded hooks. First bakes: the 5 s
  `void` IR (64-tap map), the `arena` echo map (153 taps, 128 kept), the
  `bed-ritual` ambience clip (10.68 s) and the `moth-victory`/`moth-defeat`
  motifs. The offline `repair` command rebuilds descriptors from committed raw
  results with no API call or credits (the only spend was 13 credits across the
  audio batches, with one rejected 422 re-parameterised rather than resubmitted).
- **Consolidation (`185ab8f`):** one record per real space (`cavern`,
  `open-air`, `tunnel`, `hall`, `cathedral`, `void`); `ir-openair` is deleted as
  a byte-identical duplicate of `ir-open-air` and must not be re-added; the
  surviving `ir-tunnel` is the audio branch's 3.5 s corridor response.
  `scripts/merge-baked-variants.mjs` unions the pass-3 and audio baked modules
  offline and the manifest settles at 80 jobs.
- **Gate (full merged-tree run in `/home/mojo/projects/tokenarena-v71`):**
  `npm run test:game` **2010 tests: 2003 pass, 0 fail, 7 skipped** across 181
  `game/*.test.mjs` files (1135 s); `npm run test:server` **159/159**;
  `node --test tests/*.test.mjs` **7/7**; `npx tsc --noEmit` clean;
  `npm run lint` 0 errors (487 warnings); bounded `vinext build` green. The 7
  skips are the same opt-in long simulations plus the browser-only
  `OfflineAudioContext` render. New coverage lands in `game/sampler.test.mjs`,
  `game/music-arrangement.test.mjs`, `game/moth-audio.test.mjs`,
  `game/moth-bake-audio.test.mjs`, `game/moth-bake-generators.test.mjs` and
  extended `music`/`feedback`/`moth-assets`/`moth-wiring` suites.
- **Production targeted gate:** `game/changelog.test.mjs` **3/3**,
  `npm run test:server` **159/159**, `npx tsc --noEmit` clean and
  `npm run lint` 0 errors (487 warnings) in `/home/mojo/projects/tokenarena`.
- **Deploy:** `npm run deploy` (**web-only**) rebuilt the working tree (with the
  v7.1 bump uncommitted) and restarted `token-arena-web.service` only -
  `ActiveEnterTimestamp` `Fri 2026-09-18 02:17:13 UTC`. `token-arena-server.service`
  stayed active on its v7.0 start (`Thu 2026-09-17 23:50:18 UTC`) because no
  `server/`, `core.mjs` or `protocol.mjs` file changed, so connected
  multiplayer clients were not disconnected. `npm run verify:deployment --
  https://arena.ussyco.de` verified the served HTML (footer
  `v7.1 · CHORUS`) and its 12 linked CSS/JS assets, and `GET /api/version`
  returns `{"version":"v7.1"}`. As in v7.0 the first HTML fetch during the
  restart returned a transient 502 and `scripts/deploy.sh` retried to success.
- **Live deploy smoke (production `arena.ussyco.de`, after the deploy):** a
  bounded headless Chromium/SwiftShader run (`/tmp/opencode/live-smoke-v71.cjs`,
  adapted from the v7.0 script, exit 0, JSON in
  `/tmp/opencode/release-v71-smoke.json`) - footer `v7.1 · CHORUS`;
  `GET /api/version` 200 `{"version":"v7.1"}`; the attract reel rendered a
  planned shot (subject `Kimi`, reason `explosion`, shot start fixed across
  four samples); the selection screen showed the v7.0 wing chip (`TACTICIAN`);
  ENTER ARENA started a 3-actor bot match (`mode: playing`, match clock
  advancing 0.167 -> 0.250 s). **Asset checks:** `GET /music/manifest.json`
  200 `application/json` with **172 samples**, `GET
  /music/samples/bells-glock-g4-p.ogg` 200 (36,211 bytes, `OggS`), and `GET
  /moth/files/ir-tunnel/result.wav` 200 (308,744 bytes, `RIFF`). Zero console
  errors and zero page errors across the whole run. Screenshots:
  `/tmp/opencode/release-v71-smoke.png` (title + footer),
  `/tmp/opencode/release-v71-smoke-selection.png` (class identity) and
  `/tmp/opencode/release-v71-smoke-match.png` (bot match). The `fps` figure is
  SwiftShader, not hardware-GPU evidence.
- **Rollback point:** `636f609` (v7.0 · DOCTRINE), the last production commit
  before the fast-forward merge; `scripts/deploy.sh` additionally restores the
  previous `dist/` and restarts the web service automatically if a deploy step
  fails.
- **Limitations (honest scope):** the live smoke is a SwiftShader/CPU render,
  not hardware-GPU or frame-rate evidence. Browser audio was not auditioned in
  CI: this Node environment has no `OfflineAudioContext`, so the real-render
  test skips as before and loudness, stereo image and transition feel remain a
  manual listening pass. Sampled routing is deterministic and unit-verified,
  but decode on real hardware is best-effort and falls back cleanly. Moth audio
  stays inert without an `AudioContext` by design. The published Moth assets
  are committed offline bakes (no runtime API, no key, no network fetch).

## Release 7.0 - DOCTRINE (the class/harness overhaul and the Phase-5 balance gate)

**Scope.** The class/harness overhaul (Phases 1-4) and the Phase-5 balance
sweep on `feat/class-overhaul` (24 commits, tip `0facf42`), merged **fast-forward**
into the production line (`improvement/phase2-audio-visual`, previously
`f95ee2e` = v6.6). Unlike v6.6, this release changes the simulation, the wire
protocol and the server (`game/core.mjs`, `game/protocol.mjs`, `server/room.mjs`,
`server/game-server.mjs`), so the deploy restarts the authoritative game server
and multiplayer clients briefly disconnect.

- **Phase 3A - structured riders + passives (`11ecd2f`):** the 21 rider strings
  become inert `{wing, id, trigger, description, effects[]}` descriptors keyed
  striker/vanguard/tactician per spec, using the shared `SPEC_TRIGGERS` /
  `SPEC_EFFECT_TYPES` / `SPEC_EFFECT_TARGETS` vocabularies; the seven behavioural
  spec passives are declared beside their tradeoff copy; `resolveKit` resolves
  gear through `progression.mjs` `resolveGear`, snapshots and deep-freezes it,
  accepts an already-resolved record and extends the fingerprint with sorted gear
  item ids. `wing-riders.test.mjs` pins 21 riders, 63 combos, deep freeze, the
  unlabelled-percentage scan and the 7 passive shapes.
- **Phase 3B - passives and riders go live (`fcaded7`, `e700328`):** the hidden
  `passive:{speed,damage,resistance}` table is removed from
  `harness-profiles.mjs` and every engine read. The seven passives resolve
  through the new id-free `game/spec-effects.mjs` (Grip melee arc, Express
  running reload, Multiplex swap reload, Linted threat ping, Green Build reload
  x0.85, Off-road air control and slide, Flood Fill radius/damage); all 21
  riders dispatch only on `description.trigger` then effect `type`/`target`
  (a source-scan test enforces no harness/operator id in effect logic) and every
  numeric shaper clamps through `EFFECT_BOUNDS`.
- **Phase 3C - asymmetric gear (`89f2b06`):** the eight GEAR items declare
  `powerAxis`/`costAxis`/`budget`; scope, heavy-barrel and servo become distinct
  builds; `resolveGear` keeps its export name and output keys, then enforces the
  §4.8 envelope once for every caller (damage <=1.15x, speed <=1.10x,
  spread/handling within [0.85x, 1.11x], pooled health+armour <= +15 points) and
  returns a frozen result. `gear-dominance.test.mjs` pins axes, slot budget
  parity, pairwise non-dominance and the >=60% cost floor.
- **Phase 3D - sweep CLI (`3325519`, `9ae6208`):** `scripts/balance-sweep.mjs`
  runs the policy-neutral sweep (balance gate) then the policy-on sweep (class
  expression), writes `reports/balance-<release>.json`, supports one-match
  replay, `--print-tierlist` and `--budget-ms`, and `Match` gains the
  `botLoadouts`/`aiSeats`/`botPolicy` harness options (net/server never set
  them). `game/archive/balance-sweep.test.mjs` is the opt-in hook.
- **Phase 4-1 - mobility input + HUD (`386c15b`, `59ce158`):** `mobility` binds
  to KeyX, a MOBILITY touch button and the runtime flag, forwarded to the
  server as a **held** state (a one-tick edge would fake a release and cancel an
  active grapple); `PROTOCOL_VERSION` becomes 3 (`SNAPSHOT_DELTA_VERSION` stays
  2) and `MESSAGE.LOADOUT` is declared. `game/hud-class.mjs` mirrors
  `Match.power()`'s guards/cooldown formula (fast powers, Haste
  cooldownMultiplier and the wing-rider bonus) and renders the movement card.
- **Phase 4-2/3/4 - identity, silhouettes, switching (`eff279f`, `0cbafe1`,
  `0823a9a`, `65de90c`):** selection-screen wing/role/signature chips, harness
  tradeoff/movement-hook/wing-rider copy and MODEL/KIT tabs via
  `game/class-ui.mjs`; kill/death attribution in the feed, banner, scoreboard,
  captions and audio; per-wing view silhouettes and the pooled `TelegraphPool`;
  `Match.setLoadout` queues an operator/harness pair consumed on the next spawn
  with `Room.setLoadout` validation/normalisation and the v3 LOADOUT dispatch;
  and the Meta bot now presses Brace Slam from the ground.
- **Phase 4 UI/UX (`64b7ef3`):** the v6.6 audit landed in the global chrome
  (header action labels, demo dock, results box model and dead legacy CSS,
  44 px hit targets, pause quick block with CC/MOTION pills).
- **Phase 5.1 (`7be5f76`):** truncation is refused (one `truncated` warning,
  all sample alarms suppressed, CLI exit 2); FFA placement ties break by damage
  then actor id; `ttk-envelope.test.mjs` pins the §4.5 bands, §4.7 one-shot cap,
  wing ordering and EHP envelope; `route-sweep.test.mjs` is the opt-in all-arena
  sweep; the CLI `--baseline` gear run computes the §4.8.6 invariant; and
  `metrics.modeViability` ships at full sample.
- **Phase 5.2 (`0facf42`):** the §4.7 single-hit cap becomes a roster-wide
  invariant, `clampSingleHit(damage, {targetHealth}) = min(90, 0.9 x full
  health)`, applied at every direct-hit site (`fire`/`detonate`/`pierceAlong`/
  `chainFrom`/`explode`), with `fire()` wrapping Deep Compute's `onShot`. Spawn
  health is re-cut (Mistral 112, Gemini 100, Grok 110, Qwen 108, DeepSeek 126,
  Meta 104, Claude 120) with every speed untouched, and spec uptimes are cut
  (Qwen Tool Use window 3 s, Claude Review hold 1.5 s, Hermes 10 s, Roo 12 s,
  Claude Code Guardrail 10 s). A regression drives a real Match: a Mistral
  charge-coil Shock hit on a full-HP Kimi lands 81 instead of one-shotting.
- **Balance evidence:** `reports/balance-v7-stock.json` and
  `reports/balance-v7-tuned.json` are full 900/900 neutral + policy-on runs with
  0 errors; `reports/balance-v7-max.json` is the max-gear neutral run used for
  the §4.8.6 invariant. Policy-neutral operator win-rate spread falls 18.6 ->
  11.4 points (deepseek 51.1, meta 49.8, kimi 49.5, claude 47.3, chatgpt 45.7,
  grok 43.8, mistral 41.1, gemini 40.9, qwen 39.6); the neutral alarm set falls
  6 -> 1 (Hermes is the remaining garbage row at 33.9, a speed burst that does
  not convert in the weapon-first neutral policy; a measured buff was reverted
  because it reshuffled other rows into fresh alarms); all nine operators clear
  the 45% Wilson floor, roo 40.8 and claudecode 41.3 clear the spec floor, Kimi's
  team-answers needle clears, no god tier (top lower bound 45.6 < 55), EHP span
  1.33, and the gear invariant passes (operators rho 0.9667, shift <=1, gain
  <=2.32 points; specs/wings rho 1.0).
- **Tests (class tree, `0facf42`):** see the gate line below. New coverage
  includes `wing-riders` (21), `spec-passives` (7 positives + negatives + bounds),
  `gear-dominance`, `ttk-envelope`, `route-sweep` (opt-in), `balance-sweep`,
  `movement-input`, `respawn-loadout`, `respawn-ui`, `hud-class`,
  `class-ui`, `class-presentation`, `bot-loadouts` and `attachment-behavior`
  (single-hit clamp).
- **Gate:** `test:game` **1953 tests: 1946 pass, 0 fail, 7 skipped** across 176
  `game/*.test.mjs` files on the `feat/class-overhaul` worktree (726 s); the 7
  skips are the opt-in long simulations and the browser-only
  `OfflineAudioContext` render; `npm run test:server` **159/159**;
  `npx tsc --noEmit` clean; `npm run lint` 0 errors (487 warnings, up from the
  481 baseline). In the production checkout the release re-ran
  `game/changelog.test.mjs` **3/3**, `test:server` **159/159**, `tsc` clean and
  `lint` 0 errors.
- **Deploy:** `npm run deploy -- --with-game-server` rebuilt the working tree (with
  the v7.0 bump uncommitted) and restarted **both** services at the same
  timestamp (2026-09-17 23:50:18 UTC) because `core.mjs`, `game/protocol.mjs` and
  `server/` changed. `token-arena-web.service` and `token-arena-server.service`
  are both active; the game-server health endpoint reports
  `token-arena-game-server` on :4000. `npm run verify:deployment` verified the
  served HTML (footer `v7.0 · DOCTRINE`) and its 12 linked CSS/JS assets, and
  `GET /api/version` returns `{"version":"v7.0"}`. Note the deliberate transient:
  the first HTML fetch during the restart returns 502 until the web service is
  listening again, which is why `scripts/deploy.sh` retries verification.
- **Live deploy smoke (production `arena.ussyco.de`, after the deploy):** a
  bounded headless Chromium/SwiftShader run (`/tmp/opencode/live-smoke.cjs`,
  adapted from the v6.6 script, exit 0, JSON in
  `/tmp/opencode/release-v70-smoke.json`) — footer `v7.0 · DOCTRINE`;
  `GET /api/version` 200 `{"version":"v7.0"}`; the selection screen rendered the
  new wing chip (`TACTICIAN`); ENTER ARENA started a 3-actor bot match
  (`mode: playing`, match clock advancing 0.30 -> 0.95 s) with the movement HUD
  card live (`GRAPPLEREADY`); zero console errors and zero page errors across
  the whole run. Screenshots: `/tmp/opencode/release-v70-smoke.png` (title +
  footer), `/tmp/opencode/release-v70-smoke-selection.png` (class identity) and
  `/tmp/opencode/release-v70-smoke-match.png` (bot match + movement card). The
  3 fps figure is SwiftShader, not hardware-GPU evidence.
- **Rollback point:** `f95ee2e` (v6.6 · BIOME), the last production commit
  before the fast-forward merge; `scripts/deploy.sh` additionally restores the
  previous `dist/` and restarts the services automatically if a deploy step
  fails.
- **Limitations (honest scope):** the live smoke is a SwiftShader/CPU render,
  not hardware-GPU or frame-rate evidence. Bot balance is policy-swept over
  seeded matches, not human-playtested; the neutral policy is weapon-first, so a
  movement-burst spec (Hermes) can underperform there without being weak in
  human play. The §4.5 1.3-1.6 s vanguard suffered-TTK window still needs
  roughly +15% vanguard EHP and was deliberately left alone to avoid a god tier
  and the 1.5x envelope. Rider/passive visuals rest on unit tests and review
  screenshots, not a pixel diff.

## Release 6.6 - BIOME (Moth skies per biome, new surface and effect albedos)

**Scope.** The Moth fidelity pass on `feat/moth-fidelity` (five commits, tip
`a75119b`), merged `--ff-only` into the production line
(`improvement/phase2-audio-visual`, previously `34b2db7` = v6.5). Presentation
only: `server/`, `core.mjs` and `game/protocol.mjs` are untouched, so this is a
web-only deploy (`npm run deploy`, no `--with-game-server`).

- **Skies per theatre (`ee10989`):** `mothSkyTexture('ashen'|'frost'|'void')`
  replaces the addSky gradient material on the existing camera-following dome —
  volcanic maps get ashen, frost maps get frost, the neon/void maps (including
  the Quantum Labyrinth) get void, and every unlisted map keeps its procedural
  sky. Stars, the sun disc, haze, halo and the storm/time-of-day tint survive
  because only the dome's texture changes. The old nebula bake stays unused on
  purpose: as committed it decodes to an all-zero equirect (mean/max 0), so a
  re-run of that job could only reproduce the black dome.
- **Surface coverage (`15dbbae`):** eight new albedos fill canonical kinds that
  had no Moth tile — metal (the default wall/ceiling look), rough_stucco and
  corrugated_metal through blur-v1; metal_grating, diamond_plate, carbon_fiber,
  riveted_armor and industrial_mesh through deep-fryer-v1 — plus nine new normal
  maps (grass, hazard_stripes, hex_paneling, holographic_grid, metal,
  metal_grating, diamond_plate, rough_stucco, corrugated_metal). Baked buckets
  move from 12/4/1/1 to 20 textures / 13 normal maps / 4 skies / 3 effects.
- **Effects (`309a417`, `ad1aa87`):** arc-burst (plasma, 3 frames) and
  spark-impact (ember, 2 frames) drive remote muzzle flashes, bullet and rail
  impacts, explosions, vehicle kills, respawns, flag/zone captures, teleporter
  departures/arrivals, contested payloads and lightning strikes, spawned by a
  new pooled, billboarded, reduce-motion-aware `MothSpritePlayer`. Spawns are
  deterministic and WebGL-only; the rift keeps its bespoke looping player.
- **Landmarks (`ad1aa87`):** entanglement LUTs ride traversal and teleport pads,
  objective beacons, capture rings, the payload halo, flags, pickups and the
  menu rings; volcanic maps use ember, the rest arcane, and the plain
  entanglement bake covers flags and pickups.
- **Surfaces and shapes (`ad1aa87`):** next-gen props and architecture pick up
  rock (rocks, ruins, caverns, tunnels — the tunnel shell now generates
  world-unit UVs), alien_chitin canopies, brushed_metal barrels and goal frames,
  rough_stucco and metal walls, and ice spikes. Race and soccer presentation
  shares the view's surface helper: a grass pitch with mown stripes, a
  caution-striped barrier (world-unit UVs) and brushed-metal goals. Race
  collision blocks stay deliberately untextured.
- **Caching (`309a417`):** effect frames and LUTs are cached per name and
  released exactly once, and every cached Moth texture is tagged
  `userData.mothShared` so `disposeObject` never frees a texture another
  material still samples.
- **Fixture refresh (`a75119b`):** the tunnel shell's new world-unit UVs changed
  the context of an already-integrated hunk in
  `docs/phase1-spatial-integration.patch`; the guard test that re-applies every
  hunk in memory stays green and no renderer behaviour changed.
- **Budget:** 28 emulator credits for the fidelity pass (25 submissions: 22
  green first pass plus 3 re-runs that replaced near-black blur outputs). The
  four wiring commits cost **0 credits** — they reuse the committed bakes.
  Nothing is fetched at runtime and no API key ships.
- **Evidence:** the local review route (`/tmp/opencode/moth-review.cjs`) produced
  overview/spawn screenshots for six maps under `/tmp/opencode/moth-review/`
  (moth-backrooms, ember-caldera, frostline, neon-vertical, puma-pitch,
  exchange). `docs/MOTH.md` documents the pipeline and the in-world wiring; raw
  Moth results are committed under `public/moth/files/<job>/` and the baked
  digest is `game/moth-baked.mjs`; the v6.4 before/after material sheets in
  `docs/evidence/phase2/maps/` remain the material baseline. New coverage:
  `game/moth-sprite.test.mjs` (5 tests) and `game/moth-wiring.test.mjs` (6).
- **Gate (full re-run on the `feat/moth-fidelity` tip):** `test:game` **1833
  tests, 1828 pass, 0 fail, 5 skipped** across 163 `game/*.test.mjs` files.
  In the production checkout: targeted re-run (`changelog`, `moth-sprite`,
  `moth-wiring`, `moth-assets`, `moth-surface`, `moth-material`, `textures`)
  **49/49**; `npm run test:server` **153/153**; `npx tsc --noEmit` clean;
  `npm run lint` 0 errors (481 warnings, the unchanged baseline). The five
  skips are the same opt-in long simulations plus the browser-only
  `OfflineAudioContext` render as v6.5.
- **Deploy:** `npm run deploy` (web-only) rebuilt the working tree (with the
  v6.6 bump uncommitted) and restarted `token-arena-web.service` only — the
  game server was deliberately not restarted because no `server/`, `core.mjs`
  or `protocol.mjs` file changed. `token-arena-web.service` is active with a
  fresh `ActiveEnterTimestamp`; `token-arena-server.service` stayed active on
  its v6.5 start. `npm run verify:deployment -- https://arena.ussyco.de`
  verified the served HTML (footer `v6.6 · BIOME`) and its 12 linked CSS/JS
  assets, and `GET /api/version` returns `{"version":"v6.6"}`.
- **Live deploy smoke (production `arena.ussyco.de`, after the deploy):** a
  bounded headless Chromium/SwiftShader run (`/tmp/opencode/live-smoke.cjs`,
  exit 0, JSON in `/tmp/opencode/release-v66-smoke.json`) — footer
  `v6.6 · BIOME`; `GET /api/version` 200 `{"version":"v6.6"}`; the attract reel
  held one planned shot (`startedAt` fixed across four samples, camera owner
  `auto`, vehicle duel subject); ENTER ARENA started a 3-actor bot match
  (`mode: playing`, match clock advancing); live `/review` captures of one map
  per biome (`frostline`, `ember-caldera`, `neon-vertical`) rendered with a
  SwiftShader `WEBGL_debug_renderer_info` string and no page errors. Zero
  console errors and zero page errors across the whole run. Screenshots:
  `/tmp/opencode/release-v66-smoke.png` (title + footer),
  `/tmp/opencode/release-v66-smoke-match.png` (bot match) and
  `/tmp/opencode/moth-live-{frostline,ember-caldera,neon-vertical}.png`
  (biome skies). The fps figure is SwiftShader, not hardware-GPU evidence.
- **Rollback point:** `34b2db7` (v6.5 · MOMENTUM), the last production commit
  before the merge; `scripts/deploy.sh` additionally restores the previous
  `dist/` and restarts the web service automatically if a deploy step fails.
- **Limitations (honest scope):** the live smoke and review screenshots are
  SwiftShader/CPU renders, not hardware-GPU or frame-rate evidence. The pass is
  visual coverage plus unit tests, so "looks right" still rests on the review
  screenshots rather than a pixel-diff. The nebula bake is deliberately unused,
  and the race collision blocks stay untextured on purpose. Moth assets remain
  offline: no runtime dependency, no API key, no network fetch.

## Release 6.5 - MOMENTUM (class movement and signature verbs, rebuilt attract demo)

**Scope.** Class/harness overhaul Phase 2 on `feat/class-overhaul` (merged at
`81de0ef`) plus the rebuilt attract demo on `demo/showcase`. The integration
gate ran the merged tree after `Merge feat/class-overhaul`; task C of the
release then brought the v6.4 release commit into the integration line so the
digest stays continuous.

- **Class Phase 2 — movement:** `game/movement.mjs` is a pure, engine-free
  state machine over the nine `MOVEMENT_VERBS` in `game/kits.mjs`: charge/fuel/
  impulse/wind-up/cooldown/landing budgets, the five spec hooks (economy,
  chaining, usage, landing-self, landing-control), the mode rules (race/soccer
  disabled; Instagib/Rocket Arena/Full Arsenal weakened) and one shared carrier
  rule (flag carriers drop the verb, Qwen/Hermes weaken it, the VIP loses it and
  its harness active, the Juggernaut keeps it with lift ×0.7 and a frozen
  shield while airborne). Deterministic translation probes (0.12 m steps, 0.25 s
  step cap) and a documented snapshot field list
  (`movementSnapshot`/`applyMovementSnapshot`) keep it replay- and net-safe.
- **Class Phase 2 — signature verbs:** `game/operator-verbs.mjs` implements all
  nine kits (Effortless, Revision, Heat, Deep Compute, Braced, Alignment Review,
  Adaptive, Long Context, Tool Use) with their numbers as exported constants and
  the core call sites documented per verb. `core.mjs` ticks verb state after
  controls resolve, routes `power()` on `ability.kind`, refreshes the carrier
  rule at spawn/flag/vehicle/Juggernaut boundaries, and never grants class kits
  to NPCs.
- **Class Phase 2 — bots and net:** each kit's `bot.mobility` policy (engage,
  escape, hold, route, reposition) drives bot spending. The actor snapshot
  carries `movement`/`verbState`; a resync heals the live state object; the
  prediction shadow builds the real loadout (`NetClient.createShadow` /
  `NetHarness loadout`).
- **Class evidence:** focused modules
  (`movement`, `operator-verbs`, `kits`, `phase2-movement-integration`,
  `ability-parity`) — **87/87 pass**. The class-overhaul gate at `b67d455`:
  `test:game` **1745 tests, 1740 pass, 0 fail, 5 skipped**; `test:server`
  **153/153**; `npx tsc --noEmit` clean; `npm run lint` 0 errors (428
  pre-existing warnings); the golden ability-parity fixture unchanged
  (`game/ability-parity.test.mjs` 1/1, no regeneration); the slow sweep
  `COCS_SLOW_TESTS=1` over config/core/gameplay/race **132/132 pass, 0 skipped**.
- **Demo evidence:** the rebuilt attract demo is covered by focused suites for
  the shot planner, camera ownership, demo session, demo playlist, director,
  showcase and camera modes — **92/92 pass**. The planner scores encounter and
  objective subjects with hold windows, hysteresis and blend-vs-cut
  transitions; `cameraOwner` allows exactly one controller per frame; free roam
  is a real camera mode with hand-back; the dock and Demo Options modal are
  driven by the pure `demo-session` state machine.
- **Integration gate (this merge):** `npm test` in the integration worktree —
  `test:game` **1822 tests, 1817 pass, 0 fail, 5 skipped** across 161
  `game/*.test.mjs` files (486 s); `test:server` **153/153** across 16 files
  (62 s); `npx tsc --noEmit` clean; bounded `vinext build` green; `tests/*.test.mjs`
  **7/7** (SSR HTML, `UiBag` contract, deployment assets). The five skips are
  the four opt-in slow simulations plus the browser-only `OfflineAudioContext`
  render, unchanged from 6.4.
- **Integration fix (F12):** the first gate run failed one stale fixture pin,
  not a game bug: the phase-1 spatial patch's hunk-1 import context was split by
  the demo's new `camera-modes.mjs` import. The patch context now includes that
  import; the assertion and the exercised renderer path are unchanged. Full
  reasoning in `docs/PHASE2-FIXLIST.md` F12.
- **Live deploy smoke (production `arena.ussyco.de`, after
  `npm run deploy -- --with-game-server` on `75b2103`):** bounded headless
  Chromium/SwiftShader run — footer `v6.5 · MOMENTUM`; the attract reel held one
  planned shot (shot start constant across six samples over ~7 s while match
  time advanced; subject `Claude`, planner reason `kill ChatGPT`, camera owner
  `auto`); the Back to Demo
  dock rendered Auto Director / Follow Subject / Free Roam / HUD / pause /
  Demo Options; FREE ROAM reported owner `free` and moved the camera 2.63 units
  on `W`; the HUD toggle flipped `hudVisible` true → false; ENTER ARENA started
  a 3-actor bot match (`mode: playing`, match clock advancing). No console
  errors, no page errors. The 7 fps figure is SwiftShader, not hardware-GPU
  evidence.
- **Deploy:** build + web restart + game-server restart by `scripts/deploy.sh`;
  `token-arena-web.service` and `token-arena-server.service` both active; the
  game server health endpoint reports `token-arena-game-server` on :4000;
  `npm run verify:deployment -- https://arena.ussyco.de` verified the HTML and
  12 linked CSS/JS assets.
- **Limitations (honest scope):** this is Phase 2. Spec tradeoffs, the 21 riders
  and asymmetric gear (Phase 3), the `mobility` input binding, movement HUD and
  touch presentation, `PROTOCOL_VERSION` 3 and respawn loadout switching
  (Phase 4), and the TTK/tier balance sweeps (Phase 5) are not in this release;
  specs and gear ride along as inert data. No hardware-GPU frame-rate claim is
  made for the movement verbs; bot-vs-bot balance is policy-verified, not
  human-playtested.

## Release 6.4 - SPECTRUM (materials, cinematic music, gameplay sound, restrained HUD, adaptive resolution)

- **Materials:** natural surfaces derive albedo/roughness/normal from one
  seamless multi-scale height/wear field. Pinned concrete albedo/roughness
  correlation 0.874 (> 0.75), tile edge-step ratio 0.74-0.95x (was 3.8-11.3x),
  normal relief std 0.08-0.23 (was ~0.007). The moth enhancer now runs on every
  natural kind with a two-scale masked region field and a ridged fracture layer.
- **Sky/weather:** cinematic day/dusk/night palettes, thicker horizon haze,
  de-neoned ambience tints; the CPU sky follows the phase.
- **Music:** eight-bar progressions with fills, absolute-quarter lead phrasing,
  staged combat layers, an outro/enter/idle transition machine, seeded noise
  risers, panning and reverb sends. Public API and `MUSIC_EXPORTS` unchanged.
  Offline `OfflineAudioContext` renders for menu/explore/combat are non-silent
  in every second (rms 0.016/0.031/0.032, peaks <= 0.51); excerpts in
  `docs/evidence/phase2/audio/`.
- **Gameplay sound:** single-token layered weapon reports with deterministic
  per-shot variation and distance darkening, surface-aware impacts/ricochets,
  bounded explosion debris, surface footstep/landing/jump/slide foley,
  wind/tension beds, retuned objective cues, retry-safe cavern IR load.
- **HUD:** merged vitals card, grouped action gauges, one contextual objective
  chip, kill feed capped at four, settled hints, and a `REDUCED MOTION`
  indicator with explanatory settings copy (semantics unchanged).
- **Integration:** solo movement foley resolves terrain material per frame;
  authored weather wind feeds the ambience bed; the material enhancer applies to
  all natural surfaces; normal scale 0.6.
- **Evidence:** six before/after map sheets in `docs/evidence/phase2/maps/`
  (same seed/resolution/quality as the phase-1 atlas; geometry unchanged,
  tiling repetition visibly reduced). Built-preview smoke 10/10 with no page
  errors; SwiftShader compatibility only, not hardware FPS.
- **Gate:** `npm test` green. The first full-suite run found 36 failures, all
  pre-existing at the deployed phase-1 checkpoint (campaign pins 3, placement
  sweep 30, next-gen maps 2, singleplayer driver hang 1) and all fixed; see
  `docs/PHASE2-FIXLIST.md`.
- **Adaptive resolution:** `game/resolution.mjs` (pure) caps the drawing buffer
  at a pixel budget and provides a hysteretic frame-time governor; `view.mjs`
  applies it and reports the buffer through `perf.viewport`. Built-preview
  probe: a 1080p canvas at a requested 1.5x renders 1920x1080 with cap `auto`
  and 2880x1620 with cap `native`; DRS stepped 1920 -> 1824 -> 1728 under
  sustained slow frames. Live probe at a 4K viewport: a 1920x1080 buffer at
  100% scale. Tests: `game/resolution.test.mjs` (11), plus `view`/`config`/
  `perf`/`post` coverage; the benchmark preset pins `resolutionCap:'native'`.
- **Glow defaults:** arena glow trims 1.6 -> 1.0 emissive, the energy preset
  1.9 -> 1.3, objective markers and beacons lowered; bloom stays user-controlled
  through the Glow slider.
- **Release discipline:** the title-footer version (parsed by
  `scripts/read-version.mjs`), `game/changelog.mjs`, `docs/CHANGELOG.md`, the
  README release list and this file move together on every deploy;
  `game/changelog.test.mjs` pins the footer/digest agreement.
- **Open:** F4 preview favicon CSP; material bake ~0.4 s/arena; loudness/mix and
  GPU shader compile remain manual-review items.

## Release 6.3 - Soundtrack, smooth presentation, batching and diagnostics

- **Audio wiring:** `game/feedback.test.mjs` builds the real bus graph through
  `_ensureBuses`, then proves the soundtrack schedules from a quiet menu, layers
  combat by intensity, pauses on Music OFF and master mute (mute gain set to zero
  and the ambience bed stopped), resumes on unmute, retunes per mode theme, and
  dedupes duplicate announcer reports. `game/weather.test.mjs` covers intensity
  and the bed duck; `game/view.test.mjs` proves `setAudio` adopts the active mode
  theme and forwards stings, and that combat events feed intensity from the
  dispatch stage and reset per match.
- **Soundtrack engine:** `game/music.test.mjs` asserts the arrangements share a
  tonal centre and carry bass/percussion/arpeggio, that a quiet menu schedules
  music, that look-ahead is bounded per tick and recovers from a 20s suspension
  without a backlog, that scene/intensity crossfade the buses, that ducking
  works, and that disposal stops and disconnects every held note and bus. An
  `OfflineAudioContext` non-silence check runs where Web Audio is available.
- **Interpolation:** `game/interpolation.test.mjs` covers shortest-path yaw,
  snapping and schedule-independent sampling. `game/view.test.mjs` drives the
  host-captured path and verifies the **camera** position blends, snaps on a
  teleport, keeps only the two surrounding ticks across a multi-tick frame,
  resets on a new match/replay seek, and freezes at the authoritative pose.
- **Batching:** `game/view.test.mjs` merges floor tiles into one batch mesh
  (asserting tile count and bounds) and verifies block grouping by material and
  chunk; `_batchArenaBlocks` is a no-op off WebGL so the CPU renderer and tests
  keep individual meshes.
- **Scopes:** `game/reticle.test.mjs` asserts perspective-correct magnification
  (`tan(base/2)/tan(fov/2)` recovers the ratio), floors, and that the scope cross
  midpoint is exactly the aiming centre at every warp including zero.
- **Terrain:** `game/terrain-normals.test.mjs` proves coplanar triangles smooth
  to one normal, a 90-degree crease keeps hard edges, normals stay unit length,
  and per-vertex tint is deterministic and shared across coincident vertices.
- **Diagnostics:** `game/perf.test.mjs` exercises `GpuTimer` (resolved async
  query, no extension/no WebGL returns null) and `game/view.test.mjs` covers
  `prepareScene` warming the weapon + viewmodel with a bounded synchronous
  compile and reporting a throwing compile instead of pretending success.

## Release 6.2 - Native-resolution performance, smooth presentation and sighted optics

- **Active sight resolver:** `game/reticle.test.mjs` proves the resolver's built-in
  sight table matches the real `weaponModel(...).userData.sights.kind` for all ten
  weapons, that the Rail Lance and Marksman Rifle resolve as magnified scopes with
  no optic attached, that a mounted scope never downgrades an integrated one, and
  that the ADS FOV zooms scopes far below the iron floor while irons keep their
  floored pull-in.
- **Sight mounting:** `attachScope` now builds a receiver base plate, support posts
  and clamp rings below/outside the bore; `game/sights.test.mjs` re-tests clearance
  after the change with a real camera and `Raycaster.setFromCamera()` across an
  angle-defined clear cone at 60/82/110 degree FOVs and 16:9/21:9/4:3 aspects,
  checks every opaque mesh including scope walls, and asserts the ADS camera origin
  is outside solid receiver/stock geometry.
- **ADS recoil composition:** `game/sights.test.mjs` proves `composeAdsQuaternion`
  blends a neutral hip with the solved aim first and applies the presentation
  channels exactly once at every transition fraction; `game/feedback.test.mjs`
  asserts the new sway/recoil/reload/switch channels sum to the returned
  pitch/roll and zero out under reduced motion.
- **Scope zoom in engine:** `game/view.test.mjs` drives a Rail Lance into ADS and
  asserts the camera FOV drops below 30 while an iron weapon keeps the 55-degree
  floor.
- **Near-wall tracers:** `game/view.test.mjs` fires a shot into a wall 0.2 m away
  and asserts no tracer origin sits behind the impact while an impact still spawns,
  then turns the camera 90 degrees and asserts the far-shot tracer runs along the
  current forward axis.
- **Interpolation:** `game/interpolation.test.mjs` covers shortest-path yaw,
  snapping on respawn/teleport, and presents one 60 Hz simulation at 60/120/144 Hz
  asserting every sample stays inside its tick bracket and is schedule-independent.
  `game/view.test.mjs` enables it on a view and checks the blend and the teleport
  snap.
- **Batching and shadows:** `game/weapon-presentation.test.mjs` asserts the
  third-person weapon is a <= 6-mesh silhouette (vs the detailed model) that still
  exposes `type` and a `muzzle` anchor; `game/view.test.mjs` asserts transparent
  effects and tagged greebles never cast.
- **Baseline tooling:** `game/perf.test.mjs` exercises `GpuTimer` (resolved async
  query -> ms; no extension/no WebGL -> null, never a fabricated number).
  `game/view.test.mjs` covers `warmup()` preferring `compileAsync`, falling back to
  synchronous `compile`, and doing nothing on the CPU renderer, plus the bounded
  viewmodel cache across 200 swaps.
- **Software fallback:** `game/software.test.mjs` asserts the CPU renderer exposes a
  WebGL-compatible `info.reset()` and that the exact `renderer?.info?.reset?.()`
  call used by `ArenaView.render` neither throws nor leaves stale counters.

## Release 6.1 - Clear sight pictures and correctly rigged weapons

- **Per-weapon bore clearance:** `game/sights.test.mjs` mounts every weapon at its
  runtime scale with the solved ADS pose, raycasts the centre of the aim picture,
  and fails if any non-sight mesh (rail, rod, tank, sight base) blocks it. All ten
  weapons pass.
- **ADS framing:** `solveSightPose` uses a fixed body distance; the `weapon-rig`
  and `view` tests assert the viewmodel centres on the sight line and does not
  drop below the hip height.
- **Reticle and tracers:** the ADS reticle is DOM (native UI resolution) and the
  local tracer origin is projected onto the camera aim ray in `effect()`; the
  authoritative event endpoints are still asserted unchanged by
  `weapon-presentation.test.mjs`.
- **Firing feedback:** the Pulse Rifle exposes a `parts.bolt` charging handle and
  the ADS pose carries recoil pitch/roll.

## Release 6.0 - Open sights, honest performance and real quality tiers

- **Open sights (geometry, browser-free):** `game/sights.test.mjs` mounts every
  weapon at its runtime scale with the solved ADS pose, then raycasts through the
  bore. It asserts the rear notch never blocks the centre ray or a small bundle in
  its gap, the front-post tip meets the aiming point, the holo frame misses the
  centre, scopes have no caps/lens disks and their bores stay clear across
  FOVs/aspect ratios, and the solver's rear/aperture projection lands on the
  centre ray for every weapon and attachment.
- **Sight regressions:** the SMG's rear anchor is checked against its real
  aperture (y=0.288), the opaque holo/iron block and capped-scope cases are
  explicit assertions, and `game/weapon-rig.test.mjs` now asserts the solved ADS
  transform (rear on the centre ray, bore on the forward axis, centred front tip).
- **Auto quality fix:** `game/post.test.mjs` covers `normalizeQualityOverride`
  (`auto`/null/junk → automatic; only fixed tiers pin), and
  `game/view.test.mjs` proves auto demotes on sustained pressure, holds a cooldown,
  recovers one tier at a time, and never pins, while fixed tiers stay fixed.
- **Real quality work:** `game/post.test.mjs` checks the tier table carries
  ordered `bloomScale`/`shadowHz`/`modelDetail`, that `bloomResolution` caps a 4K
  extraction at 1024 and leaves smaller canvases unscaled, and that the sustained
  governor demotes slowly, cools down and stays bounded under a software ceiling.
- **Trustworthy counters:** `game/perf.test.mjs` accumulates named CPU phases,
  keeps frame median/p95 bounded and ordered, keeps GPU time `null` until set and
  distinct from CPU, and asserts the benchmark preset fixes the scenario with a
  direct and a post-processed variant at 100% render scale.
- **Suite runtime:** long hardware-bound simulations are opt-in
  (`COCS_SLOW_TESTS=1` / `npm run test:game:slow`); the default `test:game` run
  completes in minutes with `--test-timeout` set so it cannot hang.

## Release 5.6 - Weapon presentation, combat AI and rendering

- **Weapon presentation:** `game/weapon-rig.test.mjs` asserts every weapon
  exposes the named anchors, that the ADS position is derived from the rear
  sight (and differs per weapon), that reload progress moves the real SMG
  magazine / Rail Lance cell / Scattergun barrels while the infinite-ammo Pulse
  Rifle invents no motion, and that the bolt cycles on the shot kick and holds
  under reduced motion. `game/weapon-presentation.test.mjs` still pins muzzle
  counts, flash lifetimes and exactly-once disposal; `game/view.test.mjs` covers
  the two-phase swap (outgoing retained while lowering).
- **First-person depth:** the render path builds a dedicated weapon scene and
  camera; the scene-graph/behaviour tests construct partial views without one
  and fall back to the in-camera path, which is the same software-renderer
  fallback.
- **Accuracy:** `game/weapon-spread.test.mjs` asserts the perpendicular-plane
  perturbation, the retuned `moveFactor` values, and seeded moving-shot hit
  distributions at fixed distances.
- **Weapon handling and navigation:** `game/weapon-switch.test.mjs` covers the
  shared switch operation, its delay/reload-cancel/event and bot commit
  hysteresis; `game/bot-navigation.test.mjs` covers weighted A*, explicit
  unreachability, reachable-cover scoring, lateral flanks and keyed expiry;
  `game/spawn-scoring.test.mjs` proves covered spawns beat exposed ones and that
  a nearby ally does not make safe cover undesirable.
- **Rendering:** `game/material-presets.test.mjs` measures the shared height
  field (albedo/roughness correlation) and the preset table; `game/post.test.mjs`
  covers the composer no longer being disabled by zero bloom.
- No GPU/browser verification here — scene-graph, material state and pure
  simulation only.

## Release 5.5 - Surface, particle and model fidelity

- **Textures:** `game/textures.test.mjs` generates each new pattern, checks the
  alias table and `canonicalTextureKind` (`TEXTURE_KINDS`), asserts the
  `surfaceKind` tag, and covers the `bump` option. The cache key includes the
  normal/roughness/bump flags, so a bump request cannot be served a cached
  non-bump result.
- **Particles:** `game/feedback.test.mjs` asserts the fade curves, damping,
  custom gravity, spin and colour interpolation, and that recycle cycles reuse
  the persistent scratch vectors/colours.
- **View:** `game/view.test.mjs` pins the arena/material wiring, the rocket
  exhaust trail and the cached pickup geometry. `geometry(assets,key,make)` is
  the existing `ModelAssets` cache path, and surface textures stay
  `surfaceKind`-tagged so `disposeObject` never frees a shared map.
- **Models:** the new `models.mjs` builders are asserted in
  `sp-improvements.test.mjs` and remain test-only.
- No GPU/browser verification here — scene-graph and material state only.

Verification: game **1360/1360**, server **153/153**, `tests/` **7/7**, `tsc`
clean, lint 0 errors; the production client/server/SSR/RSC bundles build cleanly
as part of `npm run deploy`.

## Release 5.4 - Character motion and surface detail

- **Rig bug fix:** `VectorSpring3D` exposes `x`/`y`/`z` `ProceduralSpring`s, not a
  `vel` field, so the old `recoilSpring.vel +=` never moved the springs; the impulse
  now targets `recoilSpring.z.vel`. Covered by a new `sp-improvements` assertion
  that a reload/swap dips the viewmodel and that stride phase advances.
- **Character motion:** `character-anim.test.mjs` adds landing compression, reload
  arm pose and rig ground-contact cases; every emitted rig angle is clamped.
- **Surfaces:** `textures.test.mjs` generates each new pattern (`carbon_fiber`,
  `metal_grating`, `hex_paneling`, `hazard_stripes`, `weathered_concrete`,
  `holographic_grid`), checks the alias table and `TEXTURE_KINDS`, and asserts a
  complete map set. `view.test.mjs` pins the arena/model wiring. Surface textures
  keep the `userData.surfaceKind` tag, so `disposeObject` never frees a shared
  cached map.
- **Models:** the new `models.mjs` builders (conduit, plating, muzzle brake,
  radiator, `enhanceVehicleModel`, `applyProceduralTexturesToModel`) are asserted
  in `sp-improvements.test.mjs`; they remain test-only helpers.
- No GPU/browser verification here — scene-graph and material state only.

Verification: game **1356/1356**, server **153/153**, `tests/` **7/7**, `tsc`
clean, lint 0 errors.

## Release 5.3 - Weapon, shield and impact feedback

- **Sim:** `Match.damage` emits `shieldBreak` when the summed temporary/Juggernaut
  shield plus armor falls from positive to zero on a surviving target; asserted in
  `game/sp-improvements.test.mjs`.
- **Narrative:** `singlePlayerSnapshot` resolves `SPEAKERS` into
  `{speaker,callsign,color,tag}` for `story`/`bark`; asserted by the new
  `sp-improvements` test.
- **Audio:** `spree` cue, critical hit ping, `shieldBreak` layers, low-health
  heartbeat and vehicle nitro pitch are asserted in `game/sp-improvements.test.mjs`
  (offline synth construction, no AudioContext needed).
- **View/model:** `game/view.test.mjs` adds three tests — ADS viewmodel
  transition (and reduced-motion pin), nitro exhaust particles (and reduced-motion
  suppression), and the Overshield/Juggernaut shield mesh plus the `shieldBreak`
  wireframe shatter. `game/hud.test.mjs` pins the critical/kill/hit marker tiers.
- No GPU/browser verification is possible here, so the view tests assert scene
  graph and material state rather than pixels.

Verification: game **1350/1350**, server **153/153**, `tests/` **7/7**, `tsc`
clean, lint 0 errors.

## Release 5.2 - Campaign persistence and mode fixes

- **Campaign save round-trip (critical):** probed `recordMission` →
  `JSON.stringify` → `normalizeCampaignProgress` and confirmed every completed
  mission was dropped (the recorder wrote no `won` flag; the normalizer required
  one). Normalization now keys on `wins`/`attempts` with `won:true` legacy
  fallback; new tests assert a win survives reload and keeps unlocking, and that
  a loss bumps attempts without completing or unlocking.
- **VIP Escort:** `updateExtraction` credits `objectiveTime`/`objectiveCaptures`
  to escorts; the existing extraction test now asserts non-zero escort stats.
- **Race:** new tests initialise a four-slot grid (four racers, finite positions)
  and drive `crossRaceGates` over a single-gate circuit (finite `progress`).
- **Horde:** new test asserts `hordeWaveSize` stays under the difficulty's
  `maxAlive` at waves 15/20/40/100 for all four difficulties.
- **Vehicle HUD / focus:** gunner and passenger prompts asserted in
  `game/hud.test.mjs`; onboarding ref wired into the `app/page.tsx` trap.

Verification: game **1343/1343**, server **153/153**, `tests/` **7/7**, `tsc`
clean, lint 0 errors.

## Release 5.1 - Progression and UI correctness

- **Challenge streak:** `MAX_METRICS` in `game/challenges.mjs` advances
  `bestStreak` by `Math.max` instead of sum. New test asserts two 2-streaks do
  not complete an 8 target and that a real target still completes.
- **Scoreboard coercion:** `pingLabel({ping:null|''})` returns null and
  `scoreboardGroups` keeps a `null` team in the `UNASSIGNED` group; both asserted
  in `game/scoreboard.test.mjs`.
- **Solo HUD:** the objective counter clamps to `total / total`; the display
  adapter already reports `stepIndex` as the completed count.
- **Focus trap:** `settingsRef` joins the modal auto-focus and Tab-trap effects in
  `app/page.tsx`, and `SettingsDialog` passes `panelRef` to its `Modal`.
- **Cleanup:** removed `campaignMissionStars` (unused duplicate of
  `missionStars`) and its stale assertions.

Verification: game **1337/1337**, server **153/153**, `tests/` **7/7**, `tsc`
clean, lint 0 errors.

## Release 5.0 - Id-keyed snapshot deltas

- **Compression, measured:** on real quantized frames from an 8-human/8-bot
  deathmatch, a full frame is 30,254 B and the id-keyed delta averages 2,985 B
  (90% smaller); ctf 31,267/3,620 (88%), 4v4 16,179/1,808 (89%), 2h+8b
  20,086/2,756 (86%). Diff cost was 0.30-0.79 ms per frame. The same numbers are
  asserted as a floor in `game/protocol.test.mjs` ("cuts a real combat frame by
  at least 80%") and in the `NetHarness` delta test.
- **Correctness:** `game/protocol.test.mjs` adds round-trip coverage for reorder,
  insert, remove, nested arrays, emptied arrays and non-id arrays. The net
  harness (which drives the real `encodeSnapshot`/`pushDelta`) still converges to
  zero divergence and now asserts delta frames are under half a full frame.
- **Server wiring:** `server/room.test.mjs` streams a started room and replays
  each peer's frames through `applySnapshotDelta`, asserting the rebuilt state
  deep-equals the authoritative `room.wireState()`; it also asserts a keyframe
  cadence, that an incapable peer only gets full snapshots, and that a late
  joiner gets a full keyframe first.
- **End-to-end:** `server/network.test.mjs` plays a full match over a real
  WebSocket against `createGameServer` and asserts the client applied deltas
  (`deltaHits > 0`) with zero misses while reconstructing every actor.
- **Telemetry:** the game-server status JSON reports aggregate
  `snapshot.deltaFrames`/`fullFrames`; `tokenArenaDebug.delta()` reports the
  client's hits, misses, applied base and bandwidth rate.

Verification: game **1335/1335**, server **153/153**, `tests/` **7/7**, `tsc`
clean, lint 0 errors.

## Release 4.17 - Netcode consistency and cleanup

- **Render path:** `NetClient.renderState` now computes its `base`/`prev`/`alpha`
  and then delegates all actor/rocket/vehicle blending to the exported
  `interpolateSnapshots`, replacing the second inline copy. The shadow
  substitution (predicted own actor/vehicle when resynced) is unchanged. Covered
  by the existing `game/net.test.mjs` suite (31 tests).
- **Essential-queue starvation:** extracted the drain loop into the exported pure
  `drainEssential` and rewired `pumpEssential` to it. An entry whose own byte size
  exceeds `TRAFFIC_BUFFER_LIMIT` used to make `pumpEssential` `break` on every pass
  forever, stalling every later reply. It is now sent once the socket has drained,
  order is preserved for everything that fits, and stale-room entries are dropped.
  `queueEssential` caches each entry's byte size. Three unit tests cover ordering,
  the oversized case and stale-room skipping; the live backpressure tests in
  `server/transport.test.mjs` and `server/security.test.mjs` still pass.
- **Dead code:** removed unused exported symbols confirmed to have zero
  references: `blendRacePose`, `racePoseBearing`, `raceShortestArc`,
  `raceSmoothFactor`, `RACE_CAMERA_HALF_LIFE`, `vehicleOccupantCount`,
  `showcaseById`, `createArmorEdgeHighlight`, `MODE_IDS`, `LOADOUT_KEYS`,
  `PRESTIGE_VERSION`, `zoneHard` (plus the now-unused `GAME_MODES` import in
  `game/arenas.mjs`).
- **Deferred, documented:** server-side snapshot deltas are not wired because
  `snapshotDelta` treats arrays as opaque leaves; `actors`/`rockets` would still
  cross the wire whole. A note in `game/protocol.mjs` records that id-keyed
  array element diffing is the prerequisite.

Verification: game **1331/1331**, server **149/149**, `tests/` **7/7**, `tsc`
clean, lint 0 errors.

## Release 4.16 - Demo continuity and award data

- **Demo fix:** reproduced the "first demo then walking bot" report by saving
  `display.reducedMotion:true`: the initial `buildShowcase` ran before the setting
  applied, then the cycle-time `showcaseOk()` (which required `!reducedMotion()`)
  cleared it and never rebuilt. Fixed by applying the saved display (and
  `reducedOverride`) before the first build and removing the reduced-motion gate
  from `showcaseOk`/retry/`setShowcaseExpected`/the settings effect, so the attract
  reel keeps cycling (the director still receives `reduced` for a calmer camera).
  Verified live: forced a cycle under reduced motion and the reel advanced instead
  of clearing (`tokenArenaDebug.state()` still non-null, `showcaseReady:true`).
- **Award data:** `game/core.mjs` now counts per-actor
  `scoreStats.shots`/`hits`/`damage`; `game/outcome.mjs`'s `scoreStatsOf` carries
  them into history while `objectiveActions` uses an explicit objective field list
  so ranking is unchanged. `game/core.test.mjs` asserts the counters.
- **Matchmaking:** `Matchmaker.enqueue` retains `playerId`/`progressToken`;
  `draftQueue` seats with them; `list()` omits the token. Covered in
  `server/matchmaking.test.mjs`.
- **Wire contract:** lobby/matchmaking verbs added to `MESSAGE`;
  `server/protocol.test.mjs` asserts every server dispatch literal is declared.

Verification: game **1331/1331**, server **146/146**, `tests/` **7/7**, `tsc`
clean, lint 0 errors. `tokenArenaDebug` (`state()`, `skip()`) ships alongside the
existing `tokenArenaSnapshot` debug hook.

## Release 4.15 - Demo audio and environment options

- **Controls:** the fullscreen demo controls render a `.demo-options` row
  (`app/page.tsx`) with MUSIC/AMBIENCE/ANNOUNCER toggles and an ENVIRONMENT
  picker over `[null, ...WEATHER_KINDS]`.
- **Audio:** new `SynthAudio.setMusicEnabled` (independent of `muted`); ambience
  and announcer reuse `setAmbient`/`setAnnouncer`. Covered by
  `game/feedback.test.mjs` (music off stops the drone, effects/mute unaffected).
- **Environment:** `view.render` keeps a pinned `_weatherOverride` while
  `cinematic`, so the demo picker sticks; a real match clears it.
- **Persistence:** choices are stored in `token-arena-settings`, read on init and
  applied to the live audio/view; `saveSettings` now merges the prefs object.

Verification: game **1330/1330**, server **143/143**, `tests/` **7/7**, `tsc`
clean, lint 0 errors. Live probe (0 errors): ENV `AUTO -> CLEAR -> RAIN` updates
`weather`/`weatherOverride` and survives a mode change; MUSIC toggles off without
leaving the demo. Weather persistence verified by reloading after a pick.

## Release 4.14 - Objective-mode and lobby correctness

Read-only audits of gameplay/sim, UI wiring and netcode/server drove this pass.

- **Objective variants:** `commandBrief` checks the variant ids before the
  `kind`-based KOTH branch (Uplink reports `kind:'koth'`), and
  `modeColumns`/`modePrimary`/`modeTargetText` plus `outcome.rankTuple` now cover
  Holdout/Uplink/VIP Escort. `game/hud.test.mjs` uses the real `kind:'koth'`
  fixture; new assertions cover columns/primary/target.
- **Sudden death:** `suddenDeathBanner` also reads `objectives.suddenDeath`
  (Juggernaut/Team Elimination self-manage it); asserted in `game/hud.test.mjs`.
- **Bots:** `objectiveMode` includes the three variants.
- **Campaign:** `app/page.tsx` maps `mission-message` events into the HUD notice.
- **Server:** `Room.lifecycle()` counts only connected peers' map/rematch votes,
  and the reconnect branch clears the old peer's ready flag and votes; two new
  `server/room.test.mjs` tests. (A proposed duplicate-START guard was reverted:
  it conflicts with the pinned "start clears pending and held fire" contract.)
- **Menu:** Match Setup focuses `[data-setup-trigger]`, Theater hotkeys cover
  rigs 1-8, and `.title-stage` is `pointer-events:none` with `.title-stage .btn`
  interactive so the footer GitHub link is clickable.

Verification: game **1329/1329**, server **143/143**, `tests/` **7/7**, `tsc`
clean, lint 0 errors. Not browser/GPU verified.

## Release 4.13 - Title-screen demo controls

- **Broadcast scope:** `app/page.tsx` renders `DemoBroadcast` only while
  `!entered`, so the lower-third is part of the title screen and the back-to-demo
  view and never covers main-menu controls; `.demo-broadcast` sits in the title
  foreground (`z-index:6`).
- **Fullscreen:** the menu top bar (`headActions`) gains a toggle bound to
  `toggleFullscreen`/`fullscreen`, with `aria-pressed` and a Maximize/Minimize
  icon swap.
- **Back to demo:** a `demoOnly` view hides the title overlay, keeps the live
  showcase running, and renders `.demo-controls` (previous/next mode, enter);
  `cycleShowcase` rebuilds the reel at a chosen `SHOWCASES` index and arrow keys
  cycle modes.

Verification: game **1328/1328**, `tests/` **7/7** (incl. `ui-contract`), `tsc`
clean, lint 0 errors. A Playwright probe on the live build reported no console
errors and confirmed: broadcast present on the title screen, absent in the menu,
restored by Back to Demo, and next-mode changed the demo `koth -> domination`.
Fullscreen is DOM/`aria` verified; actual fullscreen entry is browser-manual.

## Release 4.12 - Build sync, campaign checkpoints and feedback

- **Build sync:** `app/api/version/route.ts` returns `RELEASE_VERSION` with
  `Cache-Control: no-store`; the client polls it and raises a reload notice on a
  version mismatch. `NetClient.join`/`create` send `PROTOCOL_VERSION`, `Room`
  echoes it in `welcome` (verified in `server/network.test.mjs`), and a mismatch
  raises the same notice.
- **Campaign checkpoints:** `normalizeConfig` preserves a validated `checkpoint`
  step (`game/campaign-progress.test.mjs`); the page banks `singleplayer-checkpoint`
  events, resumes with `checkpointFor`, and clears on win.
- **Star consistency:** mission-select stars come from `missionStars`
  (`game/singleplayer-ui.test.mjs` unchanged expectations still pass).
- **Feedback and markers:** enemy telegraphs and SP abilities are captioned and
  audible; VIP Escort's extraction beacon renders via the new snapshot extraction
  fields and `ArenaView.updateObjectives`.
- **Reconnect intent:** room/spectate intent is remembered across reconnect.

Verification: game **1328/1328**, server **141/141**, `tests/` **7/7**, `tsc`
clean, lint 0 errors, build clean. Not browser/GPU frame-pacing verified.

## Release 4.11 - Wiring, cache and correctness pass

A three-area read-only audit (gameplay, UI, netcode/deploy) drove this batch.

- **Demo render path:** `ArenaView.render` honors the showcase snapshot on
  `browse`/`lobby`/`changelog` and composites the operator preview on
  `progression`; the page passes real frame time to those screens. A browser probe
  (Playwright + SwiftShader) confirmed the demo keeps playing across scenario
  cycles with no model fallback.
- **Stale-bundle prevention:** `next.config.ts` sets document `no-cache`;
  `scripts/verify-deployment.mjs` rejects cacheable HTML and now checks
  `preload`/`modulepreload` references (`tests/deployment-assets.test.mjs`).
- **Gameplay correctness:** team scoreboards use `isTeamMode` (covers
  holdout/uplink/vip-escort/team-elimination); Juggernaut is awarded on crown
  points; soccer goal events carry a finite position; HUD `modeGoal`/`commandBrief`
  cover holdout/uplink/vip-escort; replay timelines include the newer objective
  events. New assertions in `scoreboard`, `outcome`, `soccer` and `hud` tests.
- **Multiplayer robustness:** case-insensitive room lookup; spectate invite links;
  full/closed-room fallback to a refreshed browser; `VOICE_CONFIG` no longer
  terminates a congested socket; the server uses the shared quantizer.
- **UI wiring:** practice-vs-bots honors its pickers; mission select opens from the
  rank screen; local spectate hides network-only controls; radar off-screen arrows
  render.

Verification: game **1327/1327**, server **141/141**, `tests/` **7/7**, `tsc`
clean, lint 0 errors, build clean. Not browser/GPU frame-pacing verified (the
Playwright probe uses the software WebGL path).

## Release 4.10 - Demo never falls back to the operator model while cycling

- The view's `showcaseExpected` flag is now driven by the showcase setting and
  current menu mode every frame, independent of whether `r.showcase`/`showcaseState`
  is momentarily empty. A cycling rebuild (or a failed first build during the
  retry window) now renders the arena scene, not the full-screen operator
  turntable.
- No new unit tests: this is a render-path flag; `tests/` and the showcase build
  tests still cover the surrounding logic.

Verification: game **1323/1323**, server **141/141**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean. Not browser/GPU verified.

## Release 4.9 - Invite links and a readable title demo

**Invite links**
- `game/invite.mjs` (`normaliseRoomCode`, `inviteLink`, `roomFromLocation`) builds
  and parses `?room=CODE` links; `game/invite.test.mjs` covers normalization,
  query replacement, `room`/`join` parameters and a generate→parse round-trip.
- The lobby and room browser copy the link to the clipboard with a fallback, and
  `?room=CODE` auto-connects and joins on load; a `room not found` error redirects
  to the browser with a friendly message.

**Title demo readability**
- The `.title-stage` radial vignette was lightened, and `.demo-broadcast` was
  raised above the title overlay with a darker, higher-contrast card, so the mode,
  map and score stay legible over a bright demo.

Verification: game **1323/1323**, server **141/141**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean. Not browser/GPU verified.

## Release 4.8 - Broadcast lower-third, in-game patch notes, demo background, docs

**Demo broadcast**
- The title showcase feeds a pure `game/broadcast.mjs` digest (mode, map, kind,
  phase, clock, teams or leaderboard, metrics, ticker) into a broadcast-style
  lower-third (`app/ui/DemoBroadcast.tsx`) that animates in per scenario.
- `game/broadcast.test.mjs` covers free-for-all, team, race and soccer shapes and
  an empty snapshot; the digest reuses the tested HUD helpers, so it never invents
  a metric.

**In-game patch notes**
- `game/changelog.mjs` holds the release digest and the running version;
  `app/ui/screens/ChangelogScreen.tsx` renders it newest-first from the menu header
  and the loadout action rail, linking to `docs/CHANGELOG.md`.
- `game/changelog.test.mjs` asserts descending order, complete entries, a valid
  full-changelog link, and that the digest's newest version matches the
  title-footer literal in `app/page.tsx`.

**Demo background fix**
- `ArenaView.setShowcaseExpected` plus the page always setting the showcase
  snapshot on a scenario change stop the full-screen operator turntable flashing
  between demo scenarios; a not-yet-ready showcase frame renders the arena scene.

**Documentation**
- README rewritten as a feature showcase with a five-release changelog; new
  `docs/` index, `ARCHITECTURE.md`, `SYSTEMS.md`, `TESTING.md`, `DEPLOYMENT.md` and
  a full `CHANGELOG.md`; historical spec/plan/audit docs moved under `docs/`.

Verification: game **1319/1319**, server **141/141**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean. Not browser/GPU verified.

## Release 4.7 - Title showcase, vehicle placement, single-player atmosphere

**Title showcase**
- The menu reel is now a shuffled cycle of hand-picked, good-looking mode/map
  combos (deathmatch, teamdeathmatch, CTF, KOTH, domination, combined-arms,
  payload, juggernaut, team-elimination, race, soccer) instead of a fixed order.
- Rebuilds are atomic: a failed scenario keeps the running reel rather than
  dropping to the static operator preview, and the cinema camera resets between
  scenarios.

**Vehicles**
- Titan, Scout and Transport are now placed on the warzone maps (warfront,
  skyfall-basin, titan-valley, trenchline, signal-ridge, longreach-plateau,
  ironfall-megastructure), mirrored per side with clear, supported ground.

**Single-player atmosphere**
- Campaign missions author their own weather (snow blizzard, reactor ash, storms)
  and scripted beats change it mid-mission; the view honours `match.weather` for
  campaign/horde.
- Timed narrative transmissions from the story bible play as scripted voice-over
  beats and surface in the mission snapshot; boss phases and transmissions trigger
  new announcer cues.

Verification: game **1310/1310**, server **141/141**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean.

## Release 4.6 - Weapon balance, single-player regen, narrative and animation scaffolding

**Weapon balance**
- Distinct combat roles for all ten weapons (`WEAPON_ROLES`); retuned TTK across
  Scattergun, Rocket Launcher, Plasma Driver, Grenade Launcher, Shock Beam, Flak
  Cannon, Marksman Rifle and SMG. Balance metrics (`weaponDPS`, `weaponTTK`,
  `weaponBalanceSummary`).

**Single-player**
- Out-of-combat **health regeneration** for campaign/horde: 4.5s post-damage
  delay, 2.0s firing pause, 14 hp/s heal, reset on respawn/resupply/checkpoint
  and exposed on the snapshot as `regen`. Not active in multiplayer.

**Narrative & presentation scaffolding**
- Speaker profiles and mission lore (`story.mjs`), campaign briefings and
  mission progression (`campaign.mjs`), procedural springs/weapon rig/two-bone
  IK (`rig.mjs`), material fidelity presets, thruster exhaust and energy-shield
  meshes (`models.mjs`), plus announcer cues, victory/defeat stings and sprint
  lean/breathing animation.

Verification: game **1307/1307**, server **141/141**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean.

## Release 4.5 - Netcode, replay, camera, vehicles, levelgen, matchmaking

**Netcode & replays**
- Snapshot **delta compression** with bandwidth accounting and a deterministic
  prediction/reconciliation harness (latency, jitter, loss, keyframes); protocol
  bumped to v2 with a backward-compatible full-snapshot fallback.
- Replay **kill feed**, objective timeline, summary and a seekable/speed-aware
  playback controller.

**Presentation**
- Four new camera modes (cinematic, over-shoulder, free-look, tactical) with
  frame-rate-independent smoothing; race cinematic rig.
- Richer radar (off-screen indicators, objective markers/progress) and a grouped
  scoreboard with streaks and ping; team outlines and capped announcer callouts.

**World & sim**
- New vehicles (**Titan**, **Scout**, **Transport**) with distinct handling and
  mounted weapons; levelgen compounds/terraces/towers and biome prop scatter;
  structural **map-schema validation** with degenerate-layout rejection.

**Server & meta**
- Matchmaking queue with deterministic team balancing, room lifecycle (warmup,
  ready-up, map vote, rematch), cross-session leaderboards and anti-cheat stat
  bounds.

Verification: game **1294/1294**, server **141/141**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean.

## Release 4.4 - Objective variants, endless horde, economy, inspect, accessibility

**Gameplay**
- New objective modes: **Holdout** (quorum hold window) and **Uplink**
  (sequential moving relay), with snapshot state and deterministic tiebreaks.
- **Endless Horde** with wave/score banking, escalating alternating bosses and a
  clean end-on-death summary.
- **Economy pickups**: temporary weapon upgrade and a deployable sentry, plus
  deterministic bot objective coordination (attack/defend/regroup).

**Presentation**
- **Weapon inspect** viewer API (reuses `weaponModel` + `ModelAssets`),
  deterministic hit reactions (flinch/knockback/spray, WebGL-gated), storm
  lightning/thunder, wet sheen and wind gusts, per-mode music themes and
  victory/defeat stings.

**Meta / accessibility**
- Three colorblind palettes + high-contrast UI; full press-to-capture keyboard
  remapping; replay export/import; a match summary card; room-browser filters
  and a practice-vs-bots option; onboarding/help refreshed.

Verification: game **1262/1262**, server **129/129**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean.

## Release 4.3 - Mutators, biomes, destructibles, prestige and achievements

**Gameplay**
- Composable **mutators** (low gravity, turbo, instagib, one-shot, mirror
  loadout, big head, no recoil, plus the legacy flags unified into one ordered
  set) with deterministic composition and `mutators:[...]` config.
- **Mode/loadout rules**: per-mode starting weapons, ammo, ADS/pickup
  restrictions and sniper/pistol presets; new `ammo` and `megahealth` supplies.
- Bots pick loadout-allowed weapons, retreat under one-shot/instagib and finish
  wounded targets.

**World**
- Two new next-gen maps: **Dune Ravine** (desert canyon) and **Ember Caldera**
  (frozen volcanic), with biome prop families, mesas/ridges/lava cracks/ice
  spikes and breakable crates/barrels.
- Deterministic **destructible props** (pooled debris, WebGL-gated,
  quality-budgeted) that never affect authoritative movement.

**Meta**
- **Prestige** ranks after max level with permanent XP bonuses, and twelve
  deterministic **achievements** with unlock toasts and a Career track panel.
- Roving-tabindex keyboard navigation for tabs/segmented controls; onboarding
  and help updated for mutators, career and the new maps.

Verification: game **1199/1199**, server **128/128**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean.

## Release 4.2 - Campaign, weather, history and challenge expansion

**Campaign / PvE**
- Campaign now has five missions. `ghost-wire` is a stealth infiltration on
  Frost Gate; `crown-duel` is a Harbinger boss duel on Fortress. Both add
  checkpoints, barks, multi-phase encounters and distinct win conditions.
- Horde adds lancer flankers, sentinel shield formations and the three-phase
  Harbinger summoner, plus new flanked/fortified/champion wave modifiers.
- Campaign progress now derives mission stars, medals, par scores and aggregate
  rewards; checkpoint helpers correctly return the first uncompleted mission.

**World / presentation**
- Deterministic time-of-day and biome weather (clear, overcast, rain, snow, ash
  and storms) drive sky/fog/light tint, pooled precipitation and ambience.
- Combat intensity drives a bounded music layer, while biome ambience controls
  the ambient bed and optional announcer cues.

**Meta / interface**
- Local match history and per-mode personal leaderboards, weekly challenges,
  campaign mission selection with stars/bests, expanded medals, an Arsenal
  inspector and persisted quality tiers (`auto`/`low`/`medium`/`high`).
- The display preset buttons now select real persisted LOD tiers.

Verification: game **1157/1157**, server **127/127**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean.

## Release 4.1 - Feature expansion and three refinement passes

Four feature agents plus three refinement passes (all with focused test gates).

**New modes / objectives:** `juggernaut` (one powered crown-holder, points while
holding, transfer on kill/fall), `team-elimination` (shared team ticket lives,
attrition + sudden death), `vip-escort` (extraction objective), plus multi-phase
Warden bosses and mode wide sudden-death timers so every mode terminates.

**Single-player depth:** horde between-wave economy with choose-1-of-3 upgrades,
wave modifiers (swarm/artillery/shielded/elite), new enemy archetypes (mender,
sapper, overseer, bulwark tank with directional shields, mortar artillery), area
confinement, campaign checkpoint resume, and a third mission (`throne-siege`).

**Presentation:** death variety (poses/tumble), ambient biome FX and wind, audio
variants + ambient bed, layered muzzle flashes, iron sights, operator/vehicle
detail, impact decals, pooled effects, and a quality/LOD controller with FPS
hysteresis and a CPU triangle budget.

**Interface:** daily challenges, per-mode career stats, full loadout presets,
theater library filter/sort with in-dock highlight jumps, results reward strip,
unlock queue, help/settings legend, and team-grouped spectator board. New
surfaces are styled, mobile/4K safe and accessible.

**Maps:** two new next-gen arenas (`throne`, `gauntlet`) with metadata, plus
detail/dressing passes.

Verification: game **1107/1107**, server **127/127**, `tests/` **5/5**, `tsc`
clean, lint 0 errors, build clean.

## Release 4.0 - Major improvement pass (single-player, modes, graphics, rewards)

A five-agent research wave followed by four implementation agents.

**Single-player / NPCs**
- **Area confinement:** spawned NPCs carry an `npcZone` (`spawn`/`patrol`/`hold`) with a per-type leash; pathing samples nav nodes inside the zone, destinations are clamped to the leash, strays return home, and stuck-recovery stays in-zone. Hard zones never leave; soft zones break leash only while engaging nearby.
- **De-clumped group spawns** (`placeGroup` picks distinct on-floor nav nodes, pairwise >1m) instead of stacking every member on one node.
- **Wave composition + difficulty pacing:** horde waves come from a per-difficulty table (size/growth/cap/intermission/elite cadence), so Easy → Nightmare actually changes the survival curve.
- **Scripted events:** both campaign missions now author `script` timelines (timed reinforcements, `cleared`/`player-in-zone`/`enemiesAtMost:N` ambushes, Warden `boss-hp` phases with adds, NPC barks) and real `win` conditions. `bark`/`boss-phase`/`story-line` actions and captions were added.
- New tests: confinement loop, de-clump, timed-spawn + bark-once, script/win well-formedness.

**Game-mode differentiation**
- **Vehicle gating:** vehicles only spawn where a mode allows them (`combined-arms`, `puma-*`), so Combined Arms is no longer a Domination clone.
- **CTF carrier** moves at 0.9× and cannot use its harness power.
- **KOTH** hill rotates between authored points every 30s; **Domination/KOTH** zone ownership grants a mapped powerup to occupants.
- **Arms Race:** dying demotes one rung; a trailing killer gains a bonus rung.
- New/updated tests in `extra-modes`, `modes`, `armsrace`, `config`.

**Graphics**
- **High-poly soccer ball:** a truncated-icosahedron panel ball (Voronoi split of a high-detail icosahedron into 12 pentagon + 20 hexagon shells, ~5.1k tris on WebGL / ~980 on CPU) that rolls without slipping, routed through `ModelAssets` so sharing/disposal invariants hold.
- **Software renderer vertex colors:** the CPU renderer now averages per-vertex colors into the material tint, so all existing `paintGeometry` detail is visible on CPU as well as WebGL.

**Rigging / orientation / spectate**
- **Spectate mouse no longer inverted:** the spectate/free-cam look now matches the normal path's yaw sign and honours `invertY`; touch look is disabled while spectating.
- **Character rig** pitch axis corrected at application (the robot mesh faces -Z but poses were authored +Z), so bots lean/ADS/head-track correctly.
- **Actor weapons** aim with the correct pitch and now track aim yaw; **mounted riders** face chassis-forward using `heading` (fixing backwards local/spectated riders).

**Interface / replayability / progression**
- Results screen shows a reward strip (`+XP`, level meter, next unlock); unlocks queue as sequential toasts; the selection rail shows the next unlock.
- **Next Arena** keeps your operator/harness (map only); a new **Surprise Me** randomises loadout + mode.
- Theater demos derive highlight moments from the recorded event stream with jump-to buttons.

Verification: game **984/984**, server **126/126**, `tests/` **5/5**, `tsc` clean, lint 0 errors, build clean.

## Release 3.10 - Mobile touch controls rebuild

- **Both sticks are floating.** The move stick and the look stick now appear
  wherever the thumb lands inside their zone and use a fixed base radius, so the
  axis can never saturate from a collapsed element. This fixes the reported
  "any touch on the left snaps the stick full forward" bug: `stickAxis` floors
  the radius (`game/touch.mjs`) and is unit-tested.
- **No overlap.** The look surface stops above the button strip; the move zone
  and look zone are on opposite thirds. Fire and jump (boost/item while racing)
  are the large thumb buttons with the remaining actions as small buttons.
- **Multi-touch.** Every control captures its own pointer id, so both sticks plus
  any buttons work at once.
- **Fullscreen button** added to the top-right cluster (`toggleFullscreen` in
  `app/page.tsx`, with vendor fallbacks).
- **Racing simplified.** Car modes show only brake/reset plus boost/item and hide
  the look stick and combat cluster (`touch-car`).

Verification: game **965/965**, server **126/126**, `tests/` **5/5**, `tsc` clean,
lint 0 errors, build clean.

## Release 3.9 - Safer display defaults and quick start activities

- **Glow off by default.** `DEFAULT_DISPLAY` now has `postFx:false` and
  `bloom:0`, and `normalizeDisplay` defaults match (`postFx` is only true when
  explicitly set). Glow/post-processing stays available in Graphics & settings.
- **Resolution scaling defaults to 50%.** `resolutionScale:.5` (range remains
  0.5-1.5), so the game renders lighter by default; players can raise it.
- **Quick start replaces the arena grid on the main menu.** The selection
  screen's `03 / ARENA` map picker was redundant with MATCH SETUP, so it is now
  `03 / QUICK START`: ten activity cards (Quick Match, Team Deathmatch, Capture
  the Flag, King of the Hill, Rocket Arena, Instagib, Arms Race, Horde,
  Campaign, Spectate) that launch immediately with the current operator, harness
  and rules, resolving an arena the mode supports. Arena selection remains in
  MATCH SETUP and SINGLE PLAYER.

Verification: game **964/964**, server **126/126**, `tests/` **5/5**, `tsc` clean,
lint 0 errors, build clean.

## Release 3.8 - Weapon model de-clipping

- Parts of the new weapon models interpenetrated (barrel shrouds swallowing
  receivers, coils sunk into barrels, magazines buried in magwells, etc.). Each
  of the ten builders in `game/weapon-models/` was revised so parts meet
  flush/socket cleanly instead of overlapping in volume.
- A per-model interpenetration audit (seeded point-in-mesh volume sampling,
  classifying a pair as PARTIAL when a visible chunk of one part sits inside
  another, FULL when a part is wholly enclosed) went from **492 flagged pairs /
  ~430 PARTIAL** across the arsenal to **0 PARTIAL**. The remaining FULL pairs are
  deliberate hidden internals: barrel bore liners, the shock emitter core, the
  plasma core and the grenade drum's chamber shells.
- Detail level, silhouettes, pinned names (`grenade-drum`, `shock-emitter`,
  `flak-barrel`), muzzle anchor positions, the ctx-helper contract and the
  cached-resource/disposal invariants are unchanged.

Verification: game **963/963**, server **126/126**, `tests/` **5/5**, `tsc` clean,
lint 0 errors, build clean.

## Release 3.7 - Voice crash fix, remodeled weapons

- **Voice crash on ONLINE.** `createVoice` declared `const voice = new VoiceChat({
  onState: () => { ... uses `voice` ... } })`. `VoiceChat`'s constructor calls
  `publish()` **synchronously**, so the callback read `voice` while it was still
  in its temporal dead zone, throwing
  `ReferenceError: Cannot access 'voice' before initialization` the moment the
  button connected. The callback is now attached after construction
  (`const voice = new VoiceChat({net:n}); voice.onState = ...`), so the
  constructor's initial publish is absorbed by the default no-op handler and the
  real handler is live before any network event.
- **Weapons remodeled.** The ten low-poly weapons are replaced with detailed,
  higher-poly models in `game/weapon-models/` (one builder per weapon:
  pulse-rifle, rocket-launcher, rail-lance, scattergun, plasma-driver,
  grenade-launcher, shock-beam, flak-cannon, marksman-rifle, submachine-gun).
  `weaponModel` in `game/view.mjs` now assembles: dispatch to the registry, the
  shared muzzle/flash/`userData` tail, then the attachment/finish overlay. Every
  mesh goes through the cached `box`/`cylinder`/`ring`/`geo` helpers so
  `ModelAssets` sharing and exactly-once disposal are preserved. The old geometry
  is archived, still buildable, as `legacyWeaponModel` (`game/weapon-models/legacy.mjs`)
  and covered by `game/legacy-weapons.test.mjs`.
- New models carry 49-100 direct children and roughly 3.0-4.8k triangles each
  (up from ~1.5-3.5k) with distinct silhouettes; pinned parts (`grenade-drum`,
  `shock-emitter`, `flak-barrel`), muzzle anchors and finish/attachment behavior
  are unchanged.

Verification: game **963/963**, server **126/126**, `tests/` **5/5**, `tsc` clean,
lint 0 errors, build clean.

## Release 3.6 - Menu paint order, progression preview, 4K scaling

- **Root cause of the "invisible harness/model selection": paint order.** The app
  shell (`.shell`) was a non-positioned block, while the game canvas is
  `position:absolute`. In the CSS painting order, positioned elements paint above
  non-positioned block content, so the canvas (showing the last showcase frame)
  was drawn **over the entire menu body** — hiding the operator/harness cards and
  stealing their clicks and wheel events. `.shell` is now `position:relative;
  z-index:1`, so menus paint above the canvas again. This also explains the
  un-scrollable-by-hover unlock list and the "preview on top of the list".
- **Progression layout.** The operator preview now sits **beneath the rank/stats
  card**, and the unlock column is wider (`.progression-grid` =
  rank/preview rail · gear · 1.55fr unlocks), so the list has room and a readable
  panel background. The showcase renderer and `previewRef` now also run in
  `progression` mode so the model appears there.
- **4K scaling.** A `min-width:1800px` tier raises the shell width, type scale,
  control heights and modal sizes so the console does not sit as a small island
  on large displays.

Verification: game **962/962**, server **126/126**, `tests/` **5/5**, `tsc` clean,
lint 0 errors, build clean.

## Release 3.5 - Granular video options, scrollable menus

- **Glow is now a real setting.** Post-processing used to be gated on resolution
  scale (`>= 100%`), so the only way to reduce bloom was to lower the resolution,
  which switched glow off entirely. `postStage` no longer looks at scale.
  `DEFAULT_DISPLAY`/`normalizeDisplay` gain `postFx`, `bloom` (0–1) and `exposure`
  (0.6–1.8), and Graphics & settings exposes a post-processing toggle, a glow
  strength slider and a brightness slider. `ArenaView._syncPost` applies the
  bloom strength live (no composer rebuild) and `setDisplay` applies
  `toneMappingExposure`.
- **Menus scroll again.** `html,body{overflow:hidden}` meant the app shell had no
  scroll container, so anything below the fold (the harness column, the whole
  unlock track) was unreachable. `.shell` is now `height:100dvh;overflow:hidden`
  with `.shell-body` as the scrolling region between the sticky header and the
  action rail. This is why the harness selection and unlocks were cut off.
- **Operator model preview** continues to render through the translucent
  selection shell from 3.4.

Verification: game **962/962**, server **126/126**, `tests/` **5/5**, `tsc` clean,
lint 0 errors, build clean. `post.test.mjs` updated for the new glow policy.

## Release 3.4 - Corner stat cards, objective compass and the operator preview

- **Objective card moved out of the centre.** The top-centre command panel is
  gone. The objective now lives in a bottom-centre bar (title, action, detail
  chips) with a **compass ring** whose arrow points toward the current objective
  (waypoint > payload > zone > flag) using the radar's yaw-relative bearing.
- **Normalized corner readouts.** Health and armor are equal-sized `.stat-card`s
  in the bottom-left corner; ammo is the matching card in the bottom-right, each
  with a value and a fill bar. Streak/Arms Race pills live just above the left
  cards.
- **Frag + ability gauges.** The ability card and the frag (grenade) card sit next
  to ammo with radial `conic-gradient` cooldown rings; both **pop** when ready
  (`is-ready`). Frag uses the real 7s cooldown from `Match.throwGrenade`.
- **Operator preview fixed.** The selection shell had an opaque background that
  covered the canvas, so the live 3D operator model never showed. The selection
  screen now uses a translucent `.shell--showcase`, and the operator/harness
  cards remain in the loadout column as before.

Verification: game **962/962**, server **126/126**, `tests/` **5/5**, `tsc` clean,
lint 0 errors, build clean. HUD geometry/CSS is not browser-verified here; a
visual pass is advised.

## Release 3.3 - Animated boot logo, living skies and objective occlusion

- **Boot logo.** The title wordmark is now four oversized glyphs that slide in one
  letter at a time (rotating up from behind), each followed by a cyan period and
  with its word set beneath (`C. / COLOSSEUM`, `O. / OF`, `C. / COMPETITIVE`,
  `S. / SLOP`), plus a repeating sheen sweep. Letters scale with `min(vw, vh)` and
  the whole animation is disabled under `prefers-reduced-motion`.
- **Sky rendering fixed.** Root cause: the gradient dome was a fixed-origin sphere
  of radius 185 while the camera far plane is 220, so on maps wider than ~70 units
  the dome was far-plane clipped and the player saw a moving circular edge. The sky
  and mountain rig now follow the camera each frame (`ArenaView.updateSky`), which
  makes the sky read as infinite while keeping sun/stars fixed in world direction.
- **Living skies.** New deterministic `game/environment.mjs` helpers (`skyPhase`,
  `skyPalette`, `makeStarField`, `SKY_PHASES`, `NIGHT_MAPS`, `HALO_MAPS`): dark
  arenas get a night dome with 520 additive stars and a pale moon, dusk maps get a
  warm horizon, day maps stay bright, and `aether`/`skybreak` get a halo ring. The
  CPU renderer now paints a matching gradient + starfield + sun/moon disc.
- **Objective occlusion fixed.** Objective zone floor markers (`area`/`base`/
  `progress`/`emblem`) had `depthTest=false` and `renderOrder=100`, so they drew
  through bot models; they are now depth-tested and drawn in the normal order. A
  single thin, raised beacon keeps its always-visible cue so distant objectives
  remain findable.

Verification: game **962/962** (new `sky.test.mjs` + `objective-occlusion.test.mjs`),
server **126/126**, `tests/` **5/5**, `tsc` clean, lint 0 errors, build clean. No
browser/WebGL playtest: the sky is geometry/unit-verified and the CPU path is
guarded for stub canvases; a visual pass on a real GPU is still advised.

## Release 3.2.2 - Fix runtime crash in all non-race modes

- **Bug:** `PlayingHud` reads `voiceState` from the page's `ui` bag, but the bag
  never provided it. Because the bag is loosely typed, `tsc` passed while
  `voiceState.enabled` threw during render, so every mode using the default HUD
  (deathmatch, CTF, KOTH, payload, assault, horde, campaign…) hit the error
  boundary. Racing does not use that field, which is why only racing worked.
- **Fix:** provide `voiceState` (and `showcaseLive`) in the `ui` bag.
- **Guard:** new `tests/ui-contract.test.mjs` statically reads `app/page.tsx` and
  every `app/ui/screens/*.tsx` and fails if any screen references a `ui` field
  the page does not provide, so this class of bug cannot ship silently again.

Verification: game **955/955**, server **126/126**, `tests/` **5/5** (including
the new contract test), `tsc` clean, lint 0 errors, build clean.

## Release 3.2.1 - Startup shows the title screen (modal fix)

- The keep-mounted match-setup modal was visible on launch and could not be
  dismissed: `.modal--hidden{display:none}` was declared before `.modal
  {display:grid}`, so at equal specificity the later grid rule won. The selector
  is now `.modal.modal--hidden`, which properly hides the closed setup modal.
  The game now starts on the title screen with no dialog over it; the setup
  strings remain in the server-rendered HTML (the modal is still mounted).

Verification: build clean, SSR 4/4 (all pinned setup strings still present),
`tsc` clean, lint 0 errors.

## Release 3.2 - In-match HUD extraction and the settings dialog

- **In-match HUD extracted and unified.** The default (non-race/soccer) HUD now
  lives in `app/ui/screens/PlayingHud.tsx` instead of inline in `app/page.tsx`.
  Every legacy class and DOM anchor is preserved so the existing stylesheet still
  applies, and the three centre announcement layers (kill banner, kill callout,
  objective/sudden-death/score announcer) are now **arbitrated into a single
  slot** by priority: sudden-death > match-start > score > kill callout > kill
  banner. `GameChat`, `TouchControls` and the scoreboard overlay stay in the page
  and continue to share the HUD frame.
- **Settings dialog rebuilt** (`app/ui/screens/SettingsDialog.tsx`) on the `Modal`
  primitive with tabs: Game (the existing `prefs` node), Arsenal (weapon cards
  with range chips) and About. The duplicated keybind table was dropped and the
  Radix `Dialog` wrapper removed (settings is now an `app/ui` modal).
- **Layering retained** from 3.1: combat feedback sits above panels; touch mode
  lifts the bottom readouts above the thumb lane.

Verification: game **955/955**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean. The HUD is a structural extraction with class/anchor
compatibility verified by `tsc`/build only; a browser playtest is still advised
for feel (announcement timing, touch spacing).

## Release 3.1 - Modals, theater and HUD layering on the new design system

- **Modals rebuilt** on the `app/ui` primitives: match setup (two-column arena
  cards + rules, sticky footer, still mounts `MatchConfiguration` hidden so the
  SSR-pinned strings survive), single-player (segmented Horde/Campaign with a
  briefing pane), pause (actions + settings two-column), results (tabs for
  scoreboard / your stats / awards with a sticky action footer), and first-run
  onboarding. Old inline modal markup is gone from `app/page.tsx`.
- **Theater rebuilt**: recorded matches are now a responsive card grid instead of
  full-width rows, and playback uses a safe-area dock with a single transport
  row and a camera-rig chip rail.
- **HUD layering fixed**: combat feedback (crosshair, hitmarker, damage numbers,
  damage direction/flash, reload, posture) now sits at `--z-board`, above the
  command panel/announcer layer, so HUD panels can no longer paint over it.
  On touch screens the bottom readouts lift above the thumb lane
  (`.game-hud.touch-mode`) and the bottom note is hidden.
- **Reactive net state** from 3.0 is extended to the new lobby/results screens.

Verification: game **955/955**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean. No browser/WebGL playtest: the modal/theater layouts are
type/SSR-verified, and the HUD layering is CSS-only.

## Release 3.0 - Ground-up menu redesign (new app shell + design system)

- **New design system.** `app/ui/primitives.tsx` (`Shell`, `TopBar`, `PageHead`,
  `Panel`, `Btn`, `Segmented`, `Tabs`, `Stats`, `Field`, `Chip`, `Meter`,
  `Empty`, `Banner`, `Modal`, `ActionRail`, `SelectCard`) plus the namespaced
  `ui-*` / `shell-*` / `panel-*` / `btn-*` stylesheet in `app/styles/ui.css`,
  imported from `app/globals.css`. It builds on the 8px spacing scale, tokenized
  type scale, two-surface/two-elevation rule and the `--z-*` layer scale.
- **Menus rebuilt from scratch** (the old inline markup is set aside as legacy,
  see `app/legacy/README.md`):
  - `TitleScreen` — single primary enter action, in-flow meta chips, worldmark
    scaled by `min(vw, vh)` so it fits short landscape viewports.
  - `SelectionScreen` — the elastic column is now the interactive loadout instead
    of the decorative preview; operator/harness/map are real grids; a single
    sticky `ActionRail` always shows the summary and `ENTER ARENA` (never below
    the fold); secondary modes are grouped as small rail buttons.
  - `ProgressionScreen` — the previously-empty reserved column is gone; rank
    rail + tabbed gear (Gear/Mods/Skins/Reticles) + unlock track, no nested
    scrollbar.
  - `BrowseScreen` / `LobbyScreen` — one primary per screen, tabbed create/history,
    3-column lobby (players / chat+voice / match control) reading a **reactive
    net snapshot** instead of stale `runtime.current.net` ref reads.
- **Runtime reactivity fix.** `page.tsx` now publishes `netInfo` (connected,
  peerId, hostId, isHost, started, spectate, actorId, roundOver, roomId) from
  every `wireNet` callback, so the lobby/results labels can no longer go stale.
- **Compatibility held.** The legacy `app/game-ui/*.tsx` and
  `game/scoreboard.mjs` contracts are untouched, so
  `game/race-ui.test.mjs` / `game/touch-ui.test.mjs` / `game/scoreboard.test.mjs`
  still pass, and `tests/rendered-html.test.mjs` still finds every required SSR
  string on the new selection screen. The deploy version parser
  (`scripts/read-version.mjs`) still finds the `title-footer` marker in
  `app/page.tsx`.
- **Still legacy / next phase:** match-setup, single-player, pause, results,
  settings and onboarding modals, the theater screens, and the in-match HUD are
  unchanged. `app/legacy/README.md` records the boundary.

Verification: game **955/955**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean. No browser/WebGL playtest in this environment: the new
layouts are type/SSR/markup-verified and worth a visual pass on desktop and
phone.

## Release 2.81 - Design system, HUD unification and mobile/safe-area fixes

- **Design tokens.** `app/globals.css` `:root` now carries the full semantic
  set (surfaces, text tiers, accent/warn/danger/info, borders, radii, elevation,
  font families and a `--z-*` layering scale) and the Tailwind v4 `@theme inline`
  block maps the shadcn/Radix tokens that were previously undefined
  (`popover`, `accent`, `border`, `destructive`, `muted-foreground`, `card`,
  `secondary`) so select/radio/slider primitives render with the mint palette
  instead of unresolved colours.
- **Shared HUD primitives.** One structure now backs every in-match mode:
  `.hud-strip`/`.hud-cell` (top metrics), `.hud-panel` (edge panels),
  `.hud-bar` (progress tracks), `.hud-count` (countdown) and `.hud-note`
  (help line), each scoped by a per-mode `--accent` (race/soccer keep amber,
  single-player stays mint). Race, soccer and single-player HUDs were migrated
  to these primitives.
- **Previously unstyled elements.** `.audio-caption`, `.grenade-chip`,
  `.soccer-standings`/`.soccer-score-row`/`.race-standings` and the inline
  spectate camera panel now have real rules; the spectate panel's inline styles
  were moved to CSS.
- **Mobile + safe areas.** `.touch-layer` no longer swallows taps
  (`pointer-events:none`, with only the stick/buttons/look surface interactive)
  and the voice dock, spectator return, spectator board and open chat were
  raised above it. Safe-area insets now cover the command panel, radar, ladder/
  streak/posture chips, kill feed, race metrics/help and every `.sp-*` panel.
  On phones the race/soccer help line flows under the wrapped metric strip
  instead of colliding with it, and the single-player panels stack at the top so
  the bottom stays clear for touch controls.
- **Accessibility + correctness.** The single-player modal and onboarding now
  participate in the Tab focus trap and Escape handling (they previously did
  not); the spectator target board uses valid roles (a `group` of buttons, not
  `listitem` buttons); the title start control is a real `<button>`; back
  affordances use left-pointing icons; the match-setup section is numbered
  `03` consistently; and the per-frame `data-snapshot` JSON attribute was removed
  from the canvas (perf + no leaking full state into the DOM).

Verification: game **955/955**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean. No browser/WebGL playtest in this environment, so spacing,
touch ergonomics and the new palette are unit/layout-verified and the rendered
soccer/race/single-player HUDs are covered by the existing render tests; a visual
pass on a real phone is still advised.

## Release 2.80 - Enemy tuning and a non-overlapping single-player HUD

- **Varied, softer enemies.** Every enemy deploy now rolls a per-actor speed
  spread (`ENEMY_SPEED_VARIANCE`, +/-22% around the class base) so a wave mixes
  rushers and stragglers. Enemy firepower was damped across the board: Husk
  damage x0.32 / melee 8, Spitter x0.40, Brute x0.75, WARDEN x1.0. The profile
  flows through `gearDamage` in `Match.spawn`, so it applies to every shot and
  the melee path uses `actor.meleeDamage`.
- **Edge-anchored HUD.** `SinglePlayerHud` no longer borrows the race HUD (which
  overlaid the top match bar and the bottom vitals). It now has its own `.sp-hud`
  layout: the objective chain sits on the left edge, a compact status strip
  (objective/wave, hostiles, lives, kills, waypoint distance) runs along the top
  edge under the match bar, boss and hold bars sit directly beneath it, and story
  lines sit low-centre above the bottom HUD. The centre viewport stays clear and
  the redundant full-width control hint was removed. Responsive rules move the
  objective panel to the left-bottom on narrow screens and hide the step list.

Verification: game **993/993**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean, live deploy verified. New tests assert the speed spread
stays inside its variance band and that enemy damage lands below 1x on the
weapon pipeline. No browser/WebGL playtest, so the exact edge spacing is
unit/layout-verified only and worth a visual pass.

## Release 2.79 - Single-player campaign as a distinct, story-driven mode

- **Distinct enemies.** `game/enemy-types.mjs` defines frozen enemy classes
  (`husk` 30 HP melee swarmer, `spitter` 45 HP ranged, `brute` 140 HP heavy,
  `warden` 450 HP boss) that are far weaker than normal bots and carry their own
  behaviour profile. `Match.spawn` now honours `actor.npcProfile` (health,
  armour, speed/damage multipliers that survive respawn), `Match.melee` honours
  `actor.meleeDamage`, and `botInput` swaps `botBehavior` for `enemyBehavior`
  per `actor.npcType` with a melee-only branch. All hooks are inert for
  multiplayer actors, so bots are unchanged.
- **Linear story runtime.** `game/singleplayer.mjs` gained a step machine:
  ordered objectives with an in-world waypoint, `onStart`/`onComplete` actions
  (story lines, objective text, typed enemy groups, win/lose, checkpoints) and
  completion rules `enter-zone`, `group-dead`, `boss-dead`, `timer`, `hold`.
  Campaign missions start the player at an authored `{x,z,yaw}`, and the runtime
  exposes `match.waypoint` for world/radar/HUD guidance and a story line queue.
- **Big-map missions.** `game/campaign-data.mjs` was rewritten with two full
  levels: *The Long Haul* on `convoy-line` (152 m west-depot→east-yard escort
  with a bridge hold and a Yardmaster) and *Reactor Run* on `titan-valley`
  (outpost → reactor → cavern hold → south outpost → Warden). Enemies deploy
  from authored coordinates that snap to the navigation graph.
- **Local progression.** `game/campaign-progress.mjs` stores unlocks, best
  time/score and a checkpoint under `token-arena-campaign`; the picker locks
  missions until the previous one is cleared and the results screen offers
  **NEXT MISSION**.
- **Presentation.** `ArenaView.styleActor` scales/tints enemy models by class,
  `ArenaView.updateWaypoint` renders the objective beacon, radar gained a pinned
  waypoint blip, `SinglePlayerHud` shows objective steps, waypoint distance,
  hold/Warden bars and the current story line, and the briefing lists the
  mission's intro lines and objectives.
- **Hardening.** `server/room.mjs` rejects single-player modes from network
  hosting.

Verification: game **991/991**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean, live deploy verified. New tests cover the enemy classes and
behaviour differentiation, campaign data well-formedness (unique ids, valid
enemy types, large maps), local progress/unlocking, the linear runtime (start
position, waypoints, story, themed spawns, both missions played to a win) and
the HUD display adapters. `map-layout` validates every arena and the all-mode
loops still complete. No browser/WebGL playtest, so enemy pacing, mission
difficulty and waypoint visibility are unit-verified only.

## Release 2.78 - Single player: Horde and Campaign

- Two new modes, `horde` and `campaign`, join the registry with `team:true` so a
  lone human (team 0) is hostile to NPCs (team 1) with friendly fire off.
- `game/singleplayer.mjs` drives both: `initializeSinglePlayer` trims the match to
  the player and pre-deploys campaign garrisons, while `updateSinglePlayer` runs
  each tick from `Match.step` after objectives. Horde schedules escalating waves
  (`hordeWaveSize`), pins dead NPCs out of the respawn queue and releases them
  between waves. Campaign runs a data-driven timeline (`at`/`after`/`when`
  triggers) of announcements, objective changes, NPC/ally deployments, bosses
  and explicit win/lose, then evaluates the mission condition (`eliminate`,
  `survive`, `assassinate`, `reach`, `defend`).
- `game/campaign-data.mjs` defines six missions on existing arenas with briefs,
  garrisons, bosses and scripted events. Zones snap to the navigation graph at
  init so objectives are always reachable.
- `game/config.mjs` registers the modes and carries a sanitized `mission` field;
  `game/arenas.mjs` lets both modes run on every combat arena (never the Puma
  maps). `Match` exposes the state as `snapshot().singleplayer`, `leaders()`
  returns the player, and `objectiveState.winner` flows into `snapshot().winner`.
- `ArenaView.syncActors` models and disposes NPCs added or removed mid-match (the
  local loop calls it each frame), so Horde waves and campaign reinforcements
  render without rebuilding the scene.
- UI: a **SINGLE PLAYER** entry with a Horde/Campaign setup modal, a
  `SinglePlayerHud` panel (wave/mission, hostiles, lives, kills, objective,
  scripted messages, Warden bar, defend timer) and single-player result copy.

Verification: game **979/979**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean, live deploy verified. New tests cover wave growth and wins,
NPC no-respawn/release, life loss, every campaign mission's deployment, boot-camp
elimination, Warden assassination, survive/defend timers, extraction gating,
boss/elite scaling and the HUD display/result adapters. `map-layout` validates
both modes on every arena. No browser/WebGL playtest, so NPC pacing and mission
difficulty are unit-verified only.

## Release 2.77 - Spectate bot matches with camera controls and free cam

- **SPECTATE BOTS** on the title screen starts a local all-bot match from the
  current Match Setup config and drives the camera entirely with the cinematic
  director (`game/spectate-build.mjs` forces every actor to AI and warms the
  match, mirroring the menu showcase).
- `game/camera-modes.mjs` adds `CAMERA_MODES` (`auto`, every director rig, `free`),
  labels, `cycleCameraMode` and `cameraModeRig`. `CinematicDirector` gained an
  `autoCut` option/setter so a spectator can lock a single rig instead of the
  director re-picking on every cut.
- `ArenaView` gained a **free-fly camera**: `setFreeCam`/`freeLook`/`updateFreeCam`
  (yaw/pitch movement, vertical, boost), a `setDirectorLock`, and a render branch
  that takes priority over the director and the race chase override. Disabling
  free cam (or cinema/dispose) resets the state.
- Controls: `B` cycles camera mode, `[`/`]` cycle the followed bot, `F` toggles
  free cam; WASD/Space/Ctrl/Shift fly and the mouse looks. The spectator reuses
  the existing `playing` mode with a local flag so pointer-lock, HUD and render
  plumbing stay intact.

Verification: game **964/964**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean, live deploy verified. New tests cover the all-bot builder,
director rig locking, the camera-mode cycler and the free-cam render path. No
browser/WebGL playtest, so the free-cam feel is unit-verified only.

## Release 2.76 - Soccer ball no longer pins

The ball could sit in the same spot when a chassis resolved to exactly the contact
distance with no relative speed, so every tick re-collided without moving it
(worst between two cars or a car and a board). Changes in `game/soccer.mjs`:
- car contact now clears the chassis by a hair so the next tick is not a
  zero-length re-collision;
- a glancing hit adds a slice of the chassis's tangential speed (`BALL_SPIN`), so
  the ball deflects out of a scrum instead of being ploughed into it;
- an anti-stuck shove fires when the ball is slow while touching a car or a board
  for a second: it is kicked away from the nearest chassis (with a tangential
  component) or toward the centre, and after repeated failures it resets to the
  centre. `resetBall` clears the anti-stuck state.

Verification: game **952/952**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean. New test pins the ball between two idle Pumas and asserts it
works itself free and stays finite/on-pitch. No browser/WebGL playtest, so the
feel of the shove is unit-verified only.

## Release 2.75 - Menu demo actually rotates through the modes

The reel was built for eight modes, but two things made it look like it only ever
showed Puma Soccer:
- the `ready` settings effect re-ran `buildShowcase` once the renderer finished
  initialising, immediately replacing the opening Puma race with the second
  scenario (soccer) and restarting the reel on every settings change;
- scenarios could run for up to two minutes, and soccer's clock was the longest.

Fixes: the settings effect now keys on `legacyArenas|reducedMotion|showcase` and
never rebuilds the reel while a showcase already exists (only real setting changes
and showcase-off/on do); each scenario's limits were shortened (race is now a
one-lap sprint, combat caps at 60s) and the page force-advances after
`SHOWCASE_MAX_SECONDS` (75s) even if the bot match has not finished, so no mode
can hog the menu.

Verification: game **951/951**, server **126/126**, SSR 4/4, `tsc` clean, lint 0
errors, build clean, live verified. A headless simulation of the builder now
reports the reel as race (~21s) -> soccer -> deathmatch -> teamdeathmatch -> ctf
-> koth -> combined arms -> payload, each 43-75s. No browser/WebGL playtest.

## Release 2.74 - Puma Soccer: 2v2, pitch boards and smarter bots

- **2 v 2.** Soccer is now four Pumas total (two per side). `puma-soccer` caps at
  `maxBots:3` and the core constructor sizes the roster to `4 - humanCount`, so a
  solo player fields three bot drivers, two humans field two bots, and four humans
  field none. The pitch authors two kickoff slots per team and `initializeSoccer`
  slices to four cars.
- **Boards.** `puma-pitch` now rings the pitch with `soccer-wall` collision boards
  (both touchlines and both goal lines, leaving a goal mouth at each end) plus
  hidden `soccer-goal` collision for the posts/back; the ball also hard-clamps to
  the pitch bounds except inside the goal mouth, so it can no longer roll onto the
  circuit. Boards render with a dedicated material; goal posts/nets stay the
  hand-drawn frames.
- **Bot behaviour.** Bots now pick one attacker and one support per team (nearest
  to the ball attacks, the partner covers the line between the ball and its own
  goal), steer around team-mates and the ball pile-up, hold a stable lane offset
  to avoid head-on collisions, and reverse out after ~1s of being wedged. This
  removes the old ball-jam where every bot rammed the ball from the same spot.

Verification: game **951/951**, server **126/126**, SSR `tests/*.test.mjs` 4/4,
`tsc --noEmit` clean, `npm run lint` 0 errors, production build succeeds, live
deploy verified. New tests cover the 2v2 roster, board containment with the goal
mouth still scoring, and bot separation/stall recovery. No browser/WebGL playtest
was possible, so ball feel and board visuals remain unit-verified only.

## Release 2.73 - Menu demo shows a variety of modes

The title-screen showcase is now a reel of eight distinct modes instead of a
single Puma race: Puma Race, Puma Soccer, Deathmatch, Team Deathmatch, Capture
the Flag, King of the Hill, Combined Arms and Payload. `SHOWCASES` carries a
mode-appropriate map pool per scenario; `pickShowcase` picks an available map that
actually supports the mode, and the existing rotation rebuilds the next scenario
when the current match ends. Vehicle scenarios keep the cycling car demo camera;
combat scenarios use the cinematic director.

Verification: game **948/948** plus updated `game/showcase.test.mjs` (5/5:
variety, valid map-per-mode, mode rotation, car-mode camera, full-race restart),
SSR `tests/*.test.mjs` 4/4, `tsc --noEmit` clean, production build succeeds. No
browser/WebGL playtest was possible; the reel is unit-verified only.

## Release 2.72 - Puma Soccer

New `puma-soccer` team mode on the `puma-pitch` map (the Puma Circuit with its
infield opened into a pitch).

- `game/soccer.mjs` implements deterministic 60 Hz car soccer on the existing
  Puma substrate: 4v4 kickoff seating, race-style throttle/steer/boost/brake
  controls, a ground-locked ball with friction and car-contact impulses, swept
  goal-line detection, goal/time endings, and per-driver goal stats. It stores
  state on `match.race` with `kind:'soccer'`, so combat is off, snapshots
  replicate it, and the server stays authoritative with no protocol change.
- `game/soccer-maps.mjs` derives `PUMA_PITCH` from `PUMA_CIRCUIT`, keeping the
  rails and apron but removing the solid infield fill, and adds goal frames plus
  kickoff slots.
- Mode/core wiring: `GAME_MODES` entry (team, score `goals`, max 8 bots),
  neutralized combat config, strict `arenaSupportsMode`, map registration, core
  `initializeSoccer`/`stepSoccer` dispatch on `race.kind`, `rankTuple`/outcome
  goals, async history recording of scores and per-driver goals.
- Presentation/client: pitch + ball + goal rendering in `race-presentation.mjs`,
  `soccerDisplay`/`soccerResult` HUD helpers, `commandBrief`/caption/scoreboard
  support, a `SoccerHud`, setup controls (team size / goal limit / time limit)
  and a soccer touch cluster.

Verification: game **948/948**, server **126/126**, SSR `tests/*.test.mjs` 4/4,
`tsc --noEmit` clean, `npm run lint` 0 errors, production build succeeds. No
browser/WebGL playtest was possible; the ball physics, pitch rendering and
balance are unit/geometry-verified only.

## Release 2.71 - Split core, bots, objectives, race presentation; chunk the client

Baseline `fa14a66`.

- `game/core.mjs` no longer owns bot AI or objective updates: `game/bots.mjs`
  (`botInput` plus `defensivePost`/`flankDestination`/`patrolPoint`/`separation`/
  `spreadBias`/`zoneSlot`/`zoneDefense`/`path`) and `game/objectives.mjs`
  (`updateAssault`/`updatePayload`/`updateObjectives`) hold them, with the `Match`
  methods now thin delegations. Bodies moved verbatim.
- `game/view.mjs` no longer owns race presentation: `game/race-presentation.mjs`
  holds `raceTrackModel` and the per-frame race sync; `ArenaView.prototype.updateRace`
  delegates and `view.mjs` re-exports `raceTrackModel`. `view.mjs` dropped from
  773 to 656 lines. The objective/marker lifecycle was left in `view.mjs` because
  it is coupled to the public `objectiveColor`, software-renderer draw ranges and
  the flag/payload models.
- `vite.config.ts` now adds Rolldown `codeSplitting` groups for the client
  (`three.core`, `three`, director/demo/progression/showcase). The largest chunk
  fell from 839kB (`post-*`) to 365kB (`three-*`); the >500kB build warning is
  gone. Scoped to the client environment so rsc/ssr/worker manifests are
  unchanged.

Verification: game **924/924**, server **123/123**, SSR `tests/*.test.mjs` 4/4,
`tsc --noEmit` clean, `npm run lint` 0 errors, production build succeeds with no
chunk-size warning. Residual note: `core.mjs`<->`bots.mjs`/`objectives.mjs` and
`view.mjs`<->`race-presentation.mjs` are runtime-safe ESM cycles; all cross-module
access is inside called functions.

## Release 2.70 - Module extraction, map schema and async persistence

Follow-up to the audit release. Baseline `7c1769d`; commits for this pass.

- Tests no longer parse `app/page.tsx`. `buildShowcase` moved to
  `game/showcase-build.mjs`, `renderScoreboard` to `game/scoreboard.mjs`, and the
  game-chat and race-HUD JSX to `app/game-ui/game-chat.tsx` and
  `app/game-ui/race-hud.tsx`; `game/race-ui.test.mjs` and
  `game/showcase.test.mjs` import them directly. `rg "app/page.tsx" game/*.test.mjs
  tests/*.test.mjs` returns nothing.
- Added `game/map-schema.mjs` and moved the duplicated `freeze`/`wall`/`cover`/
  `pad`/`tp`/`zone`/team/flag builders onto it; teleporters normalize to a
  canonical `target` field. Emitted map data was diffed against the pre-refactor
  snapshot and is identical apart from the intended `to` -> `target` keys.
- History and progression persistence is now async and coalesced: `record`/
  `award`/`setGear` update memory and schedule a single in-flight atomic write,
  with `flush()`/`whenPersisted()` for quiescence and graceful shutdown. Match-end
  writes no longer block the simulation tick.

Verification: game **924/924**, server **123/123**, SSR `tests/*.test.mjs` 4/4,
`tsc --noEmit` clean, `npm run lint` 0 errors, production build succeeds.

## Release 2.69 - Whole-codebase audit: security, correctness, architecture

Baseline `685b99f`; findings consolidated in `IMPROVEMENT_PLAN.md` from seven
read-only audits. Shipped across commits `590f0a1`, `a7441d9`, `20e21db`,
`2130048`, `7c1769d`, `51c6c37`.

Security and lifecycle:
- Progression is now bound to a server-issued secret token instead of a
  client-chosen `playerId`; a wrong token gets a fresh identity and can never read
  or write another profile. Connected profiles are pinned against LRU eviction.
- Essential server messages coalesce by type instead of FIFO-evicting
  `welcome`/`start`/`results`; control frames are rate-limited, clients are capped,
  and dropped event batches rewind `lastSerial` so the delta is resent.
- Deploy now backs up `dist/`, health-gates both systemd units, verifies assets and
  rolls back on failure; nginx/Next add CSP and security headers; the app has
  route-level and global error boundaries.

Correctness and performance:
- Fixed the Arms Race finisher award, bot melee, on-foot interact movement,
  self-kill stats, void kill-feed timestamps, weapon-finish rendering and online
  finish/gear plumbing, local race coins, next-arena mode safety, renderer-init
  recovery, connect-before-open hangs and malformed-snapshot crashes.
- Payload objective credit now uses the cart stand check; leaders rank objective
  modes correctly and share one implementation; navigation construction is
  faster and bots use the filtered nav graph; supply placement no longer stacks;
  demos are event-capped and compressed; radar labels/progress and underbarrel
  meshes render.

Architecture and cleanup:
- Extracted shared `game/math.mjs`, `game/protocol.mjs`, canonical team palettes,
  and a single ranking API; cached core traversal tables and coalesced server
  event clones and snapshot quantization.
- Removed 57 unreachable shadcn components, dead scaffolding (`chatgpt-auth`,
  drizzle/db/examples/vendor), unused dependencies, dead map/generator fields and
  the unused lag-compensation path.
- Lint is now a real gate (0 errors; remaining client-interop findings are
  warnings) and `.github/workflows/ci.yml` runs typecheck, tests, build and lint.

Verification: game **916/916**, server **123/123**, SSR `tests/*.test.mjs`
**4/4**, `tsc --noEmit` clean, `npm run lint` exit 0, production build succeeds,
and the live deploy verified v2.69 (HTML + 9 assets 200; web and game services
active; game-server HTTP 200).

Known gaps not addressed in this pass: the `core.mjs`/`view.mjs`/`page.tsx`
monolith split, full map-builder schema consolidation, client code-splitting/CSS
decomposition, replacing the TSX-source-parsing tests with importable units, and
moving match-end persistence off the simulation tick. No browser/WebGL playtest
was possible, so visual and balance claims remain unit/geometry-verified only.

## Documentation drift and headless tests - 2026-09-13 (unreleased)

- README drift corrected: `game/data.mjs` documents **five** powerups (haste,
  overcharge, overshield, recon, cloak) instead of three; the pickup list names all
  ten weapons; the false "there are no touch gameplay controls" line is replaced
  with the actual coarse-pointer behavior; and a release-status banner near the top
  points at this file and the `app/page.tsx` footer version (v2.68). Historical
  version notes are untouched.
- `DEVPLAN.md` and `SPEC.md` now carry a prominent historical-baseline banner
  pointing here; their v1.4-era five-weapon/three-arena history is preserved.
- New headless tests: `game/environment.test.mjs` checks that the sky dome,
  instanced mountains and instanced terrain scatter build finite, environment-tagged
  scene graphs, skip missing/unsupported terrain, and do not throw with
  reduced-motion options; `game/battle-maps.test.mjs` checks the four battle maps'
  unique ids, in-bounds geometry, clear spawns/objectives/supplies and vehicle
  clearance where vehicles are declared. **13/13 pass**.
- `server/network.test.mjs` flake fix: room-list assertions now poll for room
  expiry/creation to settle (`waitForRooms`) instead of sleeping a fixed 1600 ms,
  and the two-room simultaneous-match result wait is 90 s. `node --test
  server/network.test.mjs` **12/12**.
- Limits: no browser/WebGL/GPU verification was performed; these are headless
  smoke and metadata checks only.

## Release 2.65 - Payload pig, objective clarity, bot variety

- Fixed local objective rendering: view now reads `objectives ?? objectiveState`, so
  KOTH/domination/assault markers and the payload render in offline play, not only
  over the network. The payload is rebuilt as a ~2.5m floating pig with bob, wing
  flap and beacon (all reduced-motion gated), a ground ring, and a distinct radar
  contact. Active assault sectors are highlighted and labelled; zones carry A/B/C.
- Slowed payload pacing from `total/30` (rounds ended in 14-68s) to a bounded
  `total/150` clamped `[1.5,4.0]`, giving ~67-123s full routes on the tested maps,
  and payload push time now accumulates `objectiveTime` so CART TIME is live.
- Assault now builds exactly `config.fragLimit` (1-9) sectors, credits
  capture/objective-time stats, and the HUD/scoreboard show the objective.
- Arms Race ranks by ladder (not frags) in `leaders()`, sudden-death/tie-break,
  `actorWon`, and history `leaderRank`, so a lower-ladder player cannot win on the
  clock. CTF flags dropped unsupported over the void now fall back to the carrier's
  last solid position or base instead of soft-locking the objective.
- Objective clarity: `commandBrief` keys on objective kind, adds Combined Arms
  (zone control) and Arms Race (ladder) branches, and instagib/rockets/arsenal name
  their frag target; `matchStartBanner` includes the goal; assault/combined-arms/
  arms-race scoreboards gained objective columns and team banners; setup copy added
  for frags/teamFrags/sectors/ladder and the weapon-locked modes.
- Bot variety: deterministic archetypes (rusher, flanker, defender, support,
  sharpshooter) resolved from operator role + harness personality + slot jitter,
  wired into engagement band (with hysteresis), strafe patterns, weapon-band
  preference, replan tempo, objective focus and retreat; difficulty still owns
  accuracy/reaction/tempo. Added `game/bot-archetypes.test.mjs`.
- Verification: full game suite **848/848**, server **118/118**, focused
  wave-one suite **204/204**, bot suite **80/80** plus a 96-test smoke, and
  `tsc --noEmit` clean. No browser/WebGL playtest of the pig or live balance.

## Release 2.64 - Kart items, coins and boost pads

- Expanded the item set from four to eight: Turbo, Shield, Oil Slick, Homing
  Pulse, Mine (stationary harder-slow trap), Triple Pulse (next three ahead),
  Lightning (all ahead), and Star (speed + immunity to every slow). Position
  weighting was retuned so the leader draws mostly defensive items and the
  trailer draws catch-up items (catch-up mass ~0.26 leader vs ~0.78 trailer).
- Added coins: each gives +1.2% top speed up to +12% at ten, and a slow hit
  drops two. Added always-on boost pads that grant a free short turbo on contact
  with a per-racer cooldown. Item boxes increased from six to ten.
- Track now authors 10 boost pads, 24 coins and 10 item boxes, all floor 0,
  clear for a 2.1-radius car, away from rails, and inside the racing line; boost
  pads are >=6 units apart. Snapshot exposes `race.coins`, per-racer `coins`, and
  `effects.star`, and hazards carry `type` (oil or mine).
- Rendering: flat glowing chevron boost pads oriented along the centerline,
  spinning gold coins that hide/dispose when collected and freeze under reduced
  motion, and a distinct spiked mine model vs the oil slick.
- HUD: race metrics gained a COINS readout, and item/effect text uses friendly
  labels for all eight items, including active Star time.
- Verification: focused race/map/render/UI/network suite **147/147**; full game
  suite **820/820**; server **118/118**; `tsc --noEmit` clean. No browser/WebGL
  playtest of the new visuals or a live driving balance pass.

## Release 2.63 - Race balance, collisions, track render, demo camera

- Balanced the race so the early leader is catchable: a clamped rubber-band pace
  (0.93 leader .. 1.10 trailer) applies to bots and humans, and each racer has a
  seeded skill factor (0.95-1.05) and racing-line offset so bots do not drive one
  identical line. Six fixed seeds produced multiple winners; the pole racer won
  0/6 in the fixture, versus a deterministic runaway before.
- Cars are solid. A guarded pairwise contact resolver pushes overlapping Pumas
  apart to a 3.4-unit separation along the contact normal and equalizes their
  normal velocity without pushing either into world geometry. After a 10 s race
  no pair overlaps (max residual 0.02 units), all positions stay finite, and the
  eight grid slots start 6.0 units apart. No grid nudge was needed.
- Mystery-box item rolls are position-weighted: the leader draws mostly shield/oil
  and the trailer mostly turbo/pulse (8k seeded draws: trailer catch-up items
  74.5% vs leader 24.8%), replacing the uniform roll.
- Fixed the flat-wall artifacts: the track no longer renders ~470 overlapping
  2x2x2.6 collision boxes. Rails are hidden collision boxes and the walls/stripes
  are drawn as continuous merged barrier geometry from `race.boundary` (outer and
  inner polygons, 12 points each). Collision boxes still seal the perimeter for a
  2.1-radius car with no car-sized gaps.
- The main-menu demo camera now alternates every 7 s through chase, orbit, flyover
  and trackside, rotating the featured car each segment, with damped transitions
  and a reduced-motion chase fallback. Non-cinematic local races keep the chase.
- Verification: focused race/camera/render/network/map suite **133/133**; full
  game suite fixed three fixture regressions caused by the race-only circuit
  (generic combat tests now skip maps with `arena.race`; the next-gen per-mode
  count excludes the dedicated `puma-race` circuit) and then passed **806/806**;
  server **118/118**; `tsc --noEmit` clean. No browser/WebGL playtest of wall
  geometry or the demo camera; collisions are sim-verified, not device-verified.

## Release 2.62 - Puma Circuit menu and deployment

- Main-menu showcase now runs only Puma Circuit: eight AI drivers, two laps,
  four seconds of fixed-tick warmup, and automatic restart after the finish.
  Cinematic title rendering uses the vehicle chase camera; menu diagnostics are
  exposed under `window.tokenArenaSnapshot().showcase`.
- Preserved disabled-showcase, reduced-motion and software-renderer fallbacks.
  Showcase/race-UI/view regression run passed **41/41**, including repeated
  completed races and title rendering without a local gameplay match.
- Release review caught and fixed an online race chat trap: T/Enter previously
  opened chat state while the race HUD omitted its input. Race and combat now
  share one visible chat panel. Updated race UI tests passed **12/12**.
- Reproduced the live CSS failure: the running web process referenced the deleted
  `/assets/index-Mzs69FxE.css`, which returned HTTP 502; service logs showed
  ENOENT for that stylesheet and old JavaScript chunks. The cause was rebuilding
  `dist` without reloading the running asset manifest, not invalid CSS syntax.
- Added `npm run deploy` to pair build/restart with public linked-asset checks,
  optionally restarting the game server. Deployment verifier tests **3/3** catch
  missing CSS, stale release HTML and HTML fallback responses for asset requests.
  Rendered-HTML tests now also check local build asset existence.
- This release includes the preceding map, gameplay/control and racing changes
  described below. Their unreleased labels record their original verification
  state before this combined release.

## Puma Circuit racing - 2026-09-13 (unreleased)

- Added `puma-race` and exclusive `puma-circuit` map: a closed flat circuit with
  continuous solid boundaries, distinct infield/apron, eight Puma grid slots,
  twelve checkpoint gates and six respawning mystery boxes. Vehicle-sized sweeps
  validate lane/corner clearance and authored navigation connects the full loop.
- Race-only simulation auto-mounts drivers, caps humans plus bots at eight, runs
  a three-second countdown and bypasses combat. All racers share chassis tuning.
  Ordered swept crossings include direction, gate width and height validation;
  reset teleports cannot score. Finish order resolves sub-tick crossing times.
- Turbo, Shield, Oil Slick and Homing Pulse use one held slot and rising-edge
  activation. Normal chassis boost and handbrake work offline and online.
  Checkpoint recovery preserves progress and imposes a two-second wait.
- Bots drive actual laps on the registered circuit without recovery resets in
  the deterministic completion test. The UI defaults to seven rivals on mode
  entry and exposes 0-7 rivals, without advertising unused combat difficulty.
- Race HUD, mobile actions, chase camera, numbered gate frames, checkered start,
  grid markings, item boxes and oil hazards are integrated. History names and
  winner awards handle actor IDs, including zero, rather than team/frag scores.
- Race clients do not construct an invalid single-racer prediction shadow.
  Server-authoritative snapshots interpolate all cars and preserve countdown,
  items, standings and slot-seven reconnect state. Held handbrake stays held;
  held item activation cannot consume a newly acquired item without release.
- Initial integrated race/config/network/history check: **102/102 passed**.
  Updated race UI/configuration/geometry tests: **10/10 passed**. Registry,
  presentation, touch, replay and progression check: **57/57 passed**, including
  all **35 maps / 256 supported map-mode combinations**. Full server suite:
  **118/118 passed**. Typecheck, final production build and rendered HTML
  (**1/1**) passed. The existing large-client-chunk build warning remains.
- Race setup avoids infantry navigation construction; independent public track
  navigation uses authored nodes instead of scanning the full arena. Isolated
  diagnostics reduced that validation from about 31 seconds to under a second.
- Limits: cars deliberately ghost rather than ram; the round ends at the first
  finisher and remaining racers are DNF. Multiplayer steering is interpolated,
  not locally predicted. No browser/device driving or high-latency playtest yet.
  Earlier uncommitted map/control repairs remain intact; no commit or deployment.

## Gameplay and controls improvements - 2026-09-13 (unreleased)

- Piercing rounds now continue beyond the first victim, with remaining weapon
  range and world occlusion enforced. Tests cover aligned victims, walls and
  targets beyond range.
- CTF pickup, return and capture require vertical proximity. Flag height follows
  the carrier and survives drops, events and snapshots. Drops select support
  below their actual position rather than teleporting onto nearby wall roofs;
  elevated bases and blocktop drops remain usable.
- Offline number-key, wheel and touch weapon selection now queues the same
  simulation input as multiplayer, preserving reload cancellation and equip
  delay. Rapid cycling starts from the pending selection.
- Mouse and touch fire/ADS holds are independent; touch fire taps latch until
  the next simulation tick. Pause/blur clears both sources and push-to-talk.
- Added the missing rendered GRENADE touch button, with an actual TSX-rendering
  test covering every declared touch action. Explicitly disabling touch controls
  persists on touch devices, and touch look respects ADS sensitivity.
- Occupied-key remapping swaps the two actions atomically and explains that
  behavior in settings, instead of silently normalizing away the user's choice.
- Spectator target buttons accept pointer input and have 44px minimum heights.
  An on-screen Return to Lobby button remains available with the HUD hidden.
  Spectator shortcuts precede voice handling, ignore repeat, and hidden HUD state
  no longer leaks into ordinary play.
- Final affected gameplay/input/rendering suites: **148/148 passed**. Full server
  suite: **110/110 passed**. Rendered HTML: **1/1 passed**. Typecheck and production
  build passed. The full game
  suite was not repeated after the preceding map pass; verification here targets
  the changed systems. Existing large-client-chunk build warning remains.
- No browser/device interaction playtest, commit or production restart performed.
  Pause-dialog focus management and remaining hardcoded remapped-key HUD prompts
  were identified by the audit but are outside this batch.

## Map layout repairs - 2026-09-13 (unreleased)

- Generated layouts now include short doorway and tunnel navigation chains and
  a 4m scaffold. Required placements must have actual bidirectional walking
  connections to retained navigation, not merely a nearby node across a wall.
- Frost Gate, Titan Valley and Convoy Line base doors face inward. Frost Gate's
  central approach is protected from solid props; Riverbend and Catacombs tunnel
  approaches are realigned. Forge workshop spawns connect through their doors.
- Final generated placement repair uses triangulated runtime terrain, includes
  decks, walls and late-added cover, repairs flags, and rejects exhausted repairs.
  Slagworks' ground objective is outside its deck-enclosed pocket.
- Automatic team supplies and cover have mirrored partners. Exchange, Foundry
  and Crosswire have explicit mirrored team spawn pools; Crosswire KOTH uses the
  north objective rather than favoring the west team through array-order ties.
- Launchpad launchers clear the reactor and land opposite their source, with
  authored bot links and sampled physical flight tests at 60/120/240 Hz.
  Launchpad, Citadel, Ironfall, Skybreak and Aether pickups/landing positions were
  cleared of navigation margins and solids. Skybreak/Aether authored spawn pools
  no longer depend on runtime emergency relocation to escape walls.
- Runtime payload routes follow clearance-validated walking edges and ground
  height, including Blood Gulch's hill and Convoy Line's obstacles. Checkpoints
  remain independent of path bends. Ironfall Megastructure and Longreach Plateau
  no longer advertise Payload because their crossings require launchers over void.
- Verified routes are cached for immutable runtime navigation identities, with
  independent per-match mutable state. Warm Riverbend/Convoy Match setup measured
  roughly 7-21ms instead of 1-1.7s; first-use route validation is still synchronous.
- `game/map-layout.test.mjs`: 34 maps, 255 supported map/mode combinations,
  10,258 placement inspections deduplicated to 976 distinct positions. Checks
  original spawn pools and final actors, objectives, flags and pickups against
  support, clearance, exact walking connectors and outward/return graph reach.
- `game/payload-layout.test.mjs`: all 19 advertised payload maps pass continuous
  ground/clearance and grounded-escort delivery checks; obstacle, curved-ground,
  disconnected-route and cache-isolation fixtures are included.
- Final gates: full game **734/734**, server **110/110**, rendered HTML **1/1**;
  `npm run typecheck`, production build and whitespace checks passed. Build still
  reports a large-client-chunk warning. No service restart or deployment performed.
- Limits: no browser/WebGL playthrough, statistical side-swapped win-rate study,
  or exhaustive vehicle swept-volume audit. Resource/spawn symmetry and connected
  objectives address structural advantages, not proof of complete combat balance.

## Bug-fix pass 2.61 - 2026-09-12

Three parallel read-only audits of the new features, input/UI wiring and core
lifecycle produced these fixes, each with a regression test verified failing
against the pre-fix source:

- Arms Race: ladder/weapon/ammo persist across respawn; weapon pickups do not
  bypass the lock; bounty frags (and any non-frag score mode) cannot end the
  match before the ladder finishes.
- Scoring: simultaneous objective score-limit ties are no longer awarded to
  team 0; assault breaches no longer inflate `teamScores` to the target.
- Actor lifecycle: death and falling clear `zipRide`/`traversalFlight` and reset
  the streak; spawn clears stale traversal cooldown/pad/event and `burstLeft`.
- Mutators: random loadout respects unlimited ammo.
- Keybinds: normalization is duplicate-free, reserved shell keys are rejected,
  the options list is shared with validation, `voice` is remappable, and the
  pause/settings legend derives from the active binds.
- Misc: grenade is a latched one-shot server edge; `radarContacts` preserves the
  requested range on invalid frames; `ladderStatus` distinguishes the final
  rung; preset buttons have accessible names.
- Suites: full game **665/665**, server **110/110**, SSR 1/1, build/`tsc` clean.

## Remappable keybinds 2.60 - 2026-09-12

- Pure `keybinds.mjs` (`normalizeBindings`, `actionForCode`,
  `bindingConflicts`, `DEFAULT_BINDINGS`) with validation, duplicate fallback
  and an 8-entry-safe default set. `controlsFromState`/`posture` accept a
  binding map; the page loads/saves bindings and edits them from a Controls
  panel. Tests cover normalization, duplicates, resolution and remapped
  movement/jump. Full game 654/654, server 109/109, SSR 1/1, build/`tsc` clean.

## Spectator controls 2.59 - 2026-09-12

- `spectatorBoard` pure helper plus a target board, **P** first/third person
  (`setSpectatorThird` offsets the camera behind the target) and **H** hides
  the HUD. Unit test for the board. Full game 650/650, server 109/109, SSR
  1/1, build/`tsc` clean.

## Loadout presets 2.58 - 2026-09-12

- Pure `presets.mjs` (`normalizePreset(s)`, `addPreset`, `removePreset`,
  `findPreset`) with validation against the roster, same-name replacement and
  an 8-entry cap. A `PresetsConfiguration` panel in match setup saves/loads/
  deletes, persisted to `token-arena-presets`. Unit tests cover validation,
  replacement, capping and removal. Full game 649/649, server 109/109, SSR
  1/1, build/`tsc` clean.

## Cloak powerup 2.57 - 2026-09-12

- New `cloak` powerup and `cloak` effect key; bot target selection skips
  cloaked enemies beyond 4m and radar hides them beyond 8m unless Recon is
  active. Procedural maps include a cloak pickup. Tests: radar hide/reveal,
  timed expiry, and bot non-acquisition. Full game 646/646, server 109/109,
  SSR 1/1, build/`tsc` clean.

## Bounty and Berserk mutators 2.56 - 2026-09-12

- `bounty` heals + bonuses ending a 3+ streak; `berserk` adds +20% damage at
  a 3+ streak. Config defaults and sim behaviour covered in `mutators.test.mjs`.
  Full game 643/643, server 109/109, SSR 1/1, build/`tsc` clean.

## Ladder and streak HUD chips 2.55 - 2026-09-12

- `ladderStatus` and `streakStatus` in `hud.mjs` drive Arms Race and killstreak
  chips; unit-tested. Full game 641/641, server 109/109, SSR 1/1, build and
  `tsc` clean.

## First-run coach 2.54 - 2026-09-12

- New pure `onboarding.mjs` (`ONBOARDING_STEPS`, `clampOnboardingStep`,
  `shouldShowOnboarding`) and a dismissible selection-screen overlay persisted
  to `token-arena-onboarded`. Unit tests cover step completeness and the
  show-once/clamp logic. Full game 640/640, server 109/109, SSR 1/1, build and
  `tsc` clean.

## Arms Race mode 2.53 - 2026-09-12

- New `armsrace` mode and `proving-grounds` map (`config.mjs`,
  `nextgen-maps.mjs`, `arenas.mjs`): `ladder` per actor, promoted on each kill,
  weapon forced to the ladder rung, win on a kill with the final weapon.
  Tests cover promotion, ammo on promote, the final-rung win, ignored manual
  switches, and bots keeping their rung. Full game 638/638, server 109/109,
  SSR 1/1, `tsc` clean.

## Recon Pulse 2.52 - 2026-09-12

- New `recon` powerup (`data.mjs`) with a `reveal` effect key; `radarContacts`
  clamps out-of-range enemies to the rim while active and flags them
  `revealed`; procedural maps include a recon pickup and the blip gets a rim
  stroke. Tests: radar reveal/clamp, timed expiry, content effect-key
  validation. Full game 635/635, server 109/109, SSR 1/1, `tsc` clean.

## Killstreaks, mutators and accessibility 2.51 - 2026-09-12

- **Killstreaks** (`core.mjs`): `applyKillstreak` rewards 3 kills (heal + ammo),
  5 (Overcharge) and 7 (Overshield) and emits a `killstreak` event; streaks reset
  on death and spawn. New test `killstreak rewards land at 3, 5 and 7 kills and
  reset on death`; `killstreakCallout` shows the reward.
- **Mutators** (`config.mjs`, `core.mjs`): `randomLoadout` picks a valid spawn
  weapon with ammo; `oneShot` makes any unprotected hit lethal. Tests cover both
  and their config defaults.
- **Captions** (`hud.mjs`, `config.mjs`, `app/page.tsx`): pure `audioCaption`
  maps the event stream to caption text; an optional strip renders it. Unit test
  added.
- **HUD clarity** (`config.mjs`, `app/page.tsx`): `showKillFeed`,
  `showDamageNumbers` and `showRadar` gate their HUD elements; display defaults
  and overrides unit-tested.
- Suites: full game **633/633**, server **109/109**, SSR 1/1, `tsc --noEmit`
  clean.

## Frag HUD chip 2.50 - 2026-09-12

- `grenadeStatus` in `hud.mjs` reports readiness/cooldown; a HUD chip renders
  beside the ability HUD. New unit test `grenade status reports readiness and
  remaining cooldown`. HUD/view/SSR suites 65/65, `tsc` clean.

## Grenade, sudden death and look controls 2.49 - 2026-09-12

- **Thrown frag grenade** (`core.mjs`, `input.mjs`, `server/room.mjs`, `touch.mjs`,
  `app/page.tsx`): edge-triggered on `G`, 7s cooldown, reuses the grenade
  projectile spec (arc, bounce, fuse), blocked while mounted. Bots throw when an
  enemy is visible at 7-20m.
- **Blast fairness** (`core.mjs`): `explode`/`detonate` lift the line-of-sight
  origin and ignore cover inside 60% of the radius, so ground-level frags damage
  nearby targets. New test `the thrown frag grenade arcs, explodes on its life
  and respects its cooldown`.
- **Sudden death** (`core.mjs`, `config.mjs`, `hud.mjs`, `app/page.tsx`): opt-in
  `suddenDeath` modifier (default off) enters overtime on a tie at the time
  limit, decided by the next score, bounded to 60s. Assault/Payload excluded.
  Tests cover entry, decision, bounded clock, and that decisive matches still end.
- **Look controls** (`config.mjs`, `touch.mjs`, `app/page.tsx`, settings UI):
  `invertY`, `adsSensitivity` (0.2-1.5), `touchSensitivity` (0.3-3), normalized
  and clamped; mouse and touch both route through them.
- Suites: full game **625/625**, server **109/109**, `tsc --noEmit` clean, SSR
  1/1. New features had no pre-fix baseline (additive); the blast-LOS change was
  covered by the existing explosion/weapon suites (151/151).

## Integrity pass 2.48 - 2026-09-12

Six parallel read-only audits (modes/objectives, bots/vehicles, net/server,
render/HUD/UI, plus two feature-idea passes) produced the findings below. Every
fix has a regression test confirmed failing against the pre-fix source.

- **Payload** (`payload.mjs`): anchor-seeded waypoint selection rejects duplicates
  by distance, so checkpoints have strictly increasing positive distances and
  award nothing while idle; route y comes from terrain support. New test
  `payload checkpoints never sit at zero distance or score while idle`.
- **Modes** (`core.mjs`, `mode-data.mjs`): time-limit block guarded by `!over`;
  score-limit tie-break awards the higher score; `clearZone` uses a nearest-clear
  search at player-scale clearance (fixes the catacombs hill test); authored
  objective data is finite-guarded with a `candidatePoints` fallback.
- **Vehicles/bots** (`core.mjs`, `vehicles.mjs`): orphaned gunners dismount;
  mounted bots skip personal fire; mounted actors skip flag interaction; flight
  exits keep altitude and clear `grounded`; empty vehicles remember `lastTeam`
  for friendly-fire; occupant count ignores trailing nulls.
- **Rendering/HUD** (`view.mjs`, `hud.mjs`, `character-anim.mjs`, `director.mjs`,
  `app/page.tsx`): flag geometries live in a reset-per-arena cache and model
  disposal runs before arena rebuild; flags recolor with the active palette; the
  low-health overlay is disposed once; cinematic directors receive the app
  Reduce Motion preference and update live; spectator cycling off-by-one fixed;
  chest bank preserved alongside focus.
- **Net/server** (`net.mjs`, `room.mjs`, `game-server.mjs`, `rooms.mjs`):
  malformed frames are tolerated; racing reconnects adopt the existing seat;
  reload reset on all lifecycles; history records `match.arena.id`; essential
  backpressure entries are room-tagged; `expireAll` isolates per room.
- Suites: full game **617/617**, server **109/109**, `tsc --noEmit` clean, SSR
  1/1. All new tests were run against `git stash`ed pre-fix sources and failed.

## Reachable capture points 2.47 - 2026-09-12

- A sweep of King of the Hill across every map found Frost Gate, Slagworks,
  The Forge and Convoy Line scoring exactly zero: their capture centres were
  authored on solid bridge/catwalk decks, which the movement model cannot climb
  (no step-up; jump apex 1.42m vs deck tops 2.7-5.5m), and the nav graph has no
  nodes on decks.
- `mode-data.mjs` now clears each KOTH/Domination zone onto unobstructed ground,
  and the `Match` constructor snaps any zone whose nearest nav node is >2.5m
  away (isolated walkable pockets left bots standing just outside the radius).
- KOTH now scores on Frost Gate/Forge/Slagworks/Convoy-line/Catacombs
  (22-33 per 40s window); Domination centre points are contestable.
- New assertion `objective zones land on navigable ground on every objective
  map` (confirmed failing pre-fix: `frost-gate koth zone hill ... nearest
  6.0m`).
- Suites: broad game regression 158/158, slow game/expansion.test.mjs 9/9,
  server 107/107, `tsc --noEmit` clean.

## Titan Valley traversal + objective fixes 2.46 - 2026-09-12

- Reachability sweep of all next-gen maps found titan-valley with 4/10 team
  spawns, 2/3 capture points and 3/6 vehicles outside the main nav component,
  because the central tunnel plus base bunkers sealed the northern half. The
  tunnel now spans [-24..24] instead of [-46..46]; the map goes from 339 to 662
  main-component nodes and every spawn/objective/vehicle is reachable.
- Bot drivers dismount after 3s without progress (5s re-board cooldown) instead
  of grinding against terrain all match.
- The closest teammate now holds an owned-but-empty KOTH/Domination/Combined-Arms
  zone, so capturing teams no longer abandon hills.
- New assertions (both confirmed failing against the pre-fix map): `next-gen
  team spawns sit in the main navigation component` and `combined-arms bots
  engage on titan-valley instead of idling on unreachable ground`.
- Suites: nextgen-maps 11/11, hardening 14/14, map/traversal 67/67,
  bot/mode/vehicle 119/119, slow game/expansion.test.mjs 9/9, server 107/107,
  `tsc --noEmit` clean. Combined Arms now ends on the objective with balanced
  scores instead of zero combat.

## Clear capture points 2.45 - 2026-09-12

- `createLevel` clears any objective zone that generated inside a non-deck solid
  to the nearest clear ground before cover, nav and pickups are placed. Deck
  (bridge/catwalk) centres are preserved. A sweep of all 33 maps shows zero
  buried objective zones.
- New assertion `next-gen objectives sit clear of walls and rocks` in
  `game/nextgen-maps.test.mjs`, confirmed failing against the pre-fix generator.
- Targeted map/mode suites 121/121 and the slow `game/expansion.test.mjs` 9/9
  (which exercises full next-gen bot matches) pass.

## Settings consistency 2.44 - 2026-09-12

- The "Unlimited unlocked ammo" toggle is enabled in every mode and reflects
  `config.unlimitedAmmo` (previously shown checked+disabled outside Deathmatch
  while the config did not apply it).
- Fixed a missing `recover` field in the showcase bot literal from 2.40; this was
  a `tsc --noEmit` failure (the vinext build does not typecheck). `tsc` and SSR
  now pass.

## Spawn safety net 2.43 - 2026-09-12

- `Match.spawn` nudges an actor to the nearest clear nav point when the chosen
  spawn is obstructed or unsupported, hardening every mode/map against bad
  authored spawns.
- New assertion in `game/hardening.test.mjs` (fails pre-fix). Targeted suites
  150/150. Full suite not rerun.

## No vehicle-seat churn 2.42 - 2026-09-12

- Bots only volunteer for a vehicle when a driver/gunner seat is open; the
  passenger bail-out from 2.40 no longer causes an enter/eject loop. Blood Gulch
  CTF: 97 enter / 94 exit over 20s dropped to 3 / 0, shots rose 160 -> 289.
- New assertion in `game/hardening.test.mjs` (fails pre-fix). Targeted suites
  141/141. Full suite not rerun.

## Reachable objective slots 2.41 - 2026-09-12

- `Match.zoneSlot` now falls back to the zone centre, then nearby nav nodes, then a
  widening ring of standable ground when a captured objective's slot is obstructed
  or off the nav grid, so bots no longer stall at blocked markers.
- New assertion in `game/hardening.test.mjs` (fails pre-fix). Targeted suites
  134/134. Full suite not rerun.

## Mode and bot hardening 2.40 - 2026-09-12

- Assault and payload end on their score-limit wins instead of running to the clock.
- Zero-frag FFA is a draw; payload routes are finite and non-degenerate.
- Bots: no self-vehicle parking, gunners fire, unreachable routes no longer stall
  them, ledge guard armed from spawn, passengers eject, Roo spares teammates,
  personality strafe blends, suppression degrades aim and encourages retreat.
- New `game/hardening.test.mjs`; all 10 cases fail against the pre-fix modules and
  pass now. Targeted suites 163/163 and 66/66. Full suite not rerun.

## Titan Valley spawn fix 2.39 - 2026-09-12

- Reproduced: two Pumas spawned inside the small valley buildings, two inside the
  cavern wall rings, and a Hornet inside cover.
- Moved the four Pumas and two Hornets to collision-free coordinates (checked with
  the vehicle radius plus 0.75m margin).
- Targeted map/mode suites pass 44/44 (`extra-modes`, `mode-data`,
  `expansion-maps`, `maps`, `arenas`). Full suite not rerun.

## Rapid chaingun 2.38 - 2026-09-12

- `CHAINGUN.interval` 0.12 -> 0.045s; heat/overheat removed (`heatPerShot: 0`)
  for unlimited sustained fire.
- Dedicated `SynthAudio._chaingun` voice for `vehicle-shot` with per-shot pitch
  wobble; paired barrels still dedupe to one report.
- Targeted vehicle/audio suites pass (44/44): `vehicles`, `vehicle-gameplay`,
  `vehicle-seats`, `feedback`, `weapon-simulation`. Full suite not rerun.

## Correctness pass 2.37 - 2026-09-12

- **Movement/spawns:** team-only maps derive FFA spawns from the nav graph (ten
  reachable points); airborne actors no longer snap onto cover; idle joysticks no
  longer override WASD.
- **Vehicles:** independent gunner aim, projectile vehicle impacts, single-owner
  gun timers, wreck entry rejection.
- **Networking:** socket disposal/stale-callback gating, prediction-clock rebasing.
- **Server:** retried persistence, bounded malformed-message replies, retained
  lifecycle messages under backpressure.
- **Results/history:** authoritative team wins for Assault/Payload/Combined Arms,
  and accurate timed-vs-score-limit endings.
- **Rendering:** collision-aligned cavern openings, post-processing disposal and
  single-DPR composer sizing, app-preference reduced motion.

Verification: `npm test` exit 0 — game 589/589, server 107/107, SSR 1/1;
`tsc --noEmit` clean; build succeeds. Every regression test was confirmed to fail
against the pre-fix modules. Browser/GPU visual checks remain outstanding (no
WebGL/browser in the build environment).

## Clean cavern tunnels 2.36 - 2026-09-11

- **Bug:** tunnels rendered as full `TubeGeometry` pipes centred ~1.2m above the
  terrain, so their lower half sank into the ground (z-fighting/shimmer along the
  whole length) and their tops poked through the dome shells near the walls. The
  double-sided tube also self-shadowed, adding shadow acne.
- **Fix** (`game/view.mjs`): a tunnel is now an open stone arch built from a
  terrain-following ribbon — the path is resampled every ~5m against
  `arena.terrain.height`, and a semicircular cross-section (feet on the ground,
  apex under the cavern wall top) is extruded along it. No buried geometry, no caps
  to intersect, and the tunnel mesh no longer casts shadows.

Verification: syntax check, `tsc --noEmit` clean, `npm run build` succeeds, SSR
`tests/*.test.mjs` 1/1. GPU-browser confirmation remains the honest final check.

## Interior-aware arena tour 2.35 - 2026-09-11

- **Change** (`game/interiors.mjs`, `game/director.mjs`, `app/page.tsx`): the
  director now receives the arena's structure volumes and, when the action cluster
  is inside a building, cavern or tunnel, shrinks the flyover orbit and drops to
  eye level inside that volume instead of circling the roof. When the fight moves
  back outside it eases out again, with an 0.8s hysteresis hold so a fight near a
  doorway does not flicker between indoor and outdoor framing.
- **Pure volume math** (`buildInteriors`, `interiorAt`, `interiorCenter`,
  `nearestOnSegment`): buildings become inset rotated boxes, caverns cylinders and
  tunnels capsule segments; `interiorAt` picks the containing volume with the
  least clearance.
- **Tests** (`game/interiors.test.mjs`, `game/director.test.mjs`): volume building
  (including rotated half-extents and skipped arches), containment/rejection, and a
  tour that stays under the roof and inside the room when the fight is indoors.

Verification: interiors + director suites pass, `tsc --noEmit` clean,
`npm run build` succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation
remains the honest final check.

## Action-following arena tour 2.34 - 2026-09-11

- **Bug:** the flyover orbited the arena centre, which is frequently a central
  building or roof, so the camera circled a rooftop while the fight happened
  elsewhere; the action point was also the mean of every bot, which pulls toward
  the middle on spread-out maps.
- **Fix** (`game/director.mjs`, `app/page.tsx`): the flyover now orbits the live
  action point itself (radius ~16–30m, altitude ~14m) so the fight stays framed.
  The action point is the centroid of the **densest cluster** of nearby live actors
  (falling back to the global centroid when players are spread out), eased over
  time. The action point is computed before the rig pose so the orbit and the aim
  agree on the same frame.
- **Tests** (`game/director.test.mjs`): the action point follows a three-actor
  cluster rather than the global mean, and the returned camera pose sits within the
  tour radius of the action.

Verification: `game/director.test.mjs` 12/12, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation remains the honest
final check.

## Steady arena tour 2.33 - 2026-09-11

- **Bug:** the menu camera kept zooming in and out. Three stacked causes: the
  flyover path's radius wove ±26% (a ~30s dolly), the tour FOV oscillated ±4°, and
  the occlusion pull-in engaged on cover near the action, dollying the camera a
  long way toward the fight.
- **Fix** (`game/director.mjs`, `game/view.mjs`): the tour orbit radius is now
  nearly constant (a gentle ±12% weave), the tour FOV is fixed at 72°, and the
  occlusion pull-in is skipped entirely for tours (`director.tour`) — the high
  flyover does not need it. Non-tour playback keeps a smoothed, asymmetric pull-in
  (fast tuck-in, slow held recovery) for genuine camera-behind-cover cases.
- **Tests**: director and camera suites still pass, including the tour no-cut and
  ease-toward-action cases.

Verification: `game/director.test.mjs` + `game/camera.test.mjs` pass, `tsc --noEmit`
clean, `npm run build` succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser
confirmation remains the honest final check.

## Arena-tour demo camera 2.32 - 2026-09-11

- **Change** (`game/director.mjs`, `app/page.tsx`, `game/view.mjs`): the menu
  showcase now runs a `tour` director. A new `flyover` rig orbits the whole arena
  on a smooth looping path (weaving radius and height) and aims at the live action
  centroid instead of a specific actor. Tours disable time and highlight cuts, so
  the camera never snaps to a new bot mid-shot.
- **Smooth aim** (`_actionPoint`): the aim is the centroid of live actors with an
  exponential ease, so deaths and spawns shift the view gradually instead of
  yanking it. The occlusion pull-in now rays from that aim point.
- **Reserved rig**: `flyover` has zero selection weight, so random Theater cuts
  never choose it; only a tour sets it.
- **Tests** (`game/director.test.mjs`): a tour never cuts (including on a death
  highlight), eases toward a distant action cluster rather than snapping, and the
  flyover rig is never picked by the normal rig chooser.

Verification: `game/director.test.mjs` 11/11, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation remains the honest
final check.

## Steady demo camera 2.31 - 2026-09-11

- **Bug:** the 2.30 occlusion pull-in was throttled to every other frame, so the
  camera alternated between the blocked director pose and the corrected pose at
  ~30 Hz — a high-speed flicker between two spots.
- **Fix** (`game/view.mjs`, `game/camera.mjs`): the correction now runs every frame
  and eases a single stand-off distance (`this._camWant`) toward the clear or
  blocked value, snapping only on a director cut, and leaves the director pose
  untouched once it is effectively clear. Oscillating ray hits are averaged by the
  easing instead of flickering. The distance decision is the pure
  `occlusionDistance` helper.
- **Tests** (`game/camera.test.mjs`): `occlusionDistance` returns the stand-off or
  the full distance, clamps to the minimum and degrades safely on missing input,
  alongside the existing `clearCameraPosition` cases.

Verification: `game/camera.test.mjs` 4/4, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. GPU-browser confirmation of the menu reel is
still the honest final check.

## Demo camera line-of-sight 2.30 - 2026-09-11

- **Bug:** the menu showcase director had no scene awareness, so orbit, tripod,
  dolly and crane rigs regularly placed the camera behind walls, roofs, domes and
  terrain, hiding the followed actor.
- **Fix** (`game/view.mjs`, `game/camera.mjs`, `app/page.tsx`): the cinematic
  branch now casts a ray from the followed actor's head back toward the camera
  against the arena group and, when scenery blocks the view, pulls the camera in
  front of the obstruction and re-aims it. The clamp/aim math is the pure
  `clearCameraPosition` helper (throttled to every other frame, menu-only, skipped
  for the software renderer). The showcase orbit radius dropped from 16 to 11 and
  rig weighting now favours chase/follow/crane over ground-level tripod/dolly.
- **Tests** (`game/camera.test.mjs`): pull-in along the same ray with correct
  yaw/pitch, no-op on clear or too-close views, and a minimum stand-off.

Verification: `game/camera.test.mjs` 3/3, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. A GPU-browser look at the menu reel is still
the honest final check.

## Cavern tunnel trim 2.29 - 2026-09-11

- **Fix** (`game/view.mjs`): tunnel tubes are built centre-to-centre, so after the
  2.28 wall rework they pierced the cavern shells. Each endpoint that lands within
  1.5u of a cavern centre is now moved `min(cavernRadius, segmentLength*.9)` toward
  its neighbour, so the visible tube terminates at the wall.

Verification: `tsc --noEmit` clean, `npm run build` succeeds, `game/structures`
and `game/maps` tests pass, SSR `tests/*.test.mjs` 1/1.

## Next-gen cavern rendering 2.28 - 2026-09-11

- **Bug:** caverns rendered as a lone floating hemisphere (equator ~30% up the
  wall, open all the way around) plus a full closed tube per tunnel. On The
  Catacombs (five caverns joined by four tunnels) the loose shells and tubes read
  as one merged, connected dome mass.
- **Fix** (`game/view.mjs`, `game/structures.mjs`): a cavern now renders as a
  stone drum split into two wall arcs with two opposite entrances, capped by a
  dome seated on the wall tops. The arc angles are computed from the same
  entrance rule the generator uses for its hidden collision ring, so the visible
  openings line up with the walkable gaps. Tunnels and caverns get their own
  materials instead of forcing the shared stone material double-sided.
- **Shared rule** (`game/structures.mjs`, `game/levelgen.mjs`): the entrance rule
  (`cavernOpening`) and shell dimensions (`cavernShell`) live once so the
  generator and renderer cannot drift.
- **Tests** (`game/structures.test.mjs`): entrance segments, the two wall arcs
  avoiding every entrance, and positive/finite shell dimensions. Map suites
  (`maps`, `nextgen-maps`, `expansion-maps`, `arenas`) still pass unchanged, so
  the collision/navigation geometry is identical.

Verification: 40/40 map and structure tests, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. A GPU-browser look at The Catacombs and Titan
Valley is the honest final visual check.

## Main-menu demo reel 2.27 - 2026-09-11

- **Root cause:** the showcase handed `view` a `Match.snapshot()`, which does not
  include the event stream, and forced `view.lastEvent=0`, so `view.effect()` never
  ran and the director never saw highlights. The menu therefore showed moving
  actors with no muzzle flashes, tracers, explosions, rail beams or death effects.
- **Fix** (`app/page.tsx`): the cinematic branch attaches the live `events` array
  and the match `serial` to the showcase state each frame, and both showcase
  `setMatch` calls seed the renderer cursor with the real serial (not zero). The
  renderer now plays the same effects a match does, and `CinematicDirector` receives
  real highlights to cut to.
- **More scenarios** (`game/showcase.mjs`): the reel grew from Combined Arms and
  Instagib to six — adding Rocket Arena, Capture the Flag, Payload and Assault —
  with shorter rounds and a tighter 2.1s cut cadence so the menu rotates features.
- **Director highlights** (`game/director.mjs`): explosions, flag pickups/returns,
  captures, vehicle destructions/splatters, payload deliveries, assault breaches
  and confirmed melee hits now prompt a cut (melee whiffs do not).
- **Tests**: `game/showcase.test.mjs` asserts the six-mode reel and wrap-around;
  `game/director.test.mjs` adds an explosion/melee-highlight test.

Verification: showcase/director tests pass, `tsc --noEmit` clean, `npm run build`
succeeds, SSR `tests/*.test.mjs` 1/1. Effects are logic- and build-verified; a
GPU-browser look at the menu is still the honest final check.

## Spectator follow-target cycling 2.26 - 2026-09-11

- **Pure helpers** (`game/hud.mjs`, `game/hud.test.mjs`): `spectateActor(actors,
  targetId)` resolves the watched actor (falling back to the first live actor, then
  slot zero) and `nextSpectateTarget(actors, currentId, step)` cycles only through
  live actors in either direction. Tests cover dead-target fallback, forward and
  reverse cycling past dead actors, and the empty roster.
- **Camera** (`game/view.mjs`): when spectating, the render camera follows the
  selected target instead of always slot zero.
- **UI** (`app/page.tsx`): spectators cycle the followed actor with `[` / `]`
  (the HUD follows the same id so `FOLLOWING <name>` stays in sync) and the bottom
  HUD advertises `[ / ] FOLLOW`. The target resets to auto on a new match.

Verification: `npm run test:game` HUD tests pass, typecheck, production build and
the rendered response test green. Manual multi-client spectator playtesting on
hardware is still recommended.

## Manual reduce-motion override 2.25 - 2026-09-11

- **Display setting** (`game/config.mjs`, `game/config.test.mjs`):
  `normalizeDisplay` accepts a `reducedMotion` boolean (default false, non-boolean
  coerced to false). A test covers true/false/invalid input.
- **Runtime** (`app/page.tsx`, `app/game-ui/configuration.tsx`): the module-level
  `reducedMotion()` now returns true when a manual override is set or when the OS
  prefers reduced motion, and the override is synced from the display config on
  every change. Graphics & settings gains a **Reduce motion** toggle, so players
  can trim camera shake, animated menus, radar sweep and decorative effects even
  when their OS preference is not set.

Verification: `npm run test:game` config tests pass, typecheck, production build
and the rendered response test green.

## Server input rate limiting 2.24 - 2026-09-11

- **Per-peer budget** (`server/room.mjs`): each peer may submit at most 120 game
  inputs per rolling one-second window (`INPUT_RATE_LIMIT`); excess messages are
  dropped before any simulation work. Clients send at 60 Hz, so the budget leaves
  generous headroom while bounding the work a flooding client can force. The
  window resets on reconnect.
- **Test** (`server/room.test.mjs`): 300 rapid inputs accept at most the budget,
  and a fresh window accepts again.

Verification: `npm run test:server` 98/98 (the known flaky two-room socket test
passed on rerun), typecheck, production build and the rendered response test green.

## Connection quality indicator 2.23 - 2026-09-11

- **Pure grader** (`game/hud.mjs`, `game/hud.test.mjs`): `connectionQuality`
  grades the client's existing jitter/loss estimators into GOOD/FAIR/POOR with a
  colour tone and the current interpolation delay in milliseconds. A test covers
  each grade, the loss-driven POOR case and the empty-input default.
- **HUD** (`app/page.tsx`, `app/globals.css`): network matches show a colour-coded
  `GOOD · 100MS` chip in the bottom HUD, derived from the live NetClient timing
  state added to the decorated snapshot.

Verification: `npm run test:game` HUD tests pass, typecheck, production build and
the rendered response test green.

## Melee attack 2.22 - 2026-09-11

- **Simulation** (`game/core.mjs`): a new `Match.melee(actor)` swings a short
  forward arc (`MELEE`: 2.4u range, 45 damage, 0.6s cooldown). It requires a
  healthy actor, a live enemy inside the arc and a clear line of sight, consumes
  spawn protection on use, and emits a `melee` event carrying the hit actor (or
  null on a whiff). The cooldown decays in the step loop and each actor field is
  initialized on spawn. Bots swing at point-blank visible targets.
- **Input path** (`game/input.mjs`, `app/page.tsx`, `server/room.mjs`,
  `game/touch.mjs`): `controlsFromState` forwards `melee`; the page binds `F` and
  resets it after each step; the server converts a held melee into a consumed
  one-shot edge like reload; the touch cluster gains a `MELEE` button through the
  pure `applyTouchAction` helper. `TOUCH_BUTTONS` now lists 10 actions.
- **Tests**: `game/melee.test.mjs` covers a hit, cooldown refusal, out-of-range and
  behind misses, and teammate immunity; `game/input.test.mjs` covers the control;
  `server/room.test.mjs` covers edge latching, hold behaviour and re-arm;
  `game/touch.test.mjs` covers the touch action.

Verification: `npm run test:game` 536/536, `npm run test:server` 97/97, typecheck,
production build and the rendered response test green.

## Kill feed weapon labels 2.21 - 2026-09-11

- **Feed context** (`game/core.mjs`): death feed entries now carry the killing
  `weapon` index (or `null` for void deaths), matching the weapon already present
  on the `death` event.
- **Pure helper** (`game/hud.mjs`, `game/hud.test.mjs`): `killFeedWeapon(entry,
  weapons)` resolves that index to a short weapon name and returns `null` for
  environment kills or unknown indices. A test covers falloff-free mapping,
  missing/unknown weapons and null input.
- **HUD** (`app/page.tsx`): the in-match kill feed renders the weapon between the
  killer and victim.

Verification: `npm run test:game` HUD tests pass, typecheck, production build and
the rendered response test green.

## Weapon range readout 2.20 - 2026-09-11

- **Pure helpers** (`game/hud.mjs`, `game/hud.test.mjs`): `weaponRangeInfo` returns
  a SHORT/MID/LONG band, the full-damage `start` and falloff `end`, and the
  retained fraction; `weaponRangeLabel` formats it (e.g. `SHORT · 6–24m · 40%`).
  A new test covers falloff and non-falloff weapons and the empty case.
- **Settings/arsenal UI** (`app/page.tsx`, `app/globals.css`): the Graphics &
  settings arsenal list now shows each weapon's range band and effective distance,
  making the new falloff legible when choosing a loadout. The control reference
  gains a touch-controls row (`Left stick move · drag right to look · TALK to talk`).

Verification: `npm run test:game` passing (HUD tests included), typecheck,
production build and the rendered response test green.

## Touch controls v2 2.19 - 2026-09-11

- **Pure action mapping** (`game/touch.mjs`, `game/touch.test.mjs`): the on-screen
  button behaviour moved into `applyTouchAction(runtime,action,pressed)`, which
  tracks held actions (fire, ADS, crouch, voice push-to-talk) and latches one-shot
  actions (jump, reload, power, interact). `TOUCH_BUTTONS` now includes `voice`.
  A new test covers held tracking, one-shot latching, release behaviour and the
  null-runtime guard.
- **Right-zone look surface** (`app/globals.css`): the drag-look surface is now
  constrained to the right 62% of the screen instead of the whole viewport, so the
  left-hand HUD and thumbstick are not covered by an invisible touch target.
- **Push-to-talk button** (`app/game-ui/touch-controls.tsx`): a `TALK` button joins
  the action cluster and drives the existing voice push-to-talk gate; long-press
  context menus are suppressed on the control layer.

Verification: `npm run test:game` passing (touch tests included), typecheck,
production build and the rendered response test green.

## Bot threat awareness 2.18 - 2026-09-11

- **Hit reactions** (`game/core.mjs`): when a bot takes damage from another actor
  it now records the attacker as a remembered threat — refreshing `memory`,
  storing the attacker's position in `seen`, setting `target`/`threat` and opening
  a 1.4s `suppressed` window — and requests a prompt (but bounded, 60ms) re-plan.
  The existing `pursue` plan then sends the bot toward the last-known attacker
  position when the attacker is not currently visible, so it returns fire or
  investigates instead of ignoring unseen shots. Suppression decays over time and
  the bounded re-plan avoids recomputing the navigation path every frame under
  sustained fire.
- **State hygiene**: bot `suppressed`/`threat` are initialized on spawn and reset
  on respawn.
- **Tests** (`game/bot-suppression.test.mjs`): an unseen shot records the threat,
  forces a prompt re-plan, and drives a `pursue` toward the last-known position
  whose suppression decays; damaging a human writes no bot state.

Verification: `npm run test:game` 528/528, `npm run test:server` passing,
typecheck, production build and the rendered response test green.

## Snapshot quantization 2.17 - 2026-09-11

- **Payload trimming** (`game/quantize.mjs`, `game/quantize.test.mjs`): a pure
  `quantizeNumbers(tree, precision)` rounds every finite number in a snapshot or
  event tree to three decimals, leaving non-finite ammo sentinels, strings,
  booleans and nulls untouched, and preserving object identity.
- **Server wiring** (`server/room.mjs`): `wireState()` quantizes a
  `structuredClone` of the fresh snapshot so shared nested references (powerups,
  gear, attachments) are never mutated. Broadcast and join snapshots use
  `wireState()`, and event deltas are quantized from a clone. Positions and angles
  to the millimetre are visually identical but shorten every 30 Hz payload.
- **Tests**: three pure quantization tests (precision, identity, size) plus a room
  test proving the wired snapshot is quantized while the authoritative actor keeps
  full precision. `server/spectator.test.mjs` now compares against the quantized
  wire snapshot.

Verification: `npm run test:server` 96/96 (known flaky socket/history tests passed
on rerun), typecheck, production build and the rendered response test green.

## Server input hardening 2.16 - 2026-09-11

- **Bounded sequences** (`server/room.mjs`): input sequence numbers more than 600
  ahead of the last accepted value are snapped to the next expected sequence, so a
  rogue or buggy client can no longer jump `receivedSeq` forward and make every
  real input look stale. Duplicate and stale sequences are still ignored.
- **Clamped movement** (`server/room.mjs`): the `x`/`z` movement axes are coerced
  to finite values and clamped to `[-1,1]`; non-finite look values are dropped
  instead of forwarded.
- **Test** (`server/room.test.mjs`): a new room test covers axis clamping, the
  absurd-jump snap, stale-sequence rejection and non-finite axes/look.

Verification: `npm run test:server` 95/95 (one known flaky two-room socket test
passed on rerun), typecheck, production build and the rendered response test green.

## Weapon damage falloff 2.15 - 2026-09-11

- **Range identity** (`game/data.mjs`, `game/core.mjs`): hitscan weapons now carry
  an optional `falloff:{start,end,min}` band. Pulse, Scattergun, Shock Beam, Flak
  Cannon, Marksman Rifle and SMG keep full damage inside `start` and taper
  linearly to `min` at `end`. Rail Lance and the projectile/splash weapons are
  unchanged, so snipers and launchers own the long lane while spray and pellets
  lose bite with distance.
- **Pure helper** (`game/core.mjs`): exported `damageFalloff(weapon,distance)`
  returns `1` with no band or non-finite distance, `min` beyond `end`, and the
  interpolated value in between. The shotgun event now reports `falloff` for
  feedback consumers.
- **Tests** (`game/weapon-falloff.test.mjs`): the helper curve, a close-vs-far
  Pulse comparison (ratio ≈ 0.62 at 70u), a no-falloff Rail check (equal at both
  ranges), and a well-formedness sweep over every weapon.

Verification: `npm run test:game` 523/523, typecheck, production build and the
rendered response test green.

## Mobile touch controls 2.14 - 2026-09-11

- **Pure input math** (`game/touch.mjs`, `game/touch.test.mjs`): `joystickVector`
  clamps to the unit circle, `moveAxis` applies a deadzone, forward sign and the
  edge sprint threshold, and `applyLook` accumulates yaw and clamps pitch. Three
  tests cover these.
- **Shared controls** (`game/input.mjs`, `game/input.test.mjs`): `controlsFromState`
  accepts an analog `move` axis (overriding keys) and explicit `sprint`/`crouch`
  flags. A new test covers analog move, mixed key+analog priority and held posture.
- **On-screen controls** (`app/game-ui/touch-controls.tsx`, `app/page.tsx`):
  thumbstick, drag-look surface and action buttons write movement, look and
  held/tapped actions straight to the runtime; the loop feeds them through the
  same `controlsFromState` used by keyboard and netcode. Controls auto-enable on
  coarse pointers, toggle from Graphics & settings, and are persisted locally.
- **Mobile viewport** (`app/layout.tsx`, `app/globals.css`): device-width viewport
  with zoom disabled, plus `touch-action`/`overscroll-behavior`/safe-area rules so
  the arena fills the screen without pull-to-refresh.

Verification: `npm run test:game` 519/519, `npm run test:server` 94/94,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. Touch behaviour was validated by unit tests, typecheck and build; a real
phone browser playtest is still recommended.

## Payload mode 2.13 - 2026-09-11

- **Pure rules** (`game/payload.mjs`, `game/payload.test.mjs`): `payloadTemplate`
  builds an anchored, ordered route with checkpoints from the map's spawns and
  safe nav/objective points; `stepPayload` advances the cart for attackers, rolls
  it back (clamped to the last checkpoint) for defenders, freezes it under
  contest, banks checkpoints and declares a delivery winner. Eight tests cover
  config defaults, route shape, advance, stall/rollback, contest, delivery,
  timeout-to-defender and full 8-bot matches on supported arenas.
- **Sim integration** (`game/core.mjs`, `game/mode-data.mjs`, `game/config.mjs`):
  the `payload` mode is registered with checkpoint score rules; `updatePayload`
  emits `payload-checkpoint`/`payload-delivered`, sets the winner and keeps the
  snapshot's `objectives.payload` (position, distance, progress, pushing,
  contested, delivered, checkpoint count). Bots escort or hold the cart.
- **Content** (`game/nextgen-maps.mjs`, `game/arenas.mjs`): new generated map
  **Convoy Line** (`mode:'payload'`) satisfies the one-map-per-mode invariant and
  the geometry/spawn/cover checks; 20 arenas list `payload` in their play lists.
- **Renderer and UI** (`game/view.mjs`, `app/page.tsx`,
  `app/game-ui/configuration.tsx`): pooled cart model with spinning wheels and a
  contested/team beacon, plus the Payload command brief, `CHECKPOINTS` goal,
  scoreboard columns, target rule and objective copy.

Verification: `npm run test:game` 515/515, `npm run test:server` 94/94,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. The generic all-modes loop now resolves each mode to a supported arena and
accepts an objective result, not only kills. Cart visuals are not GPU-playtested
in this pass.

## Varied death effects 2.12 - 2026-09-11

- **Deterministic recipes** (`game/deaths.mjs`, `game/deaths.test.mjs`): a pure
  `deathPlan`/`deathStyleFor` maps weapon family, headshot and overkill to one of
  eight styles seeded per actor/death. Tests cover determinism, distribution,
  every weapon mapping to a valid plan, overkill escalating to gore, headshot
  bias and void-fall collapse.
- **Sim context** (`game/core.mjs`, `game/core.test.mjs`): `damage` and `fall`
  emit `death` events carrying `style`, `seed`, `weapon`, `overkill` and impact
  `direction`. New core tests assert the enriched event for a gore kill and a
  void fall.
- **Renderer** (`game/effects-fx.mjs`, `game/view.mjs`, `game/view.test.mjs`):
  new pooled `DeathPool` flings bounded limb/body chunks with gravity and spin and
  lays ground splats; `spawnDeath`/`poseCorpse`/`reviveCorpse` handle the debris
  and the toppling corpse. A view test proves piece and splat pools stay bounded
  and dispose cleanly.

Verification: `npm run test:game` 506/506, `npx tsc --noEmit` clean,
`npm run build` succeeds, `node --test tests/*.test.mjs` 1/1. `npm run
test:server` unchanged at 94/94. The effects were not GPU-playtested in a
browser in this pass.

## CTF bases, server bounds and shadow cadence 2.11 - 2026-09-11

- **CTF bases** (`game/maps.mjs`, `game/arsenal-maps.mjs`,
  `game/nextgen-maps.mjs`): Citadel, Trenchline, Signal Ridge and Sunken Hill now
  author red/blue `teamSpawns` and distinct `flagSpawns`. `game/arenas.test.mjs`
  asserts every CTF-capable arena has separated in-bounds bases and that a live
  CTF `Match` places both flags at them.
- **Mode/arena reconciliation** (`server/room.mjs`): `host` and `start` route the
  requested map through `resolveMapForMode(mapId, mode, {legacy:true})`, so an
  incompatible arena is repaired before the `Match` is built. New room tests
  cover a repaired CTF launch and a preserved compatible arena.
- **Room ceiling** (`server/rooms.mjs`, `server/game-server.mjs`): the registry
  caps concurrent rooms (`maxRooms`, default 64), evicts the oldest idle room
  under pressure, and returns `null` (surfaced as a client error) when no room
  can be freed. New registry test.
- **Kill-feed live region** (`app/page.tsx`): the kill feed is now
  `role="log" aria-live="polite"`.
- **Shadow cadence** (`game/view.mjs`): `shadowTick` refreshes shadows on a fixed
  cadence instead of every frame; `game/view.test.mjs` covers the sequence.

Verification: `npm run test:game` 497/497, `npm run test:server` 94/94,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Menu, playback, bot-posture and server-liveness batch 2.10 - 2026-09-11

- **Menu navigation** (`app/page.tsx`): Escape now backs out of browse,
  progression, theater-list and lobby; changing mode reconciles an incompatible
  arena via the new pure `resolveMapForMode` (`game/arenas.mjs`). Assault gains a
  sector-count rule (`app/game-ui/configuration.tsx`), a `SECTORS` goal and a live
  command brief.
- **Theater playback** (`game/demo.mjs`): `DemoPlayer.sample` now seeds from the
  nearest prior keyframe and merges/prunes actors, vehicles and rockets by id, so
  entities that spawn or despawn mid-recording play correctly; the recorder
  enforces `maxSeconds`. New `demo` tests.
- **Bot posture** (`game/core.mjs`): bots sprint on long rotations, aim down
  sights at mid range, and slide when critically hurt and sprinting. New
  `bot-behavior` tests; all mode/difficulty match tests still pass.
- **Maps and objectives** (`game/levelgen.mjs`, `game/core.mjs`,
  `game/assault.mjs`): the next-gen CTF map keeps its authored flag bases; zone
  and sector occupancy now require proximity on the vertical axis; Assault
  defenders win a round that reaches the timer without a breach. New
  `nextgen-maps` and `extra-modes` assertions.
- **Server liveness** (`server/game-server.mjs`, `server/room.mjs`): a 15s
  heartbeat terminates unresponsive sockets, `TRAFFIC_BUFFER_LIMIT` drops sends
  to a backing-up client, and spectators are capped at `SPECTATOR_LIMIT`. New
  spectator-cap test.

Verification: `npm run test:game` 494/494, `npm run test:server` 91/91,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Codebase-audit gap-fix batch 2.9 - 2026-09-11

A five-domain audit of the simulation, content, UI, server and renderer produced
a ranked gap list; the highest-impact correctness bugs were fixed:

- **Objective modes** (`game/mode-data.mjs`, `game/core.mjs`): `objectiveTemplate`
  now keys off `modeRule(mode).objective.kind`, so Combined Arms gets Domination
  zones; Assault and Combined Arms are objective-aware for bots; the KOTH hill is
  the authored zone nearest the arena center. Verified by new `mode-data` and
  `extra-modes` tests plus a probe (Combined Arms scores; Assault bots capture all
  three sectors).
- **Reload and arsenal** (`game/core.mjs`, `game/config.mjs`): the simulation
  consumes the forwarded one-shot `reload`, `startingWeapon` accepts indices 0-9,
  bots pick weapons 5-9, and the resolved attachment weapon drives reload cap,
  reload duration and pickup caps. New `gameplay`, `config`, `attachment-behavior`
  and `bot-behavior` assertions.
- **Balance correctness** (`game/core.mjs`, `game/progression.mjs`,
  `game/vehicles.mjs`): negative armour clamped at spawn and in absorption,
  harness passive damage applied, vehicle friendly-fire rules (crew excepted),
  mounted chainguns damage enemy vehicles, and vehicle speed/boost/traverse
  skills are honoured. New `vehicles`, `vehicle-gameplay` and `gameplay` tests.
- **Server hardening** (`server/rooms.mjs`, `server/room.mjs`,
  `server/progression.mjs`): room names sanitized/bounded, mid-match join sets
  `lastSerial` and becomes a spectator, gear writes reject spectators and are
  throttled, and `ProgressionStore` touches on access so eviction is LRU. New
  `rooms`/`room`/`progression` tests.
- **Renderer** (`game/software.mjs`, `game/view.mjs`, `game/textures.mjs`): the
  CPU renderer expands `InstancedMesh` instances, and surface textures are
  disposed exactly once on rebuild. New `textures` suite and a `view` instancing
  test.

Verification: `npm run test:game` 483/483, `npm run test:server` 90/90,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Five-pass polish batch 2.8 - 2026-09-11

- **Killstreak callouts** (`game/hud.mjs` `multikillLabel`/`spreeLabel`/`recentKills`/`killCallout`): rapid local kills produce DOUBLE/TRIPLE/OVERKILL/MONSTER/MEGA KILL labels and five-kill milestones produce spree names. `game/core.mjs` death events now include `killer`/`killerName`/`self` so the same pure logic serves solo and net. Covered by new `hud` tests plus the enriched-event path in `core`/`feedback`.
- **Post-match superlatives** (`matchAwards`): MVP, most objective time, flag runner, best K/D and feed provider, rendered on the results screen; returns nothing for solo practice. Covered by new `hud` tests.
- **Bot survival instincts** (`game/core.mjs`): `blastUnsafe` prevents a bot firing an explosive when the target is inside its own radius, and a critically hurt bot with no supply retreats instead of closing. New `bot-behavior` tests cover the blast threshold and the retreat vector, and the seven-bot flow test still passes.
- **Colorblind team palette** (`game/config.mjs`, `game/team-presentation.mjs`, `game/view.mjs`, settings): the default palette is unchanged; the colorblind palette swaps red/blue for Okabe-Ito orange/blue while preserving the bar-based world markers. New `team-presentation` and `config` assertions cover the switch.
- **Tactical radar** (`game/radar.mjs`): yaw-relative contacts for actors, objectives and flags with team/palette colours and a reduced-motion-aware sweep. New `radar` tests cover projection, yaw rotation, range clipping and palette mapping.

Verification: `npm run test:game` 468/468, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Arena fall fix and HUD 2.7 - 2026-09-11

- **Terrain edge free-fall fixed** (`game/core.mjs` `moveActor`): the horizontal
  step could move an actor past the heightfield boundary, where `floorAt` returns
  null; the vertical pass then never landed and the actor was clamped in-bounds
  only afterwards, producing an endless fall. The position is now clamped to the
  arena bounds *before* the floor query. `game/levelgen.mjs` also emits a
  `voidY` kill-plane on next-gen maps so any impossible fall kills and respawns.
  Verified by walking every edge of titan-valley / frost-gate / colosseum for
  2000 ticks (minimum y stayed at terrain, zero spurious deaths).
- **HUD v2.7** (`app/globals.css`): viewport-scaled readouts (`clamp()` on the
  clock, frags, health, armor, ability, weapon and command panel), stronger panel
  treatments, and cinematic announcement effects — glowing banner with a sweeping
  underline, popping kill banners, sliding kill feed and larger hitmarkers/damage
  numbers — all disabled under `prefers-reduced-motion`.

Verification: `npm run test:game` 455/455, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Next-generation graphics overhaul 2.6 - 2026-09-11

- **Articulated characters** (`game/character-anim.mjs`): engine-free pose solver
  (idle/run/crouch/air/ADS, bounded joints, contra-lateral limbs) and a joint rig
  applied to smooth capsule/ball operator models in `game/view.mjs`.
- **Natural bot facing** (`game/core.mjs`): every actor has a damped `bodyYaw`
  (difficulty-scaled turn rate) that trails their aim; exposed in snapshots and
  consumed by the rig for head/chest tracking and turn banking.
- **Procedural levels** (`game/levelgen.mjs`, `game/nextgen-maps.mjs`): ten
  seeded maps, one per mode, with heightfield terrain biomes, cliff faces and
  strata, enterable buildings, tunnels, caverns, bridges, arches, columns and
  props. Legacy maps are unchanged.
- **Renderer** (`game/view.mjs`): next-gen collision proxies (`cave`, `tunnel`,
  `rock`, `tree`, `crate`, `column`) render as smooth geometry instead of boxes;
  navigation uses a fast spatial-grid graph with largest-component pruning.

Verification: `npm run test:game` 455/455, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. New suites: `game/character-anim.test.mjs`, `game/bot-facing.test.mjs`,
`game/nextgen-maps.test.mjs`. Legacy movement invariants are scoped to the
legacy arenas; next-gen maps are covered by their own geometry, spawn-support,
navigation-connectivity and full-match suites.

## COCS rebrand 2.5 - 2026-09-11

- **Identity.** The game is now **COCS — Colosseum Of Competitive Slop**.
  `app/layout.tsx` metadata, the canvas/wordmark labels, `server/game-server.mjs`
  banner and the deploy labels all use the new name. In-app localStorage keys stay
  `token-arena-*` so existing saves are preserved.
- **Title screen** (`app/page.tsx`, `app/globals.css`): `C O C S` renders in big
  industrial type with `COLOSSEUM / OF / COMPETITIVE / SLOP` stacked under each
  letter, animated in one letter at a time (`.title-letter` / `@keyframes
  cocsSlide`) and disabled under `prefers-reduced-motion`.
- **Back out of the menu:** the loadout screen has a ✕ title-return button and
  Escape now returns to the title screen when no modal is open.
- **Copy pass:** operator tags/bios, harness descriptions, powerups, weapons,
  modes, difficulties, gear, attachments, finishes, reticles and rank titles were
  rewritten with tongue-in-cheek parody copy; the unlock track is grouped into
  Gear / Weapon Mods / Weapon Finishes / Reticles with per-group progress bars.

Verification: `npm run test:game` 437/437, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1 (the rendered-HTML test now asserts the COCS identity).

## Title demo and weapon effects 2.4 - 2026-09-11

- **Showcase scenarios** (`game/showcase.mjs`): the title screen cycles a
  Combined Arms battle (16 bots on skyfall-basin / trenchline / signal-ridge /
  warfront, vehicles pre-seated at 70% through `seatShowcaseVehicles`) and an
  Instagib rail match, with faster cinematic cuts.
- **Quake 2 rail** (`game/effects-fx.mjs` `RailBeamPool`): an additive
  spiral-textured cylinder with a white core and expanding muzzle ring, plus a
  starburst impact. Pooled, disposed, and safe without a DOM.
- **Per-weapon effects** (`game/view.mjs`): pulse, rail, scatter, plasma,
  grenade, shock, flak, marksman and SMG each compose distinct tracer, impact
  and explosion visuals; projectile rendering is per-weapon.

Verification: `npm run test:game` 437/437, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. New suites: `game/showcase.test.mjs`, `game/rail-effect.test.mjs`.

## Attachment behaviours and reticles 2.3 - 2026-09-11

- **Charge coil** (`game/core.mjs`): firing a charge weapon accumulates charge
  per frame until `chargeTime`, emits `charge` start/ready events, and fires a
  boosted shot (`chargeDamage`). Releasing early resets the charge.
- **Homing beacon** (`game/core.mjs`): rockets carry `homing`/`homingTurnRate`
  and steer toward the nearest enemy within range each step.
- **Burst module**: continues a burst after the initial trigger pull (already
  wired in 2.2, now covered by `game/attachment-behavior.test.mjs`).
- **Reticles** (`app/globals.css`, `game/config.mjs`,
  `app/game-ui/configuration.tsx`): all five reticle shapes render and are
  selectable; the dynamic gap transform excludes chevron/split.
- **Discoverability**: the harness panel now lists each harness's vehicle skill.

Verification: `npm run test:game` 433/433, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Attachments, vehicle overhaul, assault, cosmetics 2.2 - 2026-09-11

- **Weapon attachments** (`game/attachments.mjs`): four slots, fourteen mods,
  and a resolver that folds multiplicative/additive stat modifiers plus
  behaviour modules (`burst`, `charge`, `pierce`, `explosive`, `homing`,
  `chain`) into a derived weapon. `game/core.mjs` resolves a loadout's
  attachments per actor and applies them per weapon in `fire` (pierce, splash
  detonation, chaining and stat changes), while `game/view.mjs` adds optics,
  barrels and magazines to the 3D weapon models. Attachments persist through
  `game/progression.mjs` and the server JSON store.
- **Vehicle overhaul** (`game/vehicles.mjs`, `game/core.mjs`): inverted steering
  fixed; `driver`/`gunner`/`passenger` seats with mounted seat anchoring;
  occupants are visible and targetable (own-vehicle shielding no longer absorbs
  rider hits); a gunner fires the mounted gun without moving the vehicle; and
  harness vehicle skills (auto-gunner, plating, repair, boost, speed) are
  defined in `game/harness-profiles.mjs` and applied in core.
- **Assault mode** (`game/assault.mjs`, `game/mode-data.mjs`, `game/core.mjs`):
  ordered sector capture with contest/neutralise, breach at the final sector, and
  defender-holds behaviour; registered as a game mode and wired into the match
  snapshot and objective markers.
- **New maps** (`game/arsenal-maps.mjs`): trenchline, signal-ridge, rampart and
  catwalk-breach, registered in `game/maps.mjs` with arena metadata.
- **Finishes and reticles** (`game/cosmetics.mjs`): six weapon finishes recolor
  weapon glow materials and five reticle styles are unlockable cosmetics.

Verification: `npm run test:game` 429/429, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1. New focused suites: `attachments`, `assault`, `assault-match`,
`arsenal-maps`, `cosmetics`, `vehicle-seats`.

## Arsenal expansion and balance 2.1 - 2026-09-11

- **`game/data.mjs`**: two new hitscan weapons (Marksman Rifle, SMG) appended
  after the original eight, plus balance tweaks to Scattergun bloom/interval,
  Plasma Driver interval and Flak Cannon interval. Every weapon still satisfies
  the generic fire contract (positive damage/interval/range/ammo/cap) and the
  original five names/order are preserved.
- **`game/config.mjs` / `game/maps.mjs`**: ten-slot `spawnInventory` and
  `pickupWeapon` mappings for `marksman`/`smg`.
- **`game/view.mjs`**: detailed 3D silhouettes for both new weapons with
  barrel-aligned muzzle anchors, plus pickup colours; `game/feedback.mjs`
  automatically synthesises their shot/launch audio from weapon feel.
- **Maps**: Marksman/SMG pickups added to Warfront Delta and Skyfall Basin.
- **Input**: number row binds 1–9 and 0; wheel cycles all ten.
- Updated contracts: `content.test` (length 10, appended shorts),
  `weapon-presentation` (ten distinct silhouettes, muzzle anchors for all),
  `powerups`/`expansion`/`config` (ten-slot inventories and instagib rail lock).

Verification: `npm run test:game` 378/378, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Progression, unlocks and gear 2.0 - 2026-09-11

- **`game/progression.mjs`**: deterministic XP curve, `levelFromXp`, rank
  titles, an 8-piece gear catalogue across three slots, level-gated unlocks,
  `resolveGear` modifiers (additive health/armour, multiplicative combat stats)
  and `awardMatch`. Covered by 7 tests.
- **`game/core.mjs`**: `options.loadouts[id].gear` is resolved per human actor
  and applied on every spawn (health/armour/speed/damage/spread); bots keep
  defaults. Snapshot stays deterministic with no gear.
- **`server/progression.mjs`**: JSON store mirroring `history.mjs` (atomic
  writes, player cap, validated ids) with `award`/`setGear`/`get`. Covered by 5
  tests including a full `Room` match that awards persistent XP and queues a
  `progression` message.
- **Protocol**: clients send a stable `playerId` on join/create, persist gear
  with a `gear` message, and receive `profile` on welcome plus `progression`
  updates with XP gained, level-ups and unlocks.
- **Client**: a new Rank screen (level, XP bar, career stats, unlock list, gear
  slots), unlock toasts, gear saved to localStorage and applied to solo matches
  and hosted lobbies.

Verification: `npm run test:game` 378/378, `npm run test:server` 85/85,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Air combat: Hornet and Skyfall Basin 1.9 - 2026-09-10

- **`game/vehicles.mjs`** gains the `HORNET` flight chassis and a dedicated
  `stepFlight` integrator (lift/descend/hover, boost, ceiling clamp, altitude
  collision) plus kind-based `vehicleConfig` resolution and paired ground/flight
  muzzles. Covered by 4 tests in `game/vehicle-flight.test.mjs`.
- **`game/core.mjs`**: vehicle entry respects altitude, bots in vehicles fire the
  mounted gun, flight vehicles are excluded from run-over stomping, and the
  snapshot publishes `vy`, `flight` and `altitude`.
- **`game/view.mjs`**: `vehicleModel('hornet')` builds the aircraft (wings, tail,
  canopy, twin engines, nose guns).
- **`game/battle-maps.mjs`**: new `skyfall-basin` (span 144, four vehicles: two
  Puma, two Hornet), passing bounds, navigation, clearance, render/dispose and
  full 3-bot match contracts.

Verification: `npm run test:game` 371/371, `npm run test:server` 80/80,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Arena framework, traversal v2 and combined arms 1.8 - 2026-09-10

- **`game/arenas.mjs`** adds an arena registry: group/scale/mode-whitelist/legacy
  metadata derived from authored overrides or map shape, with `activeMaps`,
  `mapsForMode`, `maxBotsFor`, `recommendedBots`, `groupedMaps` and
  `arenaVariant`. Covered by 6 tests.
- **Legacy gating:** Exchange, Crosswire, Foundry, Launchpad, Citadel and Blood
  Gulch are `legacy`; the setup/host map pickers, `shuffleSelection` and
  `nextArenaSelection` exclude them unless Games & settings → *Legacy arenas*
  is on. Rotation tests cover both paths.
- **Traversal v2:** trampolines/jump pads, boost launchers, **ziplines** and
  **teleporters** are parsed and simulated in `game/core.mjs` (with teleporter
  nav edges), rendered in `game/view.mjs`, and exercised by 5 traversal tests
  (launch, teleport relocation + cooldown, zipline ride, nav bridge, event
  forwarding).
- **New maps** (`game/battle-maps.mjs`): `neon-vertical` (urban, jump pads,
  rooftop ziplines, teleporters), `substation` (indoor, ceiling array,
  bulkheads, teleporters), `warfront` (large combined-arms, four Pumas). Each
  passes the all-map contracts: block bounds, connected navigation, grounded
  and clear spawns/pickups/flags/zones, distinct material/fog signature,
  render/dispose invariants, cover landings and full 3-bot match completion.
- **Combined Arms mode** (`game/config.mjs`) with `maxBots:16`; `normalizeConfig`
  clamps bot count to the mode cap and `MatchConfiguration` follows it.

Verification: `npm run test:game` 365/365, `npm run test:server` 80/80,
`npx tsc --noEmit` clean, `npm run build` succeeds, `node --test tests/*.test.mjs`
1/1.

## Bot personalities and mode balance 1.7 - 2026-09-10

- **`game/bot-personalities.mjs`** blends the existing operator `role` and harness
  `personality` tables into one bounded behavior descriptor (aggression, hold,
  flank, objective, supply, vehicle, strafe, engagement `range`, `spacing`,
  `retreat`) with deterministic per-id jitter. Covered by 6 tests.
- **`game/core.mjs`** now uses that descriptor: varied target ranking (ally-lock
  penalty, opportunist/ambusher biases), behaviour-driven engagement ranges and
  strafing, gated vehicle use, spread supply selection, ground-only separation
  steering, and `zoneSlot` perimeter positions that fall back to the zone centre
  when a slot would sit over the void. Attackers keep advancing while firing.
- **Balance:** `updateObjectives` now decays a holder's progress while the zone is
  contested (faster neutralisation, no stalemate), while uncontested owners still
  score. Regression tests: a seven-bot match fields >=5 distinct behaviors with
  low clustering, objective slots are spread, contested control decays, and an
  uncontested owner still scores. Measured: 7/7 distinct behaviors and ~0.25-1.3
  bots within 2 m (peak 2-3) versus the previous shared behaviour.

Verification: `npm run test:game` 348/348 (incl. 4 bot-behaviour and 6
bot-personality tests), `npm run test:server` 80/80, `npx tsc --noEmit` clean,
`npm run build` succeeds, `node --test tests/*.test.mjs` 1/1.

## Theater, cinematic camera and live menu showcase 1.6 - 2026-09-10

- **`game/demo.mjs`** records snapshot keyframes at 18 Hz, interpolates
  positions/yaw (shortest-angle) on playback, exposes the event stream for
  effects, and serializes/parses plus gzip (de)compression. **`game/demo-store.mjs`**
  persists recordings in IndexedDB (summary + data stores).
- **`game/director.mjs`** is a pure-math cinematic director: seven rigs, damped
  motion between hard cuts, auto-cuts on `death`/`explosion`/`capture`, target
  selection from highlight events or nearby explosions, and manual rig/target/
  free-look control. It returns a `{x,y,z,yaw,pitch,roll,fov,cut}` pose that the
  renderer copies onto the existing camera (so bloom post-processing keeps working).
- **`game/view.mjs`** gained a cinema path (`setCinema`/`setDirector`/`setShowcase`),
  renders the gameplay scene with the director pose, hides the first-person view
  model, suppresses local-player shake, null-guards `match.events`, and composites
  the selected operator's menu model into the customization panel with a scissored
  viewport pass over the showcase (`setPreviewRect`).
- **`app/page.tsx`** runs a live bot showcase behind the menu (fully bot-driven,
  rotating map/mode), records solo and network matches, and adds a Theater screen
  with playback controls, rig chips and keyboard shortcuts. The showcase can be
  disabled in settings and is automatically skipped for the CPU renderer and
  `prefers-reduced-motion`.

Verification: `npm run test:game` 338/338 (incl. 13 demo and 8 director tests),
`npm run test:server` 80/80, `npx tsc --noEmit` clean, `npm run build` succeeds,
`node --test tests/*.test.mjs` 1/1. The showcase/theater integration lives in the
client render loop and is exercised by the build + SSR test rather than a headless
WebGL test.

## Bunny-hop fix and audio upgrade 1.5 - 2026-09-10

- **Bunny-hopping**: previously each landing applied ground friction before the
  buffered jump fired, so chained hops lost ~10% speed per landing, and holding
  Space did not auto-hop. `moveActor` now skips ground friction on a frame where a
  held/buffered hop is about to land, `controlsFromState` treats a held `Space` as
  jump (autohop), and air acceleration was retuned (`MOVE.airAccel 3.5`,
  `airCap 1.6`, `terminal 2.2`). Measured in a deterministic harness: forward
  autohop holds 8.00 m/s, strafe autohop builds to ~9.3 m/s, standstill autohop
  reaches ~6.9 m/s. New regression tests cover speed preservation and strafe gain.
- **Audio**: `SynthAudio` was rewritten to layer filtered-noise transients with
  tonal bodies and sub thumps (per-weapon rifle/heavy/zap/burst/plasma character),
  plus improved explosions, reload/weapon-switch clicks, hit and kill cues,
  per-surface-agnostic footsteps with landing thuds, a speed-tracking Warthog
  engine, distance falloff and stereo panning. Remote events without a position
  stay silent. Tests updated to the new engine's routing contract.

Verification: `npm run test:game` 317/317, `npm run test:server` 80/80,
`npx tsc --noEmit` clean, `npm run build` succeeds, rendered-HTML test passes.

## Live deployment and in-game source link - 2026-09-10

Public site: https://arena.ussyco.de (nginx + wildcard TLS) proxying the
production `vinext start` app on `127.0.0.1:3000` and the Node game server on
`127.0.0.1:4000` at `/ws`. Both run as `mojo` user systemd units on this host.

- Added a GitHub source link (`https://github.com/mojomast/tokenarena`) to the
  selection/browse/lobby top bars, the Graphics & settings dialog, and the pause
  menu, using an inline GitHub mark (lucide 1.31 dropped brand icons).
- The rendered-HTML gate now asserts the source link is present in the
  server-rendered selection screen.
- Redeployed: `npm run build` then `systemctl --user restart
  token-arena-web.service` (reloads the server bundle and asset manifest) and
  `token-arena-server.service` (loads the 1.3/1.4 netcode; disconnects active
  multiplayer clients briefly).

Live verification (curl + WebSocket, 2026-09-10):

| Check | Result |
|---|---|
| `https://arena.ussyco.de/` | HTTP 200, new asset hash `assets/page-CgTUMVNQ.js` |
| Referenced page asset | HTTP 200, contains `github.com/mojomast/tokenarena` |
| `https://arena.ussyco.de/ws` | WebSocket opens and returns `{"type":"rooms",...}` |
| `node --test tests/*.test.mjs` | pass (now also asserts the source link) |

## Combat feedback, bot flow and platform-map connectivity 1.4 - 2026-09-10

A follow-up pass of four parallel subagents on non-overlapping files (maps, HUD/UI, renderer, bot AI), then reconciled and verified.

- **Combat feedback HUD** (`game/hud.mjs`, `app/page.tsx`, `app/globals.css`): floating damage numbers (victim world position projected to CSS px through `view.camera`), a directional damage indicator, bright kill/death banners, a weapon/ammo panel with auto/semi and reload state, and a match/objective announcer. Pure helpers (`projectToScreen`, `damageBearing`, `killBanner`, `weaponTag`, `ammoText`, `matchStartBanner`, `scoreAnnouncer`) are unit-tested; rendering is bounded and reduced-motion aware.
- **Renderer feel** (`game/view.mjs`, new `game/effects-fx.mjs`): dynamic FOV (sprint widens, ADS narrows to `max(55, fov*0.82)`), a two-light pooled muzzle flash, a low-health camera overlay, and bounded camera shake on local damage/death. A shared material cache and scoped geometry cache reduce per-model allocation/GPU state churn. All effects are disabled for `SoftwareRenderer` and `prefers-reduced-motion`.
- **Bot AI** (`game/core.mjs`): per-actor scan range scales with difficulty and arena diagonal; roam always has a destination (objective or patrol); CTF defenders hold a post near their own flag, attackers vary approach routes, and long rotations detour to a nearby vehicle. Large maps now yield kills and ended matches instead of 0-0 stalls.
- **Platform-map connectivity** (`game/expansion-maps.mjs`, tests): Ironfall Megastructure and Longreach Plateau gained physical up/down launcher pairs and re-aimed shelf launchers; both directed nav graphs are now a single connected component, so bots can cycle the map. No navigation-engine change was needed (the bidirectional-link approach remains rejected).

Automated evidence (2026-09-10):

| Gate | Command | Result |
|---|---|---|
| Game logic, AI, maps, movement, weapons, vehicles, view, HUD, net | `npm run test:game` | **315/315 pass** |
| Rooms, voice, history, server vehicle | `npm run test:server` | **80/80 pass** |
| TypeScript | `npx tsc --noEmit` | clean |
| Production build | `npm run build` | succeeds |
| Rendered response | `node --test tests/*.test.mjs` | pass |
| Runtime smoke (all 14 maps, CTF, 3 bots, 300 s) | scripted `Match` harness | finite state; Ironfall/Longreach now score and end (were 0-0) |

Known limits: damage numbers are emitted on the ~10 Hz HUD tick and smoothed by CSS, and camera projection uses the previous frame's camera (≤1 frame lag). Platform-map void falls remain the main rough edge (combat knockback near ledges). GPU frame pacing of the new overlays/lights still needs a hardware browser playtest.

## Combat feel, Warthog, arena rebuild and visual overhaul - 2026-09-10

Scope: a "make it not feel generic" pass built from five parallel research
subagents (Quake/Source movement + gunfeel, browser-shooter netcode, Halo M12
Warthog, Blood Gulch/CTF level design, Three.js rendering budgets) and six
implementation subagents in two non-overlapping file-ownership waves.

Implemented:

- **Movement** (`game/core.mjs`): Quake/Source ground friction (6) and
  acceleration (10), air acceleration (1.0) so strafe jumps build speed, terminal
  cap, variable jump with apex hang (`gravity 26`, `jump 8.6`), sprint (×1.375),
  crouch (×0.4), momentum-preserving slide + slide-hop. Coyote .10 s / buffer
  .12 s retained. `MOVE` constants are exported for tests.
- **Gunplay** (`game/core.mjs`, `game/data.mjs`): authoritative recoil aim-punch
  with per-weapon spray patterns, bloom spread with recovery, ADS, reload /
  auto-reload, weapon holster/raise, retuned recoil/bloom/reload per weapon
  (Pulse TTK ≈0.81 s). Camera applies `punchYaw`/`punchPitch` and `eyeHeight`.
- **Warthog** (`game/vehicles.mjs`, `game/view.mjs`): recognizable M12 model and
  arcade physics (engine/drag, speed-sensitive steering, lateral-slip drift,
  handbrake, boost, four-wheel suspension/slope alignment, body roll/pitch, 360°
  turret, paired-muzzle heat); deterministic run-over splatter in `Match.step`.
- **Maps** (`game/blood-gulch.mjs`, new `game/ctf-maps.mjs`): Blood Gulch rebuilt
  to a 160×70 m box canyon (central hill, two sniper ridges, two caves, multi-route
  bases with roof teleporters, two Warthogs); new Frostline, Derelict Station and
  Ashen Rift CTF maps registered in `game/maps.mjs`.
- **Graphics** (`game/view.mjs`, new `game/textures.mjs`, `game/environment.mjs`):
  directional shadows, PMREM IBL environment, deterministic FBM albedo/roughness/
  normal textures, vertex/triangle color variation, gradient sky with instanced
  mountains and terrain scatter, tiered bloom/vignette/SMAA postprocessing
  (bypassed by the software renderer and reduced-motion).
- **Input/HUD** (`app/page.tsx`, `game/input.mjs`, `game/hud.mjs`,
  `app/globals.css`): Shift sprint, Ctrl/C crouch, R reload, RMB ADS, shared
  `controlsFromState` on solo and net paths; spread crosshair, hitmarker, reload
  bar, posture chip, low-ammo warning.
- **Netcode** (`game/net.mjs`, `server/room.mjs`): adaptive interpolation delay
  ~100 ms (floor 90 / ceiling 160), jitter-adaptive snapshot buffer (4–16),
  server snapshot rate 20→30 Hz (configurable), reload one-shot edge and
  sprint/crouch/ADS flags forwarded.

Automated evidence (run on this machine, 2026-09-10):

| Gate | Command | Result |
|---|---|---|
| Game logic, maps, movement, weapons, vehicles, view, input, HUD, net | `npm run test:game` | **293/293 pass** |
| Rooms, chairs/grace, voice, history, server vehicle | `npm run test:server` | **80/80 pass** |
| TypeScript | `npx tsc --noEmit` | clean |
| Production Worker/RSC build | `npm run build` | succeeds |
| Rendered response | `node --test tests/*.test.mjs` | pass |
| Runtime smoke (all 14 maps, CTF, 3 bots, 300 s) + Warthog drive/turret/run-over | scripted `Match` harness | no NaN positions, no floor desync, captures/vehicles/projectiles behave |

Integration seams fixed and re-verified: the turret yaw is body-relative in
sim/view/net; `NetClient.resyncVehicles` and the local shadow carry
`turretYaw`/`roll`/`pitchBody`; `server/room.mjs` forwards `sprint`/`crouch`/`ads`
and a `reload` edge; the first-person camera applies recoil and crouch eye height;
`server/vehicle.test.mjs` was updated for the rebuilt Blood Gulch spawns.

Unverified / limits: shadows, bloom and procedural textures compile and pass
mocked view tests, but GPU frame pacing still needs a hardware browser playtest
(the CPU fallback intentionally disables them). The pre-existing
`ironfall-megastructure` and `longreach-plateau` maps retain partially
disconnected bot-navigation components (missing return routes on upper shelves);
a bidirectional-link navigation change was attempted and reverted because it let
bots route backward through one-way launchers and tripped the platform-map
traversal test. Pre-existing `@typescript-eslint/no-explicit-any` lint errors
remain project-wide; lint is not part of `npm test`.

## Voice HUD ergonomics and relay reliability - 2026-09-08

- The in-match voice panel now collapses to a compact status pill (`VOICE · MIC
  OFF`, enabled status, or `TRANSMITTING`) so it no longer covers the arena on
  desktop or overlaps the bottom HUD on mobile. Clicking the pill opens the full
  controls with a minimize button. PTT mode shows a `V / TALK` hint in the bottom
  HUD, and the settings dialog documents the push-to-talk binding.
- Transient ICE candidate failures (for example a UDP TURN allocate timeout while
  a TCP relay candidate succeeds) no longer surface as a hard voice error while
  the connection is still establishing. Real connection failures keep their
  message and now include the last candidate error for context.
- The Coturn relay port range was widened from 41 to 201 UDP ports
  (`49160-49360`) to reduce allocation contention for concurrent rooms, and the
  relay was restarted with that configuration.
- Verification: 31 voice controller tests and 4 HUD tests pass, including a new
  test that a `TURN allocate request timed out` candidate error stays quiet while
  connected and appears only as context after a real failure. TypeScript,
  production build, and rendered HTML pass. Both production services and the TURN
  container are active; all public assets load without failures.
- Public browser checks at `1440x900` and `390x844` pass all 15 checks: pill by
  default, open/minimize, voice ready, `V` hold transmitting and release,
  `V / TALK` hint, and no overlaps or horizontal overflow for the pill and the
  open panel. Pointer-locked matches capture mouse events by design, so in-match
  HUD buttons are used in the unlocked fallback state or the lobby.
- Cross-network relay reliability with real restrictive NATs remains unverified.

## HUD layering and responsive scoreboard - 2026-09-08

- Live standings now render in an explicit high-priority centered layer above the
  command/objective panels, with an opaque surface, blur, border, shadow, and
  internal scrolling. The objective remains available when the scoreboard closes
  instead of competing for the same visual layer.
- Responsive sizing keeps the scoreboard inside the safe viewport at desktop and
  mobile widths. It accepts pointer interaction for scrolling and preserves the
  existing Tab scoreboard workflow.
- Browser validation passed KOTH, Domination, and CTF at `1440x900` and `390x844`:
  scoreboard hit testing resolves to the scoreboard above the command panel, all
  panels remain within the viewport, and there is no horizontal overflow or page
  error. TypeScript, production build, and rendered HTML also pass.

## Lobby chat and proximity voice - 2026-09-08

- Lobby chat follows new messages at the bottom, preserves manually scrolled
  history with a jump-to-latest button, and resets across room changes.
- Added explicit opt-in WebRTC voice: hold V/pointer PTT, RMS voice activation,
  receive volume, sensitivity, and visible mic state. Capture stops on disable,
  departure and connection teardown; pending permission requests can be canceled.
  Typing, hidden/blurred windows, menus and spectators suppress transmission.
- Active-match playback is full within 5 units, fading to zero at 30, using fresh
  actor positions even outside the gameplay screen. Pregame lobby audio is uniform.
  Proximity is client-side playback behavior, not an access-control boundary.
- Room-scoped, session-validated signaling has payload/rate bounds and excludes
  spectators. TURN_URLS and TURN_SECRET support one-hour HMAC TURN credentials.
  Coturn is now deployed at `turn.ussyco.de`; the server advertises STUN plus
  expiring TURN credentials. The relay exposes only `3478/tcp`, `3478/udp`, and
  UDP ports `49160-49200`.
- Full suite passed before final compatibility refinements: 252 game tests,
  77 server tests, rendered HTML, TypeScript and build. Subsequent focused voice
  checks passed, including 27 controller tests after the Chromium sink fix;
  TypeScript and final build passed. Both production services were restarted.
- Two fresh public browser clients verified chat scrolling with 25 messages,
  PTT, automatic detection, receive mute, RTC connection, and capture cleanup.
  A real Chromium receive-path failure was fixed using a muted media element to
  activate decoding; audible output still passes through WebAudio proximity gain.
- Final unmodified-app fake-microphone test measured nonzero received WebAudio
  samples (peak RMS 0.3053), zero master output when receive volume was zero, and
  silence after PTT release. Tests used one machine, not restrictive cross-network
  NATs. Audible human quality, live in-match attenuation, and TURN relay connectivity
  remain unverified. Audio is not recorded by this application. Direct peers may
  learn network addresses. Forced relay-only browser validation later confirmed
  relay-to-relay ICE and bidirectional RTP; cross-network audio quality remains
  unverified.

## Arena movement, weapons and team readability - 2026-09-08

- Ground acceleration is now direction-independent, with sharp braking and
  reversal. Projection-based air acceleration preserves momentum with bounded
  steering gain; launcher momentum, jump buffering, and coyote time remain.
  Shared movement continues to run in authority and shadow prediction.
- Fixed free-flight projectiles losing distance to an impact-only clearance
  epsilon. Team-mode self splash now permits self damage/boost without damaging
  teammates. Server input preserves short fire taps between ticks and clears them
  at lifecycle boundaries. Prediction owns cloned nested snapshot state.
- All eight weapons have dedicated detailed geometry and explicit muzzle anchors.
  Muzzle lifetime follows weapon profiles, and pooled mesh traces honor width.
  Team armor, flags, and zones use consistent red/blue colors with I/II markings;
  character accents and FFA appearance remain distinct.
- Fixed unlimited-ammo and rapid wheel switching, expanded editable-input guards,
  and cleared held controls on focus/capture loss. Vehicle HUD exposes enter/exit,
  health, and heat instead of infantry ammo. Online Escape explains lobby behavior.
- Full `npm test` passed: 230 game tests, 71 server tests, one rendered-HTML test,
  TypeScript and production build. `git diff --check` passed.
- Diagnosed public 502s as a stale in-memory manifest referencing removed assets
  after an in-place build. Restarted the web service to restore availability, then
  restarted both services immediately after the final successful build. Both are
  active. In-place builds still require coordinated restart; atomic deployment
  and historical asset retention are not implemented.
- Public Chromium checks at 1440x900 and 390x844 loaded all seven requested JS
  chunks including the dynamic renderer without failed requests or page errors.
  Blood Gulch Team Deathmatch entry, desktop movement, jumping and firing passed.
  Mobile header/command overlap is resolved at the tested size. Close-up team
  skins, touch gameplay, multiplayer latency feel, audio balance, and hardware GPU
  performance are not visually/playtest verified.
- Research: [Quake III movement behavior](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c),
  [fixed timestep](https://gafferongames.com/post/fix_your_timestep/), and
  [game feel](https://www.gamedeveloper.com/design/game-feel-the-secret-ingredient).
  Movement implementation is original; GPL source was behavioral reference only.

## All-arena visual and canyon rebuild - 2026-09-08

- All ten arenas now have individual material and atmosphere palettes, batched
  architectural details, and clearer surface treatment. Island foundations have
  distinct supports, ribs, or rock layers; indoor structures gain panels, vents,
  trim, and reactor details. Launchpad gains runway markings.
- Blood Gulch now uses continuous rolling terrain, irregular enclosing cliffs,
  low opposing bunkers with four walkable roof ramps, clear flag approaches, and
  two vehicle lanes. Cliff strata and team-colored bunker cladding improve identity.
- Fixed overlapping mound geometry, floating traversal pads/targets, and vehicle
  movement ignoring collision-resolved terrain height. Bunkers remain solid with
  accessible roofs, not interiors; launch pads are not instant teleporters.
- Full `npm test` passed: 203 game tests, 65 server tests, one rendered-HTML test,
  TypeScript, and production build. The seeded 300-second Blood Gulch match logged
  16 kills and zero falls. The build retains its large-chunk warning.
- Installed Chromium/Playwright checked the isolated production build at 1440x900
  and 390x844: selection, map setup, and Blood Gulch entry passed with no captured
  page errors or failed requests and no horizontal page overflow. Screenshots were
  inspected. The mobile gameplay command panel partially overlaps the phase label;
  touch gameplay is not supported. SwiftShader performance is not a GPU benchmark.
- This pass was deployed after the build and the web service was restarted so the
  live asset manifest matched the build.

## Blood Gulch map fidelity pass - 2026-09-08

- Rebuilt **Blood Gulch** into a wider, more recognisable canyon arena while keeping it compact enough for bot matches.
- Expanded bounds to `{-42,42,-25,25}` with four-sided cliff walls, sloped north/south hills, and high sniper shelves.
- Added a contested **central mound** with a rocket launcher, plus landmark rock pieces for cover and bot channeling.
- Replaced simple base blocks with **U-shaped fortress bases**: a central keep, rear wall, and side wings framing each flag courtyard.
- Added **rear teleporter boost pads** behind each base that fling players to the opposing side shelves for flanking routes.
- Repositioned the two neutral **Puma** Warthogs and strategic pickups (sniper rifles on shelves, health/armor near bases, etc.).
- Updated focused tests in `game/blood-gulch.test.mjs`, `game/view.test.mjs`, `game/vehicle-gameplay.test.mjs`, and `server/vehicle.test.mjs` for the new layout.
- Full verification passes: **196 game tests**, **64 server tests**, TypeScript, production build, and rendered HTML (**261 automated checks total**).
- Deterministic 5-minute Blood Gulch simulation produced **13 kills, 231 shots, 24 pickups, 25 powers, and 16 respawns** with no falls, confirming bot connectivity on the new terrain.
- Public HTTP and fresh-room WSS checks passed with two flags and two Pumas in
  snapshots. Both production services were restarted. Browser layout checks were
  not performed for that checkpoint.

## Gameplay modes and leaderboards pass - 2026-09-08

- Added authoritative per-player `scoreStats` for CTF flag pickups, returns, drops,
  and captures, plus KOTH/Domination objective time, captures, neutralizations, and
  contest transitions. Continuous objective state remains snapshot-driven while
  progress/score events are bucketed to avoid a per-tick network flood.
- Objective bots now prioritize their mode objective and team combat, divert only for
  critical or immediately useful supplies, and pause steering during authored launch
  flights. Platform-map reverse launch routes and solid-top collision handling prevent
  bots from falling or being snapped onto reactor tops.
- Live standings, results, and recent-match history now keep kills and deaths while
  adding mode-specific metrics: CTF captures/pickups/returns/drops, KOTH hill time/
  captures/contests, Domination zone time/captures/neutralizations/contests, and
  Team Deathmatch team totals. History leaders use the mode's primary contribution.
- Full verification passes: **196 game tests**, **64 server tests**, TypeScript,
  production build, and rendered HTML (**261 automated checks total**).
- Deterministic 30-second simulations across Skybreak, Aether, Ironfall, and Longreach
  produced combat or objective activity in every team-mode combination. Public browser
  checks passed linked assets, responsive layouts, CTF hosting/resume, and mode-specific
  leaderboard columns with no runtime or resource errors. Both production services
  were restarted and remain active.

## Traversal and objective readability pass - 2026-09-08

- Sky-map targeted launchers now derive their authored direction from the actual
  source-to-target link, and the renderer uses that same link for launcher yaw. Pad
  stripes are parented to their launcher, so diagonal slingshots no longer point away
  from their landing route. Existing vertical-only outer trampolines remain explicit
  bounce pads rather than pretending to be cross-platform links.
- KOTH and Domination objectives now render as low-opacity, team-colored capture areas
  with a full-radius footprint, bright perimeter, progress indicator, and center
  emblem. Neutral zero-progress areas stay visible; ownership, capture, and contest
  states remain distinct in WebGL and the software renderer.
- Objective anchors are authored on supported, unobstructed surfaces for every
  canonical map. Raised Exchange/Foundry points use deck height, Ironfall uses its
  middle deck, and island zones stay within their platform footprints.
- The HUD now reports truthful terrain route context and per-zone Domination state
  instead of defaulting to CENTER or aggregate counts alone.
- Full verification passes: **185 game tests**, **61 server tests**, TypeScript,
  production build, and rendered HTML (**247 automated checks total**).

## Polish pass - 2026-09-08

- Added keyboard-accessible focus entry and Tab wrapping for setup, pause, and
  results dialogs. Escape closes setup predictably and returns focus to Match Setup;
  reduced motion now disables crosshair hit rotation.
- Objective progress rings reuse indexed WebGL geometry and update draw ranges rather
  than allocating a new ring every progress tick. The software fallback retains its
  existing geometry rebuild path for compatibility.
- Room input rejects non-finite movement values, reconnecting players and spectators
  receive completed-round results, partial team scores normalize to finite values,
  and malformed persisted history records are ignored.
- Full verification passes: **182 game tests**, **61 server tests**, TypeScript,
  production build, and rendered HTML (**244 automated checks total**).
- Public checks pass for linked assets, responsive selection/settings/HUD layouts,
  CTF setup and Resume, modal keyboard focus/Tab wrapping, and no browser runtime or
  resource errors. Both production services were restarted and remain active.

## Large map and objective modes pass - 2026-09-08

- Added three large arenas: **Sunscar Canyon**, **Ironfall Megastructure**, and
  **Longreach Plateau**. They are registered in the canonical map list, replay
  rotation, solo setup, multiplayer lobby, navigation, renderer, and tests.
- Added **King of the Hill** and **Domination**. Control points use authoritative
  fixed-step scoring, contest/neutralization rules, objective win state, bot routes,
  server events, snapshots, reconnect recovery, and persisted team outcomes.
- Added world-space control rings, progress arcs, beacons, and ownership/contest
  colors. Progress geometry is rebuilt only when progress changes, avoiding a
  per-frame allocation path.
- Reworked the in-match command layer so the player sees their team, match phase,
  score target, map route, current flag/control state, and a mode-specific next
  action. The semantic live region announces objective changes without making the
  full telemetry panel noisy for assistive technology.
- Added objective-aware setup labels, target ranges, map objective coordinates,
  history fields, and regression coverage for all new rules and geometry.
- After the production restart, public browser entry passed on Sunscar Canyon / CTF,
  Ironfall Megastructure / KOTH, and Longreach Plateau / Domination with WebGL and
  nonzero draw/triangle counters. Fresh-room public WSS checks also delivered the
  expected map, mode, flags, and control-zone snapshots.
- Full verification passes: **182 game tests**, **57 server tests**, TypeScript,
  production build, and rendered HTML (**240 automated checks total**).

## Polygon terrain renderer follow-up - 2026-09-08

- Added **Blood Gulch**, a semi-symmetric outdoor CTF canyon with a triangulated
  valley floor, interpolated north/south hills, walkable slopes, high plateaus,
  analytic terrain ray hits, cliff wall faces, central cover, and route-aware
  navigation. Terrain triangles are cached per immutable map and consumed by
  authoritative simulation and renderer geometry.
- Added two neutral **Puma** Warthog-style vehicles. A single living driver can
  enter/exit with `E`, drive using bounded forward/reverse arcade handling, and
  fire paired side-mounted chainguns. Heat, overheat, damage, driver release,
  respawn, CTF flag-carrier restrictions, snapshots, prediction rebasing, remote
  interpolation, WebGL rendering, software rendering, and bot takeover are covered.
- Added focused terrain, map, vehicle, gameplay, renderer, and server edge tests.
  Final verification passes: **170 game tests**, **53 server tests**, TypeScript,
  production build, and rendered HTML (**224 automated tests total**).
- Fixed the terrain-map renderer branch that incorrectly assumed every non-legacy
  map had `platforms`. Blood Gulch now builds its polygon surface mesh and cliff
  mesh independently; the scene regression asserts all 10 surface triangles and
  4 cliff-wall triangles are present.
- Public checks after restarting both services pass for linked assets, existing
  CTF/browser flows, and a live WSS Blood Gulch match whose snapshot exposes two
  `puma` vehicles with full health and two flags. No browser runtime errors or
  failed resources appeared.
- Arena entry now commits a local match only after `setMatch()` completes, keeps
  the RAF loop alive with a visible recovery message after a frame exception, and
  initializes network rendering from the first valid snapshot even before actor
  binding completes. Rebuilding terrain maps releases traversal resources instead
  of accumulating them.
- A ten-cycle headless browser lifecycle check entered and returned from Exchange,
  Blood Gulch, Skybreak Isles, Aether Ring, and Launchpad with nonzero renderer
  counters and no page errors. The managed SwiftShader environment is slow, so
  its wall-clock click timings are not a desktop performance claim.
- Research references: [Gaffer fixed timestep](https://gafferongames.com/post/fix_your_timestep/),
  [Gaffer networked physics](https://gafferongames.com/post/networked_physics_2004/),
  [Unity Wheel Collider concepts](https://docs.unity3d.com/Manual/WheelColliderTutorial.html),
  and [Halopedia Blood Gulch](https://www.halopedia.org/Blood_Gulch).
- Subjective Puma driving feel, chaingun audio balance, and competitive vehicle
  counterplay still require a human desktop multiplayer playtest.
- Added ray-safety coverage for zero-distance visibility, malformed directions,
  invalid ray bounds, invalid fire input, and explosions centered on vehicles.

## Launcher, weapon feel and identity pass - 2026-09-08

- Launcher flights now resolve authored `jumpLinks` into deterministic ballistic
  velocities, allow modest air correction, brake into the intended landing zone,
  and capture descending arrivals within a bounded radius. Regression tests cover
  every island launcher at normal gravity plus `0.75x` and `1.5x` speed settings.
- All eight weapons now carry distinct kick, shot/launch/impact, muzzle, tracer and
  impact-visual profiles. SynthAudio uses those profiles for local and nearby cues,
  preserves pellet deduplication and the voice cap, adds dry-fire feedback, and
  remains safe when muted or reduced motion is enabled.
- Harness profiles are integrated into authoritative movement, resistance,
  ability parameters, favored-weapon handling, bot ranges, weapon selection and
  power-use decisions. Operator profiles add deterministic bot weapon preferences
  and strafe styles without changing the existing roster or Claude compatibility.
- Final verification passes: **143 game tests**, **52 server tests**, TypeScript,
  production build, and the rendered-HTML check (**196 automated tests total**).
- Subjective audio balance, physical launcher feel, and competitive operator/
  harness balance still require human listening and desktop multiplayer playtests.

## Outdoor CTF and network smoothing pass - 2026-09-08

- Added **Skybreak Isles** and **Aether Ring**. Both are much larger than Launchpad,
  use disconnected outdoor platforms over a real void, provide north/middle/south
  routes, and include deterministic long-range boost arcs. Map data tests cover
  deep immutability, bounds, platform coverage, symmetry, route/link metadata,
  safe pickups/spawns, and descriptive map contracts.
- Island movement now returns `null` for uncovered void surfaces, preserves the last
  valid platform position, drops carried flags on fall, emits fall/death events,
  and respawns through normal team-aware spawn selection. Authored jump links are
  included in cached bot navigation; seeded launcher simulations land on platforms.
- The Three.js arena renderer draws individual island slabs, supports, route accents,
  and a deep void instead of a full rectangular floor. Selection previews derive
  their SVG viewBox from map bounds and draw platforms plus launch links.
- Multiplayer inputs now carry monotonic sequence numbers. Rooms acknowledge the
  latest input actually applied for each actor; clients rebase the shadow match and
  replay only unacknowledged inputs. Older snapshots are rejected, and remote actor
  interpolation uses smoothed server simulation time with a 160ms buffer.
- The full suite passes: **135 game tests**, **52 server tests**, TypeScript,
  production build, and the rendered-HTML check (**188 automated tests total**).
- Focused real-WebSocket tests pass for input acknowledgements, prediction replay,
  stale snapshot rejection, room reconnects, spectators, simultaneous rooms, and
  results delivery. Public deployment verification also passes after the service
  restart: both new maps load, CTF flags/team scores initialize, WSS hosting and
  movement remain functional, and no browser errors or failed resources appear.

## Replayability and gameplay pass - 2026-09-08

- 178 game/server tests pass after the combined collision, bot, presentation,
  replayability, map, mode, weapon, and powerup changes. This includes cover
  landings and embedded-state recovery on all maps at normal/low gravity, turbo
  ramp traversal, bot reacquisition and difficulty comparisons, cached-navigation
  isolation, recoil decay, effect/audio bounds, and preset/shuffle/map-rotation tests.
- In the fixed-seed, stationary 20-second firing-lane fixture, Easy dealt 88
  cumulative damage in 31 shots, Normal 418 in 58, and Hard 1,617 in 147. The
  fixture repeatedly replenishes target health to measure cumulative damage;
  these are relative tuning checks, not human win-rate or survival guarantees.
- Nine viewport sizes passed menu/setup/browser/lobby/HUD checks. Browser tests
  exercised all four presets, compatible shuffle, personal result stats, Next
  Arena with preserved rules, and CTF setup on Launchpad with three-capture
  scoring, team assignment, two flags, and resume. The results fixture advanced
  simulation time to the end of the round; it was not a full-duration human match.
- Real host/guest WebSocket browser tests passed movement, a multiplayer jump and
  clear landing, drag aim, capture recovery, chat, host resume, and solo/network
  transitions. Network snapshots preserve effect/recoil lifetimes between frames.
- TypeScript, the production build, and the rendered-HTML test pass (179 automated
  tests total). Both production services were restarted together; public checks
  passed linked assets, presets, WSS hosting, movement, jumping/landing, firing,
  captured relative aim, and host resume, without browser runtime errors.
- Weapon sound quality and competitive balance still need listening/human
  playtesting; no new hardware-GPU benchmark is claimed.

## Content expansion - 2026-09-08

- Added two maps: **Launchpad**, a large symmetric CTF field with red/blue bases,
  four trampolines, and four directional boost launchers; and **Citadel**, a larger
  fortress-lane arena. Map tests cover bounds, objective symmetry, traversal
  metadata, safe pickups/spawns, navigation connectivity, and map-state isolation.
- Added **Capture the Flag** with flag pickup, drop-on-death, return, capture-home
  preconditions, team scoring, objective-aware bots, team starts, snapshots, and
  lifecycle events. Added **Team Deathmatch** with shared scoring and disabled
  friendly fire. New CTF rounds default to three captures.
- Added Grenade Launcher (gravity/bounce splash projectile), Shock Beam, and Flak
  Cannon, expanding the inventory to eight weapons while preserving the original
  five IDs. Added Haste, Overcharge, and Overshield pickups with timed movement,
  cadence, damage, and shield effects. New content has focused contract, balance,
  lifecycle, and combat tests.
- The complete sequential suite passes: **178 game/server tests**, plus the
  rendered-HTML check. TypeScript, production build, and `git diff --check` pass.
- Browser checks pass across nine viewport sizes for the existing menus, room
  browser, lobby, HUD, presets, shuffle, and Next Arena. A dedicated CTF check
  passes Capture the Flag setup, Launchpad selection, three-capture scoring, team
  assignment, flag snapshots, and Resume.
- Production verification is performed after restarting both services so the
  versioned asset manifest cannot point at removed files. Human balance, audio
  tuning, and hardware-GPU performance remain manual validation items.

## Current verification - 2026-09-08

- **128 game/server tests and one rendered-HTML test pass**, including per-operator
  stats, healing limits, respawns, multiplayer loadouts, prediction, and resolution
  scaling. TypeScript and the production build pass.
- Headless Chromium checked menus, settings, setup, browser, lobby, and HUD at
  320x568, 390x844, 667x375, 768x1024, 1024x768, 1366x768, 1440x900,
  1920x1080, and 2560x1080. Operator lists have no internal clipping; all nine
  choices and the action bar fit the tested desktop viewports from 1366px wide.
- Two browser clients against a real isolated WebSocket server verified solo to
  multiplayer transitions, host and guest movement/camera updates, drag aiming
  with capture deliberately denied, host resume without restarting the match,
  neutral inputs while in lobby/chat, chat Escape isolation, real pointer lock
  acquisition/release/reacquisition, and return to solo play.
- The deployed public URL was checked after restarting both services. Linked
  CSS/JavaScript assets loaded successfully. A separate verification room exercised
  public WSS hosting, Claude's 115 maximum health and 8.2 m/s movement, WASD camera
  movement, capture, aiming, and the host Resume control. The test explicitly left
  its room after completion; no application runtime errors were observed.
- Captured aim on the public site used an injected relative mouse event: headless
  Chromium's absolute mouse automation emitted cancelling pointer-warp deltas.
  This verifies the input handler and network/render path, not physical mouse feel
  or a hardware GPU performance benchmark. Operator balance remains initial tuning.

The sections below preserve historical verification checkpoints.

Baseline MVP verified 2026-09-05; expansion evidence appears below. The MVP is implemented and playable. Automated checks pass and the local browser match loop was exercised with real inputs. The normal hardware WebGL2 path could not be visually benchmarked in this environment; the browser uses the implemented CPU compatibility renderer instead. These are explicitly separate claims.

## Automated evidence

- **12/12 simulation tests pass:** all 20 character/harness pairs and runtime correction; spawn protection; armor and Guardrail; one-time death/kill attribution; suicide scoring; frag-limit lock; time-limit ties; ray obstruction; open-line hits; pulse damage/knockback/cover; power duration and cooldown; ammunition/fire-rate rules; swept rockets and covered/self splash; equal diagonal movement; jump/landing/wall collision; climbing both ramps; connected navigation graph; pickup usefulness; clean match reset; complete deterministic four-bot match.
- Final deterministic match reached the stop condition at **79.85 simulated seconds**, with **760 shots, 51 deaths, 42 pickups, 34 powers and 53 total spawns** (including the five initial spawns). These are simulation observations, not frame-rate measurements.
- **TypeScript passes:** `npx tsc --noEmit`. The dormant starter database helper has explicit optional binding typing; no database is provisioned or used.
- **Production build passes:** the Sites build helper completes the client and Worker bundles. The only relevant bundle warning is the large Three.js chunk; this is not a failed build.
- **Server response test passes:** bundled Worker serves HTTP 200 HTML with TOKEN ARENA selection content and no starter development metadata.

## Browser evidence

The managed Chrome browser has WebGL disabled (GL_VENDOR / GL_RENDERER reported Disabled). The software renderer consumes the same Three.js scene, cameras, geometry and models; it does not substitute fake gameplay.

Real clicks and keyboard inputs verified:

- Fresh launch reaches selection and the renderer enables Enter Arena.
- All five characters enter a five-actor match. Claude auto-equips Claude Code and the other three harness buttons disable. The full compatibility matrix is also tested below the UI.
- WASD changes world position, Space gives positive vertical velocity and airborne height, mouse movement changes yaw/pitch, and actual pointer capture reports active.
- Q activates Claw Burst and advances the displayed cooldown. A quick click is buffered to the next simulation step; player shot count increases.
- Escape pauses and releases the pointer. Simulation time remained unchanged between separated paused-state reads; explicit Resume resumes it.
- Audio mute toggle and sensitivity slider accept interaction. Mute persisted when returning to selection. Subjective sound quality/listening was not verified.
- Bots visibly move and fight, kill feed and health update, the human dies and respawns, and match counters record pickups and powers.
- A complete observed browser match ended at about **01:13**, with **Meta 15, Claude 13, Qwen 12, Grok 9, human 0**. This was a mostly stationary observer run after control checks, not a claim of winning a human playtest. A subsequent small bot-perception correction was covered by the final deterministic simulation run.
- Results displayed the correct winner. Play Again reset time to 0, all frags/deaths to 0, projectiles to 0, and pickup/power counters to 0, with five initial actors. Return to Loadout worked; another four operator-start/pause/selection cycles also completed.
- Menu/HUD and original arena/robot/weapon geometry were visually inspected. No blocking application exception remained after the compatibility renderer was installed. Browser-extension metadata errors are separate from application logs.

## Performance observations and limits

Observed software-rendered gameplay snapshots ranged approximately **11–57 FPS** at the browser's roughly **1363×936 viewport**, with a brief transition sample around 5 FPS. The compatibility renderer uses an internal 0.85 resolution scale. This is a variable cloud CPU observation, not a sustained benchmark or a 1080p desktop GPU result.

The requested **60 FPS at 1080p** remains a target. Hardware details and hardware WebGL performance were unavailable, so no GPU benchmark is claimed. The GPU path uses Three.js 0.185.1, original low-poly models, a pixel-ratio cap of 1.5, and no postprocessing.

## Known limitations / unverified checks

- CPU rendering uses painter sorting, so intersecting surfaces and large floor triangles can show depth-order artifacts. WebGL2 is the preferred renderer; the fallback prioritizes continued play when WebGL is disabled.
- All weapons and powers have consequential logic tests, but exhaustive human-controlled weapon pickup/aim/fire and visual expiry checks for every combination were not completed in the cloud browser.
- Both ramp ascents and collision boundaries were tested in the shared controller; a manual human traversal of every map edge was not completed.
- One difficulty, simple waypoint routing and occasional recovery turns are deliberate prototype behavior. Fine competitive bot balancing is future work.
- Several rematches/selection cycles verified reset behavior. Deep heap profiling, long-duration soak testing and exhaustive listener-count instrumentation were not performed.
- Audio initialization and mute logic are implemented; audible balance is not listening-verified. Touch gameplay is not implemented; the interface states the desktop requirement.
- At the baseline MVP checkpoint, no online multiplayer, persistence backend, extra maps, progression or post-MVP content was built. The authorized expansion below supersedes the content restriction.

## Handoff gate

The baseline MVP checkpoint was complete. The runnable game, specification, plan and README are provided, with the remaining hardware and exhaustive manual validation limitations disclosed. Do not label those unverified checks as passed. A desktop hardware playtest is the next validation step, not permission to begin the post-MVP roadmap.


## Authorized content expansion 0.2 — 2026-09-06

The expanded source includes nine operators, seven harnesses, five weapons and three selectable arenas. Added operators are Gemini, DeepSeek, Mistral and Kimi; harnesses are Codex (healing), Cline (collision-aware dash) and Roo Code (line-of-sight slowing field); weapons are Scattergun and Plasma Driver; arenas are Crosswire and The Foundry.

- **20 simulation tests pass:** the original 12 plus eight expansion tests cover all 63 requested character/harness pairs (57 valid loadouts, with incompatible Claude choices corrected), healing caps/cooldowns, dash distance and cover, slowing/expiry/death cleanup, scatter pellet damage and one-shell cost, plasma impacts, map navigation, pickups, match completion and independent map state.
- All navigation graphs connect: Exchange 95/95 nodes, Crosswire 77/77, Foundry 84/84. Deterministic matches finish on all three maps, with shots, kills, pickups, powers and respawns observed.
- TypeScript, production build and the rendered HTML test pass (21 automated test cases in total).
- Browser inspection verified the expanded selection layout, Gemini preview, new harness controls, three arena radio options and five weapon entries. Crosswire selection was confirmed through the radio control. New power and weapon mechanics are verified in simulation; exhaustive manual playtesting of each addition is still pending.
- Hardware WebGL performance remains unverified. The baseline CPU renderer limitations still apply. No online multiplayer or progression backend is introduced.


## Custom matches 0.3 — 2026-09-07

- **34 simulation tests pass** (20 existing, nine configuration and five multi-human tests). New evidence covers malformed saved configuration, per-match isolation, exact counts from zero through eight bots, solo timer completion, Instagib protection/one-hit behavior and power restrictions, locked/unlimited mode inventories, spawn resets, configured scoring and respawn delay, damage/life-steal limits, cooldown modifier, gravity/speed effects, difficulty-dependent reaction/aim/firing cadence, human actor creation via `humanCount`, per-actor look/fire/movement/weapon inputs, idle humans never invoking bot AI, mixed human/bot determinism and the legacy single-input step shape.
- All **16 game mode × bot difficulty combinations** complete deterministic eight-bot matches with shots and kills and finite actor state.
- **TypeScript, production build and rendered HTML response test pass**; 30 automated test cases total. The response test checks that game setup controls are included in server-rendered content.
- Source review confirms FOV updates the Three camera projection, weapon visibility controls the first-person group, and crosshair/FPS preferences reach the HUD. Local storage input is normalized before runtime use. These are code checks, not manual browser observations.
- No browser or GPU benchmark was performed for this configuration pass. Larger matches may cost more CPU; the inherited renderer limitations still apply. UI interaction, persistence across real browser reloads, visual layout, and subjective difficulty balance should receive a desktop playtest.

## Local multiplayer 0.4 — 2026-09-07

- **15 server tests pass** (12 room + 3 real-WebSocket E2E). Room tests cover host rules, config clamping, per-peer actor slots and names, remote look/fire/events deltas, one-shot jump/power edges, timer results, disconnect idle, rematch, plus the new reconnection suite: seat held during grace with identity/seat/inputs restored on token reattach, grace expiry converting the seat to a `· BOT` and migrating host duties, immediate bot handoff on explicit leave, and host restoration for a reconnecting host inside grace. The E2E tests play full matches to results over real sockets; one drops a NetClient mid-match and reconnects it to the same seat (actor id preserved, prediction resynced, results received).
- **38 game tests pass**, including the three shadow-prediction tests and a token persistence test (issued on `welcome`, stored per server URL, reused across instances, cleared on explicit leave).
- TypeScript, production build and the rendered HTML test remain green.
- Two headless demo clients were observed on this machine playing a live match (deaths, respawns, frags, and snapshot streams on both connections). A live prediction measurement showed the shadow leading server truth by ~0.11 units on average (~one 60Hz tick of travel) and converging on each snapshot.
- The browser UI (lobby, host controls, net HUD, results) compiles and is exercised through the NetClient integration test; manual browser playtesting of the network match, interpolation feel, prediction feel, and the solo-vs-net mode switching still requires a desktop browser on this machine.

## Concurrent rooms, spectator mode and match history 0.5 — 2026-09-07

- **37 server tests pass** (12 room + 7 spectator + 6 registry + 6 history + 6 real-WebSocket E2E). The room suite is unchanged; the new spectator suite proves no-seat/no-host joins, player-limit exemption, `humanCount` exclusion, host/start rejection, ignored gameplay inputs, snapshot/event/results delivery and spectator token reattach; the registry suite covers create/join/list summaries, collision-checked 4-letter codes, empty-room retirement and cross-room tick/expire/drain drivers; the history suite covers entry shape, frag vs time endings, JSON file round-trip in a temp directory, 50-entry cap enforcement, no file writes without an injected path, and a completed `Room` match recording into the shared history.
- New real-socket E2E tests: two rooms play simultaneously to results with per-room broadcast scoping verified (room 2's players never see room 1's snapshots), a spectator receives snapshots, event deltas and results across a full match, and a `history` query returns the completed match entry (instagib, frag ending, four recorded players).
- **38 game tests pass**, untouched. TypeScript, production build and the rendered HTML test remain green.
- The room browser UI (join/WATCH/create, lobby room code, recent-matches panel) compiles and is exercised through the NetClient integration tests; manual desktop-browser playtesting of the browse screen, spectator camera-follow view, and history panel styling still requires a browser on this machine.

## Room chat and multiplayer fixes 0.6 — 2026-09-07

- **48 server tests pass** (12 room + 7 registry + 7 spectator + 6 history + 5 chat + 11 real-WebSocket E2E). The registry suite gains the regression that `expireAll` retires abandoned on-demand rooms while `local` persists; the five chat unit tests cover sanitization (control chars stripped, trimmed, 200-char cap), empty-text drops, the per-peer 300ms rate limit, unknown-peer ignoring, and spectator chat delivered as a room broadcast.
- New real-socket E2E tests: create always mints a fresh room even when the client carries a stored `roomId` (a second fresh socket lists it); a NetClient that drops after creating reattaches to its room via the stored token and chats; an abruptly abandoned room disappears from `list` after grace while `local` persists; create releases the previous room seat (no zombie peer lingers in the old room, which is then retired); and chat is room-scoped — every peer and spectator in the room receives it, a client in a different room and a non-member receive nothing (the non-member gets `not in a room`), and chat flows during a live match.
- **38 game tests pass**, untouched. TypeScript, production build and the rendered HTML test remain green.
- The chat UI (lobby panel under the player list, in-game overlay opened with T/Enter) compiles and is exercised through the NetClient chat test; manual desktop-browser playtesting of the overlay layout, key handling and spectator chat still requires a browser on this machine.

## Menu cleanup 0.7 — 2026-09-07

- Selection screen reorganized around game-menu best practices: identity first (operator, live preview, harness), match rules and arena behind a `MATCH SETUP` dialog (kept in the DOM and CSS-hidden so the server-rendered content is unchanged), and a persistent sticky action bar with one dominant primary action (`ENTER ARENA`) plus `PLAY ONLINE` / `DISCONNECT`, `MATCH SETUP` and settings gear.
- Progressive disclosure: the multiplayer panel and `ws://` server-address input left the selection screen and became a compact row in the room browser with a `QUICK JOIN` shortcut; Escape closes the setup dialog and settings panel; modals fade/scale in at 200ms.
- **All automated gates remain green**: 38 game tests, 48 server tests, typecheck, production build and the rendered-HTML test (which still finds MATCH SETUP, Instagib, Rocket Arena, Full Arsenal, Bot count, Bot difficulty, Your callsign and Movement speed in the server-rendered HTML). Manual desktop-browser playtesting of the new layout and modal flows is still pending on this machine.
