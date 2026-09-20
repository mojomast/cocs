# Quality-of-life and fidelity pass

**Date:** 2026-09-20
**Scope:** a broad pass across graphics, sound, gameplay and quality of life:
visual fidelity fixes, audio coverage and music identity, bot/mode gameplay
parity, online lobby UX, and HUD/settings ergonomics. Companion to
[COMBAT-PASS.md](COMBAT-PASS.md), [ANIMATION-PASS.md](ANIMATION-PASS.md) and
[GRAPHICS-EDGE-PLAN.md](GRAPHICS-EDGE-PLAN.md).

## Graphics fidelity

- **Decals are real decals now:** impact marks orient perpendicular to the shot
  direction (flat only for near-vertical hits), share one procedural radial
  alpha mask, and explosions/vehicle kills/alt blasts stamp a scorch ring.
- **Explosions light their surroundings:** the fixed muzzle-light pool grew to
  four slots and each blast pulses a light plus slow smoke motes (bounded,
  WebGL-only, reduced-motion static scorch).
- **Weather reads as weather:** rain/storm drops render as velocity-aligned
  streaks with pooled ground ripples, and the particle cap now scales from the
  preset instead of the ambient pool.
- **Contact shadows** ground actors and vehicles on WebGL (the CPU renderer
  keeps its byte-identical blob shadows).
- **Texture sampling and texel density:** procedural canvas maps get the same
  mip/anisotropy policy as the baked Moth textures, and floor UV repeat is tied
  to the 5 m tile so density no longer drifts with arena size.
- **Shadow frustum:** the ortho camera now follows the view in a 40 m
  quantized box on the existing refresh cadence instead of covering the whole
  arena, sharpening every shadow for free.
- **Small repairs:** `updateMoth(time)` is finally called (the iridescent film
  was frozen), bloom threshold/radius vary by tier, and the low-tier composer
  path keeps 2× MSAA when FXAA is off (lab-aware).

## Sound and music

- **LATTICE Ops earcons:** 20+ `director-*`/`coop-*` beats (spawn telegraphs,
  escalation, boss, phase, retarget, overrun, denial, reinforce, HQ damage,
  resupply, bonus, reserve, operation summary, buys, order completes) got
  distinct motifs and captions; HQ damage is an edge/loop warning.
- **Match punctuation:** a FIGHT sting on match start, 3-2-1-GO beeps for race
  and soccer countdowns (timer-free, edge-detected), and a final-10-seconds
  warning.
- **Weapon handling:** reloads use the event's own duration to seat the
  magazine, switches split into holster + draw, and dryfire has an
  empty-chamber identity.
- **On-hit bundle:** vehicle damage pings the driver, low health gets a
  one-shot entry warning, respawn boots up, and `hitDirection(angle, amount)`
  pans the local thud with the HUD's damage bearing.
- **Throttling:** zone-progress cues quantize to buckets/flips and periodic HQ
  damage no longer spams.
- **Ambience:** biome moods route to the audio bed, precipitation has a noise
  presence, and the Moth layer's `setWeather` forwarding, descriptor gain and
  silent-missing-bed handling are fixed.
- **Music:** `cocs`/`cocs-coop` mode themes, the menu motif restores after an
  outcome, mode themes ride the Halo pack, and the effects bus gained a
  compressor/soft-clip so layered explosions cannot clip.
- **Feedback:** per-kind pickup motifs, captions for the new cues, and a shared
  caption priority queue so bursts cannot clobber an important line.

## Gameplay

- **Bots use alt fire:** a per-weapon preference table (range, ammo, health,
  target geometry) with a 4 s repeat and situational gates; bots briefly set
  `a.alt` so players see the weapon morph. Balance-sweep alarms were used to
  tighten the policy rather than loosen thresholds.
- **Payload bots escort the moving cart:** attackers ride/push it and detach to
  clear defenders ahead of the route; defenders contest and roll back instead
  of holding stale checkpoint circles.
- **Mode spread:** juggernaut 1→19 maps, team-elimination 1→17, vip-escort
  2→17, holdout/uplink 5→26 each, armsrace 8→15, assault 6→21.
- **Sudden death** is explicit on instagib/rockets/arsenal, and the existing
  `suddenDeath`/`endless` flags are now first-class mutators.
- **KOTH rotation** is built from the same authored/nav capture points the
  objective template uses, so maps without `objectiveZones` rotate hills too.

## Online quality of life

- **Lobby lifecycle is surfaced end to end:** READY toggles with counts, host
  warmup start/cancel with countdown, map-vote tallies and voting, and rematch
  votes — all mirroring `lifecycle()` from the server (protocol unchanged).
- **Real RTT ping:** a bounded 1.5 s PING/PONG loop with an EWMA, stamped onto
  the local scoreboard row the Ping column always promised.
- **Destructive actions confirm:** leaving a live/rated match asks first and
  surfaces the ~20 s seat-hold window with a reconnect countdown.

## HUD and settings

- **Damage/death attribution:** a short non-live `HIT BY X · WEAPON · 42`
  direction chip plus killer/weapon on the death card, with the directional
  audio thud following the same bearing.
- **Settings IA:** the Game tab is split into Audio / Video / Controls /
  Accessibility sections, with the master volume and announcer toggle exposed,
  and captions/reduced motion/palettes/contrast/UI scale consolidated.
- **Global UI/HUD text scale:** `--ui-scale` now reaches HUD cards, kill feed,
  captions and scoreboard within the existing compact stops.
- **Safety:** preset eviction warns with `n/8` and offers undo, theater deletes
  offer undo plus a usage meter, storage failures surface instead of being
  swallowed, and both modal focus traps use the shared selector.

## Verification

- Gate: 2,836/2,844 game tests (8 approved skips), 212 server, 100 SSR/UI,
  typecheck, verified build, lint 0 errors.
- Graphics-lab harness green; local and production browser matrices 5/5,
  including the LATTICE short-landscape flow.
- Audio host wiring (match state/countdown, weather kind, biome mood) is
  connected from the page and view.
