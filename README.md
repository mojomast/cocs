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

![version](https://img.shields.io/badge/version-v4.7%20SPECTACLE-2dd4bf)
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
  victory/defeat cues that follow the mode and mood.
- **A living menu**: a shuffled reel of real bot matches behind the UI, with a
  broadcast lower-third reporting the live mode, map, score and objective.

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
scripts/    Build, version, deployment verification
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

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module map, data flow, invariants, extension guide. |
| [docs/SYSTEMS.md](docs/SYSTEMS.md) | Deep reference for every game system. |
| [docs/TESTING.md](docs/TESTING.md) | Test layers, contracts and limitations. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting and deploy verification. |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | The complete release history. |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Dated evidence and known gaps. |
| [docs/spec/](docs/spec/) | Historical specification and development plan. |

## Changelog

The last five releases. The full history lives in
[docs/CHANGELOG.md](docs/CHANGELOG.md).

### v5.0 · COMPACT — 2026-09-16
- Snapshots travel as compact patches: id-keyed actor/rocket/pickup arrays are
  diffed element by element against the previous frame, cutting a full 8v8 frame
  from ~30 KB to ~3 KB (~90%).
- Only clients that advertised support receive deltas; a once-a-second keyframe
  lets a client that missed a frame re-sync.
- Delta/full counts surface in the game server's status JSON and the debug hook.

### v4.17 · STREAMLINE — 2026-09-16
- The live render path shares the exported snapshot interpolator with the deterministic
  net harness, so the two cannot drift apart.
- A control message larger than the transport budget no longer blocks every later
  reply: congested sockets drain essential replies through a pure, tested scheduler.
- Dead exports removed across the race camera, vehicles, showcase, models, arenas,
  presets, progression and bot code.

### v4.16 · SIGNAL — 2026-09-16
- The title demo keeps cycling under Reduce motion / saved display settings instead
  of dropping to the operator preview after the first scenario.
- BEST ACCURACY and MOST DAMAGE awards fire: the sim tracks per-actor shots, hits
  and damage.
- Matchmaking keeps a queued player's career identity; lobby/matchmaking wire verbs
  are declared in the shared MESSAGE list with a drift test.

### v4.15 · AMBIENT — 2026-09-16
- The fullscreen demo controls gain music, ambience and announcer toggles plus an
  environment (weather) picker: AUTO, clear, overcast, rain, snow, ash, storm.
- Pinned weather now holds through the whole demo; the choices persist across
  sessions.

### v4.14 · TUNED — 2026-09-16
- Holdout/Uplink/VIP Escort show the correct brief, scoreboard columns, ranking and
  match-start target; Juggernaut/Team Elimination banner sudden death again.
- Bots treat the objective variants as objective modes; campaign announce beats
  surface as HUD notices.
- Server vote quorums ignore disconnected peers and a reconnect must re-ready;
  menu focus, Theater camera hotkeys and the title overlay got fixes.

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
