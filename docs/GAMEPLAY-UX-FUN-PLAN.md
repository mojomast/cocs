# Gameplay, UX and fun-factor implementation plan

**Audit date:** 2026-09-19

**Inspected baseline:** v8.2 FIELDWORK, `371017c`, `/home/mojo/projects/tokenarena-world`

**Deliverable:** documentation-only audit and implementation plan.

**Integration note:** source changes from the active implementation work appeared while this document was being written. Findings, line references and diagnostic output describe the inspected `371017c` baseline; reconcile overlapping findings with those patches before opening new work. This audit owns only this document.

## Executive recommendation

### Integration status for v8.3 CLARITY

The accompanying implementation resolves F01's live supply-snapshot mismatch,
adds lesson-scoped/local evidence, explicit current/next progress and acknowledgement,
pauses the local match and releases the cursor at completion beats, and excludes
practice matches from progression/history. A protected, staged tutorial scenario
is still future work. The incorrect duplicate Lattice FRAGS column is removed and
scoreboard grids now match their real column counts. Spend keyboard handling
respects native controls and repeat edges; short-screen spend panels are bounded.
Numeric formatting, compact spectator controls and title-camera continuity are
also implemented in this pass. Findings below remain a baseline audit; these
delivered items should not be reopened as outstanding work.

### Integration status for v8.4 FIELDCRAFT

The implementation now closes F02-F09 and F11 at the code/automated-contract
level: public dominance and Operations outcome state, shared local/network event
priority, one navigation-backed legal-target model, passive standings/death
summaries, effective-rules previews, short-screen objective hierarchy, authored
Director labels, mode-specific result learning, remapped labels and held touch
jump. Training remains reward-free and keeps its documented ordinary 15-minute
Foundry scenario; a protected staged scenario is still deferred.

F10 has deliberately not produced balance changes. The technical viewport/input
gate and the worksheet below can validate mechanics, but the required five new
participants plus two experienced comparison players were not available in this
coding environment. Do not relabel automated or agent-driven checks as human fun
evidence. Run the First-time player session before changing weapons, bot pressure,
roster density, rewards or Director tuning. D2-D4 measurement remains deferred.

**Make the existing game easier to understand and respond to before adding more systems.** The repository already has substantial combat variety, mobility, objective tactics, bots, progression and replay support. The largest opportunities are closing the loop between a player's action, its visible consequence, the win condition, and an understandable next decision.

Three immediate discoveries deserve attention:

1. **Field Training cannot pass its supply step with the page's actual snapshot shape.** A bounded Node diagnostic reproduced this integration mismatch. Route this finding into the active tutorial work.
2. **Important Lattice banners are lost between the feedback helper and the page.** Enemy captures are filtered out locally, teamless wave-clear events fail the same filter, and the online event loop does not call the new announcement helper.
3. **The decisive PvP dominance timer is not in the Lattice snapshot or HUD.** Players see OP totals, but cannot see the authoritative countdown that can end the match first.

The next improvements should make entry choices predictable, preserve combat control during passive HUD viewing, provide a compact objective-first HUD, and turn results into useful feedback. Combat balance changes need focused human playtests; the inspected code does not establish that any weapon, operator, or difficulty is currently fun or unfair.

## 1. Evidence and scope

### Evidence labels

- **CODE:** inspected current source and traced the relevant caller/model/view. A functional or design concern, not a report of observed human experience.
- **DIAG:** a small executable diagnostic run during this audit. Proves the specified data-path behavior only.
- **HISTORY:** a claim or measurement recorded in existing project documentation. Not rerun here, and its version/context matters.
- **PLAYTEST NEEDED:** a hypothesis about comprehension, comfort, challenge or enjoyment that needs human observation.

**No new browser playtest, hardware frame-pacing measurement, audio audition or human fun-rating was performed in this audit.** No expensive test suite, build, deployment or commit was run. One short Node process constructed a Lattice match and inspected training, notification and scoreboard models; it did not simulate a whole match.

The user identified numeric formatting, oversized spectator bot cards, a jumpy title-screen action demo, and tutorial pacing/current-next-step presentation as active work. Those are **user-reported active issues**, not independently reproduced playtest results from this audit.

### Sources inspected

| Area | Primary evidence |
|---|---|
| Entry, configuration, online flow | `app/ui/screens/TitleScreen.tsx`, `SelectionScreen.tsx`, `SetupModals.tsx`, `NetScreens.tsx`; `app/game-ui/configuration.tsx`; `app/page.tsx` |
| Combat and recovery | `game/core.mjs` damage, spawning, weapons, reload and killstreak paths; `game/weapons.mjs`; `game/config.mjs`; `game/respawn-ui.mjs`; `app/ui/screens/RespawnOverlay.tsx` |
| Lattice objectives, economy and AI | `game/cocs.mjs`, `cocs-coop.mjs`, `cocs-difficulty.mjs`, `cocs-bots.mjs`, `cocs-orders.mjs`, `lattice-board.mjs`, `lattice-guide.mjs`, `lattice-maps.mjs` |
| Teaching and HUD | `game/lattice-training.mjs`, `lattice-training.test.mjs`, `onboarding.mjs`, `hud.mjs`; `app/ui/screens/PlayingHud.tsx`, `OperationsDirectorHud.tsx`, `SpendWindowHud.tsx`; `app/styles/lattice-guide.css` |
| Input and presentation | `game/cursor-mode.mjs`, `touch.mjs`, `shot-planner.mjs`; `app/game-ui/touch-controls.tsx`; `app/globals.css`; page input/event adapters |
| Results, progression and single-player | `game/scoreboard.mjs`, `progression.mjs`, `challenges.mjs`, `outcome.mjs`, `singleplayer-ui.mjs`; `app/ui/screens/ResultModals.tsx` |
| Existing evidence | `README.md`, `docs/CHANGELOG.md`, `docs/VERIFICATION.md`, `docs/LATTICE-COHERENCE-AUDIT.md`, `docs/LATTICE-FIELD-GUIDE.md`, `docs/LATTICE-TRAINING.md`, `reports/README.md`, `game/ttk-envelope.test.mjs` |

This is a cross-system audit with deeper coverage of the newly integrated Lattice path. It is not an exhaustive route, balance or content certification of every arena and mode.

### Existing findings that must not be reopened wholesale

`docs/LATTICE-COHERENCE-AUDIT.md` predates the final v8.2 integration. Its command identity, cursor access, FORTIFY target, missing training and instant-zipline findings are valuable history, but are not an accurate current backlog as a group:

- `latticePeerId`, `withSinkTargets` and the page's command/spend adapters now supply local actor identity and concrete targets.
- `game/cursor-mode.mjs` and `SpendWindowHud.tsx` provide an explicit cursor owner and keyboard purchases.
- `game/lattice-board.mjs` supplies useful local cards even without a historical order feed.
- Field Training and the objective announcement helpers now exist.
- `docs/CHANGELOG.md` v8.2 records the cable ride and departure/arrival FX work. These are shipped implementation/history claims; their comfort still needs human verification.

The older audit references `docs/design/COCS-MODE-SPEC.md`, `COCS-OPERATIONS.md` and `COCS-MAP-ARCHITECTURE.md`; these paths are absent from this checkout. Treat quoted requirements from them as historical references, not newly inspected specification authority. The v8.2 changelog is also more current than `docs/VERIFICATION.md`'s leading v7.2 evidence.

## 2. Coordinate with the work already in progress

| Active task | Audit handoff / integration criteria |
|---|---|
| Numeric formatting | Use its shared display policy for the findings below. A missing/wrong statistic is a data-contract issue, not a decimal-formatting fix. Verify fractional values, zero, infinity and resource units on the actual rendered surfaces. |
| Oversized spectator bot cards | Keep sizing owned by that task. Include a large team roster and a followed actor dying/respawning in its acceptance pass; roster movement and target continuity matter as well as card dimensions. |
| Jumpy title-screen action demo | Keep camera tuning owned by that task. `game/shot-planner.mjs:64–88` already defines minimum shot duration, hysteresis and beat holds; test integrated camera ownership and transitions, not only these constants. Require readable action and stable menu interaction with reduced motion on and off. |
| Tutorial pacing and current/next steps | **F01 below is an integration dependency for this task.** Include the real snapshot shape, local-action attribution, safe completion/exit and remapped instruction copy in the same workstream. Do not start a competing tutorial rewrite. |

## 3. Prioritized findings

Priorities: **P0** blocks a promised core learning path; **P1** materially damages understanding, agency or trust; **P2** improves retention, accessibility or tuning after correctness. Effort is relative: **S** localized adapter/copy work, **M** coordinated model/UI changes, **L** a cross-system feature or measured tuning pass.

### F01 — P0 / M — Training's live contract and learning guarantees need completion

**Evidence: CODE + DIAG. Active tutorial owner.**

- `game/lattice-training.mjs:74–87` reads `snapshot.nodes` for `ownedConnected`. `app/page.tsx:467` passes the whole `Match.snapshot()`, whose nodes are under `cocs.nodes` (`game/core.mjs:1088–1090`). With `front-0` owned and linked to HQ, the real shape stays at index 3, KEEP THE LINE; adapting `nodes: snapshot.cocs.nodes` advances to index 4.
- The course tests use synthetic root-level `nodes`. The real-match test stops after move/fire (`game/lattice-training.test.mjs:88–111`), before the broken seam.
- All event counts accumulate before their lesson, and the `while` loop consumes every already-satisfied step (`lattice-training.mjs:126–148`). The `local` predicate also accepts team-0 bot actions; terminal counting is team-wide. A teammate's order/capture can satisfy an individual practice task. Five `shot` events satisfy “Land five shots,” even if none hits.
- `quickStart` spreads the saved config into training and retains ordinary match resolution (`app/page.tsx:740`). The course can inherit modifiers and objective settings and still faces the 900-second match limit and Operations loss conditions. `r.training` is presentation state, not a protected simulation mode.
- `skipTraining` exists in the pure module, but the page imports only create/evaluate/view. `PauseModal` has generic RETURN TO LOADOUT, not the documented END TRAINING; the completed banner has no completion action. The ordinary local match-end branch at `app/page.tsx:439` awards XP/challenges/history without a training exclusion, contrary to the documented “does not affect ... records” policy.

**Implementation:** define one explicit live training context; use the authoritative connectivity representation; separate shared-world observations from player-performed tasks; give each lesson an entry baseline and completion evidence. Coordinate dwell/current-next handling with the active patch. Author a predictable practice preset and an explicit completion/skip path with a defined reward/history policy. A small staged scenario can supply a target, legal route and spend opportunity without requiring a full five-wave win.

**Acceptance:**

- Both courses pass the supply lesson through the exact page-to-evaluator shape from a real `Match.snapshot()`.
- Bot orders, bot rides and bot terminal use never satisfy lessons that explicitly ask the player to perform those actions. Shared captures count only if the lesson explicitly teaches observing the team, or the local player participated.
- “Fire” versus “hit” instructions match their predicate; a completion beat never hides an unseen required task.
- Every operator can complete mandatory tasks; a denied terminal or unavailable route yields an actionable recovery path.
- Waiting to read for two minutes cannot fail the practice scenario; saved instagib/one-shot/custom objectives cannot silently change it.
- Completing, skipping and leaving training have visible outcomes, and their persisted XP/challenge/history behavior matches the chosen policy. Replay training remains available.

### F02 — P1 / M — Objective feedback is partially wired and lacks event priority

**Evidence: CODE + DIAG.** `game/hud.mjs:249–291` builds the new objective beats, but `app/page.tsx:443` stores only `beat && beat.mine`:

- Enemy captures deliberately return `mine: false`, so their OBJECTIVE LOST banner is discarded locally.
- `director-wave-cleared` has no team in its normal event shape. The helper assigns a display team but returns the earlier `mine` calculation, which is false; the wave banner is discarded too.
- The online loop at `app/page.tsx:432` processes sound, hit feedback, pickups and optional captions, but does not call `cocsAnnouncement`. Audio/FX may still fire through their own paths; this finding concerns the dedicated HUD banners.
- Accepted beats overwrite a single `r.announceCue`; a later low-importance event can replace a siege warning. `PlayingHud.tsx:139` prioritizes broad banner categories, not the importance of competing objective beats.

**Implementation:** share the objective-event adapter across local and online paths; distinguish event relevance from friendly ownership; add a bounded priority/deduplication policy. Include previous owner in capture semantics if needed: an enemy taking a previously neutral point should not be called a point “lost” by the player. Preserve team-private filtering on network input.

**Acceptance:** local and two-team network scenarios each show a friendly capture, actual friendly-point loss, wave clear, HQ siege, order completion and local refusal once. Opponent-private orders/spends never appear. Siege survives simultaneous routine orders; stale notifications expire. With audio muted and captions off, a player can still identify the critical objective change.

### F03 — P1 / M — Show the actual win condition before the match ends

**Evidence: CODE.** `game/cocs.mjs:1707–1739` maintains a dominance team, progress, target and fast threshold; dominance can win before time-score resolution. `cocsSnapshot` (`:1749–1852`) does not publish dominance. `cocsBoard` and `commandBrief` in `game/hud.mjs` show OP/node totals, while `modeTargetText` says HOLD THE LATTICE for both PvP and Operations. Operations adds its wave/HQ data in a separate Director panel.

**Likely experience, PLAYTEST NEEDED:** an OP lead can look like safety while an unseen enemy dominance countdown is about to win. Operations players may track the competitive score rather than the five-wave/HQ objective.

**Implementation:** publish a small public outcome-progress view and render a mode-specific primary status. PvP: controlling team, required capturable-node majority, remaining hold time, accelerated state and what resets it. Operations: waves cleared/total and HQ integrity, with siege above economy diagnostics. Do not reconstruct authoritative progress from elapsed client time.

**Acceptance:** a player can answer “who is close to winning, how, and what can I do?” in a five-second HUD glance. Dominance starts, accelerates, resets and reconnects accurately; both teams see the same public timer. OP remains labeled as score, not a universal victory target. The existing one-line result reason remains consistent with the displayed progress.

### F04 — P1 / M — Recommendations and command cards should point at feasible decisions

**Evidence: CODE.** `latticeCoach` (`game/lattice-guide.mjs:50–80`) selects by legality, contest and straight-line distance. It has no route cost, switching hysteresis or HQ-siege override. The supply diagram is correctly documented as topology, not pathfinding. `localBoardCards` (`game/lattice-board.mjs:181–188`) calls neutral live nodes CAPTURABLE without checking adjacency there, and creates no equivalent attack card for an enemy-owned frontier. The page's order preflight checks co-op identity/gates, then immediately displays ORDER ACCEPTED before the sim evaluates all conditions (`app/page.tsx:827–832`).

**Implementation:** reuse a single legal-target model across coach, strip and board. Rank a small legal shortlist by reachable route and strategic urgency; hold advice unless the target becomes invalid or an urgent event supersedes it. Provide an action marker using existing navigation/landmarks. Use QUEUED until authoritative acceptance, then completion/refusal with a useful next action. Keep movement guidance distinct from an order to AI teammates.

**Acceptance:** every suggested capture is adjacent and reachable by the selected operator's ground route; enemy recapture options remain available when no neutral node exists. Small positional changes do not oscillate advice. HQ siege overrides optional forward pushes in Operations. A rejected order never leaves an accepted-success message, and players can locate the named target without opening a reference document.

### F05 — P1 / M — Passive viewing and automatic overlays can interrupt fighting

**Evidence: CODE; browser comfort needs PLAYTEST.** The cursor owner intentionally unlocks and clears input on opening any registered surface (`game/cursor-mode.mjs:102–131`). The page registers scoreboard, automatic respawn, spend and board surfaces (`app/page.tsx:883–890`). The respawn overlay automatically offers nine operators, seven harnesses, kit detail and LOCK IN, while the default respawn delay is two seconds (`game/config.mjs:252`, `RespawnOverlay.tsx`). A last-surface close requests pointer lock outside an explicit click when a timer caused it; the code already handles possible refusal.

**Likely experience:** holding Tab for a scoreboard glance stops normal fighting; every team-mode death can become a cursor/recapture transition. Selecting a complete new kit and reading its tradeoff in two seconds is implausible for a novice. The intermission shortcut `S` also overlaps a movement key, and the document listener has no `event.repeat` guard (`SpendWindowHud.tsx:58–70`). These are integration risks, not a reproduced browser failure.

**Implementation:** make passive score/death summaries noninteractive by default; enter cursor mode only for an explicitly opened interactive control. Preserve quick respawns while allowing an intentional loadout queue with clear next-spawn semantics. Centralize active-surface keyboard priority; require an intentional purchase edge and respect chat/select focus. Keep the existing free-cursor feature.

**Acceptance:** holding/releasing Tab while moving and aiming preserves the intended combat behavior; the interactive scoreboard path still works. An unchanged-loadout death/respawn does not require a surprise click. A requested switch survives the respawn boundary with truthful applied/pending feedback. Opening a spend window while holding S/Space/digits neither instantly dismisses it nor repeats purchases. Closing stacked overlays restores input exactly once.

### F06 — P1 / M — Setup promises need to match effective rules and roster

**Evidence: CODE.** The selection screen has 14 activity cards plus the current-rules ENTER ARENA rail (`SelectionScreen.tsx:26–40,126–128`). Most activities start immediately, while Lattice opens a briefing and changes config. The helper spreads saved settings into new activities (`app/page.tsx:740`). Generic match setup describes zero bots as solo exploration (`app/game-ui/configuration.tsx:104`), but Operations has a four-person team floor, Director garrison/waves (`game/cocs-difficulty.mjs:109–116`). The accessible UI exposes Bot difficulty, not Operations tier; the simulation reads tier from `config.objective.tier` (`game/cocs.mjs:461–462`).

**Implementation:** present a clear recommended first match, training entry, and explicit custom-rules route. Give instant-start cards consistent labels and a concise effective-rules preview, including inherited modifiers and automatic map substitution. In Operations show actual allied fill and enemy-wave behavior, and expose the supported Director tier separately from AI aim/reaction difficulty. Derive these labels from the same normalization/mode metadata used to launch.

**Acceptance:** a new player can identify what clicking each primary action will start. The displayed map, effective roster, duration, modifiers and difficulty/tier match the new snapshot. “0 bots / solo practice” never launches compulsory combat without explaining the mode's fill rule. A saved custom mutator does not silently contaminate the recommended beginner experience. All modes remain reachable through custom setup.

### F07 — P1 / M — Objective HUD hierarchy needs a short-screen layout

**Evidence: CODE; actual overlap/legibility needs PLAYTEST.** The Lattice readout combines coach, several details groups, scores, economy, scout statistics, traversal, order controls and board access (`PlayingHud.tsx:44–131`). `OperationsDirectorHud.tsx:36–51` places pressure/force/telegraph before HQ. The Director panel uses fixed offsets and `max-height: calc(100dvh - 455px)`; the small-width rule uses `100dvh - 390px` (`app/styles/lattice-guide.css:25,38`). At a 390px-high landscape viewport that latter height budget is zero. Below 1050px width the bottom objective bar is hidden (`:55`). Existing disclosure helps, but essential state still competes with diagnostics.

**Implementation:** use a combat summary with one objective, one urgent alert and essential action/vital state; move pressure budget, executor/thread detail and cumulative scout stats into an intentional tactical view. Design by viewport height as well as width. Reserve a central combat area and make wave/HQ state accessible without scrolling. Use authored node labels in Director front/telegraph copy rather than `front-0`-style IDs.

**Acceptance:** at 1366×768, 1920×1080, 844×390 and 390×844, including UI scale 1.4, the objective, vitals, current interaction and siege/wave status remain visible. All command/spend controls remain reachable without scrolling the combat view. No panel covers the crosshair or touch sticks in its default state. Record actual screenshots and human readability observations, not just CSS assertions. Coordinate spectator dimensions with the active card task.

### F08 — P1 / S–M — Scoreboards and results under-explain objective contribution

**Evidence: CODE + DIAG.** `modeColumns('cocs')` requests a `frags` column (`game/hud.mjs:476–477`), but `scoreStats` only returns `SCORE_STAT_FIELDS`, which excludes frags. `renderScoreboard` renders that missing value as zero while its main KILLS column correctly reads `actor.frags` (`game/scoreboard.mjs:92–102`). The diagnostic returned no `scoreStats.frags` for an actor with seven frags.

The result summary's main metrics are kills, deaths, K/D, duration and XP (`ResultModals.tsx:66–80`), and the alternate stats repeat kills/deaths/shots. `cocsResultSummary` already explains the terminal reason; build on it. `matchXp` does reward capture/time metrics, but the summary does not explain that breakdown. Support actions, successful orders and wave preparation are largely absent from the learning summary (`game/progression.mjs:162–166`; `game/challenges.mjs:13–40`).

**Implementation:** remove the redundant broken FRAGS field or give it a correct source. Introduce mode-specific contribution summaries: captures/connected hold and order contribution for Lattice; waves/HQ/spend effects for Operations; checkpoint/mission and survival progress for solo modes. Separate personal credit from team totals. Add a short, evidence-based “next match” suggestion and direct access to the relevant replay moment when recorded.

**Acceptance:** every rendered statistic matches the final authoritative record, including zero and partial loss. Results show why the match ended and at least one meaningful personal contribution before career progression. Players who defended or supported can identify their contribution without needing a high K/D. XP categories sum to the award; repeated UI visits do not duplicate credit. A Lattice actor with seven kills never sees a second contradictory zero-frag column.

### F09 — P2 / M — Key remapping and touch need task-level acceptance

**Evidence: CODE.** Key-aware Lattice helpers exist, but static input labels remain: selection's harness detail says Q (`SelectionScreen.tsx:96`), grenade HUD says G (`PlayingHud.tsx:227`), and training move/fire text hardcodes controls (`lattice-training.mjs:21–35`). Touch presents ten secondary combat buttons plus fire/jump; held mobility is supported, but jump is a one-shot latch (`game/touch.mjs:49–64`) while desktop movement advertises hold-to-hop/variable-height behavior.

**Implementation:** resolve displayed inputs through shared action labels, including tutorial and role/kit copy. Define touch jump/hold behavior deliberately and supply gesture alternatives for essential compound actions. Simplify touch controls by current context and provide a distinct tactical interaction surface. Audit screen-reader announcements: the HUD currently has many independent polite live regions, including hit/reload feedback, which may queue noise in combat.

**Acceptance:** remap power, mobility, interact, grenade and movement, then complete training and an objective interaction using only the labels shown. On a real touch device, move/look/fire, mobility, jump, vehicle entry and spending are achievable without an external keyboard or stuck input after cancellation. Critical announcements remain intelligible with the kill feed active. Muted audio, reduced motion and color-vision settings preserve the same essential information.

### F10 — P2 / L — Tune combat, bot pressure and downtime from human evidence

**Evidence: CODE + HISTORY; fun judgment requires PLAYTEST.** The code has recoil/bloom/ADS, weapon identities, class mobility, cover/flank navigation, spawn heat/exposure scoring, objective assignments and behavioral comeback routing. These are strong foundations. The pure Pulse envelope is about 0.9 seconds on 100HP/0 armor (`game/ttk-envelope.test.mjs:82–85`), but actual difficulty adds `.48/.2/0/0` seconds to bot shot intervals in addition to reaction/aim changes (`game/config.mjs:154–158`, `game/core.mjs:930`). Changing difficulty therefore changes pressure substantially, including from allied bots sharing that profile.

Killstreaks grant recovery and powerups at 3/5/7 kills (`core.mjs:950`); gear grants gameplay modifiers under caps (`progression.mjs:13–21,125–151`). These could amplify a novice's losing run, but the audit does not prove a snowball problem. The v8.2 changelog records D1 wins on 5/12 validation seeds, not novice human success. The stored v7 balance reports are useful reproducible AI evidence, not current human weapon feel or proof of every Lattice matchup.

**Implementation:** measure first-contact time, dead-to-next-meaningful-action time, duel duration by range, repeated spawn deaths, objective participation, and progression/loadout differences. Observe stationary objectives versus mobile fights and short-lane versus long-lane maps. Tune one factor at a time only after identifying the failure: reaction, aim, route, roster density, reward loop, or feedback. Preserve deliberate weapon niches and class movement counterplay.

**Acceptance:** the playtest report separates difficulty/gear/map/experience cohorts and records the actions preceding frustration. Proposed tuning improves the observed failure without eliminating viable counterplay or objective pressure. Existing targeted TTK, spawn, movement and gear checks pass for the mechanics touched; selected complete seed runs provide regression evidence. No all-mode balance sweep is required for an unrelated UI patch.

### F11 — P2 / M — Make “one more match” a focused invitation

**Evidence: CODE; retention effect needs PLAYTEST.** Results offer PLAY AGAIN, NEXT ARENA, SURPRISE ME, replay and change-loadout (`ResultModals.tsx:113–125`), but the summary foregrounds long-term XP/prestige. Selection repeats a large activity catalog. Online ranked search reports searching/cancel, while instant bot practice is a separate panel (`NetScreens.tsx:61–85`). The repository already has campaign checkpoints, horde upgrades, challenges and replay tools; the opportunity is directing attention to them at the right moment.

**Implementation:** lead with a mode-appropriate next action: retry the failed operation/checkpoint, rematch current rules, or deliberately try one new loadout. Show its map/mode/duration and retain useful settings. Suggest one attainable challenge tied to the session, rather than another wall of progression. For empty online sessions, offer an explicit leave-queue-and-practice action with clear local/unranked context.

**Acceptance:** after a win and a loss, players can start their intended next activity without accidentally switching mode or losing context. Practice never silently remains in a rated queue. Campaign/horde next actions refer to real saved progress. Track voluntary second-match starts alongside stated reasons; do not use increased session length alone as evidence of improved fun.

## 4. What should remain the design foundation

- **Immediate local play:** no account or server is needed for a useful session.
- **Expressive movement and readable weapon niches:** existing class mobility and combat systems provide mastery opportunities; improve discoverability before adding more verbs.
- **Ground-route access and connected objectives:** Lattice Foundry already authors route alternatives, paired pickups and landmarks (`game/lattice-maps.mjs`). Make these decisions visible.
- **Real bot objectives and tactical responses:** preserve role assignments, capped concentration, cover/flanks and comeback routing while testing human agency.
- **Deterministic simulation and pure view models:** use authoritative records to drive teaching and feedback. The snapshot mismatch demonstrates why caller-to-model tests matter more than another synthetic UI fixture.
- **Existing accessibility and fallback controls:** retain remapping, captions, palettes, reduce-motion, touch and explicit cursor control while simplifying their interaction.

## 5. Implementation phases and exit gates

### Phase A — Finish the active stabilization pass

**Scope:** existing numeric/spectator/demo/tutorial work plus F01's runtime-contract and lifecycle handoff. **Size:** S–M per existing task; tutorial scope may expand to M.

1. Fix the training context seam before evaluating pacing improvements.
2. Resolve task attribution, current/next display and completion/skip policy together.
3. Verify active visual fixes with real integrated snapshots and representative roster/viewport sizes.

**Exit:** both training courses advance through every required seam using live-shaped state; completion and exit work; current lesson is readable; active formatting, spectator and camera acceptance passes have recorded evidence. Do not describe this as a human fun validation unless humans actually played it.

### Phase B — Make the match tell the truth

**Scope:** F02, F03, F08's statistic correction. **Size:** M.

1. Add shared event relevance/priority handling to local and online adapters.
2. Publish public dominance progress and derive mode-specific win status.
3. Correct the contradictory scoreboard field; keep numeric rendering with the active formatting policy.

**Dependencies:** dominance fields must be classified in `game/cocs-intel.mjs` and covered by protocol/snapshot consumers. Choose additive compatibility explicitly; server-facing snapshot changes need appropriate local/network verification.

**Exit:** a scripted local/online capture-loss-siege-wave sequence renders accurate feedback; dominance survives reconnect and resets correctly; no contradictory result statistics. First-time observers can identify the goal and impending loss without explanation.

### Phase C — Protect control and reduce decision load

**Scope:** F04–F07 and the shared-label portion of F09. **Size:** M–L, split by input, entry and HUD owners.

1. Separate passive viewing from interactive cursor surfaces.
2. Unify effective setup rules and legal recommended targets.
3. Build the objective-first short-screen HUD and explicit tactical view.
4. Route remapped labels through every affected surface.

**Exit:** uninterrupted scoreboard glance and unchanged-loadout respawn; intentional spend shortcuts; correctly previewed entry rules; reachable recommendations; viewport/input acceptance in F07/F09. Test overlapping states such as death during board use and intermission during an armed order.

### Phase D — Improve the learning and return loop

**Scope:** F08 contribution summary and F11 next-match actions. **Size:** M.

1. Add contribution categories from existing authoritative metrics/events.
2. Explain result and reward with one next-action suggestion.
3. Connect retry/rematch/replay/practice actions to the appropriate existing flow.

**Exit:** objective/support players understand their contribution; partial loss still yields a useful report; rewards are idempotent; the desired follow-up match starts with clear rules.

### Phase E — Playtest and tune the highest-cost frustrations

**Scope:** F09 device validation and F10 measured combat/pacing work. **Size:** L, iterative.

Run a bounded baseline and post-change session using the protocol below. Select one or two diagnosed problems per iteration. Record commit, hardware, settings, input and player experience. Retest only the affected scenarios plus relevant mechanics checks.

**Exit:** an evidence report containing both observed behavior and participant feedback, with each balance/pacing adjustment tied to a measured problem. Further content expansion should compete with unresolved comprehension or control failures for priority.

## 6. Meaningful verification and playtest protocol

### Small automated checks for implementation owners

Use targeted behavioral tests at the real seams:

- **Training:** construct a `Match`, feed the page's exact snapshot/event shape through each predicate; include bots satisfying future events early, cut supply, remapped controls, skip/completion and reward exclusion/policy.
- **Announcements:** send the same permitted event stream through local/network HUD adapters; test relevance, priority, expiry and event deduplication across reconnect.
- **Outcome state:** assert dominance progress/threshold/reset and Operations wave/HQ display against authoritative state, including snapshot filtering.
- **Input:** exercise actual overlay transition/router logic, repeat keys, focused selects/chat, Tab viewing and timer-driven respawn. Follow with browser pointer-lock checks because pure state-machine tests cannot prove browser gesture behavior.
- **Results:** render real final actor statistics and check correct mode fields and reward totals. Avoid pinning decorative markup as a substitute for semantic accuracy.

No broad expensive suite is justified by this documentation change. Implementation owners should run the existing focused tests for changed mechanics and add only missing meaningful regression coverage.

### First-time player session

Start with **five participants unfamiliar with this build**, plus two experienced arena-shooter players for control/feel comparisons. This is a formative sample, not a statistically powered balance study. At least one real touch session and one keyboard-remapped session are separate accessibility checks.

Use [`reports/playtest-v8.4-template.md`](../reports/playtest-v8.4-template.md)
to preserve raw task observations, cohort/device settings, distributions,
verbatim answers and the one-factor decision log. An unfilled worksheet or an
automated-only browser gate is not evidence that the human targets passed.

1. Fresh profile: choose and launch an intended first match without coaching. Record clicks, hesitation and effective rules.
2. Training: perform movement/fire, capture, supply, command and traversal; include spend/terminal in Operations. Record each instruction shown, action, completion, stall and skip.
3. Normal play: one short FFA/team fight and one Lattice/Operations session. Include a capture loss, death/respawn and an intermission. Do not prompt players where to look.
4. Results: ask why the match ended, what they contributed, and what they would try next. Offer a voluntary second match.
5. Separately assess demo comfort and spectator target following using the active-task builds.

### Proposed acceptance targets

These are **initial product targets, not measured current results**. Record raw observations and adjust deliberately after the baseline.

| Measure | Initial target / interpretation |
|---|---|
| Goal comprehension | At least 4/5 first-time participants correctly describe the win condition and one useful next action after the opening minute. |
| HUD glance | At least 4/5 identify the imminent dominance loss or HQ siege within five seconds of being asked to inspect the HUD. |
| Instruction-task integrity | Zero required training completions falsely credited to unrelated bot actions; zero unreachable mandatory tasks. |
| Learning stall | No unexplained stall over 30 seconds at a single mandatory lesson; when a prerequisite is unavailable, the UI explains it and offers recovery/skip. |
| First meaningful action | At least 4/5 move, hit a target or enter the intended capture area within 60 seconds of gaining control; distinguish navigation time from reading time. |
| Spend comprehension | At least 4/5 can buy an intended useful sink during their first taught window and state what changed. |
| Control continuity | Zero accidental repeated purchases, stuck inputs or surprise pointer-recapture requirements in the scripted transitions. |
| Result understanding | At least 4/5 correctly state why they won/lost and name a personal contribution from the result screen. |
| Comfort | No critical text clipping or required control hidden at the four target viewports; participants can follow one demo action without reporting disorienting motion. |
| Enjoyment and agency | Ask separate 1–5 questions: “I knew what to do,” “my actions mattered,” “the controls did what I expected,” and “I want another match.” Use comments and observed failures to explain scores; target median ≥4 after iteration. |

For combat tuning, report per-scenario distributions rather than a single average: time to first contested objective, respawn-to-action time, first-three-second repeat deaths, duel TTK by weapon/range, wave completion time, meaningful spending and late-match comeback attempts. Do not infer human fun from AI win rate or infer hardware performance from software-rendered smoke tests.

## 7. Reproducible audit diagnostic

The following bounded diagnostic was run against `371017c`. It changes an in-memory match only and writes no repository files. The front ownership assignment isolates snapshot wiring; it is not a played capture or full-course completion.

```bash
node --input-type=module <<'NODE'
import {Match} from './game/core.mjs';
import {createTraining,evaluateTraining} from './game/lattice-training.mjs';
import {cocsAnnouncement,modeColumns,scoreStats} from './game/hud.mjs';
const match = new Match('chatgpt','openclaw',()=>.5,'lattice-slice',
  {mode:'cocs',botCount:0});
match.objectiveState.nodes.find(n=>n.id==='front-0').owner = 0;
const snapshot = match.snapshot();
const training = {...createTraining('cocs'),index:3,
  completed:['move','fire','capture']};
const run = snapshot => evaluateTraining(training,
  {snapshot,lattice:match.arena.lattice}).training.index;
console.log({rootNodes:'nodes' in snapshot,
  actual:run(snapshot), adapted:run({...snapshot,nodes:snapshot.cocs.nodes})});
console.log(cocsAnnouncement({type:'cocs-capture',team:1,node:'front-0'},
  {id:0,team:0}));
console.log(cocsAnnouncement({type:'director-wave-cleared',wave:1},
  {id:0,team:0}));
console.log(modeColumns('cocs'), scoreStats({frags:7,scoreStats:{}}).frags);
NODE
```

**Observed:** `rootNodes: false`, `actual: 3`, `adapted: 4`; both displayed announcement examples have `mine: false`; the Lattice column requests `frags` but `scoreStats(...).frags` is `undefined`. The page's filter and renderer explain the downstream effects described in F01/F02/F08. Re-run after the relevant active patches; these baseline findings should then become regression checks rather than lingering open issues.
