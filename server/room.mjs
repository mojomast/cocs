import {Match} from '../game/core.mjs';
import {normalizeConfig,teamMode,isCocsMode,cocsRung,cocsRungPlan,cocsRungBelow} from '../game/config.mjs';
import {movementModeRule} from '../game/movement.mjs';
import {isSinglePlayerMode} from '../game/singleplayer.mjs';
import {actorWon} from '../game/outcome.mjs';
import {getMap} from '../game/maps.mjs';
import {resolveMapForMode} from '../game/arenas.mjs';
import {CHARACTERS,resolveLoadout,RULES} from '../game/data.mjs';
import {COCS_ORDER_LOG_LIMIT,capturableBy,nodeById,cocsRoleAllowedOnRung,cocsThreadsUsed,normalizeCocsPolicy} from '../game/cocs.mjs';
import {COOP_BIG_SINKS,coopCommandState,coopOrderGate,coopSpendGate,intermissionOpen} from '../game/cocs-coop.mjs';
import {coopSink} from '../game/cocs-difficulty.mjs';
import {terminalActionGate} from '../game/cocs-terminals.mjs';
import {coopRole} from '../game/cocs-roles.mjs';
import {SUBAGENTS,reqItem,reqItemModes,reqItemSupported,reqPurchase} from '../game/cocs-economy.mjs';
import {depotPurchaseState} from '../game/cocs-traversal.mjs';
import {randomUUID} from 'node:crypto';
import {validPlayerId,sanitizeText,parseInputEnvelope,PROTOCOL_VERSION,SNAPSHOT_DELTA_VERSION,SNAPSHOT_DELTA_MIN_BYTES,snapshotDelta,wireSize,MESSAGE,COCS_REJECT_LIMIT,parseOrderMessage,parseEconomyMessage,parseTerminalMessage,parseCommandMessage,parseBuyMessage} from '../game/protocol.mjs';
import {cocsCommandAuthority, reconcileCocsSquads} from '../game/cocs-squads.mjs';
// V2 per-team snapshot filtering (§11.4/§12.7). Applied per peer at this wire
// seam only; local/solo play reads `Match.snapshot()` directly and stays
// byte-identical.
import {filterCocsSnapshot,cocsEventVisible} from '../game/cocs-intel.mjs';

export const PLAYER_LIMIT = 8;
// LATTICE STRIKE (§11.5, owner decision 24): the COCS family admits up to 32
// human seats for the 12v12 rung and spectator/reconnect headroom. Everything
// else keeps the historical `PLAYER_LIMIT` so the 9th-player regression is
// unchanged. `playerLimit(mode)` is the single gate both `join` and `start` use.
export const COCS_PLAYER_LIMIT = 32;
// Rate-only snapshot budget (§11.5, owner decision 20): above 32 actors the
// mode drops to 20 Hz; no actor payload is slimmed, keyframes do not shrink.
export const COCS_OVERLOAD_ACTORS = 32;
export const COCS_OVERLOAD_SNAPSHOT_HZ = 20;
// Round-long dedupe ledger bound. Deliberately far larger than the presentation
// card map (`COCS_REJECT_LIMIT`, 300): an accepted key must stay idempotent even
// after hundreds of later cards evict its presentation row. Cleared only by a
// new round revision, never by card eviction.
export const COCS_DEDUPE_LIMIT = 8192;
// Per-peer token-bucket ceilings (§11.2). Mirrors the `setLoadout` anti-flood
// style: a fixed one-second window with a bounded count per kind.
export const COCS_RATE_LIMITS = Object.freeze({order: 10, economy: 8, terminal: 6, command: 4, buy: 4});
export const playerLimit = mode => (isCocsMode(mode) ? COCS_PLAYER_LIMIT : PLAYER_LIMIT);
export const SPECTATOR_LIMIT = 24;
// Clients send inputs at 60 Hz; allow generous headroom and drop the excess so a
// flooding client cannot burn simulation time or unbounded server work.
export const INPUT_RATE_LIMIT = 120;
// Warmup countdown and the minimum fraction of connected players that must
// ready-up before a warmup-gated start is allowed. Defaults keep the direct
// host-start path (used everywhere else) unaffected.
export const WARMUP_SECONDS = 5;
export const REMATCH_RATIO = 0.5;
// Team-mode respawn switching (§3.7): one switch per player per 60 s, with a
// 500 ms anti-flood floor that rejects duplicate bursts even before the lockout.
export const LOADOUT_LOCKOUT_MS = 60000;
export const LOADOUT_FLOOD_MS = 500;
export const LIFECYCLE_PHASES = Object.freeze(['lobby', 'warmup', 'live', 'results']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max) => typeof value === 'string' && value.length <= max;
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
// Economy `action` → intermission sink verb. `spawn` is the wire alias for a
// REINFORCE squad (`role` selects the subagent role). Actions without a shipped
// sink are rejected as `unknown-action`.
const COCS_SINK_FOR = Object.freeze({spawn: 'REINFORCE', reinforce: 'REINFORCE', fortify: 'FORTIFY', repair: 'REPAIR', resupply: 'RESUPPLY'});
// §8.1 SCOUT spawn cost is the price a `SCAN` order gates on.
const COCS_SCAN_COST = num(SUBAGENTS?.scout?.spawnCost, 7);
// Match.snapshot() shares mutable or deeply frozen nested branches (powerups,
// objectiveNodes, ...), so quantizing it in place would corrupt authoritative
// state or throw on frozen map data. The shared non-mutating clone quantizer
// keeps client-visible rounding identical to the client codec.
import {quantizeClone as quantizedCopy} from '../game/quantize.mjs';

export class Room {
 constructor(id = 'local', random = Math.random, options = {}) {
  this.id = id;
  this.name = String(options.name ?? id);
  this.random = random;
  this.graceMs = Math.max(1000, options.graceMs ?? 20000);
  this.history = options.history ?? null;
  this.progression = options.progression ?? null;
  this.peers = new Map();
  this.nextPeerId = 1;
  this.hostId = null;
  this.config = null;
  this.mapId = 'exchange';
  this.match = null;
  this.started = false;
  this.roundOver = true;
  this.tickAcc = 0;
  this.broadcastAt = 0;
  this.snapshotHz = Math.max(1, Math.min(120, Number(options.snapshotHz) || 30));
  this.snapshotInterval = 1 / this.snapshotHz;
  this.seq = 0;
  // A delta chain needs a periodic full keyframe so a client that missed a
  // frame (the transport drops replaceable snapshots under backpressure) can
  // re-sync without waiting for the next match. Default: one keyframe a second.
  this.keyframeEvery = Math.max(0, Math.floor(Number(options.keyframeEvery) || this.snapshotHz));
  // The raw last broadcast (`lastSnapshot`) is kept for compatibility and
  // diagnostics; the delta chains are per filtered view (`lastViewSnapshots`),
  // because each team's wire content differs (§11.4).
  this.lastSnapshot = null;
  this.lastViewSnapshots = new Map();
  this.deltaFrames = 0;
  this.fullFrames = 0;
  this.out = [];
  // Deterministic lifecycle. `phase` is one of LIFECYCLE_PHASES; warmup runs a
  // fixed countdown before the host start is honored, and map votes are tallied
  // from connected players. `rematchVotes` gates the post-round rematch.
  this.phase = 'lobby';
  this.warmupSeconds = Math.max(0, Number(options.warmupSeconds ?? WARMUP_SECONDS));
  this.warmupTimer = 0;
  this.ready = new Set();
  this.mapVotes = new Map();
  this.rematchVotes = new Set();
  // Team-mode respawn switches queued by peers, keyed by peer id (§3.7). The
  // match owns the authoritative pending record; this map mirrors it so the
  // room can clear the queue on every lifecycle boundary and the tests can
  // observe it directly.
  this.pendingLoadouts = new Map();
  this.lifecycleRevision = 0;
  this.lastResult = null;
  // LATTICE STRIKE wire queue (§11.2). Validated records wait here until the
  // next fixed step drains them into `Match.step({cocs})`; there is deliberately
  // no Room-side simulation queue. `cocsCards` mirrors the card board so a
  // rejection can write the reason into the card's `blocker` state and a
  // reconnect full snapshot carries it.
  this.pendingCocs = {orders: [], spends: [], terminals: [], commands: [], buys: []};
  this.cocsCards = new Map();
  this.cocsSeq = 0;
  // Round identity (WP0.3). Every real `start()` — including a rematch — mints a
  // new revision; a reconnect keeps the current one. `cocsLedger` holds the
  // round-long idempotency records, keyed by (authenticated seat, round, seq)
  // and independent of the bounded presentation cards above.
  this.roundRevision = 0;
  this.cocsLedger = new Map();
  // Keys of accepted, not-yet-settled ledger records. The per-step settle walks
  // only this set, so a long round with thousands of completed records stays
  // cheap while the ledger itself remains round-long.
  this.cocsInFlight = new Set();
 }
 send(peerId, msg) { this.out.push({ to: peerId, msg }); }
 broadcast(msg) { this.out.push({ to: null, msg }); }
 drain() { const msgs = this.out; this.out = []; return msgs; }
 // -------------------------------------------------------------------
 // LATTICE STRIKE message handlers (§11.2). Validation runs against the
 // authoritative match: the peer's live actor owns the team, the node cost is
 // the sim's float `flux`, and never a quantized client value. Accepted records
 // wait for the next fixed step; a rejection emits `cocs-reject` and writes the
 // reason into the card's blocker state.
 // -------------------------------------------------------------------
 cocsTick() { return num(this.match?.objectiveState?.tick, 0); }
 cocsActor(peer) { return peer?.actorId !== null && peer?.actorId !== undefined ? this.match?.actors?.[peer.actorId] ?? null : null; }
 cocsRate(peer, kind, now = Date.now()) {
  const limit = COCS_RATE_LIMITS[kind];
  if (!limit) return false;
  if (!peer.cocsRate) peer.cocsRate = {};
  const bucket = peer.cocsRate[kind];
  if (!bucket || now - bucket.at >= 1000) peer.cocsRate[kind] = { at: now, count: 1 };
  else if (bucket.count >= limit) return false;
  else bucket.count++;
  return true;
 }
 recordCocsCard(cardId, patch = {}) {
  const id = String(cardId);
  const existing = this.cocsCards.get(id) ?? { id, createdTick: this.cocsTick() };
  this.cocsCards.set(id, { ...existing, ...patch, updatedTick: this.cocsTick() });
  while (this.cocsCards.size > COCS_REJECT_LIMIT) this.cocsCards.delete(this.cocsCards.keys().next().value);
  return this.cocsCards.get(id);
 }
 cocsCardList() {
  return [...this.cocsCards.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
 }
 // Round/action identity helpers (WP0.3). The ledger is separate from the card
 // map, is keyed by the authenticated seat + round + sequence, and is looked up
 // before rate limiting, gating or enqueueing, so a retry can never apply twice.
 cocsSeatKey(peer) { return peer?.token ? `t:${peer.token}` : `p:${peer?.id ?? ''}`; }
 cocsActionKey(peer, parsed) {
  const seat = this.cocsSeatKey(peer);
  const round = Number.isInteger(parsed.roundRev) ? parsed.roundRev : this.roundRevision;
  if (Number.isInteger(parsed.actionSeq)) return `${seat}|r${round}|s${parsed.actionSeq}`;
  // Transitional v3 adapter: a frame with only the historical `cardId` is
  // scoped by round + seat so cross-actor identical ids cannot collide and a
  // same-round retry is still idempotent.
  const cardId = parsed.cardId === null || parsed.cardId === undefined ? null : String(parsed.cardId);
  return cardId === null ? null : `${seat}|r${round}|c:${cardId}`;
 }
 cocsPayloadKey(kind, parsed) {
  switch (kind) {
   case 'order': return `o|${parsed.verb}|${parsed.target}|${parsed.agent ?? ''}`;
   case 'economy': return `e|${parsed.action}|${parsed.role ?? ''}|${parsed.target ?? ''}|${parsed.actorId ?? ''}`;
   case 'terminal': return `t|${parsed.terminalId}|${parsed.action}|${parsed.actorId ?? ''}`;
   case 'command': return `c|${parsed.action}|${parsed.value ?? ''}`;
   case 'buy': return `b|${parsed.itemId}|${parsed.depotId ?? ''}|${parsed.targetCardId ?? ''}|${parsed.actorId ?? ''}`;
   default: return String(kind);
  }
 }
 cocsPayload(kind, parsed) {
  switch (kind) {
   case 'order': return {verb: parsed.verb, target: parsed.target, agent: parsed.agent ?? null};
   case 'economy': return {action: parsed.action, role: parsed.role ?? null, target: parsed.target ?? null, actorId: parsed.actorId ?? null};
   case 'terminal': return {terminalId: parsed.terminalId, action: parsed.action, actorId: parsed.actorId ?? null};
   case 'command': return {action: parsed.action, value: parsed.value ?? null};
   case 'buy': return {itemId: parsed.itemId, depotId: parsed.depotId ?? null, targetCardId: parsed.targetCardId ?? null, actorId: parsed.actorId ?? null};
   default: return {};
  }
 }
 cocsRejectExtra(parsed) {
  const extra = {roundRevision: this.roundRevision};
  if (parsed && parsed.actionSeq !== undefined) extra.actionSeq = parsed.actionSeq;
  if (parsed && parsed.roundRev !== undefined) extra.roundRev = parsed.roundRev;
  return extra;
 }
 // A frame without a client cardId still needs a deterministic presentation id
 // (the client that omitted it has nothing to reconcile against anyway).
 cocsFallbackCardId(parsed, peer) {
  if (Number.isInteger(parsed.actionSeq)) return `r${Number.isInteger(parsed.roundRev) ? parsed.roundRev : this.roundRevision}-p${peer?.id ?? 0}-s${parsed.actionSeq}`;
  return `cocs-${++this.cocsSeq}`;
 }
 // The authoritative peer/match/actor gate. Every failure is a refusal with a
 // reason, never a silent `false`: a request the authority received always gets
 // exactly one correlated answer.
 cocsRoomGate(peer) {
  if (peer.disconnectedAt !== null) return 'disconnected';
  if (peer.spectate) return 'spectator';
  if (!this.match) return 'no-match';
  if (this.roundOver) return 'round-over';
  const actor = this.cocsActor(peer);
  if (!actor) return 'no-actor';
  if (actor.health <= 0) return 'dead';
  return null;
 }
 // Parse → round check → idempotency lookup → rate limit → room gate. Returns a
 // refusal (`refuse`), a cached exact retry (`duplicate`) or an opened action to
 // validate against the sim. The payload is bound to the key: same key with a
 // different canonical payload is `id-reuse`, never a second effect.
 cocsBegin(kind, peerId, msg, now, parse) {
  const peer = this.peers.get(peerId);
  if (!peer) return {refuse: this.rejectCocs(peerId, msg?.cardId ?? null, 'unknown-peer', {roundRevision: this.roundRevision})};
  const parsed = parse(msg);
  if (!parsed) return {refuse: this.rejectCocs(peerId, msg?.cardId ?? null, 'malformed', {roundRevision: this.roundRevision})};
  const extra = this.cocsRejectExtra(parsed);
  if (parsed.roundRev !== undefined && parsed.roundRev !== this.roundRevision) {
   return {refuse: this.rejectCocs(peerId, parsed.cardId, 'stale-round', extra)};
  }
  const key = this.cocsActionKey(peer, parsed);
  const payloadKey = this.cocsPayloadKey(kind, parsed);
  if (key) {
   const cached = this.cocsLedger.get(key);
   if (cached) {
    if (cached.payloadKey !== payloadKey) return {refuse: this.cocsRejectReply(peerId, parsed.cardId, 'id-reuse', extra)};
    if (cached.outcome === 'rejected' || cached.outcome === 'blocked' || cached.outcome === 'expired') return {refuse: this.cocsRejectReply(peerId, parsed.cardId, cached.reason ?? cached.outcome, extra)};
    return {duplicate: true, parsed, peer};
   }
  }
  if (!this.cocsRate(peer, kind, now)) return {refuse: this.rejectCocs(peerId, parsed.cardId, 'rate-limit', extra)};
  const gate = this.cocsRoomGate(peer);
  if (gate) return {refuse: this.rejectCocs(peerId, parsed.cardId, gate, extra)};
  return {peerId, peer, parsed, key, payloadKey, payload: this.cocsPayload(kind, parsed), cardId: parsed.cardId ?? null};
 }
 recordCocsDecision(opened, outcome, reason = null, extra = {}) {
  if (!opened.key) return null;
  const record = {
   key: opened.key, kind: opened.kind, seat: this.cocsSeatKey(opened.peer),
   roundRevision: Number.isInteger(opened.parsed.roundRev) ? opened.parsed.roundRev : this.roundRevision,
   actionSeq: opened.parsed.actionSeq ?? null, cardId: opened.cardId,
   actorId: opened.actorId ?? null, team: opened.team ?? null,
   payloadKey: opened.payloadKey, payload: opened.payload,
   outcome, reason, createdTick: this.cocsTick(), acceptedTick: null, terminalTick: null,
   seenAccepted: false, seenChannel: false, ...extra,
  };
  this.cocsLedger.set(opened.key, record);
  if (outcome === 'accepted') this.cocsInFlight.add(opened.key);
  while (this.cocsLedger.size > COCS_DEDUPE_LIMIT) {
   const oldest = this.cocsLedger.keys().next().value;
   this.cocsLedger.delete(oldest);
   this.cocsInFlight.delete(oldest);
  }
  return record;
 }
 cocsRejectAction(opened, reason, extra = {}) {
  this.recordCocsDecision(opened, 'rejected', reason);
  return this.rejectCocs(opened.peerId, opened.cardId, reason, {...this.cocsRejectExtra(opened.parsed), ...extra});
 }
 // Read-only baseline for terminal/device completion proofs. Captured when the
 // authority accepts the request, compared afterwards against the sim state that
 // only changes when the effect actually applies.
 cocsTerminalBaseline(state, id) {
  const terminal = state?.terminals?.terminals?.[id] ?? null;
  if (terminal) return {terminal: true, state: terminal.state, hacks: num(terminal.hacks, 0), deploys: num(terminal.deploys, 0), repairs: num(terminal.repairs, 0), sabotages: num(terminal.sabotages, 0), uses: num(terminal.uses, 0), stores: num(state.terminals?.vault?.stores, 0), pulls: num(state.terminals?.vault?.pulls, 0)};
  const device = state?.traversal?.devices?.[id] ?? null;
  if (device) return {device: true, state: device.state, cuts: num(device.cuts, 0), locks: num(device.locks, 0), repairs: num(device.repairs, 0)};
  return null;
 }
 // Settle accepted cards from the sim's own evidence. An accepted HOLD/ATTACK
 // stays `running` with `accepted:true` until its task completes, expires or is
 // replaced; one-shot spends/vaults/buys/commands settle when the sim state that
 // proves the effect exists appears. Refusals always write a reason. Runs after
 // every step (and once at round end) so a card cannot stick forever.
 settleCocsCards(state, {ended = false} = {}) {
  if (!this.cocsInFlight.size || !state || state.kind !== 'cocs') return;
  for (const key of [...this.cocsInFlight]) {
   const record = this.cocsLedger.get(key);
   if (!record || record.outcome !== 'accepted') { this.cocsInFlight.delete(key); continue; }
   const settled = ended ? {state: 'expired', ok: false, reason: 'round-end'} : this.cocsOutcome(record, state);
   if (!settled) continue;
   record.outcome = settled.state === 'done' ? 'done' : settled.state === 'blocked' ? 'blocked' : 'expired';
   record.reason = settled.reason ?? null;
   record.terminalTick = this.cocsTick();
   this.cocsInFlight.delete(key);
   const card = this.cocsCards.get(record.cardId);
   if (!card) continue;
   if (card.actorId !== undefined && card.actorId !== null && record.actorId !== null && String(card.actorId) !== String(record.actorId)) continue;
   this.recordCocsCard(record.cardId, {
    state: settled.state, ok: settled.ok,
    blocker: settled.ok ? null : (settled.reason ?? 'blocked'),
    reason: settled.reason ?? null, accepted: true, acceptedTick: record.acceptedTick,
   });
  }
 }
 cocsOutcome(record, state) {
  switch (record.kind) {
   case 'order': return this.cocsOrderOutcome(record, state);
   case 'economy': return this.cocsEconomyOutcome(record, state);
   case 'terminal': return this.cocsTerminalOutcome(record, state);
   case 'command': return this.cocsCommandOutcome(record, state);
   case 'buy': return this.cocsBuyOutcome(record, state);
   default: return null;
  }
 }
 cocsOrderOutcome(record, state) {
  const actorKey = record.actorId === null || record.actorId === undefined ? null : String(record.actorId);
  const log = state.orderLog ?? [];
  let entry = null;
  for (let i = log.length - 1; i >= 0; i--) {
   const candidate = log[i];
   if (!candidate || String(candidate.cardId) !== record.cardId) continue;
   if (actorKey !== null && String(candidate.peerId ?? '') !== actorKey) continue;
   entry = candidate;
   break;
  }
  if (entry) {
   if (entry.ok !== true) return {state: 'blocked', ok: false, reason: entry.reason ?? 'blocked'};
   record.seenAccepted = true;
   if (record.acceptedTick === null) record.acceptedTick = Number.isFinite(entry.tick) ? entry.tick : this.cocsTick();
  } else if (!record.seenAccepted) {
   return null;
  }
  const verb = String(record.verb ?? '').toUpperCase();
  if (verb === 'SCAN') return {state: 'done', ok: true, reason: null};
  const task = state.tasks?.[record.team] ?? null;
  if (task && String(task.cardId) === record.cardId && (actorKey === null || String(task.peerId ?? '') === actorKey)) {
   return num(state.tick, 0) > num(task.until, 0) ? {state: 'expired', ok: false, reason: 'ttl'} : null;
  }
  // A live task with a different card is a replacement; no task at all means
  // the capture completed and the sim retired the task (see `captureNode`).
  if (task) return {state: 'done', ok: true, reason: 'replaced'};
  return {state: 'done', ok: true, reason: 'complete'};
 }
 cocsEconomyOutcome(record, state) {
  if (record.action === 'opt-out-orders') {
   const actor = this.match?.actors?.[record.actorId] ?? null;
   return actor?.ordersOptOut === true ? {state: 'done', ok: true, reason: null} : null;
  }
  const logs = [...(state.spendLog ?? []), ...(state.coop?.spendLog ?? [])];
  let entry = null;
  for (let i = logs.length - 1; i >= 0; i--) {
   const candidate = logs[i];
   if (!candidate || String(candidate.cardId) !== record.cardId) continue;
   if (String(candidate.peerId ?? '') !== String(record.actorId ?? '')) continue;
   if (num(candidate.tick, 0) < num(record.createdTick, 0)) continue;
   entry = candidate;
   break;
  }
  if (!entry) return null;
  return entry.ok === true ? {state: 'done', ok: true, reason: null} : {state: 'blocked', ok: false, reason: entry.reason ?? 'blocked'};
 }
 cocsTerminalOutcome(record, state) {
  const baseline = record.baseline ?? {};
  const terminal = state.terminals?.terminals?.[record.terminalId] ?? null;
  if (terminal) {
   const channel = terminal.channel;
   if (channel && String(channel.actor) === String(record.actorId)) record.seenChannel = true;
   const done = () => ({state: 'done', ok: true, reason: null});
   const action = record.action;
   if (action === 'vault-store' && num(state.terminals?.vault?.stores, 0) > num(baseline.stores, 0)) return done();
   if (action === 'vault-pull' && num(state.terminals?.vault?.pulls, 0) > num(baseline.pulls, 0)) return done();
   if (action === 'hack' && num(terminal.hacks, 0) > num(baseline.hacks, 0)) return done();
    if (action === 'deploy' && num(terminal.deploys, 0) > num(baseline.deploys, 0)) return done();
    if (action === 'deploy' && state.terminals?.vault?.cargo?.[record.actorId]?.source === record.terminalId) return done();
   if (action === 'cut' && num(terminal.sabotages, 0) > num(baseline.sabotages, 0)) return done();
   if (action === 'repair' && (num(terminal.repairs, 0) > num(baseline.repairs, 0) || (baseline.state !== 'live' && terminal.state === 'live'))) return done();
   if (record.seenChannel && !channel) return {state: 'blocked', ok: false, reason: 'interrupted'};
   return null;
  }
  const device = state.traversal?.devices?.[record.terminalId] ?? null;
  if (device) {
   if (device.channel && String(device.channel.actor) === String(record.actorId)) record.seenChannel = true;
   const done = () => ({state: 'done', ok: true, reason: null});
   const action = record.action;
   if (action === 'repair' && (num(device.repairs, 0) > num(baseline.repairs, 0) || (baseline.state !== 'live' && device.state === 'live'))) return done();
   if (action === 'cut' && (num(device.cuts, 0) > num(baseline.cuts, 0) || (baseline.state === 'live' && device.state !== 'live'))) return done();
   if (action === 'lock' && (num(device.locks, 0) > num(baseline.locks, 0) || (baseline.state === 'live' && device.state === 'locked'))) return done();
   if (action === 'depot-capture' && device.state !== baseline.state) return done();
   if (record.seenChannel && !device.channel) return {state: 'blocked', ok: false, reason: 'interrupted'};
   return null;
  }
  return {state: 'blocked', ok: false, reason: 'missing'};
 }
 cocsCommandOutcome(record, state) {
  const result = (state.commandResults ?? []).findLast(entry => String(entry.cardId) === String(record.cardId) && entry.peerId === String(record.actorId) && entry.tick >= record.createdTick);
  if (result) return {state: result.ok ? 'done' : 'blocked', ok: result.ok, reason: result.reason};
  const team = record.team === 1 ? 1 : 0;
  const actorId = String(record.actorId ?? '');
  const coop = state.coop;
  const seat = coop ? coop.commandSeat?.[team] ?? null : state.command?.seat?.[team] ?? null;
  const route = coop ? coop.commandRoute?.[team] ?? null : state.command?.route?.[team] ?? null;
  const policy = coop ? coop.commandPolicy?.[team] ?? null : state.command?.policy?.[team] ?? null;
  const votes = coop ? coop.commandVotes?.[team] ?? {} : state.command?.votes?.[team] ?? {};
  const done = {state: 'done', ok: true, reason: null};
  switch (String(record.action ?? '').toLowerCase()) {
   case 'take': return String(seat ?? '') === actorId ? done : null;
   case 'release': return String(seat ?? '') !== actorId ? done : null;
   case 'set-route': return String(route ?? '') === String(record.value ?? '') ? done : null;
   case 'policy': return String(policy ?? '') === String(record.value ?? '') ? done : null;
    case 'mutiny-vote': return String(seat ?? '') === actorId || votes?.[actorId] === true ? done : null;
   case 'opt-out-orders': {
    const actor = this.match?.actors?.[record.actorId] ?? null;
    return actor?.ordersOptOut === true ? done : null;
   }
   default: return null;
  }
 }
 cocsBuyOutcome(record, state) {
  const actor = this.match?.actors?.[record.actorId] ?? null;
  if (!actor) return {state: 'blocked', ok: false, reason: 'missing'};
  if (state.coop) {
   const log = state.coop.buyLog ?? [];
   for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (!entry) continue;
    if (String(entry.actor ?? '') !== String(record.actorId ?? '')) continue;
    if (String(entry.itemId ?? '') !== String(record.itemId ?? '')) continue;
    if (num(entry.tick, 0) < num(record.createdTick, 0)) continue;
    return {state: 'done', ok: true, reason: null};
   }
  }
  // Every successful purchase stamps the item on the actor and debits REQ; the
  // debit is what distinguishes a fresh effect from an already-active buff.
  if (String(actor.reqBuff ?? '') === String(record.itemId ?? '') && num(actor.reqSpent, 0) > num(record.baseline?.reqSpent, 0)) {
   return {state: 'done', ok: true, reason: null};
  }
  return null;
 }
 rejectCocs(peerId, cardId, reason, extra = {}) {
  const id = cardId === null || cardId === undefined ? `cocs-${++this.cocsSeq}` : String(cardId);
  this.recordCocsCard(id, { blocker: reason, reason, state: 'blocked', ok: false, ...extra });
  this.send(peerId, { type: MESSAGE.COCS_REJECT, cardId: id, reason, roundRevision: this.roundRevision, ...extra });
  return false;
 }
 // A ledger-level refusal (id-reuse or a cached refusal) answers the sender only.
 // It must never rewrite the presentation card, because that row may belong to
 // the accepted action the reused key is colliding with.
 cocsRejectReply(peerId, cardId, reason, extra = {}) {
  const id = cardId === null || cardId === undefined ? `cocs-${++this.cocsSeq}` : String(cardId);
  this.send(peerId, { type: MESSAGE.COCS_REJECT, cardId: id, reason, roundRevision: this.roundRevision, ...extra });
  return false;
 }
 // Mirror a rejected order into the authoritative orderLog so the board's
 // exception list never depends only on the transient feed (net P2-13).
 noteOrderReject(state, record, reason) {
  if (!state || state.kind !== 'cocs') return;
  const log = state.orderLog ?? (state.orderLog = []);
  log.push({ tick: num(record.tick, this.cocsTick()), peerId: String(record.peerId ?? ''), cardId: String(record.cardId ?? ''), team: record.team, verb: record.verb, target: record.target ?? null, ok: false, reason });
  if (log.length > COCS_ORDER_LOG_LIMIT) log.splice(0, log.length - COCS_ORDER_LOG_LIMIT);
 }
 order(peerId, msg, now = Date.now()) {
  const opened = this.cocsBegin('order', peerId, msg, now, parseOrderMessage);
  if (opened.refuse !== undefined) return opened.refuse;
  if (opened.duplicate) return true;
  const {peer, parsed} = opened;
  const actor = this.cocsActor(peer);
  const state = this.match.objectiveState;
  const team = actor.team === 1 ? 1 : 0;
  // The sim resolves slices, the executor lease and the command seat against
  // in-sim actor ids. Queued records therefore carry the acting actor id; the
  // transport peer id stays on the room side (replies, rate limits, card
  // mirroring) and never enters the simulation.
  const simId = String(actor.id);
  opened.kind = 'order';
  opened.cardId = parsed.cardId ?? this.cocsFallbackCardId(parsed, peer);
  opened.actorId = actor.id;
  opened.team = team;
  const record = { tick: this.cocsTick(), peerId: simId, cardId: opened.cardId, team, verb: parsed.verb, target: parsed.target, agent: parsed.agent ?? null };
  if (!state || state.kind !== 'cocs') return this.cocsRejectAction(opened, 'no-objective', { verb: parsed.verb, target: parsed.target });
  const node = nodeById(state, parsed.target);
  if (!node) { this.noteOrderReject(state, record, 'target'); return this.cocsRejectAction(opened, 'target', { verb: parsed.verb, target: parsed.target }); }
  const owned = node.owner === team;
  if (parsed.verb === 'ATTACK' && !capturableBy(state, node.id, team)) { this.noteOrderReject(state, record, 'wrong-team'); return this.cocsRejectAction(opened, 'wrong-team', { verb: parsed.verb, target: parsed.target }); }
  if (parsed.verb === 'HOLD' && !owned && !capturableBy(state, node.id, team)) { this.noteOrderReject(state, record, 'wrong-team'); return this.cocsRejectAction(opened, 'wrong-team', { verb: parsed.verb, target: parsed.target }); }
  if (parsed.verb === 'SCAN' && num(state.flux?.[team], 0) + 1e-9 < COCS_SCAN_COST) { this.noteOrderReject(state, record, 'flux'); return this.cocsRejectAction(opened, 'flux', { verb: parsed.verb, target: parsed.target }); }
  if (state.coop) {
   // The co-op gate keys slices/executor by the in-sim human actor id, not the
   // transport peer id, so pass the authoritative actor identity.
   const gate = coopOrderGate(this.match, state, { team, verb: parsed.verb, peerId: simId });
   if (!gate.ok) { this.noteOrderReject(state, record, gate.reason ?? 'blocked'); return this.cocsRejectAction(opened, gate.reason ?? 'blocked', { verb: parsed.verb, target: parsed.target }); }
   const command = coopCommandState(this.match, state);
   if (parsed.verb === 'SCAN' && command && command.threads.used >= command.threads.cap) { this.noteOrderReject(state, record, 'no-thread'); return this.cocsRejectAction(opened, 'no-thread', { verb: parsed.verb, target: parsed.target }); }
  } else if (parsed.verb === 'SCAN') {
   // PvP-1 THREADS gate (the co-op executor lease has no PvP analogue): a SCAN
   // spawns a scout that itself occupies one of the team's threads.
   const cap = num(state.threads?.[team]?.cap, 3);
   if (cocsThreadsUsed(this.match, state, team) >= cap) { this.noteOrderReject(state, record, 'no-thread'); return this.cocsRejectAction(opened, 'no-thread', { verb: parsed.verb, target: parsed.target }); }
  }
  this.pendingCocs.orders.push(record);
  // The card mirror keeps the transport peer id: it is the client-facing
  // identity for the board, while the sim only ever sees `simId`.
  this.recordCocsCard(opened.cardId, { verb: parsed.verb, target: parsed.target, agent: parsed.agent ?? null, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: record.tick, blocker: null, reason: null, ok: true });
  this.recordCocsDecision(opened, 'accepted', null, {verb: parsed.verb, target: parsed.target, agent: parsed.agent ?? null});
  return true;
 }
 economy(peerId, msg, now = Date.now()) {
  const opened = this.cocsBegin('economy', peerId, msg, now, parseEconomyMessage);
  if (opened.refuse !== undefined) return opened.refuse;
  if (opened.duplicate) return true;
  const {peer, parsed} = opened;
  const actor = this.cocsActor(peer);
  const state = this.match.objectiveState;
  const team = actor.team === 1 ? 1 : 0;
  const simId = String(actor.id);
  opened.kind = 'economy';
  opened.cardId = parsed.cardId ?? this.cocsFallbackCardId(parsed, peer);
  opened.actorId = actor.id;
  opened.team = team;
  if (!state || state.kind !== 'cocs') return this.cocsRejectAction(opened, 'no-objective', { action: parsed.action });
  // PvP-1 role board (§11.2): `spawn`/`reinforce` buys one role from the team's
  // rung allow-list under the same THREADS + FLUX gate the duty Chief uses.
  // Sinks with no PvP implementation are refused, never silently dropped.
  if (!state.coop) {
   if (parsed.action === 'opt-out-orders') {
    this.pendingCocs.commands.push({ tick: this.cocsTick(), peerId: simId, cardId: opened.cardId, team, action: 'opt-out-orders', value: null, actorId: actor.id });
    this.recordCocsCard(opened.cardId, { verb: 'OPT-OUT-ORDERS', target: null, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: this.cocsTick(), blocker: null, reason: null, ok: true });
    this.recordCocsDecision(opened, 'accepted', null, {action: parsed.action});
    return true;
   }
   if (parsed.action !== 'spawn' && parsed.action !== 'reinforce') return this.cocsRejectAction(opened, 'no-sink', { action: parsed.action });
   const role = String(parsed.role ?? 'fighter').trim().toLowerCase();
   if (!cocsRoleAllowedOnRung(state, role)) return this.cocsRejectAction(opened, 'role', { role });
   if (cocsThreadsUsed(this.match, state, team) >= num(state.threads?.[team]?.cap, 3)) return this.cocsRejectAction(opened, 'no-thread', { role });
   const cost = role === 'scout' ? COCS_SCAN_COST : num(coopRole(role)?.spawnCost, 0);
   if (num(state.flux?.[team], 0) + 1e-9 < cost) return this.cocsRejectAction(opened, 'flux', { role });
   if (role === 'scout' && !nodeById(state, parsed.target)) return this.cocsRejectAction(opened, 'target', { role });
   this.pendingCocs.spends.push({ tick: this.cocsTick(), peerId: simId, cardId: opened.cardId, action: parsed.action, role, target: parsed.target ?? null, team });
   this.recordCocsCard(opened.cardId, { verb: role === 'scout' ? 'SCAN' : 'REINFORCE', target: parsed.target ?? null, role, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: this.cocsTick(), blocker: null, reason: null, ok: true });
   this.recordCocsDecision(opened, 'accepted', null, {action: parsed.action, role, target: parsed.target ?? null});
   return true;
  }
  if (parsed.action === 'opt-out-orders') {
   this.pendingCocs.commands.push({ tick: this.cocsTick(), peerId: simId, cardId: opened.cardId, team, action: 'opt-out-orders', value: null, actorId: actor.id });
   this.recordCocsCard(opened.cardId, { verb: 'OPT-OUT-ORDERS', target: null, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: this.cocsTick(), blocker: null, reason: null, ok: true });
   this.recordCocsDecision(opened, 'accepted', null, {action: parsed.action});
   return true;
  }
  const verb = COCS_SINK_FOR[parsed.action];
  if (!verb) return this.cocsRejectAction(opened, 'unknown-action', { action: parsed.action });
  if (!intermissionOpen(state.coop)) return this.cocsRejectAction(opened, 'window-closed', { verb });
  const sink = coopSink(verb);
  if (!sink) return this.cocsRejectAction(opened, 'unknown-sink', { verb });
  if (num(state.flux?.[0], 0) + 1e-9 < sink.cost) return this.cocsRejectAction(opened, 'flux', { verb });
  const command = coopCommandState(this.match, state);
  if (COOP_BIG_SINKS.includes(verb) && command && command.threads.used >= command.threads.cap) return this.cocsRejectAction(opened, 'no-thread', { verb });
  const gate = coopSpendGate(this.match, state, { verb, peerId: simId });
  if (!gate.ok) return this.cocsRejectAction(opened, gate.reason ?? 'blocked', { verb });
  if (sink.target === 'node') {
   const node = nodeById(state, parsed.target);
   if (!node || node.owner !== 0 || !['front', 'economy', 'relay'].includes(node.archetype)) return this.cocsRejectAction(opened, 'target', { verb });
  }
  const record = { tick: this.cocsTick(), peerId: simId, cardId: opened.cardId, verb, target: parsed.target ?? null, role: parsed.role ?? null };
  this.pendingCocs.spends.push(record);
  this.recordCocsCard(opened.cardId, { verb, target: parsed.target ?? null, role: parsed.role ?? null, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: record.tick, blocker: null, reason: null, ok: true });
  this.recordCocsDecision(opened, 'accepted', null, {action: parsed.action, verb, target: parsed.target ?? null, role: parsed.role ?? null});
  return true;
 }
 terminal(peerId, msg, now = Date.now()) {
  const opened = this.cocsBegin('terminal', peerId, msg, now, parseTerminalMessage);
  if (opened.refuse !== undefined) return opened.refuse;
  if (opened.duplicate) return true;
  const {peer, parsed} = opened;
  const actor = this.cocsActor(peer);
  const state = this.match.objectiveState;
  opened.kind = 'terminal';
  opened.cardId = parsed.cardId ?? this.cocsFallbackCardId(parsed, peer);
  opened.actorId = actor.id;
  opened.action = parsed.action;
  opened.terminalId = parsed.terminalId;
  // PvPvE `cocs` has no terminals, but it does have the §6A traversal device
  // layer (cut/lock/repair on neutral devices). `cocs-coop` has both. Only
  // refuse when neither exists.
  if (!state || state.kind !== 'cocs' || (!state.terminals && !state.traversal?.devices)) return this.cocsRejectAction(opened, 'no-terminals', { action: parsed.action });
  const actorId = parsed.actorId ?? actor.id;
  if (actorId !== actor.id) return this.cocsRejectAction(opened, 'wrong-actor', { action: parsed.action });
  const terminal = state.terminals?.terminals?.[parsed.terminalId] ?? null;
  const device = state.traversal?.devices?.[parsed.terminalId] ?? null;
  if (!terminal && !device) return this.cocsRejectAction(opened, 'missing', { action: parsed.action });
  const team = actor.team === 1 ? 1 : 0;
  if (terminal) {
   // One read-only gate shared with the authority: adjacency, supply,
   // elevation, contest and real courier/bank state all decide acceptance.
   const gate = terminalActionGate(this.match,state,terminal,actor,parsed.action);
   if (!gate.ok) return this.cocsRejectAction(opened,gate.reason,{action:parsed.action,terminalId:parsed.terminalId});
   opened.baseline = this.cocsTerminalBaseline(state, parsed.terminalId);
  } else if (device) {
   // Traversal devices are neutral: validate the action belongs to the device
   // state and that the actor is within the §6A interact reach.
   const reach = 6;
   if (!['cut', 'lock', 'repair', 'depot-capture'].includes(parsed.action)) return this.cocsRejectAction(opened, 'wrong-device-action', { action: parsed.action });
   if (Math.hypot(num(actor.x, 0) - num(device.from?.x, 0), num(actor.z, 0) - num(device.from?.z, 0)) > reach + 1e-6) return this.cocsRejectAction(opened, 'range', { action: parsed.action });
   if (parsed.action === 'repair' ? device.state === 'live' : device.state !== 'live') return this.cocsRejectAction(opened, 'device-state', { action: parsed.action });
   opened.baseline = this.cocsTerminalBaseline(state, parsed.terminalId);
  }
  this.pendingCocs.terminals.push({ tick: this.cocsTick(), peerId: String(actor.id), cardId: opened.cardId, terminalId: parsed.terminalId, action: parsed.action, actorId: actor.id });
  this.recordCocsCard(opened.cardId, { verb: parsed.action.toUpperCase(), target: parsed.terminalId, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: this.cocsTick(), blocker: null, reason: null, ok: true });
  this.recordCocsDecision(opened, 'accepted', null, {action: parsed.action, terminalId: parsed.terminalId});
  return true;
 }
 command(peerId, msg, now = Date.now()) {
  const opened = this.cocsBegin('command', peerId, msg, now, parseCommandMessage);
  if (opened.refuse !== undefined) return opened.refuse;
  if (opened.duplicate) return true;
  const {peer, parsed} = opened;
  const actor = this.cocsActor(peer);
  const state = this.match.objectiveState;
  opened.kind = 'command';
  opened.cardId = parsed.cardId ?? this.cocsFallbackCardId(parsed, peer);
  opened.actorId = actor.id;
  opened.team = actor.team === 1 ? 1 : 0;
  opened.action = parsed.action;
  opened.value = parsed.value;
  // PvP-1: `cocs` runs a per-team command seat (§5.7); `cocs-coop` keeps its
  // own `state.coop` command surface. Both are team-scoped: a peer can only
  // touch the seat for its own actor's team.
  if (!state || state.kind !== 'cocs') return this.cocsRejectAction(opened, 'no-command', { action: parsed.action });
  const team = actor.team === 1 ? 1 : 0;
  // The seat itself is an in-sim actor id (the sim writes and reads it), so the
  // room validates `release`/buyer-commander state on the same identity.
  const simId = String(actor.id);
  const authority = cocsCommandAuthority(this.match, state, {...parsed, peerId: simId, team, actorId: actor.id});
  if (!authority.ok) return this.cocsRejectAction(opened, authority.reason, {action: parsed.action});
  // Match the sim's vocabulary before issuing an acceptance. Otherwise a bad
  // route/stance sits RUNNING forever, and a lowercase accepted stance never
  // matches its uppercase snapshot when the ledger waits for completion.
  let value = parsed.value == null || parsed.value === '' ? null : parsed.value;
  if (parsed.action === 'policy' && value !== null) {
   value = normalizeCocsPolicy(value);
   if (value === null) return this.cocsRejectAction(opened, 'stance', {action:parsed.action});
  }
  if (parsed.action === 'set-route' && value !== null && !nodeById(state, String(value))) return this.cocsRejectAction(opened, 'unknown-node', {action:parsed.action});
  opened.value = value;
  this.pendingCocs.commands.push({ tick: this.cocsTick(), peerId: simId, cardId: opened.cardId, team, action: parsed.action, value, actorId: actor.id });
  this.recordCocsCard(opened.cardId, { verb: parsed.action.toUpperCase(), target: null, value, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: this.cocsTick(), blocker: null, reason: null, ok: true });
  this.recordCocsDecision(opened, 'accepted', null, {action: parsed.action, value});
  return true;
 }
 buy(peerId, msg, now = Date.now()) {
  const opened = this.cocsBegin('buy', peerId, msg, now, parseBuyMessage);
  if (opened.refuse !== undefined) return opened.refuse;
  if (opened.duplicate) return true;
  const {peer, parsed} = opened;
  const actor = this.cocsActor(peer);
  const state = this.match.objectiveState;
  opened.kind = 'buy';
  opened.cardId = parsed.cardId ?? this.cocsFallbackCardId(parsed, peer);
  opened.actorId = actor.id;
  if (!state || state.kind !== 'cocs') return this.cocsRejectAction(opened, 'no-objective', { itemId: parsed.itemId });
  const actorId = parsed.actorId ?? actor.id;
  if (actorId !== actor.id) return this.cocsRejectAction(opened, 'wrong-actor', { itemId: parsed.itemId });
  const item = reqItem(parsed.itemId);
  if (!item) return this.cocsRejectAction(opened, 'unknown-item', { itemId: parsed.itemId });
  const team = actor.team === 1 ? 1 : 0;
  // WP1.3 launch sets. `launch` items run in both wire modes; `coopLaunch`
  // items (the depot Puma) only in OPERATIONS. An item launched in the other
  // mode is `wrong-mode`; a catalogue row with no shipped effect is
  // `not-launched` and can never be enqueued or debit REQ.
  const mode = state.coop ? 'cocs-coop' : 'cocs';
  if (!reqItemSupported(item.id, mode)) {
   const modes = reqItemModes(item.id);
   return this.cocsRejectAction(opened, modes.length ? 'wrong-mode' : 'not-launched', { itemId: parsed.itemId });
  }
  // The OPERATIONS Puma's spend point is a friendly depot (§6A.7), so refuse an
  // unusable depot before queueing. `coopBuyAction` re-checks at apply time and
  // refunds; a refusal here is cached by round identity and never debits.
  if (item.id === 'puma') {
   const depot = state.traversal?.depots?.[String(parsed.depotId ?? '')] ?? null;
   if (!depot || depot.owner !== team) return this.cocsRejectAction(opened, 'depot', { itemId: parsed.itemId, depotId: parsed.depotId ?? null });
   if (!depotPurchaseState(this.match, depot).available) return this.cocsRejectAction(opened, 'vehicle', { itemId: parsed.itemId, depotId: parsed.depotId ?? null });
  }
  const simId = String(actor.id);
  const relayOwned = (state.nodes ?? []).some(node => node && node.archetype === 'relay' && node.owner === team);
  // Commander-only items read the PvP command seat in PvP and the co-op seat in
  // OPERATIONS; both are team-scoped and keyed by the in-sim actor id.
  const isCommander = state.coop ? state.coop.commandSeat?.[team] === simId : state.command?.seat?.[team] === simId;
  const result = reqPurchase(parsed.itemId, {
   balance: num(actor.req, 0),
   isCommander,
   activeBuffId: typeof actor.reqBuff === 'string' ? actor.reqBuff : null,
   relayOwned,
  });
  if (!result.ok) return this.cocsRejectAction(opened, result.reason ?? 'purchase', { itemId: parsed.itemId });
  opened.team = team;
  opened.itemId = parsed.itemId;
  opened.baseline = {reqSpent: num(actor.reqSpent, 0), req: num(actor.req, 0)};
  this.pendingCocs.buys.push({ tick: this.cocsTick(), peerId: simId, cardId: opened.cardId, itemId: parsed.itemId, actorId: actor.id, depotId: parsed.depotId, targetCardId: parsed.targetCardId });
  this.recordCocsCard(opened.cardId, { verb: 'BUY', target: parsed.itemId, itemId: parsed.itemId, team, actorId: actor.id, peerId: String(peerId), state: 'running', accepted: true, acceptedTick: this.cocsTick(), blocker: null, reason: null, ok: true });
  this.recordCocsDecision(opened, 'accepted', null, {itemId: parsed.itemId, depotId: parsed.depotId ?? null, targetCardId: parsed.targetCardId ?? null});
  return true;
 }
 effectiveSnapshotHz() {
  const actors = this.match?.actors?.length ?? 0;
  return actors > COCS_OVERLOAD_ACTORS ? Math.min(this.snapshotHz, COCS_OVERLOAD_SNAPSHOT_HZ) : this.snapshotHz;
 }
 summary() {
  return { roomId: this.id, name: this.name, players: [...this.peers.values()].filter(p => p.disconnectedAt === null).length, started: this.started, mapId: this.mapId, config: this.config ? { ...this.config } : null };
 }
 // -------------------------------------------------------------------
 // LATTICE STRIKE PvP rung (§3.1). `cocs-coop` is rung-free by construction;
 // a PvP `cocs` room with no explicit rung is a practice match and reports
 // `practice:true`. The plan is recomputed from the live seat count so the
 // lobby always states the human floor, the exact bot fill a start would use,
 // and whether the rung is below minimum (with the fallback rung, if any).
 // -------------------------------------------------------------------
 cocsRungInfo() {
  const mode = this.config?.mode ?? null;
  if (mode !== 'cocs') return { pvp: false, rung: null, plan: null, practice: false };
  const rung = cocsRung(this.config?.rung)?.id ?? null;
  if (!rung) return { pvp: true, practice: true, rung: null, plan: null };
  const humans = [...this.peers.values()].filter(p => p.spectate !== true).length;
  return { pvp: true, practice: false, rung, plan: cocsRungPlan(rung, humans) };
 }
 cocsLobby() {
  const info = this.cocsRungInfo();
  if (!info.pvp) return null;
  if (!info.plan) return { rung: null, practice: true };
  const plan = info.plan;
  return {
   rung: info.rung,
   practice: false,
   name: plan.name,
   variant: plan.variant,
   perTeam: plan.perTeam,
   total: plan.total,
   humans: plan.humans,
   minHumans: plan.minHumans,
   meetsMinimum: plan.meetsMinimum,
   belowMinimum: plan.belowMinimum,
   botFill: plan.botFill,
   roleAllow: [...plan.roleAllow],
   fallback: plan.belowMinimum ? (cocsRungBelow(info.rung) ?? null) : null,
  };
 }
 // Outbound snapshots are quantized from a deep copy so the authoritative match
 // state (shared nested references such as powerups/gear) is never mutated.
 wireState() {
  if (!this.match) return null;
  const state = quantizedCopy(this.match.snapshot());
  // The card board is a room-level projection of the sim's order/blocker state.
  // Attaching it to the same `cocs` subtree means a reconnect full snapshot and
  // every delta carry it for free (id-keyed, so `snapshotDelta` patches it).
  // `roundRevision` rides the same subtree (additive v3 field): a same-revision
  // reconnect hydrates the cards/outcomes it already had, and a new revision
  // tells the client to clear its optimistic strip.
  if (state.cocs) state.cocs = { ...state.cocs, roundRevision: this.roundRevision, ...(this.cocsCards.size ? { cards: this.cocsCardList() } : {}) };
  return state;
 }
 // The view a peer's snapshot is filtered by: its actor's team (0/1) or `null`
 // for a spectator / a peer without a live actor. Teams never change mid-match,
 // and a spectator can never be used as an oracle for either team's private
 // data (§11.4). Returned to the tick loop so at most three filtered frames are
 // built per broadcast (team 0, team 1, spectator).
 peerCocsView(peer) {
  if (!peer || peer.spectate === true) return null;
  const actor = peer.actorId === null || peer.actorId === undefined ? null : this.match?.actors?.[peer.actorId] ?? null;
  if (!actor || (actor.team !== 0 && actor.team !== 1)) return null;
  return actor.team === 1 ? 1 : 0;
 }
 // Per-team projection of `wireState()` (§11.4/§12.7). `filterCocsSnapshot`
 // returns the raw state by identity when the mode has no `cocs` subtree, so
 // non-COCS modes and every offline path are byte-identical.
 wireStateFor(view) {
  const state = this.wireState();
  return state ? filterCocsSnapshot(state, view) : null;
 }
 // One outbound `results` state per recipient view; non-COCS (and single-team)
 // rooms collapse to one shared state and keep the historic `to: null`
 // broadcast. Snapshots and results share the same per-team filtering (§11.4).
 sendResults(result) {
  if (!result) return;
  const views = new Map();
  const forPeer = peer => {
   const view = this.peerCocsView(peer);
   if (!views.has(view)) views.set(view, filterCocsSnapshot(result, view));
   return views.get(view);
  };
  const states = [...this.peers.values()].map(forPeer);
  const uniform = states.length === 0 || states.every(state => state === states[0]);
  if (uniform) this.broadcast({ type: 'results', state: states[0] ?? filterCocsSnapshot(result, null) });
  else for (const p of this.peers.values()) this.send(p.id, { type: 'results', state: forPeer(p) });
 }
 // Deterministic lifecycle view shared by the lobby message and the tests.
 lifecycle() {
  const players = [...this.peers.values()].filter(p => p.spectate !== true);
  const connected = players.filter(p => p.disconnectedAt === null);
  const readyCount = connected.filter(p => this.ready.has(p.id)).length;
  const needed = Math.max(1, Math.ceil(connected.length * REMATCH_RATIO));
  // A rematch needs a strict majority (> half), not a ratio-rounded quorum, so
  // one of two players cannot restart the match on their own.
  const rematchNeeded = Math.max(1, Math.floor(connected.length / 2) + 1);
  // Only connected, non-spectator peers count toward a vote quorum: a seat held
  // open after a disconnect (or superseded by a reconnect) must not keep voting.
  const live = new Set(connected.map(p => p.id));
  const votes = {};
  for (const [mapId, voters] of this.mapVotes) { const count = [...voters].filter(id => live.has(id)).length; if (count) votes[mapId] = count; }
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const rematch = [...this.rematchVotes].filter(id => live.has(id)).length;
  return {
   phase: this.phase,
   revision: this.lifecycleRevision,
   warmup: this.phase === 'warmup' ? Math.max(0, Math.ceil(this.warmupTimer)) : 0,
   ready: readyCount,
   readyNeeded: needed,
   readyRatio: connected.length ? readyCount / connected.length : 0,
   mapVotes: votes,
   mapVoteWinner: winner,
    rematch,
    rematchNeeded,
    rematchReady: this.roundOver && this.started && rematch >= rematchNeeded,
  };
 }
 lobby() {
  return { type: 'lobby', roomId: this.id, name: this.name, hostId: this.hostId, started: this.started,
   config: this.config ? { ...this.config } : null, mapId: this.mapId, lifecycle: this.lifecycle(), cocs: this.cocsLobby(), roundRevision: this.roundRevision,
   players: [...this.peers.values()].map(p => ({ peerId: p.id, name: p.name, character: p.character, harness: p.harness, actorId: p.actorId, ready: this.ready.has(p.id) || p.ready, connected: p.disconnectedAt === null, spectate: p.spectate === true, voiceSession: p.voiceSession })) };
 }
 // Mark a player ready for the warmup gate. Ready state is keyed by the stable
 // peer id and cleared on join/leave so a reconnecting peer must re-ready.
 setReady(peerId, ready = true) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate) return false;
  const next = ready !== false;
  if (next) this.ready.add(peerId); else this.ready.delete(peerId);
  if (peer.ready !== next) { peer.ready = next; this.lifecycleRevision++; this.broadcast(this.lobby()); }
  return next;
 }
 // One vote per player. Voting replaces the player's previous choice so the
 // tally always reflects current intent rather than a running total.
 mapVote(peerId, mapId) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || typeof mapId !== 'string' || !mapId) return null;
  for (const voters of this.mapVotes.values()) voters.delete(peerId);
  const voters = this.mapVotes.get(mapId) || new Set();
  voters.add(peerId);
  this.mapVotes.set(mapId, voters);
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return mapId;
 }
 // A rematch needs a majority of connected players; once met the host may
 // restart without re-running warmup.
 requestRematch(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || !this.roundOver) return false;
  this.rematchVotes.add(peerId);
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return this.lifecycle().rematchReady;
 }
 // Enter warmup: the host start arms a countdown; the match itself is created
 // when the countdown reaches zero (see tick). A zero warmup starts immediately.
 beginWarmup(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || peerId !== this.hostId) return false;
  const players = [...this.peers.values()].filter(p => p.spectate !== true && p.disconnectedAt === null);
  if (!players.length) return false;
  const needed = Math.max(1, Math.ceil(players.length * REMATCH_RATIO));
  if (this.warmupSeconds <= 0 || this.ready.size >= needed) return this.start(peerId);
  this.phase = 'warmup';
  this.warmupTimer = this.warmupSeconds;
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return true;
 }
 cancelWarmup() {
  if (this.phase !== 'warmup') return false;
  this.phase = 'lobby';
  this.warmupTimer = 0;
  this.lifecycleRevision++;
  this.broadcast(this.lobby());
  return true;
 }
 nextConnectedHost() { for (const p of this.peers.values()) if (p.spectate !== true && p.disconnectedAt === null) return p.id; return null; }
 progressProfile(peer) { if (!this.progression || !peer?.playerId || !peer.playerToken) return null; return this.progression.getOwned(peer.playerId, peer.playerToken); }
 join(peerId, name = '', character = 'chatgpt', harness = 'openclaw', token = '', spectate = false, playerId = '', progressToken = '', deltaVersion = 0) {
  if (this.peers.has(peerId)) return;
  const delta = Math.min(SNAPSHOT_DELTA_VERSION, Math.max(0, Math.floor(Number(deltaVersion) || 0)));
  if (token) {
   const existing = [...this.peers.values()].find(p => p.token === token);
   if (existing) {
    if (existing.disconnectedAt === null) {
     // A reconnect can arrive before the old socket's close event is processed.
     // Newest connection wins: adopt the peer and seat on this socket. The old
     // socket's later close is a no-op because the peer id is reassigned below.
     existing.disconnectedAt = Date.now();
    }
    const oldId = existing.id;
    this.peers.delete(oldId);
      existing.id = peerId;
      existing.deltaVersion = delta;
       this.ready.delete(oldId); this.rematchVotes.delete(oldId); for (const voters of this.mapVotes.values()) voters.delete(oldId); existing.ready = false;
       existing.disconnectedAt = null;
      existing.voiceSession = null;
     existing.inputRate = null;
     existing.latest = null;
     existing.receivedSeq = existing.appliedSeq = existing.latestSeq = 0;
      existing.edgeFire = existing.edgeJump = existing.edgePower = existing.edgeInteract = false;
     existing.lastJump = existing.lastPower = existing.lastInteract = false;
     existing.edgeMelee = existing.lastMelee = false; existing.edgeReload = existing.lastReload = false; existing.edgeGrenade = false; existing.lastGrenade = false;
    this.peers.set(peerId, existing);
    if (this.hostId === oldId) this.hostId = peerId;
    else if (!this.hostId && existing.spectate !== true) this.hostId = peerId;
    this.send(peerId, { type: 'welcome', v: PROTOCOL_VERSION, peerId, roomId: this.id, host: peerId === this.hostId, reconnected: true, token: existing.token, spectate: existing.spectate === true, profile: this.progressProfile(existing), progressToken: existing.playerToken ?? null });
    this.broadcast(this.lobby());
    if (this.started && !this.roundOver && this.match) {
     this.send(peerId, { type: 'start', config: { ...this.match.config }, mapId: this.match.arena.id, roundRevision: this.roundRevision });
     const state = this.wireStateFor(this.peerCocsView(existing)), seq = ++this.seq;
     existing.snapshotBase = { seq, state };
     this.send(peerId, { type: 'snapshot', seq, acks: { [existing.actorId]: existing.appliedSeq }, state });
     } else if (this.match?.over) {
      this.send(peerId, { type: 'results', state: filterCocsSnapshot(this.match.snapshot(), this.peerCocsView(existing)) });
     }
    return;
   }
  }
  const active = this.started && !this.roundOver && !!this.match;
  const requestedPlayer = spectate !== true;
  const playerCount = [...this.peers.values()].filter(p => p.spectate !== true).length;
  if (requestedPlayer && !active && playerCount >= playerLimit(this.config?.mode)) { this.send(peerId, { type: 'error', message: 'room is full' }); return; }
  let isSpectator = spectate === true;
  if (requestedPlayer && active) isSpectator = true;
  if (isSpectator && [...this.peers.values()].filter(p => p.spectate === true).length >= SPECTATOR_LIMIT) { this.send(peerId, { type: 'error', message: 'spectator limit reached' }); return; }
  const l = resolveLoadout(character, harness) || { character: 'chatgpt', harness: 'openclaw' };
  const identity = this.progression ? this.progression.identify(validPlayerId(playerId) ? playerId : '', progressToken) : null;
  if (this.phase === 'warmup') this.cancelWarmup();
  const peer = { id: peerId, name: sanitizeText(name, 20) || CHARACTERS.find(c => c.id === l.character).name,
    character: l.character, harness: l.harness, actorId: null, ready: false, latest: null, receivedSeq: 0, latestSeq: 0, appliedSeq: 0, lastSerial: active ? this.match.serial : 0,
     lastJump: false, lastPower: false, lastInteract: false, lastReload: false, edgeFire: false, edgeJump: false, edgePower: false, edgeInteract: false, edgeMelee: false, lastMelee: false, edgeReload: false, edgeGrenade: false, lastGrenade: false,
   token: randomUUID(), disconnectedAt: null, spectate: isSpectator, voiceSession: null, playerId: identity?.profile.id ?? null, playerToken: identity?.token ?? null, deltaVersion: delta, snapshotBase: null };
  this.peers.set(peerId, peer);
  if (!this.hostId && !isSpectator) this.hostId = peerId;
  this.send(peerId, { type: 'welcome', v: PROTOCOL_VERSION, peerId, roomId: this.id, host: peerId === this.hostId, token: peer.token, spectate: isSpectator, profile: identity?.profile ?? null, progressToken: peer.playerToken });
  this.broadcast(this.lobby());
  if (requestedPlayer && active) this.send(peerId, { type: 'error', message: 'Match in progress — you joined as a spectator.' });
  if (isSpectator && this.started && !this.roundOver && this.match) {
   this.send(peerId, { type: 'start', config: { ...this.match.config }, mapId: this.match.arena.id, roundRevision: this.roundRevision });
    const state = this.wireStateFor(this.peerCocsView(this.peers.get(peerId))), seq = ++this.seq;
    peer.snapshotBase = { seq, state };
    this.send(peerId, { type: 'snapshot', seq, acks: { [this.peers.get(peerId)?.actorId ?? -1]: 0 }, state });
   } else if (isSpectator && this.match?.over) {
    this.send(peerId, { type: 'results', state: filterCocsSnapshot(this.match.snapshot(), this.peerCocsView(this.peers.get(peerId))) });
   }
 }
 disconnect(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  peer.disconnectedAt = Date.now();
  peer.voiceSession = null;
  peer.latest = null;
    peer.edgeFire = peer.edgeJump = peer.edgePower = peer.edgeInteract = false;
   peer.lastJump = peer.lastPower = peer.lastInteract = false;
   peer.edgeMelee = peer.lastMelee = false; peer.edgeReload = peer.lastReload = false; peer.edgeGrenade = false; peer.lastGrenade = false;
  this.broadcast(this.lobby());
 }
 expireGrace(now = Date.now()) {
  for (const [id, peer] of this.peers) if (peer.disconnectedAt && now - peer.disconnectedAt > this.graceMs) this.leave(id);
 }
 host(peerId, config, mapId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  if (peer.spectate) { this.send(peerId, { type: 'error', message: 'spectators cannot change match settings' }); return; }
  if (peerId !== this.hostId) { this.send(peerId, { type: 'error', message: 'only the host can change match settings' }); return; }
  this.config = normalizeConfig(config);
  // Single-player modes are local-only; never let a network host start one.
  if (isSinglePlayerMode(this.config.mode)) { this.send(peerId, { type: 'error', message: 'single-player modes are local only' }); this.config.mode = 'deathmatch'; }
  this.mapId = resolveMapForMode(getMap(mapId).id, this.config.mode, { legacy: true });
  this.broadcast(this.lobby());
 }
 start(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  if (peer.spectate) { this.send(peerId, { type: 'error', message: 'spectators cannot start the match' }); return; }
  if (peerId !== this.hostId) { this.send(peerId, { type: 'error', message: 'only the host can start' }); return; }
  if (this.peers.size === 0) { this.send(peerId, { type: 'error', message: 'no players in the room' }); return; }
  const players = [...this.peers.values()].filter(p => p.spectate !== true);
  if (players.length === 0) { this.send(peerId, { type: 'error', message: 'no players in the room' }); return; }
  const mode = this.config?.mode ?? normalizeConfig({}).mode;
  const mapId = resolveMapForMode(this.mapId, mode, { legacy: true });
  if (mapId !== this.mapId) this.mapId = mapId;
  const humanCount = Math.min(playerLimit(mode), players.length);
    // LATTICE STRIKE PvP rung gate (§3.1). A laddered `cocs` room only starts on
    // its published human floor; below the floor it refuses and names the rung
    // fallback (or OPERATIONS / the practice sandbox) instead of silently bot-
    // filling a rung. Once the floor is met the remaining seats are bots at a
    // stable ratio for the whole match (no mid-match bot-ratio changes).
    const rung = mode === 'cocs' ? cocsRung(this.config?.rung)?.id ?? null : null;
    let startConfig = { ...this.config ?? {} };
    if (rung) {
     const plan = cocsRungPlan(rung, humanCount);
     if (!plan || !plan.meetsMinimum) {
      const fallback = cocsRungBelow(rung);
      this.send(peerId, { type: 'error', message: plan ? `below-minimum: ${rung} needs ${plan.minHumans} humans (have ${plan.humans})${fallback ? ` — fall back to ${fallback}` : ' — use LATTICE STRIKE: OPERATIONS or the practice sandbox'}` : 'below-minimum' });
      return false;
     }
     startConfig = { ...startConfig, rung, botCount: Math.max(Number(startConfig.botCount) || 0, plan.botFill) };
    }
    this.match = new Match('chatgpt', 'openclaw', this.random, this.mapId, { ...startConfig, humanCount, loadouts: players.map(p => { const profile = this.progressProfile(p); return { character: p.character, harness: p.harness, gear: profile?.gear, attachments: profile?.attachments, finish: profile?.finish }; }) });
   if (this.match.race) this.config = { ...this.match.config };
  let i = 0;
   for (const p of players) { p.actorId = i; this.match.actors[i].name = p.name; p.latest = null; p.receivedSeq = p.latestSeq = p.appliedSeq = 0; p.lastSerial = 0; p.edgeJump = p.edgePower = p.edgeInteract = false; p.lastJump = p.lastPower = p.lastInteract = false; p.edgeMelee = p.lastMelee = false; p.edgeReload = p.lastReload = false; p.edgeGrenade = false; p.lastGrenade = false; i++; }
   for (const p of this.peers.values()) { p.edgeFire = false; p.edgeReload = p.lastReload = false; p.edgeGrenade = false; p.lastGrenade = false; if (p.spectate) p.lastSerial = 0; }
  this.started = true;
  this.roundOver = false;
  this.phase = 'live';
  this.warmupTimer = 0;
  this.rematchVotes.clear();
  this.pendingLoadouts.clear();
  this.tickAcc = 0;
  this.broadcastAt = 0;
  // A real new round mints a fresh identity and clears every per-round COCS
  // queue, card and dedupe record. A reconnect never reaches this path.
  this.roundRevision += 1;
  this.pendingCocs = { orders: [], spends: [], terminals: [], commands: [], buys: [] };
  this.cocsCards = new Map();
  this.cocsLedger = new Map();
  this.cocsInFlight = new Set();
  this.cocsSeq = 0;
  for (const p of this.peers.values()) p.cocsRate = null;
  // A new match invalidates every delta chain: the first post-start frame is a
  // full snapshot and each peer's (per-view) base is reset.
  this.lastSnapshot = null;
  this.lastViewSnapshots.clear();
  for (const p of this.peers.values()) p.snapshotBase = null;
  this.broadcast(this.lobby());
  this.broadcast({ type: 'start', config: { ...this.config }, mapId: this.mapId, roundRevision: this.roundRevision });
  return true;
 }
 input(peerId, input) {
  const peer = this.peers.get(peerId);
   if (!peer || peer.disconnectedAt !== null || peer.spectate || peer.actorId === null || !this.match || this.roundOver) return;
  const now = Date.now();
  if (!peer.inputRate || now - peer.inputRate.at >= 1000) peer.inputRate = { at: now, count: 0 };
  if (peer.inputRate.count >= INPUT_RATE_LIMIT) return;
  peer.inputRate.count++;
  const i = parseInputEnvelope(input);
   const requested = i.seq ?? peer.receivedSeq + 1;
   // A rogue or buggy client could jump its sequence far ahead, after which every
   // real input looks stale. Accept modest forward progress only; a stale or
   // duplicate sequence is ignored as before.
   const seq = requested > peer.receivedSeq + 600 ? peer.receivedSeq + 1 : requested;
   if (seq <= peer.receivedSeq) return;
   peer.receivedSeq = seq;
     const ext = { x: i.x, z: i.z, fire: i.fire };
   if (this.match.race) Object.assign(ext, { jump: i.jump, power: i.power, interact: i.interact });
  if (i.yaw !== undefined) ext.yaw = i.yaw;
  if (i.pitch !== undefined) ext.pitch = i.pitch;
  if (i.weapon !== undefined) ext.weapon = i.weapon;
  if (i.sprint) ext.sprint = true;
  if (i.crouch) ext.crouch = true;
  if (i.ads) ext.ads = true;
  // The class movement verb is a held state, never an edge: the client keeps
  // sending true while the bind is down, and the core derives the press/release
  // edges. A forwarded pulse would fake a release and cancel an active grapple.
  if (i.mobility) ext.mobility = true;
  // `altFire` follows the same held contract. Rebuilding `ext` on every message
  // means a release (altFire false) drops the field, while `peer.latest` carries
  // it through every tick in between.
  if (i.altFire) ext.altFire = true;
    peer.latest = ext;
    peer.latestSeq = seq;
    if (i.fire && !this.match.race) peer.edgeFire = true;
   if (i.jump && !peer.lastJump && !this.match.race) peer.edgeJump = true;
  peer.lastJump = i.jump;
    if (i.power && !peer.lastPower && !this.match.race) peer.edgePower = true;
   peer.lastPower = i.power;
    if (i.interact && !peer.lastInteract && !this.match.race) peer.edgeInteract = true;
   peer.lastInteract = i.interact;
   if (i.reload && !peer.lastReload) peer.edgeReload = true;
   peer.lastReload = i.reload;
   if (i.melee && !peer.lastMelee) peer.edgeMelee = true;
   peer.lastMelee = i.melee;
   if (i.grenade && !peer.lastGrenade) peer.edgeGrenade = true;
   peer.lastGrenade = i.grenade;
 }
 setGear(peerId, gear, attachments, now = Date.now(), finish) {
  const peer = this.peers.get(peerId);
  if (!peer || !peer.playerId || !this.progression || peer.spectate || peer.disconnectedAt !== null) return;
  if (peer.lastGearAt && now - peer.lastGearAt < 500) return;
  peer.lastGearAt = now;
  const profile = this.progression.setGearOwned(peer.playerId, peer.playerToken, gear, attachments, finish);
  if (profile) this.send(peerId, { type: 'progression', profile, gear: profile.gear, attachments: profile.attachments });
 }
 // Team-mode respawn switching modelled on setGear: validate the peer, the mode
 // and the cooldowns, normalise through resolveLoadout (Claude lock), then queue
 // the pair on the peer and the room and hand the authoritative pending record
 // to the match. It applies at the actor's next spawn, never mid-life. FFA/solo
 // locked modes, puma race/soccer (movement disabled) and single-player modes
 // are rejected; so are sudden death and the VIP. `teamMode` alone would admit
 // puma-soccer, horde and campaign, which is why the movement/mode rule helpers
 // are part of the gate.
 setLoadout(peerId, character, harness, now = Date.now()) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || peer.disconnectedAt !== null) return false;
  if (!this.match || !this.started || this.roundOver) return false;
  const mode = this.match.config.mode;
  if (!teamMode(mode) || isSinglePlayerMode(mode) || movementModeRule(mode).disabled) return false;
  if (this.match.suddenDeath === true) return false;
  const actor = peer.actorId !== null ? this.match.actors[peer.actorId] : null;
  if (actor && actor.isVip === true) return false;
  if (peer.lastLoadoutAt && now - peer.lastLoadoutAt < LOADOUT_FLOOD_MS) return false;
  const resolved = resolveLoadout(character, harness);
  if (resolved.character === peer.character && resolved.harness === peer.harness) return false;
  if (peer.loadoutLockUntil && now < peer.loadoutLockUntil) return false;
  peer.lastLoadoutAt = now;
  peer.loadoutLockUntil = now + LOADOUT_LOCKOUT_MS;
  peer.character = resolved.character;
  peer.harness = resolved.harness;
  peer.pendingLoadout = { ...resolved };
  this.pendingLoadouts.set(peerId, { ...resolved });
  if (actor) this.match.setLoadout(actor.id, resolved);
  this.broadcast(this.lobby());
  return true;
 }
 chat(peerId, text, now = Date.now()) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  const clean = sanitizeText(text, 200);
  if (!clean) return;
  if (peer.lastChatAt && now - peer.lastChatAt < 300) return;
  peer.lastChatAt = now;
  this.broadcast({ type: 'chat', peerId, name: peer.name, text: clean, time: now });
 }
 voiceState(peerId, enabled, config = () => ({ type: 'voice-config', iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })) {
  const peer = this.peers.get(peerId);
  if (!peer || peer.spectate || peer.disconnectedAt !== null || typeof enabled !== 'boolean') return;
  if (enabled === (peer.voiceSession !== null)) return;
  // Disabling always works, even after exhausting the signaling budget.
  if (enabled) {
   if (!this.voiceBudget(peer, 0)) return;
   this.send(peerId, config(peerId));
   peer.voiceSession = randomUUID();
  } else peer.voiceSession = null;
  this.broadcast(this.lobby());
 }
 voiceBudget(peer, bytes, now = Date.now()) {
  if (!peer.voiceRate || now - peer.voiceRate.at >= 10000) peer.voiceRate = { at: now, count: 0, bytes: 0 };
  const rate = peer.voiceRate;
  if (rate.count >= 128 || rate.bytes + bytes > 256 * 1024) return false;
  rate.count++;
  rate.bytes += bytes;
  return true;
 }
 voicePeers(from, to, msg) {
  const source = this.peers.get(from), target = this.peers.get(to);
  return msg.roomId === this.id && from !== to && source && target &&
   !source.spectate && !target.spectate && source.disconnectedAt === null && target.disconnectedAt === null &&
   typeof msg.session === 'string' && msg.session.length === 36 && source.voiceSession === msg.session &&
   typeof msg.targetSession === 'string' && msg.targetSession.length === 36 && target.voiceSession === msg.targetSession;
 }
 voiceSignal(peerId, msg) {
  const peer = this.peers.get(peerId);
  if (!object(msg) || !peer || !this.voicePeers(peerId, msg.to, msg)) return;
  const description = Object.hasOwn(msg, 'description'), candidate = Object.hasOwn(msg, 'candidate');
  if (description === candidate) return;
  let payload;
  if (description) {
   const d = msg.description;
   if (!object(d) || !['offer', 'answer'].includes(d.type) || !bounded(d.sdp, 32 * 1024)) return;
   payload = { description: { type: d.type, sdp: d.sdp } };
  } else {
   const c = msg.candidate;
   if (c !== null && (!object(c) || !bounded(c.candidate, 4096) ||
    !(c.sdpMid === null || bounded(c.sdpMid, 256)) ||
    !(c.sdpMLineIndex === null || (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex <= 65535)) ||
    !(c.usernameFragment === undefined || bounded(c.usernameFragment, 256)))) return;
   payload = { candidate: c === null ? null : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex,
    ...(c.usernameFragment === undefined ? {} : { usernameFragment: c.usernameFragment }) } };
  }
  const relay = { type: 'voice-signal', roomId: this.id, from: peerId, session: msg.session, targetSession: msg.targetSession, ...payload };
  if (this.voiceBudget(peer, Buffer.byteLength(JSON.stringify(relay)))) this.send(msg.to, relay);
 }
 leave(peerId) {
  const peer = this.peers.get(peerId);
  if (!peer) return;
  if (peer.actorId !== null && this.match && this.started && !this.roundOver) {
   const a = this.match.actors[peer.actorId];
   a.name = `${a.name} · BOT`;
   a.bot = { route: [], think: 0, target: -1, memory: 0, reaction: 0, stuck: 0, last: { x: a.x, y: a.y, z: a.z }, state: 'roam' };
   reconcileCocsSquads(this.match, this.match.objectiveState);
  }
  peer.latest = null;
    peer.edgeFire = peer.edgeJump = peer.edgePower = peer.edgeInteract = false;
   peer.lastJump = peer.lastPower = peer.lastInteract = false;
   peer.edgeMelee = peer.lastMelee = false; peer.edgeReload = peer.lastReload = false; peer.edgeGrenade = false; peer.lastGrenade = false;
  peer.actorId = null;
  peer.voiceSession = null;
  peer.playerToken = null;
  this.pendingLoadouts.delete(peerId);
  this.peers.delete(peerId);
  this.ready.delete(peerId);
  this.rematchVotes.delete(peerId);
  for (const voters of this.mapVotes.values()) voters.delete(peerId);
  if (this.phase === 'warmup') { this.phase = 'lobby'; this.warmupTimer = 0; }
  if (this.hostId === peerId) this.hostId = this.nextConnectedHost();
  this.broadcast(this.lobby());
 }
 deliverEvents() {
  let first = Infinity;
  for (const p of this.peers.values()) {
   if (p.disconnectedAt !== null || (p.actorId === null && !p.spectate)) continue;
   if (p.lastSerial < first) first = p.lastSerial;
  }
  if (first === Infinity) return;
  const items = this.match.events.filter(e => e.id > first);
  if (!items.length) return;
  const shared = quantizedCopy(items);
  const newest = shared[shared.length - 1].id;
  for (const p of this.peers.values()) {
   if (p.disconnectedAt !== null || (p.actorId === null && !p.spectate) || p.lastSerial >= newest) continue;
   let index = 0;
   while (shared[index].id <= p.lastSerial) index++;
   // V2 (§11.4/§12.7): team-private COCS events (orders, scans, buys, role
   // bodies) only reach the issuing team; world-observable COCS events and every
   // non-COCS event are unchanged. A peer's serial still advances past the
   // filtered entries, so the shared feed can never drift or replay.
   const view = this.peerCocsView(p);
   const delta = [];
   for (let i = index; i < shared.length; i++) if (cocsEventVisible(shared[i], view)) delta.push(shared[i]);
   p.lastSerial = newest;
   if (delta.length) this.send(p.id, { type: 'events', items: delta });
  }
 }
 tick(dt) {
  if (this.phase === 'warmup') {
   this.warmupTimer -= Math.min(dt, .25);
   if (this.warmupTimer <= 0) {
    this.warmupTimer = 0;
    const host = this.hostId ?? this.nextConnectedHost();
    if (host !== null) this.start(host);
    else { this.phase = 'lobby'; this.lifecycleRevision++; this.broadcast(this.lobby()); }
   }
   return;
  }
  if (!this.match || this.roundOver) return;
  this.tickAcc += Math.min(dt, .25);
  let steps = 0;
  let broadcasted = false;
  let ended = false;
  while (this.tickAcc >= RULES.dt && steps < 5) {
     const inputs = {};
     for (const p of this.peers.values()) if (p.actorId !== null && (p.latest || p.edgeFire || p.edgeJump || p.edgePower || p.edgeInteract || p.edgeReload || p.edgeMelee || p.edgeGrenade)) {
     const ext = { ...(p.latest ?? {}) };
     if (p.edgeFire) { ext.fire = true; p.edgeFire = false; }
    if (p.edgeJump) { ext.jump = true; p.edgeJump = false; }
     if (p.edgePower) { ext.power = true; p.edgePower = false; }
     if (p.edgeInteract) { ext.interact = true; p.edgeInteract = false; }
     if (p.edgeReload) { ext.reload = true; p.edgeReload = false; }
     if (p.edgeMelee) { ext.melee = true; p.edgeMelee = false; }
     if (p.edgeGrenade) { ext.grenade = true; p.edgeGrenade = false; }
    inputs[p.actorId] = ext;
   }
     // Drain the validated wire queue into this one fixed step. There is no
     // Room-side sim loop: `inputs.cocs` is the only entry point (§11.6.2).
     const pendingCocs = this.pendingCocs;
     const cocs = (pendingCocs.orders.length || pendingCocs.spends.length || pendingCocs.terminals.length || pendingCocs.commands.length || pendingCocs.buys.length)
      ? {
       orders: pendingCocs.orders.splice(0, pendingCocs.orders.length),
       spends: pendingCocs.spends.splice(0, pendingCocs.spends.length),
       terminals: pendingCocs.terminals.splice(0, pendingCocs.terminals.length),
       commands: pendingCocs.commands.splice(0, pendingCocs.commands.length),
       buys: pendingCocs.buys.splice(0, pendingCocs.buys.length),
      }
      : null;
     this.match.step(RULES.dt, cocs ? { inputs, cocs } : { inputs });
     // Settle accepted cards from the sim evidence on every step, not only when
     // a new action was queued: an accepted HOLD/ATTACK must stay `running`
     // until its task completes/expires and a later one-shot must reach `done`.
     this.settleCocsCards(this.match.objectiveState);
    for (const p of this.peers.values()) if (p.actorId !== null && p.latest) p.appliedSeq = p.latestSeq;
   this.tickAcc -= RULES.dt;
   steps++;
    this.broadcastAt += RULES.dt;
     if (!broadcasted && this.broadcastAt >= 1 / this.effectiveSnapshotHz()) {
      broadcasted = true; this.broadcastAt = 0;
      const rawState = this.wireState();
      const seq = ++this.seq;
      const acks = {};
      for (const p of this.peers.values()) if (p.actorId !== null) acks[p.actorId] = p.appliedSeq;
      const keyframe = this.keyframeEvery > 0 && seq % this.keyframeEvery === 0;
      // V2 per-team filtering (§11.4/§12.7): the content depends only on the
      // recipient's view (team 0, team 1, or spectator), so at most three frames
      // and three delta chains are built per broadcast. Every peer on the same
      // view shares one patch; a peer whose base is the previous frame of its
      // own view gets it, everyone else gets the filtered full snapshot.
      const viewFrames = new Map();
      const frameFor = view => {
       let frame = viewFrames.get(view);
       if (frame) return frame;
       const state = filterCocsSnapshot(rawState, view);
       const prev = this.lastViewSnapshots.get(view) ?? null;
       let patch = null;
       if (!keyframe && prev) {
        patch = snapshotDelta(prev.state, state);
        if (patch && wireSize({ type: MESSAGE.SNAPSHOT_DELTA, seq, base: prev.seq, acks, patch }) + SNAPSHOT_DELTA_MIN_BYTES >= wireSize({ type: MESSAGE.SNAPSHOT, seq, acks, state })) patch = null;
       }
       frame = { state, prev, patch };
       viewFrames.set(view, frame);
       return frame;
      };
      for (const p of this.peers.values()) {
       const frame = frameFor(this.peerCocsView(p));
       const canDelta = !!frame.patch && p.deltaVersion >= SNAPSHOT_DELTA_VERSION && frame.prev && p.snapshotBase?.seq === frame.prev.seq;
       if (canDelta) { this.send(p.id, { type: MESSAGE.SNAPSHOT_DELTA, v: PROTOCOL_VERSION, seq, base: frame.prev.seq, acks, patch: frame.patch }); this.deltaFrames++; }
       else { this.send(p.id, { type: MESSAGE.SNAPSHOT, v: PROTOCOL_VERSION, seq, acks, state: frame.state }); this.fullFrames++; }
       p.snapshotBase = { seq, state: frame.state };
      }
      for (const [view, frame] of viewFrames) this.lastViewSnapshots.set(view, { seq, state: frame.state });
      this.lastSnapshot = { seq, state: rawState };
     }
     if (this.match.over) { ended = true; break; }
  }
  this.deliverEvents();
  if (ended) {
   this.roundOver = true;
   this.phase = 'results';
   this.lifecycleRevision++;
   // A settled match expires every still-accepted card so the final board never
   // shows a permanent in-flight row.
   this.settleCocsCards(this.match.objectiveState, {ended: true});
   const result = this.match.snapshot();
   this.lastResult = result;
   const mode = this.match.config.mode;
    try { this.history?.record({ roomId: this.id, mapId: this.match.arena.id, config: this.match.config, time: this.match.time, actors: result.actors, teamScores: result.teamScores, winner: result.winner, endingReason: result.overReason ?? null, result }); }
   catch {}
   if (this.progression) {
    for (const p of this.peers.values()) {
     if (!p.playerId || p.actorId === null || p.spectate) continue;
     const actor = result.actors.find(a => a.id === p.actorId);
     const win = actorWon(result, mode, actor);
     try { const award = this.progression.awardOwned(p.playerId, p.playerToken, { win, actor, mode }); if (award) this.send(p.id, { type: 'progression', ...award }); }
     catch {}
    }
   }
   this.sendResults(result);
  }
 }
}
