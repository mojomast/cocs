# Phase 2 — Gameplay Sound Handoff

Workstream: **gameplay sound** (layered weapons, impacts, movement foley,
ambience and space). Owner files: `game/feedback.mjs`, `game/feedback.test.mjs`,
`game/sfx-design.mjs` (new). `game/music.mjs` is owned by the music workstream
and was not edited; `game/view.mjs` and `app/**` are lead-owned and were not
edited.

Verification (worktree `/home/mojo/projects/tokenarena-phase2`, run after the
other workstreams' uncommitted changes were already present):

```
node --test --test-timeout=120000 game/feedback.test.mjs game/weather.test.mjs
# tests 50, pass 50, fail 0
```

Additional bounded runs while developing: `game/sp-improvements.test.mjs`
(13/13 pass — it pins SynthAudio durations), `game/environment.test.mjs`,
`game/weapon-presentation.test.mjs`, `game/moth-assets.test.mjs` (38/38 pass).
`game/view.test.mjs` has 2 pre-existing failures on this branch (`atrium: cliff
terrain draws strata`, `the gun anchor keeps its mount point`) that also fail
with `game/feedback.mjs` reverted to HEAD; they are unrelated to audio.

---

## 1. New / changed sound design

Everything is original Web Audio synthesis. No samples, no network fetches, no
new dependencies. `game/sfx-design.mjs` holds the pure tables and deterministic
helpers; `game/feedback.mjs` builds nodes from them.

### Weapon reports (`_gunshot`, `_chaingun`)
- Each shot is now a **layered report in one voice token**: transient crack,
  filtered body, tonal thump, sub, one family layer and a decaying tail.
  Families come from the existing `GUN_STYLES`/`REPORTS` tables (`rifle`,
  `heavy`, `zap`, `burst`, `plasma`, `sharp`, `rapid`), each with its own tail
  length/brightness and extra layer (supersonic snap, double thump, electric
  sizzle, bloom, crack, tight chatter).
- Per-shot variation is deterministic from the event seed (`id`/`time`/`weapon`)
  through `reportVariation()`: ±4.5% body pitch, ±11% brightness, ±25% tail.
  The same event always synthesizes identically (replays match); consecutive
  shots differ. `_chaingun` keeps its own bounded random wobble and 30 ms dedupe.
- Distance shaping (`bright = .55 + .45*vol`) rolls off the high end of far
  reports so distant fights stay audible without full-bright fatigue. This is a
  cheap distance/occlusion approximation, not a real occlusion query.

### Impacts and explosions
- New `_impact(t,out,nodes,{vol,surface,ricochet})`: surface-aware transient,
  material tick, optional ricochet whine (metal/wood) and up to three debris
  ticks (concrete/stone/gravel). Surface profiles: concrete, metal, grass, sand,
  gravel, wood, snow, stone, dirt, water, default (`IMPACT_SURFACES`).
- Shots whose event `hit` is falsy and whose `to` endpoint is close enough now
  add a surface impact/ricochet at the endpoint **inside the shot's voice
  token**. Actor hits (`hit` truthy) do not double up.
- Explosions gain a supersonic crack when close, a longer sub tail, a
  deterministic debris tail (`_debris`, capped at 4 chips) and a space send.
  Vehicle destruction gets the same bounded debris treatment.

### Movement foley
- Surface-aware footsteps, landings, jumps and slides. Profiles:
  `FOOTSTEP_SURFACES` (metal, concrete, grass, sand, gravel, wood, snow, stone,
  dirt, water, default). Default values reproduce the phase-1 numbers exactly;
  unknown/missing surfaces fall back to `default`.
- New take-off cue (`_jump`) on the grounded→airborne transition.
- Landing keeps the fall-speed scaling (`impact = |vy|/13`, threshold `.12`).
- Slide friction is now its own `_slide` tick with surface shaping, still on the
  same bounded cadence (start + 8/s while sliding).
- Variant counters (`stepVariant`, `landVariant`, `jumpVariant`, `reloadVariant`)
  keep rotating 0..2 so repeated actions do not phase into one sample.

### Ambience, tension and match beats
- The ambience bed now owns three continuous layers: the original lowpass
  hiss + sub tone (unchanged `bed.f`/`bed.osc`/`bed.g`/`bed.og`), a **wind bed**
  (bandpassed noise with a 0.07 Hz gust LFO) and a **tension drone** whose gain
  follows `setIntensity` squared. Mood profiles gained `air`, `windFreq`, `wind`,
  `tense`, `tenseFreq`.
- Animations: `setBedMood`, `setIntensity` and `setWind` ease the running layers
  without restarting nodes; `setAmbient(false)`/`dispose()` tear every layer down.
- Objective/flag/pickup cues are motif-based and **retuned to the active mode
  root** (`MODE_THEMES`, or `HALO_THEME` when the halo soundtrack is selected).
  New match-beat cues (`EVENT_CUES`) cover zone ticks, payload/assault/hold,
  uplink, objective win/tiebreak/sudden death, horde waves, boss beats, VIP,
  arms race, bounty, lifetime events and enemy flank.
- Announcer cues are now three-note motifs (`freq → mid → end`) with the same
  opt-in gate, cue ids and 250 ms dedupe. Victory/defeat stings add a low body
  drone and shimmer inside the existing single voice.
- Local ability/deployable foley added for `dash`, `jam`, `deployable*`,
  `phalanx-shield`, `enemy-artillery`, `enemy-detonate`, `enemy-flank`; `fall`
  gets a wind-rush thud.

### Space / mix
- `_ensureBuses()` builds a shared **space send** when `DelayNode` exists: one
  delay line (0.16 s), damped feedback (0.34) and a wet return into the effects
  bus. Reports, explosions, thunder, stings and beats send a fraction of their
  output there. Contexts without `createDelay` (including every Node test
  fixture) skip it cleanly.
- Bus structure and mute semantics are unchanged: master → muteGain →
  destination, with effects/ambience/music buses preserved; sends route through
  the effects bus so master mute silences tails immediately.
- Voice cap is still 30 `_play` tokens; a sent voice costs exactly one extra
  gain node, and a shot's whole layer stack costs one token.

---

## 2. New/optional public API (exact signatures)

All existing methods, tables (`EMPTY_CHANNELS`, `MODE_THEMES`), pinned voice-cap
and dedupe semantics are unchanged. New/optional surface:

| Method | Signature | Notes |
| --- | --- | --- |
| `update` | `update(player, vehicles=[], dt=0, opts=null)` | New optional 4th argument. `opts.surface` (string), `opts.surfaceAt(x,z)` (function) or `player.surface` supply the movement material; existing 3-arg calls behave exactly as before. |
| `setSurfaceResolver` | `setSurfaceResolver(fn)` | `fn(x,z,player) -> string\|null`, stored and used as the last fallback for the local player's movement foley. Pass a non-function to clear. Returns the stored resolver. |
| `setWind` | `setWind(strength)` | Optional wind override `0..3`; clamped, non-finite clears the override (mood wind applies), eases the running wind layer. Returns the stored override or `null`. |
| `audioStatus` | `audioStatus()` | Adds a `reverb` field: `'off' \| 'pending' \| 'loading' \| 'ready'`. |
| `event` | `event(e, player)` | Unchanged call shape. Optional event fields are read when present: `e.surface`/`e.material` (shot impact, melee), which stay optional — no producer is required for correct sound. |

New exported pure module `game/sfx-design.mjs`:

```
surfaceKind(value) -> 'default'|'concrete'|'metal'|...   // alias-normalising
footstepProfile(surface) -> frozen {bright,body,gain,q,ring?,scatter?,splash?}
impactProfile(surface)   -> frozen {type,freq,q,gain,tone,end,ring?,decay?,debris?,splash?}
reportStyle(style)       -> frozen {pitch,transient,body,sub,tail,tailFreq,layers}
reportVariation(style,seed) -> frozen {style,pitch,bright,tail}   // bounded
eventSeed(e)             -> uint32
mixUnit(seed)            -> [0,1) deterministic hash
SURFACE_KINDS, FOOTSTEP_SURFACES, IMPACT_SURFACES, REPORT_STYLES
```

---

## 3. Lead-owned integration hooks

Nothing below is required for the current behaviour; `update(...)` without
`opts` already delivers everything above with the default surface, and no event
field must be added. These are the hooks that make surfaces accurate:

1. **Surface for the local player** — `app/page.tsx:236` (network loop,
   `audio.update(me,s.vehicles,elapsed)`) and `app/page.tsx:252` (single-player
   loop). Pass a fourth argument, e.g.
   `audio.update(me,s.vehicles,elapsed,{surfaceAt:(x,z)=>terrainSupportAt(x,z,match.terrain)?.material})`
   (or `r.net.viewMatch()?.arena?.terrain` for netplay), or set `me.surface`
   once per snapshot. `terrainSupportAt` returns `{y,normal,surfaceId,material}`
   (`game/terrain.mjs:90`), so the material string plugs straight in. The
   resolver is only called for the local player and at most once per frame.
   Alternative wiring without touching the call sites:
   `audio.setSurfaceResolver((x,z)=>terrainSupportAt(x,z,terrain)?.material)`.
2. **Per-event surfaces** — if the simulation ever adds `surface`/`material`
   to `shot` or `melee` events (e.g. `terrainSupportAt` at the impact point),
   `audio.event` already reads it for surface impacts and melee cracks.
3. **Weather wind** — `game/view.mjs:1415` already hands the weather mood to
   `setBedMood`; `state.preset.wind` (`game/environment.mjs:321-326`) can be
   forwarded with `this.viewAudio?.setWind?.(state.preset?.wind)` when the
   preset changes if you want gust strength to track the authored preset
   exactly instead of the mood default.
4. **Announcer / stings / mode theme** — unchanged hooks at
   `game/view.mjs:1211` (`announcerCue`), `game/view.mjs:1361` (`sting`),
   `game/view.mjs:1108` (`setModeTheme`), `game/view.mjs:1415` (`setBedMood`),
   `game/view.mjs:1457` (`thunder`), `game/view.mjs:1514` (`setIntensity`).
5. **Reverb** — `app/page.tsx:183` still calls
   `audio.setReverbUrl(cavernIr.url,0.42)`. No change needed; behaviour is now
   retry-safe (see below).

---

## 4. The `/moth/files/ir-cavern/result.wav` 404

Findings (verified in this worktree at HEAD `5d6234b`):

- The only URL the Moth registry publishes is the cavern IR
  (`game/moth-baked.mjs:682`), and `mothIr('cavern')` resolves it
  (`game/moth-assets.mjs:148`). Motifs and textures are inline data, not URLs.
- The renamed file is committed at `public/moth/files/ir-cavern/result.wav`
  (`git ls-files` confirms it), so a Next.js build serves the exact manifest URL.
  Other extensioned downloads in that tree are still sanitized
  (`ir-json`, `taps-json`, `result-midi`, ...), but nothing references them at
  runtime today; if a future manifest URL points at those names it will 404 for
  the same reason the IR did.
- **Audio-side issue found and fixed:** `unlock()` set `reverbLoaded = true`
  *before* the async fetch/decode completed. A 404 therefore latched the IR as
  "loaded" for the whole session with `musicEngine.reverb` still null — no
  retry, no visible status. `settle()` now starts one in-flight load, latches
  `reverbLoaded` only on success (`feedback.mjs` around `unlock`), and
  `setReverbUrl` clears the pending flag. `audioStatus().reverb` reports
  `off/pending/loading/ready` so a blocked or 404ing IR is diagnosable.
- If the live site still logs the 404 after this branch deploys, confirm that
  the deployed build copied `public/` (the file is 344 KiB and must be in the
  release), and that `cavernIr?.url` is actually being passed — the 404 can only
  come from the fetch in `loadMusicReverb` (`feedback.mjs`).

---

## 5. Risks / unknowns

- **Node budget:** a shot is one voice token but now up to ~10 nodes (report +
  impact layers). The 30-token cap bounds simultaneous voices, not nodes; a
  30-voice worst case is ~300 transient nodes for ≤ ~1 s, which is normal for
  Web Audio but has not been profiled on real hardware here. Debris/impact
  counts are hard-capped (4 debris, 3 impact chips, 6 nodes per impact).
- **Surface hook cost:** resolving terrain per frame only happens when the lead
  adds a resolver; `terrainSupportAt` walks triangles and is cached per call for
  the query point only, so call it once per frame (the hook already does).
- **Space send taste:** the shared delay is intentionally subtle (0.34 feedback,
  2 kHz damping). If it sounds muddy in a busy fight, reduce the `send` values
  in `_gunshot`/`_play` calls rather than the master mix.
- **Retry timing:** the IR now retries on each `unlock()` (user gesture/start)
  until it succeeds. A permanently missing file means one failed fetch per
  unlock, not a per-frame loop.
- **Pinned expectations:** no existing assertion was weakened. The only new
  branches that change old output are richer layers inside the same voice
  (`_play` call counts and pinned damage/sting/reload durations are unchanged),
  and pickup/flag/zone cues now use mode-root motifs instead of the old fixed
  two-note pairs (no test pinned those frequencies).
- **Not verified:** real-hardware loudness balance, headphone stereo image,
  100% render-scale readability in a live match, and browser autoplay edge
  cases remain manual-review items.
