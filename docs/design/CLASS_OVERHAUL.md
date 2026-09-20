# COCS class & harness overhaul — design plan

> **Status:** scope approved · 2026-09-17 · design decisions locked (§10), not
> yet implemented.
> Goal: make the operator and harness pick the single most identity-defining
> decision in the game. Every LLM plays like its own class; every harness
> changes *how* that class is played, not just which button it has.

---

## 1. Where we are today

The choice *looks* meaningful on the selection screen and isn't in the match.

| Layer | What it currently contributes | Actual impact |
|---|---|---|
| Operator | `stats:{health,armor,speed}` + color/silhouette greebles (`game/data.mjs:1-11`) | 85–120 HP, 0–20 armor, 7.4–9.4 m/s; effective EHP span ≈1.6× (armor absorbs 60%) and no verbs |
| Harness passive | ±2–5% speed/damage, 0–4% resistance (`game/harness-profiles.mjs:10-53`) | imperceptible |
| Harness weapon affinity | 2 "preferred" weapons, +3% damage, ±~8% interval/spread | barely felt; the emitted `handling.affinity` copy is unread |
| Harness ability | one of 7 hardcoded effects (dispatch `core.mjs:404-408`; effect sites `:375`, `:450`, `:101`) | the only felt difference |
| Bot personality | role + personality archetypes (`operator-profiles.mjs`, `bot-personalities.mjs`) | AI-only; humans never see it |
| Everything else | 10 weapons, attachments, gear, 5 powerups, killstreaks, mode loadouts | **dominates the actual power curve** |

Two structural problems follow:

1. **Stats are invisible; verbs are felt.** Nobody can feel 7.4 vs 8.3 m/s, but
   everybody can feel a dash they can aim. Today operators have zero verbs.
2. **The harness's one ability carries the entire identity load**, and it is a
   hardcoded `if (id === ...)` chain with leftover fields. `vehicle.label` and
   the emitted `affinity`/`activeFireRate` copies are unread, but
   `vehicle.repair` is **live** (`core.mjs:340`) and the `favored` path is
   driven by `weapons.affinity` (`harness-profiles.mjs:95` → `core.mjs:450`);
   neither can be deleted blindly in the cleanup.

The harness profile comment (`harness-profiles.mjs:4-6`) says tuning is
"deliberately small" to avoid compound multipliers. That instinct is right —
this plan keeps the *numbers* small and makes the *verbs* large.

---

## 2. Principles (from shipped games and design literature)

These are the rules the plan is built to satisfy, not decoration.

1. **Every class needs a fantasy verb, and an enemy who can name it.**
   TF2's classes are remembered by verbs: double-jump, rocket-jump, disguise,
   uber, sentry. Valve's own Heavy design brief requires new ideas to "deepen
   the skill curve" and "not significantly encroach on another class's role."
2. **Clear strengths *and* clear weaknesses. Everyone has something to fear.**
   Robin Walker: "with TF2 we've been much better about making sure everyone has
   those weaknesses… you have this Achilles heel you have to keep watching for."
3. **Specialists are the point; strict upgrades are the enemy.** An LLM may be
   *drastically* better than the rest at its thing — speed, space, range, info,
   whatever its fantasy is. What is forbidden is an option that is better at
   everything (a "god tier" pick) or one nobody can win with (a "garbage tier"
   pick). Balance means every option has a domain, not that every option is
   equal. (Sirlin's tier discipline; StarCraft's asymmetric races.)
4. **Clarity is the bedrock; counterplay must be inferable.**
   Overwatch's art/design pillars: characters must be "immediately identifiable
   in the middle of battle" and ability impact "clear enough to inform
   counterplay so that enemies infer how to respond."
5. **How harsh counters may be depends on the escape hatch.** Where the game
   lets you swap at respawn (team modes), brutal matchups — even 70/30 — are
   spice, and counter-picking becomes part of the meta. Where picks lock (FFA
   and solo modes), keep worst-case pairings survivable (≈35/65 or better) and
   give bad domains a universal answer: pickups, vehicles, map routes, or team
   play.
6. **Power budget inside a class; tier discipline across the roster.** Each kit
   may skew hard — a specialist overspends on its axis and pays on the others.
   But roster balance is judged by tiers and viability, not equal win rates:
   first empty the god tier, then the garbage tier, then compress the gaps. A
   strong top tier is allowed and sets the benchmark; raise the bottom instead
   of gutting the top.
7. **Commitment and wind-up beat free value.** The Overwatch team's lesson from
   Sombra and Moira: abilities that require committing, aiming or timing can be
   powerful; fire-and-forget value frustrates. Illari's pylon is the cautionary
   tale — "it can feel invisible throughout a match."
8. **An ability that is never telegraphed is never counterplay.** Every strong
   effect needs audio, VFX, and ideally a wind-up window the opponent can read.
9. **Small kits, bounded inputs: one combat active + one movement verb.** Each
   actor gets its harness active (the existing `power` input) plus a class
   movement capability. Movement verbs should ride existing inputs (jump/crouch
   hold and double-press) wherever possible; only aimed verbs (grapple, rope,
   blink) may claim one shared new binding. No ultimates, no third button.
10. **Bots must express the class.** This is a bot-first game. If the AI doesn't
    dash, brace, and take long lanes, human players never see class identity.
11. **At least viable everywhere, sometimes clearly best.** Every class must be
    able to complete every mode's objective; being dominant in some modes and
    merely viable in others is desirable. No mode-locked kits, and no kit whose
    only value is a gadget (a flag-only or vehicle-only power masks a bad
    class).
12. **Self-balancing forces before special cases.** Prefer global fail-safes
    that catch unknown problems — universal mobility, pickups, vehicles, spawn
    protection, melee/frag, team modes — over per-matchup patches. A
    special-case damage table is a cheat that breaks player intuition.
13. **Balance data double-checks instinct; it does not drive design.** Kaplan:
    "We don't like to use the data to drive design… we use the data to double-check
    our design instincts." Automated sweeps flag outliers; humans decide. When
    launching something new, ship it on the strong side so people use it and
    give signal, then compress (Pardo via Sirlin).
14. **Movement is paid for in tempo, not just numbers.** Mobility is the most
    powerful axis in an arena shooter — it decides routes, escapes and
    engagement geometry. Every verb pays with fuel, cooldown, wind-up, landing
    recovery or an objective restriction. Always-available mobility is
    teleporting; mobility with a window is counterplay.

Sources are listed in §11.

---

## 3. The model: operator = class, harness = spec

Two axes with a clean division of labour:

- **Operator (class)** — role identity: base stats, one always-on *signature
  verb*, a movement identity, a 3-weapon affinity band, a silhouette, and an
  AI policy. Answers "who am I in this fight?"
- **Harness (spec)** — execution: one data-driven active ability, one
  *tradeoff passive* that changes neutral play, and a small class-relative
  rider. Answers "how do I play this class?"

The rider rule exists to stop 9×7 = 63 bespoke kits. Abilities stay seven and
their rider is keyed to the operator's **wing** (3 wings → 21 small modifiers,
each a sentence, not a subsystem).

### 3.1 Three wings, three operators each

Nine operators, but only **three distinct role kits** — the wings. Inside a wing
the three LLMs share engagement band, movement family and sustain tier, and
differ by small, legible deltas, like echo fighters: same body, different
flavour. Across wings the differences are deliberately drastic. This is the
balance trick the whole plan hangs on: differentiate 3 kits and tune 9 variants,
instead of differentiating 9 unrelated kits across 36 matchups.

| Wing | Operators | Owns | Pays with | Fantasy |
|---|---|---|---|---|
| **Strikers** | Mistral · Gemini · Grok | mobility, close/mid tempo, flanks | sustain, range | "in your face, three flavours" |
| **Vanguards** | DeepSeek · Meta · Claude | space, sustain, control | mobility, range flexibility | "hold the line, outlast you" |
| **Tacticians** | ChatGPT · Kimi · Qwen | range, information, objectives, flexibility | dominance on any single axis | "win the map, not the duel" |

Intra-wing deltas stay small on purpose: same HP tier (±10%), same base-speed
band, same engagement range (±20%), with the flavour verb carrying the
difference. Inter-wing deltas may be drastic — range band, movement family, EHP
tier. That is where "drastically better at specific things" lives.

### 3.2 Operator kits (proposal — 9 variants in 3 wings)

Stats stay near today's values; the identity moves into the verb. All verbs
reuse primitives the engine already has (slide/air-accel, dash, charge
attachments, deployable sentry template, cloak/recon, knockback, slow). The wing
defines the band; the verb defines the flavour. The exact spawn-stat re-cut is
required in Phase 2 (today's roster is 1.57× EHP, over the §4.1 envelope); the
recommended numbers live in §13.

**Strikers — close/mid aggression, mobility, low sustain**

| Operator | Signature verb (always-on) | Strength | Weakness | Bot policy |
|---|---|---|---|---|
| **Mistral** | **Effortless** — stronger air control and longer slides; slide-hop timing is more forgiving | fastest, best movement tech | lowest HP, no sustain | flanker (as today) |
| **Gemini** | **Revision** — carries two primaries; swapping skips holster time (bloom already persists) | range flexibility mid-fight | low sustain; must juggle bands; degrades under Arms Race and mode-pinned weapons | mid-range duelist, band switching |
| **Grok** | **Heat** — consecutive hits build Heat: visible glow and up to +16% fire rate; decays 1.5 s after the last hit, resets on death | snowballing pressure | punished by poke/disengage; weak when behind | aggressive brawler |

**Vanguards — space, sustain, low mobility**

| Operator | Signature verb (always-on) | Strength | Weakness | Bot policy |
|---|---|---|---|---|
| **DeepSeek** | **Deep Compute** — sustained fire builds a visible charge; the next shot releases bonus damage. Takes the **max** with attachment charge, never multiplies it, and the bonus is capped so no single shot removes more than ~90% of a full-HP/0-armor target | highest HP, hardest single hit | slow, must commit, flank-punished | siege; holds long angles |
| **Meta** | **Braced** — armor slowly regenerates out of combat (spawn armor only, never gear armor, disabled while airborne and for 1.5 s after damage); crouching without firing halves knockback | durable space-holder, objective anchor | slowest; must stand and take it | anchor/objective holder |
| **Claude** | **Alignment Review** — holding ground (not sprinting/firing) builds a review meter; at threshold it grants a temporary **absorb pool** (~45 HP, 3 s), not a resistance multiplier (which would collide with Guardrail's 50% clamp) | team anchor, holds angles | must stop pressuring to charge; no mobility | hold lines, early retreat (sentinel) |

**Tacticians — range, information, objectives, flexibility**

| Operator | Signature verb (always-on) | Strength | Weakness | Bot policy |
|---|---|---|---|---|
| **ChatGPT** | **Adaptive** — fastest weapon swap; after a swap, the first magazine keeps a small handling bonus | no bad matchup, no dead loadout | nothing is best-in-class | adaptive mid-band (as today) |
| **Kimi** | **Long Context** — enemy movement leaves brief radar trails (TTL ≤1.5 s, one per enemy per 3 s); range band pushes slightly past others | information + long lanes | fragile; loses CQC | orbiter/sharpshooter with info |
| **Qwen** | **Tool Use** — faster pickups and timed-objective interactions (cap 1.35×); vehicles handle better and repair faster; **plus a bounded combat floor**: ammo/weapon pickups grant a partial reload and 3.5 s of faster handling, and melee/tool reach is +15% | objectives, vehicles, economy | weakest straight-up kit; must play the map | optimizer; objective-first |

**Claude decision:** the Claude Code harness lock stays, and Claude is
compensated through its class verb — Alignment Review charges faster and caps
higher than any equivalent defensive trait on the roster. **Open sub-point:**
the lock is one-way today (`validLoadout`, `data.mjs:62`): everyone else may
equip Claude Code, so other Vanguards would get Guardrail *plus* their own verb.
Phase 0 must pick: make Claude Code Claude-exclusive, or give Claude a
Claude-only Guardrail rider. Recommended default: exclusive.

Deliberately **no dedicated healer**: every mode must be completable solo with
bots, so support-adjacent kits stay self-viable (Claude's absorb is
self-targeted; Qwen's utility keeps a combat floor).

### 3.3 Harness specs (proposal — 7 specs)

Each spec = one active (kept, data-driven) + one *behavioural* tradeoff passive
+ role-relative rider. **Decided: behavioural passives only.** No hidden
speed/damage/resistance percentages on the spec sheet. Traits may still carry a
tuning number (e.g. "reload 15% faster"), but every one is a named thing you can
do, feel, and test.

| Harness | Active (kind) | Tradeoff passive | Wing rider (shared-state vocabulary, §3.6) |
|---|---|---|---|
| OpenClaw | Claw Burst (`burst`) | **Grip** — melee arc +25% | Strikers: pull-in; Vanguards: bigger knockback; Tacticians: wider radius |
| Hermes | Courier Rush (`buff:speed`) | **Express** — can sprint while reloading | Strikers: longer; Vanguards: 25% mitigation during the rush; Tacticians: cooldown −1 s |
| OpenCode | Parallel Burst (`buff:fireRate`) | **Multiplex** — reload continues while swapped | Strikers: faster while active; Vanguards: the burst lasts 1 s longer; Tacticians: skip the next holster |
| Claude Code | Guardrail (`buff:resistance`) | **Linted** — brief threat ping when an enemy holds a bead on you | Strikers: cleanse slow on activation; Vanguards: +10% mitigation while active; Tacticians: ping lasts longer |
| Codex | Recompile (`heal`) | **Green Build** — reload 15% faster | Strikers: +1 s speed; Vanguards: overheal up to +15%; Tacticians: refill the equipped magazine |
| Cline | Phase Step (`dash`) | **Off-road** — extra air control, longer slide | Strikers: travels further; Vanguards: unstoppable during the verb, shorter; Tacticians: radar feint at the origin |
| Roo Code | Context Jam (`slow`) | **Flood Fill** — ability radius +25%, damage −5% | Strikers: drop it behind them; Vanguards: stronger slow; Tacticians: wider radius |

Worked rider row — **Cline (Phase Step)**:

| Wing | Rider | Result |
|---|---|---|
| Strikers (Mistral, Gemini, Grok) | longest distance, weapon ready on arrival | hyper-mobile incursion |
| Vanguards (DeepSeek, Meta, Claude) | unstoppable during the dash, shorter distance | get-in/get-out for a slow kit |
| Tacticians (ChatGPT, Kimi, Qwen) | dash leaves a brief radar feint at the origin | reposition with an information trick |

That is the playstyle lever: the same button reads completely differently per
wing, and it is one table entry per wing, not a bespoke kit.

### 3.4 Movement identity (proposal — one verb per operator)

Movement is the axis players feel the most, so every operator owns exactly one
movement capability. Wings share a *movement family* — the tempo — and operators
differ by expression. Specs then reshape how the verb lands and what it costs,
exactly like the ability riders.

| Wing | Family | Tempo | Counterplay |
|---|---|---|---|
| Strikers | **Burst** — short, reactive, momentum-preserving | engage or dodge, then it is gone | short range, cooldown, landing recovery |
| Vanguards | **Deliberate** — slow, committed, vertical | take or hold space, not escape | wind-up, vulnerable while active, loud |
| Tacticians | **Tool** — aimed or placed, setup-based | open routes, reposition the team | aim/setup requirement, visible anchors, timed |

| Operator | Movement verb | Expression | Cost model |
|---|---|---|---|
| Mistral | **Air dash** | fastest burst; chains with slide-hop | short cooldown, no sustain |
| Gemini | **Double jump** | second mode mid-air; pairs with weapon swap | one charge, refreshes on ground |
| Grok | **Super jump** | crouch-charge leap; engage, not escape | charge time, loud launch |
| DeepSeek | **Hover jets** | fuel-metered hover and slow descent | fuel, slow vertical speed, altitude ceiling |
| Meta | **Brace slam** | leap and slam with landing knockback | commitment, landing recovery, ground-only |
| Claude | **Safety glide** | slow, steerable descent; cautious repositioning | no upward mobility, slow |
| ChatGPT | **Grapple** | aim, hook, reel or swing; route opener | aim, cooldown, loud |
| Kimi | **Blink step** | short aimed translation | wind-up (~0.25 s), loud cue, cooldown |
| Qwen | **Deployable rope** | place an anchor that becomes a zip line anyone can ride | limited charges, anchor visible and timed |

Verbs reuse existing engine systems wherever possible: Qwen's rope rides the
existing zipline math (`core.mjs:98,165-170`) but the anchor is **player-placed
per-match state, never written into the arena traversal tables** (those are
cached per arena in a `WeakMap`, `core.mjs:63-70`); DeepSeek's jets follow the
Hornet's flight model and ceiling (`vehicles.mjs:578`, `core.mjs:327`); Meta's
slam is a dash variant with a landing impulse; Kimi's blink reuses Cline's
collision sampling (`core.mjs:406`); and all verbs respect the arena bounds the
vehicles already use.

**Bounded hover, not flight (decided):** the jetpack is a fuel-metered hover and
slow descent clamped to `min(vehicle maxAltitude 58, arena.ceiling ?? 24)`
metres, never sustained free flight. That keeps the **41 registered arenas**
(39 non-race) playable without a redesign; the map schema gains an optional
`ceiling` field and the route sweep (§7) covers all of them.

**Specs reshape movement on five hooks** — never the verb's core identity.
Hooks fire on four shared trigger events (§3.6), so a spec never needs nine
bespoke semantics:

| Spec | Hook | Effect |
|---|---|---|
| Hermes | economy | +1 charge or +25% fuel; −20% cooldown |
| Cline | chaining | the verb gains an air-dash cancel |
| OpenCode | usage | the verb can be used while firing |
| Codex | landing-self | landing repairs a little; no fall damage |
| Claude Code | landing-self | landing grants a brief brace |
| OpenClaw | landing-control | landing knocks enemies back |
| Roo Code | landing-control | landing leaves a slow field |

Five hooks (economy, chaining, usage, landing-self, landing-control) keep the
matrix 5 rules, not 63 bespoke interactions.

### 3.5 What this replaces

- Hardcoded ability dispatch → data-driven `kind` router (`burst`, `buff`,
  `dash`, `heal`, `slow`, `deploy`, `recon`, `stance`).
- Dead leftovers cleaned: `vehicle.label`, the emitted `affinity` copy and the
  never-populated `handling.activeFireRate` operand. **Not** `vehicle.repair`
  (live at `core.mjs:340`) and **not** the `weapons.affinity` table that drives
  `favored` (`harness-profiles.mjs:95`).
- Operator profiles stop being bot-only and become the class data.

### 3.6 Movement hook vocabulary (refines §3.4)

| Event | Definition (sim) | Hooks that fire |
|---|---|---|
| `activate` | verb input accepted; resources paid | economy, usage |
| `air` | off ground with verb resources remaining | chaining (cancel window) |
| `land` | grounded this tick with `vy<=0`; not from vehicle, zipline, pad, teleport or respawn | landing-self, landing-control |
| `end` | fuel empty, charge spent, cooldown starts | economy refunds |

| Operator verb | Activate | Cancel | Land |
|---|---|---|---|
| Mistral · air dash | 1 charge, 0.25 s | yes (Cline hook), consumes the dash | normal |
| Gemini · double jump | 1 charge, refreshes grounded | no | normal |
| Grok · super jump | crouch-charge 0.45 s | no | recovery 0.25 s |
| DeepSeek · hover jets | hold, fuel/s | no | soft 0.2 s |
| Meta · brace slam | 0.12 s wind-up, leap | no | slam knockback |
| Claude · safety glide | hold in air, fuel/s | no | normal |
| ChatGPT · grapple | aim + hook | release only | normal |
| Kimi · blink step | 0.25 s wind-up | no | normal |
| Qwen · deployable rope | 1 charge, place anchor (20 s life) | no | normal |

Plus three global rules: **one movement source** (no verb starts while another
verb, dash ability or traversal flight is active; Cline's hook is the only
cancel), **chain decay** (each extra link ×0.7, never past 1.4× the best single
verb), and **ceiling** (clamp to `min(vehicle maxAltitude, arena.ceiling ?? 24 m)`).

### 3.7 Mode coverage: verbs, carriers, switching

| Modes | Movement verb | Objective carrier | Respawn switch |
|---|---|---|---|
| ctf, koth, domination, assault, tdm, payload, combined-arms, holdout, uplink | on | loses the verb by default (one weakened exception) | yes, 60 s per-player lockout; disabled in sudden death |
| team-elimination | on | — | yes, on respawn only |
| vip-escort | on | VIP loses verb + harness active for the round | escorts yes, VIP locked |
| deathmatch, armsrace, juggernaut | on | juggernaut keeps the verb, lift ×0.7, shield frozen airborne | no (locked) |
| puma-race, puma-soccer | off | — | no |
| horde, campaign | on for players; NPCs never | — | no (locked) |
| instagib, rockets, arsenal | on, weakened (dash ≤4 m, blink wind-up 0.45 s) | flag rules unchanged | no (locked) |

The weakened carrier exception is **exactly one** rule, applied most-specific
first (Qwen's class, else Hermes): no vertical lift, half charges/fuel, +50%
cooldown, harness active suppressed while carrying, and no interaction-speed
bonus on flag pickup/capture (timed objectives only, capped at 1.35×). NPCs
(`enemy-types.mjs`) never inherit class kits; they keep `enemyBehavior` and
their own stat block.

---

## 4. Balance framework: domains, tiers, fail-safes

### 4.1 Domains, not equal budgets

Asymmetric by design. Every class is allowed — expected — to be *drastically*
better in its domain. The job is not to equalize power; it is to guarantee every
class a domain and stop any class from dominating outside one.

| Wing | Domain | Weak in |
|---|---|---|
| Strikers | close/mid fights, flanks, rotations | long sightlines, attrition, holding ground |
| Vanguards | holding space, objectives, attrition | open maps, chasing, rotations |
| Tacticians | long range, information, objectives and vehicles | straight duels at any range |

Class verbs carry the drama; raw stats stay inside today's envelope because
movement is a map-balance lever — Overwatch's lesson is that maps should not
need a redesign per hero:

- **Stat envelope:** spawn EHP (health + armor absorb) within **1.5×** and base
  speed within **±15%** of the roster mean. Today's roster is already **1.57×**
  EHP and must be re-cut in Phase 2 (recommended starting numbers in §13);
  `game/stats.test.mjs` re-pins in the same commit. Mobility *tech* (air
  control, slide, dash distance) may still differ drastically — that is where
  Striker identity lives and where maps are most forgiving.
- **Ability share is measured, not vibed.** On seeded bot sweeps, compare a
  class's win rate with its kit enabled against the same class with its
  signature verb + movement verb disabled (counterfactual). Target ≤30%
  aggregate; up to ±15 points is acceptable *inside* the class's own domain.
  Class verb, movement verb, spec active and riders count; momentum, pads,
  rocket jumps, weapon choice and map control do not.
- **Stacking is capped globally** (§4.7). The old claim that "existing clamps
  already bound it" was wrong: measured today, a Haste + Parallel Burst Pulse
  reaches ~291 DPS and a buffed Mistral ~31 m/s (3.9× base). No new effect may
  multiply into those chains without passing the §4.7 caps.

### 4.2 Tiers and alarms

Borrow Sirlin's tier discipline. The target is not 50% for everyone:

- **God tier (must be empty):** a kit that warps every mode and map. Alarm:
  overall bot-sweep win rate above ~55% with high presence, or a specialist
  winning outside its domain.
- **Garbage tier (must be empty):** a kit nobody can win with. Alarm: overall
  below ~45%, or a class that cannot complete an objective in any mode.
- **Compression:** once those are empty, shrink the gap between top and bottom.
  Raise the bottom rather than gutting the top; expect and ignore the first wave
  of nerf backlash (Sirlin).
- **Locked modes (FFA and solo; race/soccer too): no dead matchups.**
  Worst-case pairings stay around ≥35%; a locked pairing far below that is the
  error signal (Dota's data community calls 80%+ a hard counter). Mitigations:
  universal fail-safes, and the loser may re-pick first before a rematch — the
  fighting-game standard for lock-in counterpicks.
- **Team modes: counter-picks are the pressure valve.** Respawn switching
  (decided) means harsh 70/30 pairings are acceptable and counter-swapping is
  part of the meta. The sweep's alarm changes shape here: instead of
  worst-matchup floors, assert that every operator has at least two viable
  answers on the roster that a player can reach at respawn.

### 4.3 Fail-safes over special cases

Every class needs an answer to its own weakness that comes from game systems,
not from matchup-specific patches: universal movement, pickups, map routes,
vehicles, spawn protection, melee/grenade, and team modes. If a specialist
cannot survive its bad domain without a special-case damage table, the kit is
wrong — not the table.

### 4.4 Movement rules

1. **Every verb has a window.** Fuel or cooldown, plus wind-up or landing
   recovery. Nothing is always-on; always-available mobility is teleporting.
2. **Landing costs something.** Using a verb applies a short bloom/recovery beat
   on landing so movement is not a free entry into a perfect shot
   (sprint-to-fire already works this way).
3. **Airborne is exposed, not protected.** No damage reduction or accuracy
   bonus in the air; hitscan and tracking weapons are the counter, and ground
   controls (slow, knockback, Roo jam) still apply. Flight is a vector to be
   seen, not a safe zone.
4. **Objectives come first.** Affected roles are named in §3.7: CTF flag
   carriers (extending the CTF-only `flagCarrier` guard at `core.mjs:319,404`),
   the VIP, and the juggernaut (own weakened rule). Exactly **one** weakened
   carrier exception applies, most-specific first: Qwen's class, else the
   Hermes spec — no vertical lift, half charges/fuel, +50% cooldown, harness
   active suppressed, and no interaction-speed bonus on flag pickup/capture.
   Vehicle crews use vehicle skills and never the movement verb; boarding
   strips active verbs.
5. **Maps are the primary lever.** The map schema gains an optional `ceiling`
   field; all verbs clamp to `min(vehicle maxAltitude 58, arena.ceiling ?? 24)`
   metres. The route sweep (§7) covers all 41 registered arenas and asserts no
   verb beats intended routes beyond the agreed margin or escapes bounds.
6. **One new input, maximum (decided).** Jump-family verbs ride jump/crouch
   semantics; aimed verbs (grapple, rope, blink) share a single new binding and
   one touch button. No second new button.
7. **Skill ceiling through chaining, not complexity.** Momentum preservation,
   dash-slide-hop, grapple swings and blink-cancel timing are the mastery
   layer; the floor stays "press the button and it works."

### 4.5 TTK envelope

Baseline Pulse Rifle TTK against 100 HP / 0 armor is ~0.9 s (10 shots, 9
intervals at 0.1 s; `game/weapons.mjs` `weaponTTK`). Two tables, both testable:
what a wing **deals** inside its own band with its preferred weapon, and what it
**suffers** (effective health) from a baseline Pulse.

| Wing | Deals on 100/0 | Suffers vs Pulse |
|---|---|---|
| Strikers | 0.55–0.75 s | 0.75–0.9 s (lowest EHP) |
| Vanguards | 0.9–1.1 s | 1.3–1.6 s (highest EHP) |
| Tacticians | 0.7–0.95 s at range; 1.2 s+ up close | ~0.9–1.1 s |

The hard gate is `game/ttk-envelope.test.mjs` (deterministic damage math, §7).
Combat stays gunplay-first, so no kit may move a wing's dealt TTK outside its
band, and no class may one-shot a full-HP/0-armor target (§4.7).

### 4.6 Rules

1. **Counters follow the escape hatch** (see §4.2): harsh where respawn
   switching exists, survivable where picks lock.
2. **Every strong effect is telegraphed** (wind-up, VFX, cue) and has a
   counterplay window.
3. **Mode coverage: viable everywhere, dominant somewhere.** Verified by the
   mode sweep (§7); no mode-locked kits.
4. **Race and soccer keep stripping combat power** (`race.mjs:138-141`,
   `soccer.mjs:90`); movement verbs are disabled there, class combat traits are
   inert, and the class vehicle trait and harness vehicle skill combine by
   **max, never product**. Open sub-point: whether Qwen's vehicle affinity
   applies in Puma modes — recommended default is no (the race HUD currently
   promises "no advantage").
5. **Instagib / flag-carry disable abilities** stays (`core.mjs:404`).
6. **Gear may be asymmetric (decided), with build-level tradeoffs.**
   `resolveGear` (`progression.mjs:96-101`) may hand out strong, specialised
   effects — a big-damage optic can be a real prize. §4.8 makes that testable:
   every item names a power axis and a cost axis, no item dominates another in
   its slot, and the tier sweep runs stock vs max gear. Accepted tradeoff:
   progression can confer real advantage; revisit if a ranked scene exists.

### 4.7 Bounded stacking (numbers the sweeps assert)

| Axis | Cap | Notes |
|---|---|---|
| Temporary speed multipliers | additive (Σ−1), ≤ +60% over spawn walk | sprint stays a posture multiplier; momentum, pads and rocket jumps exempt |
| Verb chain distance | ×0.7 per link, ≤1.4× best single verb | slide-hop allowed; only Cline cancels |
| Fire rate | `shotWait ≥ base interval / 2.2` | Heat ≤ +16%, decays 1.5 s; enforce in one `effectiveInterval()` helper |
| Single hit | ≤90 dmg on a full-HP/0-armor target; class charge takes max with attachment charge | one-shots only on already-damaged targets |
| Spawn EHP | ≤1.5× roster min incl. armor absorb | health/armor only; regen = spawn armor only |
| Damage mitigation | ≤60%, sources take max, never sum | Guardrail and Review are separate windows |
| Overheal | ≤ +15% max health; no stacking with Overshield | shield/overheal share one pool per actor |
| Objective interaction | ≤1.35× | never on flag pickup/capture |
| Vehicle handling | class trait and harness skill combine by max, never product | Qwen's repair is the only additive vehicle effect |
| Intel trails | TTL ≤1.5 s, one per enemy per 3 s; Recon does not extend | cloak suppresses |
| Landing-control fields | ≤3.5 m, ≤35% slow, 2.5 s per actor | no trigger from vehicle/pad/zipline/respawn |

### 4.8 Gear: asymmetric but testable

1. **Two declared axes.** Every item names one power axis and one cost axis;
   they must differ, and the cost is ≥60% of the power in budget points.
2. **No in-slot dominance.** Automated pairwise test: no item's stat vector is
   ≥ another's on *every* axis. Failing blocks the gear diff.
3. **Budget parity.** Same-slot items share a total budget; levels order
   acquisition, never total budget, and every slot keeps a level-1 default.
4. **Envelope caps.** Offense ≤1.15×, mobility ≤1.10×, EHP ≤ +15%, spread
   ≥0.85×, handling ≥0.90× — enforced inside `resolveGear`, not per caller.
5. **Class effects apply after gear clamps, never before.**
6. **Tier invariant.** Run the sweep stock and at max gear: rank correlation
   ≥0.85, max rank shift ≤2, no class crossing 45/55, max-gear gain ≤4 points.

---

## 5. Code seams (what an implementation touches)

| Area | File(s) | Change |
|---|---|---|
| Class/spec data | `game/data.mjs`, new `game/kits.mjs` | Add `class` (role, verb, band) and `spec` (tradeoff, rider) tables; one resolver `resolveKit(character, harness, gear)` |
| Ability dispatch | `game/core.mjs:404-408, :375, :450, :101` | Route on `ability.kind` instead of id strings; move per-kind logic behind small pure helpers |
| Operator profiles | `game/operator-profiles.mjs` | Merge into the class data; keep bot policy fields |
| Harness profiles | `game/harness-profiles.mjs` | Tradeoff passive + rider table; keep the "apply once" contract |
| Progression gear | `game/progression.mjs:96-101`, `server/progression.mjs:113-122` | Asymmetric gear with build-level costs; keep level gating; update `progression.test.mjs` |
| Mid-match loadout | `server/room.mjs`, `game/net.mjs`, `game/core.mjs` | Team-mode respawn switches: validated loadout message, applied at next spawn, rate-limited; FFA/solo stay locked |
| Net prediction | `game/net.mjs:401-402` (`resync` :409-414) | **Fix:** the shadow is built as `chatgpt/openclaw` with `Math.random`; `resync` already copies real actor fields, so the real gaps are pre-first-snapshot prediction, per-verb state, and `NetHarness` shadow determinism — pass the seat loadout and a seeded random into `createShadow` |
| Movement verbs | `game/core.mjs` (`moveActor`, ability dispatch), `game/vehicles.mjs` flight model, traversal tables (`core.mjs:64-71`) | Fuel/charges, wind-up and landing hooks; reuse zipline rides, flight bounds and dash sampling |
| Movement input | `game/input.mjs`, `game/protocol.mjs`, keybind/touch config | One new `move` action, validated and edge-latched like `power`; jump-family verbs reuse existing inputs |
| Movement net state | snapshots / `game/quantize.mjs` | Fuel, charge and anchor fields ride snapshots; verbs must reconcile under the real loadout (Phase 1 fix) |
| Movement verb state | `game/core.mjs` (`actor` :316, `spawn` :373, death :385, `fall` :397) | One place to declare and reset fuel, charges, wind-up and anchor fields; snapshots (`:548`) and `quantize.mjs:32` carry plain numbers for free |
| Movement verb helpers | `core.mjs:406` (Cline loop), `core.mjs:487` (`stepDeployables`), arena traversal cache `core.mjs:63-70` | Extract the phase-step sampler into a shared pure `dashActor`; give deployables a `kind` so anchors are not stepped as sentries; deployed ropes are per-`Match` state |
| Bots | `game/bot-personalities.mjs`, `game/bots.mjs` | Per-class policy already has seams (`behavior` fields, `chooseWeaponIndex`, power trigger); add verb triggers |
| HUD / scoreboard | `game/hud.mjs`, `game/scoreboard.mjs`, `app/ui/screens/PlayingHud.tsx` | Class + spec display, rider-aware ability ring, kill-feed attribution |
| Selection UI | `app/ui/screens/SelectionScreen.tsx`, `app/page.tsx` (`UiBag`) | Role label, verb, strengths/weaknesses, combo preview; keep the `ui-contract` test green |
| Audio | `game/feedback.mjs:506-530` | Per-harness ability cues (the `power` event already carries `harness`), new announcer lines |
| VFX | `game/view.mjs:1156-1224`, `game/effects-fx.mjs` | Wind-up and impact telegraphs through the existing pools; gate on `reduced` and software renderer |
| Tests | see §7 | Parity first, then per-kit, matchup sweeps and mode sweeps |

Most actor state needs no protocol version bump: `character`/`harness` already
ride in snapshots (`core.mjs:548`), and the harness active is already an
edge-latched input (`protocol.mjs:43-58`, `room.mjs:327-339`). The movement
action adds one validated input edge and the team-mode respawn switch adds a
loadout message; because the input surface changes, bump `PROTOCOL_VERSION` to 3
in Phase 4 (keep `SNAPSHOT_DELTA_VERSION` 2). `start` (`room.mjs:299`) does not
carry per-seat loadouts today; either add them additively or have the client
remember its own join loadout for the Phase 1 shadow fix.

### Known defects to fix on the way

- **Prediction shadow** is built as `chatgpt/openclaw` with `Math.random`
  (`net.mjs:401-402`). `resync` (`net.mjs:409-414`) already copies the real
  actor fields each snapshot, so post-snapshot movement follows the real kit;
  the real gaps are pre-first-snapshot prediction, new per-operator verb state,
  and shadow determinism in `NetHarness` (`net.mjs:502`).
- **HUD ability ring** divides only by the raw cooldown and `fastPowers`
  (`PlayingHud.tsx:41`). Core also multiplies by `player.cooldownMultiplier`
  (`core.mjs:404`) and disables the ability for CTF flag carriers and instagib
  (`core.mjs:319,404`); `PlayingHud.tsx:42` covers mode-instagib only. Move the
  ring math into a pure `hud.mjs` helper.
- **Deployables are stepped as sentries**: `stepDeployables` (`core.mjs:487`)
  assumes every entry is a turret, so a rope anchor needs a `kind`
  discriminator and a cap before it can ride the same list.
- **New actor state must be reset in `actor()` (`core.mjs:316`), `spawn()`
  (`:373`), the death branch (`:385`) and `fall()` (`:397`)**, or fuel and
  charges leak through respawns as free extra verbs.
- `power()` stores `ability.speed ?? h.magnitude` in `activeSpeedMultiplier`
  (`core.mjs:404`) — a damage/distance magnitude for 6 of 7 harnesses, inert
  only because the speed formula reads it for Hermes alone (`core.mjs:101`).
  The `kind` router must not generalize that field.
- `weaponForIndex` caches on actor-attachment identity (`core.mjs:418`); class
  weapon effects must invalidate the cache, not mutate the cached weapon.
- Flag restriction is CTF-only (`flagCarrier`, `core.mjs:319`); VIP and
  juggernaut need their own predicates (§3.7).
- Tests pinned to current balance will need scheduled updates:
  `stats.test.mjs:8-11`, `harness-profiles.test.mjs:31-34`, `touch.test.mjs:46`,
  `keybinds.test.mjs:41` (KeyZ stays free). The new input action must be called
  `mobility`, never `move` — `input.mjs:38` already uses `state.move` for the
  analog joystick.
- The map schema needs an optional `ceiling` field; there is no actor altitude
  data today and `map-schema.mjs` validates only 2-D bounds.

---

## 6. Presentation and readability

1. **Selection screen**: each operator card gets a role chip, its verb in one
   line, one strength, one weakness. Harness cards get "changes playstyle how"
   copy and a combo preview ("Mistral + Cline — hyper-mobile incursion").
2. **In-match**: class badge + spec icon near the ability ring; movement HUD
   (fuel/charges, wind-up state); scoreboard gets a class/spec chip; kill feed
   shows ability kills by name. In team modes the respawn overlay offers an
   operator/spec change and shows what killed you.
3. **Telegraphs**: every active gets a distinct cue (audio ~`feedback.mjs`
   `power` branch) and VFX; wind-ups are visible to both players.
4. **Death attribution**: kill cam already exists (`effects-fx.mjs`
   `killcamPose`); include "killed by X's [ability]" so counterplay is learnable.
5. **Accessibility**: new cues go through captions (`hud.mjs:151`), new colors
   through the palette tables (`presets.mjs:108-129`), and new screen effects
   respect reduced motion (`post.mjs:4`, `view.mjs:500`).
6. **Silhouettes (decided: wing-readable)**: build one silhouette language per
   wing — Strikers leaner and forward-leaning, Vanguards bulkier and squared,
   Tacticians slighter with sensor/toolkit greebles — layered over the existing
   per-operator greebles and colors (`view.mjs:318-326`). Operators in the same
   wing share a body language and separate by accent and greeble: the wing is
   readable at range, the individual is readable up close.

---

## 7. Verification plan

The repo's test culture is the asset here — the plan is gated the same way
everything else is.

1. **Phase 1 parity gate.** `game/ability-kinds.test.mjs` freezes current
   behaviour before the router lands: a per-harness snapshot hash pinned from
   the pre-refactor build, exact golden traces for all 7 abilities, a
   kind-object/router equivalence pass, and the OpenCode cadence. The full
   current suites must stay green with zero pin updates; `game/movement-net.test.mjs`
   pins the prediction-shadow fix before anything moves.
2. **Per-kit tests.** `game/class-verbs.test.mjs` (9 signature verbs, three
   assertions each, plus the wing invariants: same-wing HP ±10%, same speed
   band, range ±20%, inter-wing differences strictly larger);
   `game/wing-riders.test.mjs` (21 rider entries, all 63 combinations resolve,
   the worked Cline row); `game/spec-passives.test.mjs` (all 7 passives are
   behavioural — assert no hidden speed/damage/resistance multiplier is
   injected).
3. **Movement verb tests.** `game/movement-verbs.test.mjs` (per-verb caps and
   geometry safety, fuel/charge economy, landing recovery, the carrier block
   plus its one weakened exception, driver suppression, race/soccer stripping);
   `game/movement-input.test.mjs` (the `mobility` edge, validation, keybind,
   touch); `game/movement-replay.test.mjs` (byte-identical fixed-input replays,
   demo round-trips); `game/movement-net.test.mjs` (reconciliation under the
   real loadout, divergence <1e-6, fuel/charge/anchor deltas).
4. **TTK band tests.** `game/ttk-envelope.test.mjs` — deterministic
   falloff-aware TTK per wing against §4.5, plus the §4.7 one-shot cap. A
   tuning change that breaks the envelope fails loudly.
5. **Matchup sweeps → tier report.** `game/balance-sweep.mjs` (pure library) +
   `game/archive/balance-sweep.test.mjs` (smoke, `COCS_SLOW_TESTS=1`) +
   `scripts/balance-sweep.mjs` (full, nightly). Seeded round-robins with a
   checked seed manifest; **run every sweep twice** — *policy-on* (class AI
   policies, for expression/feel) and *policy-neutral* (one archetype for all
   actors, for balance). Gate tier alarms on the neutral sweep; gate class
   expression on the policy-on sweep with verb-usage floors. Report a tier
   list, not equality: god tier (Wilson-99 lower bound >55%), garbage tier
   (Wilson-99 upper bound <45%, or zero objective completions in a mode group),
   locked-mode floors (fail below 35% once n≥24), team-mode "≥2 reachable
   answers", and ability damage share ≤30% from ability-tagged damage events.
6. **Mode viability sweep.** `game/mode-viability.test.mjs` — per operator ×
   mode group; flag any mode where a class cannot score, capture or complete an
   objective. Dominance in some modes is expected and fine.
7. **Netcode tests.** Existing `game/net.test.mjs` / `server/network.test.mjs`
   plus the movement net tests; one added `mobility` edge latched like `power`.
8. **Bot expression tests.** `game/bot-class-expression.test.mjs` — per-class
   counters > 0 in a seeded 60 s match, zero `Math.random`, identical runs
   identical, no bot stalls. Aimed verbs (grapple/blink) may be underused by
   bots; for those, the human playtest outweighs the bot win rate.
9. **Route sweep.** `game/route-sweep.test.mjs` (opt-in) — all 41 registered
   arenas × 9 verbs; no verb trivializes traversal beyond the agreed margin, no
   bounds/ceiling escape, and bot navigation does not stall with verbs enabled.
10. **Human playtest pass.** 1v1 class mirrors plus a 16-bot Combined Arms match
    per spec; log "what killed me and what should I have done" for each death,
    and track team-mode swap rates. The one thing tests cannot replace.

---

## 8. Phased rollout

| Phase | Content | Gate |
|---|---|---|
| **0. Design lock + sign-off** | This doc reviewed; wings, verbs, domains and the §10.1 defaults signed off | sign-off recorded |
| **1. Data-driven core** | `kits.mjs` + ability `kind` router + dead-field cleanup + prediction-shadow fix; zero behavior change | full suites + parity traces green |
| **2. Operator classes + movement** | 3 wing kits + 9 operator variants; 9 movement verbs with fuel, wind-up and landing hooks; one new input; bot policies | per-kit + movement + input + replay tests green; route smoke + movement reconciliation green; sweep library seeded |
| **3. Harness specs + gear** | behavioural tradeoff passives, wing riders (21 entries), movement hooks; gear made asymmetric with build-level costs | combo tests; no god/garbage spec; gear tests updated |
| **4. Presentation + swapping** | selection UI, movement HUD (fuel/charges) and keybind/touch, HUD/scoreboard/kill feed, telegraphs, audio, accessibility; team-mode respawn loadout switching (server message, validation, respawn overlay) | ui-contract + rendered-HTML + reduced-motion + room/net tests green |
| **5. Balance + ship** | sweeps, human playtest tuning, docs/changelog | version `v7.0 · DOCTRINE`; full release checklist (§12) |

Phase 1 is deliberately invisible to players: it de-risks the whole overhaul
behind the existing test suite. The file-level task list, the safe worktree
workflow, the data schema, the sweep architecture and the kickoff brief for the
implementing agent are in §12–§15.

---

## 9. Risks and anti-goals

| Risk | Mitigation |
|---|---|
| 63-combo balance explosion | 3 wing kits × 3 variants, 21 wing riders, sweeps, one change at a time |
| Qwen dead in ~7 modes (gadget-only kit) | Tool Use keeps a bounded combat floor; Qwen is the first mode-sweep regression |
| EHP envelope already 1.57× before any change | Phase 2 stat re-cut inside 1.5×; Review is an absorb pool; overheal ≤ +15%; regen = spawn armor only |
| Unbounded multiplicative stacking (measured 291 DPS / 3.9× speed) | §4.7 global caps; one `effectiveInterval()` helper; additive temporary speed |
| Carrier exception stacking / objective abuse | Exactly one exception; harness active suppressed while carrying; no flag interaction speed |
| Rider table drifting into operator-specific cases | Shared trigger vocabulary (§3.6); operator compensations listed one row each |
| Power creep by stacking with gear/attachments/powerups | stat envelope in §4.1; gear review; one change at a time |
| Locked-mode countermatches (FFA and solo) | keep worst-case pairings ≥ ~35%; fail-safes; loser re-picks first on rematch |
| Counter-swap churn in team modes | accept it as the mode's meta; watch swap rates in playtests |
| Asymmetric gear drifts into grind-to-win | each item keeps a build-level cost; sweeps run geared builds; revisit if ranked appears |
| Tier compression flattens identity | allow a legitimate top tier; raise bottoms instead of gutting tops; heed SC2's "too balanced" warning |
| Players read a mid-tier specialist as overpowered | treat it as a success (Sirlin's Tafari illusion); track feel and data separately |
| Bot regressions from new policies | per-class behavior tests + determinism constraints |
| Netcode feel regressions from movement verbs | fix prediction shadow first; movement verbs are sim-side and predicted, never client-only |
| Movement verbs break the 41 existing arenas | bounds + altitude ceiling + per-map ceilings; carrier restrictions; route sweep |
| Class choice becomes mandatory on some maps | wing domain chart + mode-viability sweep; no dead matchups in locked modes |
| Overwatch-ification: abilities eclipse gunplay | ≤30% power share rule; no ultimates; one combat active + one movement verb |
| Claude compensation overshoots (locked spec + best-in-class defence) | watch Claude in the tier sweep; tune the Review threshold, not the roster |

**Anti-goals:** no ultimates, no second combat ability, no dead matchups in
locked modes, no god or garbage tier, no weapon locking, no mode-locked kits,
no always-on flight, no untelegraphed instant repositioning, no 9 bespoke
movement engines (verbs compose from shared primitives), no matchup
special-case damage tables.

---

## 10. Decisions (locked 2026-09-17)

| # | Decision | Choice |
|---|---|---|
| 1 | Claude's harness lock | Keep the lock; compensate with a stronger Alignment Review class verb |
| 2 | Pick impact vs gunplay | Gunplay-first: picks ≈25–30% of the outcome, weapons/aim/map control the rest |
| 3 | Gear power | Asymmetric gear allowed with build-level costs and level gating; revisit if ranked appears |
| 4 | Spec passives | Behavioural only; no hidden stat percentages |
| 5 | Silhouettes | One wing-readable silhouette language + per-operator accents and greebles |
| 6 | Class power model | Asymmetric specialists: drastically better in-domain, never strictly better overall; no god or garbage tier |
| 7 | Roster structure | Three wings of three: small intra-wing deltas, drastic inter-wing differences |
| 8 | Countermatch policy | Harsh counters allowed in team modes; locked modes keep worst-case pairs ≥ ~35%; loser re-picks first on rematch |
| 9 | Mid-match switching | Team modes: change operator/spec at respawn. FFA/solo: locked |
| 10 | Movement model | One movement verb per operator; wings share a family (burst / deliberate / tool); specs reshape via five hooks |
| 11 | Movement input | One new binding for aimed verbs; jump-family verbs reuse jump/crouch; one touch button |
| 12 | Air power | Bounded fuel-metered hover jets with an altitude ceiling, never free flight |
| 13 | Objective carriers | Lose the movement verb by default; weakened exception via Qwen's class or the Hermes spec |

Numbers, thresholds, rider details and the wing names remain tuning work for
Phases 3–5, but these decisions are settled and the rest of this plan is written
around them.

### 10.1 Phase-0 sign-off items (recommended defaults)

| # | Item | Recommended default |
|---|---|---|
| S1 | Claude Code exclusivity | Make it Claude-exclusive |
| S2 | Wing display names | Strikers / Vanguards / Tacticians (ids `striker\|vanguard\|tactician`) |
| S3 | Movement action name and key | `mobility`, `KeyX`, one touch button (never `move`) |
| S4 | Spawn-stat re-cut | The starting table in §13.3 (EHP ≤1.5×, speed ±10%) |
| S5 | Qwen vehicle affinity in Puma modes | Off (the race HUD says "no advantage") |
| S6 | Ability attribution on damage events | Add in Phase 2 so §4.1's ≤30% share is measurable |
| S7 | Team-mode "two reachable answers" | ≥2 operators with aggregate win rate ≤60% vs the class in the team proxy |
| S8 | Gear upgrade scope | Upgrade 3 items in Phase 3 (`scope`, `heavy-barrel`, `servo`), not all 8 |
| S9 | Bots switching loadouts | Never; humans only, team modes only |
| S10 | Per-map ceiling | Optional `ceiling` field, default 24 m |

These are the only open items; everything else in §10 is locked.

---

## 11. Sources

- Valve, *Team Fortress 2 — Heavy update design brief* (goals, constraints,
  "deepen the skill curve", don't encroach on roles):
  https://www.teamfortress.com/post.php?id=1670
- Valve/Robin Walker interview on sidegrade unlocks and "the best choice depends
  on playing style": https://www.ign.com/articles/2008/03/25/team-fortress-2-q-a
- Valve, *Engineer update — Repair Node postmortem* ("we learned what NOT to
  do"; pacing dangers): https://www.teamfortress.com/post.php?id=3539
- Overwatch art pillars / readability ("immediately identifiable in the middle
  of battle"): https://www.cookandbecker.com/en/article/378/designing-overwatch.html
- Jeff Kaplan interview on data double-checking instinct and drama over
  strict win rates: https://www.pcgamesn.com/overwatch/overwatch-designer-jeffrey-kaplan-on-the-art-and-science-of-building-a-new-breed-of-shooter
- Blizzard, *Designing heroes for a new era* (skillshots and counterability,
  invisible value): https://overwatch.blizzard.com/en-us/news/23816408/
- Blizzard, *Director's Take — Season 6 retrospective* ("safe side of strong",
  layering small synergistic changes, unmirrored win-rate reference):
  https://news.blizzard.com/en-us/news/24003143
- Blizzard, *Sombra rework* (commitment, counterplay windows, upheld identity):
  https://news.blizzard.com/en-us/article/24009616
- Power budget practice: Guild Wars 2 balance philosophy
  (https://en-forum.guildwars2.com/topic/123508-guild-wars-2-balance-philosophy/)
  and Riot's "power budget" framing as summarized in design write-ups.
- David Sirlin, *Balancing multiplayer games — fairness* (tier discipline,
  self-balancing forces, lock-in countermatches, the Tafari illusion):
  https://www.sirlin.net/articles/balancing-multiplayer-games-part-3-fairness
- StarCraft II as a study in asymmetric balance — races may differ radically
  while outcomes stay near even; the "too balanced" homogenisation warning:
  https://simonhalliday.com/2019/09/04/starcraft-ii-a-study-in-asymmetrical-design/
- League of Legends champion classes/subclasses — an official taxonomy that
  exists for clarity, with balance done within and across classes:
  https://wiki.leagueoflegends.com/en-us/Champion_classes
- Fighting-game archetypes (rushdown / zoner / grappler own different ranges
  and tempos): https://archive.supercombo.gg/t/list-of-fighting-game-archetypes/143553
- Smash echo fighters (small intra-family deltas widen a roster cheaply):
  https://dignitas.gg/articles/understanding-the-echo-fighters-in-super-smash-bros-ultimate
- MOBA win-rate and presence practice (overpowered ≈ >52.5–54% win rate;
  underpowered ≈ <7.5% pick/ban presence):
  https://gamedesignskills.com/game-design/moba/
- Battleborn postmortem on characters being experienced inside a session, not
  after 50 hours: https://www.gamedeveloper.com/design/how-i-battleborn-i-blends-moba-design-into-the-multiplayer-shooter
- Mobility as one of the most powerful mechanics in high-level play (Game
  Balance Project — Speed): https://tgbp.fandom.com/wiki/Speed
- Movement as identity and skill ceiling — Titanfall's wall-run/grapple, Halo 5's
  thrust/hover/ground-pound, Quake's slide-hop:
  https://hopefulhomies.com/2017/02/18/movement-mechanics/
- Quake rocket jumping — the original movement-with-a-cost model (self-damage):
  https://quake.fandom.com/wiki/Rocket_Jump
- Community precedent for restricting objective-carrier mobility (Titanfall
  grapple limits in competitive CTF):
  https://www.reddit.com/r/patientgamers/comments/rqi2i4/which_game_had_the_best_implementation_of_a/

---

## 12. Execution appendix: workflow, tasks, gates

### 12.1 Workflow on a live-hosted repo

The live web service serves the **main checkout's `dist/`**. Work in a worktree
and build only there.

| Command | Main checkout | Worktree |
|---|---|---|
| `node --test game/<file>.test.mjs`, `npm run test:game`, `test:server`, `test:archive`, `npx tsc --noEmit`, `npm run lint` | safe | safe |
| `npm run dev -- --port 5174`, `PORT=4001 npm run server` | avoid (port/`.wrangler` contention) | safe |
| `npm run build`, `npm test`, `node --test tests/*.test.mjs` | **forbidden** (breaks the live site) | safe |
| `npm run deploy -- --with-game-server` | once, at ship time | wrong directory |

```bash
git worktree add ../tokenarena-class -b feat/class-overhaul
cd ../tokenarena-class && npm ci
```

Commit per task with the task ID in the message; never touch
`server/history.json`; if a build is ever run in main by accident, deploy
immediately.

### 12.2 Task list

**Phase 1 — data-driven core (zero behaviour change)**
1. Worktree + baseline suites; record counts.
2. `game/kits.mjs` skeleton: `KINDS`, `WINGS`, `OPERATOR_KITS`, `SPECS`,
   `MOVEMENT_VERBS`, `resolveKit()` + tests; nothing imports it yet.
3. Add `ability.kind`/`buff`/`magnitude` to the 7 profiles + memoized
   `abilityOf`; pin the mapping in tests.
4. Golden parity traces (`game/ability-kinds.test.mjs` + fixture) captured
   **before** the refactor.
5. Route `Match.power` (`core.mjs:404-408`) on `ability.kind`; shared
   bookkeeping byte-identical; buffs inert.
6. Switch `core.mjs:101/:375/:450` to `activeBuff()` via live harness lookup;
   zero behaviour change.
7. Dead-leftover cleanup (`vehicle.label`, emitted affinity copy,
   `activeFireRate` operand); exactly one test pin changes.
8. **Prediction-shadow fix** (`net.mjs:401-402`): `createShadow(mapId, config,
   loadout)`; `NetHarness` option; regression test with a non-default loadout.
9. Gate: `test:game` + `test:server` + `tsc` + `lint` + parity traces green.
10. Commit and stop; no build, no deploy.

**Phase 2 — classes + movement**: full `OPERATOR_KITS` + stat re-cut; per-wing
signature verbs; movement framework (fuel/charge/cooldown/landing hooks, the
`mobility` edge, snapshots); nine verbs; carrier rule; bot policies; movement
netcode; SYSTEMS.md.

**Phase 3 — specs + gear**: full `SPECS` (21 riders, 5 hooks); 7 behavioural
passives; rider dispatch; remove per-id branches; asymmetric gear with costs and
the dominance test; combo tests; first spec sweep.

**Phase 4 — presentation + swapping**: selection UI (wing chip, verb, combo
preview); movement HUD + keybind + touch; HUD/scoreboard/kill feed + the ring
math fix; telegraphs/audio/captions/reduced motion; wing silhouettes; team-mode
respawn switching (`MESSAGE.LOADOUT`, validation, rate limit, respawn overlay);
`PROTOCOL_VERSION` 3; worktree build + contract tests.

**Phase 5 — balance + ship**: TTK bands; sweeps + tier report; mode viability;
route sweep; human playtest; tuning (compress outliers, one change at a time);
docs/README/SYSTEMS/ARCHITECTURE/VERIFICATION/TESTING/CHANGELOG +
`v7.0 · DOCTRINE`; merge → deploy → verify → smoke.

### 12.3 Phase gates

| Phase | Done when |
|---|---|
| 0 | §10.1 defaults signed off |
| 1 | `test:game` + `test:server` + `npx tsc --noEmit` + `npm run lint` green; parity traces identical; only one test pin changed; no `dist/` change in main |
| 2 | per-kit/movement/input/replay tests + `COCS_SLOW_TESTS=1` route smoke + movement-net reconciliation green |
| 3 | rider/passive/gear tests green; spec sweep has no god/garbage tier |
| 4 | `ui-contract` + worktree `rendered-html` + touch/keybind/scoreboard + room/net switching tests green |
| 5 | full sweep report with no fail rows; `npm test` green on a fresh worktree build; docs/changelog/footer consistent; deploy verified |

---

## 13. Data schema, dispatch contract, starting numbers

### 13.1 `game/kits.mjs` data model

- `WINGS` — 3 × `{id, name, label, color, family, domain, pays, fantasy}`.
- `OPERATOR_KITS` — 9 × `{id, wing, role, preferred[3], strafe, affinity, verb,
  movement, bot}`; stats are always read from `CHARACTERS` (one source).
- `SPECS` — 7 × `{id, name, kind, active, tradeoff, riders{striker,vanguard,
  tactician}, movementHook, vehicle, bot}`.
- `MOVEMENT_VERBS` — 9 × `{id, name, family, input, …budget fields, carrier}`.
- `MOVEMENT_HOOK_BY_SPEC` — `{hermes:'economy', cline:'chaining',
  opencode:'usage', codex:'landing-self', claudecode:'landing-self',
  openclaw:'landing-control', roo:'landing-control'}`.
- `resolveKit(character, harness, gear)` → frozen `{character, harness, wing,
  kind, active, tradeoff, rider, movement, movementHook, stats, affinity, gear,
  fingerprint}`; normalises through `resolveLoadout` first so the Claude lock
  and fallbacks stay identical.
- Back-compat: `operator-profiles.mjs` becomes a shim over `OPERATOR_KITS`;
  `harness-profiles.mjs` keeps every export and gains `kind`/`buff`/`magnitude`
  additively; `data.mjs` stays the display/validation source through Phase 2.

### 13.2 Ability kinds and dispatch contract

Kinds: `burst | buff | dash | heal | slow | deploy | recon | stance`. Movement
verbs are a separate namespace (`dash|jump|hover|slam|glide|grapple|blink|rope`)
and never flow through the ability router.

Rules: `power()` owns all shared bookkeeping (guards, cooldown, `active`,
`activeSpeedMultiplier`, `emit('power')`, `stats.powers`) and stays
byte-identical; per-kind helpers only apply their effect and emit their own
event; exactly one helper per call; unknown kind is a no-op that still pays
cooldown; call order is fixed and pinned by golden traces; `buff` is
deliberately inert in `power()` and applied at use sites via
`activeBuff(a, stat)`.

### 13.3 Starting numbers (Phase-2 baseline, tune in Phase 5)

Spawn-stat re-cut (EHP ≤1.5×, speed within ±10% of the mean): Strikers 90/95/105
HP at 9.2/9.0/8.9 m/s; Vanguards 120 / 100+20 armor / 115+10 armor at
7.7/7.6/7.8 m/s; Tacticians 100+5 / 90+10 / 100+10 at 8.6/8.7/8.5 m/s.
Re-pin `game/stats.test.mjs` in the same commit.

Movement budget baseline (Phase-5 tune): air dash 6 m / 2.2 s / 1 charge /
0.15 s landing; double jump impulse 7.8, one charge; super jump 0.45 s charge /
12.5 impulse / 5 s; hover 3 s fuel / 1.6 s recharge / climb 0.35 / descent 2.2;
slam 0.12 s wind-up / 4.5 m radius / 10 knockback / 7 s; glide descent 1.7 m/s,
steer 4.5, pool 3 s / 1.6 s recharge; grapple 14 m / 12 m/s reel / 6 s (2.5 s on
miss); blink 6 m / 0.25 s wind-up / 5 s; rope 1 charge / 20 s anchor / 10 s and a
10 m/s ride. Harness active tune (Phase 5): Claw Burst radius 6 m / damage 30
(knockback 14, lift 5); Courier Rush 3.5 s; Parallel Burst 3.5 s at 1/.55 fire
rate; Guardrail 3.5 s; Recompile heals 45; Phase Step 7 m; Context Jam radius
8 m at a .5 slow. Carrier weakened: 1 charge, half fuel, +50% cooldown, no
vertical lift. New bind `mobility = KeyX` plus one touch button.

---

## 14. Sweep architecture (the balance smoke alarm)

| Piece | Path | Purpose |
|---|---|---|
| Library | `game/balance-sweep.mjs` | Pure, deterministic: seeds, match construction, metrics, Wilson math, tier report and alarms |
| Unit tests | `game/balance-sweep.test.mjs` | Library only, in the fast gate |
| Integration | `game/archive/balance-sweep.test.mjs` | `COCS_SLOW_TESTS=1` smoke; `COCS_SWEEP=full` full |
| CLI | `scripts/balance-sweep.mjs` | `--profile smoke\|full --out reports/balance-<release>.json --print-tierlist --only=…` |
| Prerequisite | `Match` needs `botLoadouts` (today `loadouts` apply only to humans, `core.mjs:292`) | Without it the sweep must mutate actors after construction and cannot be trusted |

Determinism: `seed = fnv1a32('mode|map|matchup|seedIndex|geared')`; pinned
actor ids; every report carries `{release, dataHash, seedManifest}`; every alarm
is reproducible with `--only=<mode,matchup,seed>`.
Metrics: win rate overall and by mode group, K/D, damage per life, sampled TTK
(p25/median/p75, advisory), objective completion, verb uses, ability damage
share (needs ability-tagged damage events), team-mode swap rates.
Alarms: god tier Wilson-99 lower bound >55%; garbage tier upper bound <45% or
zero objective completions; locked-mode floor fail below 35% at n≥24; team-mode
"≥2 reachable answers" (≤60% aggregate); ability share >30%; envelope breaches.
The report is a smoke alarm, not a judge.

Budgets (calibrated on this host: 8-bot 60 s match ≈1.7 s): smoke ≈4–5 min for
~300 matches; full ≈30–35 min for ~1,800 matches; `--budget-ms` truncates
deterministically.

---

## 15. Kickoff brief for the implementing agent

```text
KICKOFF — COCS class & harness overhaul

Read, in order: docs/design/CLASS_OVERHAUL.md (all, incl. §12–§15) ·
docs/ARCHITECTURE.md §3/§5/§8 · docs/TESTING.md · docs/DEPLOYMENT.md
("the one rule that matters") · game/data.mjs · game/harness-profiles.mjs ·
game/operator-profiles.mjs · game/bot-personalities.mjs · game/core.mjs
lines 90-101/316-374/404-408/448-451 · game/net.mjs:401-402 ·
server/room.mjs:270-340.

Locked decisions: operator = class (signature verb, movement verb, 3-weapon
affinity, AI policy); harness = spec (data-driven active + behavioural tradeoff
+ wing rider); 3 wings × 3 operators; ability kinds
burst|buff|dash|heal|slow|deploy|recon|stance; one movement verb per operator in
three families (burst/deliberate/tool); one new bind `mobility = KeyX` for aimed
verbs only; carriers lose the verb with exactly one weakened exception (Qwen's
class, else Hermes); team modes switch operator/spec at respawn, FFA/solo
locked, bots never switch; Claude keeps the Claude Code lock, compensated by
Alignment Review; no dedicated healer; every gear item keeps a build cost;
version v7.0 · DOCTRINE. Resolve the §10.1 defaults with the owner first.

Safety: work only in a worktree. Never run in the main checkout: npm run build,
npm test, npm run deploy, npm ci, npm run start. Safe anywhere: node --test
game/<file>.test.mjs, npm run test:game, npm run test:server, npx tsc --noEmit,
npm run lint. Worktree-only: npm run build, node --test tests/*.test.mjs,
npm run dev -- --port 5174, PORT=4001 npm run server. Deploy once at the end
from main: npm run deploy -- --with-game-server, then verify:deployment.

First 10 tasks (Phase 1, zero behaviour change):
1 worktree + baseline suites · 2 kits.mjs skeleton + tests · 3 ability kinds on
the 7 profiles + abilityOf · 4 golden parity fixtures BEFORE the refactor ·
5 route Match.power on kind, bookkeeping byte-identical · 6 activeBuff() at
core.mjs:101/:375/:450 · 7 dead-leftover cleanup, one pin changes · 8 prediction
shadow takes the real loadout (net.mjs:401-402) · 9 gate green · 10 commit, no
build, no deploy.

Gates: Phase 1 green suites + identical parity traces · Phase 2 per-kit +
movement + input + replay + route smoke · Phase 3 rider/passive/gear tests,
no god/garbage spec · Phase 4 ui-contract + rendered-HTML + room/net switching ·
Phase 5 full sweep with no fail rows, docs/changelog/footer consistent, deploy
verified.
```
