import test from 'node:test';
import assert from 'node:assert/strict';
import {Room} from './room.mjs';
import {RULES} from '../game/data.mjs';
import {Match} from '../game/core.mjs';

function harness(mode = 'cocs') {
  const room = new Room('squads', () => 0.5);
  for (let id = 1; id <= 4; id++) room.join(id, `P${id}`, 'chatgpt', 'openclaw');
  room.host(1, {mode, botCount: 0, timeLimit: 900}, 'lattice-slice');
  room.start(1);
  room.drain();
  let seq = 0;
  const send = (peer, action, value = null, extra = {}) => {
    const cardId = `squad-test-${++seq}`;
    // Spread requests across rate buckets; these tests exercise authority.
    const ok = room.command(peer, {cardId, action, value, ...extra}, seq * 1001);
    return {ok, cardId};
  };
  const step = () => room.tick(RULES.dt);
  return {room, send, step};
}

for (const mode of ['cocs', 'cocs-coop']) {
  test(`${mode}: wire squad lifecycle is confirmed by sim results, including retry and reconnect`, () => {
    const {room, send, step} = harness(mode);
    let allyPeer = mode === 'cocs' ? 3 : 2;
    const first = send(1, 'squad-create', 'Vanguard');
    assert.equal(first.ok, true);
    assert.equal(room.match.objectiveState.squads, undefined, 'enqueue is not optimistic membership');
    step();
    const state = room.match.objectiveState;
    const squad = state.squads.list[0];
    assert.equal(room.cocsCards.get(first.cardId).state, 'done');
    assert.equal(room.command(1, {cardId: first.cardId, action: 'squad-create', value: 'Vanguard'}, 10000), true);
    assert.equal(state.squads.list.length, 1, 'retry does not create a second squad');
    assert.equal(send(allyPeer, 'squad-join', squad.id).ok, true);
    step();
    const allyId = String(room.peers.get(allyPeer).actorId);
    assert.deepEqual(squad.members, ['0', allyId]);
    assert.equal(send(allyPeer, 'squad-remove', '0').ok, false);
    assert.equal(send(1, 'squad-promote', allyId).ok, true);
    step();
    assert.equal(squad.leader, allyId);
    const peer = room.peers.get(allyPeer);
    room.disconnect(allyPeer);
    allyPeer = 20;
    room.join(allyPeer, peer.name, peer.character, peer.harness, peer.token);
    assert.equal(room.peers.get(allyPeer).actorId, Number(allyId));
    assert.deepEqual(room.wireState().cocs.squadBoard[0].squads[0].members, ['0', allyId], 'membership survives reconnect');
    assert.equal(send(allyPeer, 'squad-leave').ok, true);
    step();
    assert.equal(squad.leader, '0');
    assert.equal(send(1, 'squad-leave').ok, true);
    step();
    assert.deepEqual(state.squads.list, []);
  });
}

test('wire identity is bound to the sender; enemy, spectator and unknown peer commands are refused', () => {
  const {room, send, step} = harness();
  send(1, 'squad-create', 'Alpha');
  send(2, 'squad-create', 'Enemy');
  send(2, 'take');
  step();
  const squads = room.match.objectiveState.squads.list;
  const allied = squads.find(squad => squad.team === 0);
  assert.equal(send(2, 'squad-join', allied.id, {team: 0, peerId: '0', actorId: 0}).ok, false);
  assert.equal(send(2, 'squad-promote', '0', {team: 0}).ok, false);
  assert.equal(send(2, 'squad-remove', '0', {team: 0}).ok, false);
  assert.deepEqual(allied.members, ['0']);
  room.peers.get(3).spectate = true;
  assert.equal(send(3, 'take').ok, false);
  assert.equal(send(99, 'take').ok, false);
  assert.equal(send(1, 'policy', 'FORTIFY').ok, false);
  assert.equal(send(1, 'set-route', 'hub').ok, false);
});

test('commands recheck authority at apply time and settle losing seat races as blocked', () => {
  const {room, send, step} = harness();
  const first = send(1, 'take');
  const racing = send(3, 'take');
  assert.equal(first.ok, true);
  assert.equal(racing.ok, true);
  step();
  assert.equal(room.match.objectiveState.command.seat[0], '0');
  assert.equal(room.cocsCards.get(first.cardId).state, 'done');
  assert.equal(room.cocsCards.get(racing.cardId).state, 'blocked');
  assert.equal(room.cocsCards.get(racing.cardId).reason, 'seat-occupied');
  const release = send(1, 'release');
  const stale = send(1, 'policy', 'FORTIFY');
  assert.equal(release.ok, true);
  assert.equal(stale.ok, true);
  // Explicit sort keys model a release that reaches the sim before the stance.
  room.pendingCocs.commands.find(command => command.cardId === release.cardId).tick = -1;
  step();
  assert.equal(room.cocsCards.get(stale.cardId).reason, 'not-commander');
  assert.equal(room.match.objectiveState.command.policy[0], null);
});

test('local Match.step uses the same squad commands and returns snapshot confirmation', () => {
  const match = new Match('chatgpt', 'openclaw', () => 0.5, 'lattice-slice', {mode: 'cocs-coop', humanCount: 2, botCount: 0});
  const issue = (peerId, action, value, cardId) => match.step(RULES.dt, {cocs: {commands: [{peerId, team: 0, action, value, cardId, tick: match.objectiveState.tick}]}});
  issue('0', 'squad-create', 'Local', 'create');
  const squad = match.snapshot().cocs.squadBoard[0].squads[0];
  issue('1', 'squad-join', squad.id, 'join');
  issue('1', 'squad-remove', '0', 'bad');
  const snap = match.snapshot().cocs;
  assert.deepEqual(snap.squadBoard[0].squads[0].members, ['0', '1']);
  assert.equal(snap.commandResults.find(result => result.cardId === 'join').ok, true);
  assert.equal(snap.commandResults.find(result => result.cardId === 'bad').reason, 'not-leader');
});
