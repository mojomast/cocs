# COCS — Colosseum Of Competitive Slop

A local Three.js first-person arena-shooter where nine famous language models settle their differences with guns. Select an AI operator, strap on one of seven agent harnesses, choose an arena, and configure a match with zero to sixteen bots (mode-dependent). New setups default to two Easy bots, first to 15 frags or highest score after five minutes. Claude always uses Claude Code; everyone else can equip any harness.

Every operator and harness blurb is affectionate parody — jokes about the vibes and internet lore around each tool, not claims about what they actually do. AI names represent fictional robots, not factual product comparisons.

**Play it live:** https://arena.ussyco.de — **Source:** https://github.com/mojomast/tokenarena (also linked from the in-game menus).

## Live deployment

The production build is served at `https://arena.ussyco.de` from this host (nginx → `vinext start` on `127.0.0.1:3000`, with `/ws` proxied to the Node game server on `127.0.0.1:4000`). Both run as `mojo` user systemd units (`token-arena-web.service`, `token-arena-server.service`). After a successful `npm run build`, restart the web unit so it reloads the bundle and asset manifest; restart the game-server unit only when server code changes, since that disconnects active multiplayer clients. See `deploy/README.md` for the full procedure.

## Run locally

Requires Node.js 22.13+ and npm. Install with `npm ci`, launch with `npm run dev`, then open the URL printed by Vite. Use `npm run build` for the production Worker build and `npm run start` to serve it. In the managed Sites environment, the supervised preview is started with `sites-preview start /workspace/sites/token-arena`.

No API key, downloaded art, inference service or gameplay backend is needed. The hosting adapter serves the application; all match logic and bot decisions run in your browser. Dependencies are bundled by the build.

## Local multiplayer (0.4)

The game server runs on this machine, not on a cloud platform:

| Command | What it does |
|---|---|
| `npm run server` | Start the game server on `ws://localhost:4000` (`PORT` env overrides) |
| `npm run demo` | Headless client that joins, hosts a match and reports snapshots |
| `npm run dev` | Start the web app, then use **04 / MULTIPLAYER → CONNECT & JOIN** |

The web client connects over WebSocket, joins with your current operator/harness/callsign, and the first joiner becomes host. The lobby shows connected players and host controls (mode, bots, rules, arena). The server is authoritative: it runs `Match` at 60Hz, applies each peer's latest input every tick, converts `jump`/`power` presses into one-shot edges, streams `events` deltas per client and broadcasts full snapshots at 20Hz (including the kill feed and rocket positions). The client **predicts your own actor** by running the same `Match` engine locally against your inputs (instant movement, aim and fire feel), reconciles it to every server snapshot, and interpolates remote actors and rockets at a 160ms render delay.

**Disconnects are survivable.** The server issues each join a session token (kept in localStorage, so even a page reload can rejoin). A dropped socket's seat is held for a 20-second grace period: the actor idles, the player shows `DISCONNECTED · SEAT HELD` in the lobby, and reconnecting with the token reattaches the same seat mid-match and resumes play automatically. If grace expires (or you leave explicitly), the seat is handed to a bot named `· BOT` and host duties migrate to the next connected player. Room logic is socket-agnostic (`server/room.mjs`) and fully tested without sockets; `server/network.test.mjs` proves the same flow over real WebSockets with two clients, including the browser-side `NetClient` (`game/net.mjs`).

```text
client → {join(+token), host, start, input, ping, leave}  (JSON over WebSocket)
server → {welcome(+token), lobby, start, events, snapshot, results, error}
```

Not yet included: accounts/matchmaking.

## Play

### Replayability and combat

- **Match Setup > Quick Match Presets:** Warmup (no bots), Casual Skirmish
  (two Easy bots), Duel (one Normal bot), or Rocket Party (three Easy bots).
  Presets reset match rules while retaining your callsign and selected loadout/map.
- **Shuffle Loadout / Map:** roll a compatible operator/harness and arena without
  changing match rules. Claude's harness restriction is always enforced.
- **Next Arena:** after a solo round, rotate to a different map with a randomized
   compatible loadout and the same rules. Play Again keeps the existing setup.
- **Capture the Flag:** choose CTF and Launchpad for a large symmetric arena with
  red/blue bases, steal-and-return flags, trampolines, and boost launchers that
  throw you across the field. Team Deathmatch adds shared team scoring without
  friendly fire.
- **Outdoor CTF arenas:** Skybreak Isles is a wide three-route skyway; Aether Ring
  is a diagonal island loop. Both have separated platforms, huge authored jumps,
  readable safe/risky routes, and a lethal void that drops carriers on recovery.
- **Blood Gulch:** a rebuilt 160×70 m canyon CTF arena modelled on Halo's box
  canyon — a central hill, two diagonal sniper ridges, two wall caves, and
  opposing bases with two ground entrances, ramp-accessible roofs, and roof
  teleporters that launch into the open field. Two neutral Warthogs spawn on the
  flanks; their driver can rotate a 360° turret and splatter infantry at speed.
  Press **E** near one to enter or exit. Flag carriers cannot enter a Warthog.
- **New large CTF maps:** Frostline (snow canyon with a frozen river and ice
  caves), Derelict Station (indoor orbital decks linked by launch lifts), and
  Ashen Rift (asymmetric volcanic high-fortress vs. low-refinery). Each has
  three-lane flow, readable bases, flanking risk routes, and vehicles where the
  theme allows.
- **Expansion maps:** Sunscar Canyon, Ironfall Megastructure, and Longreach Plateau
  add large authored CTF routes with high shelves, broken industrial decks, wide
  causeways, launch links, and control-point-ready layouts.
- **King of the Hill:** capture the central hill, then hold it to earn one point per
  second. Contesting freezes the score; first team to the target wins.
- **Domination:** capture three control zones, neutralize enemy-held zones, and earn
  one point per second for every zone your team owns. Objective state is authoritative
  and visible in the HUD, world markers, snapshots, and match history.
- **Payload:** attackers escort a cart along an authored route across the arena;
  standing with it pushes it forward, checkpoints bank progress, and the defenders
  stall it and roll it back to the last checkpoint. Attackers win on delivery;
  defenders win if the clock runs out. The cart has its own world model, HUD
  brief ("ESCORT / STOP THE PAYLOAD"), and checkpoint scoreboarding.
- Easy and Normal bots now react and turn more slowly, fire less frequently, and
  aim less accurately. Breaking line of sight gives a fresh reaction delay.
  Existing saved difficulty choices are retained; select Casual Skirmish for the
  new beginner-friendly setup.
- **Touch controls on mobile:** a left thumbstick moves (push to the edge to
  sprint), dragging the right side of the screen aims, and an action cluster covers
  fire, ADS, jump, slide, reload, power, use, weapon swap and pause. Touch controls
  switch on automatically on coarse-pointer devices and can be forced from
  Graphics & settings; the layout uses the safe-area insets and disables page
  scroll, zoom and pull-to-refresh while playing.
- **Jumping now supports landing on cover and separated island platforms rather than
  falling into them. Movement checks vertical and horizontal substeps, ramp/deck
  seams, authored boost arcs, embedded states, and deterministic void recovery.
- Weapons have distinct data-driven kick/recovery, tracer/muzzle/impact behavior,
  firing/launch/impact sounds, and dry-fire feedback. These visuals do not
  displace the aiming camera. System reduced-motion preferences disable weapon
  motion and flashes. Hit/kill sounds use confirmed damage events and local-player
  identity, including non-host multiplayer players.
- Map navigation is shared between matches, transient effects and audio voices
  are bounded, and effect resources are reused rather than allocated per pellet.

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Left click / hold | Fire |
| Right click (hold) | Aim down sights (Pulse/Rail/Shock) |
| Shift (hold) | Sprint (and vehicle boost) |
| Ctrl / C (hold) | Crouch; crouch while sprinting to slide |
| Space | Jump — hold to auto-hop / bunnyhop (handbrake while driving) |
| R | Reload |
| 1–9/0; mouse wheel | Switch available weapon |
| Q | Activate harness |
| E | Enter / exit nearby Warthog |
| Tab | Hold scoreboard |
| Escape | Pause and release mouse |

Choose an operator, harness and arena, then Enter Arena. All operators are in an uncropped grid; on small screens, scroll the menu to reach further sections. Graphics & settings includes resolution scale, field of view, crosshair controls, mouse sensitivity and audio mute, saved on this device. If mouse capture is denied, hold left mouse to aim and fire, or use Capture mouse. Keyboard and mouse are required; there are no touch gameplay controls.

 Pulse Rifle has unlimited ammo. Collect orange Rocket Launchers, violet Rail Lances, gold Scatterguns, blue Plasma Drivers, red Grenade Launchers, cyan Shock Beams, and gold Flak Cannons to unlock them with limited ammo. Green crosses restore health and blue diamonds grant armor. Haste, Overcharge, and Overshield pickups temporarily modify movement/fire cadence, damage, or shielding. The Exchange and The Foundry have ramps to a north deck; Crosswire and Citadel use ground-level cross lanes; Launchpad uses trampoline and boost-launcher routes; Skybreak Isles and Aether Ring use disconnected platforms and authored void jumps. Pickups respawn. Death respawns you automatically after two seconds with brief protection; firing or Q ends that protection. Falling on an outdoor island drops a carried flag before respawn.

OpenClaw: close pulse and knockback. Hermes: temporary speed boost and trail. OpenCode: temporary faster firing. Claude Code: temporary 50% damage reduction. Codex: instant health repair. Cline: collision-safe forward dash. Roo Code: a line-of-sight slowing pulse. AI names represent fictional robots, not factual product comparisons.

| Operator | Max / Spawn Health | Spawn Armor | Base Speed (m/s) |
|---|---:|---:|---:|
| ChatGPT | 100 | 0 | 8 |
| Claude | 115 | 10 | 8.2 |
| Grok | 110 | 0 | 8.3 |
| Meta | 100 | 20 | 7.6 |
| Gemini | 95 | 10 | 8.5 |
| DeepSeek | 120 | 0 | 7.4 |
| Mistral | 85 | 0 | 9.4 |
| Kimi | 90 | 15 | 8.7 |
| Qwen | 100 | 5 | 8.4 |

Claude receives a modest stat bonus because its harness is locked to Claude Code. Every respawn restores the operator's health and starting armor. Health pickups, Codex repair and life steal cap at that operator's maximum health; armor pickups still cap at 100. Base speed multiplies the match speed setting, the operator/harness passive, Hermes rush (1.6x) and Roo slow (0.55x). Harness profiles also affect resistance, favored-weapon handling and bot decision style; operator profiles affect bot weapon preference and strafing. Weapon damage is shared except for small favored-weapon affinity bonuses, and Instagib remains lethal to every unprotected operator. Multiplayer assigns loadouts before spawning and snapshots carry `maxHealth` and `moveSpeed` for local prediction.

## Architecture

- `app/page.tsx`: game state menus, HUD, input, audio events and fixed-step accumulator. Rendering is RAF-driven; simulation advances at 60Hz with five-step catch-up bound.
- `game/hud.mjs`: pure HUD derivations — vehicle prompts, reload/crosshair/ammo helpers, kill banners, the match/objective announcer, killstreak and multikill callouts, and post-match superlatives.
- `game/radar.mjs`: pure yaw-relative projection of actors, objectives and flags onto the tactical radar, plus the default and colorblind palettes.
- `game/data.mjs`: roster, ten weapons, three powerups, harness parameters, weapon feel metadata and loadout validation.
- `game/character-anim.mjs`: engine-free procedural character animation — damped gait phase, bounded pose solver and the joint rig used by the renderer, plus the bot facing helpers.
- `game/levelgen.mjs`: deterministic next-generation level generator — heightfield terrain, cliff faces, buildings/tunnels/caverns/bridges and props, emitted as the existing map schema plus a smooth visual layer.
- `game/nextgen-maps.mjs`: one generated map per game mode; the legacy arenas are unchanged.
- `game/harness-profiles.mjs`: bounded harness passives, ability parameters, weapon affinities and bot hints.
- `game/operator-profiles.mjs`: operator combat identities and bot weapon preferences.
  - `game/maps.mjs`: canonical arena registry, CTF bases, polygon terrain, collision geometry, traversal routes, vehicles, spawns, supplies, expansion maps and CTF maps.
  - `game/blood-gulch.mjs`: the rebuilt Blood Gulch heightfield arena — central hill, sniper ridges, wall caves, multi-route bases and roof teleporters.
  - `game/ctf-maps.mjs`: three large CTF arenas (Frostline, Derelict Station, Ashen Rift) with authored three-lane layouts and routes.
  - `game/expansion-maps.mjs`: three large outdoor/industrial arenas with authored routes and control-point coordinates.
  - `game/terrain.mjs`: deterministic triangle support, ray hits, cliff wall segments and terrain bounds.
  - `game/vehicles.mjs`: Warthog-style arcade handling — engine/drag, speed-sensitive steering, lateral-slip drift, handbrake, boost, four-wheel suspension/slope alignment, body roll/pitch, a 360° turret, paired-muzzle heat, enter/exit and respawn primitives.
  - `game/core.mjs`: authoritative match state; Quake/Source-style movement with sprint/crouch/slide, analytic collisions; recoil/bloom/reload gunplay and ray/swept projectile combat; terrain, Warthog vehicles, run-over damage, armor, powers, pickups, CTF/KOTH/Domination scoring, respawn and bot utility/navigation.
  - `game/view.mjs`: Three.js procedural arena with shadowed IBL lighting, procedural textures, sky/backdrop/scatter, tiered postprocessing, polygon terrain, the Warthog model, control-zone markers, first-person weapons, effects and synthesized Web Audio.
  - `game/textures.mjs`: deterministic value-noise/FBM canvas albedo/roughness/normal texture generation with caching.
  - `game/environment.mjs`: gradient sky dome, instanced distant mountains and instanced terrain scatter.
- `game/software.mjs`: CPU renderer of the same scene for browsers where WebGL2 is unavailable. This fallback is approximate and slower and disables shadows/postprocessing; hardware WebGL2 is the preferred path.
- `game/core.test.mjs`: consequential pure-logic checks and deterministic bot match.
- `game/net.mjs`: browser-side NetClient — WebSocket protocol, sequenced 60Hz inputs, a shadow `Match` that predicts your own actor and replays unacknowledged inputs after authoritative snapshots, adaptive ~100 ms server-time interpolation for remote actors and rockets, event accumulation and the render-state adapter for `ArenaView`.
- `server/room.mjs`: socket-agnostic multiplayer room; joins, host control, sequenced per-peer input with one-shot edges (including reload), per-actor input acknowledgements, 60Hz authoritative tick, event deltas and a configurable 30 Hz snapshot broadcast.
- `server/rooms.mjs`: room registry — one default `local` room plus rooms created on demand with a collision-checked 4-letter code; drives tick/grace/drain across every room and retires empty on-demand rooms.
- `server/history.mjs`: per-server match history — every completed match recorded as `{id, roomId, mapId, mode, fragLimit, timeLimit, endedBy, duration, leader, players}` and persisted atomically to a JSON file (default `server/history.json`, capped at 50 entries, path injectable).
- `server/game-server.mjs`: Node HTTP/WebSocket entry point for this machine.
- `SPEC.md`: complete intended design, with MVP and POST-MVP labels.
- `DEVPLAN.md`: implementation and verification status.
- `VERIFICATION.md`: evidence and remaining validation limitations.

React receives HUD snapshots at about 10Hz. A renderer never decides damage or scoring. All bots use the same movement/combat/power/pickup rules as the human. Restart constructs a fresh Match and disposes match visuals. One input-listener set and one animation loop live for the page lifetime and are cleaned up on unmount.

For read-only debugging, `window.tokenArenaSnapshot()` reports state and rendering counters. The canvas `data-snapshot` attribute contains the latest HUD/simulation snapshot for DOM-based test tools. This is local game data only.

## Verify

`npm run test:game` runs the game, expansion, configuration, multi-human, prediction, content, map, mode, powerup, replay and renderer tests; `npm run test:server` runs the room, registry, spectator, history, chat and network tests. `npx tsc --noEmit` checks TypeScript. `npm run build` verifies the production bundle. See VERIFICATION.md for browser evidence and gaps; do not equate a passing simulated match with GPU performance verification.

## Scope boundary

Version 0.4 adds playable local-network multiplayer: per-actor human inputs in `Match`, a Node game server (`server/`) authoritative over rooms, a browser client (`game/net.mjs` + lobby UI) with client-side prediction and reconciliation, and session-based reconnection with bot handoff and host migration.

Version 0.5 adds a room browser over concurrent rooms (join or create a 4-letter-coded room from the selection screen), spectator mode (no seat, no inputs, full snapshot/results feed, WATCH from the browser), and per-server match history persisted to `server/history.json` and rendered as a recent-matches panel. Matchmaking and accounts remain future scope. SPEC.md preserves the baseline and documents the authorized expansions.

Version 0.6 fixes two multiplayer bugs and adds room chat. `create` always mints a fresh 4-letter room — it can no longer silently route into a previously persisted room — and abandoned on-demand rooms are retired after their grace period so the browser list stays honest. `{type:'chat', text}` broadcasts room-scoped messages (control chars stripped, trimmed, capped at 200 characters, rate-limited to one per 300ms per peer) to players and spectators alike, rendered as a lobby panel and a bottom-left in-game overlay (`T`/`Enter` opens the input, `Enter` sends, `Escape` closes; solo play is untouched).

Version 0.7 reorganizes the first screen around game-menu best practices: the selection screen is now identity-focused (operator + harness + preview) with a persistent action bar — a dominant `ENTER ARENA` primary action, `PLAY ONLINE` (opens the room browser, becomes DISCONNECT while connected), `MATCH SETUP`, and a settings gear. Arena and match rules moved behind the `MATCH SETUP` dialog (progressive disclosure, `< 3 clicks` to everything, Escape closes any overlay), and the multiplayer server address is tucked into the room browser behind a compact row with a QUICK JOIN shortcut. Solo behavior, the original menu layout and network flows remain available alongside the expanded content.

Version 0.8 adds the Launchpad and Citadel arenas, Capture the Flag and Team Deathmatch, eight total weapons, Haste/Overcharge/Overshield pickups, trampoline and boost-launcher traversal, objective-aware bots, and bounded projectile handling. Launchpad is the recommended CTF map: its opposing launchers cover the centerline and its four trampolines reward aggressive flag routes.

Version 0.9 adds Skybreak Isles and Aether Ring, two much larger outdoor CTF arenas built from disconnected platforms over a lethal void. Authored jump links give bots deterministic high-speed routes, while the renderer shows platform slabs, supports, route colors, void depth, and launcher markers. Multiplayer inputs now carry sequence numbers; server snapshots acknowledge processed inputs so the client can rebase and replay instead of visibly rolling back on every snapshot. Remote interpolation uses server simulation time and a deeper jitter buffer.

Version 1.0 tunes launcher traversal from authored source-to-target ballistic links with bounded air correction and descending landing capture, so island jumps stop overshooting. Weapon feedback is now data-driven across all eight weapons with distinct kick, muzzle, tracer, impact and synthesized audio profiles, plus dry-fire cues. Harness profiles add passive movement/resistance and weapon affinities; operator profiles add bot weapon and strafe identities while preserving deterministic simulation and bounded balance modifiers.

Version 1.1 adds Blood Gulch: immutable triangulated terrain supports interpolated valley floors, hills, walkable slopes and analytic cliff ray hits while preserving legacy box maps. Two neutral Puma vehicles spawn near the opposing bases; one driver can use forward/reverse arcade handling and paired side-mounted chainguns with authoritative heat, damage, destruction and respawn. Puma state is included in snapshots and local prediction, and `E` is a one-shot enter/exit input in multiplayer.

Version 1.2 adds three large expansion maps, King of the Hill, Domination, authoritative control-point snapshots/events, world-space objective markers, objective-aware bots, objective-aware history, and a tactical HUD command layer that calls out the current team, score target, zone/flag state, route, and next action.

Version 1.3 is the "make it not feel generic" pass, driven by research into Quake/Source movement, browser-shooter netcode, the Halo M12 Warthog, Blood Gulch/CTF level design, and Three.js rendering budgets:

- Movement is rebuilt on a Quake/Source ground-friction + acceleration model with air acceleration (strafe jumps build speed), variable jump with apex hang, plus sprint, crouch and a momentum-preserving slide. Coyote time (.10 s) and jump buffering (.12 s) remain.
- Gunplay adds authoritative recoil aim-punch with per-weapon spray patterns, bloom spread that grows while firing/moving and recovers at rest, ADS (spread/sensitivity), reload plus auto-reload, weapon holster/raise timing, and retuned per-weapon recoil/bloom/reload data. Recoil and crouch now move the first-person camera, and the HUD shows a spread-driven crosshair, hitmarker, reload bar, posture chip and low-ammo warning.
- The Puma is now a recognizable Warthog with a roll cage, open bed, corner off-road tires and a 360° turret, driven by arcade physics with lateral-slip drifting, handbrake, boost, suspension/slope alignment and body roll/pitch; fast-moving vehicles splatter infantry.
- Blood Gulch is rebuilt to a faithful 160×70 m box canyon, and three new large CTF maps (Frostline, Derelict Station, Ashen Rift) join the roster.
- Rendering gains directional shadows, a PMREM image-based environment, deterministic procedural FBM textures, vertex/triangle color variation, a gradient sky with an instanced mountain backdrop and terrain scatter, and tiered bloom/vignette/SMAA postprocessing (all bypassed by the CPU fallback and reduced-motion).
- Online play cuts interpolation delay from 160 ms to an adaptive ~100 ms, adds a jitter-adaptive snapshot buffer, raises server snapshots from 20 Hz to 30 Hz, and forwards the new stance/ADS/reload inputs.

Version 1.4 is a feedback-and-flow pass:

- Combat feedback the game was missing: floating damage numbers, a directional damage indicator, kill/death banners, a weapon/ammo panel with auto/semi and reload state, and a match/objective announcer (`FIGHT · MODE · MAP`, `RED/BLUE SCORES`, `FLAG CAPTURED`). All driven by existing snapshot/event data with pure, tested helpers.
- Renderer feel: dynamic FOV (sprint widens, ADS narrows), pooled muzzle lights, a low-health screen overlay, and bounded camera shake on damage/death — all suppressed for reduced motion and the CPU fallback. Shared material/geometry caches cut per-model allocation and GPU state changes.
- Bot AI: scan range now scales with map size and difficulty, bots always have a purposeful destination (objective or patrol), CTF defenders hold a post near their flag and attackers vary their approach, and long rotations detour to nearby vehicles. Large maps now produce kills and completed matches instead of 0–0 stalls.
- The pre-existing Ironfall Megastructure and Longreach Plateau maps gained physical up/down return routes so their full bot-navigation graphs connect in both directions (previously stranded upper shelves).

Version 1.5 fixes bunny-hopping and upgrades the sound:

- **Bunny-hopping works now.** Holding jump auto-hops, and a held or buffered hop skips the landing frame's ground friction, so chained hops keep their momentum instead of bleeding ~10% per landing. Air acceleration is retuned (`airAccel 3.5`, `airCap 1.6`, terminal ×2.2) so strafe jumping turns speed into gains; forward hops preserve cruise speed.
- **Richer synthesized audio.** Gunshots are now layered (filtered noise transient + tonal body + sub thump) with per-weapon character (rifle/heavy/zap/burst/plasma), plus improved explosions, reload clicks, weapon-switch, hit and kill feedback, footsteps and landing thuds, and a speed-tracking Warthog engine. Positional sounds use distance falloff and stereo panning.

Version 1.6 adds a cinematic demo system and a living main menu:

- **Theater (demo recording and playback).** Every solo and network match you finish is recorded automatically as compact keyframes (18 Hz, rounded, gzip-ready). Open **THEATER** from the loadout to replay any recording, scrub the timeline, change speed, and watch with **cinematic cameras**.
- **Variable camera angles.** A camera director offers seven rigs — orbit, chase, dolly, crane, tripod, follow and first-person — and auto-cuts to kills, explosions and captures. Pick a rig with `1`–`7` or the on-screen chips, cycle subjects with `[` / `]`, and play/pause with `SPACE`.
- **Live menu showcase.** The main menu now renders a real bot match behind the UI, auto-directed by the same camera system, with the selected operator's 3D model composited into the customization panel. Toggle it under Graphics & settings → **Menu showcase**.

Version 1.7 gives every bot a distinct brain and rebalances objective modes:

- **Different bots play differently.** Each bot blends its operator `role` (adaptive, anchor, disruptor, connector, duelist, ambusher, flanker, orbiter, optimizer) with its harness `personality` (brawler, skirmisher, suppressor, sentinel, opportunist, flanker, controller) plus a stable per-slot jitter. A seven-bot match now fields seven distinct behavior profiles that choose different engagement ranges, aggression, flanking, supply priority and vehicle use.
- **No more pile-ups.** Bots steer apart (`separation`), take distinct perimeter slots around objectives, spread across supplies, and deprioritize targets their teammates are already fighting. Aggressive bots push while defensive bots hold.
- **Harder to hold ground.** A contested objective now decays the holder's control toward the challenger instead of freezing, so a lone camper can no longer lock a hill. Scoring still only accrues while a team holds the zone uncontested.
- **Attackers keep pushing.** Bots now keep advancing on objectives while shooting instead of stopping to duel, which keeps CTF/Domination games flowing.

Version 1.8 rebuilds the arena and mode layer and adds traversal v2:

- **An arena framework.** Every map now carries a group (urban, indoor, outdoor, island, vehicle, combined), a scale, a mode whitelist, a recommended bot count and a `legacy` flag (`game/arenas.mjs`). The map picker, shuffle and "next arena" all respect the selected mode and hide archived maps unless **Legacy arenas** is enabled in Graphics & settings.
- **Archived arenas.** The original compact arenas (Exchange, Crosswire, Foundry, Launchpad, Citadel, Blood Gulch) are marked legacy and no longer appear by default, while remaining in the rotation for anyone who turns the toggle on.
- **Traversal v2.** Alongside trampolines and boost launchers, maps can now author **jump pads**, **ziplines** (ride the cable to a far anchor) and **teleporters** (paired pads that bots can path through). All are simulated deterministically, rendered, and covered by tests.
- **New maps.** *Neon Vertical* (urban rooftops with jump pads and ziplines), *Substation 7* (enclosed indoor facility under a ceiling), and *Warfront Delta* (a wide combined-arms battlefield with four Puma slots).
- **Combined Arms mode.** A team objective mode built for the largest maps with up to **16** bots (per-mode `maxBots`), plus animation of every mode's objectives.
- **Per-mode rosters.** Bot count now scales per mode (8 standard, 16 for Combined Arms) and the setup slider follows it; the menu showcase picks a map by group and a matching bot count.

Version 1.9 adds air combat:

- **The Hornet.** A second vehicle chassis with true flight: throttle, steering, boost, vertical lift (jump climbs, crouch descends), hovering, a ceiling, graceful pitch/roll and paired nose guns. It only appears on the largest combined-arms map.
- **Skyfall Basin.** The biggest arena yet: fortified bases, a central mesa, four flak towers, armour lanes and two Hornet pads per side, built for 16-bot Combined Arms.
- Bots flying a vehicle now fire the mounted gun, and vehicle entry accounts for altitude so ground units cannot board a Hornet in flight.

Version 2.0 adds progression, unlocks and gear:

- **XP and ranks.** Every completed match awards XP for frags, objective play and winning. `game/progression.mjs` owns a deterministic XP curve, level rewards and six rank titles (Recruit → Mythic), shared by the client and the game server.
- **Unlocks.** Eight gear pieces and three weapon finishes unlock as you level, shown on a new **Rank** screen with your level, XP bar and career stats.
- **Gear for Combined Arms.** Equip one item per slot (weapon kit, armour, utility) to tweak health, armour, speed, damage and spread. Gear is applied to your actor on solo and hosted matches.
- **Server persistence.** A stable local player id is sent on join; `server/progression.mjs` stores XP, levels, unlocks and saved gear to a JSON store (like match history), awarding results authoritatively at match end and pushing a `progression` update to each player.

Version 2.61 is a bug-fix pass over the new systems: Arms Race keeps ladder progress across respawns and ignores weapon pickups; bounty frags can no longer end an Arms Race; random loadout works with unlimited ammo; simultaneous objective score ties are no longer awarded to team 0; assault breaches no longer inflate the scoreboard; death and falling clear traversal/streak state; keybind normalization can no longer create duplicate keys (reserved shell keys are rejected, voice is remappable, and the in-game legend follows your binds); plus a grenade press-latch, fall streak reset and spectator/radar fixes.

Version 2.60 adds **remappable controls**: every action (movement, jump, sprint, crouch, reload, melee, frag, ability, interact, voice) can be rebound in Settings with duplicate detection and a one-tap reset. Bindings persist on the device.

Version 2.59 improves spectating: a target board lists every live actor for one-tap following, **P** switches between first- and third-person, and **H** hides the HUD for a clean view.

Version 2.58 adds **loadout presets**: save your operator, harness, arena and match rules by name, then recall or delete them with one tap. Presets persist on the device and validate against the current roster.

Version 2.57 adds the **Cloak** powerup: for a few seconds bots cannot acquire you at range and you drop off enemy radar except up close (Recon still reveals you).

Version 2.56 adds two more mutators: **Bounty** (ending an enemy on a three-plus streak heals you and grants a bonus frag) and **Berserk** (+20% damage while you are on a three-plus streak).

Version 2.55 adds HUD readouts for the new systems: an Arms Race ladder chip (current rung of the weapon rack) and a killstreak chip from two kills up.

Version 2.54 adds a first-run **coach**: a short, dismissible walkthrough of movement, combat, objectives and settings. It is shown once and remembered on the device.

Version 2.53 adds **Arms Race** — a gun-game mode where every kill promotes you to the next weapon in the rack and finishing the last gun wins. It ships with a new compact map, **Proving Grounds**, and locks the weapon so the ladder is the only way forward (bots included).

Version 2.52 adds the **Recon Pulse** radar powerup: while active it reveals every enemy on your team radar regardless of distance, shown as a rim-clamped blip.

Version 2.51 adds a reward loop, two mutators and accessibility options:

- **Killstreaks.** Three kills restores health and ammo (Scavenger), five grants Overcharge, and seven grants an Overshield, announced in the HUD. Dying or respawning resets the streak.
- **Mutators.** Optional match rules for a **random starting weapon** each spawn and **one-shot kills** (any unprotected hit eliminates).
- **Audio captions.** A caption strip narrates gunfire, explosions, reloads, pickups, objective events and eliminations for players who cannot rely on audio.
- **HUD clarity.** Toggle the kill feed, damage numbers and radar independently.

Version 2.50 polishes the new frag with a HUD chip on **G** that reads FRAG READY or counts down the cooldown.

Version 2.49 adds new ways to play and to aim:

- **Thrown frag grenade.** Every operator carries a cooldown-gated frag on **G** (and a touch button). It arcs, bounces, and detonates on a fuse; bots throw it too, and it cannot be used while driving.
- **Sudden death.** An opt-in match modifier: if the clock runs out level, play continues until the next score decides it (bounded window). Assault and Payload still resolve to the defenders on the clock.
- **Blast fairness.** Point-blank explosions ignore thin cover so a frag at your feet hurts, while longer-range splash still requires line of sight.
- **Look controls.** Invert vertical look, a separate ADS sensitivity, and a touch sensitivity slider join the display settings.

Version 2.48 is a broad integrity pass across simulation, bots, rendering and networking:

- **Payload routes are honest.** A route waypoint can no longer collapse onto the start (which awarded a checkpoint — and score — with zero push, trivially winnable on some maps), and every path point sits on the terrain so the cart is not buried underground.
- **Mode resolution is correct.** An assault objective win on the final tick is no longer overwritten by the clock; a same-frame KOTH/Domination score-limit tie now awards the higher score; capture zones are placed on unobstructed, navigable ground with a finer search.
- **Vehicle crews behave.** An orphaned bot gunner dismounts instead of freezing for the rest of the match; mounted bots no longer fire their personal weapon; a mounted actor cannot carry the flag; exiting a flying vehicle keeps the actor aloft instead of teleporting to the ground; empty vehicles keep their crew team for friendly-fire protection.
- **Rendering lifecycle.** CTF flag geometry is no longer reused after disposal across map changes; flags follow the colourblind palette; the low-health overlay is disposed exactly once; the cinematic director honours the in-app Reduce Motion setting.
- **Networking.** A reconnect racing the old socket now reattaches the seat (newest connection wins); the client tolerates malformed protocol frames; the reload edge is cleared on every lifecycle transition; match history records the map actually played; backpressure queues are room-tagged; per-room expiry is isolated.
- **HUD/animation.** Spectator cycling no longer skips the first live actor; turn banking twists the chest.

Version 2.47 puts capture points where players can actually reach them:

- **No more stranded hills.** Next-gen bridges and catwalks are solid, unclimbable columns (there is no step-up), so capture points authored on them could never be taken — King of the Hill on Frost Gate, Slagworks, The Forge and Convoy Line had no scoring at all. Capture zones are now nudged onto clear ground and snapped to the nearest navigation node when a match starts.
- King of the Hill now scores on Frost Gate, The Forge, Slagworks, Convoy Line and The Catacombs; Domination center points on those maps are contestable instead of unreachable.

Version 2.46 opens up Titan Valley and tightens objective play:

- **Titan Valley is traversable again.** Its central tunnel ran the full width of the map and, with the flanking base bunkers, walled the northern half off. Four of ten team spawns, two of three capture points and three of six vehicles sat outside the navigation graph, so Combined Arms produced zero shots. The tunnel is now a shorter central passage, reconnecting the map.
- **Bots dismount stuck vehicles.** A bot driver that cannot make progress for three seconds exits and continues on foot (with a five-second re-board cooldown), instead of grinding against terrain for the whole match.
- **Teams defend their objectives.** In King of the Hill, Domination and Combined Arms the closest teammate holds any owned-but-empty capture point, so a side stops abandoning a hill the moment it flips.

Version 2.45 puts every capture point on solid ground:

- **No more buried hills.** Procedural levels now nudge a capture zone that generated inside a rock or building to the nearest clear ground before cover and supplies are placed. This fixes the colosseum, riverbend and titan-valley objectives; deliberate raised bridge/catwalk centres are left untouched.

Version 2.44 tightens settings consistency:

- **Unlimited ammo is a real choice in every mode.** The modifier is no longer force-disabled outside Deathmatch; the toggle now reflects and controls the actual setting (matching how the README documents it).
- **Typecheck clean.** Fixed a missing bot field in the showcase spawn path that the 2.40 hardening introduced.

Version 2.43 adds a spawn safety net:

- **Never spawn inside geometry.** If the chosen spawn point is obstructed (a blocked authored marker, a bad map sample), the match nudges the actor to the nearest clear navigation point, so no mode can strand a player or bot inside a wall.

Version 2.42 stops bots churning in vehicle seats:

- **Ride like a crew, not cargo.** Bots now board only when a driver or gunner seat is free. Combined with the earlier passenger bail-out this removes the enter/eject loop and keeps gun crews fighting (Blood Gulch CTF shots up ~80% across the same window).

Version 2.41 gives bots a reachable objective slot:

- **No more stalled captures.** When an objective marker sits inside a wall, under a bridge deck or off the nav grid, bots now retarget a nearby standable spot (checking the zone centre, then nearby nav nodes, then a widening ring) instead of pressing into the blocked centre.

Version 2.40 hardens game modes and bot behavior:

- **Correct endings.** Assault now ends the moment attackers capture the configured sector count (it previously kept running and handed the clock win to the defenders), and payload ends on a score-limit checkpoint win too. A zero-frag free-for-all is a draw instead of awarding everyone the win bonus, and payload routes can no longer go non-finite or deliver instantly.
- **Bots play the objective.** Mounted bots no longer retarget the vehicle they are riding (which parked them permanently on vehicle maps), bot gunners now fire the mounted gun, unreachable routes no longer shadow the destination, the ledge guard is armed from spawn, passenger bots bail out, Roo no longer jams teammates, personality strafe actually varies, and suppression now widens aim error and pushes bots toward cover.

Version 2.39 moves the Titan Valley vehicle spawns onto clear ground:

- **No more clipping at spawn.** The two Pumas that sat inside the small valley buildings, the two parked in the cavern wall rings, and the Hornet stuck in cover now spawn at clear coordinates verified against collision (with margin).

Version 2.38 supercharges the Puma's mounted chaingun:

- **Much faster, never overheats.** Fire interval drops from 0.12s to 0.045s (~2.7x) and heat/overheat are removed, so it lays down unlimited sustained fire. Dual barrels unchanged, so expect roughly double the old damage output.
- **Heavier voice.** `vehicle-shot` no longer borrows the pulse-rifle sound; a dedicated layered chaingun report (low thump, metallic crack, spinning-barrel pitch wobble) plays with its own longer falloff.

Version 2.37 is a correctness pass:

- **Movement and spawns.** Team-only maps (Riverbend, Convoy Line, Titan Valley and friends) no longer collapse teamless modes onto a single origin — free-for-all spawns are derived from the navigation graph, so Deathmatch/Instagib/Rockets/Arsenal start with ten valid spawns and stay mobile. Airborne actors no longer snap down onto solid cover (jumps keep their apex), and an idle touch joystick no longer suppresses WASD.
- **Vehicles.** Gunners keep independent aim, rockets strike vehicle bodies (respecting own/friendly-vehicle rules), the mounted gun no longer advances heat/cooldown twice with a gunner aboard, and destroyed or respawning wrecks reject entry.
- **Networking.** Reconnects dispose the previous socket and ignore stale callbacks, and the prediction shadow rebases its clock to the server so prediction no longer times out mid-match.
- **Server resilience.** Persistence failures retry with backoff instead of aborting the round, malformed-message replies are bounded and repeat offenders dropped, and essential lobby/start/results messages survive backpressure.
- **Results and history.** Assault, Payload and Combined Arms award and record by the authoritative winner, and a timed team match records `time` instead of a score-limit ending.
- **Rendering.** Cavern openings line up with collision, post-processing disposes its passes and applies device pixel ratio once, and the in-app Reduce Motion toggle drives the renderer and menu showcase.

Version 2.36 cleans up the cavern tunnels:

- **Arches, not buried pipes.** Tunnels were full tubes centred above the terrain, so their lower half sank into the ground (z-fighting and shimmer along the length) and their tops poked through the dome shells. They now render as open stone arches that follow the terrain — the path is resampled against the heightfield and a semicircular cross-section is extruded along it — resting on the ground and tucking under the dome walls. Tunnel self-shadowing is disabled to remove shadow acne on the double-sided surface.

Version 2.35 gives the arena tour interior awareness:

- **It flies inside.** The director now receives the arena's structure volumes — buildings, caverns and tunnels — and when the densest action cluster is inside one, it shrinks its orbit and drops to eye level inside that room, cavern or tunnel instead of circling the roof. When the fight moves back outside, it eases back out. An 0.8s hysteresis hold stops it flickering between indoor and outdoor framing at a doorway.
- **Pure volume math.** `game/interiors.mjs` turns buildings into inset rotated boxes, caverns into cylinders and tunnels into capsule segments, and picks the containing volume with the least clearance.

Version 2.34 makes the arena tour follow the fight:

- **Orbits the action, not the arena.** The flyover camera now circles the live action cluster instead of the arena centre (which is often a central building or rooftop), so the fight stays framed. It sits at a tighter radius (~16–30m) and higher altitude to look over low cover.
- **Densest-cluster aiming.** The action point is the centroid of the largest cluster of nearby live actors — falling back to the global centroid when everyone is spread out — eased over time, instead of the average of every bot. A couple of duels off in one corner now draw the camera instead of a rooftop at map centre.

Version 2.33 steadies the arena tour:

- **No more zoom pumping.** The flyover orbit radius is now nearly constant (a gentle ±12% weave instead of ±26%), the tour field of view is fixed at 72°, and the occlusion pull-in is disabled for tours — the high flyover doesn't need it and it was dollying the camera toward cover. Non-tour playback keeps a smoothed, asymmetric pull-in for real camera-behind-cover moments.

Version 2.32 turns the menu reel into an arena tour:

- **The camera flies the arena, not a bot.** The showcase now uses a free-flying `flyover` rig that orbits the whole battlefield on a smooth looping path — weaving its radius and height — and always aims at the live action centroid rather than a specific actor. With no target binding and cuts disabled during a tour, the camera stops jumping between bots.
- **Smooth aim.** The action point is a centroid of the live actors with an exponential ease, so deaths and respawns slide the view instead of yanking it; the occlusion pull-in now rays from that point.
- The flyover rig is reserved for tours, so normal Theater playback keeps its existing rigs and cuts.

Version 2.31 stops the demo camera flickering:

- **No more pose alternation.** The 2.30 occlusion correction was throttled, so on blocked shots the camera jumped between the director pose and the pulled-in pose at ~30 Hz. It now evaluates every frame and eases a single stand-off distance toward the clear or blocked value (snapping only on a cut), so the camera slides in and out of cover instead of flickering.

Version 2.30 keeps the demo camera out of walls:

- **Camera line-of-sight.** The menu director now casts a ray from the followed actor back toward the camera and, when scenery blocks the view, pulls the camera in front of the obstruction and re-aims it — so orbit, tripod and dolly shots stop ending up behind walls, roofs and domes. The clamp math is the pure, tested `clearCameraPosition` helper (`game/camera.mjs`).
- **Closer, steadier rigs.** The showcase orbit radius dropped from 16 to 11, and rig weighting now favours chase/follow/crane over ground-level tripod/dolly, so cuts spend more time on readable subjects.

Version 2.29 trims the cavern tunnel visuals:

- **Tunnels meet the domes.** Tunnel tubes were built centre-to-centre, so they pierced through the new cavern walls. Each tube endpoint that lands on a cavern is now trimmed back to that cavern's radius, so tunnels visibly terminate at the wall like real entrances instead of passing through the shell.

Version 2.28 fixes the next-gen cavern domes:
- **Domes no longer look connected.** A cavern used to render as a single floating hemisphere whose rim hovered partway up the wall (open all the way around), with each tunnel a full closed tube — so on **The Catacombs**, where five caverns are joined by four tunnels, the shells read as one merged mass. Caverns now render as a stone drum split into two wall arcs with two opposite entrances, capped by a dome seated on the wall top, and tunnels read as separate covered passages.
- **Visible openings match collision.** The wall arcs are derived from the same entrance rule the generator uses for its hidden collision ring (`game/structures.mjs`), so the gaps you see are the gaps you can walk through.
- Cavern, tunnel, column and rock surfaces no longer force the shared stone material double-sided.

Version 2.27 makes the main-menu demo reel actually show the game:

- **The weapon effects were missing.** The menu showcase handed the renderer a `Match.snapshot()` — which never carries the simulation's event stream — and reset the renderer's event cursor to zero, so muzzle flashes, tracers, explosions, rail beams, jump-pad bursts and death animations never played behind the menu. The demo now forwards the live event list and the true serial cursor, so the same effects used in a real match play in the menu, and the camera director sees kills, explosions and captures to cut toward.
- **More scenarios.** The reel grew from two demos to six: **Combined Arms** (vehicles and aircraft), **Instagib** (rail beams), **Rocket Arena** (splash explosions), **Capture the Flag** (flag runs), **Payload** (the escort cart) and **Assault** (sector breaches). Rounds are shorter and cuts come every 2.1s, so the menu cycles through the game's modes and features.

Version 2.26 lets spectators choose who to watch:

- **Follow cycling.** In a spectated match, `[` and `]` cycle the camera through the live players, and the `FOLLOWING <name>` readout tracks the selection. Dead players are skipped, and the target resets when a new match starts. The selection logic lives in the pure `spectateActor`/`nextSpectateTarget` helpers in `game/hud.mjs`.

Version 2.25 adds a manual reduce-motion option:

- **Accessibility toggle.** Graphics & settings gains a **Reduce motion** switch that trims camera shake, animated menus, the radar sweep and decorative effects even when the operating system does not request reduced motion. It is stored with your display preferences (`game/config.mjs`) and folds into the same `reducedMotion()` check the renderer already uses.

Version 2.24 bounds multiplayer input flooding:

- **Per-peer input budget.** The server accepts at most 120 game inputs per peer per second and drops the excess before any simulation work (`server/room.mjs`). Legit clients send at 60 Hz, so the cap is invisible in normal play but stops a flooding client from forcing unbounded simulation work. The window resets on reconnect.

Version 2.23 shows your connection quality online:

- **Latency chip.** Network matches display a colour-coded `GOOD` / `FAIR` / `POOR` chip with the current interpolation delay, graded from the same jitter and packet-loss estimators the netcode already uses (`connectionQuality` in `game/hud.mjs`). It turns amber or red before the connection becomes unplayable.

Version 2.22 adds a melee attack:

- **Point-blank finisher.** Every loadout can now swing a short forward arc (`F`, or the touch `MELEE` button): 2.4m range, 45 damage, 0.6s cooldown, no ammo. It rewards closing the distance and finishing hurt targets instead of reloading into them.
- **Simulated and networked.** The swing is authoritative in `game/core.mjs`, gated by line of sight and the attacker's arc, consumes spawn protection, and emits a `melee` hit/whiff event. Bots swing at point-blank visible targets. Multiplayer forwards it as a consumed one-shot edge (hold does not repeat), and the on-screen controls drive the same pure action mapping.

Version 2.21 tells you what killed you:

- **Kill feed weapons.** Every kill-feed line now names the weapon used (`PULSE`, `RAIL`, `SCATTER`, …) between killer and victim. Void deaths stay weaponless. The label comes from the pure `killFeedWeapon` helper in `game/hud.mjs`, fed by the weapon index already carried on death events.

Version 2.20 makes weapon range legible:

- **Range badges.** Graphics & settings now labels every weapon with its range band and effective distance — `SHORT · 6–24m · 40%`, `LONG · 16–70m · 62%` — derived by the pure `weaponRangeInfo`/`weaponRangeLabel` helpers in `game/hud.mjs`, so the falloff added in 2.15 is visible when picking a loadout.
- **Touch controls documented.** The in-game control reference gains a mobile row describing the stick, look surface and `TALK`.

Version 2.19 improves the mobile touch controls:

- **Right-zone look, no dead zones.** The drag-look surface is constrained to the right side of the screen, so the left-hand HUD and thumbstick are no longer covered by an invisible touch target.
- **Push-to-talk on mobile.** A `TALK` button joins the action cluster and drives the same voice push-to-talk gate as the `V` key; long-press context menus are suppressed while playing.
- **Tested action mapping.** The button behaviour lives in the pure `applyTouchAction` helper (`game/touch.mjs`), covering held actions (fire, ADS, crouch, talk) and latched one-shot actions (jump, reload, power, use).

Version 2.18 makes bots react to fire they cannot see:

- **Threat awareness.** A bot that takes damage now records the attacker as a remembered threat, snaps its attention toward the shot and briefly investigates the last-known position when the attacker is not visible (`game/core.mjs`). Previously a bot only reacted to targets it could currently see, so an unseen shooter could farm it for free.
- **Bounded and safe.** The reaction opens a 1.4s suppression window and requests a prompt but bounded (60ms) re-plan, so sustained bot-vs-bot fire cannot trigger a navigation recompute every frame.

Version 2.17 trims network payloads:

- **Quantized snapshots.** The server now rounds every finite number in broadcast snapshots and event deltas to the millimetre (`game/quantize.mjs`), applied to a deep clone in `server/room.mjs`. Positions and angles to three decimals look identical but serialize several bytes smaller at the 30 Hz snapshot rate, and the authoritative simulation keeps full precision.

Version 2.16 hardens multiplayer input:

- **Input cannot be poisoned.** A client that jumps its input sequence far ahead is snapped back to the next expected value instead of being allowed to make every later input look stale (`server/room.mjs`). Stale and duplicate sequences are still ignored.
- **Movement axes are clamped.** The server coerces `x`/`z` to finite values in `[-1,1]` and drops non-finite look values before they reach the authoritative simulation.

Version 2.15 gives every weapon a range identity:

- **Damage falloff.** Hitscan weapons now deal full damage inside an effective range and taper off beyond it (`game/data.mjs` `falloff:{start,end,min}`, applied by the pure `damageFalloff` helper in `game/core.mjs`). Pulse, Scattergun, Shock Beam, Flak Cannon, Marksman Rifle and SMG all fall off; the Rail Lance and the projectile/splash weapons are unchanged. Shotguns and the SMG now lose bite at distance, while snipers and launchers own the long lanes.
- **Readable in the shot.** Each `shot` event carries its `falloff`, so hit feedback can reflect reduced damage. A close-range Pulse shot is unchanged; the same shot at 70u deals ~62%.

Version 2.14 adds mobile touch controls:

- **One-screen mobile controls.** A left thumbstick (`app/game-ui/touch-controls.tsx`) drives analog movement and sprints when pushed to the edge; a drag-anywhere look surface aims; and an action cluster covers fire, ADS, jump, slide, reload, power, use, weapon swap and pause. Controls write imperatively to the runtime, so the frame loop never re-renders React.
- **Automatic and optional.** Controls enable automatically on coarse-pointer devices (`pointer: coarse` or `maxTouchPoints > 0`) and can be toggled in Graphics & settings; the choice is saved locally. Desktop mouse and keyboard are unchanged.
- **Shared input path.** `controlsFromState` now accepts an analog `move` axis plus explicit `sprint`/`crouch`, so touch, keyboard and netcode prediction all flow through the same controls builder. The joystick curve and look mapping live in the pure, tested `game/touch.mjs`.
- **Fills the phone screen.** A mobile viewport export plus `touch-action`, `overscroll-behavior` and safe-area CSS stop zoom, scrolling and pull-to-refresh during play without disturbing the desktop HUD.

Version 2.13 adds Payload, an escort mode:

- **Payload mode.** A new team objective mode (`game/payload.mjs`) pushes a cart along an authored route. Attackers standing within its radius advance it; defenders stall it and roll it back, but never past the last checkpoint. Reaching the final point wins immediately; if the clock expires first, the defenders win. Checkpoints bank score as the cart passes them.
- **Any arena, a real route.** `payloadTemplate` builds the route from the map's team spawns and safe nav/objective points, so Payload works on the large arena rotation (`game/arenas.mjs`) without hand-authored tracks. A dedicated generated map, **Convoy Line**, ships as the mode's next-gen arena.
- **World and HUD.** The renderer draws a wheel-spinning payload cart with a team-coloured beacon and contested tint (`game/view.mjs`), and the HUD gets a Payload command brief, checkpoint scoreboard columns and a checkpoint target rule (`app/page.tsx`, `app/game-ui/configuration.tsx`).
- **Bots play the objective.** Attackers escort the cart; defenders hold on it and roll it back. The outcome is authoritative in snapshots, history and replays.

Version 2.12 makes combat deaths varied and readable:

- **Eight death styles.** Kills now resolve into a `ragdoll` collapse, a `headpop` (head bursts, body topples), `gibs` (limbs fly apart), a `burst` gore cloud, a burning `combust`, an energy `vaporize`, a flattened `splatter`, or an `electrocute`. Void falls always collapse the body.
- **Chosen from the kill, not at random.** A pure `game/deaths.mjs` recipe picks the style from the killing weapon's family, the headshot flag and how wildly the blow overkilled the target, seeded by actor/death so it is deterministic for the sim, the network, replays and tests. Massive overkill always gibs; precision headshots favour head pops; the same gun still varies shot to shot.
- **Pooled debris.** `DeathPool` flings reusable limb and body chunks with gravity, spin and a ground splat decal, capped by a fixed slot budget so a pile-up of deaths cannot grow GPU resources. Gore particles reuse the existing effect pool.
- **Corpses fall where they were hit.** The intact body topples away from the killing shot, hides its head on head pops, and is restored on respawn. Reduced-motion snaps the pose and trims the debris while keeping the death readable.
- **Shared end to end.** Death events carry `style`, `seed` and the impact direction, so remote clients, spectators and Theater replays play the same death the shooter saw.

Version 2.11 is a follow-up robustness and accessibility batch:

- **Every CTF arena now authors flag bases.** Citadel, Trenchline, Signal Ridge and Sunken Hill previously advertised CTF while falling back to spawn corners for their flags. All four now define red/blue team spawns and distinct flag bases, and a test enforces that every CTF-capable arena does.
- **Arena and mode stay compatible on the server.** Hosting or starting a match now repairs an incompatible arena to the mode with the same `resolveMapForMode` rule the client uses, so a stale or edited request cannot launch CTF on a map without bases.
- **Bounded room count.** The room registry caps concurrent rooms (64 by default), evicts idle empty rooms under pressure, and returns a clear error instead of growing without limit when every room is occupied.
- **Kill feed is announced.** The in-match kill feed is now an ARIA live log, matching the existing live regions on the kill banner, objective announcer and reload indicator.
- **Half-rate shadow refreshes.** Static-arena shadows were re-rendered every frame despite `autoUpdate=false`; they now refresh on a fixed cadence, cutting shadow-map cost roughly in half while leaving the arena bake immediate.

Version 2.10 continues the gap-fix work:

- **Menus obey Escape.** Escape now backs out of the room browser, rank screen, theater list and lobby, matching the documented "Escape closes any overlay" behaviour.
- **Mode and arena stay in sync.** Switching to a mode the selected arena does not support now auto-selects a compatible arena instead of silently launching a hidden, invalid map.
- **A real Assault HUD.** Assault gets its sector-count rule in match setup, a `SECTORS` goal, and a live command panel that names the active sector, capture progress and whether you are attacking or holding. The Assault round now also ends in a defender win if time expires without a breach.
- **Theater shows the whole fight.** Demo playback now includes projectiles, actors and vehicles that appear after the first keyframe (and removes the ones that despawn), instead of freezing the opening frame's cast. Recordings also respect their maximum duration.
- **Bots move like players.** Bots sprint on long rotations, aim down sights at mid range, and slide when critically hurt and running.
- **Map and capture correctness.** The next-gen CTF map keeps its authored flag bases instead of dropping them at a spawn corner, and objective capture ignores actors standing far above a zone (no more roof camping a ground point).
- **Server liveness.** The game server now heartbeats sockets and terminates dead ones, caps buffered outbound traffic so a slow client cannot balloon server memory, and limits spectators per room.

Version 2.9 is a five-pass gap-fix batch found by a full codebase audit:

- **Objective modes actually work.** `objectiveTemplate` now dispatches on the mode's declared objective kind instead of hard-coded names, so **Combined Arms** finally gets its three Domination zones (and can score/end). Bots now treat `assault` and `combined-arms` as objective modes: Assault attackers push the active sector while defenders hold it. The KOTH hill is chosen as the authored zone nearest the arena center instead of a fixed array index, fixing off-center hills on the next-gen maps.
- **Reload and the whole arsenal.** Pressing **R** now actually reloads (the server already forwarded the input; the simulation now consumes it), the starting-weapon setting accepts all **ten** weapons instead of clamping at the Flak Cannon, and bots use the Shock Beam, Grenade Launcher, Flak Cannon, Marksman Rifle and SMG instead of only the first five guns. Magazine attachments now raise the real reload ceiling and Quickdraw speeds the real reload timer.
- **Balance correctness.** Reduced-armour gear (Light Frame) can no longer turn into a hidden damage bonus, harness passive damage modifiers are applied to outgoing fire, team modes no longer let you destroy your own team's vehicle, mounted chainguns can damage enemy armour, and the Hermes/Cline/OpenCode vehicle perks (overdrive, nitro boost, faster turret) now do what they say.
- **Server hardening.** Created room names are stripped of control characters and bounded; a late joiner no longer replays the whole buffered event history (and a mid-match player join becomes a spectator instead of a ghost seat); gear writes are blocked for spectators and rate-limited; progression eviction is now least-recently-used instead of insertion order.
- **Renderer fixes.** The CPU software renderer now draws every instance of an `InstancedMesh` (next-gen rocks, trees, crates and barrels no longer vanish), and procedural surface textures are disposed correctly when a world is rebuilt instead of leaking normal/roughness maps.

Version 2.8 is a five-pass polish batch:

- **Killstreak callouts.** Consecutive local kills now announce themselves — DOUBLE / TRIPLE / OVERKILL / MONSTER / MEGA KILL for rapid chains, and KILLING SPREE / RAMPAGE / DOMINATING / UNSTOPPABLE / GODLIKE / LEGENDARY at each five-kill milestone. Death events now carry the killer, so solo and network matches share the same logic (`game/hud.mjs`).
- **Post-match superlatives.** The results screen names the MATCH MVP, MOST OBJECTIVE TIME, FLAG RUNNER, BEST K/D and FEED PROVIDER for the round, so a loss still has a story.
- **Bots that value their lives.** A critically hurt bot with no supply to grab now backpedals instead of trading point-blank, and bots refuse to fire a rocket, grenade or plasma shot when the target is inside their own blast radius — no more suicide rockets.
- **Colorblind team palette.** Graphics & settings gains a **Team colors** option. The colorblind palette swaps red/blue for the Okabe-Ito orange/blue pair while keeping the one-bar/two-bar world markers, so teams stay readable without relying on hue.
- **Tactical radar.** A circular yaw-relative radar shows nearby operators, objective zones and flags, colour-coded by team and palette, with a rotating sweep (disabled under reduced motion).

Version 2.7 tightens the arenas and the HUD:

- **No more endless falling.** A step past the terrain boundary made `floorAt` return null (no triangle out there), so the actor entered free-fall and was only clamped back in-bounds after the fact. Positions are now clamped before the vertical pass, so you always land at the edge. Next-gen maps also carry a kill-plane (`voidY`), so any impossible fall resolves to a death and a respawn instead of an infinite drop.
- **A bigger, clearer HUD.** The match clock, frag counter, health, armor, ability, weapon and command readouts now scale with the viewport rather than sitting at fixed pixel sizes, with stronger panels and glows.
- **Announcement effects.** Objective, score and capture announcements render as a large glowing banner with a sweeping underline; kill banners pop in, the kill feed slides in, and hitmarkers and damage numbers are larger. Every effect respects reduced motion.

Version 2.6 is the next-generation graphics overhaul:

- **Rounded, articulated operators.** The boxy robot is gone. Each operator is now built from smooth capsules and ball joints with a real joint hierarchy (hips, torso, chest, head, shoulders/elbows, hips/knees/ankles) in `game/character-anim.mjs`. A procedural rig drives an idle breath, a speed-scaled run cycle, contra-lateral arm/leg swing, torso lean, strafe roll and crouch/air/ADS poses — no texture rigging or downloaded assets required.
- **Bots move like they mean it.** Bots (and every actor) now carry a smoothed `bodyYaw`: their aim can snap but the body swivels toward it at a human rate, so turning reads naturally. The rig tracks the aim point with the head and chest, banks into turns, pitches the held weapon with the aim and flinches when hit.
- **A new level system.** `game/levelgen.mjs` builds levels deterministically from a seed: heightfield terrain with biomes (canyon, forest, snow, volcanic, urban, ruins, cavern), cliff faces, buildings with walkable doorways and interiors, tunnels, domed caverns, bridges, arches, columns and props (rocks, trees, crates, barrels, ruins). The legacy hand-authored arenas remain untouched in the rotation.
- **One next-gen map per mode** (`game/nextgen-maps.mjs`): The Colosseum (deathmatch), Frost Gate (CTF), Sunken Hill (KOTH), Riverbend (domination), Iron Fortress (assault), The Atrium (team deathmatch), The Catacombs (instagib), Slagworks (rockets), The Forge (arsenal) and Titan Valley (combined arms).
- **The renderer draws the geometry, not the boxes.** Next-gen collision blocks become hidden proxies while the world renders smooth roofs, arches, columns, tube tunnels, cavern domes, displaced rocks and trees, emissive windows and cliff strata. A fast spatial-grid navigation graph with largest-component pruning keeps bots pathing on organic terrain.

Version 2.5 rebrands the game as **COCS — Colosseum Of Competitive Slop** and rewrites the whole voice:

- **New identity.** The title screen shows **C O C S** in big industrial type, with `COLOSSEUM / OF / COMPETITIVE / SLOP` stacked directly beneath the letters and sliding in one letter at a time, Mega Man style. The in-game wordmark, page metadata, server banner and deployment labels all follow.
- **Tongue-in-cheek roster.** The nine operators now carry affectionate parody tags and bios — ChatGPT is "The People Pleaser", Claude is "The Safety Officer", Grok is "The Reply Guy", Meta is "The Open-Weight Dad", Gemini is "The Reviser", DeepSeek is "The Price Cutter", Mistral is "The Le Coq", Kimi is "The Context Hoarder" and Qwen is "The Shipping Container". The quality is up for debate; the roasts are not.
- **Harness copy with teeth.** Every harness keeps its mechanics but gains a joke explaining it (OpenCode's Parallel Burst "spawns a swarm of parallel subagents that all pull the trigger at once… yes, it burns tokens"), and powerups, modes, gear, weapon attachments, finishes, reticles, ranks and weapons all received fuller descriptive copy.
- **Back out of the menu.** Escape or the ✕ button on the loadout screen returns you to the COCS title screen at any time.
- **Cleaner unlock track.** The Rank screen now groups unlocks into Gear, Weapon Mods, Weapon Finishes and Reticles, each with a progress bar and a tidy card grid instead of one long list.

Version 2.4 turns up the spectacle:

- **Action title demo.** The menu showcase now alternates a 16-bot **Combined Arms** battle on the largest vehicle maps — with bots pre-seated in Pumas and Hornets so armour and aircraft are rolling from the first second — and an **Instagib** rail match, with quicker cinematic cuts.
- **Quake 2 rail.** The Rail Lance fires a Quake 2-style beam: an additive spiral-textured coil with a white-hot core and an expanding muzzle ring, capped by a starburst impact.
- **Unique weapon effects.** Every weapon reads differently in use: pulse tracers, rocket launch smoke and shrapnel, the rail coil, scatter and flak pellet cones with debris, plasma orbs with pulse rings, grenade fireballs, jagged shock arcs, marksman lances and quick SMG streaks — each with its own impact response.

Version 2.2 adds weapon mods, a vehicle overhaul and new modes:

- **Weapon attachments.** Four mod slots (optic, barrel, magazine, underbarrel) and fourteen unlockable mods that change both how a weapon looks and how it behaves: long barrels and scopes extend range, drum magazines add rounds, piercing rounds punch through targets, explosive tips detonate, the underbarrel grenade launcher adds splash, homing beacons curve rockets, burst modules fire in bursts, charge coils hold for a boosted shot and chain capacitors arc into a second target. Pick them in the Rank screen; each mod applies to every weapon it fits.
- **Vehicle overhaul.** Steering no longer inverts, riders visibly mount the Puma and Hornet and are valid targets, and each vehicle now has a driver, a gunner and passenger seats. The gunner works the mounted chaingun while the driver keeps both hands on the wheel.
- **Vehicle skills.** Harnesses carry vehicle perks: OpenClaw's Auto-Gunner and Roo's Gunner Drone man the turret when you drive without a gunner, Claude Code adds reactive plating, Codex repairs the hull, Cline triggers a nitro boost, Hermes overdrives the engine and OpenCode uplinks a faster turret.
- **Assault mode.** Attackers capture sectors in order while defenders hold the line, and breaching the final sector wins. Trenchline and Signal Ridge join the Combined Arms roster, while Rampart and Catwalk Breach are built for Assault.
- **Finishes and reticles.** Six weapon finishes recolor your guns and all five reticle styles (cross, dot, ring, chevron, split) carry across matches.

Version 2.1 expands and rebalances the arsenal:

- **Two new weapons.** The **Marksman Rifle** (hard-hitting semi-auto for long lanes) and the **Submachine Gun** (fast, close-range spray) bring the arsenal to ten. Both ship with full weapon models, distinct muzzle/shot audio profiles, pickup mapping and ammo, and they appear on the combined-arms maps.
- **Balance pass.** The Scattergun fires slower with tighter maximum bloom, the Plasma Driver cycles slightly slower, and the Flak Cannon was slowed to widen the heavy gap, so no single weapon dominates a range band.
- **Weapon customisation.** The primary gear slot is a weapon kit that trades damage, spread, speed and armour; pick one per slot to tune your Combined Arms loadout.
- **Better gunplay.** Number row now binds 1–9 and 0 across the ten weapons, with the wheel covering everything and cleaner first-shot accuracy.

## Source ZIPs

The original MVP ZIP is a snapshot of the completed v0.1 commit. The expanded ZIP contains the latest v0.3 source, lockfile, procedural assets, tests and documentation. Both omit installed dependencies and generated build files; run `npm ci` after extracting, then `npm run dev`.


## Custom matches (0.3)

Use **MATCH SETUP** on the loadout screen to jump to match setup. Settings persist on this device; the current match keeps its original rules. Play Again starts a fresh match with the same chosen configuration.

| Mode | Rules |
|---|---|
| Deathmatch | Start with your chosen weapon; collect the rest. |
| Capture the Flag | Steal the enemy flag and return it while your flag is home; three captures wins by default. |
| King of the Hill | Capture the central hill, then hold it for one point per second; first to the hill-time target wins. |
| Domination | Capture and hold three zones; each owned zone scores one point per second. |
| Team Deathmatch | Shared team frag score; friendly fire is disabled. |
| Instagib | Unlimited Rail Lance only; one unprotected hit kills. No supplies or powers. |
| Rocket Arena | Unlimited rockets only; health and armor pickups remain. |
| Full Arsenal | All ten weapons unlocked with unlimited ammo on every spawn. |

Set 0–8 bots (zero is solo practice), Easy/Normal/Hard/Nightmare difficulty, capture/team-frag limits or 30–300 second objective targets, 1–15 minute timer, and 1–5 second respawns. Difficulty changes reaction delay, aim error, turning speed, decision interval, and firing cadence. Bots use their operator stats and the same match modifiers as players; difficulty does not grant extra health. During play, the Live Command panel identifies the current objective and recommended next move.

Modifiers: 0.75–1.5× movement speed, normal/light/moon gravity, 0.5–2× damage, unlimited ammo for unlocked weapons, half ability cooldowns, and 25% life steal based on health damage actually dealt. Self-damage never heals. Instagib overrides damage and disables powers. Weapon-locked modes override the starting weapon and ammo controls.

Customize your callsign (20 characters), 65–110° field of view, crosshair shape (cross/dot/ring/chevron/split), color and size, weapon visibility, FPS counter, sensitivity and audio. View settings are available in Controls & Settings and Pause and apply immediately. Match rules are edited from loadout. Reset buttons restore match or display defaults separately. No user account or cloud save is involved.

`game/config.mjs` validates persisted input and defines presets. `app/game-ui/configuration.tsx` contains the setup controls. `game/config.test.mjs` verifies the new rules and complete matches at all four difficulties.
