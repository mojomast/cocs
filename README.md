# COCS — Colosseum Of Competitive Slop

**Nine famous language models. Seven agent harnesses. Thirty-four arenas. One
deliberately ridiculous first-person shooter that runs entirely in your browser.**

COCS is a local-first Three.js arena shooter where AI operators settle their
differences with guns. Pick an operator, strap on a harness, choose an arena, and
run anything from a 1v1 duel to a 16-bot Combined Arms battle — solo, against
bots, or over your own LAN with a self-hosted authoritative game server.

No accounts. No cloud. No inference service. All match logic and bot decisions run
on your machine, and every asset is procedural.

[**Play it live**](https://arena.ussyco.de) · [Source](https://github.com/mojomast/tokenarena)

![version](https://img.shields.io/badge/version-v8.6%20PRISM-2dd4bf)
![runtime](https://img.shields.io/badge/runtime-Node%2022.13%2B-339933)
![engine](https://img.shields.io/badge/engine-Three.js-000000)
![tests](https://img.shields.io/badge/tests-game%20%C2%B7%20server%20%C2%B7%20SSR-4c9f70)

---

## Table of contents

- [What you get](#what-you-get)
- [Feature highlights](#feature-highlights)
- [Operators](#operators)
- [Harnesses](#harnesses)
- [Weapons](#weapons)
- [Vehicles](#vehicles)
- [Game modes](#game-modes)
- [Single-player](#single-player)
- [Arenas](#arenas)
- [Multiplayer and netcode](#multiplayer-and-netcode)
- [Accessibility](#accessibility)
- [Controls](#controls)
- [Graphics and performance](#graphics-and-performance)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Run it locally](#run-it-locally)
- [Testing](#testing)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Changelog](#changelog)
- [Parody and attribution](#parody-and-attribution)

---

## What you get

| | |
|---|---|
| **21 game modes** | Free-for-all, team objectives, racing, soccer, boss fights and a scripted campaign. |
| **9 operators** | Affectionate robot parodies of the big models, each with distinct stats. |
| **7 harnesses** | One active ability each, from a knockback burst to a phase dash. |
| **10 weapons** | Hitscan, projectile, shotgun, beam, launcher and rifle archetypes with recoil, bloom and reloads. |
| **5 vehicle chassis** | Puma buggy, Hornet aircraft, and the Titan, Scout and Transport war machines. |
| **34 arenas** | Hand-authored classics plus a deterministic next-generation level generator. |
| **Full netcode** | 60 Hz authoritative server, client prediction and reconciliation, interpolation, reconnect and host migration. |
| **A show-style title demo** | A live bot match behind the menu with a cinematic director and a broadcast lower-third. |

## Feature highlights

### Combat and movement
- **Quake/Source-style movement**: ground friction and acceleration, air
  acceleration with strafe jumping, variable jump height with apex hang, sprint,
  crouch and a momentum-preserving slide.
- **Real gunplay**: per-weapon recoil aim-punch, spray patterns, bloom that grows
  while moving and recovers at rest, ADS, reloads, auto-reload, holster timing and
  range-based damage falloff.
- **Ten weapons with identities**, from the always-available Pulse Rifle to the
  Rail Lance, Flak Cannon, Marksman Rifle and Submachine Gun.
- **Attachment mods**: optics, barrels, magazines and underbarrel launchers that
  change both how a weapon looks and how it behaves.
- **Weapon feel everywhere**: data-driven kick, muzzle flashes, tracers, impact
  effects, death styles and synthesized audio.
- **Melee and frags**: a point-blank melee arc and a cooldown-gated bouncing frag
  grenade for every operator.

### Modes and objectives
- **Objective play that works**: a floating pig payload to escort, rotating King of
  the Hill, three-zone Domination, ordered Assault sectors, Holdout quorums and
  Uplink relays.
- **Experimental modes**: Juggernaut, Team Elimination and VIP Escort, plus Arms
  Race's weapon ladder.
- **Car modes**: Puma Circuit racing with items and rubber-banding, and 2v2 Puma
  Soccer on the circuit infield.
- **Mutators** compose on any mode: low gravity, turbo, instagib, one-shot kills,
  mirror loadout, big head and no recoil.
- **Sudden-death timers** ensure every mode terminates instead of stalling.

### World and presentation
- **Procedural everything**: deterministic FBM textures, articulated operator
  models, levelgen terrain, and pooled effects — no downloaded art.
- **Weather and time of day**: rain, snow, ash, storms, lightning, wet sheen and
  wind gusts, deterministic per biome and seed.
- **Cinematic director**: seven camera rigs that auto-cut to kills, explosions and
  captures, used in Theater playback and the title showcase.
- **Per-mode music and stingers**: synthesized themes, ambient beds and
  victory/defeat cues that follow the mode and mood, plus a slow modal
  **Halo-flavoured soundtrack** with a choir pad, taiko drums and a convolution
  reverb baked from Moth's retrocausal-echo engine.
- **A living menu**: a shuffled reel of real bot matches behind the UI, with a
  broadcast lower-third reporting the live mode, map, score and objective.
- **Optional quantum-baked assets**: offline [Moth Quantum](docs/MOTH.md) engines
  bake albedo textures, **normal maps** (from quantum-blurred height fields),
  iridescent material LUTs, an equirect sky, animated effect frames, a
  convolution **reverb impulse** and MIDI motifs into `game/moth-baked.mjs`; the
  game stays procedural and offline until a bake has been run. Browse the results
  at the **[/moth showcase](docs/MOTH.md#showcase-moth)**.

### Progression and meta
- **XP, ranks and prestige** across a deterministic curve, with two prestiges
  beyond max level.
- **Unlocks**: gear, weapon mods, finishes and reticles, shown on a Rank screen.
- **Daily and weekly challenges**, twelve achievements, per-mode career stats,
  local match history and personal leaderboards.

### Platform
- **Local multiplayer** over WebSocket with a Node authoritative server, rooms and
  a 4-letter room code, spectators, room chat and push-to-talk voice.
- **Survivable connections**: session tokens, a held seat on disconnect, token
  reattach mid-match, bot handoff and host migration.
- **Touch controls** that switch on automatically on coarse-pointer devices and
  can be forced from settings.
- **Accessibility**: colorblind and high-contrast palettes, full keyboard
  remapping, audio captions and a manual reduce-motion toggle.

## Operators

All nine operators are playable and appear as bots. Health, spawn armor and base
speed are the only stat differences; damage is shared. Claude receives a modest
bonus because its harness is locked to Claude Code.

| Operator | Max / Spawn Health | Spawn Armor | Base Speed (m/s) |
|---|---:|---:|---:|
| ChatGPT | 100 | 0 | 8.0 |
| Claude | 115 | 10 | 8.2 |
| Grok | 110 | 0 | 8.3 |
| Meta | 100 | 20 | 7.6 |
| Gemini | 95 | 10 | 8.5 |
| DeepSeek | 120 | 0 | 7.4 |
| Mistral | 85 | 0 | 9.4 |
| Kimi | 90 | 15 | 8.7 |
| Qwen | 100 | 5 | 8.4 |

## Harnesses

One active ability per actor, on a cooldown, shared by humans and bots. Claude can
only equip Claude Code.

| Harness | Ability | Effect |
|---|---|---|
| OpenClaw | Claw Burst | Line-of-sight radial pulse with damage and knockback. |
| Hermes | Courier Rush | Temporary speed boost with a trail. |
| OpenCode | Parallel Burst | Temporary faster fire cadence. |
| Claude Code | Guardrail | Temporary 50% incoming-damage reduction. |
| Codex | Recompile | Instant health repair. |
| Cline | Phase Step | Collision-safe forward dash. |
| Roo Code | Context Jam | Line-of-sight slowing pulse. |

Harness profiles also grant small passives, weapon affinities and bot personality
hints, so they change tactics without breaking balance.

## Weapons

| Weapon | Role |
|---|---|
| Pulse Rifle | Unlimited-ammo hitscan workhorse. |
| Rocket Launcher | Projectile with splash, impulse and self-damage. |
| Rail Lance | High-damage hitscan beam for long lanes. |
| Scattergun | Multi-pellet close-range burst. |
| Plasma Driver | Slow projectile with a splash bloom. |
| Grenade Launcher | Arcing explosive with bounce. |
| Shock Beam | Rapid close-range beam. |
| Flak Cannon | Heavy close-range shrapnel. |
| Marksman Rifle | Semi-auto long-range poke. |
| Submachine Gun | Fast close-range spray. |

Pickups grant limited-ammo weapons; the Pulse Rifle is always available. The five
powerups — Haste, Overcharge, Overshield, Recon Pulse and Cloak — temporarily
change movement, fire cadence, damage, radar or visibility.

## Vehicles

Five chassis, entered with **E**, with driver/gunner/passenger seats, mounted
weapons, destruction and respawn.

| Vehicle | Class | Health | Seats | Notes |
|---|---|---:|---:|---|
| Puma | Buggy | 300 | 4 | 360° chaingun, drift handling, boost. |
| Hornet | Aircraft | 240 | 3 | True flight, hovering, altitude ceiling. |
| Titan | Heavy | 650 | 3 | Slow, heavily armored, mounted cannon. |
| Scout | Light | 140 | 2 | Fast two-seater with a light gun. |
| Transport | Transport | 480 | 6 | Six-seat troop carrier with a turret. |

## Game modes

| Mode | Team | Win condition |
|---|---|---|
| Deathmatch | No | First to the frag limit. |
| Team Deathmatch | Yes | Shared team-frag target, friendly fire off. |
| Capture the Flag | Yes | Return the enemy flag while yours is home. |
| King of the Hill | Yes | Hold the rotating hill for one point per second. |
| Domination | Yes | Own three zones; each scores per second. |
| Assault | Yes | Attackers breach ordered sectors; defenders win on the clock. |
| Combined Arms | Yes | 16-bot warzone with armor, aircraft and zones. |
| Payload | Yes | Escort the floating pig cart to the final checkpoint. |
| Arms Race | No | Every kill promotes you up the weapon rack. |
| Instagib | No | Rail only, one unprotected hit kills. |
| Rocket Arena | No | Unlimited rockets, health and armor only. |
| Full Arsenal | No | All weapons, unlimited ammo, from spawn. |
| Juggernaut | No | Hold the crown and bank the most points. |
| Team Elimination | Yes | Burn the enemy's shared lives. |
| VIP Escort | Yes | Move the VIP to the extraction pad. |
| Holdout | Yes | Capture and hold a quorum of zones. |
| Uplink | Yes | Relay sequential control points. |
| Puma Circuit | No | Pass every gate in order, first to the lap target. |
| Puma Soccer | Yes | Drive the ball into the enemy goal. |
| Horde | Solo | Survive escalating NPC waves. |
| Campaign | Solo | Clear scripted single-player missions. |

## Single-player

Single-player is its own thing: themed husks with tiny health pools and per-class
behavior, deployed from authored encounter points.

- **Horde** — hold out against escalating waves with between-wave upgrades,
  wave modifiers and escalating bosses.
- **Campaign** — a linear story operation across the biggest maps with briefings,
  in-world waypoints, scripted encounters, boss phases, weather changes and timed
  story transmissions.
- **Enemy classes** — Husk swarmer, ranged Spitter, heavy Brute, support Mender,
  Sapper, Overseer, shield tank, mortar artillery, lancers and the WARDEN bosses.

Progress is saved locally with mission stars, bests and checkpoints.

## Arenas

34 active arenas plus a set of archived legacy maps (enabled from settings).
Highlights:

- **Classics**: The Exchange, Crosswire, The Foundry, Launchpad, Citadel, Blood
  Gulch.
- **Outdoor CTF**: Skybreak Isles, Aether Ring, Frostline, Derelict Station, Ashen
  Rift, Sunscar Canyon, Ironfall Megastructure, Longreach Plateau.
- **Combined arms**: Warfront Delta, Skyfall Basin, Trenchline, Signal Ridge,
  Titan Valley, Convoy Line.
- **Next-gen**: The Colosseum, Frost Gate, Sunken Hill, Riverbend, Iron Fortress,
  The Atrium, The Catacombs, Slagworks, The Forge, Proving Grounds, The Throne, The
  Gauntlet, Dune Ravine, Ember Caldera.
- **Vehicle courses**: Puma Circuit and Puma Pitch.

Every map carries a group, scale, mode whitelist and recommended bot count, and is
validated by layout tests for spawn clearance, navigation round-trips and objective
reachability.

## Multiplayer and netcode

The game server runs on your machine, not a cloud platform.

| Command | What it does |
|---|---|
| `npm run server` | Game server on `ws://localhost:4000` (`PORT` overrides). |
| `npm run demo` | Headless client that joins, hosts and reports snapshots. |
| `npm run dev` | Web app — then use **ONLINE → CONNECT & JOIN**. |

- **Authoritative server**: 60 Hz fixed-step tick, per-peer sequenced inputs,
  event deltas, 30 Hz snapshots and server-side anti-cheat bounds.
- **Client prediction**: a local shadow `Match` runs your inputs for instant
  movement, aim and fire, then reconciles to every authoritative snapshot.
- **Interpolation**: remote actors and projectiles render at an adaptive ~100 ms
  delay with a jitter-adaptive buffer.
- **Efficient wire format**: snapshots are quantized to the millimetre at 30 Hz, the
  protocol is v2 with a full-snapshot fallback, and a snapshot-delta codec is used
  by the deterministic net harness and available to constrained transports.
- **Rooms and matchmaking**: a default room plus on-demand 4-letter-code rooms, a
  room browser, balanced team matchmaking, warmup/ready/map-vote/rematch lifecycle
  and leaderboards.
- **Reconnect**: session tokens, a 20-second held seat, token reattach mid-match,
  bot handoff and host migration.
- **Social**: room chat and push-to-talk or VAD voice chat.
- **Spectators**: join with no seat, camera-follow any live actor, hide the HUD.

## Accessibility

- Colorblind palettes (deuteranopia, protanopia, tritanopia) plus a
  high-contrast UI mode.
- Full keyboard remapping with duplicate detection and one-tap reset.
- Audio captions describing gunfire, explosions, reloads, pickups, objectives and
  eliminations.
- A manual reduce-motion toggle that trims camera shake, menu animation, the radar
  sweep and decorative effects.
- Toggleable kill feed, damage numbers and radar; invertable look with separate
  ADS and touch sensitivity.
- Touch controls with safe-area layout, a left move stick, right look surface and a
  full action cluster.

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Left click / hold | Fire |
| Right click (hold) | Aim down sights |
| Shift (hold) | Sprint (and vehicle boost) |
| Ctrl / C (hold) | Crouch; crouch while sprinting to slide |
| Space | Jump — hold to auto-hop / bunnyhop (handbrake while driving) |
| R | Reload |
| 1–9/0; mouse wheel | Switch available weapon |
| Q | Activate harness ability |
| G | Throw frag grenade |
| F | Melee |
| E | Enter / exit nearby vehicle |
| V | Push-to-talk voice |
| Tab | Hold scoreboard |
| Escape | Pause and release mouse |

Racing uses **W/S** throttle/reverse, **A/D** steer, **Space/Ctrl** handbrake,
**Shift** boost, **left click/Q** use item and **E** reset.

## Graphics and performance

- **Two renderers**: hardware WebGL2 with directional shadows, PMREM
  image-based lighting, procedural FBM textures and tiered bloom/vignette/SMAA
  post-processing, plus a CPU software renderer of the same scene for machines
  without WebGL2.
- **Quality tiers** (Auto/Low/Medium/High) drive resolution scale, glow strength,
  shadows, particle budgets and an LOD/triangle budget; quality is persisted.
- **Bounded resources**: pooled effects, shared material/geometry caches, capped
  particles and projectiles, and disposal on world rebuild.
- **Reduced motion** and the software fallback disable shake, bloom and
  post-processing while keeping gameplay identical.

> Honesty note: there is no browser/GPU verification in this development
> environment. Visual claims are verified by unit and geometry tests and by the
> production build, not by frame-paced hardware runs. See
> [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Tech stack

- **Engine**: Three.js (procedural geometry and audio), all in ESM `.mjs`.
- **Simulation**: a deterministic 60 Hz pure engine in `game/`, with no DOM or
  Three.js dependency, shared by the client, the server and the tests.
- **App**: React + Next/vinext with a namespaced UI design system under `app/ui/`.
- **Server**: Node `http` + `ws`, authoritative rooms and JSON persistence.
- **Tests**: the built-in `node --test` runner.
- **Tooling**: Vite, TypeScript (checked, loosely typed), ESLint.

## Project structure

```
app/        React UI: the runtime owner (app/page.tsx), screens, design system
game/       The pure 60 Hz engine plus rendering, audio, netcode and content
server/     Authoritative multiplayer: rooms, matchmaking, persistence
scripts/    Build, version, deployment verification, Moth Quantum bake
assets/moth/ Moth bake manifest and deterministic source art
tests/      SSR, UI-contract and deployment guards
deploy/     nginx vhost and systemd units
docs/       Architecture, systems, testing, changelog, verification
public/     favicon and web manifest
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module map and data
flow, and [docs/SYSTEMS.md](docs/SYSTEMS.md) for a deep dive into each system.

## Run it locally

Requires **Node.js 22.13+** and npm.

```bash
npm ci
npm run dev        # Vite dev server, prints its URL
```

Other useful commands:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run server     # local game server on ws://localhost:4000
npm run demo       # headless multiplayer client
npm run typecheck  # tsc --noEmit
npm run lint
```

No API key, downloaded art or inference service is needed. State (settings,
presets, progression, history, campaign progress) is stored in `localStorage`;
multiplayer progression and match history are persisted server-side to JSON.

## Testing

```bash
npm run test:game     # pure engine, content, maps, modes, netcode, HUD
npm run test:server   # rooms, matchmaking, history, chat, spectators, voice
node --test tests/*.test.mjs   # SSR, UI contract and deployment guards
npm run test:archive  # slow, largely-redundant integration sweeps (on demand)
```

`tests/rendered-html.test.mjs` pins server-rendered UI strings,
`tests/ui-contract.test.mjs` enforces that every screen field exists in the runtime
`ui` bag, and the deployment tests check that referenced assets exist and resolve.
See [docs/TESTING.md](docs/TESTING.md) for the full strategy and the honest limits.

## Deployment

The live site is served from this host: nginx → `vinext start` on
`127.0.0.1:3000`, with `/ws` proxied to the game server on `127.0.0.1:4000`.

```bash
npm run deploy                          # web only
npm run deploy -- --with-game-server    # also restart the game server
```

Never rebuild without an immediate deploy — the running web service caches its
asset manifest, so a lone rebuild can leave the public site referencing deleted
assets. Full procedure and verification: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [LATTICE STRIKE field guide](docs/LATTICE-FIELD-GUIDE.md): first match, map symbols, traversal, orders and operator/harness roles.
- [Lattice Foundry](docs/LATTICE-FOUNDRY.md): the map's compounds, routes, height choices and validation measurements.
- [LATTICE model upgrade](docs/lattice-model-upgrade.md): the sculpted operators and weapons with measured geometry budgets.

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module map, data flow, invariants, extension guide. |
| [docs/SYSTEMS.md](docs/SYSTEMS.md) | Deep reference for every game system. |
| [docs/TESTING.md](docs/TESTING.md) | Test layers, contracts and limitations. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting and deploy verification. |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | The complete release history. |
| [docs/MOTH.md](docs/MOTH.md) | Baking and loading Moth Quantum assets. |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Dated evidence and known gaps. |
| [docs/V8.4-IMPROVEMENT-PLAN.md](docs/V8.4-IMPROVEMENT-PLAN.md) | Post-v8.4 audit and prioritized improvement roadmap. |
| [docs/spec/](docs/spec/) | Historical specification and development plan. |

## Changelog

Recent releases. The full history lives in
[docs/CHANGELOG.md](docs/CHANGELOG.md).

### v8.6 · PRISM — 2026-09-20
- **Graphics & settings → Graphics lab · Preview:** 23 independent shader
  layers and eleven starting recipes for exploring a distinctive art direction.
- Per-target stacks: WORLD / WEAPON / BOTS each with their own master, mix,
  palette and layers. Weapon stays crisp and bots follow the world until
  enabled; bots are depth-tested so walls occlude them.
- Animation pass: death variety restored (direction topple, per-pose arcs,
  seeded silhouettes, style treatments), stronger hit flinches, a melee swing,
  shell casings, style-aware death audio, and UI entrance motion with an
  in-game reduced-motion gate.
- Graphics-edge pass (research-backed): static dither kills 8-bit banding, a
  contrast-adaptive sharpen recovers FXAA softness, and environment reflections
  scale with the tier. Runs whenever post-processing or the graphics lab runs.
- Pocket Ink ships your saved roll exactly; Ghost Rivals demonstrates a bot
  stack.
- Global backquote hotkey toggles the lab from anywhere; Shift plus that key
  opens the drawer. SURPRISE ME rolls a valid random mix, COPY RECIPE copies the
  exact JSON, and PASTE A RECIPE JSON applies one back for tuning.
- Live drawer, individual controls, palettes, overall mix, A/B bypass, split
  comparison, local persistence, JSON export, and reset. Off by default.
- Paid Moth batch: nine masked surface variants, two reflectance LUTs (ceramic
  and void), an ember sky, two quantum scalar fields, and a 16-frame QRC glyph
  animation. Volcanic, cold and void arenas ride their own skies and LUTs.
- Surface variety mixes generated and baked variants behind one replay-stable
  selection hash; grid surfaces keep their structure while gaining wear and
  roughness; three lab layers pick between the baked Moth assets.
- One combined WebGL shader pass; the HUD and first-person weapon remain crisp.
- [Graphics lab guide](docs/GRAPHICS-LAB.md), the implemented summary in
  [Moth pipeline docs](docs/MOTH.md), and the extensive
  [Moth material-variety plan](docs/design/MOTH-GRAPHICS-PLAN.md).
- Web-only preview feature; no game-server restart or protocol change required.

### v8.5 · HANDOFF — 2026-09-20
- COCS orders, spends, terminals, commands and REQ purchases are round-scoped
  and idempotent: duplicates apply once, payload reuse and stale rounds are
  refused, and accepted hold/attack tasks stay RUNNING until they truly finish.
- Command Board feedback reads QUEUED until the authoritative simulation
  confirms; refusals always carry a reason; reconnects reconcile and rematches
  start clean.
- Deployments publish release/commit/build/protocol for both services and roll
  back web and server together; incompatible protocol majors are refused at join.
- Route advice consumes the real navigation graph, supply cuts, and authority
  ARRAY legality; Operations executes authored per-wave fronts.
- Personal REQ offers its four real buffs plus the Operations Puma with honest
  affordability and confirmation; effectless items cannot be bought.
- Touch, keyboard, reticle-corridor and portrait layout fixes keep actionable
  surfaces reachable; prompts and shortcut names resolve through live bindings.
- Results are viewer-scoped, one modal stack owns focus and Escape, the coach
  opens after arena entry, and assistive announcements are event-gated.
- Training is a protected practice scenario that cannot be cut short; cards
  disclose no-reward status and completion offers a real next step.
- An optional device-local study recorder supports moderated playtests; it is
  off by default, bounded, non-identifying and never sent anywhere.
- No combat or Director-tier balance changed. Human playtesting remains the
  tuning gate; D2-D4 measurement remains deferred.
- Scope: game-server and deploy tooling changed, so a server release restarts
  the game server and briefly disconnects connected clients.

### v8.4 · FIELDCRAFT — 2026-09-20
- LATTICE exposes authoritative dominance progress and Operations wave/HQ state;
  local and network objective notices share priority, deduplication and privacy
  rules so urgent losses and sieges cannot be displaced by routine events.
- Coach, order strip and board share one legal navigation-backed target model,
  preserve stable advice, prefer HQ defence during a siege and show authoritative
  queued/accepted/completed/refused order outcomes with authored node names.
- Passive standings and death summaries preserve combat control. Recommended
  starts reset custom rules and preview their effective map, roster, clock and
  modifiers; Operations separates Director tier from AI aim/reaction difficulty.
- Short-screen HUDs lead with objective, vitals, interaction and wave/HQ state;
  tactical diagnostics are disclosed on demand. Remapped labels and held touch
  jump reach the live interfaces, with a contextual LATTICE touch-use action.
- Result screens explain the outcome, personal objective/support contribution,
  exact XP categories and one mode-appropriate next action before progression.
  No combat or Operations balance changed; human playtesting remains the gate
  before tuning, and D2-D4 measurement remains deferred.
- Scope: snapshot/server visibility code changed, so web and game-server services
  restart and connected multiplayer clients briefly disconnect.

### v7.2 · ECHO — 2026-09-18
- The Moth audio assets are wired into the game. `app/page.tsx` registers a
  deferred `SynthAudio.setMothAudioFactory`, so `MothAudioBank` + `MothAudio`
  are built lazily on the first user gesture, once a real `AudioContext` and
  the `ambience`/`effects` buses exist. Nothing fetches or decodes before then,
  and the layer is inert with no context or under reduced motion (the settings
  toggle forwards through `SynthAudio.setMothEnabled`).
- The baked `bed-ritual` clip is the low menu/explore/results ambience on the
  ambience bus at layer gain `0.4` (the raw clip peaked at `-12 dBFS`), while
  combat leaves the space to the score and SFX. The baked
  `moth-victory`/`moth-defeat` motifs replace the built-in results lead through
  `MusicEngine.setMotif`; the results arrangement opts in with `leadMotif` and
  falls back to the COCS line when no motif is loaded.
- The 153-tap baked `arena` echo map retunes the shared gunfire/explosion
  effects delay tail via `SynthAudio.setEchoMap`, applied per arena by
  `mothEchoFor`, and the neon/void theatres now use the `void` IR, so all six
  baked reverb spaces are reachable. `audioStatus()` reports `space`, `echo`,
  `moth` and `samples`.
- Scope: `core.mjs`, `game/protocol.mjs` and `server/` are untouched, so this
  is a web-only deploy and multiplayer clients are not disconnected.

### v7.1 · CHORUS — 2026-09-18
- The soundtrack is composed instead of looped. `game/music.mjs` gains
  functional eight-bar progressions in D natural minor with real triads and a
  recurring COCS leitmotif developed per scene (augmented statement, +2
  sequence, combat inversion, staccato ostinato, Picardy results, a bell
  fragment at every turn), inside a shared 32-bar form. Phrases accumulate
  because the transport no longer resets, and the voice budget rises from 26 to
  44 with four transient slots reserved.
- A CC0 sampled orchestra ships: 172 samples (9.55 MiB) baked reproducibly from
  VSCO 2 CE and VCSL and served from `/music/*` (strings, low brass, trumpet
  pad, timpani, bells, tubular bells, gong, cymbals, harp, taiko).
  `game/sampler.mjs` decodes Ogg with an AAC fallback, picks samples from the
  seeded engine RNG and folds the choice into the schedule checksum, falling
  back to oscillator voices when a buffer is missing. A real `musicBus` makes
  the settings music slider work, the master chain adds a limiter and ceiling,
  and the results screen plays its own victory/defeat arrangement.
- Moth pass 3 bakes six effect sequences (bloom, vortex, contract, rise, shield,
  snow) and four reverb spaces (open-air, tunnel, hall, cathedral).
  `mothSpaceFor(arenaId)` picks a space per arena and `SynthAudio.setSpace`
  swaps it on every arena build.
- The Moth audio pipeline ships in `game/moth-audio.mjs`: a lazy bank and layer
  for beds, spaces and stingers, with the 5 s `void` IR, the `arena` echo map,
  the `bed-ritual` ambience clip and the `moth-victory`/`moth-defeat` motifs.
  The `ir` baker's recursive tap extraction fixes the empty `cavern` taps, and
  an offline `repair` rebuilds descriptors with no API call or credits.
- Consolidation: one record per real space (`cavern`, `open-air`, `tunnel`,
  `hall`, `cathedral`, `void`), the `ir-openair` duplicate deleted, and a
  80-job manifest.
- Scope: `core.mjs`, `game/protocol.mjs` and `server/` are untouched, so this
  is a web-only deploy and multiplayer clients are not disconnected.

### v7.0 · DOCTRINE — 2026-09-17
- The class and harness overhaul is complete. The hidden harness stat
  multipliers are gone: seven behavioural spec passives (Grip, Express,
  Multiplex, Linted, Green Build, Off-road, Flood Fill) and all 21 wing riders
  resolve through one shared trigger vocabulary with no harness or operator id
  in effect logic, clamped by `EFFECT_BOUNDS`. Kits are data-driven and
  gear-aware, and asymmetric gear gives the scope, heavy-barrel and servo real
  power/cost axes under the §4.8 envelope.
- Class identity is visible. `mobility` binds to KeyX and a MOBILITY touch
  button (forwarded as a held control, protocol v3), the HUD gets a
  rider-aware ability ring and a movement card, and the selection screen shows
  wing/role/signature chips, harness passives/riders and MODEL/KIT tabs. Wings
  gain distinct silhouettes and a pooled telegraph player cues wind-up, charge,
  movement, landings, slams, grapples, ropes and threat pings.
- Team modes gain respawn loadout switching: a queued operator/harness pair is
  consumed on the next spawn, validated and normalised by the room, and offered
  through a respawn overlay. Kills are attributed in the feed, banner,
  scoreboard, captions and audio.
- Phase 5 ships a balance gate: a seeded policy-neutral + policy-on sweep with
  a truncation guard, FFA tie-break, TTK/route/gear gates and
  `reports/balance-v7-*.json`. P5-2 makes the single-hit cap roster-wide
  (`min(90, 0.9 x health)`), re-cuts spawn health and spec uptimes, and brings
  policy-neutral operator spread from 18.6 to 11.4 points with no god tier.
- The v6.6 UI/UX audit landed: header actions, demo dock, results box model,
  pause quick block and 44 px hit targets.
- Scope: `core.mjs`, `game/protocol.mjs` and `server/` changed, so this deploy
  restarts the game server and briefly disconnects multiplayer clients.

### v6.6 · BIOME — 2026-09-17
- Moth skies are wired per biome: volcanic maps get the baked ashen sky, frost
  maps get frost and the neon/void maps (the Quantum Labyrinth included) get
  void, replacing the addSky gradient on the existing camera-following dome
  while stars, sun, haze, halo and the storm/time-of-day tint keep working.
  Unlisted maps keep their procedural sky; the old nebula bake stays unused
  because it decodes to an all-zero equirect (a black dome).
- New surface bakes cover the kinds the game actually paints: eight albedos
  (metal, rough_stucco, corrugated_metal, metal_grating, diamond_plate,
  carbon_fiber, riveted_armor, industrial_mesh) and nine normal maps (grass,
  hazard_stripes, hex_paneling, holographic_grid, metal, metal_grating,
  diamond_plate, rough_stucco, corrugated_metal).
- Two baked effect sequences (arc-burst, spark-impact) drive remote muzzle
  flashes, impacts, explosions, vehicle kills, respawns, captures, teleporter
  transitions and lightning through a new pooled billboarded player;
  entanglement LUTs light pads, beacons, capture rings, the payload halo, flags,
  pickups and menu rings; rock, chitin, brushed metal, stucco and ice surfaces
  reach next-gen props, and race/soccer get a grass pitch, mown stripes and
  brushed-metal goals.
- Shared Moth textures are cached once and disposed safely. The fidelity pass
  cost 28 emulator credits; the wiring cost 0.
- Presentation only: no simulation, protocol or server code changed.

### v6.5 · MOMENTUM — 2026-09-17
- Every operator owns a movement verb: nine verbs (Air Dash, Double Jump, Super
  Jump, Hover Jets, Brace Slam, Safety Glide, Grapple, Blink Step, Deployable
  Rope) with explicit charge/fuel/wind-up/cooldown/landing budgets, five spec
  hooks and one shared carrier rule for flag carriers, the VIP and the
  Juggernaut. Nine class signature verbs (Effortless, Revision, Heat, Deep
  Compute, Braced, Alignment Review, Adaptive, Long Context, Tool Use) are live
  in the simulation, and bots spend movement verbs under their class policy.
- Movement and signature-verb state ride actor snapshots; the prediction shadow
  now builds the real loadout, so a class cannot desync its own client.
- The attract demo is rebuilt: an action-directed shot planner picks and holds
  shots from real match action, one camera owner arbitrates director/race/manual/
  free cameras, free roam flies, and a control dock adds Auto Director, Follow
  Subject, HUD toggle, pause and a Demo Options modal with curated/complete
  rotation and persistent settings.
- Demo fixes: the title reel no longer rebuilds its scenario every rendered
  frame (no shot held, 0.17 fps) and returning to auto resets the camera owner.
- Honest scope: Phase 3 (specs/gear/riders), the `mobility` bind, protocol v3
  and the TTK/tier balance sweeps are future phases; specs and gear are inert
  data for now.

### v6.4 · SPECTRUM — 2026-09-17
- Surfaces derive albedo, roughness and normal from one seamless multi-scale
  height/wear field (tiling repetition reduced, real relief, per-material
  weathering); the moth macro/fracture enhancer now applies to every natural
  surface; day/dusk/night sky palettes, haze and de-neoned ambience.
- A composed soundtrack (eight-bar phrases, staged combat layers, a
  scene/intensity transition machine, seeded risers, panning and reverb sends)
  and layered gameplay sound (weapon reports, surface impacts and ricochets,
  bounded debris, movement foley, wind/tension beds). The cavern reverb IR
  loads again and retries on failure.
- A restrained HUD: one vitals card, grouped action gauges, one contextual
  objective chip, capped kill feed, settled hints, and a visible REDUCED MOTION
  indicator with settings copy.
- Resolution adapts to the display: a pixel-budget cap (Auto/1080p/1440p/Native)
  plus dynamic resolution scaling, so 4K at 100% renders a 1080p-class buffer
  and the frame-time governor trades pixels before quality tiers. Calmer glow
  defaults; benchmarks stay true native.
- The first full-suite gate fixed 36 pre-existing phase-1 failures (campaign
  pins, placement sweeps, next-gen expectations, a singleplayer driver hang) and
  the review-harness lint error.

### v6.3 · RESONANCE — 2026-09-16
- A composed procedural soundtrack (menu/exploration/combat sharing one theme
  and progression, with bass, percussion, arpeggio and lead, phrase fills and
  layered intensity) replaces the single low drone, scheduled on the
  AudioContext clock with bounded look-ahead. The audio engine is now actually
  connected to `ArenaView`, so music plays in a quiet menu and quiet gameplay.
- Master mute, Music/Effects/Ambience sliders, a Preview action and a blocked
  audio status live in settings; mute/music preferences survive. Announcer cues
  have one owner, and combat intensity is fed from the event-dispatch stage.
- First-person interpolation is completed at the simulation boundary: per-tick
  snapshots blend the camera, actors, vehicles and projectiles; mouse-look stays
  immediate; history resets on match/teleport/seek and pause freezes cleanly.
- Static worlds batch floors (one material mesh) and visible blocks by material
  within spatial chunks on WebGL at unchanged 100% scale; terrain gets
  crease-aware smoothed normals.
- Scopes: the cross passes through the true centre, the dot is bounded and
  circular, the reticle follows live ADS weapon swaps, and magnification uses
  `2*atan(tan(fov/2)/mag)`.
- Trustworthy perf tooling: full-frame GPU timing including the weapon pass, a
  world/weapon CPU split, `tokenArenaPerf` GPU propagation and a callable
  `tokenArenaBenchmark.run()`; shader warmup is connected to scene preparation
  with a bounded, token-guarded compile and a "preparing" state.

### v6.2 · CADENCE — 2026-09-16
- Scopes and ironsights are physically mounted (base plate, support posts, clamp
  rings), not floating, and integrated Rail Lance/Marksman scopes now zoom with a
  lens-warped SVG reticle driven by one active-sight resolver; mounted optics are
  a middle magnification, irons keep the floored ADS pull-in.
- ADS recoil no longer doubles through the transition: a neutral hip pose blends
  with the solved ADS pose first, then distinct sway/recoil/reload/switch channels
  are applied exactly once.
- Near-wall shots clamp the visual tracer origin before the impact (degenerate
  traces are suppressed) while the impact flash and real barrel muzzle remain.
- Third-person operators/pickups use a simplified weapon silhouette that still
  exposes its type and barrel-tip anchor; transparent effects and tagged greebles
  no longer cast shadows.
- Opt-in presentation interpolation blends the previous/current actor transforms
  by the fixed-step fraction (short-way yaw, snaps on teleport); 60/120/144 Hz
  presentation of one 60 Hz sim stays consistent and never touches sim state.
- Honest baseline tooling: renderer/GPU identification, scene-vs-submit CPU split
  and GPU time only from a real async WebGL2 timer query; `compileAsync` shader
  warmup; bounded viewmodel cache.
- Compatibility: `renderer.info.reset` is optional-chained and the CPU
  SoftwareRenderer exposes a compatible `info.reset()`, so software-only
  environments no longer throw every frame.

### v6.1 · SIGHTLINE — 2026-09-16
- Every weapon's sights/scopes are rigged on a clear line above the model's top
  profile, so rails, rods, tanks and sight bases no longer block the bore (proved
  by a per-weapon raycast test).
- ADS holds the gun body at a fixed distance instead of pinning eye relief, so
  weapons with forward rear sights no longer fill the screen with the receiver.
- A dedicated ADS reticle replaces the hip crosshair while aiming; local tracers
  start on the camera aim ray at the muzzle depth, so shots read from the reticle.
- The Pulse Rifle gets a visible charging handle, and ADS now carries recoil
  pitch/roll.

### v6.0 · CLARITY — 2026-09-16
- Iron sights, holographic sights and scopes are rebuilt with real open apertures
  (notch, ring, thin frame, open-ended tube) so the target is visible through the
  sight; ADS is solved from each weapon's real anchors after its final scale.
- Auto quality is automatic again (the saved `auto` value no longer pins a tier)
  and the governor uses sustained thresholds plus a cooldown, so fixed tiers stay
  fixed and quality cannot oscillate.
- Quality changes reduce real work: zero-strength bloom is omitted, bloom
  extraction has its own capped budget, FXAA/vignette are tier-gated, the shadow
  target is resized correctly, dynamic shadows refresh on an elapsed-time 20–30 Hz
  budget, and WebGL gets geometry LOD.
- Performance counters are trustworthy (reset once per presented frame, totals
  across all passes) and report viewport, buffer size, tier, passes, draw calls,
  triangles, CPU phases and frame-time median/p95, plus a fixed benchmark preset
  with a copyable report.
- New controls for effects quality, camera shake and weapon bob; cached
  viewmodels; recorder snapshots only built when a keyframe is due. Long
  hardware-bound matches are opt-in via `COCS_SLOW_TESTS=1`.

### v5.6 · ARSENAL — 2026-09-16
- Weapons are rebuilt around per-weapon anchors and sight lines: ADS resolves to
  each gun's own sights and optic, and no shared rail is bolted onto every model.
- Moving parts animate from real reload progress (SMG magazine, Scattergun break
  action, Rocket loading, Rail Lance cell) with the bolt cycling on shots, and
  weapon swaps hold the outgoing gun until the new one rises.
- The viewmodel renders in its own scene/camera so its parts keep correct depth
  without clipping into the world.
- Movement no longer dominates accuracy, spread is applied perpendicular to aim,
  and the crosshair uses the same effective-spread calculation.
- Bots share one weapon-switch operation with players and navigate with A*
  routing, reachable cover, lateral flanks and cached routes; spawns weigh
  threats, exposure, projectiles and a death heatmap.
- Composer gets explicit FXAA and survives zero bloom; texture channels share one
  height field.

## Parody and attribution

Every operator and harness blurb is affectionate parody — jokes about the vibes
and internet lore around each tool, not claims about what the products do. The
operators are fictional robots, and no affiliation with or endorsement by any real
company is implied. All geometry, textures and sound are generated procedurally in
this repository; no third-party game assets are used.

## License

No open-source license is currently declared in this repository. The code is
published here for the live game and for reading; please contact the author before
reusing it. Dependencies remain under their own licenses.
