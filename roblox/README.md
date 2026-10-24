# COCS on Roblox — v1

Free-for-all in **The Exchange**, with bots, the COCS operator roster, and three weapons. This is a Rojo/Luau place that syncs into Roblox Studio. It does not replace the browser game in `game/` and `app/`.

The fantasy is the same: AI operators in a small industrial arena, Quake-ish pace, hits that are not a stock Roblox tool. v1 is a playable slice, not a port of all 21 modes.

## Arena

**The Exchange** (`game/maps.mjs`, id `exchange`). It is the original COCS chamber: a ~30 m pit, a central reactor that blocks sightlines, four low covers, and a raised gantry.

In the web simulation the gantry is the **−Z** end (the spec’s “north deck”), 3.8 m up, with ramps on the east and west. This place uses that layout. **1 metre = 3 studs.** The eight web spawns are kept, including the three on the gantry. There is no underpass; the deck is solid. Falling out of the shell, or getting launched over it, is a kill. A kill within a few seconds of taking damage is credited to that attacker.

The web map’s rail pedestal (gantry) and plasma pedestal are **rocket** and **scatter** ammo. v1 only has three guns, and the high ground should still pay out a power weapon.

## Operators

All nine operators from `game/data.mjs`. Health, spawn armor, and speed are those numbers (they differ slightly from the older table in the root README). Each operator is locked to one signature harness. Claude stays on Guardrail.

| Operator | HP | Armor | Speed | Harness | Read |
|---|---:|---:|---:|---|---|
| ChatGPT | 100 | 5 | 8.6 | Codex · Recompile | Heal 45 |
| Claude | 120 | 10 | 7.8 | Claude Code · Guardrail | Half damage for 3.5 s |
| Grok | 110 | 0 | 8.9 | OpenClaw · Claw Burst | Shove + 30 damage |
| Meta | 104 | 20 | 7.6 | Roo Code · Context Jam | Nearby enemies at half speed |
| Gemini | 100 | 10 | 9.0 | Hermes · Courier Rush | 1.6× speed for 3.5 s |
| DeepSeek | 126 | 0 | 7.7 | Codex · Recompile | The tank that patches itself |
| Mistral | 112 | 0 | 9.2 | Hermes · Courier Rush | Fastest body in the pit |
| Kimi | 90 | 10 | 8.7 | OpenClaw · Claw Burst | Fragile, with a shove |
| Qwen | 108 | 10 | 8.5 | Hermes · Courier Rush | Mid stats, a sprint button |

Bodies are colored parts: ball head, antenna, rings, visor, fin, crest, shoulder pads. No asset pipeline.

Press **Q** for the harness. Armor eats 60% of damage until it runs out (cap 100). Spawn protection lasts 1.5 s and ends early if you fire or use the harness.

## Weapons

| Slot | Weapon | Feel |
|---|---|---|
| 1 | **Pulse Rifle** | Hitscan, unlimited ammo, 11 damage, 0.1 s cadence. Bloom grows while you spray and while you move, and sprint opens it further. Damage falls off from 16 m to 70 m. |
| 2 | **Rocket Launcher** | Server-moved projectile, 36 m/s. 35 direct + up to 60 splash in 4 m. Splash is blocked by the reactor and other cover. It will kill you. Starts with 6, cap 18. |
| 3 | **Scattergun** | 8 pellets, wide cone, nasty inside ~6 m, weak by 24 m. Starts with 10, cap 30. |

You spawn with a starter stack of rockets and shells so a bot match is immediately more than the pulse. Pickups on the map refill them. Respawning puts the starter stack back; you do not keep a hoard. The camera kicks on your machine. The server does not trust that kick: it fires from your head along the direction you sent, then adds its own bloom.

## Match

Warmup until you deploy: four bots are already fighting, and their kills do not count. Deploying starts a live round.

- **15 kills** or **5:00**, whichever comes first.
- Kill +1. Suicide, including a dry fall, −1 and a death. A fall right after someone hit you is their kill.
- Respawn in 2 s on the spawn farthest from living enemies.
- Roster target is **5** (you + 4 bots). Extra humans replace bots.
- Results sit for 12 s, then the same operators rematch. **Change operator** drops you back to the select screen. If nobody is left in the match, it returns to warmup.
- Scoreboard is kills/deaths, on the left and on **Tab**.

## Movement

This is Roblox `Humanoid` movement, tuned, not a line-by-line port of `game/movement.mjs`.

- Walk speed is the operator’s m/s × 3.
- **Shift** sprint is ×1.375, applied on the server.
- Jump apex is about 1.5 m. Workspace gravity is 140 (a bit floatier than stock 196) so the jump hangs slightly.
- While airborne, the client adds a small steer toward your move direction, capped near sprint speed. It is not Quake strafe-jump acceleration, crouch, or slide.

Hits, armor, harnesses, pickups, respawns, and the score are server-side. Your character physics are client-owned, which is how Roblox characters work. The server rejects shots that are too fast, shots for a weapon you are not holding, and shots with a nonsense direction.

## Setup

You need [Roblox Studio](https://create.roblox.com/) and [Rojo 7](https://rojo.space/docs/v7/getting-started/installation/).

1. Install the Rojo plugin in Studio (7.x, same major version as the CLI).
2. From this folder:

```bash
cd roblox
rojo serve
```

3. In Studio, create a base place (Baseplate is fine) and connect the Rojo plugin to `localhost:34872`.
4. Press **Play** (F5), not **Run**. Run starts the server without the client UI, so you get bots and no deploy screen.

The server script deletes the default `Baseplate` and any `SpawnLocation` on boot so they do not intersect the pit. `Workspace.StreamingEnabled` is set off in `default.project.json` because the whole arena should exist at once. If a sync does not apply service properties, turn StreamingEnabled off yourself before you play.

### Place files

Source of truth is this Rojo tree (`default.project.json` + `src/`). A binary `.rbxl` is not checked in; those diffs are noise. To build one locally:

```bash
cd roblox
rojo build -o COCS.rbxlx
```

Open `COCS.rbxlx` in Studio if you want a place file instead of a live sync. `*.rbxl` and `*.rbxlx` are gitignored.

## How to play

1. Play Solo. The camera orbits The Exchange while bots fight.
2. Pick an operator. **1–9** highlights a card, **Enter** or **DEPLOY** drops you in.
3. You are in first person.

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Space | Jump |
| Shift | Sprint |
| Click / hold | Fire |
| 1 / 2 / 3 or wheel | Pulse / rocket / scatter |
| Q | Harness |
| Tab | Scoreboard |
| Backspace | Leave and pick another operator |

Bots path around the reactor, take the ramps, grab health when they are hurt, and shoot late with shaky aim. They will hit you. They will also miss, walk into each other, and blow themselves up.

## Project layout

```
roblox/
  default.project.json    Rojo DataModel
  src/shared/             Operators, weapons, Exchange metres, config
  src/server/             Arena build, match, combat, bots, pickups
  src/client/             Select UI, HUD, viewmodel, input
  tests/logic.lua         Falloff, spread, floor, roster (no Studio)
```

`src/server/*.lua` modules are required by `Main.server.lua`. `src/client/Main.client.lua` is the only LocalScript. Shared modules are in ReplicatedStorage and do not grant damage.

## In scope / out of scope

**In this v1**

- One arena, FFA, bots, nine operators, three weapons, one signature harness each.
- Select UI, scoreboard, kill feed, hit marker, damage numbers, pickup pads.
- Server-authoritative damage, armor, splash occlusion, scoring, and the clock.

**Not in this v1** (do not expect them in this place)

- Vehicles, racing, soccer, campaign, horde, and the other modes.
- The other 33 arenas.
- The web game’s LAN / WebSocket netcode, prediction, and reconciliation. Roblox replication is the network.
- The other seven-way harness picker, weapon mods, melee, frags, ADS, reload magazines, crouch, slide, and real strafe jumping.
- Moth quantum assets, progression, XP, ranks, music, and a custom animation set.
- Uploaded audio. v1 is silent on purpose so missing sound ids cannot error.

## Roadmap

1. **Movement.** A custom controller for ground friction, air accel, and slide, with the server checking speed.
2. **Guns.** Rail, plasma, the rest of the rack, magazines, and ADS. Bring the real harness matrix back, including Claude’s lock.
3. **Arenas and modes.** Crosswire and Foundry next, then team deathmatch. Vehicles stay later.
4. **Bots.** The web utility brain (cover, memory, difficulty presets) instead of this waypoint shooter.
5. **Net polish.** Lag compensation for hitscan, interpolated rockets, and a real spectator camera on death.
6. **Presentation.** Procedural or uploaded SFX, operator animation, and a proper viewmodel pass.

## Tests

Studio is the playtest. The shared modules are plain Lua, so from `roblox/`:

```bash
lua5.4 tests/logic.lua
```

That checks falloff, bloom, splash, Exchange floor heights, Claude’s Guardrail lock, and that Mistral is faster than Meta. It does not start a place. The official `luau` CLI sandbox has no `io` library, so it cannot load those files itself.

In Studio, the output line `[COCS] The Exchange is up` means the server booted. Deploy, shoot the reactor (the pulse should stop on it), walk both ramps onto the gantry, eat a rocket splash, and stay until the frag limit or the clock. Backspace should return you to the roster without deleting the place.
