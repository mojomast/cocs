# COMMAND pass — LATTICE commander route and stance

The PvP-1 command surface (§5.7/§11.2/§11.3) was fully simulated and fully
wired on the server — `cocsCommandAction`/`coopCommandAction`, the
`pendingCocs.commands` queue, `net.command`, the room's `command(peerId, msg)`
handler and the `commander`/`command` snapshot block all existed and were
tested — but no client ever sent a command, no UI surfaced one, and the
recorded `route`/`policy` values had no effect on the match. This pass closes
that loop.

## Effects

`cocsCommandState(state, team)` (in `game/cocs.mjs`) is the one accessor: PvP
reads `state.command`, OPERATIONS reads `state.coop`. Both return
`{seat, route, policy}`.

`game/cocs-bots.mjs` `cocsTeamPlan` now consumes it:

- **ASSAULT** — the attack cap becomes the whole living roster and only a
  `ceil(roster · 0.34)` token stays on the most-threatened owned node.
- **FORTIFY** — the attack cap drops to `ceil(roster · 0.34)`, the defence may
  be manned by the full roster, and `cocsTraversalChoice` pulls wounded bots
  toward a device at 62 % health instead of 45 %.
- **HOLD** (or no commander) — the shipped spread plan, unchanged.
- **ROUTE** — an owned route is manned (a 34 % garrison normally, the full
  roster under FORTIFY); a capturable route leads the attack duties, ahead of
  the duty Chief's automatic picks. HQ/ARRAY targets and unknown nodes are
  ignored, and clearing the route restores the automatic plan.

Nothing draws the RNG: the plan only reweights lists that are already id-sorted,
so a fixed seed replays byte-identically. Defaults are `null`, so every
uncommanded match keeps its previous plan exactly — the new tests assert that
directly.

## Validation and announcements

- `policy` accepts exactly `ASSAULT | HOLD | FORTIFY` (case-insensitive) and
  refuses anything else with `stance`; `null`/`''` clears back to the plan.
- `set-route` must name a real lattice node, otherwise it refuses with
  `unknown-node`. Clearing was previously possible with garbage; now the state
  can only hold a real destination.
- Every successful action emits one `cocs-command` sim event carrying
  `{team, action, peerId, tick, value}` plus the action's result field
  (`seat`, `policy`, `route`, `votes`/`needed`). The event is `cocs-`-prefixed
  with a team tag, so the room's existing team-private visibility rule keeps
  enemy command intent off the wire for free.

## Client wiring

- `game/cocs-orders.mjs` adds the `ROUTE` strip button (`cocsIssueRoute`,
  `cocsCommandRecord`) and a normalized commander projection on
  `cocsCommandView` (`commander: {seat, route, policy, votes, mine, spectate}`,
  `policies: [...|active]`). OPERATIONS and PvP both read their own snapshot
  shape through it.
- `game/keybinds.mjs` adds `commandRoute` (default **O**, labelled
  "Order: route"); `latticeOrderKey` routes it like the other three verbs.
- `app/page.tsx` queues commands in `r.cocsCommands` for local play and calls
  `net.command(action, value, {cardId})` online, drained through the same fixed
  `Match.step(..., {cocs: {…, commands}})` point as orders. The strip's ROUTE
  issue and the commander row dispatch through one `sendCocsCommand`.
- `PlayingHud` renders the commander row inside the readout: TAKE COMMAND /
  STEP DOWN / VOTE MUTINY, the three stance buttons (clicking the active stance
  clears it) and the active route chip. The row opts back into pointer events
  because the HUD layer is click-through by default; the strip verbs stay
  keyboard-first.

## Feedback

`cocs-command` gets its own banner family (ranks 41-43, distinct from every
existing rank), subtitle lines and stance-coloured earcons — ASSAULT rises,
HOLD stays flat, FORTIFY falls, a mutiny vote ticks unresolved. All are
team-private.

## Result bookkeeping

`finalizeCocsResult` is called from `Match.endMatch`. A mode-layer ending that
never reached `cocsOutcome` (a sudden-death window broken by the score, a
forfeit) used to leave `cocs.winner` null behind a decided scoreboard; now the
objective reconciles from scores, then owned-node count, labels the tiebreak
and emits `objective-tiebreak`. A genuinely tied scoreboard still stays a draw,
and a decided winner is never overwritten.

## Verification

Focused suites: `game/cocs-bots.test.mjs` (stance caps and route precedence),
`game/cocs-pvp.test.mjs` (stance/route validation, announcements, seat
round-trip), `game/cocs.test.mjs` (sudden-death reconciliation and the draw
guard), `game/cocs-coop.test.mjs`, `game/lattice-ui.test.mjs` (ROUTE picker,
issue, four buttons), `game/hud.test.mjs` (banners, ranks, announcer cues),
`game/lattice-feedback.test.mjs` (team-private cues and captions),
`game/keybinds.test.mjs` and `game/lattice-guide.test.mjs` (the new binding and
coach line), plus the tracked browser matrix. A live browser probe on the
software-GPU test box launched the OPERATIONS briefing, took command (seat
`0`), set FORTIFY (policy `FORTIFY`) and issued a route (route `front-0`) with
zero page errors; commands are dispatched after the free-cursor key releases
pointer lock, exactly like the command board.
