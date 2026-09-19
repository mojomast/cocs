# LATTICE STRIKE — Coherence Audit

> **Status:** audit, read-only research deliverable · 2026-09-19 · branch `feat/lattice-audit`
> **Base:** `688940e` ("Record the per-team snapshot contract and measured budget"), current v8.2 integration tip
> **Scope:** `cocs` / `cocs-coop` as shipped in this tree. No source code is changed by this document.
> **Companion docs:** `docs/design/COCS-MODE-SPEC.md` (rev 3.4), `docs/design/COCS-OPERATIONS.md`, `docs/design/COCS-MAP-ARCHITECTURE.md` (rev 2.3), `docs/LATTICE-FIELD-GUIDE.md`.
> **Load-bearing sentence from the mode spec:** *"LATTICE STRIKE must be a complete shooter with one front line and one number that says whether you are winning — and it must be fun before the board is switched on."* This audit finds the shooter half is present, the "one number" half is under-signalled, and the command/spend half is **functionally disconnected in local play**.

---

## 0. Executive summary

**The single most important finding:** in the mode's primary play context — local `cocs-coop` (Operations) — **every human order and every intermission spend is rejected by the simulation** before it can have any effect. The client sends `peerId: 'human'`; the co-op command gate resolves slice/executor identity against *actor ids* and rejects anything that is neither an actor slice nor a `chief-*` id. The same class of mismatch exists on the wire path, where the room stores the transport peer id in the queued record and the sim re-gates with that id. Verified deterministically:

```
local HOLD  peerId='human' -> {ok:false, reason:'executor'}; task stays null
local HOLD  peerId='0'     -> {ok:true,  task:'HOLD'}
local SCAN  peerId='human' -> {ok:false, reason:'executor'}; no scout spawns
local SCAN  peerId='0'     -> {ok:true,  scout id 8}
local SPEND peerId='human' -> {ok:false, reason:'executor'}
local SPEND peerId='0'     -> {ok:true,  cost 35 FLUX}
```

Everything else the playtest reported is real and documented below, but this one bug explains most of it: **the player's verbs in Operations do nothing**, so nothing about the mode can "feel impactful", the spend window can never move FLUX, and the command board only ever shows a synthetic readout of a plan it cannot execute.

| # | Playtest complaint | Reproduces? | Primary evidence |
|---|---|---|---|
| a | Actions do not feel impactful | **Yes — worse than reported** | `app/page.tsx:682,705` peer id `'human'` vs `game/cocs-coop.mjs:350-356`; thin feedback: `game/hud.mjs:228-240`, `game/feedback.mjs:893-894`, `game/view.mjs:1736-1737` |
| b | No solid tutorial | **Yes** | `game/lattice-guide.mjs:17-42,50-81` (static briefing + one-line coach); `game/onboarding.mjs:5-16`; no step machine, no success conditions, no sandbox mode |
| c | Ziplines feel like teleports | **Yes** | `game/cocs-traversal.mjs:284-319` sets actor x/z/y directly for `kind==='zipline'`; the `zipRide` interpolation at `game/core.mjs:193` only serves legacy `arena.ziplines`, which `lattice-slice` authors in `map.traversal` instead (`game/lattice-maps.mjs:14-27`) |
| d | Teleporter effects too weak | **Yes** | `game/view.mjs:1723` flashes portal FX only for legacy `teleport` events; COCS emits `cocs-device-use` (`game/cocs-traversal.mjs:317`). Audio is a fixed-centre 3-note blip (`game/lattice-feedback.mjs:7,16-19`) |
| e | Cannot figure out how to spend in intermission | **Yes — multiple independent causes** | pointer lock blocks HUD clicks (`app/page.tsx:529`); no keyboard spend path; local unlock auto-pauses (`:533`); open announced only via optional captions (`game/hud.mjs:161-175`, `game/config.mjs:253`); local spends rejected (`game/cocs-coop.mjs:538`); FORTIFY sends `target:'node'` (`app/ui/screens/SpendWindowHud.tsx:46`) |
| f | B board opens but cannot be interacted with | **Yes** | local snapshot has no `orderLog`/`cards` (`game/cocs.mjs:1698-1780`); board derives cards only from those (`game/cocs-orders.mjs:783-809`); `isOpen()` requires >0 cards (`app/page.tsx:709`); Enter hardcodes `check` (`:713`) and only writes an unrendered `singleNotice` (`:704`); RETRY/CHECK/PIN need mouse clicks |
| g | No graceful mouse-lock release | **Yes** | Escape → `changeMode('paused')` locally (`app/page.tsx:520`) and `lock()` auto-pauses on unlock (`:533`); no release binding (`game/keybinds.mjs:12-15`); demo mode already implements the desired two-stage Escape (`:568`) |

**Secondary but real:** the board's snapshot contract is missing the data it renders (`orderLog`/`cards` exist only on the wire for online, never locally); the room's card mirror never leaves `running` (`server/room.mjs:145-150,200`); FORTIFY's UI target is the literal string `'node'` and is rejected by `sinkTargetValid` (`game/cocs-coop.mjs:425-432`); and no COCS action except capture/lost shares the announcer path (`game/view.mjs:1736-1737`).

---

## 1. How this audit was verified

| Method | What it proves |
|---|---|
| Static reading of every file named in the brief against the design docs | The code-path claims in §2 |
| Three deterministic Node reproductions against a real `Match` (`cocs-coop`, `lattice-slice`) | Peer-gate rejection, empty board, instant device moves, spend/FORTIFY behaviour |
| A short live browser run (Vite on `:5205`, Playwright at `/tmp/opencode/lattice-browser`) | Match enters `playing`, lock is `arena-canvas`, and the sandbox renderer is usable only briefly; screenshots were not stable enough to serve as primary evidence, so the UI findings below rest on code plus pointer-lock semantics |
| Web research on teaching, game feel and pointer lock | The recommendations in §4–§6, with sources in §9 |

Reproduction scripts used (run from the repo root):

```bash
# 1. gate identity: local order/spend rejected when peerId != actor id
node /tmp/opencode/cocs-audit-orders2.mjs

# 2. board data: snapshot.cocs has no orderLog/cards; board listboxIds.length === 0
node /tmp/opencode/cocs-audit-verify.mjs

# 3. FORTIFY target: UI passes 'node'; sim needs a real node id
node /tmp/opencode/cocs-audit-fortify2.mjs
```

These scripts are throwaway diagnostics under `/tmp/opencode/`; they are not part of the commit. Every line number below is valid at base `688940e`.

---

## 2. The seven feedback points, verified

### (a) "Actions do not feel impactful in the match" — reproduces, and the root cause is functional, not cosmetic

There are two layers to this complaint.

**Layer 1 — the actions are literally rejected (P0).**

`app/page.tsx:682` issues strip orders with `peerId: r?.net?.peerId ?? 'human'`, and `:705` queues spends with `peerId: 'human'` in local play. The authoritative co-op gates resolve a player's slice/executor identity by matching the peer id against *living team-0 human actor ids* (`game/cocs-coop.mjs:246-258` builds `coopHumanIds`, `:302-306` builds `slices`). `commandPeerGate` (`:350-356`) rejects `command.humans > 0 && !chief && !human` with reason `executor`. `processCocsOrder` calls `coopOrderGate` for every co-op order (`game/cocs.mjs:657-660`), and `coopSpend` calls `coopSpendGate` for every spend (`game/cocs-coop.mjs:538`). Therefore:

- `GO` / `HOLD` / `ATTACK` orders from the strip: **rejected, `tasks[team]` stays null**.
- `SCAN` orders: **rejected, no scout ever spawns**.
- Intermission sinks: **rejected, FLUX is never spent**.

The duty Chief is unaffected because its ids start with `chief` (`chief-0`), so bots keep playing the objective while the human's commands vanish. That is exactly the "my actions don't matter" feeling: the world visibly continues, but never because of you.

On the wire path the same class of bug exists one layer down: `server/room.mjs:189` and `:246` correctly pre-gate using `String(actor.id)`, but the queued records store `peerId: String(peerId)` — the transport id (`:199`, `:229`, `:253`) — and the sim re-gates on those. Live peer ids are numeric `nextPeer++` values (`server/game-server.mjs:386`), which only accidentally align with actor ids. The two-client test masks this because it joins peers as `1` and `2`, which collide with actor ids (`server/cocs-net.test.mjs:26-28`).

**Layer 2 — even when accepted, the feedback budget is thin.**

| Action | Current feedback | Gap |
|---|---|---|
| Node capture | `cocs-capture` event → `secured`/`lost` earcon (`game/lattice-feedback.mjs:4-15`, `game/feedback.mjs:893-894`); world particle ring + `effect-capture-ring` at the node (`game/view.mjs:1653-1670`); score/HUD update in `CocsReadout` (`app/ui/screens/PlayingHud.tsx:56-98`) | No announcer: `scoreAnnouncer` returns `null` for cocs by design (`game/hud.mjs:228-240`); `view.effect`'s announcer allow-list is `capture/flag/goal` only (`game/view.mjs:1736-1737`). A 100 m-away node flip is just a small readout number |
| Order issued | HUD `SENDING …` → `LAST …` (`app/ui/screens/PlayingHud.tsx:127-128`) | `cocs-order` has no sound (`latticeSoundCue` does not handle it), no caption unless the player opted into captions, and (locally) no effect because it is rejected |
| Order completed | `cocs-order-complete` → score + REQ (`game/cocs.mjs:1589-1605`) | No cue, no banner, no world change of its own; only visible as an `ORD` counter and, if a capture coincided, the capture ring |
| SCAN / SPOT | Scout ring/chevron on marked actors (`game/view.mjs:1518-1565`) | No `cocs-scan`/spot cue, no "target marked" confirmation, no team-visible event for the spot itself |
| Device use | Earcon for the *user only* (`game/lattice-feedback.mjs:16-19`); caption "Route engaged" | No world FX for `cocs-device-use`; teammates get nothing |
| Terminal verb | Team earcon (`lattice-feedback.mjs:20-21`) | No world FX, no channel-start moment, captions optional |
| Director wave | Earcon + caption + Director HUD | The strongest existing loop; this is the model the rest should follow |

This matches the research: feedback "juice" works because it makes the causal link between action and outcome legible and graded (see §5). Here the causal link is either broken (rejection) or quiet (earcon), while the outcome (a number in a side panel) is far from the player's crosshair.

---

### (b) "There is no solid tutorial" — reproduces

What exists today:

- `game/lattice-guide.mjs:17-42` — `latticeBriefing()`: a static 4–5 step field guide shown on the selection screen and in results. It describes concepts, but never checks whether the player did anything.
- `:50-81` — `latticeCoach()`: a single contextual line plus a nearest-legal-node map. It is genuinely good *coaching*, but it has no sequence, no memory of what the player has learned, and no success condition.
- `game/onboarding.mjs:5-16` — the generic first-run modal. The lattice step is one paragraph; there is no Operations-specific teaching.
- `HELP_SECTIONS` (`game/onboarding.mjs:20-34`) — reference text, not teaching.
- The Operations Director's wave 1 is *labelled* tutorial ("D1 is the tutorial tier", `game/cocs-coop.mjs:1111`; "tutorial wave", `game/cocs-difficulty.mjs:333`), but there are no tutorial hooks in `stepCoop`; wave 1 is just a smaller swarm.

The design authority asks for more: mode spec §5.8 says "A skippable 2-minute sandbox is the only required teaching", and `COCS-OPERATIONS.md §7.1` makes "understood why we won/lost ≥ 4/5" an acceptance criterion. Nothing implements either. There is no `tutorial` mode flag, no script, no step state in the snapshot, and no success tracking. A new player's entire path is: read a panel on the selection screen → click `DEPLOY OPERATIONS` → five waves happen to them.

The research is unambiguous that this is the wrong shape for an objective mode: teach one thing at a time through play, with explicit success feedback and staged disclosure (§4).

---

### (c) "Ziplines feel like teleports instead of rides" — reproduces exactly

`game/cocs-traversal.mjs:284-319` is the COCS device machine. For every kind except `jump-pad` it does this:

```js
const destination = device.kind === 'launcher' ? (device.target ?? device.to) : device.to;
...
actor.x = destination.x;
actor.z = destination.z;
actor.y = finite(destination.y) ? destination.y : num(actor.y, 0);
actor.vx = actor.vy = actor.vz = 0;
```

Both `zip-s-w` and `tp-c-w` are therefore a single-frame position set. Verified: `useDevice(...,'zip-s-w')` moves actor 0 from `(-40, 4, 50)` to `(-6, 4, 46)` with `actor.zipRide === null`. The only time cost is the shared 2.5 s cooldown *after* the ride.

The interpolation that would make this a ride already exists — `game/core.mjs:193`:

```js
if(a.zipRide){ … const u=clamp(ride.t/ride.duration,0,1);
  a.x=…; a.z=…; a.grounded=false; … }
```

but it is only installed by `moveActor`'s legacy zipline check (`game/core.mjs:273-275`), which reads `traversalTables(arena).ziplines` from `arena.ziplines` / `arena.traversal.ziplines` (`game/core.mjs:80-86`). `lattice-slice` authors its ziplines inside `map.traversal[]` (`game/lattice-maps.mjs:21-24`), which `traversalSource()` returns as an **array**, so `arena.traversal.ziplines` is `undefined` and the legacy table is empty. The two traversal systems never meet.

Even the legacy ride is thin as a "ride": constant speed, `duration = max(0.35, distance/speed)` (`core.mjs:275`), no acceleration, no cable sag, no yaw-to-cable, no rider pose, no speed/pan audio, and no per-tick rider snapshot so a remote client cannot render a rider anyway (`cocsTraversalSnapshot` exposes only device state, `cocs-traversal.mjs:599-631`).

---

### (d) "Teleporter effects are too weak" — reproduces

The instant position move is correct for a teleporter; the presentation is not.

- **World FX:** `game/view.mjs:1723` spawns portal rings for `e.type === 'teleport'` only. That event comes from the legacy `moveActor` path (`core.mjs:274`). COCS emits `cocs-device-use` (`cocs-traversal.mjs:317`), which `view.effect()` has no branch for, so the teleport has **no portal burst at either end**.
- **Pads:** legacy teleporters get a double-ring pad model in `addTraversal` (`view.mjs:1261`); COCS traversal devices are drawn only as objective beacons in `updateCocsObjectives` (`view.mjs:1609-1620`), so the pad does not read as a teleporter.
- **Audio:** `latticeSoundCue` maps `cocs-device-use` to a motif (`lattice-feedback.mjs:7,16-19`) but only when `event.actor === player.id`, and `game/feedback.mjs:894` plays it with `this._beat(latticeCue,0,1,.2)` — fixed centre pan, no distance falloff, no arrival layer, no announcer. The teleporter motif itself is three short notes at gain `.055`.
- **Arrival:** the 1.5 s / 50 % arrival protection does exist and is telegraphed (`cocs-traversal.mjs:173-191`; `view.mjs:1634-1647`). That is a buff the player cannot feel; there is no landing flash, sound or camera impulse tied to it.
- **Camera:** neither device sets any camera state; `view.effect` has no teleport shake/FOV kick; the player's camera cuts instantly with the actor, which is the strongest possible "teleport rather than ride" cue.

---

### (e) "Players cannot figure out how to spend during the intermission spend window" — reproduces, with six independent causes

1. **The pointer blocks the buttons.** `.cocs-spend` is `pointer-events:auto` (`app/globals.css:1186,1228`), but during play the pointer is locked to `arena-canvas`. Pointer lock "locks the target of mouse events to a single element" (MDN); no click ever reaches the sink buttons (`app/ui/screens/SpendWindowHud.tsx:37-56`).
2. **There is no keyboard path.** No `spend` action exists in `game/keybinds.mjs`; `app/page.tsx` has no keydown branch for sinks. The only handler is `onClick` on each sink.
3. **Releasing the lock pauses a local match.** `lock()` (`app/page.tsx:533`) calls `changeMode('paused')` when a local match loses lock, which unmounts `PlayingHud` and the spend window behind the pause modal. So even a player who discovers Escape cannot mouse-click the sinks in local Operations. Online, the match keeps running and a pointer hint appears — but that path is undiscoverable and the hint does not mention spending.
4. **Opening is almost silent.** `coop-intermission-open` (`game/cocs-coop.mjs:1325-1328`) has a caption (`game/hud.mjs:164-166`) but captions default to `false` (`game/config.mjs:253`), and there is no earcon (`latticeSoundCue` returns `null` for it) and no announcer (`view.mjs:1736-1737`). The Director readout's sink list is inside a collapsed `<details>` (`app/ui/screens/OperationsDirectorHud.tsx:63-72`).
5. **The sim rejects the spend anyway.** Verified: the queue record from `spendCocs` (`app/page.tsx:705`, `peerId:'human'`) fails `coopSpendGate` with `executor` (`game/cocs-coop.mjs:538`). FLUX stays pinned at cap — the exact failure the O1b sinks were built to fix (`COCS-OPERATIONS.md §7.2`).
6. **FORTIFY can never be bought.** `cocsSpendView` passes the sink's *target type* (`game/cocs-orders.mjs:1016`: `target: sink.target`, which is `'node'`) and `SpendWindowHud` passes it straight to `onSpend` (`SpendWindowHud.tsx:46`). `sinkTargetValid` requires a real owned node id (`game/cocs-coop.mjs:426-428`). Verified: `{verb:'FORTIFY', target:'node'}` → `reason:'target'`; `target:'front-0'` → `ok:true`. The panel shows FORTIFY as READY and then the spend log says it failed.

---

### (f) "The B command board opens but cannot be interacted with" — reproduces, and locally it opens empty

The board *does* open on hold-`B` (`app/page.tsx:508`) and closes on release unless pinned (`:527`). The failure is in what it contains and how it can be touched.

**It is empty because the data never reaches the local snapshot.** The board's card list prefers explicit `cards`, else synthesises from `snapshot.orderLog` / `snapshot.command.orderLog` (`game/cocs-orders.mjs:783-809`). Verified: `snapshot.cocs` has no `orderLog` and no top-level `cards`; `snapshot.command` has no `orderLog`/`cards` either. At match start and after 8 seconds of sim, `cocsBoardView(...).listboxIds.length === 0` and the summary is `⚠ 0 blocked · ▶ 0`. Online, `server/room.mjs:386-392` attaches `cocs.cards` from the room mirror, but the mirror only leaves `running` for *rejected* actions (`rejectCocs`, `:157-159`); accepted cards are never marked done or blocked, so the online board accumulates stale running rows.

**Keyboard interaction is gated on having cards.** `cocsBoardControlRef.isOpen()` requires `count > 0` (`app/page.tsx:709`), so while the board is empty the arrow/Enter branches (`:509-516`) do nothing at all.

**The one action the keyboard can take is a no-op.** `activate` at `:713` is hardcoded:

```js
activate:()=>{ … activateCocsBoardCard(card, card.status==='blocked'?'check':'check'); }
```

For a local match, `activateCocsBoardCard` (`:704`) only writes `r.singleNotice = {type:'cocs-card', …}`. `singleNotice` is rendered by `SinglePlayerHud`, which is mounted only when `isSingle` (horde/campaign) (`app/ui/screens/PlayingHud.tsx:175`). In `cocs`/`cocs-coop`, nothing renders it. `RETRY` has no local implementation at all.

**Every other control needs a click.** PIN, close, expand and RETRY/CHECK are `<button>`s (`app/ui/screens/CommandBoardHud.tsx:31,54-55,99-100`); the listbox rows themselves are clickable `<div role="option">` (`:35-42`). Under pointer lock those clicks never arrive; and even the inline `B · COMMAND BOARD` strip button (`PlayingHud.tsx:129`) is pointer-only. There is no keyboard binding to pin, retry, or close (Escape closes, which is the one accessible path).

So the player's experience is accurate: the panel opens, the pointer is gone, the keys do nothing, and the mouse does nothing.

---

### (g) "There is no graceful way to release mouse lock" — reproduces

Pointer lock's only user-initiated release is the browser's default gesture, Escape (W3C Pointer Lock 2.0 §non-normative: "Escape will always be provided by a default unlock gesture"). The app's handling of that is:

- `app/page.tsx:520` — `Escape` during play: `changeMode(r.net?.started ? 'lobby' : 'paused')`. In a **local** match, Escape means *pause*, not *cursor*.
- `:533` — `lock()` treats losing lock as an event: local + `hadLock` → `changeMode('paused')`; so merely releasing the cursor auto-pauses the match.
- The pointer hint (`PlayingHud.tsx:195`, copy in the component) only appears after the lock is already lost or failed, and its call to action is "Capture mouse". There is no static "press Esc to release the cursor" on the HUD and no explicit release binding (`game/keybinds.mjs:12-15`).
- Re-locking after a browser-initiated escape requires a *fresh engagement gesture* before `requestPointerLock` will succeed (W3C/MDN); the app's `requestLock` (`:587`) is called from canvas mousedown (`:529`) or the hint button. Repeated escapes can also make the browser reluctant to re-lock without a deliberate click. There is no UI that explains this.
- The codebase already contains the desired pattern in **demo mode** (`:568`): the first Escape while pointer-locked only releases the cursor; a second Escape exits. Gameplay does the opposite.

The result: a player who wants the cursor (to use the board or spend window) either loses the match's input to a pause modal or, online, is left with a match still running and a one-line hint that tells them how to re-lock, not how to release.

---

## 3. Mechanics impact table

Legend: **input** = what the player physically does today; **authoritative effect** = what the sim actually changes when the action is accepted; **feedback loop** = what the player perceives today.

| Action | Current input | Authoritative effect | Feedback loop (today) | Gap | Concrete improvement |
|---|---|---|---|---|---|
| **Capture a node** (`front`/`econ`/`relay`) | Stand in the capture ring; capture is automatic (`game/cocs.mjs:1612-1649`) | `node.owner` flips; `+10/15/20` OP score; connected income changes; `+8 REQ` per participant (`cocs.mjs:1575-1588`) | `secured`/`lost` earcon (`lattice-feedback.mjs:4-15`); node ring recolours; particles if the node is in view (`view.mjs:1653-1670`); `CocsReadout` score/hint text (`PlayingHud.tsx:62-79`) | No announcer (explicit `return null`, `hud.mjs:234`); no screen banner; no camera impulse; `+15 OP` is not surfaced as a moment; capture reward is invisible if off-screen | Add a `cocs-capture` announcer call + world banner (`OBJECTIVE SECURED · WEST BASTION +10 OP`), a short camera FOV/pulse on local captures, and a floating `+10 OP · +8 REQ` at the point. Reuse the existing `objective-announcer` markup (`PlayingHud.tsx:176-180`) |
| **Issue `GO`/`HOLD`** | `M`/`P`/`N` arm → digit pick → Enter (`PlayingHud.tsx:118-128`) | **Rejected locally** (`executor`); intended: `state.tasks[team]` for a 2 s TTL that counts as presence on the node (`cocs.mjs:678-688`) | Strip shows `SENDING → LAST`; order is not in the snapshot; nothing changes in the world | Local/online identity mismatch (§2a); even when accepted there is no confirmation beyond the strip line; no "order complete" beat | Fix identity (P0); add an order announcer + a temporary node marker for the ordered target (visual "this is your order"), and a `ORDER COMPLETE` banner/reward toast when `cocs-order-complete` fires |
| **Issue `SCAN`** | same strip | **Rejected locally**; when accepted: spawns/retargets SCOUT, 7 FLUX, marks enemies for 8 s +15 % damage (`cocs.mjs:799-833,886-902`) | `SCOUT EN ROUTE/SCANNED` chip (`PlayingHud.tsx:94`); spot rings on marked actors (`view.mjs:1523-1565`) | No audio/announcer on issue, arrival or mark; no team-wide "enemy marked" feedback; scout path invisible between spawn and scan | Add `SCAN` launch/arrival/mark cues and a "TARGET MARKED ×N" callout; show the scout's route on the radar; make the spot bonus read as a damage number change |
| **Ride a device** (zip/teleporter/launcher) | `E` at the anchor (`cocs-traversal.mjs:563-593`; `PlayingHud.tsx:108-116`) | Non-pad devices **set actor position instantly** (`cocs-traversal.mjs:298-305`); 1.5 s/50 % arrival protection (`:173-191`) | RIDE prompt; device-state earcon for the user only; caption; arrival ring; device beacon | No ride for ziplines; no portal FX/pad model for COCS devices; no camera/speed audio; teammates get no cue | **Ziplines:** implement a ride (see §2c) with duration from authored speed, cable-sag curve, rider pose, cable hum + wind, arrival landing. **Teleporters:** portal burst at both ends, camera blend, distance-panned SFX, 1.5 s buff chip. **Launchers:** keep ballistic flight, add whoosh + landing ring |
| **Cut / lock / repair a device** | Hold `E` in the 6 m band (`cocs-traversal.mjs:539-550`) | Starts a channel; completion flips device state for 30–45 s and denies both teams (`:246-263,385-394`) | Channel bar in the HUD prompt (`PlayingHud.tsx:108-113`); state earcon? (no `cocs-device-cut` cue exists); beacon colour change + particles on flip (`view.mjs:1665-1670`) | Channel start/cancel has no feedback; the strategic effect ("the flank just closed") is only a beacon tint; no announcer | Add a channel start/interrupt/completion kit (audio + ring), an announcer line for CUT/LOCK/REPAIR, and a "route denied for Ns" HUD element |
| **Buy an intermission sink** | Click a sink card (`SpendWindowHud.tsx:37-56`) | **Rejected locally**; intended: FORTIFY/REPAIR/RESUPPLY/REINFORCE (`cocs-coop.mjs:477-524`) with team FLUX debit and per-player slice/executor gate | Panel appears top-centre for 30 s; sink list + FLUX; `SPENT` line; no audio, no announcer; failed entries in the log | Cannot click under lock; no keys; local gate rejects; FORTIFY target bug; open is nearly silent | Make the window announce itself (announcer + banner + short sting), give it a keyboard path (number/Enter, or auto-focus listbox), resolve FORTIFY target to the best owned node (with a picker), and play a per-sink effect + result toast (heal rain, shield wall, HQ weld) |
| **Terminal HACK/DEPLOY/VAULT** | `E` at a terminal (`cocs.mjs:1815-1816`; `cocs-terminals.mjs`) | Channel; HACK ×2 capture, DEPLOY oracle, VAULT pull/store (`cocs-terminals.mjs:154-227`) | `cocs-terminal-*` team earcon; caption; terminal list in `CocsTerminalsHud` | Channel start/complete invisible outside the panel; no world FX; captions optional | Same channel kit as devices; add a terminal-local FX (screen flash/beam) and a completion banner |
| **Spot an enemy** (SCOUT mark) | Automatic on scout scan (`cocs.mjs:886-902`) | `+15 %` damage for 8 s from the spotter's team (`cocs.mjs:78`) | Ring/chevron on the marked actor; `SPOTTED n` chips; radar ring (`PlayingHud.tsx:97`) | No cue at mark time; the damage bonus is invisible (no different hitmarker/damage number); cooldown on first-spot FLUX unsurfaced | Announcer "TARGET MARKED", a distinct hitmarker/damage-number tint for spotted targets, and a `+3 FLUX` tick for the spotter |

---

## 4. Research: teaching an objective-based multiplayer mode

**What the literature and shipped games converge on.**

1. **Teach through play, one concept at a time, with explicit success feedback.** Riot's GDC 2024 Rainbow Six Siege onboarding redesign replaced text screens with a *task system*: the game loop explains a concept and highlights the input, the learn loop lets the player perform it, and the loop "gives feedback of completion and moves to the next task". It was measured with time-to-completion, confidence and knowledge scores, and followed by "vs AI — contextual learnings". (Marc Ballart, GDC 2024.)
2. **Prime → teach → observe.** Asher Vollmer's GDC talk (Prime, Teach, Observe) recommends priming the mechanic before asking for it, letting the player internalise it in a safe puzzle, then observing free play and iterating. This maps directly to a scripted first wave followed by unscripted Operations.
3. **Don't build a tutorial level if the level itself can teach.** Miyamoto's first-Goomba design and Mega Man X's opening highway are the canonical examples: the level introduces a mechanic safely, then tests it. The Lattice Foundry map already has the right furniture (a front gate, two siphons, a relay, a zipline flank); the missing piece is scripted success feedback, not a new map.
4. **Stage the disclosure.** NN/g's progressive-disclosure guidance: show only the most important options first; make the path to more obvious; and don't exceed 2–3 levels. The mode spec already commits to tiers 0–3 (§5.8) but nothing implements the tier-0 teaching path.
5. **Reference progression structures exist in this genre.** Dota 2's Training missions are a sequence of small scripted scenarios (move → attack → skills → items → lane vs bots) before "play vs bots". TF2's training mode and R6's "versus AI" follow the same pattern. A skippable 2-minute operations sandbox is the smallest version of this.

**What this means for LATTICE STRIKE:** a **Field Training** scripted scenario in the real mode, on the real map, with six observable steps and a per-step success condition, skippable at any time, and reused as the onboarding for any future PvP `cocs` practice match.

### Recommended tutorial structure

**Entry point.** Add a `training: true` config flag on the `cocs-coop` match plus a `FIELD TRAINING · 2 MIN · SKIPPABLE` choice beside `DEPLOY OPERATIONS` in the briefing panel (`app/ui/screens/SelectionScreen.tsx:75-77`). Default: new profiles get the training choice highlighted; returning players get `DEPLOY OPERATIONS`. No new mode id is required, which keeps the mode registry, queue and result screens untouched.

**Module.** New pure module `game/cocs-training.mjs` exporting a frozen `TRAINING_STEPS` array and `stepCocsTraining(match, state, dt)`. Each step is `{id, title, instruction, coach, anchor, success(state, player, events), reward}`. The step machine lives inside `stepCoop` (co-op only), writes a small `snapshot.cocs.training` subtree, and emits `cocs-training-step` events. No new input, no new mode, no RNG.

**Steps, success conditions, and feedback** (all conditions are pure reads of existing authoritative state):

| # | Step | Teach | Success condition (authoritative) | On success |
|---|---|---|---|---|
| 0 | **BOOT** | move + look + the front indicator | player has left the HQ radius (any node in view is a bonus) | coach advances; first objective marker pulses |
| 1 | **TAKE THE FRONT** | capture is automatic, adjacency is the rule | `front-0.owner === 0` (or `front-1` on the rotated layout) | `OBJECTIVE SECURED` announcer + `+10 OP` toast; income ticker appears |
| 2 | **FEED THE LINE** | connectivity income | an owned `economy` node is `connectedToHq` (`game/cocs.mjs:533-555`) | `+3 FLUX/s` callout; FLUX bar animates for 3 s |
| 3 | **RIDE THE FLANK** | device anchor / RIDE / CUT / REPAIR | one `cocs-device-use` event by the player (`game/lattice-feedback.mjs:16`) | ride feedback (see §2c); prompt switches to "hold E again to CUT the route" |
| 4 | **GIVE AN ORDER** | the strip | `orderStats.issued >= 1` for the human's card, **after the peer-identity fix** | order announcer + node order marker; `GIVE ANOTHER ORDER` hint |
| 5 | **SPEND THE SURPLUS** | the intermission window | one accepted `coop-spend` by the player during a scripted 20 s intermission after step 3 | sink effect + reward toast; `WINDOW CLOSES IN 5s` countdown |
| 6 | **HOLD THE LINE** | wave pressure + HQ | wave 1 cleared with `hq-0` health ≥ 50 % | `WAVE CLEARED · OPERATION CONTINUES`; training flag drops and the normal 5-wave operation resumes |

**Rules.** Any step can be skipped with the existing Escape/`SKIP TRAINING` control (research: skippable tutorials outperform forced ones for experienced players). There is no fail state; a step that is not satisfied simply waits while the Director keeps running (wave 1 is already the gentle wave). The step machine must never gate spawns or captures — it observes only.

**Reuse for Operations and PvP.** The same module serves three callers:
1. `cocs-coop` + `training:true` (this design);
2. a lobby "operations refresher" that runs steps 1–2 before wave 1;
3. a future `cocs` practice match with the PvP subset (steps 1, 4 + "look at the scoreboard"), which is why the step list is data, not code.

**Verification.** A `cocs-training.test.mjs` asserts each success predicate against a seeded match (same shape as `cocs-coop.test.mjs`), and the telemetry contract asks for `trainingStepsCompleted`, `trainingSkipped`, and the comprehension pass `understood why we won/lost ≥ 4/5` that `COCS-OPERATIONS.md §7.1` already requires.

---

## 5. Research: action feedback / game feel (what makes a capture, order or device use feel consequential)

The research frame has three usable layers:

1. **Games are learned through action → outcome loops.** The Pichlmair & Johansen survey defines *juicing* as "an intensification of experience by adding feedback to emphasise, clarify, and amplify the intended game event", and notes juice "requires exact timing of particle emissions, freeze frames, audio cues, perspective changes". The DIGRA "Good Game Feel" framework asks the concrete checklist questions: does the action translate into feedback the player expects (consistency)? Is the feedback relevant to the action (relevance)? Do players receive explicit critical information? Their participants summarised it as *"you should be able to estimate from the juiciness of each action the utility of that action"*.
2. **Juice works through competence and effectance, not just spectacle.** The CHI 2024 study "How does Juicy Game Feedback Motivate?" finds that juicy feedback's motivational effect is mediated by curiosity and competence/effectance, and that "legible action-outcome bindings and graded success" are preconditions. In other words: a flash without a legible causal link does nothing; a legible link with appropriate amplification is what makes a capture feel like a capture.
3. **Shooter practice: announce, mark, and change the world.** Halo's announcer is the canonical objective-state channel ("Flag taken", "Territory captured", "Territory lost", "Territory contested" — Halo Alpha), and Marty O'Donnell's GDC 2002 talk documents the layered design (dialogue as the top layer over music and effects, synchronized to game state). Modern arena shooters follow the same hierarchy: a short earcon for *you*, a voice call for *everyone*, a banner for the moment, and a persistent HUD state for *after*.

**Applied to LATTICE STRIKE.** The existing `lattice-feedback.mjs` earcons are a good foundation but they are *ambient*, not *announcing*: one motif per event, no priority, no announcer, no positional layer, and no persistent state change beyond the side panel. The recommended feedback kit has four tiers:

1. **Bound (your action):** a short earcon + a local toast/floatie with the exact reward (`+10 OP · +8 REQ`), a hitmarker-style confirmation, and — for captures/orders/devices — a camera pulse or FOV beat (respect `reducedMotion`, which already snaps rather than animates elsewhere).
2. **Announce (team action):** a voice/announcer line queued through the existing `announcerCue` path with a priority table (capture > order complete > terminal > device > scan). The view already has the announcer channel; `cocs` events are simply excluded today (`view.mjs:1736-1737`).
3. **Mark (world state):** a marker that survives the moment — a banner over the node for the duration of a hold, a route marker for the ordered target, a spotted-target ring, an "HQ under siege" pulse. The world already changes (owner colours), but not at the player's eye level.
4. **Persist (HUD):** the existing `CocsReadout` is where the "one number" lives; it should own a dominant `OP` delta and a `FLUX +N/s` tick so the ongoing consequence of the action stays visible after the flash. Today the score is a small two-team line and the income is a `+x/s` chip (`PlayingHud.tsx:62-96`).

The impact table in §3 proposes one concrete item per action in each of these tiers; the P0/P1 backlog in §7 groups them so the first wave is cheap (announcer hooks + toasts + camera pulse), not a new VFX budget.

---

## 6. Research: pointer-lock / cursor conventions in browser shooters

**What the platform guarantees and what is conventional.**

- Pointer lock hides the cursor and targets all mouse events at the locked element (MDN: "locks the target of mouse events to a single element", "hides the cursor"). HUD buttons are therefore unreachable while locked; this is not a bug in the board, it is the platform contract.
- Escape is always the default unlock gesture and cannot be removed (W3C Pointer Lock 2.0). After a browser-initiated escape, `requestPointerLock` requires a new engagement gesture (MDN/W3C), and repeated escapes can make user agents reluctant to re-lock without a deliberate click.
- The conventional browser-FPS pattern is a **two-state input model**: gameplay lock ↔ cursor mode. Entering cursor mode is an explicit, discoverable action (Esc, a "cursor" binding, or opening a menu), releasing it re-locks on click; and while unlocked the game either pauses (single-player) or keeps running with an unobtrusive "click to resume" affordance (multiplayer). Browser shooters that support in-game menus commonly advertise `Esc to unlock cursor` on-screen and provide a `TAB`/`M`-style keyboard alternative so the menu never requires the pointer.
- Accessibility guidance in the repo's own help text already commits to keyboard reachability ("Every menu tab, panel and modal is keyboard reachable", `onboarding.mjs:116`); the in-match board and spend window break that promise.

**Concrete convention for LATTICE STRIKE.**

1. Add a first-class `releaseCursor` keybind (default `LeftAlt`, fallback `Escape` when the player opts into "Escape releases cursor only") in `game/keybinds.mjs`. In gameplay it calls `document.exitPointerLock()` and sets a `cursorMode` flag without changing `mode`.
2. In cursor mode, keep the match running in **both** local and online play (local currently pauses — that behavior should move behind the explicit pause action). Show a persistent `CURSOR FREE · CLICK TO FIGHT` chip that doubles as the re-lock button.
3. While the board or spend window is open, **auto-enter cursor mode** (the board becomes clickable) and show the keyboard path alongside (`↑↓ MOVE · ENTER ACT · ESC CLOSE`). Re-lock on board close unless the player pinned it.
4. Keep a complete keyboard path so a player who never releases the cursor can still use both surfaces: number keys to select sinks/cards, Enter to activate/retry, `P` or a dedicated key to pin, Escape to close. The design spec already mandates keyboard navigation under lock (`COCS-MODE-SPEC.md §5.4`); this audit makes it real.
5. Document the release in the HUD's static hint line (`hud.mjs:escapeHint`, currently `ESC / PAUSE` or `ESC / LOBBY`), the field guide (`lattice-guide.mjs:28-29`) and the loading hint.

---

## 7. Prioritized backlog

Every item names the owning surface and the files it would touch. "P0" = blocks the mode's core loop or breaks the mode's core promise; "P1" = required for the mode to feel intentional; "P2" = polish and follow-through. File paths are relative to the repo root.

### P0 — core loop broken / unplayable command layer

| ID | Item | Owning surface | Files |
|---|---|---|---|
| P0-1 | **Fix peer identity in co-op command and spend gates.** Local: send a real peer/actor identity from the page and resolve `human` in the sim; wire: store the actor id (not the transport id) in queued records, or re-resolve it in `processing`. Add a regression that runs `GO`/`SCAN`/`RESUPPLY` through `Match.step` with the *exact* local and wire record shapes. | mechanics/economy + server | `app/page.tsx:682,705`; `server/room.mjs:189-199,229-253`; `game/cocs.mjs:657-660`; `game/cocs-coop.mjs:350-392,538`; `server/cocs-net.test.mjs` |
| P0-2 | **Resolve FORTIFY's target.** `cocsSpendView` should publish the default legal node id (or the UI should open a node picker); the sim keeps its validation. Regression: FORTIFY via the spend model succeeds on an owned node. | mechanics/economy + UX | `app/ui/screens/SpendWindowHud.tsx:46`; `game/cocs-orders.mjs:988-1058`; `game/cocs-coop.mjs:425-432`; `game/cocs-coop-o1b.test.mjs` |
| P0-3 | **Cursor mode + keyboard interaction.** `releaseCursor` binding; release does not pause local play; board/spend auto-enter cursor mode; full keyboard path for sinks/cards/pin/retry; static release instruction on the HUD. | UX/pointer-lock | `app/page.tsx:501-533,587,696-715`; `game/keybinds.mjs:5-15`; `app/ui/screens/CommandBoardHud.tsx:25-117`; `app/ui/screens/SpendWindowHud.tsx`; `game/hud.mjs:escapeHint`; `app/styles/lattice-guide.css` |
| P0-4 | **Board data + real actions.** Expose the order log/cards (or derive cards from the event stream) in local snapshots; make `Enter` perform the card's action (`RETRY`/`CHECK`/`PIN`/`ORDER`), not always `check`; surface `singleNotice` in cocs; add keyboard pin/retry. | mechanics/board + UX | `game/cocs.mjs` (`cocsSnapshot`); `game/cocs-orders.mjs:690-921`; `app/page.tsx:690-715`; `app/ui/screens/CommandBoardHud.tsx:52-57`; `app/ui/screens/PlayingHud.tsx:168-172` |
| P0-5 | **Intermission spend announcement + confirmation.** Announcer/sting on `coop-intermission-open` and `coop-spend`; sink result toast; countdown chip outside the collapsed `<details>`; `aria-live` for the window. | UX/announce + HUD | `game/lattice-feedback.mjs:13-23`; `game/view.mjs:1736-1737`; `app/ui/screens/OperationsDirectorHud.tsx:63-72`; `app/ui/screens/SpendWindowHud.tsx`; `app/styles/lattice-guide.css` |
| P0-6 | **Zipline ride.** Route COCS `zipline` devices through an interpolated ride (duration = length/authored speed with min/max, velocity carry, gravity/cable sag option, rider lockout) instead of an instant set; snapshot rider state so remote clients can render it. | zipline/FX + mechanics | `game/cocs-traversal.mjs:284-319,599-631`; `game/core.mjs:193,273-275`; `game/cocs-economy.mjs:502,532`; `game/lattice-maps.mjs:21-24`; `game/cocs-traversal.test.mjs` |

### P1 — impact, teaching, presentation

| ID | Item | Owning surface | Files |
|---|---|---|---|
| P1-1 | **Objective feedback kit** (announcer priority table, capture banner, local camera pulse, `+OP/+REQ` floaties, income ticker). | mechanics/impact + FX | `game/lattice-feedback.mjs`; `game/view.mjs:1653-1670,1736-1737`; `game/hud.mjs:228-240`; `app/ui/screens/PlayingHud.tsx:56-131` |
| P1-2 | **Order lifecycle feedback** (`cocs-order` launch cue, target marker, `cocs-order-complete` banner/reward toast). | mechanics/impact | `game/cocs.mjs:1575-1610`; `game/lattice-feedback.mjs`; `game/view.mjs`; `app/ui/screens/PlayingHud.tsx` |
| P1-3 | **Device + terminal FX pack** (portal burst both ends, pad models for `map.traversal` teleporters, channel start/interrupt/complete kit, positional SFX, arrival chip). | zipline/FX | `game/view.mjs:1261,1609-1647,1723`; `game/lattice-feedback.mjs`; `game/cocs-traversal.mjs`; `game/feedback.mjs` |
| P1-4 | **Field Training script** (`training:true`, six steps, skippable, success predicates, snapshot subtree) and the selection-screen entry. | tutorial | new `game/cocs-training.mjs`; `game/cocs-coop.mjs` (`stepCoop`); `game/lattice-guide.mjs`; `game/cocs.mjs` (snapshot); `app/page.tsx`; `app/ui/screens/SelectionScreen.tsx`; new `game/cocs-training.test.mjs` |
| P1-5 | **Progressive disclosure for the board** (tier 0 = 3 buttons / tier 1 = sections / tier 2 = costs+focus), driven by a preset, not a lock; surface the tier in `LatticeBriefing`. | tutorial + UX | `game/lattice-guide.mjs`; `game/cocs-orders.mjs`; `app/ui/screens/CommandBoardHud.tsx`; `game/config.mjs` |
| P1-6 | **Room card lifecycle.** Update the mirror when an order completes/fails in the sim; attach the sim order log to the wire snapshot so the board's exception list is authoritative online too. | bots/server | `server/room.mjs:145-159,386-392`; `game/cocs.mjs` (`cocsSnapshot`) |
| P1-7 | **Spend window layout + overlap.** Keep the board, spend panel and Director readout from covering each other; move the Director sink list out of the collapsed details during the window. | UX/HUD | `app/globals.css:1228`; `app/ui/screens/OperationsDirectorHud.tsx:63-72`; `app/ui/screens/PlayingHud.tsx:170-172` |
| P1-8 | **Field-guide/help coherence.** One page that explains verbs, keys, score and spend with the real key labels; reuse `latticeKeys()`; update `HELP_SECTIONS` and the pause-menu field guide. | tutorial + docs | `game/lattice-guide.mjs`; `game/onboarding.mjs:20-34`; `app/ui/screens/LatticeGuide.tsx` |

### P2 — follow-through

| ID | Item | Owning surface | Files |
|---|---|---|---|
| P2-1 | Training/telemetry: step completion, skip rate, time-to-first-capture, "understood why we won/lost" survey hook. | tutorial + server | `game/cocs-coop.mjs`; `server/room.mjs`; `scripts/cocs-validate.mjs` |
| P2-2 | Bots use devices deliberately (the `botUse` path exists at `cocs-traversal.mjs:321-355`) and sabotage device usage reads; verify lanes stay used. | bots/server | `game/cocs-traversal.mjs`; `game/cocs-bots.mjs`; `game/lattice-maps.mjs` |
| P2-3 | Accessibility pass on the two new surfaces: focus order, `aria-activedescendant`, reduced-motion snap, colour-blind palette check, remap tests. | UX/accessibility | `app/ui/screens/CommandBoardHud.tsx`; `app/ui/screens/SpendWindowHud.tsx`; `game/lattice-ui-o1c.test.mjs` |
| P2-4 | Performance guard for ride FX and announcer queues at 24 actors (no new per-tick allocations; reuse EffectPool/Moth sprites). | zipline/FX + perf | `game/view.mjs`; `game/perf.mjs`; `game/cocs-net-budget.test.mjs` |

---

## 8. Recommended implementation order

**Phase 0 — make the verbs real (2–3 days).** P0-1, P0-2. No new UX; just the identity and target fixes plus regression tests that pass the exact local/wire record shapes. Success: in a local Operations match, `GO`/`SCAN` produce `tasks`/scouts, and each sink applies and debits FLUX.

**Phase 1 — make the surfaces usable (2–4 days).** P0-3, P0-4, P0-5. Cursor mode, keyboard paths, board data/actions, spend announcement. Success: a mouse-free playthrough can open the board, activate a card, and buy all four sinks; Escape releases the cursor without pausing a local match.

**Phase 2 — make the actions feel like actions (3–5 days).** P0-6, P1-1, P1-2, P1-3. Ride, capture/order/device feedback kit. Success: the impact table's "gap" column is empty for every row; reduced-motion snap variants exist.

**Phase 3 — teach it (1–2 weeks).** P1-4, P1-5, P1-8. Field Training plus progressive disclosure and the updated guide. Success: a first-time player reaches the first capture, issues an order and buys a sink inside one scripted run; the comprehension metric from `COCS-OPERATIONS.md §7.1` is measurable.

**Phase 4 — follow-through (parallel).** P1-6, P1-7, P2-1..4. Room card lifecycle, layout, telemetry, bots, accessibility, perf guards.

Why this order: P0-1/P0-2 are tiny and unblock everything else; without them any feedback work amplifies a lie (the game would celebrate an order that never applied). P0-3/P0-4 are prerequisites for the spend/tutorial steps because both surfaces need to be operable before they can teach anything. Feedback (Phase 2) lands before the tutorial (Phase 3) so the tutorial can point at feedback that exists — otherwise the training steps themselves would be quiet.

---

## 9. Sources

**Teaching / onboarding**

- Marc Ballart (Ubisoft), *Teaching Complex Games: Onboarding Redesign for Rainbow Six Siege*, GDC 2024 — slide deck: <https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/TeachingComplexGames_MarcBallart.pdf> (task system, versus-AI contextual learnings, TtC/confidence metrics).
- Asher Vollmer, *Prime, Teach, Observe: Tutorializing Innovative Mechanics*, GDC — <https://gdcvault.com/play/1020512/Prime-Teach-Observe-Tutorializing-Innovative>.
- Itay Keren (Untame), *Teaching by Design: Tips for Effective Tutorials from Mushroom 11*, GDC 2017 — <https://www.gdcvault.com/play/1024187/Teaching-by-Design-Tips-for>.
- *Video Game Tutorials: How Do They Teach?*, Game Developer, 2023 — <https://www.gamedeveloper.com/design/video-game-tutorials-how-do-they-teach-> (Miyamoto/Mega Man X teaching-by-level-design; avoid "chore" tutorials for experienced players).
- Dota 2 Training missions (scripted mechanics → lane → vs bots progression) — <https://dota2.fandom.com/wiki/Training>.
- Jakob Nielsen, *Progressive Disclosure*, NN/g, 2006 — <https://www.nngroup.com/articles/progressive-disclosure/>.

**Action feedback / game feel / announcer practice**

- Martin Pichlmair & Mads Johansen, *Designing Game Feel. A Survey*, arXiv:2011.09201 / IEEE ToG 2021 — <https://arxiv.org/abs/2011.09201> (tuning/juicing/streamlining; juicing = "intensification … to emphasise, clarify, and amplify").
- Hicks et al., *Good Game Feel: An Empirically Grounded Framework for Juicy Design*, DiGRA — <https://dl.digra.org/index.php/dl/article/download/936/936/933> (consistency, relevant/explicit feedback; "you should be able to estimate from the juiciness of each action the utility of that action").
- *How does Juicy Game Feedback Motivate? Testing Curiosity, Competence, and Effectance*, CHI 2024 — <https://dl.acm.org/doi/fullHtml/10.1145/3613904.3642656> (legible action–outcome bindings and graded success as preconditions).
- Marty O'Donnell, *Producing Audio for Halo*, GDC 2002 — <https://www.gamedeveloper.com/audio/producing-audio-for-halo>; Halo multiplayer announcer vocabulary (flag taken/captured, territory captured/contested) — <https://halo.fandom.com/wiki/The_Announcer>.

**Pointer lock / browser FPS conventions**

- MDN, *Pointer Lock API* — <https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API> (event targeting, cursor hidden, re-lock requires an engagement gesture, `pointerlockchange`/`pointerlockerror`).
- W3C, *Pointer Lock 2.0* — <https://www.w3.org/TR/pointerlock-2/> (Escape is the mandatory default unlock gesture; repeated escapes; focus-loss release; iframe sandboxing note).
- Chromium *Mouse Lock (Pointer Lock)* design document — <https://chromium.googlesource.com/playground/chromium-org-site/+/b397a6a505b620f11f9b7f62243a9b89cca3fc5a/developers/design-documents/mouse-lock.md> (escape/fullscreen interactions and re-lock behavior).

**In-repo authority**

- `docs/design/COCS-MODE-SPEC.md` rev 3.4 — §3.1 ladder, §4.2 economy, §4.8 logistics, §5.4 board and pointer-lock rule, §5.8 progressive disclosure, §6A traversal doctrine, §13.4 input remapping.
- `docs/design/COCS-OPERATIONS.md` — §3.3 between-wave spending, §4 difficulty tiers, §5.2 shared-pool/slice/executor model, §7.1 acceptance criteria ("skippable 2-minute sandbox", comprehension ≥ 4/5), §7.2 O1b sink gates.
- `docs/design/COCS-MAP-ARCHITECTURE.md` rev 2.3 — §6.8 traversal level-design gates (arrival protection, cuttable/lockable, bypass fraction).
- `docs/LATTICE-FIELD-GUIDE.md` — current player-facing verb/key reference.

---

## 10. What already meets the spec (do not regress)

- The lattice itself: adjacency-gated capture, connectivity income, live-node selection and the front indicator are implemented and tested (`game/cocs.mjs:474-613`), with a real map (`game/lattice-maps.mjs`) and validator coverage.
- The board *shape* matches the spec: 3 sections, ≤8 cards, one status chip, one blocker, shape+word, reduced-motion snap (`game/cocs-orders.mjs:816-957`, `app/ui/screens/CommandBoardHud.tsx`). The problem is data and input, not layout.
- The spend model exists on the sim side and works when addressed correctly: `coopSpend` moved 132 → 97 FLUX in the deterministic check; the four sinks have authored costs/effects (`game/cocs-difficulty.mjs:140-159`).
- Arrival protection is implemented with a telegraph ring (`game/cocs-traversal.mjs:173-191`, `game/view.mjs:1634-1647`).
- Determinism and budget contracts are intact: orders/spends sort by `(tick, peerId, cardId)`, one RNG draw point, tick clocks (`game/cocs.mjs:622-632`, `game/cocs-coop.mjs:557-576`).
- The Director loop (wave pacing, telegraphs, module content-only difficulty) is the strongest feedback surface in the mode and the model for the new announcer priorities.

---

## 11. Acceptance checks for the fixes

1. **Command path:** a seeded local Operations match with the exact page-shaped records (`peerId` from the page, not a test-only value) applies `HOLD`, `ATTACK` and `SCAN`; `orderStats.issued` increments; `state.tasks[0]` is non-null within one tick.
2. **Spend path:** with an owned node and an open window, each of FORTIFY/REPAIR/RESUPPLY/REINFORCE applies through the page's `spendCocs` shape and debits team FLUX; the spend log records `ok:true`.
3. **Wire path:** a two-client room using live-shaped peer ids (not 1/2) applies an order and a spend, and the board's cards transition `running → done/blocked` when the sim resolves them.
4. **Board:** with the pointer locked, `B`, arrows, Enter and a pin/retry key alone can navigate, activate and pin; a local match shows the player's issued orders as cards.
5. **Pointer lock:** `releaseCursor` frees the cursor without changing mode; the match keeps stepping in local and online play; re-lock is a single click; the HUD shows the instruction before the first release.
6. **Ziplines:** `useDevice` on a COCS zipline produces a multi-frame traverse whose duration matches authored speed within tolerance; the actor's position follows the cable; a remote client renders the rider (snapshot exposes rider state).
7. **Teleporters:** use produces portal FX at both ends, a panned SFX, and a camera beat; reduced motion snaps without motion.
8. **Impact:** for every row of §3 the gap column is closed by an observable cue, and reduced-motion variants exist for each.
9. **Tutorial:** `TRAINING_STEPS` success predicates pass against a seeded match; a first-time flow can reach step 6; telemetry records completion/skip.

---

*End of audit.*
