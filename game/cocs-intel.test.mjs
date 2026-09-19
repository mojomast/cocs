// LATTICE STRIKE V2 per-team snapshot filtering (§11.4/§12.7): pure-module
// contract. Proves the field table (team maps/arrays/blocks), determinism, no
// mutation, spectator redaction, offline/local isolation, delta round-trips,
// event visibility and that the client tolerates redacted sections without
// changing reconciliation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {NetClient, NetHarness} from './net.mjs';
import {snapshotDelta,applySnapshotDelta} from './protocol.mjs';
import {COCS_FILTER_RULES,COCS_PUBLIC_EVENTS,filterCocsSnapshot,cocsEventVisible,filterCocsEvents} from './cocs-intel.mjs';

const seeded = (seed = 7) => { let n = seed; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const clone = value => JSON.parse(JSON.stringify(value));
const keysOf = value => Object.keys(value ?? {}).sort();

// A real PvP `cocs` snapshot with every team-scoped shape populated. Mutating
// the returned snapshot is safe: `Match.snapshot()` builds fresh objects.
function pvpSnapshot(seed = 7) {
 const match = new Match('chatgpt', 'openclaw', seeded(seed), 'lattice-slice', {mode: 'cocs', humanCount: 4, botCount: 4, timeLimit: 600});
 // Personal REQ fields ship on the actor itself (§11.3): seed them so the
 // filter's actor-wallet rule is exercised with real teams.
 match.actors[0].req = 42; match.actors[0].reqSpent = 12; match.actors[0].reqBuff = 'haste';
 match.actors[0].ordersCompleted = 3; match.actors[0].ordersOptOut = true;
 match.actors[1].req = 7; match.actors[1].reqSpent = 1;
 const snap = match.snapshot();
 const cocs = snap.cocs;
 cocs.flux = {0: 11, 1: 22};
 cocs.fluxIncome = {0: 1, 1: 2};
 cocs.fluxUpkeep = {0: 0.1, 1: 0.2};
 cocs.fluxSpent = {0: 3, 1: 4};
 cocs.neglect = {0: 0, 1: 0.5};
 cocs.scoutStats = {0: {spawned: 1, killed: 0}, 1: {spawned: 2, killed: 1}};
 cocs.scans = {0: {nodeId: 'scan-0'}, 1: {nodeId: 'scan-1'}};
 cocs.intel = {0: {team: 0, flux: 11}, 1: {team: 1, flux: 22}};
 cocs.contacts = {0: [{id: 0, team: 0}], 1: [{id: 1, team: 1}]};
 cocs.roleBoard = {0: {team: 0, agents: []}, 1: {team: 1, agents: []}};
 cocs.commander = {
  seat: {0: 'peer-0', 1: 'peer-1'},
  votes: {0: 1, 1: 2},
  route: {0: 'balanced', 1: 'smart'},
  policy: {0: 'hold-first', 1: 'all-in'},
 };
 cocs.spots = [{id: 0, team: 0, x: 1, z: 1}, {id: 1, team: 1, x: 2, z: 2}];
 cocs.scouts = [{id: 0, team: 0, node: 'n0'}, {id: 1, team: 1, node: 'n1'}];
 cocs.sabotage = [{nodeId: 'n0', team: 0}, {nodeId: 'n1', team: 1}];
 cocs.cards = [{id: 'card-0', team: 0, state: 'running'}, {id: 'card-1', team: 1, state: 'running'}, {id: 'card-room'}];
 cocs.fieldSupport = {
  actors: {0: {channel: 1}, 1: {channel: 2}},
  recipients: {0: {cleanseUntil: 1}, 1: {cleanseUntil: 2}},
  nodes: {n0: {deliveryUntil: 3}},
  intel: {0: {1: {x: 5, z: 5}}, 1: {0: {x: 6, z: 6}}},
 };
 return snap;
}

function coopSnapshot(seed = 3) {
 const match = new Match('chatgpt', 'openclaw', seeded(seed), 'warfront', {mode: 'cocs-coop', humanCount: 4, botCount: 2, timeLimit: 900});
 const snap = match.snapshot();
 snap.cocs.command = {
  humans: 2, slicePerPlayer: 30, executor: 'peer-0', leaseUntil: 100, threads: {used: 1, cap: 3},
  slices: [{id: snap.actors[0].id, remaining: 30, spent: 0}, {id: 4096, remaining: 20, spent: 10}],
  lease: {executor: 'peer-0', requests: [{peerId: 'peer-0', tick: 1}]},
  flux: 120, spent: {'peer-0': 10},
  seat: {0: 'peer-0', 1: null}, votes: {0: [], 1: []}, route: {0: 'balanced', 1: null}, policy: {0: 'hold', 1: null},
 };
 snap.cocs.roles = {threads: {used: 1, cap: 3}, agents: [{id: snap.actors[0].id, team: 0}, {id: 4096, team: 1}]};
 snap.cocs.flux = {0: 120, 1: 90};
 return snap;
}

test('the field table is deep-frozen and documents every rule kind', () => {
 assert.ok(Object.isFrozen(COCS_FILTER_RULES));
 for (const rule of COCS_FILTER_RULES) {
  assert.ok(Object.isFrozen(rule), `rule ${rule.path} frozen`);
  assert.ok(typeof rule.path === 'string' && rule.path.length > 0);
  assert.ok(['team-map', 'team-array', 'actor-array', 'actor-map', 'team-block'].includes(rule.kind), `${rule.path} kind`);
 }
 assert.ok(Object.isFrozen(COCS_PUBLIC_EVENTS));
 assert.equal(COCS_PUBLIC_EVENTS.includes('cocs-capture'), true);
});

test('team 1 never sees team-0 private sections and keeps its own plus shared fields', () => {
 const snapshot = pvpSnapshot();
 const before = JSON.stringify(snapshot);
 const filtered = filterCocsSnapshot(snapshot, 1);
 assert.notEqual(filtered, snapshot, 'a cocs snapshot is copied, never mutated in place');
 assert.equal(JSON.stringify(snapshot), before, 'the authoritative snapshot is untouched');

 // Every team map is reduced to the recipient key.
 for (const path of ['flux', 'fluxIncome', 'fluxUpkeep', 'fluxSpent', 'neglect', 'scoutStats', 'scans', 'intel', 'contacts', 'roleBoard']) {
  assert.deepEqual(keysOf(filtered.cocs[path]), ['1'], `${path} keeps only team 1`);
  assert.deepEqual(filtered.cocs[path][1], snapshot.cocs[path][1], `${path}[1] passes through`);
 }
 for (const path of ['seat', 'votes', 'route', 'policy']) {
  assert.deepEqual(keysOf(filtered.cocs.commander[path]), ['1'], `commander.${path} keeps only team 1`);
  assert.deepEqual(filtered.cocs.commander[path][1], snapshot.cocs.commander[path][1]);
 }
 assert.deepEqual(keysOf(filtered.cocs.fieldSupport.intel), ['1']);
 assert.deepEqual(keysOf(filtered.cocs.fieldSupport.actors), ['1'], 'enemy actor memory removed');
 assert.deepEqual(keysOf(filtered.cocs.fieldSupport.recipients), ['1']);
 assert.deepEqual(filtered.cocs.fieldSupport.nodes, snapshot.cocs.fieldSupport.nodes, 'node memory is world-observable');

 // Team-tagged arrays drop every enemy entry (and untagged room entries).
 assert.deepEqual(filtered.cocs.spots.map(entry => entry.team), [1]);
 assert.deepEqual(filtered.cocs.scouts.map(entry => entry.team), [1]);
 assert.deepEqual(filtered.cocs.sabotage.map(entry => entry.team), [1]);
 assert.deepEqual(filtered.cocs.cards.map(card => card.id), ['card-1'], 'the enemy order feed is gone');

 // Actor arrays keep only actors on the recipient team (team 1 = odd seat ids
 // for this map's seat assignment).
 const team1 = new Set(snapshot.actors.filter(actor => actor.team === 1).map(actor => actor.id));
 assert.ok(team1.size > 0);
 assert.deepEqual(filtered.cocs.req.map(entry => entry.id).sort((a, b) => a - b), [...team1].sort((a, b) => a - b));

 // Shared truth arrives unchanged.
 for (const key of ['tick', 'nodes', 'scores', 'liveNodeIds', 'winner', 'fluxCap', 'orderStats', 'scoutCap', 'scanRadius', 'spotSeconds', 'spotBonus', 'traversal', 'rung']) {
  assert.deepEqual(filtered.cocs[key], snapshot.cocs[key], `${key} passes through`);
 }
 // Enemy actor wallets are stripped; own-team wallets survive.
 const actor0 = snapshot.actors.find(actor => actor.team === 0);
 const actor1 = snapshot.actors.find(actor => actor.team === 1);
 const wireTeam0 = filtered.actors.find(actor => actor.id === actor0.id);
 const wireTeam1 = filtered.actors.find(actor => actor.id === actor1.id);
 assert.equal(wireTeam1.req, 7, 'own wallet passes through');
 assert.equal(wireTeam1.reqSpent, 1);
 assert.equal('req' in wireTeam0, false, 'enemy wallet is removed');
 assert.equal('reqBuff' in wireTeam0, false);
 assert.equal('ordersCompleted' in wireTeam0, false);
 assert.equal('ordersOptOut' in wireTeam0, false);
 assert.equal(actor0.x, wireTeam0.x, 'world fields still pass through');
 const spectator = filterCocsSnapshot(snapshot, null);
 assert.ok(spectator.actors.every(actor => !('req' in actor) && !('reqBuff' in actor)), 'spectators see no wallets');
 const untouched = clone(snapshot);
 delete untouched.actors[0].req; delete untouched.actors[0].reqSpent; delete untouched.actors[0].reqBuff;
 delete untouched.actors[0].ordersCompleted; delete untouched.actors[0].ordersOptOut; delete untouched.actors[1].req; delete untouched.actors[1].reqSpent;
 assert.equal(filterCocsSnapshot(untouched, 1).actors, untouched.actors, 'no REQ fields means the actor array passes by reference');
});

test('team 0 never sees team-1 private sections (symmetric)', () => {
 const snapshot = pvpSnapshot();
 const filtered = filterCocsSnapshot(snapshot, 0);
 assert.deepEqual(keysOf(filtered.cocs.intel), ['0']);
 assert.deepEqual(filtered.cocs.spots.map(entry => entry.team), [0]);
 assert.deepEqual(filtered.cocs.cards.map(card => card.id), ['card-0']);
 assert.deepEqual(keysOf(filtered.cocs.commander.seat), ['0']);
 assert.equal(filtered.cocs.commander.seat[0], 'peer-0');
 assert.deepEqual(keysOf(filtered.cocs.fieldSupport.intel), ['0']);
});

test('the spectator view is public-only for both teams', () => {
 const snapshot = pvpSnapshot();
 const filtered = filterCocsSnapshot(snapshot, null);
 for (const path of ['flux', 'fluxIncome', 'fluxUpkeep', 'fluxSpent', 'neglect', 'scoutStats', 'scans', 'intel', 'contacts', 'roleBoard']) {
  assert.deepEqual(filtered.cocs[path], {}, `${path} is empty for a spectator`);
 }
 for (const path of ['seat', 'votes', 'route', 'policy']) assert.deepEqual(filtered.cocs.commander[path], {});
 for (const path of ['spots', 'scouts', 'sabotage', 'cards', 'req']) assert.deepEqual(filtered.cocs[path], [], `${path} is empty for a spectator`);
 assert.deepEqual(filtered.cocs.fieldSupport.intel, {});
 assert.deepEqual(filtered.cocs.fieldSupport.actors, {});
 assert.deepEqual(filtered.cocs.nodes, snapshot.cocs.nodes, 'shared lattice truth still arrives');
 assert.deepEqual(filtered.cocs.scores, snapshot.cocs.scores);
 // Unknown teams are spectators too.
 assert.deepEqual(filterCocsSnapshot(snapshot, 9).cocs.intel, {});
 assert.deepEqual(filterCocsSnapshot(snapshot, '1').cocs.intel, {});
});

test('the co-op command block is team 0 only and its per-team maps are filtered', () => {
 const snapshot = coopSnapshot();
 const team0 = filterCocsSnapshot(snapshot, 0).cocs;
 assert.ok(team0.command, 'team 0 keeps the OPERATIONS command board');
 assert.deepEqual(keysOf(team0.command.seat), ['0']);
 assert.deepEqual(keysOf(team0.command.votes), ['0']);
 assert.deepEqual(keysOf(team0.command.route), ['0']);
 assert.deepEqual(keysOf(team0.command.policy), ['0']);
 assert.deepEqual(team0.command.slices.map(entry => entry.id), [snapshot.actors[0].id]);
 assert.deepEqual(team0.roles.agents.map(entry => entry.team), [0]);
 const team1 = filterCocsSnapshot(snapshot, 1).cocs;
 assert.equal(team1.command, null, 'team 1 gets the redacted command board shape');
 assert.equal(filterCocsSnapshot(snapshot, null).cocs.command, null, 'spectators get no command board');
});

test('filtering is deterministic and never mutates its input', () => {
 const snapshot = pvpSnapshot();
 const before = JSON.stringify(snapshot);
 const first = JSON.stringify(filterCocsSnapshot(snapshot, 1));
 const second = JSON.stringify(filterCocsSnapshot(snapshot, 1));
 assert.equal(first, second, 'identical inputs produce identical bytes');
 assert.equal(JSON.stringify(snapshot), before);
 const coop = coopSnapshot();
 const coopBefore = JSON.stringify(coop);
 assert.equal(JSON.stringify(filterCocsSnapshot(coop, 0)), JSON.stringify(filterCocsSnapshot(coop, 0)));
 assert.equal(JSON.stringify(coop), coopBefore);
});

test('offline/local play is untouched: no-cocs snapshots pass by identity', () => {
 const ffa = new Match('chatgpt', 'openclaw', seeded(4), 'crosswire', {mode: 'deathmatch', humanCount: 4, botCount: 4, timeLimit: 300});
 const snapshot = ffa.snapshot();
 assert.equal(snapshot.cocs, undefined);
 assert.equal(filterCocsSnapshot(snapshot, 0), snapshot, 'non-COCS state is returned by identity');
 // A local COCS match is also untouched even when the filter is invoked on its
 // snapshots: solo play never routes through the server seam.
 const local = new Match('chatgpt', 'openclaw', seeded(5), 'lattice-slice', {mode: 'cocs', humanCount: 1, botCount: 7, timeLimit: 600});
 const localBefore = JSON.stringify(local.snapshot());
 filterCocsSnapshot(local.snapshot(), 0);
 filterCocsSnapshot(local.snapshot(), null);
 for (let i = 0; i < 60; i++) local.step(1 / 60, {inputs: {}});
 const firstOffline = JSON.stringify(local.snapshot());
 filterCocsSnapshot(local.snapshot(), 1);
 assert.equal(JSON.stringify(local.snapshot()), firstOffline, 'filtering never advances or mutates the local sim');
 assert.ok(localBefore.length > 0);
});

test('filtered views still round-trip through snapshot deltas', () => {
 const match = new Match('chatgpt', 'openclaw', seeded(6), 'lattice-slice', {mode: 'cocs', humanCount: 2, botCount: 2, timeLimit: 600});
 const base = filterCocsSnapshot(match.snapshot(), 1);
 for (let i = 0; i < 30; i++) match.step(1 / 60, {inputs: {}});
 const next = filterCocsSnapshot(match.snapshot(), 1);
 const patch = snapshotDelta(base, next);
 assert.ok(patch, 'positions/timers changed, so a patch exists');
 const rebuilt = applySnapshotDelta(base, patch);
 assert.deepEqual(rebuilt, next, 'team-1 delta chain rebuilds the filtered state');
 assert.deepEqual(Object.keys(rebuilt.cocs.intel), ['1'], 'the rebuilt state stays redacted');
});

test('team-tagged COCS events are private; public and non-COCS events are shared', () => {
 assert.equal(cocsEventVisible({type: 'cocs-order', team: 0}, 0), true);
 assert.equal(cocsEventVisible({type: 'cocs-order', team: 0}, 1), false);
 assert.equal(cocsEventVisible({type: 'cocs-buy', team: 1}, null), false, 'spectators see no private events');
 assert.equal(cocsEventVisible({type: 'cocs-capture', team: 0}, 1), true, 'lost/secure earcons stay shared');
 assert.equal(cocsEventVisible({type: 'cocs-terminal-hack', team: 1}, 0), true);
 assert.equal(cocsEventVisible({type: 'cocs-role-spawn', team: 0}, 1), false);
 assert.equal(cocsEventVisible({type: 'cocs-role-rally', actor: 3}, 1), true, 'untagged world events stay shared');
 assert.equal(cocsEventVisible({type: 'death', actor: 1}, null), true);
 assert.equal(cocsEventVisible({type: 'zone-progress', team: 1}, 0), true, 'non-COCS feeds are never filtered');
 assert.deepEqual(filterCocsEvents([{type: 'cocs-order', team: 0}, {type: 'cocs-capture', team: 0}, {type: 'death'}], 1).map(e => e.type), ['cocs-capture', 'death']);
});

test('NetClient tolerates redacted sections and reconciliation rules are unchanged', () => {
 const client = new NetClient();
 client.cocsPending.set('mine', {cardId: 'mine', kind: 'order'});
 // A filtered snapshot with no card board must not drop the optimistic card.
 assert.doesNotThrow(() => client.onMessage(JSON.stringify({type: 'snapshot', seq: 1, acks: {}, state: {time: 0, actors: [], cocs: {intel: {}, spots: []}}})));
 assert.ok(client.cocsPending.has('mine'), 'an absent board leaves the card pending');
 assert.doesNotThrow(() => client.onMessage(JSON.stringify({type: 'snapshot', seq: 2, acks: {}, state: null})));
 // The own authoritative card still clears it.
 client.onMessage(JSON.stringify({type: 'snapshot', seq: 3, acks: {}, state: {time: 1, actors: [], cocs: {cards: [{id: 'mine', state: 'running'}]}}}));
 assert.equal(client.cocsPending.has('mine'), false, 'a visible own card still reconciles');
 // `cocs-reject` is the clearing path for a card the filter hides.
 client.onMessage(JSON.stringify({type: 'cocs-reject', cardId: 'other', reason: 'rate-limit'}));
 assert.equal(client.cocsBlockers.get('other')?.reason, 'rate-limit');
});

test('prediction and reconciliation are unchanged with a LATTICE match', () => {
 const harness = new NetHarness({mapId: 'lattice-slice', config: {mode: 'cocs', humanCount: 1, botCount: 4, timeLimit: 120}, seed: 17, latency: 3, delta: true, keyframeEvery: 5});
 for (let i = 0; i < 180; i++) harness.step({forward: 1, right: i % 4 === 0 ? 1 : 0, jump: i === 40});
 harness.flush();
 assert.ok(harness.divergence() < 1e-6, `shadow converged (${harness.divergence()})`);
 assert.ok(harness.stats.deltaFrames > 0, 'deltas still flow');
});
