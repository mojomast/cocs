# Changelog — COCS: Colosseum Of Competitive Slop

See the [README](../README.md) for the current feature overview.

COCS releases are dated and numbered `vMAJOR.MINOR`, with occasional
`vMAJOR.MINOR.PATCH` fix releases. The version currently shipped is shown in the
title-screen footer (the `title-footer` element). That footer in
[`app/page.tsx`](../app/page.tsx) is the single source of truth and is parsed by
[`scripts/read-version.mjs`](../scripts/read-version.mjs); this changelog is the
historical archive.

Releases are listed newest-first. The long release log in the README was stored
out of order; this file restores strict reverse-chronological order, normalizes
version labels to `vX.Y`, and fills the gaps in that log from the dated release
record in [VERIFICATION.md](VERIFICATION.md).

---

## v5.5 · FIDELITY — 2026-09-16

- **Surfaces:** `textures.mjs` adds `diamond_plate`, `riveted_armor`,
  `circuit_board`, `brushed_metal`, `corrugated_metal`, `alien_chitin`,
  `rough_stucco` and `industrial_mesh`, each with a pattern generator, alias names
  and a canonicalizing `canonicalTextureKind` (`TEXTURE_KINDS`). `surfaceTextures`
  takes a `bump` option and emits `result.bumpMap`; the cache key includes every
  flag so a bump/no-bump request cannot collide, and generated maps keep the
  `userData.surfaceKind` tag. `view.mjs` maps arena floors/blocks and terrain to
  the new kinds (`foundry` floors are diamond plate, `citadel` blocks are riveted
  armour, `metal` terrain is industrial mesh, lava is corrugated metal, stone is
  rough stucco).
- **Particles:** `EffectPool` recycles via one linear oldest-slot scan instead of
  `filter().sort()`, and reuses per-slot scratch `Vector3`/`Color` across cycles.
  `add` accepts `fade` (`linear`/`smooth`/`exp`/`pop`), `damping`, `gravity`,
  `spin`, `startOpacity` and `endColor`. Rocket projectiles trail smooth-fading
  exhaust, shield breaks shed spinning wireframe debris with gravity, and rail
  impacts fade white → beam colour. `view.mjs` also caches pickup geometry
  (`pickup-armor-octa`, `pickup-power-ico`) through `ModelAssets` and adds barrel
  anchors for weapons 8/9.
- **Models:** `models.mjs` gains conduit/plating/muzzle-brake/radiator/vent/
  holographic-emitter/bulkhead/bio-armour builders, `enhanceVehicleModel`/
  `enhanceOperatorModel`, and `applyProceduralTexturesToModel` (wires `map`,
  `roughnessMap`, `normalMap`, `bumpMap`). These remain test-only helpers.
- **Model detail:** a Hornet sensor pod/lens and formation beacons, and Puma rear
  tail-lights and exhaust pipes.

## v5.4 · DETAIL — 2026-09-16

- **Recoil fix:** `WeaponRig.recoilImpulse` wrote the kick to `recoilSpring.vel`
  (a field `VectorSpring3D` does not have), so recoil never reached the springs;
  it now drives `recoilSpring.z.vel`. The rig also adds a stride bob tied to the
  movement cadence (`stridePhase`), a strafe roll, and procedural reload/swap
  tuck-downs via `triggerReload`/`triggerSwap`.
- **Character motion:** `CharacterRig` tracks `land`/`reload`; `characterPose`
  adds landing knee compression and torso lean, a reload arm animation, strafe
  knee flexion, head stabilisation, and a final bounded clamp on every rig angle.
  `view.mjs` passes the actor's `reloading` state through.
- **Viewmodel feedback:** `WeaponFeedback` adds reload dip/pitch/roll and a
  weapon-swap tuck, retunes idle sway, and leans the viewmodel into strafes.
- **Surfaces and models:** `textures.mjs` adds `carbon_fiber`, `metal_grating`,
  `hex_paneling`, `hazard_stripes`, `weathered_concrete` and `holographic_grid`
  pattern generators (with `TEXTURE_KINDS`); `view.mjs` maps arena floors and
  blocks to them by map, adds a weapon ejection deflector, Hornet fins/skids,
  Puma splitter/hood vents, and arm/leg armour plates. `models.mjs` adds reusable
  conduit/plating/muzzle-brake/radiator builders and `applyProceduralTexturesToModel`.

## v5.3 · IMPACT — 2026-09-16

- **ADS viewmodel:** the first-person hands lerp from the hip layout onto the
  iron-sight centre line while aiming (`_adsTransition`, frame-rate independent)
  and ease back on hipfire; reduced motion pins the fixed hip layout. Weapon
  kick/roll is damped by the same blend.
- **Energy shields:** `temporaryShield`/`juggernautShield` now drive the actor's
  shield mesh — cyan for Overshield, amber for the Juggernaut — with a higher
  opacity while charged. `Match.damage` emits `shieldBreak` when shields plus
  armor fall from positive to zero on a surviving target, and the view answers
  with a wireframe shard burst and the synth with a layered crack.
- **Hit feedback:** `hitMarker` recognises a `critical` tier (gold), driven by
  `e.critical`/`e.headshot`/`amount >= 48`; damage numbers gain a `.critical`
  style; the health card pulses under 30% and the audio raises a heartbeat, and
  killstreak `spree` gets its own announcer cue and engine pitch lift for
  boosting vehicles.
- **Nitro exhaust:** boosting/turbo vehicles emit pooled exhaust particles behind
  the chassis (suppressed under reduced motion).
- **Narrative:** campaign `story-line`/`bark` transmissions resolve `SPEAKERS`
  profiles to a display name, callsign, tag and colour; the solo HUD renders the
  tag/callsign and a distinct bark style, and surfaces the (already-snapshotted)
  out-of-combat `regen` state.

## v5.2 · RESTORE — 2026-09-16

- **Campaign persistence (critical):** `recordMission` wrote entries without a
  `won` flag, but `normalizeCampaignProgress` dropped any entry lacking
  `entry.won === true` — so every completed mission vanished on the next page
  load and the campaign reset to mission one. Normalization now validates by
  `wins`/`attempts` (with `won:true` accepted as legacy back-compat) and a new
  round-trip test fails if a recorded win is dropped again.
- **Attempts:** a loss now bumps `attempts` without `wins`, and "completed" is
  `wins > 0` everywhere (`isMissionComplete`) instead of entry presence, so a
  lost mission neither unlocks the next one nor earns stars. The game-over path
  records losses; mission-select shows real attempts.
- **VIP Escort scoring:** `updateExtraction` credits `objectiveTime` to escort
  actors near the VIP and `objectiveCaptures` on extraction, so the
  `ESCORT TIME`/`EXTRACT` columns and `rankTuple('vip-escort')` stop reading zero.
- **Race robustness:** `initializeRace` seats `min(8, actors)` racers and requires
  that many grid slots (previously it always built eight vehicles and crashed on
  a shorter grid); a coincident prev/next gate can no longer divide by zero into a
  NaN `progress`.
- **Horde:** the live enemy cap now trims husks last (it previously skipped them,
  so deep overflow waves exceeded `maxAlive`), and an elite wave is only announced
  when an elite heavy actually survives the composition trim.
- **Vehicle HUD:** `vehicleHud` recognises a gunner/passenger as mounted, so they
  get the PUMA card and exit prompt, not just the driver.
- **Accessibility:** the onboarding modal now joins the focus trap.

## v5.1 · TIGHTEN — 2026-09-16

- **Challenge aggregation:** `advanceGroup` now treats `bestStreak` as a
  high-water mark (`MAX_METRICS`) instead of a running total, so a weekly "reach
  an 8 killstreak" objective cannot be completed by accumulating several smaller
  streaks. Covered by a new `game/challenges.test.mjs` case.
- **Scoreboard inputs:** `pingLabel` returns null for a `null`/empty ping instead
  of coercing it to a healthy `0`, and `scoreboardGroups` no longer coerces a
  `null` team to `0` (RED) — an unassigned actor stays in the `UNASSIGNED` group.
- **Solo HUD:** the objective counter is clamped so a mission that keeps running
  after its last step shows `total / total` instead of `total + 1 / total`.
- **Accessibility:** the Graphics & settings dialog is now included in the modal
  keyboard-focus trap and focus-on-open, matching the setup/results/single-player
  modals.
- **Cleanup:** removed the unused `campaignMissionStars` duplicate of the
  authoritative `missionStars` rule (and its stale test assertions).

## v5.0 · COMPACT — 2026-09-16

**Protocol:** `SNAPSHOT_DELTA_VERSION` 1 → 2. The envelope stays additive and
version-gated, so older clients keep receiving full snapshots.

- **Id-keyed array patches (`$A`):** `snapshotDelta` now diffs arrays whose
  elements are plain objects with a unique `id` element-wise — an `order` list
  only when the identity sequence changes, a `set` map of nested patches for
  surviving elements, and an `add` map for inserts. Removals are implied by the
  new order, and `applySnapshotDelta` rebuilds the array exactly. Arrays without
  ids (e.g. `leaders`, `ammo`) stay opaque leaves. Measured on real frames this
  cuts a full 8v8 snapshot from ~30 KB to ~3 KB (≈90%); the pure unit tests and
  the net harness assert the round-trip and the compression floor.
- **Server-side deltas:** `Room` broadcasts per-peer frames. The shared patch is
  computed once per tick against the previous broadcast and reused for every peer
  whose base matches; peers with a stale/missing base, or with no advertised
  capability, get a full snapshot. A configurable keyframe cadence (default once
  per second) bounds recovery after a dropped frame. `SNAPSHOT_DELTA` is treated
  as replaceable under backpressure, like a full snapshot.
- **Capability handshake:** `join`/`create` advertise `delta: 2`; the room clamps
  it to its own revision and only deltas peers at or above it.
- **Telemetry:** the game server's status JSON reports aggregate
  `snapshot.deltaFrames`/`fullFrames`; `tokenArenaDebug.delta()` reports the
  client's delta hits, misses, base and bandwidth rate.

## v4.17 · STREAMLINE — 2026-09-16

- **One interpolator:** `NetClient.renderState` now delegates actor/rocket/vehicle
  blending to the exported `interpolateSnapshots` helper instead of carrying a
  second copy, so the live render path and the deterministic net harness cannot
  drift apart.
- **Essential-queue starvation:** `queueEssential`/`pumpEssential` now hand off to
  the pure, tested `drainEssential`. A single control message larger than
  `TRAFFIC_BUFFER_LIMIT` can no longer block every later reply forever; the
  scheduler sends it once the socket has drained, preserves order for everything
  that fits, and discards entries for a room the peer has left.
- **Dead code:** removed unused exports (`blendRacePose`, `racePoseBearing`,
  `raceShortestArc`, `raceSmoothFactor`, `RACE_CAMERA_HALF_LIFE`,
  `vehicleOccupantCount`, `showcaseById`, `createArmorEdgeHighlight`, `MODE_IDS`,
  `LOADOUT_KEYS`, `PRESTIGE_VERSION`, `zoneHard`).
- **Note:** server-side snapshot deltas remain future work — `snapshotDelta`
  treats arrays as opaque leaves, so the actor/rocket arrays would still cross the
  wire whole (documented in `game/protocol.mjs`).

## v4.16 · SIGNAL — 2026-09-16

- **Demo continuity:** the saved display settings (including `reducedMotion`) are
  applied before the first `buildShowcase`, and the attract reel no longer gates
  on reduced motion, so it keeps cycling instead of dropping to the operator
  preview after the first scenario. `tokenArenaDebug` exposes `state()`/`skip()`
  for forcing a cycle in tests.
- **Award data:** `Match` now tracks per-actor `scoreStats.shots`/`hits`/`damage`
  (counted in `fire` and `damage`), so `matchAwards` emits BEST ACCURACY and MOST
  DAMAGE. `outcome.scoreStatsOf` carries them into history without touching the
  objective ranking (`objectiveActions` uses an explicit objective field list).
- **Matchmaking identity:** `Matchmaker.enqueue` retains `playerId`/
  `progressToken` and `draftQueue` seats players with them, so a queued career is
  no longer replaced; `list()` still omits the owner token.
- **Wire contract:** the lobby/matchmaking verbs are declared in `MESSAGE`, with
  `server/protocol.test.mjs` asserting every dispatch literal is declared.

## v4.15 · AMBIENT — 2026-09-16

- **Demo options:** the back-to-demo controls gain MUSIC (new
  `SynthAudio.setMusicEnabled`, independent of the global mute), AMBIENCE and
  ANNOUNCER toggles, and an ENVIRONMENT picker (`view.setWeather`: AUTO + the six
  `WEATHER_KINDS`).
- **Sticky weather:** a pinned weather override now persists through the
  cinematic demo (`view.render` no longer clears it while `cinematic`); a real
  match still clears it.
- **Persistence:** music/ambience/announcer/weather are stored in
  `token-arena-settings` and applied on load; the settings dialog now merges
  instead of overwriting the prefs object so unrelated changes keep them.

## v4.14 · TUNED — 2026-09-16

- **Objective variants:** Holdout, Uplink and VIP Escort get the right
  `commandBrief`, `modeColumns`/`modePrimary`, `rankTuple` ordering and
  `modeTargetText`; the Uplink brief no longer falls through to the KOTH copy
  (the engine reports `kind:'koth'`). `game/hud.test.mjs` now uses the real kind.
- **Sudden death:** `suddenDeathBanner` also reads `objectives.suddenDeath`, so
  Juggernaut and Team Elimination banner again.
- **Bots:** `objectiveMode` includes the three objective variants so supply runs
  route to the objective.
- **Campaign:** `mission-message` events surface as HUD notices.
- **Server:** `lifecycle()` counts only connected peers' map/rematch votes, and a
  reconnect clears the old peer's ready flag and votes.
- **Menu:** Match Setup restores focus to its trigger
  (`[data-setup-trigger]`), Theater camera hotkeys cover rigs 1-8, and the title
  overlay no longer intercepts clicks meant for the footer GitHub link.

## v4.13 · ATTRACT — 2026-09-16

- **Broadcast scope:** the demo announcement lower-third is part of the title
  screen foreground and the new back-to-demo view only, so it no longer covers
  main-menu controls.
- **Fullscreen:** the menu top bar gains a fullscreen toggle that reflects the
  browser fullscreen state (`aria-pressed`, Maximize/Minimize).
- **Back to demo:** a menu button hides the title overlay, returns to the live
  demo, and shows playback controls (previous/next mode plus enter); arrow keys
  cycle modes and Enter/Space/Escape return to the menu.

## v4.12 · SYNC — 2026-09-15

- **Build sync:** `app/api/version/route.ts` reports `RELEASE_VERSION`; the client
  polls it on load, on focus and every five minutes, and offers a one-click reload
  when the deployed build is newer. `NetClient` also stamps `PROTOCOL_VERSION` on
  join/create, the server echoes it in `welcome`, and a mismatch raises the same
  reload notice.
- **Campaign checkpoints:** `normalizeConfig` preserves a validated `checkpoint`
  step; the page banks the step from `singleplayer-checkpoint` events, resumes via
  `checkpointFor`, and clears it with the mission win. Tests cover normalization
  and round-tripping.
- **Star consistency:** the mission-select adapter now derives stars from the
  authoritative `missionStars` (time and score) so the UI agrees with the reward.
- **Feedback:** enemy telegraphs and single-player abilities are captioned and
  audible (`feedback.mjs`); VIP Escort draws its extraction beacon
  (`objectiveState` extraction fields + `ArenaView.updateObjectives`).
- **Reconnect intent:** room and spectate intent are remembered so a reconnect
  rejoins the same room as the same kind of peer.

## v4.11 · HARDENED — 2026-09-15

A wiring, cache and correctness pass driven by a three-area audit.

- **Demo never freezes or shows the model:** `ArenaView.render` now honors the
  showcase snapshot on `browse`, `lobby` and `changelog` (not just
  selection/theater/progression) and composites the operator preview on
  `progression`; the page passes real elapsed time to those screens.
- **Stale bundles impossible:** `next.config.ts` sends `Cache-Control:
  no-cache, must-revalidate` for the document (hashed assets keep `immutable`),
  and `scripts/verify-deployment.mjs` fails a deployment whose HTML is cacheable.
  The verifier also checks `preload`/`modulepreload` asset references.
- **Objectives and rewards:** team scoreboards group the newer team modes
  (`holdout`, `uplink`, `vip-escort`, `team-elimination`); Juggernaut is awarded on
  crown points, not frags; soccer goal events carry a finite position; HUD goals
  and briefings cover holdout/uplink/vip; replay timelines include the newer
  objective events.
- **Multiplayer robustness:** room lookup is case-insensitive (so `LOCAL` and
  `local` both resolve); invite links can encode a spectate/watch intent; a full or
  closed room falls back to the refreshed room browser; `VOICE_CONFIG` no longer
  terminates a congested socket; the server uses the shared quantizer.
- **UI wiring:** practice-vs-bots honors its bot-count and difficulty pickers;
  mission select opens from the rank screen; local spectate hides the network-only
  H/P controls; the radar draws off-screen bearing arrows.

## v4.10 · CLARITY — 2026-09-15

- **The demo no longer shows the operator model between scenarios.** The view's
  `showcaseExpected` flag is now set from the showcase *setting* every frame (and
  mode), independent of whether a snapshot is ready, and the retry keeps
  attempting a fresh scenario. A cycling or failed rebuild can no longer reveal
  the full-screen operator turntable behind the menu.

## v4.9 · INVITE — 2026-09-15

- **Invite links:** the lobby and room browser can copy a `?room=CODE` link.
  Opening it auto-connects and joins that room; a stale code falls back to the
  room browser with a friendly message. Parsing lives in the pure
  `game/invite.mjs` (`inviteLink`, `roomFromLocation`, `normaliseRoomCode`).
- **Readable title demo:** the `.title-stage` vignette was lightened and the
  broadcast lower-third was raised above it with a darker, higher-contrast card
  so the live mode, map and score stay legible over the demo.

## v4.8 · BROADCAST — 2026-09-15

- **Demo broadcast lower-third:** the title showcase now drives a broadcast-style
  overlay that reports the live mode, map, clock, score and objective, with
  animated metric blocks, a LIVE bug and a scrolling ticker. The digest comes from
  the pure `game/broadcast.mjs` helper.
- **In-game patch notes:** a Changelog screen (`app/ui/screens/ChangelogScreen.tsx`,
  data in `game/changelog.mjs`) shows the running release and recent patch notes,
  reachable from the menu header and the loadout action rail, and links to this
  file.
- **Demo background fix:** the view no longer flashes the full-screen operator
  turntable between showcase scenarios. `ArenaView.setShowcaseExpected` makes a
  frame that arrives before the next showcase snapshot render the arena scene
  instead of the model preview, and the page always sets the showcase snapshot on
  a scenario change.
- **Documentation rebuilt:** a rewritten README front door plus a `docs/` tree
  (architecture, systems, testing, deployment, changelog, index) and this archive;
  historical spec, plan and audit documents moved under `docs/spec/` and
  `docs/history/`.

## v4.7 · SPECTACLE — 2026-09-15

- **Title showcase:** the menu reel is a random cycle of cherry-picked mode/map
  combos, with atomic rebuilds so it never drops to a static preview.
- **Vehicles:** Titan, Scout and Transport are placed on the warzone maps
  alongside Pumas and Hornets.
- **Single-player atmosphere:** missions author weather (blizzard, ash, storms)
  with scripted mid-mission changes and timed story transmissions that surface
  as voice-over beats.

## v4.6 · TUNED — 2026-09-15

- **Weapon balance:** distinct roles and retuned TTK for all ten weapons, with
  DPS/TTK balance metrics.
- **Single-player regen:** out-of-combat health recovery in campaign and horde
  (delay after damage/firing, reset on respawn/resupply/checkpoint).
- **Narrative & animation scaffolding:** speaker/mission-lore data, campaign
  briefings, procedural weapon rig/springs/IK, material fidelity presets and
  richer announcer audio.

## v4.5 · CONNECTED — 2026-09-15

- **Netcode:** snapshot delta compression + bandwidth accounting, deterministic
  prediction/reconciliation and interpolation; protocol v2 with a full-snapshot
  fallback.
- **Replay:** kill feed, objective timeline, summary and seekable/speed playback.
- **Presentation:** cinematic/over-shoulder/free-look/tactical cameras, richer
  radar and grouped scoreboard, team outlines and announcer callouts.
- **World:** Titan/Scout/Transport vehicles, levelgen compounds/terraces/towers,
  biome props and structural map-schema validation.
- **Server:** matchmaking queue with balanced teams, room lifecycle
  (warmup/ready/map-vote/rematch), leaderboards and anti-cheat bounds.

## v4.4 · BROADER — 2026-09-14

- **New objective modes** Holdout (quorum hold) and Uplink (sequential relay);
  **Endless Horde** with score banking and escalating bosses; economy pickups
  (weapon upgrade, deployable sentry).
- **Presentation:** in-menu 3D weapon inspect, hit reactions, storm
  lightning/thunder, wet sheen, wind gusts, per-mode music and victory/defeat
  stings.
- **Accessibility:** deuteranopia/protanopia/tritanopia palettes, high-contrast
  UI, full keyboard remapping; replay export/import, match summary card, room
  filters and practice-vs-bots.

## v4.3 · DEEPER — 2026-09-14

- **Mutators** (low gravity, turbo, instagib, one-shot, mirror loadout, big head,
  no recoil) compose on any mode, plus per-mode loadouts and sniper/pistol
  presets with new ammo/megahealth supplies.
- **Two new maps** (Dune Ravine, Ember Caldera) with biome props and
  deterministic destructible crates/barrels.
- **Prestige ranks** after max level and twelve achievements with unlock toasts
  and a Career track panel.

## v4.2 — 2026-09-14

- **Five campaign missions** with stealth, duel and boss-phase content; horde
  gains lancer, sentinel and Harbinger enemies plus new wave modifiers.
- **Weather and time of day** add deterministic rain, snow, ash and storm
  ambience with pooled visuals and dynamic audio intensity.
- **Meta loop:** local match history, per-mode leaderboards, weekly challenges,
  campaign stars/medals, mission bests, expanded results medals and an Arsenal
  inspector.
- **Quality tiers** are now persisted and selectable: Auto, Low, Medium, High.

## v4.1 — 2026-09-14

- **New modes/objectives:** Juggernaut, Team Elimination and VIP Escort;
  multi-phase Warden bosses; sudden-death timers so every mode terminates.
- **Single-player:** horde between-wave upgrades and wave modifiers, new enemy
  roles (mender/sapper/overseer, shield tank, mortar artillery), campaign
  checkpoint resume, and a third mission.
- **Presentation/perf:** death variety, ambient FX, audio variants, richer
  weapon/operator/vehicle detail, impact decals, and a quality/LOD controller
  with a CPU triangle budget.
- **Interface:** daily challenges, per-mode career stats, full loadout presets,
  theater library + in-dock highlights, help legend, and a team-grouped
  spectator board.
- **Maps:** two new next-gen arenas (The Throne, The Gauntlet).

## v4.0 — 2026-09-14

- **Single-player:** enemies spawn in authored areas and stay within a per-type
  leash, groups fan out instead of stacking, horde waves use a per-difficulty
  composition table, and both campaign missions now run scripted timelines
  (timed reinforcements, ambushes, boss phases with adds, NPC barks) with real
  win conditions.
- **Modes:** vehicles only spawn in vehicle modes (Combined Arms is no longer a
  Domination clone); CTF carriers are slowed and cannot use powers; KOTH's hill
  rotates and zone ownership grants buffs; Arms Race demotes on death with a
  catch-up bonus.
- **Graphics:** a high-poly truncated-icosahedron soccer ball that rolls; the
  CPU software renderer now honours per-vertex colours.
- **Fixes:** spectate mouse look is no longer inverted; bot rig pitch/lean/ADS
  and mounted-rider facing are corrected; actor weapons aim correctly.
- **Rewards:** the results screen shows XP/level/next-unlock, unlocks queue as
  toasts, the menu shows your next unlock, Next Arena keeps your loadout
  (Surprise Me randomises), and theater demos list jump-to highlights.

## v3.10 — 2026-09-14

- **Floating dual sticks** (move left, look right) with a fixed base radius,
  fixing the bug where any touch on the left flung the stick full forward.
- Fire and jump are the large thumb buttons with the other actions as small
  buttons around them; the sticks and buttons no longer overlap, and both sticks
  work together under multi-touch.
- Added a **fullscreen** button and a **simplified racing layout** (brake/reset
  plus boost/item, no look stick or combat cluster).

## v3.9 — 2026-09-14

- **Glow is off by default** and **resolution scaling defaults to 50%** for
  lighter rendering; both remain adjustable in Graphics & settings.
- **Quick start activities** replace the redundant arena map grid on the
  selection screen: ten one-click activities (Quick Match, Team Deathmatch,
  Capture the Flag, King of the Hill, Rocket Arena, Instagib, Arms Race, Horde,
  Campaign, Spectate) launch instantly with your current operator, harness and
  rules. Arena selection now lives in MATCH SETUP and SINGLE PLAYER.

## v3.8 — 2026-09-14

- Parts that interpenetrated (shrouds swallowing receivers, coils sunk into
  barrels, magazines buried in magwells) now meet flush so the models read as
  solid objects. An interpenetration audit went from ~430 visible overlaps to
  zero, leaving only intentional hidden internals (bore liners, cores, drum
  shells). Silhouettes, detail and pinned part names are unchanged.

## v3.7 — 2026-09-14

- **ONLINE no longer throws.** A temporal-dead-zone `ReferenceError` in
  `createVoice` (the `VoiceChat` constructor publishes synchronously before its
  callback's `const voice` binding is initialized) is fixed by attaching
  `onState` after construction.
- **Ten new weapons.** The low-poly arsenal is replaced by detailed higher-poly
  models under `game/weapon-models/` (roughly 3.0–4.8k triangles each, distinct
  silhouettes, cached resources). The original geometry is archived as
  `legacyWeaponModel` in `game/weapon-models/legacy.mjs`.

## v3.6 — 2026-09-14

- **Menus paint above the canvas again.** `.shell` is positioned (`z-index:1`);
  previously the absolutely-positioned canvas painted over the whole menu body,
  hiding the operator/harness selection and stealing its clicks and scroll.
- **Progression** shows the operator preview beneath the rank/stats card and
  gives the unlock list a wider, readable column.
- **4K tier** scales the shell width, type and controls on large displays.

## v3.5 — 2026-09-14

- **Glow controls.** Post-processing has its own toggle plus glow-strength and
  brightness sliders, independent of resolution scale (`postFx`/`bloom`/
  `exposure` in the display config).
- **Scrolling fixed.** The app shell now has a real scroll region, so the
  harness column and the unlock track are reachable again.

## v3.4 — 2026-09-14

- **Objective out of the centre.** A bottom-centre objective bar with a compass
  arrow pointing at the current objective replaces the top-centre command panel.
- **Corner readouts.** Health and armor share one style bottom-left, ammo
  bottom-right, all the same size with fill bars.
- **Radial gauges.** The ability and frag cards sit next to ammo with conic
  cooldown rings and pop when ready.
- **Operator preview.** The selection shell is now translucent so the live 3D
  operator model renders through it.

## v3.3 — 2026-09-14

- **Animated boot logo.** Oversized letters slide in one at a time, each with a
  cyan period and its word beneath, plus a sheen sweep.
- **Living skies.** The gradient sky dome used to be far-plane clipped on large
  maps (the "moving circle"); it now follows the camera, and dark arenas get a
  deterministic starfield (520 stars) and moon, dusk maps a warm horizon, with a
  halo ring on `aether` and `skybreak`. The CPU renderer paints a matching
  gradient/starfield/disk.
- **Objective occlusion.** Objective zone floor markers are depth-tested again
  so bot models occlude them; only a thin raised beacon stays always-visible.

## v3.2.2 — 2026-09-14

- **Bug:** `PlayingHud` reads `voiceState` from the page's `ui` bag, but the bag
  never provided it. Because the bag is loosely typed, `tsc` passed while
  `voiceState.enabled` threw during render, so every mode using the default HUD
  (deathmatch, CTF, KOTH, payload, assault, horde, campaign) hit the error
  boundary — only racing worked.
- **Fix:** provide `voiceState` (and `showcaseLive`) in the `ui` bag.
- **Guard:** a new `tests/ui-contract.test.mjs` statically reads `app/page.tsx`
  and every `app/ui/screens/*.tsx` and fails if any screen references a `ui`
  field the page does not provide, so this class of bug cannot ship silently.

## v3.2.1 — 2026-09-14

- The keep-mounted match-setup modal was visible on launch and could not be
  dismissed: `.modal--hidden{display:none}` was declared before
  `.modal{display:grid}`, so at equal specificity the later grid rule won. The
  selector is now `.modal.modal--hidden`; the game starts on the title screen
  with no dialog over it, while the setup strings remain in the server-rendered
  HTML.

## v3.2 — 2026-09-14

- **In-match HUD extracted and unified.** The default (non-race/soccer) HUD now
  lives in `app/ui/screens/PlayingHud.tsx`. Every legacy class and DOM anchor is
  preserved so the existing stylesheet still applies, and the three centre
  announcement layers (kill banner, kill callout, objective/sudden-death/score
  announcer) are arbitrated into a single slot by priority: sudden-death >
  match-start > score > kill callout > kill banner.
- **Settings dialog rebuilt** (`app/ui/screens/SettingsDialog.tsx`) on the
  `Modal` primitive with Game, Arsenal and About tabs; the duplicated keybind
  table and the Radix `Dialog` wrapper were dropped.
- **Layering retained:** combat feedback sits above panels, and touch mode lifts
  the bottom readouts above the thumb lane.

## v3.1 — 2026-09-14

- **Modals on the new primitives.** Match setup (two-column arena + rules,
  sticky footer), single-player (segmented Horde/Campaign with a briefing pane),
  pause, results (tabbed scoreboard/stats/awards with a sticky action footer) and
  onboarding all use the `app/ui` `Modal`/`Panel`/`Btn`/`Tabs`/`Stats`
  primitives.
- **Theater.** Recorded matches become a responsive card grid; playback uses a
  safe-area dock with one transport row and a camera-rig rail.
- **HUD readability.** Combat feedback (crosshair, hitmarker, damage
  numbers/direction, reload, posture) now layers above HUD panels, and on touch
  screens the bottom readouts lift above the thumb lane.

## v3.0 — 2026-09-14

- **New primitives and shell.** `app/ui/primitives.tsx` plus the namespaced
  `ui-*` design system in `app/styles/ui.css` give every screen one `Shell`
  (sticky header / scrolling body / sticky action rail), one `Panel`, one `Btn`,
  one `Modal` and shared `Stats`/`Tabs`/`Segmented`/`Chip`/`Meter` primitives.
- **Balanced menu layouts.** The selection screen's elastic column is now the
  interactive loadout (not a decorative preview) and its primary action lives in
  a sticky rail that never falls below the fold; the progression screen no
  longer reserves an empty column and moves gear into tabs; browse/lobby get one
  primary action each and a 3-column lobby reading a reactive net snapshot.
- **Legacy set aside.** The previous inline menu markup is replaced, not
  duplicated; `app/legacy/README.md` records the boundary. Match-setup,
  single-player, pause, results, settings, the theater and the in-match HUD
  remain for the next redesign phase, and their test-pinned exports are
  unchanged.

## v2.81 — 2026-09-14

- **Design tokens and a shared HUD language.** `app/globals.css` defines a
  semantic token layer (surfaces, text tiers, accent/warn/danger/info, borders,
  radii, elevation, fonts and a `--z-*` scale) and completes the Tailwind
  `@theme` mapping so the Radix/shadcn select, radio and slider primitives
  resolve to the mint palette instead of undefined colours. Every in-match mode
  is built from the same `.hud-strip`/`.hud-cell`, `.hud-panel`, `.hud-bar`,
  `.hud-count` and `.hud-note` primitives, scoped by a per-mode `--accent`
  (race/soccer amber, single-player mint).
- **Mobile and safe areas.** The touch layer no longer intercepts taps meant for
  the voice dock, chat or spectator controls; safe-area insets now cover the
  command panel, radar, HUD chips, kill feed and every race/single-player panel;
  the race/soccer help line flows under the wrapped metric strip and the
  single-player panels stack at the top so thumbs have the bottom edge.
- **Accessibility and correctness.** The single-player and onboarding dialogs
  now join the focus trap and close on Escape, the spectator board uses valid
  button roles, the title start control is a real button, back affordances point
  left, and the per-frame `data-snapshot` blob was removed from the canvas.

## v2.80 — 2026-09-14

- **Varied, softer enemies.** Every enemy deploy rolls a per-actor speed spread
  (`ENEMY_SPEED_VARIANCE`, ±22% around the class base) so a wave mixes rushers
  and stragglers. Enemy firepower was damped across the board: Husk damage
  ×0.32 / melee 8, Spitter ×0.40, Brute ×0.75, WARDEN ×1.0. The profile flows
  through `gearDamage` in `Match.spawn`, and the melee path uses
  `actor.meleeDamage`.
- **Edge-anchored HUD.** `SinglePlayerHud` no longer borrows the race HUD. It
  has its own `.sp-hud` layout: the objective chain on the left edge, a compact
  status strip (objective/wave, hostiles, lives, kills, waypoint distance) along
  the top, boss and hold bars beneath it, and story lines low-centre above the
  bottom HUD. Responsive rules move the objective panel to the left-bottom on
  narrow screens and hide the step list.

## v2.79 — 2026-09-14

- **Distinct enemies.** `game/enemy-types.mjs` defines frozen enemy classes
  (husk 30 HP melee swarmer, spitter 45 HP ranged, brute 140 HP heavy, warden
  450 HP boss) that are far weaker than normal bots and carry their own behaviour
  profile. `Match.spawn` honours `actor.npcProfile`, melee honours
  `actor.meleeDamage`, and `botInput` swaps `botBehavior` for `enemyBehavior`
  per `actor.npcType`. All hooks are inert for multiplayer actors.
- **Linear story runtime.** `game/singleplayer.mjs` gained a step machine:
  ordered objectives with an in-world waypoint, `onStart`/`onComplete` actions
  (story lines, objective text, typed enemy groups, win/lose, checkpoints) and
  completion rules `enter-zone`, `group-dead`, `boss-dead`, `timer`, `hold`.
- **Big-map missions.** `game/campaign-data.mjs` was rewritten with two full
  levels: *The Long Haul* on `convoy-line` (152 m west-depot to east-yard escort
  with a bridge hold and a Yardmaster) and *Reactor Run* on `titan-valley`
  (outpost to reactor to cavern hold to south outpost to Warden).
- **Local progression.** `game/campaign-progress.mjs` stores unlocks, best
  time/score and a checkpoint under `token-arena-campaign`; the picker locks
  missions until the previous one is cleared and the results screen offers
  **NEXT MISSION**.

## v2.78 — 2026-09-14

- Two new modes, `horde` and `campaign`, join the registry with `team:true` so a
  lone human (team 0) is hostile to NPCs (team 1) with friendly fire off.
- `game/singleplayer.mjs` drives both: Horde schedules escalating waves
  (`hordeWaveSize`), pins dead NPCs out of the respawn queue and releases them
  between waves; Campaign runs a data-driven timeline (`at`/`after`/`when`
  triggers) of announcements, objective changes, deployments, bosses and
  explicit win/lose.
- `game/campaign-data.mjs` defines six missions on existing arenas with briefs,
  garrisons, bosses and scripted events. Zones snap to the navigation graph at
  init so objectives are always reachable.
- UI: a **SINGLE PLAYER** entry with a Horde/Campaign setup modal, a
  `SinglePlayerHud` panel (wave/mission, hostiles, lives, kills, objective,
  scripted messages, Warden bar, defend timer) and single-player result copy.

## v2.77 — 2026-09-14

- **SPECTATE BOTS** on the title screen starts a local all-bot match from the
  current Match Setup config and drives the camera entirely with the cinematic
  director (`game/spectate-build.mjs` forces every actor to AI and warms the
  match).
- `game/camera-modes.mjs` adds `CAMERA_MODES` (auto, every director rig, free),
  labels, `cycleCameraMode` and `cameraModeRig`. `CinematicDirector` gained an
  `autoCut` option so a spectator can lock a single rig instead of re-picking on
  every cut.
- `ArenaView` gained a **free-fly camera**: `setFreeCam`/`freeLook`/
  `updateFreeCam`, a `setDirectorLock`, and a render branch that takes priority
  over the director and race chase override.
- Controls: `B` cycles camera mode, `[`/`]` cycle the followed bot, `F` toggles
  free cam; WASD/Space/Ctrl/Shift fly and the mouse looks.

## v2.76 — 2026-09-14

- **Soccer ball no longer pins.** Car contact clears the chassis by a hair so the
  next tick is not a zero-length re-collision; a glancing hit adds a slice of
  the chassis's tangential speed (`BALL_SPIN`); and an anti-stuck shove fires
  when the ball is slow while touching a car or board for a second, kicking it
  away from the nearest chassis or toward the centre, and after repeated
  failures resetting to the centre. `resetBall` clears the anti-stuck state.

## v2.75 — 2026-09-14

- The reel was built for eight modes, but the `ready` settings effect re-ran
  `buildShowcase` once the renderer finished initialising (immediately replacing
  the opening Puma race with soccer) and scenarios could run for up to two
  minutes. The settings effect now keys on `legacyArenas|reducedMotion|showcase`
  and never rebuilds a live showcase; scenario limits were shortened (race is a
  one-lap sprint, combat caps at 60 s) and the page force-advances after
  `SHOWCASE_MAX_SECONDS` (75 s) so no mode can hog the menu.

## v2.74 — 2026-09-14

- **2 v 2.** Soccer is now four Pumas total (two per side). `puma-soccer` caps at
  `maxBots:3` and the core constructor sizes the roster to `4 - humanCount`, so
  a solo player fields three bot drivers, two humans field two bots, and four
  humans field none. The pitch authors two kickoff slots per team.
- **Boards.** `puma-pitch` rings the pitch with `soccer-wall` collision boards
  (both touchlines and both goal lines, leaving a goal mouth at each end) plus
  hidden `soccer-goal` collision; the ball hard-clamps to the pitch bounds except
  inside the goal mouth, so it cannot roll onto the circuit.
- **Bot behaviour.** Bots pick one attacker and one support per team (nearest to
  the ball attacks, the partner covers), steer around team-mates and the ball
  pile-up, hold a stable lane offset to avoid head-on collisions, and reverse
  out after ~1 s wedged. This removes the old ball-jam.

## v2.73 — 2026-09-14

- The title-screen showcase becomes a reel of eight distinct modes: Puma Race,
  Puma Soccer, Deathmatch, Team Deathmatch, Capture the Flag, King of the Hill,
  Combined Arms and Payload. `SHOWCASES` carries a mode-appropriate map pool per
  scenario; `pickShowcase` picks an available map that supports the mode, and the
  rotation rebuilds the next scenario when the current match ends. Vehicle
  scenarios keep the cycling car demo camera; combat scenarios use the cinematic
  director.

## v2.72 — 2026-09-13

- **Puma Soccer** arrives as a new `puma-soccer` team mode on the `puma-pitch`
  map (the Puma Circuit with its infield opened into a pitch).
- `game/soccer.mjs` implements deterministic 60 Hz car soccer: 4v4 kickoff
  seating, race-style throttle/steer/boost/brake controls, a ground-locked ball
  with friction and car-contact impulses, swept goal-line detection, goal/time
  endings and per-driver goal stats. State lives on `match.race` with
  `kind:'soccer'`, so combat is off and the server stays authoritative with no
  protocol change.
- `game/soccer-maps.mjs` derives `PUMA_PITCH` from `PUMA_CIRCUIT`, adding goal
  frames and kickoff slots. Presentation adds pitch/ball/goal rendering,
  `soccerDisplay`/`soccerResult` HUD helpers, a `SoccerHud`, setup controls and a
  soccer touch cluster.

## v2.71 — 2026-09-13

- `game/core.mjs` no longer owns bot AI or objective updates: `game/bots.mjs`
  (`botInput`, `defensivePost`, `flankDestination`, `patrolPoint`, `separation`,
  `spreadBias`, `zoneSlot`, `zoneDefense`, `path`) and `game/objectives.mjs`
  (`updateAssault`/`updatePayload`/`updateObjectives`) hold them, with `Match`
  methods now thin delegations.
- `game/view.mjs` no longer owns race presentation: `game/race-presentation.mjs`
  holds `raceTrackModel` and the per-frame race sync; `view.mjs` dropped from 773
  to 656 lines.
- `vite.config.ts` adds Rolldown `codeSplitting` groups for the client
  (`three.core`, `three`, director/demo/progression/showcase). The largest chunk
  fell from 839 kB to 365 kB and the >500 kB build warning is gone.

## v2.70 — 2026-09-13

- Tests no longer parse `app/page.tsx`: `buildShowcase` moved to
  `game/showcase-build.mjs`, `renderScoreboard` to `game/scoreboard.mjs`, and
  the game-chat and race-HUD JSX to `app/game-ui/game-chat.tsx` and
  `app/game-ui/race-hud.tsx`.
- Added `game/map-schema.mjs` and moved the duplicated `freeze`/`wall`/`cover`/
  `pad`/`tp`/`zone`/team/flag builders onto it; teleporters normalize to a
  canonical `target` field.
- History and progression persistence is now async and coalesced: `record`/
  `award`/`setGear` update memory and schedule a single in-flight atomic write,
  with `flush()`/`whenPersisted()` for quiescence and graceful shutdown.
  Match-end writes no longer block the simulation tick.

## v2.69 — 2026-09-13

- **Security and lifecycle:** progression is bound to a server-issued secret
  token instead of a client-chosen `playerId`, and connected profiles are pinned
  against LRU eviction. Essential server messages coalesce by type instead of
  FIFO-evicting `welcome`/`start`/`results`; control frames are rate-limited,
  clients are capped, and dropped event batches rewind `lastSerial`. Deploy backs
  up `dist/`, health-gates both systemd units, verifies assets and rolls back on
  failure; nginx/Next add CSP and security headers; route-level and global error
  boundaries are added.
- **Correctness and performance:** fixed the Arms Race finisher award, bot melee,
  on-foot interact movement, self-kill stats, void kill-feed timestamps,
  weapon-finish rendering, online finish/gear plumbing, local race coins,
  next-arena mode safety, renderer-init recovery, connect-before-open hangs and
  malformed-snapshot crashes. Payload credit uses the cart stand check; leaders
  rank objective modes correctly and share one implementation; navigation is
  faster; supply placement no longer stacks; demos are event-capped and
  compressed; radar labels/progress and underbarrel meshes render.
- **Architecture and cleanup:** extracted shared `game/math.mjs`,
  `game/protocol.mjs`, canonical team palettes and a single ranking API; cached
  core traversal tables; removed 57 unreachable shadcn components, dead
  scaffolding, unused dependencies, dead map/generator fields and the unused
  lag-compensation path. Lint is now a real gate and CI runs typecheck, tests,
  build and lint.

## v2.65 — 2026-09-13

- **Local objective rendering fixed:** the view reads `objectives ??
  objectiveState`, so KOTH/domination/assault markers and the payload render in
  offline play, not only over the network. The payload is rebuilt as a ~2.5 m
  floating pig with bob, wing flap and beacon (reduced-motion gated), a ground
  ring and a distinct radar contact. Active assault sectors are highlighted and
  labelled; zones carry A/B/C.
- **Payload pacing slowed** from `total/30` (rounds ended in 14–68 s) to a bounded
  `total/150` clamped `[1.5,4.0]` (~67–123 s full routes), and push time now
  accumulates `objectiveTime` so CART TIME is live.
- **Assault** builds exactly `config.fragLimit` (1–9) sectors and credits
  capture/objective-time stats.
- **Arms Race** ranks by ladder (not frags) in `leaders()`, sudden-death/
  tie-break, `actorWon` and history `leaderRank`. CTF flags dropped over the void
  fall back to the carrier's last solid position or base instead of soft-locking.
- **Objective clarity:** `commandBrief` keys on objective kind and adds Combined
  Arms (zone control) and Arms Race (ladder) branches; instagib/rockets/arsenal
  name their frag target; the match-start banner includes the goal; scoreboards
  gain objective columns and team banners.
- **Bot variety:** deterministic archetypes (rusher, flanker, defender, support,
  sharpshooter) resolved from operator role + harness personality + slot jitter,
  wired into engagement band, strafe patterns, weapon-band preference, replan
  tempo, objective focus and retreat.

## v2.64 — 2026-09-13

- **Item set expanded from four to eight:** Turbo, Shield, Oil Slick, Homing
  Pulse, Mine (stationary harder-slow trap), Triple Pulse (next three ahead),
  Lightning (all ahead), and Star (speed + immunity to every slow). Position
  weighting was retuned so the leader draws mostly defensive items and the
  trailer draws catch-up items (catch-up mass ~0.26 leader vs ~0.78 trailer).
- **Coins:** each gives +1.2% top speed up to +12% at ten, and a slow hit drops
  two. **Boost pads** grant a free short turbo on contact with a per-racer
  cooldown. Item boxes increased from six to ten.
- Track authors 10 boost pads, 24 coins and 10 item boxes, all clear for a
  2.1-radius car and inside the racing line; snapshots expose `race.coins`,
  per-racer `coins` and `effects.star`, and hazards carry `type` (oil or mine).
  Rendering adds chevron boost pads, spinning gold coins and a distinct spiked
  mine; the HUD gains a COINS readout and friendly labels.

## v2.63 — 2026-09-13

- **Race balance.** A clamped rubber-band pace (0.93 leader .. 1.10 trailer)
  applies to bots and humans, and each racer has a seeded skill factor
  (0.95–1.05) and racing-line offset so bots do not drive one identical line.
  Six fixed seeds produced multiple winners; the pole racer won 0/6 in the
  fixture versus a deterministic runaway before.
- **Cars are solid.** A guarded pairwise contact resolver pushes overlapping
  Pumas apart to a 3.4-unit separation along the contact normal and equalizes
  normal velocity without pushing either into geometry; eight grid slots start
  6.0 units apart.
- **Position-weighted item rolls:** the leader draws mostly shield/oil and the
  trailer mostly turbo/pulse (8 k seeded draws: trailer catch-up 74.5% vs leader
  24.8%), replacing the uniform roll.
- **Flat-wall artifacts fixed.** The track no longer renders ~470 overlapping
  2x2x2.6 collision boxes; rails are hidden collision boxes and the walls/stripes
  are merged barrier geometry from `race.boundary`.
- **Demo camera** alternates every 7 s through chase, orbit, flyover and
  trackside, rotating the featured car, with damped transitions and a
  reduced-motion chase fallback.

## v2.62 — 2026-09-13

- **Puma Circuit menu.** The main-menu showcase runs only Puma Circuit: eight AI
  drivers, two laps, four seconds of fixed-tick warmup and automatic restart
  after the finish. Cinematic title rendering uses the vehicle chase camera;
  menu diagnostics are exposed under `window.tokenArenaSnapshot().showcase`.
- **Online race chat trap fixed.** `T`/`Enter` previously opened chat state while
  the race HUD omitted its input; race and combat now share one visible chat
  panel.
- **Live CSS failure.** The running web process referenced a deleted stylesheet
  (HTTP 502; the cause was rebuilding `dist` without reloading the running asset
  manifest, not invalid CSS). `npm run deploy` now pairs build/restart with
  public linked-asset checks, optionally restarting the game server.
- This release includes the preceding map, gameplay/control and racing changes
  that had been documented as unreleased.

## v2.61 — 2026-09-12

- **Bug-fix pass over the new systems.** Arms Race keeps ladder progress across
  respawns and ignores weapon pickups; bounty frags (and any non-frag score) can
  no longer end an Arms Race; random loadout works with unlimited ammo;
  simultaneous objective score ties are no longer awarded to team 0; assault
  breaches no longer inflate the scoreboard; death and falling clear
  traversal/streak state; keybind normalization can no longer create duplicate
  keys (reserved shell keys are rejected, voice is remappable, and the in-game
  legend follows your binds); plus a grenade press-latch, fall streak reset and
  spectator/radar fixes.

## v2.60 — 2026-09-12

- **Remappable controls.** Every action (movement, jump, sprint, crouch, reload,
  melee, frag, ability, interact, voice) can be rebound in Settings with
  duplicate detection and a one-tap reset. Bindings persist on the device.

## v2.59 — 2026-09-12

- **Spectating improvements.** A target board lists every live actor for one-tap
  following, **P** switches between first- and third-person, and **H** hides the
  HUD for a clean view.

## v2.58 — 2026-09-12

- **Loadout presets.** Save your operator, harness, arena and match rules by
  name, then recall or delete them with one tap. Presets persist on the device
  and validate against the current roster.

## v2.57 — 2026-09-12

- **Cloak powerup.** For a few seconds bots cannot acquire you at range and you
  drop off enemy radar except up close (Recon still reveals you).

## v2.56 — 2026-09-12

- **Two more mutators.** Bounty (ending an enemy on a three-plus streak heals you
  and grants a bonus frag) and Berserk (+20% damage while you are on a three-plus
  streak).

## v2.55 — 2026-09-12

- **HUD readouts.** An Arms Race ladder chip (current rung of the weapon rack) and
  a killstreak chip from two kills up.

## v2.54 — 2026-09-12

- **First-run coach.** A short, dismissible walkthrough of movement, combat,
  objectives and settings, shown once and remembered on the device.

## v2.53 — 2026-09-12

- **Arms Race** — a gun-game mode where every kill promotes you to the next weapon
  in the rack and finishing the last gun wins. It ships with a new compact map,
  **Proving Grounds**, and locks the weapon so the ladder is the only way forward
  (bots included).

## v2.52 — 2026-09-12

- **Recon Pulse radar powerup.** While active it reveals every enemy on your team
  radar regardless of distance, shown as a rim-clamped blip.

## v2.51 — 2026-09-12

- **Killstreaks.** Three kills restores health and ammo (Scavenger), five grants
  Overcharge, and seven grants an Overshield, announced in the HUD. Dying or
  respawning resets the streak.
- **Mutators.** Optional match rules for a **random starting weapon** each spawn
  and **one-shot kills** (any unprotected hit eliminates).
- **Audio captions.** A caption strip narrates gunfire, explosions, reloads,
  pickups, objective events and eliminations.
- **HUD clarity.** Toggle the kill feed, damage numbers and radar independently.

## v2.50 — 2026-09-12

- **Frag HUD chip.** A HUD chip on **G** reads FRAG READY or counts down the
  cooldown.

## v2.49 — 2026-09-12

- **Thrown frag grenade.** Every operator carries a cooldown-gated frag on **G**
  (and a touch button). It arcs, bounces and detonates on a fuse; bots throw it
  too, and it cannot be used while driving.
- **Sudden death.** An opt-in match modifier: if the clock runs out level, play
  continues until the next score decides it (bounded window). Assault and Payload
  still resolve to the defenders on the clock.
- **Blast fairness.** Point-blank explosions ignore thin cover so a frag at your
  feet hurts, while longer-range splash still requires line of sight.
- **Look controls.** Invert vertical look, a separate ADS sensitivity, and a
  touch sensitivity slider join the display settings.

## v2.48 — 2026-09-12

- **Payload routes are honest.** A route waypoint can no longer collapse onto the
  start (which awarded a checkpoint and score with zero push), and every path
  point sits on the terrain so the cart is not buried underground.
- **Mode resolution is correct.** An assault objective win on the final tick is
  no longer overwritten by the clock; a same-frame KOTH/Domination score-limit
  tie now awards the higher score; capture zones are placed on unobstructed,
  navigable ground with a finer search.
- **Vehicle crews behave.** An orphaned bot gunner dismounts instead of freezing;
  mounted bots no longer fire personal weapons; a mounted actor cannot carry the
  flag; exiting a flying vehicle keeps the actor aloft; empty vehicles keep their
  crew team for friendly-fire protection.
- **Rendering lifecycle.** CTF flag geometry is no longer reused after disposal
  across map changes; flags follow the colourblind palette; the low-health
  overlay is disposed exactly once; the cinematic director honours Reduce Motion.
- **Networking.** A reconnect racing the old socket now reattaches the seat
  (newest connection wins); the client tolerates malformed protocol frames; the
  reload edge is cleared on every lifecycle transition; match history records the
  map actually played; backpressure queues are room-tagged; per-room expiry is
  isolated.
- **HUD/animation.** Spectator cycling no longer skips the first live actor; turn
  banking twists the chest.

## v2.47 — 2026-09-12

- **No more stranded hills.** Next-gen bridges and catwalks are solid,
  unclimbable columns (there is no step-up), so capture points authored on them
  could never be taken. Capture zones are now nudged onto clear ground and
  snapped to the nearest navigation node when a match starts.
- King of the Hill now scores on Frost Gate, The Forge, Slagworks, Convoy Line
  and The Catacombs; Domination centre points on those maps are contestable
  instead of unreachable.

## v2.46 — 2026-09-12

- **Titan Valley is traversable again.** Its central tunnel ran the full width of
  the map and, with the flanking base bunkers, walled the northern half off: four
  of ten team spawns, two of three capture points and three of six vehicles sat
  outside the navigation graph, so Combined Arms produced zero shots. The tunnel
  is now a shorter central passage that reconnects the map.
- **Bots dismount stuck vehicles.** A bot driver that cannot make progress for
  three seconds exits and continues on foot (with a five-second re-board
  cooldown).
- **Teams defend their objectives.** In King of the Hill, Domination and Combined
  Arms the closest teammate holds any owned-but-empty capture point.

## v2.45 — 2026-09-12

- **No more buried hills.** Procedural levels now nudge a capture zone that
  generated inside a rock or building to the nearest clear ground before cover
  and supplies are placed. This fixes the colosseum, riverbend and titan-valley
  objectives; deliberate raised bridge/catwalk centres are left untouched.

## v2.44 — 2026-09-12

- **Unlimited ammo is a real choice in every mode.** The modifier is no longer
  force-disabled outside Deathmatch; the toggle now reflects and controls the
  actual setting.
- **Typecheck clean.** Fixed a missing bot field in the showcase spawn path that
  the 2.40 hardening introduced.

## v2.43 — 2026-09-12

- **Never spawn inside geometry.** If the chosen spawn point is obstructed (a
  blocked authored marker, a bad map sample), the match nudges the actor to the
  nearest clear navigation point, so no mode can strand a player or bot inside a
  wall.

## v2.42 — 2026-09-12

- **Ride like a crew, not cargo.** Bots now board only when a driver or gunner
  seat is free. Combined with the earlier passenger bail-out this removes the
  enter/eject loop and keeps gun crews fighting (Blood Gulch CTF shots up ~80%
  across the same window).

## v2.41 — 2026-09-12

- **No more stalled captures.** When an objective marker sits inside a wall,
  under a bridge deck or off the nav grid, bots now retarget a nearby standable
  spot (checking the zone centre, then nearby nav nodes, then a widening ring)
  instead of pressing into the blocked centre.

## v2.40 — 2026-09-12

- **Correct endings.** Assault now ends the moment attackers capture the
  configured sector count (it previously kept running and handed the clock win to
  the defenders), and payload ends on a score-limit checkpoint win too. A
  zero-frag free-for-all is a draw instead of awarding everyone the win bonus,
  and payload routes can no longer go non-finite or deliver instantly.
- **Bots play the objective.** Mounted bots no longer retarget the vehicle they
  are riding (which parked them permanently on vehicle maps), bot gunners now
  fire the mounted gun, unreachable routes no longer shadow the destination, the
  ledge guard is armed from spawn, passenger bots bail out, Roo no longer jams
  teammates, personality strafe actually varies, and suppression now widens aim
  error and pushes bots toward cover.

## v2.39 — 2026-09-12

- **No more clipping at spawn.** The two Pumas that sat inside the small valley
  buildings, the two parked in the cavern wall rings, and the Hornet stuck in
  cover now spawn at clear coordinates verified against collision (with margin).

## v2.38 — 2026-09-12

- **Much faster, never overheats.** The Puma chaingun fire interval drops from
  0.12 s to 0.045 s (~2.7x) and heat/overheat are removed, so it lays down
  unlimited sustained fire. Dual barrels are unchanged, so expect roughly double
  the old damage output.
- **Heavier voice.** `vehicle-shot` no longer borrows the pulse-rifle sound; a
  dedicated layered chaingun report (low thump, metallic crack, spinning-barrel
  pitch wobble) plays with its own longer falloff.

## v2.37 — 2026-09-12

- **Movement and spawns.** Team-only maps (Riverbend, Convoy Line, Titan Valley
  and friends) no longer collapse teamless modes onto a single origin: FFA spawns
  are derived from the navigation graph, so Deathmatch/Instagib/Rockets/Arsenal
  start with ten valid spawns. Airborne actors no longer snap down onto solid
  cover, and an idle touch joystick no longer suppresses WASD.
- **Vehicles.** Gunners keep independent aim, rockets strike vehicle bodies
  (respecting own/friendly-vehicle rules), the mounted gun no longer advances
  heat/cooldown twice with a gunner aboard, and destroyed or respawning wrecks
  reject entry.
- **Networking.** Reconnects dispose the previous socket and ignore stale
  callbacks, and the prediction shadow rebases its clock to the server.
- **Server resilience.** Persistence failures retry with backoff instead of
  aborting the round, malformed-message replies are bounded and repeat offenders
  dropped, and essential lobby/start/results messages survive backpressure.
- **Results and history.** Assault, Payload and Combined Arms award and record by
  the authoritative winner, and a timed team match records `time` instead of a
  score-limit ending.
- **Rendering.** Cavern openings line up with collision, post-processing disposes
  its passes and applies device pixel ratio once, and the in-app Reduce Motion
  toggle drives the renderer and menu showcase.

## v2.36 — 2026-09-11

- **Arches, not buried pipes.** Tunnels were full tubes centred above the
  terrain, so their lower half sank into the ground (z-fighting and shimmer along
  the length) and their tops poked through the dome shells. They now render as
  open stone arches that follow the terrain — the path is resampled against the
  heightfield and a semicircular cross-section is extruded along it — resting on
  the ground and tucking under the dome walls. Tunnel self-shadowing is disabled
  to remove shadow acne on the double-sided surface.

## v2.35 — 2026-09-11

- **It flies inside.** The director now receives the arena's structure volumes
  (buildings, caverns and tunnels) and, when the densest action cluster is inside
  one, shrinks its orbit and drops to eye level inside that room, cavern or
  tunnel instead of circling the roof. When the fight moves back outside, it
  eases back out. An 0.8 s hysteresis hold stops flickering at a doorway.
- **Pure volume math.** `game/interiors.mjs` turns buildings into inset rotated
  boxes, caverns into cylinders and tunnels into capsule segments, and picks the
  containing volume with the least clearance.

## v2.34 — 2026-09-11

- **Orbits the action, not the arena.** The flyover camera now circles the live
  action cluster instead of the arena centre (often a central building or
  rooftop). It sits at a tighter radius (~16–30 m) and higher altitude to look
  over low cover.
- **Densest-cluster aiming.** The action point is the centroid of the largest
  cluster of nearby live actors — falling back to the global centroid when
  everyone is spread out — eased over time, instead of the average of every bot.
  A couple of duels off in one corner now draw the camera.

## v2.33 — 2026-09-11

- **No more zoom pumping.** The flyover orbit radius is now nearly constant (a
  gentle ±12% weave instead of ±26%), the tour field of view is fixed at 72°, and
  the occlusion pull-in is disabled for tours. Non-tour playback keeps a
  smoothed, asymmetric pull-in for real camera-behind-cover moments.

## v2.32 — 2026-09-11

- **The camera flies the arena, not a bot.** The showcase now uses a free-flying
  `flyover` rig that orbits the whole battlefield on a smooth looping path —
  weaving its radius and height — and always aims at the live action centroid
  rather than a specific actor. With no target binding and cuts disabled during a
  tour, the camera stops jumping between bots.
- **Smooth aim.** The action point is a centroid of the live actors with an
  exponential ease, so deaths and respawns slide the view instead of yanking it;
  the occlusion pull-in now rays from that point.
- The flyover rig is reserved for tours, so normal Theater playback keeps its
  existing rigs and cuts.

## v2.31 — 2026-09-11

- **No more pose alternation.** The 2.30 occlusion correction was throttled, so
  on blocked shots the camera jumped between the director pose and the pulled-in
  pose at ~30 Hz. It now evaluates every frame and eases a single stand-off
  distance toward the clear or blocked value (snapping only on a cut), so the
  camera slides in and out of cover instead of flickering.

## v2.30 — 2026-09-11

- **Camera line-of-sight.** The menu director now casts a ray from the followed
  actor back toward the camera and, when scenery blocks the view, pulls the
  camera in front of the obstruction and re-aims it, so orbit, tripod and dolly
  shots stop ending up behind walls, roofs and domes. The clamp math is the pure,
  tested `clearCameraPosition` helper (`game/camera.mjs`).
- **Closer, steadier rigs.** The showcase orbit radius dropped from 16 to 11, and
  rig weighting now favours chase/follow/crane over ground-level tripod/dolly, so
  cuts spend more time on readable subjects.

## v2.29 — 2026-09-11

- **Tunnels meet the domes.** Tunnel tubes were built centre-to-centre, so they
  pierced through the new cavern walls. Each tube endpoint that lands on a cavern
  is now trimmed back to that cavern's radius, so tunnels visibly terminate at
  the wall like real entrances instead of passing through the shell.

## v2.28 — 2026-09-11

- **Domes no longer look connected.** A cavern used to render as a single
  floating hemisphere whose rim hovered partway up the wall, with each tunnel a
  full closed tube — so on **The Catacombs**, where five caverns are joined by
  four tunnels, the shells read as one merged mass. Caverns now render as a stone
  drum split into two wall arcs with two opposite entrances, capped by a dome
  seated on the wall top, and tunnels read as separate covered passages.
- **Visible openings match collision.** The wall arcs are derived from the same
  entrance rule the generator uses for its hidden collision ring
  (`game/structures.mjs`), so the gaps you see are the gaps you can walk through.
- Cavern, tunnel, column and rock surfaces no longer force the shared stone
  material double-sided.

## v2.27 — 2026-09-11

- **The weapon effects were missing.** The menu showcase handed the renderer a
  `Match.snapshot()` — which never carries the simulation's event stream — and
  reset the renderer's event cursor to zero, so muzzle flashes, tracers,
  explosions, rail beams, jump-pad bursts and death animations never played
  behind the menu. The demo now forwards the live event list and the true serial
  cursor, and the camera director sees kills, explosions and captures to cut
  toward.
- **More scenarios.** The reel grew from two demos to six: **Combined Arms**
  (vehicles and aircraft), **Instagib** (rail beams), **Rocket Arena** (splash
  explosions), **Capture the Flag** (flag runs), **Payload** (the escort cart)
  and **Assault** (sector breaches). Rounds are shorter and cuts come every
  2.1 s.

## v2.26 — 2026-09-11

- **Follow cycling.** In a spectated match, `[` and `]` cycle the camera through
  the live players, and the `FOLLOWING <name>` readout tracks the selection. Dead
  players are skipped, and the target resets when a new match starts. The
  selection logic lives in the pure `spectateActor`/`nextSpectateTarget` helpers
  in `game/hud.mjs`.

## v2.25 — 2026-09-11

- **Accessibility toggle.** Graphics & settings gains a **Reduce motion** switch
  that trims camera shake, animated menus, the radar sweep and decorative effects
  even when the operating system does not request reduced motion. It is stored
  with your display preferences (`game/config.mjs`) and folds into the same
  `reducedMotion()` check the renderer already uses.

## v2.24 — 2026-09-11

- **Per-peer input budget.** The server accepts at most 120 game inputs per peer
  per second and drops the excess before any simulation work
  (`server/room.mjs`). Legit clients send at 60 Hz, so the cap is invisible in
  normal play but stops a flooding client from forcing unbounded simulation work.
  The window resets on reconnect.

## v2.23 — 2026-09-11

- **Latency chip.** Network matches display a colour-coded `GOOD` / `FAIR` /
  `POOR` chip with the current interpolation delay, graded from the same jitter
  and packet-loss estimators the netcode already uses (`connectionQuality` in
  `game/hud.mjs`). It turns amber or red before the connection becomes
  unplayable.

## v2.22 — 2026-09-11

- **Point-blank finisher.** Every loadout can swing a short forward arc (`F`, or
  the touch `MELEE` button): 2.4 m range, 45 damage, 0.6 s cooldown, no ammo.
- **Simulated and networked.** The swing is authoritative in `game/core.mjs`,
  gated by line of sight and the attacker's arc, consumes spawn protection, and
  emits a `melee` hit/whiff event. Bots swing at point-blank visible targets, and
  multiplayer forwards it as a consumed one-shot edge (hold does not repeat).

## v2.21 — 2026-09-11

- **Kill feed weapons.** Every kill-feed line names the weapon used (`PULSE`,
  `RAIL`, `SCATTER`, …) between killer and victim; void deaths stay weaponless.
  The label comes from the pure `killFeedWeapon` helper in `game/hud.mjs`.

## v2.20 — 2026-09-11

- **Range badges.** Graphics & settings labels every weapon with its range band
  and effective distance (`SHORT · 6–24m · 40%`, `LONG · 16–70m · 62%`) via the
  pure `weaponRangeInfo`/`weaponRangeLabel` helpers, so the 2.15 falloff is
  visible when picking a loadout. The control reference also gains a mobile row.

## v2.19 — 2026-09-11

- **Right-zone look, no dead zones.** The drag-look surface is constrained to the
  right side of the screen, so the left-hand HUD and thumbstick are no longer
  covered by an invisible touch target.
- **Push-to-talk on mobile.** A `TALK` button joins the action cluster and drives
  the same voice gate as `V`; long-press context menus are suppressed while
  playing. Button behaviour lives in the pure `applyTouchAction` helper.

## v2.18 — 2026-09-11

- **Threat awareness.** A bot that takes damage records the attacker as a
  remembered threat, snaps attention toward the shot and briefly investigates
  the last-known position when the attacker is not visible (`game/core.mjs`).
- **Bounded and safe.** The reaction opens a 1.4 s suppression window and
  requests a prompt but bounded (60 ms) re-plan, so sustained bot-vs-bot fire
  cannot trigger a navigation recompute every frame.

## v2.17 — 2026-09-11

- **Quantized snapshots.** The server rounds every finite number in broadcast
  snapshots and event deltas to the millimetre (`game/quantize.mjs`), applied to
  a deep clone in `server/room.mjs`. Positions and angles to three decimals look
  identical but serialize smaller at 30 Hz; the simulation keeps full precision.

## v2.16 — 2026-09-11

- **Input cannot be poisoned.** A client that jumps its input sequence far ahead
  is snapped back to the next expected value; stale and duplicate sequences are
  ignored (`server/room.mjs`).
- **Movement axes are clamped.** The server coerces `x`/`z` to finite values in
  `[-1,1]` and drops non-finite look values before they reach the simulation.

## v2.15 — 2026-09-11

- **Damage falloff.** Hitscan weapons deal full damage inside an effective range
  and taper beyond it (`falloff:{start,end,min}` in `game/data.mjs`, applied by
  the pure `damageFalloff` helper). Pulse, Scattergun, Shock Beam, Flak Cannon,
  Marksman Rifle and SMG fall off; the Rail Lance and projectile/splash weapons
  are unchanged.
- **Readable in the shot.** Each `shot` event carries its `falloff`. A
  close-range Pulse shot is unchanged; the same shot at 70 u deals ~62%.

## v2.14 — 2026-09-11

- **One-screen mobile controls.** A left thumbstick drives analog movement and
  sprints at the edge; a drag-anywhere look surface aims; an action cluster
  covers fire, ADS, jump, slide, reload, power, use, weapon swap and pause.
  Controls write imperatively so the frame loop never re-renders React.
- **Automatic and optional.** Controls enable on coarse-pointer devices
  (`pointer: coarse` or `maxTouchPoints > 0`) and can be toggled in Graphics &
  settings; the choice is saved locally.
- **Shared input path.** `controlsFromState` accepts an analog `move` axis plus
  explicit `sprint`/`crouch`, so touch, keyboard and netcode prediction share the
  builder. The joystick curve and look mapping live in the tested `game/touch.mjs`.
- **Fills the phone screen.** A mobile viewport export plus `touch-action`,
  `overscroll-behavior` and safe-area CSS stop zoom, scrolling and
  pull-to-refresh during play without disturbing the desktop HUD.

## v2.13 — 2026-09-11

- **Payload mode.** A new team objective mode (`game/payload.mjs`) pushes a cart
  along an authored route. Attackers standing within its radius advance it;
  defenders stall it and roll it back, but never past the last checkpoint.
  Reaching the final point wins immediately; if the clock expires, defenders win.
  Checkpoints bank score as the cart passes them.
- **Any arena, a real route.** `payloadTemplate` builds the route from team
  spawns and safe nav/objective points, so Payload works on the large arena
  rotation without hand-authored tracks. A dedicated generated map, **Convoy
  Line**, ships as the mode's next-gen arena.
- **World and HUD.** The renderer draws a wheel-spinning cart with a
  team-coloured beacon and contested tint; the HUD gets a Payload command brief,
  checkpoint scoreboard columns and a checkpoint target rule.
- **Bots play the objective.** Attackers escort the cart; defenders hold and roll
  it back. The outcome is authoritative in snapshots, history and replays.

## v2.12 — 2026-09-11

- **Eight death styles.** Kills resolve into a `ragdoll` collapse, a `headpop`,
  `gibs`, a `burst` gore cloud, a burning `combust`, an energy `vaporize`, a
  flattened `splatter`, or an `electrocute`; void falls always collapse the body.
- **Chosen from the kill, not at random.** A pure `game/deaths.mjs` recipe picks
  the style from the weapon family, the headshot flag and overkill, seeded by
  actor/death so it is deterministic for the sim, network, replays and tests.
  Massive overkill always gibs; precision headshots favour head pops.
- **Pooled debris.** `DeathPool` flings reusable limb/body chunks with gravity,
  spin and a ground splat decal, capped by a fixed slot budget. Gore particles
  reuse the existing effect pool, and corpses topple away from the killing shot
  and are restored on respawn. Reduced-motion snaps the pose and trims debris.
- **Shared end to end.** Death events carry `style`, `seed` and the impact
  direction, so remote clients, spectators and Theater replays play the same
  death the shooter saw.

## v2.11 — 2026-09-11

- **Every CTF arena now authors flag bases.** Citadel, Trenchline, Signal Ridge
  and Sunken Hill previously advertised CTF while falling back to spawn corners;
  all four now define red/blue team spawns and distinct flag bases, enforced by a
  test.
- **Arena and mode stay compatible on the server.** Hosting or starting a match
  repairs an incompatible arena to the mode with the same `resolveMapForMode`
  rule the client uses.
- **Bounded room count.** The registry caps concurrent rooms (64 by default),
  evicts idle empty rooms under pressure and returns a clear error.
- **Kill feed is announced** as an ARIA live log, and **static-arena shadows**
  refresh on a fixed cadence, roughly halving shadow-map cost.

## v2.10 — 2026-09-11

- **Menus obey Escape** through the room browser, rank screen, theater list and
  lobby; switching to an unsupported mode auto-selects a compatible arena.
- **A real Assault HUD.** Assault gets its sector-count rule, a `SECTORS` goal
  and a live command panel; the round ends in a defender win if time expires
  without a breach.
- **Theater shows the whole fight.** Playback includes entities that appear after
  the first keyframe and removes despawned ones; recordings respect their
  maximum duration. Bots sprint on rotations, ADS at mid range and slide when
  critically hurt.
- **Map/capture and server liveness.** The next-gen CTF map keeps its authored
  flag bases and capture ignores actors far above a zone; the server heartbeats
  sockets, caps buffered outbound traffic and limits spectators per room.

## v2.9 — 2026-09-11

- **Objective modes actually work.** `objectiveTemplate` dispatches on the
  mode's declared objective kind, so **Combined Arms** gets its three Domination
  zones; bots treat `assault` and `combined-arms` as objective modes; the KOTH
  hill is the authored zone nearest the arena centre.
- **Reload and the whole arsenal.** `R` reloads; the starting-weapon setting
  accepts all **ten** weapons instead of clamping at the Flak Cannon; bots use
  the Shock Beam, Grenade Launcher, Flak Cannon, Marksman Rifle and SMG.
  Magazine attachments raise the real reload ceiling and Quickdraw speeds it.
- **Balance correctness.** Light Frame no longer becomes a hidden damage bonus,
  harness passive damage modifiers apply to outgoing fire, team modes cannot
  destroy their own vehicle, mounted chainguns damage enemy armour, and the
  Hermes/Cline/OpenCode vehicle perks work.
- **Server hardening and renderer fixes.** Room names are stripped/bounded; a
  late joiner no longer replays buffered events (a mid-match join becomes a
  spectator); gear writes are blocked for spectators and rate-limited;
  progression eviction is LRU. The CPU renderer draws every `InstancedMesh`
  instance and disposes surface textures on world rebuild.

## v2.8 — 2026-09-11

- **Killstreak callouts.** Rapid chains announce DOUBLE / TRIPLE / OVERKILL /
  MONSTER / MEGA KILL, and five-kill milestones announce KILLING SPREE / RAMPAGE
  / DOMINATING / UNSTOPPABLE / GODLIKE / LEGENDARY. Death events carry the killer
  so solo and network matches share the logic.
- **Post-match superlatives.** The results screen names MATCH MVP, MOST OBJECTIVE
  TIME, FLAG RUNNER, BEST K/D and FEED PROVIDER.
- **Bots that value their lives.** A critically hurt bot with no supply
  backpedals, and bots refuse to fire a rocket, grenade or plasma shot when the
  target is inside their own blast radius.
- **Colorblind team palette and tactical radar.** A Team colors option swaps
  red/blue for the Okabe-Ito orange/blue pair while keeping the one-bar/two-bar
  world markers; a circular yaw-relative radar shows nearby operators, objective
  zones and flags with a rotating sweep (disabled under reduced motion).

## v2.7 — 2026-09-11

- **No more endless falling.** Positions are clamped before the vertical pass, so
  you always land at the terrain edge; next-gen maps also carry a kill-plane
  (`voidY`), so any impossible fall resolves to a death and respawn.
- **A bigger, clearer HUD.** The match clock, frag counter, health, armor,
  ability, weapon and command readouts scale with the viewport, with stronger
  panels and glows. Objective/score/capture announcements render as a large
  glowing banner with a sweeping underline; kill banners pop, the kill feed
  slides, and hitmarkers and damage numbers are larger. All respect reduced
  motion.

## v2.6 — 2026-09-11

- **Rounded, articulated operators.** Each operator is built from smooth capsules
  and ball joints with a real joint hierarchy (`game/character-anim.mjs`), and a
  procedural rig drives idle breath, a speed-scaled run cycle, contra-lateral
  arm/leg swing, torso lean, strafe roll and crouch/air/ADS poses.
- **Bots move like they mean it.** Actors carry a smoothed `bodyYaw`; the rig
  tracks the aim point with head and chest, banks into turns, pitches the weapon
  with aim and flinches when hit.
- **A new level system.** `game/levelgen.mjs` builds levels deterministically
  from a seed: heightfield terrain with biomes (canyon, forest, snow, volcanic,
  urban, ruins, cavern), cliffs, buildings with walkable doorways/interiors,
  tunnels, domed caverns, bridges, arches, columns and props.
- **One next-gen map per mode** (`game/nextgen-maps.mjs`): The Colosseum
  (deathmatch), Frost Gate (CTF), Sunken Hill (KOTH), Riverbend (domination),
  Iron Fortress (assault), The Atrium (team deathmatch), The Catacombs
  (instagib), Slagworks (rockets), The Forge (arsenal) and Titan Valley (combined
  arms). Collision blocks become hidden proxies while the world renders smooth
  geometry, and a spatial-grid navigation graph keeps bots pathing.

## v2.5 — 2026-09-11

- **New identity.** The title screen shows **C O C S** in big industrial type
  with `COLOSSEUM / OF / COMPETITIVE / SLOP` stacked beneath, sliding in one
  letter at a time. The in-game wordmark, metadata, server banner and deployment
  labels follow.
- **Tongue-in-cheek roster.** The nine operators gain parody tags and bios:
  ChatGPT "The People Pleaser", Claude "The Safety Officer", Grok "The Reply
  Guy", Meta "The Open-Weight Dad", Gemini "The Reviser", DeepSeek "The Price
  Cutter", Mistral "The Le Coq", Kimi "The Context Hoarder" and Qwen "The
  Shipping Container".
- **Harness copy with teeth.** Every harness keeps its mechanics but gains a joke
  explaining it; powerups, modes, gear, attachments, finishes, reticles, ranks
  and weapons all receive fuller descriptive copy.
- **Back out of the menu.** Escape or the X button on the loadout screen returns
  to the COCS title screen at any time. The Rank screen groups unlocks into Gear,
  Weapon Mods, Weapon Finishes and Reticles with progress bars.

## v2.4 — 2026-09-11

- **Action title demo.** The menu showcase alternates a 16-bot **Combined Arms**
  battle on the largest vehicle maps (bots pre-seated in Pumas and Hornets) and
  an **Instagib** rail match, with quicker cinematic cuts.
- **Quake 2 rail and unique weapon effects.** The Rail Lance fires an additive
  spiral-textured coil with a white-hot core and expanding muzzle ring, capped by
  a starburst impact. Every weapon reads differently in use — pulse tracers,
  rocket smoke and shrapnel, scatter/flak pellet cones, plasma orbs, grenade
  fireballs, jagged shock arcs, marksman lances and quick SMG streaks.

## v2.3 — 2026-09-11

- **Charge coil** accumulates charge per frame until `chargeTime`, emits
  charge start/ready events, and fires a boosted shot; releasing early resets it.
- **Homing beacon** makes rockets steer toward the nearest enemy within range
  each step. **Burst module** continues a burst after the initial trigger pull.
- **Reticles.** All five reticle shapes render and are selectable; the dynamic
  gap transform excludes chevron/split. The harness panel now lists each
  harness's vehicle skill.

## v2.2 — 2026-09-11

- **Weapon attachments.** Four mod slots (optic, barrel, magazine, underbarrel)
  and fourteen unlockable mods change both looks and behaviour: long barrels and
  scopes extend range, drum magazines add rounds, piercing rounds punch through,
  explosive tips detonate, the underbarrel grenade launcher adds splash, homing
  beacons curve rockets, burst modules fire in bursts, charge coils hold for a
  boosted shot and chain capacitors arc into a second target.
- **Vehicle overhaul.** Steering no longer inverts, riders visibly mount the Puma
  and Hornet and are valid targets, and each vehicle has a driver, gunner and
  passenger seats; the gunner works the mounted chaingun.
- **Vehicle skills.** Harnesses carry perks: OpenClaw Auto-Gunner, Roo Gunner
  Drone, Claude Code reactive plating, Codex hull repair, Cline nitro boost,
  Hermes engine overdrive and OpenCode faster turret.
- **Assault mode.** Attackers capture sectors in order while defenders hold;
  breaching the final sector wins. Trenchline and Signal Ridge join Combined
  Arms, while Rampart and Catwalk Breach are built for Assault. Six weapon
  finishes recolour guns and all five reticle styles carry across matches.

## v2.1 — 2026-09-11

- **Two new weapons.** The **Marksman Rifle** (hard-hitting semi-auto for long
  lanes) and the **Submachine Gun** (fast, close-range spray) bring the arsenal
  to ten, each with models, distinct audio, pickup mapping and ammo.
- **Balance pass.** The Scattergun fires slower with tighter maximum bloom, the
  Plasma Driver cycles slightly slower, and the Flak Cannon was slowed to widen
  the heavy gap, so no single weapon dominates a range band.
- **Weapon customisation and gunplay.** The primary gear slot is a weapon kit
  that trades damage, spread, speed and armour. The number row binds 1–9 and 0
  across the ten weapons, with the wheel covering everything and cleaner
  first-shot accuracy.

## v2.0 — 2026-09-11

- **XP and ranks.** Every completed match awards XP for frags, objective play and
  winning. `game/progression.mjs` owns a deterministic XP curve, level rewards
  and six rank titles (Recruit → Mythic), shared by the client and game server.
- **Unlocks.** Eight gear pieces and three weapon finishes unlock as you level,
  shown on a new **Rank** screen with level, XP bar and career stats.
- **Gear for Combined Arms.** Equip one item per slot (weapon kit, armour,
  utility) to tweak health, armour, speed, damage and spread.
- **Server persistence.** A stable local player id is sent on join;
  `server/progression.mjs` stores XP, levels, unlocks and saved gear to a JSON
  store, awarding results authoritatively at match end and pushing a
  `progression` update to each player.

## v1.9 — 2026-09-10

- **The Hornet.** A second vehicle chassis with true flight: throttle, steering,
  boost, vertical lift (jump climbs, crouch descends), hovering, a ceiling,
  graceful pitch/roll and paired nose guns. It only appears on the largest
  combined-arms map.
- **Skyfall Basin.** The biggest arena yet: fortified bases, a central mesa, four
  flak towers, armour lanes and two Hornet pads per side, built for 16-bot
  Combined Arms.
- Bots flying a vehicle now fire the mounted gun, and vehicle entry accounts for
  altitude so ground units cannot board a Hornet in flight.

## v1.8 — 2026-09-10

- **An arena framework.** Every map carries a group (urban, indoor, outdoor,
  island, vehicle, combined), a scale, a mode whitelist, a recommended bot count
  and a `legacy` flag (`game/arenas.mjs`). The picker, shuffle and "next arena"
  respect the selected mode and hide archived maps unless **Legacy arenas** is
  enabled; the original compact arenas are marked legacy.
- **Traversal v2.** Maps can author **jump pads**, **ziplines** and paired
  **teleporters**, all simulated deterministically, rendered and covered by
  tests.
- **New maps.** *Neon Vertical* (urban rooftops with jump pads and ziplines),
  *Substation 7* (enclosed indoor facility) and *Warfront Delta* (a wide
  combined-arms battlefield with four Puma slots).
- **Combined Arms mode** with up to **16** bots (per-mode `maxBots`), plus
  animation of every mode's objectives. Bot count scales per mode (8 standard,
  16 Combined Arms) and the setup slider follows it.

## v1.7 — 2026-09-10

- **Different bots play differently.** Each bot blends its operator `role`
  (adaptive, anchor, disruptor, connector, duelist, ambusher, flanker, orbiter,
  optimizer) with its harness `personality` plus a stable per-slot jitter,
  fielding distinct behaviour profiles that choose different engagement ranges,
  aggression, flanking, supply priority and vehicle use.
- **No more pile-ups.** Bots steer apart (`separation`), take distinct perimeter
  slots around objectives, spread across supplies, and deprioritize targets
  their teammates are already fighting.
- **Harder to hold ground, attackers keep pushing.** A contested objective decays
  the holder's control toward the challenger instead of freezing, and bots keep
  advancing while shooting rather than stopping to duel.

## v1.6 — 2026-09-10

- **Theater (demo recording and playback).** Every finished solo and network
  match is recorded automatically as compact keyframes (18 Hz, rounded,
  gzip-ready); replay any recording, scrub the timeline, change speed and watch
  with cinematic cameras.
- **Variable camera angles.** A camera director offers seven rigs — orbit, chase,
  dolly, crane, tripod, follow and first-person — and auto-cuts to kills,
  explosions and captures. Pick a rig with `1`–`7` or the on-screen chips, cycle
  subjects with `[`/`]`, and play/pause with `SPACE`.
- **Live menu showcase.** The main menu renders a real bot match behind the UI,
  auto-directed by the same camera system, with the selected operator's 3D model
  composited into the customization panel. Toggle under Graphics & settings.

## v1.5 — 2026-09-10

- **Bunny-hopping works now.** Holding jump auto-hops, and a held or buffered hop
  skips the landing frame's ground friction, so chained hops keep their momentum
  instead of bleeding ~10% per landing. Air acceleration is retuned (`airAccel
  3.5`, `airCap 1.6`, terminal ×2.2) so strafe jumping turns speed into gains.
- **Richer synthesized audio.** Gunshots are layered (filtered noise transient +
  tonal body + sub thump) with per-weapon character (rifle/heavy/zap/burst/
  plasma), plus improved explosions, reload clicks, weapon-switch, hit and kill
  feedback, footsteps and landing thuds, and a speed-tracking Warthog engine.
  Positional sounds use distance falloff and stereo panning.

## v1.4 — 2026-09-10

- **Combat feedback.** Floating damage numbers, a directional damage indicator,
  kill/death banners, a weapon/ammo panel with auto/semi and reload state, and a
  match/objective announcer (`FIGHT · MODE · MAP`, `RED/BLUE SCORES`,
  `FLAG CAPTURED`), all driven by existing snapshot/event data with pure, tested
  helpers.
- **Renderer feel.** Dynamic FOV (sprint widens, ADS narrows), pooled muzzle
  lights, a low-health screen overlay, and bounded camera shake on damage/death,
  suppressed for reduced motion and the CPU fallback. Shared material/geometry
  caches cut per-model allocation.
- **Bot AI and platform maps.** Scan range scales with map size and difficulty;
  bots always have a purposeful destination; CTF defenders hold a post and
  attackers vary their approach; long rotations detour to vehicles. Ironfall
  Megastructure and Longreach Plateau gained physical up/down return routes so
  their full bot-navigation graphs connect in both directions.

## v1.3 — 2026-09-10

- **Movement and gunplay.** Movement is rebuilt on a Quake/Source ground-friction
  + acceleration model with air acceleration (strafe jumps build speed), variable
  jump with apex hang, plus sprint, crouch and a momentum-preserving slide.
  Gunplay adds authoritative recoil aim-punch with per-weapon spray patterns,
  bloom spread, ADS, reload plus auto-reload, holster/raise timing, and a
  spread-driven crosshair, hitmarker, reload bar, posture chip and low-ammo
  warning. Coyote time (.10 s) and jump buffering (.12 s) remain.
- **Warthog and maps.** The Puma is rebuilt as a recognizable M12 Warthog with
  roll cage, open bed, corner off-road tires and a 360° turret, driven by arcade
  physics with lateral-slip drift, handbrake, boost, suspension/slope alignment
  and body roll/pitch; fast-moving vehicles splatter infantry. Blood Gulch is
  rebuilt to a faithful 160×70 m box canyon, and three new large CTF maps
  (Frostline, Derelict Station, Ashen Rift) join the roster.
- **Rendering.** Directional shadows, a PMREM image-based environment,
  deterministic procedural FBM textures, vertex/triangle colour variation, a
  gradient sky with instanced mountains and terrain scatter, and tiered
  bloom/vignette/SMAA postprocessing (bypassed by the CPU fallback and
  reduced-motion).
- **Netcode.** Interpolation delay cut from 160 ms to an adaptive ~100 ms, a
  jitter-adaptive snapshot buffer, server snapshots raised from 20 Hz to 30 Hz,
  and the new stance/ADS/reload inputs forwarded.

## v1.2 — 2026-09-08

- Adds three large expansion maps, King of the Hill, Domination, authoritative
  control-point snapshots/events, world-space objective markers, objective-aware
  bots, objective-aware history, and a tactical HUD command layer that calls out
  the current team, score target, zone/flag state, route and next action.

## v1.1 — 2026-09-08

- Adds Blood Gulch: immutable triangulated terrain supports interpolated valley
  floors, hills, walkable slopes and analytic cliff ray hits while preserving
  legacy box maps.
- Two neutral Puma vehicles spawn near the opposing bases; one driver can use
  forward/reverse arcade handling and paired side-mounted chainguns with
  authoritative heat, damage, destruction and respawn. Puma state is included in
  snapshots and local prediction, and `E` is a one-shot enter/exit input in
  multiplayer.

## v1.0 — 2026-09-08

- Launcher traversal is tuned from authored source-to-target ballistic links with
  bounded air correction and descending landing capture, so island jumps stop
  overshooting.
- Weapon feedback is data-driven across all eight weapons with distinct kick,
  muzzle, tracer, impact and synthesized audio profiles, plus dry-fire cues.
  Harness profiles add passive movement/resistance and weapon affinities;
  operator profiles add bot weapon and strafe identities while preserving
  deterministic simulation and bounded balance modifiers.

## v0.9 — 2026-09-08

- Adds Skybreak Isles and Aether Ring, two much larger outdoor CTF arenas built
  from disconnected platforms over a lethal void. Authored jump links give bots
  deterministic high-speed routes, while the renderer shows platform slabs,
  supports, route colours, void depth and launcher markers.
- Multiplayer inputs carry sequence numbers; server snapshots acknowledge
  processed inputs so the client can rebase and replay instead of visibly
  rolling back on every snapshot. Remote interpolation uses server simulation
  time and a deeper jitter buffer.

## v0.8 — 2026-09-08

- Adds the Launchpad and Citadel arenas, Capture the Flag and Team Deathmatch,
  eight total weapons, Haste/Overcharge/Overshield pickups, trampoline and
  boost-launcher traversal, objective-aware bots, and bounded projectile
  handling. Launchpad is the recommended CTF map: opposing launchers cover the
  centerline and four trampolines reward aggressive flag routes.

## v0.7.1 — 2026-09-08

- Fixes chat input focus and selection-screen layout: window-level chat keys while
  chatting, and a non-overlapping action bar via the selection-scroll wrapper.

## v0.7 — 2026-09-07

- Reorganizes the first screen around game-menu best practices: an identity-first
  selection screen (operator + harness + preview) with a persistent action bar —
  a dominant `ENTER ARENA`, `PLAY ONLINE` (becomes DISCONNECT while connected),
  `MATCH SETUP` and a settings gear.
- Arena and match rules move behind the `MATCH SETUP` dialog, and the multiplayer
  server address is tucked into the room browser behind a compact row with a
  QUICK JOIN shortcut. Progressive disclosure puts everything within three
  clicks, and Escape closes any overlay.

## v0.6 — 2026-09-07

- **Multiplayer fixes.** `create` always mints a fresh 4-letter room and can no
  longer silently route into a previously persisted room; abandoned on-demand
  rooms are retired after their grace period so the browser list stays honest.
- **Room chat.** `{type:'chat', text}` broadcasts room-scoped messages (control
  chars stripped, trimmed, capped at 200 characters, rate-limited to one per
  300 ms per peer) to players and spectators alike, rendered as a lobby panel and
  a bottom-left in-game overlay (`T`/`Enter` opens, `Enter` sends, `Escape`
  closes; solo play is untouched).

## v0.5 — 2026-09-07

- Adds a room browser over concurrent rooms (join or create a 4-letter-coded
  room from the selection screen), spectator mode (no seat, no inputs, full
  snapshot/results feed, WATCH from the browser), and per-server match history
  persisted to `server/history.json` and rendered as a recent-matches panel.
  Matchmaking and accounts remain future scope.

## v0.4 — 2026-09-07

- Adds playable local-network multiplayer: per-actor human inputs in `Match`, a
  Node game server (`server/`) authoritative over rooms, a browser client
  (`game/net.mjs` + lobby UI) with client-side prediction and reconciliation, and
  session-based reconnection with bot handoff and host migration.
- The web client connects over WebSocket, joins with your current
  operator/harness/callsign, and the first joiner becomes host. The server runs
  `Match` at 60 Hz, applies each peer's latest input every tick, converts
  jump/power presses into one-shot edges, streams `events` deltas per client and
  broadcasts full snapshots. The client predicts its own actor and interpolates
  remote actors and rockets.

## v0.3 — 2026-09-07

- Authorized custom match expansion: four modes (Deathmatch, Instagib, Rocket
  Arena, Full Arsenal), 0–8 bots and four difficulty presets, plus full match and
  display configuration.
- **Difficulty presets.** Easy (0.85 s reaction, 0.45 s decision interval,
  0.19 aim error, +0.2 s shot delay), Normal (0.3 s/0.2 s/0.045), Hard
  (0.16 s/0.14 s/0.023) and Nightmare (0.08 s/0.1 s/0.01); all retain
  visibility/cover requirements and equal base statistics, and difficulty never
  grants extra health.
- **Match configuration.** Frag limit 5–50, timer 60–900 s, respawn 1–5 s,
  speed/gravity/damage multipliers, unlimited ammo for unlocked weapons, 50%
  cooldowns and 25% life steal from actual enemy health damage. Display covers
  FOV 65–110, crosshair shape/colour/size, weapon visibility and an FPS counter;
  the callsign is sanitized and capped at 20 characters, and settings persist
  locally.
- Validation: 34 simulation tests, including complete 8-bot matches for all 16
  mode/difficulty combinations, plus per-actor multi-human input coverage.

## v0.2 — 2026-09-06

- Authorized content expansion superseding the original MVP stop gate for a
  bounded pass (no networking or progression work).
- **Operators.** Gemini (blue/gold paired diamond visor), DeepSeek (cyan tall
  helmet fin), Mistral (amber stepped crest and striped chest) and Kimi
  (pink/ivory orbital helmet ring) join, bringing the roster to nine. They share
  the rig and equal base statistics and can appear as bots.
- **Harnesses.** Codex / Recompile (instant 35 heal, capped 100, 16 s cooldown),
  Cline / Phase Step (up to 6 m forward with .12 m collision samples, 11 s
  cooldown) and Roo Code / Context Jam (7 m line-of-sight slow to 55% for 3 s,
  15 s cooldown) bring the total to seven.
- **Weapons.** The **Scattergun** (slot 4: eight 8-damage pellets, .12 spread,
  24 m, .72 s interval) and **Plasma Driver** (slot 5: 34 m/s projectile, 25
  direct + up to 12 splash, .24 s interval) bring the total to five.
- **Arenas.** Crosswire (ground-level cross lanes, violet palette) and The
  Foundry (orange industrial room with furnace towers, ramps and a north gantry)
  join The Exchange. Each match owns its map, spawns, pickups and navigation,
  and renderer geometry derives from the same block definitions. All 63
  character/harness pairs validate and every map has safe spawns, reachable
  supplies and a connected graph.

## v0.1 — Original MVP

- The first playable build: a local Three.js first-person free-for-all with five
  operators (ChatGPT, Claude, Grok, Meta, Qwen), four harnesses (OpenClaw, Hermes,
  OpenCode, Claude Code), three weapons (Pulse Rifle, Rocket Launcher, Rail
  Lance) and one arena (The Exchange).
- Deterministic fixed 60 Hz simulation with at most five catch-up steps; Quake/
  Source-style movement with coyote time (.10 s) and jump buffering (.12 s);
  procedural models, synthesized audio and original geometry only. A CPU
  software-renderer fallback keeps the game playable where WebGL2 is
  unavailable.
- Four bots use the same movement/combat/power/pickup rules as the human, with
  bounded 25-unit vision, .3–.55 s reaction delay and aim noise. Matches end at
  15 frags or 300 s, with pause, results and rematch; Claude is restricted to
  Claude Code while every other operator may use any harness. No accounts,
  backend or LLM dependency; local preferences only.
