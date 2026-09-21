# Player squad panel and command contract

## UI integration

Import `SquadPanel` from `app/ui/screens/SquadPanel.tsx`. Its CSS module is
imported by the component; no global stylesheet import is needed.

```tsx
<SquadPanel
  snapshot={hud.cocs}
  player={player}
  spectate={hud.spectate === true}
  onCommand={sendCocsCommand}
  disabled={false}
  notice={cocsNotice?.text ?? null}
/>
```

`player` must be the **controlled actor** (`hud.actors` entry for the local
actor id), not the network peer or the current spectate target. `snapshot` is
the complete `hud.cocs` subtree. `disabled` should include round-over and online
disconnection if the containing UI remains mounted in those states. `notice`
is an optional plain-text transport refusal; simulation outcomes appear through
`snapshot.commandResults`. The page mounts it in a scrollable squad-management
dialog, opened from the HUD or the remappable squad key (default **L**).
The component supplies its own accessible region, form labels and scoped CSS;
it does not position itself or acquire pointer lock. Other game modes and
spectators render nothing.

The existing `app/page.tsx` callback already has the correct dispatch:

```ts
sendCocsCommand(action: string, value: string | number | null = null)
// online: r.net.command(action, value, {cardId})
// local: r.cocsCommands.push(cocsCommandRecord(action, {
//   tick, peerId: String(controlledActor.id), team: controlledActor.team,
//   value, cardId, seq,
// }))
// drained through Match.step(dt, {cocs: {commands}})
```

`app/page.tsx` passes this dispatcher directly to the panel. A returned command
record is only queued:
do not mutate membership or seat ownership on click. UI form input is the only
locally edited squad state.

**Existing commander UI must honor the tightened gates:** only show/enable
stance changes, clearing stance, ROUTE issue and clearing route when
`command.commander.mine === true`. TAKE COMMAND is available only when
`commander.seat == null`; an occupied seat requires a mutiny vote. Spectators
cannot act. The new panel already implements these conditions. The server and
sim enforce them regardless of UI state.

The dialog registers `CURSOR_SURFACE.SQUADS`, releases pointer lock, clears held
combat input and suspends touch capture. Its keyboard handler owns Tab/Escape;
closing returns through the shared cursor lifecycle. All squad entry points
reject spectator sessions. The command strip also reflects the tightened
commander-only stance and route gates.

## Command action contract

All actions use the existing scalar `{action, value, cardId, roundRev?,
actionSeq?}` network command envelope. Online sender identity and team are
derived from the authenticated peer's actor, never from message fields. Local
commands use the real actor id as `peerId`; literal `human` / arbitrary peer
labels are no longer accepted by the sim command handlers.

| Action | Value | Authority / effect |
| --- | --- | --- |
| `squad-create` | Nonblank name, max 24 normalized characters | Unassigned human creates an allied squad and becomes leader. |
| `squad-join` | Snapshot squad id | Unassigned human joins own-team squad with fewer than four members. |
| `squad-leave` | `null` | Removes only the issuing actor. Leader passes to the next member; empty squad disappears. |
| `squad-promote` | Member actor id (string or integer) | That squad's leader or own-team commander transfers leadership. |
| `squad-remove` | Member actor id (string or integer) | That squad's leader or own-team commander removes a member. Use leave for self-removal. |
| `take` | `null` | Living human claims an empty command seat; cannot overwrite another commander. |
| `release` | `null` | Current commander only. |
| `policy` | `ASSAULT`, `HOLD`, `FORTIFY`, or `null` | Current commander only; existing stance normalization remains. |
| `set-route` | Existing node id or `null` | Current commander only; existing team-wide bot route behavior remains. |
| `mutiny-vote` | `null` | Living human other than the current commander votes on an occupied seat. Strict majority of living team humans required. |

Membership is player-only, independent of AI reinforcement THREADS. There is
no implicit auto-join, team switch, per-squad AI order, or bot recruitment.
Assigned orders shown by the panel are the actual existing **team** task,
standing route and stance. Both PvP COCS and Operations support squads;
Operations supports allied team 0 only. Downed members keep their seat and
leadership but cannot issue commands until respawn, matching the online action
gate. A transport reconnect within the grace period keeps membership. Leaving
the room / bot replacement frees membership and commander ownership.

New refusals: `unauthenticated`, `seat-occupied`, `no-mutiny`, `squad-name`,
`already-in-squad`, `unknown-squad`, `squad-full`, `not-in-squad`, `not-leader`,
`use-leave`. Existing `wrong-team`, `wrong-actor`, `dead`, `not-commander`,
`stance`, `unknown-node`, and transport refusals still apply.

## Snapshot and completion contract

`cocs.squadBoard` is a team-keyed map. Each team entry contains:

```ts
{
  capacity: 4,
  squads: [{id, team, name, leader: string, members: string[]}],
  operators: [{id: string, name, health}],
  order: {verb, nodeId} | null,
  route: string | null,
  policy: string | null
}
```

`cocs.commandResults` retains the latest 32 applied command outcomes as
`{tick, team, peerId, cardId, action, ok, reason}`. Both new fields are
team-private over the wire; spectators receive an empty map/list. Snapshots
copy squad membership arrays. Core command processing revalidates identity,
seat ownership, membership and capacity at apply time, then records the result.
The room settles command cards from those exact results, including refusals
caused by racing commands. Queue acceptance is not completion. Existing
round-scoped action deduplication and scalar payload parsing are reused.

## Checks for the parent to run serially

No tests, typecheck, build, browser or benchmarks were executed by this subtask.
Focused additions:

- `game/cocs-squads.test.mjs`: identity, both-mode commander authority, occupied
  seats, living-human mutiny threshold, capacity, leadership transfer, enemy
  boundaries, snapshot isolation/privacy, scalar wire parsing.
- `server/cocs-squads-net.test.mjs`: local `Match.step`, both-mode wire
  lifecycle, idempotent retries, reconnect, sender identity spoofing,
  spectators, same-tick seat races and loss of authority between enqueue/apply.

Adjusted existing fixtures in `game/cocs-pvp.test.mjs` to use real actor ids
and take command before setting policies; `server/cocs-net.test.mjs` now takes
command before policy/route validation; `game/cocs.test.mjs` recognizes the
additive snapshot fields. Also run the existing COCS visibility, identity and
net-budget checks, followed by the parent's normal typecheck/build sequence.
