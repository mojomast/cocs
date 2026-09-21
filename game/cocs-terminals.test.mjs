import test from 'node:test';
import assert from 'node:assert/strict';
import {RULES} from './data.mjs';
import {createTerminalState, terminalInteract, terminalActionGate, stepCocsTerminals, terminalMechanicsSnapshot, humanTerminalInteract} from './cocs-terminals.mjs';
import {connectedToHq, cocsHumanInteract} from './cocs.mjs';
import {coopPrimeNode} from './cocs-coop.mjs';

// Pure objective fixture: no Match, navigation, renderer, Director or RNG draws.
function fixture() {
  const make = (id, archetype, owner, x) => ({id, archetype, owner, x, y: 0, z: 0, r: 8, live: true, contested: false, progress: {0: 0, 1: 0}});
  const state = {kind: 'cocs', tick: 0, nodes: [make('hq-0', 'hq', 0, -30), make('relay', 'relay', null, 0), make('econ', 'economy', 0, -60), make('hq-1', 'hq', 1, 30)],
    adjacency: {'hq-0': ['relay', 'econ'], relay: ['hq-0', 'hq-1'], econ: ['hq-0'], 'hq-1': ['relay']}, cuts: [], flux: {0: 100, 1: 100}, fluxSpent: {0: 0, 1: 0}, spots: {}};
  state.terminals = createTerminalState(state);
  const actor = {id: 17, team: 0, x: 0, y: 0, z: 0, health: 100, armor: 0, deaths: 0, req: 0, bot: null};
  const enemy = {...actor, id: 29, team: 1, x: 100};
  const events = [];
  const match = {actors: [actor, enemy], objectiveState: state, emit: (type, payload) => events.push({type, ...payload}), random: () => { throw Error('objective RNG drift'); }, visible: () => true};
  const at = id => state.terminals.terminals[id];
  const advance = seconds => { for (let i = 0; i < Math.ceil(seconds / RULES.dt); i++) { state.tick++; stepCocsTerminals(match, state, RULES.dt); } };
  return {state, match, actor, enemy, events, at, advance, relay: state.nodes[1]};
}

test('HACK has exclusive channel ownership, legal adjacency and a non-refreshable effect window', () => {
  const f = fixture(), {state, match, actor, enemy, at, advance, relay} = f;
  state.adjacency.relay = ['hq-1'];
  assert.equal(terminalInteract(match, state, actor.id, 'hack-relay').reason, 'adjacency');
  state.adjacency.relay.push('hq-0');
  assert.equal(terminalInteract(match, state, actor.id, 'hack-relay').ok, true);
  enemy.team = 0; enemy.x = 0;
  assert.equal(terminalInteract(match, state, enemy.id, 'hack-relay').reason, 'busy');
  advance(3 + RULES.dt);
  assert.equal(relay.hack.team, 0);
  assert.equal(relay.hack.multiplier, 2);
  assert.equal(terminalInteract(match, state, actor.id, 'hack-relay').reason, 'cooldown');
  assert.ok(terminalMechanicsSnapshot(state, at('hack-relay')).cooldownSeconds > 5);
  advance(6 + RULES.dt);
  assert.equal(relay.hack, null);
  assert.equal(terminalInteract(match, state, actor.id, 'hack-relay').ok, true);
});

test('contest, changed owner and vertical range interrupt without awarding an effect', () => {
  const {state, match, actor, enemy, relay, at, advance, events} = fixture();
  relay.owner = 0;
  terminalInteract(match, state, actor.id, 'deploy-relay');
  advance(1);
  enemy.x = 1;
  advance(RULES.dt);
  assert.equal(at('deploy-relay').channel, null);
  assert.equal(relay.oracle, undefined);
  assert.equal(events.at(-1).reason, 'contested');
  const snap = terminalMechanicsSnapshot(state, at('deploy-relay'));
  assert.equal(snap.contested, true);
  assert.deepEqual(snap.actionsByTeam[0], []);
  enemy.x = 100;
  terminalInteract(match, state, actor.id, 'deploy-relay');
  relay.owner = 1;
  advance(RULES.dt);
  assert.equal(at('deploy-relay').channel, null);
  assert.equal(events.at(-1).reason, 'not-owned');
  actor.y = 6;
  assert.equal(terminalInteract(match, state, actor.id, 'hack-relay').reason, 'range');
});

test('ORACLE resolves local intel only while connected, preserves stronger spots, and is lost on capture', () => {
  const {state, match, actor, enemy, relay, advance} = fixture();
  relay.owner = 0;
  terminalInteract(match, state, actor.id, 'deploy-relay');
  advance(2 + RULES.dt);
  actor.x = -30; enemy.x = 7;
  advance(RULES.dt);
  assert.equal(relay.oracle.active, true);
  assert.deepEqual(relay.oracle.targets, [enemy.id]);
  assert.equal(state.spots[enemy.id].intelOnly, true);
  state.spots[enemy.id] = {team: 0, until: state.tick + 600, by: actor.id};
  advance(RULES.dt);
  assert.equal(state.spots[enemy.id].intelOnly, undefined, 'ORACLE must not downgrade SCOUT');
  delete state.spots[enemy.id];
  match.visible = () => false;
  advance(RULES.dt);
  assert.deepEqual(relay.oracle.targets, []);
  match.visible = () => true;
  state.cuts.push('relay');
  advance(RULES.dt);
  assert.equal(relay.oracle.active, false);
  assert.equal(state.spots[enemy.id], undefined);
  state.cuts = []; relay.owner = 1;
  advance(RULES.dt);
  assert.equal(relay.oracle, null);
});

test('DEPLOY → physical VAULT delivery → finite bank withdrawal conserves the shard and published economy', () => {
  const {state, match, actor, relay, at, advance} = fixture();
  actor.x = -30;
  assert.equal(terminalInteract(match, state, actor.id, 'vault-hq-0', 'VAULT', 'store').reason, 'no-shard');
  assert.equal(terminalInteract(match, state, actor.id, 'vault-hq-0', 'VAULT', 'pull').reason, 'empty');
  relay.owner = 0; actor.x = 0;
  terminalInteract(match, state, actor.id, 'deploy-relay');
  advance(2 + RULES.dt);
  assert.equal(state.terminals.vault.cargo[actor.id].source, 'deploy-relay');
  assert.equal(at('deploy-relay').shards[0], 'carried');
  actor.x = 30;
  assert.equal(terminalInteract(match, state, actor.id, 'vault-hq-1', 'VAULT', 'store').reason, 'not-owned');
  actor.x = -30;
  assert.equal(humanTerminalInteract(match, state, actor).action, 'store');
  assert.equal(state.terminals.vault.cargo[actor.id], undefined);
  assert.equal(terminalMechanicsSnapshot(state, at('vault-hq-0')).banked[0], 1);
  state.flux[0] = 7;
  assert.equal(terminalInteract(match, state, actor.id, 'vault-hq-0', 'VAULT', 'pull').reason, 'flux');
  assert.equal(at('deploy-relay').shards[0], 'banked');
  state.flux[0] = 8;
  assert.equal(humanTerminalInteract(match, state, actor).action, 'pull');
  assert.equal(state.flux[0], 0);
  assert.equal(state.fluxSpent[0], 8);
  assert.equal(actor.req, 6);
  assert.equal(actor.reqEarned, 6);
  assert.equal(at('deploy-relay').shards[0], 'spent');
  relay.owner = 1; advance(RULES.dt); relay.owner = 0; actor.x = 0;
  terminalInteract(match, state, actor.id, 'deploy-relay'); advance(2 + RULES.dt);
  assert.equal(state.terminals.vault.cargo[actor.id], undefined, 'ownership cycling cannot mint shards');
});

test('death returns a courier shard to its source for collection; bots leave recoverable cargo', () => {
  const {state, match, actor, relay, at, advance} = fixture();
  relay.owner = 0; actor.bot = {};
  terminalInteract(match, state, actor.id, 'deploy-relay'); advance(2 + RULES.dt);
  assert.equal(at('deploy-relay').shards[0], 'ready');
  assert.equal(state.terminals.vault.cargo[actor.id], undefined);
  actor.bot = null;
  assert.equal(terminalInteract(match, state, actor.id, 'deploy-relay').action, 'collect');
  actor.deaths++; advance(RULES.dt);
  assert.equal(at('deploy-relay').shards[0], 'ready');
  assert.equal(state.terminals.vault.cargo[actor.id], undefined);
  assert.equal(terminalInteract(match, state, actor.id, 'deploy-relay').action, 'collect');
});

test('SABOTAGE denies supply for exactly its authored duration; field repair requires on-site owned channel', () => {
  const {state, match, actor, relay, at, advance} = fixture();
  relay.owner = 0;
  assert.equal(terminalInteract(match, state, actor.id, 'sabotage-relay').reason, 'not-enemy');
  relay.owner = 1;
  assert.equal(connectedToHq(state, relay.id, 1), true);
  terminalInteract(match, state, actor.id, 'sabotage-relay'); advance(3 + RULES.dt);
  assert.equal(connectedToHq(state, relay.id, 1), false);
  advance(45);
  assert.equal(connectedToHq(state, relay.id, 1), true);
  assert.equal(at('sabotage-relay').state, 'live');
  terminalInteract(match, state, actor.id, 'sabotage-relay'); advance(3 + RULES.dt);
  assert.equal(terminalActionGate(match, state, at('sabotage-relay'), actor, 'repair').reason, 'not-owned');
  relay.owner = 0;
  assert.equal(humanTerminalInteract(match, state, actor).action, 'repair');
  advance(2);
  assert.equal(connectedToHq(state, relay.id, 0), false);
  advance(2 + RULES.dt);
  assert.equal(connectedToHq(state, relay.id, 0), true);
  assert.equal(at('sabotage-relay').repairs, 1);
});

test('preflight and snapshots are detached reads with deterministic actor ordering', () => {
  const {state, match, actor, at} = fixture();
  const before = JSON.stringify(state);
  assert.equal(terminalActionGate(match, state, at('hack-relay'), actor, 'hack').ok, true);
  terminalMechanicsSnapshot(state, at('vault-hq-0')).cargo.push({actor: 99});
  assert.equal(JSON.stringify(state), before);
  match.actors.reverse();
  assert.equal(terminalActionGate(match, state, at('hack-relay'), actor, 'hack').ok, true);
});

test('owned economy PRIME is a world interaction with real actor-id lookup and range/contest gates', () => {
  const {state, match, actor, enemy} = fixture();
  state.coop = {roleStats: {primes: 0}};
  assert.equal(coopPrimeNode(match, state, actor, 'econ').reason, 'range');
  actor.x = -60;
  enemy.x = -60;
  assert.equal(coopPrimeNode(match, state, actor, 'econ').reason, 'contested');
  enemy.x = 100;
  assert.deepEqual(cocsHumanInteract(match, state, actor.id), {source: 'node', nodeId: 'econ', kind: 'PRIME', action: 'prime'});
  assert.equal(state.nodes[2].primeChannel.total, 8);
  assert.equal(state.nodes[2].primeChannel.actor, 17);
});
