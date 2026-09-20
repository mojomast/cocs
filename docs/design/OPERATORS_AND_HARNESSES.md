# COCS operators & harnesses — reference sheet

> **Status:** companion to [CLASS_OVERHAUL.md](./CLASS_OVERHAUL.md), which is the
> authority. This sheet is the fast lookup: one row per operator, one row per
> harness. Anything marked *planned* is a proposal pending Phase-0 sign-off
> (§10.1 of the overhaul plan); everything else is the intended design from the
> locked decisions.

---

## How to read this

- **Operator = class.** Stats, an always-on *signature verb*, a movement verb, a
  weapon affinity band and an AI policy. Answers "who am I in this fight?"
- **Harness = spec.** One active ability (`Q`), one behavioural tradeoff passive
  and three wing riders. Answers "how do I play this class?"
- **Three wings, nine operators.** Inside a wing, operators share engagement
  band, movement family and sustain tier; differences are small. Across wings,
  differences are deliberately drastic.
- **Inputs.** `Q` fires the harness active (the existing `power` input). The
  movement verb rides jump/crouch where possible; aimed verbs (grapple, rope,
  blink) share one new `mobility` bind (`X`) plus one touch button.

## Wings

| Wing | Operators | Movement family | Domain | Pays with | Fantasy |
|---|---|---|---|---|---|
| **Strikers** | Mistral · Gemini · Grok | Burst — short, reactive, momentum-preserving | Close/mid fights, flanks, rotations | Sustain, range | "In your face, three flavours" |
| **Vanguards** | DeepSeek · Meta · Claude | Deliberate — slow, committed, vertical | Holding space, objectives, attrition | Tempo and escape, range flexibility | "Hold the line, outlast you" |
| **Tacticians** | ChatGPT · Kimi · Qwen | Tool — aimed or placed, setup-based | Long range, information, objectives, vehicles | Dominance on any single axis | "Win the map, not the duel" |

## Operators

| Operator | Wing | Signature verb (always on) | Movement verb | Best at | Weak at | Bot style |
|---|---|---|---|---|---|---|
| **Mistral** | Striker | **Effortless** — stronger air control, longer slides, forgiving slide-hop timing | Air dash | Pure speed and movement tech | Lowest HP, no sustain | Flanker |
| **Gemini** | Striker | **Revision** — carries two primaries; swapping skips holster time | Double jump | Range flexibility mid-fight | Low sustain; must juggle weapon bands; degrades in Arms Race and mode-pinned loadouts | Mid-range duelist |
| **Grok** | Striker | **Heat** — consecutive hits build up to +16% fire rate (visible glow); decays 1.5 s after the last hit, resets on death | Super jump (crouch-charge) | Snowballing pressure | Punished by poke and disengage; weak when behind | Aggressive brawler |
| **DeepSeek** | Vanguard | **Deep Compute** — sustained fire charges the next shot for bonus damage (takes the max with attachment charge; no one-shots) | Hover jets (fuel, bounded) | Highest HP, hardest single hit | Slow, must commit, flank-punished | Siege; holds long angles |
| **Meta** | Vanguard | **Braced** — out-of-combat armor regen (spawn armor only); crouching halves knockback | Brace slam | Durable space-holding | Slowest; must stand and take it | Anchor / objective holder |
| **Claude** | Vanguard | **Alignment Review** — holding ground builds a meter that grants a temporary absorb pool (~45 HP, 3 s) | Safety glide | Anchoring angles, holding ground | Must stop pressuring to charge; no mobility | Hold lines, early retreat |
| **ChatGPT** | Tactician | **Adaptive** — fastest weapon swap; first magazine after a swap keeps a handling bonus | Grapple | No bad matchup, no dead loadout | Nothing is best-in-class | Adaptive mid-band |
| **Kimi** | Tactician | **Long Context** — enemies leave brief radar trails (≤1.5 s); slightly longer range band | Blink step (0.25 s wind-up, 5 s cooldown) | Information plus long lanes | Fragile; loses close-quarters | Orbiter / sharpshooter |
| **Qwen** | Tactician | **Tool Use** — faster pickups and timed objectives (cap 1.35×), better vehicles, plus a small combat floor (pickup reload + 3.5 s handling, +15% melee reach) | Deployable rope | Objectives, vehicles, economy | Weakest straight-up fighter | Optimizer; objective-first |

**Claude** is locked to the Claude Code harness; the lock is compensated by the
strongest defensive class verb. **Qwen** is the one class that keeps a *weakened*
movement verb while carrying an objective (see Notes).

### Planned spawn stats (pending Phase-0 sign-off)

| Operator | Current HP/Armor/Speed | Planned HP/Armor/Speed |
|---|---|---|
| Mistral | 85 / 0 / 9.4 | 90 / 0 / 9.2 |
| Gemini | 95 / 10 / 8.5 | 95 / 0 / 9.0 |
| Grok | 110 / 0 / 8.3 | 105 / 0 / 8.9 |
| DeepSeek | 120 / 0 / 7.4 | 120 / 0 / 7.7 |
| Meta | 100 / 20 / 7.6 | 100 / 20 / 7.6 |
| Claude | 115 / 10 / 8.2 | 115 / 10 / 7.8 |
| ChatGPT | 100 / 0 / 8.0 | 100 / 5 / 8.6 |
| Kimi | 90 / 15 / 8.7 | 90 / 10 / 8.7 |
| Qwen | 100 / 5 / 8.4 | 100 / 10 / 8.5 |

The re-cut exists because today's roster already spans 1.57× effective HP (over
the 1.5× envelope in §4.1 of the overhaul) and same-wing operators need to sit
within ±10% of each other. Baseline movement budget numbers are in §13.3 of the
overhaul plan.

## Harnesses

| Harness | Active ability (`Q`) | Tradeoff passive | Movement hook | Strikers | Vanguards | Tacticians |
|---|---|---|---|---|---|---|
| **OpenClaw** | Claw Burst — 6 m radial pulse, 30 damage + knockback | **Grip** — melee arc +25% | Landing knocks enemies back | Pull-in | Bigger knockback | Wider radius |
| **Hermes** | Courier Rush — 1.6× speed burst | **Express** — can sprint while reloading | +1 charge / +25% fuel, −20% cooldown | Longer rush | 25% mitigation during the rush | Cooldown −1 s |
| **OpenCode** | Parallel Burst — faster fire rate | **Multiplex** — reload continues while swapped | Verb usable while firing | Faster while active | Guardrail lasts +1 s | Skip the next holster |
| **Claude Code** | Guardrail — 50% damage reduction | **Linted** — threat ping when an enemy holds a bead on you | Brace on landing | Cleanse slow on activation | +10% mitigation while active | Longer ping |
| **Codex** | Recompile — instant 45 HP heal | **Green Build** — reload 15% faster | Landing repairs a little; no fall damage | +1 s speed | Overheal up to +15% | Refill the equipped magazine |
| **Cline** | Phase Step — aimed dash | **Off-road** — extra air control, longer slide | Air-dash cancel (the only cancel) | Travels further | Unstoppable but shorter | Radar feint at the origin |
| **Roo Code** | Context Jam — radial slow | **Flood Fill** — ability radius +25%, damage −5% | Landing leaves a slow field | Drop it behind them | Stronger slow | Wider radius |

Riders fire on the shared trigger events `activate` / `air` / `land` / `end`
(§3.6 of the overhaul), so a spec never needs nine bespoke behaviours.

---

## Notes

**Claude lock.** Claude can only equip Claude Code. Default proposal: make
Claude Code exclusive to Claude so no other Vanguard gets Guardrail *plus* its
own class verb (pending sign-off S1).

**Objective carriers.** Flag/objective carriers lose their movement verb by
default — exactly one weakened exception applies, most-specific first (Qwen's
class, else the Hermes spec): no vertical lift, half charges/fuel, +50%
cooldown, harness active suppressed while carrying, and no interaction-speed
bonus on flag pickup/capture. The juggernaut keeps its verb at lift ×0.7 with
its shield frozen airborne; the VIP loses the verb and the harness active for
the round.

**Movement is paid for in tempo.** Every verb has fuel or cooldown plus
wind-up or landing recovery; airborne targets take full damage; landing adds a
short recovery beat. Hover jets are bounded (`min(vehicle maxAltitude,
arena.ceiling ?? 24 m)`), never free flight. Full rules in §4.4/§4.7.

**Ability share.** On seeded bot sweeps, class kit contribution is measured as
a counterfactual (kit enabled vs class and movement verbs disabled) and must
stay ≤30% aggregate; in-domain may run up to ±15 points. Weapons and map
control stay dominant — this remains a gunplay-first arena shooter.

**No dedicated healer.** Every mode must be completable solo with bots, so
support-adjacent kits stay self-viable.

**Where this comes from.** All decisions are recorded in §10 of the overhaul
plan; the ten remaining Phase-0 sign-off items with recommended defaults are in
§10.1.
