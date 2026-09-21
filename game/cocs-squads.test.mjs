import test from 'node:test';
import assert from 'node:assert/strict';
import {cocsCommandAction} from './cocs.mjs';
import {coopCommandAction} from './cocs-coop.mjs';
import {COCS_SQUAD_CAPACITY, cocsSquadSnapshot, reconcileCocsSquads} from './cocs-squads.mjs';
import {filterCocsSnapshot} from './cocs-intel.mjs';
import {parseCommandMessage} from './protocol.mjs';

function fixture(coop = false) {
  const match = {actors: Array.from({length: 8}, (_, id) => ({id, name: `P${id}`, team: id < 6 ? 0 : 1, health: 100, bot: null})), emit() {}};
  const state = {kind: 'cocs', tick: 0, nodes: [{id: 'hub'}], command: {seat: {0: null, 1: null}, route: {0: null}, policy: {0: null}}};
  if (coop) state.coop = {commandSeat: {0: null, 1: null}, commandRoute: {0: null}, commandPolicy: {0: null}};
  const apply = coop ? coopCommandAction : cocsCommandAction;
  const command = (id, action, value = null, extra = {}) => apply(match, state, {peerId: String(id), team: match.actors[id]?.team ?? 0, action, value, ...extra});
  return {match, state, command};
}

for (const coop of [false, true]) {
  const mode = coop ? 'Operations' : 'PvP';
  test(`${mode}: identity and command ownership are enforced inside the sim`, () => {
    const {match, state, command} = fixture(coop);
    for (const action of ['take', 'policy', 'set-route', 'squad-create', 'squad-promote', 'squad-remove']) {
      assert.equal(command('missing', action, 'Alpha').reason, 'unauthenticated');
    }
    assert.equal(command(0, 'take', null, {team: 1}).reason, 'wrong-team');
    assert.equal(command(0, 'take', null, {actorId: 1}).reason, 'wrong-actor');
    match.actors[1].bot = {};
    assert.equal(command(1, 'take').reason, 'unauthenticated');
    match.actors[1].bot = null;
    assert.equal(command(0, 'policy', 'FORTIFY').reason, 'not-commander');
    assert.equal(command(0, 'set-route', 'hub').reason, 'not-commander');
    assert.equal(command(0, 'take').ok, true);
    assert.equal(command(1, 'take').reason, 'seat-occupied');
    assert.equal(command(1, 'release').reason, 'not-commander');
    assert.equal(command(1, 'policy', 'ASSAULT').reason, 'not-commander');
    assert.equal(command(1, 'set-route', null).reason, 'not-commander');
    assert.equal(command(0, 'policy', 'fortify').ok, true);
    assert.equal(command(0, 'set-route', 'hub').ok, true);
    assert.equal(command(0, 'release').ok, true);
    assert.equal(command(1, 'take').ok, true);
    assert.equal(command(0, 'set-route', 'hub').reason, 'not-commander', 'old owner loses authority');
    assert.equal(cocsSquadSnapshot(match, state)[0].route, 'hub');
  });

  test(`${mode}: create, capacity, single membership, leader transfer and disband are authoritative`, () => {
    const {match, state, command} = fixture(coop);
    assert.equal(command(0, 'squad-create', '').reason, 'squad-name');
    assert.equal(command(0, 'squad-create', 'A'.repeat(25)).reason, 'squad-name');
    assert.equal(command(0, 'squad-create', 'Alpha').ok, true);
    const squad = state.squads.list[0];
    assert.equal(command(0, 'squad-create', 'Duplicate').reason, 'already-in-squad');
    for (let id = 1; id < COCS_SQUAD_CAPACITY; id++) assert.equal(command(id, 'squad-join', squad.id).ok, true);
    assert.equal(command(4, 'squad-join', squad.id).reason, 'squad-full');
    assert.equal(command(1, 'squad-promote', '2').reason, 'not-leader');
    assert.equal(command(1, 'squad-remove', '2').reason, 'not-leader');
    assert.equal(command(0, 'squad-promote', '1').ok, true);
    assert.equal(command(0, 'squad-remove', '2').reason, 'not-leader', 'promotion revokes the former leader');
    assert.equal(command(1, 'squad-remove', '1').reason, 'use-leave');
    assert.equal(command(1, 'squad-leave').ok, true);
    assert.equal(squad.leader, '0');
    match.actors[0].health = 0;
    reconcileCocsSquads(match, state);
    assert.equal(squad.leader, '0', 'death preserves membership and leadership');
    assert.equal(command(0, 'squad-remove', '2').reason, 'dead');
    match.actors[0].health = 100;
    assert.equal(command(0, 'squad-remove', '2').ok, true);
    assert.equal(command(0, 'squad-remove', '3').ok, true);
    assert.equal(command(0, 'squad-leave').ok, true);
    assert.deepEqual(state.squads.list, []);
  });

  test(`${mode}: mutiny counts only living authenticated human votes`, () => {
    const {match, state, command} = fixture(coop);
    command(0, 'take');
    const votes = coop ? state.coop.commandVotes : state.command.votes;
    votes[0].missing = true;
    votes[0]['6'] = true;
    match.actors[5].health = 0;
    votes[0]['5'] = true;
    assert.equal(command(1, 'mutiny-vote').votes, 1);
    assert.equal(command(1, 'mutiny-vote').votes, 1, 'repeat votes do not increase the count');
    assert.equal(command(2, 'mutiny-vote').votes, 2);
    const carried = command(3, 'mutiny-vote');
    assert.equal(carried.needed, 3);
    assert.equal(carried.seat, '3');
    assert.equal(command(0, 'policy', 'HOLD').reason, 'not-commander');
  });

  test(`${mode}: commanders manage allied squads but cannot touch enemy membership`, () => {
    const {state, command} = fixture(coop);
    command(0, 'squad-create', 'Alpha');
    const squad = state.squads.list[0];
    command(1, 'squad-join', squad.id);
    command(2, 'squad-create', 'Bravo');
    assert.equal(command(2, 'squad-remove', '1').reason, 'not-leader', 'leading another squad grants no power');
    assert.equal(command(3, 'take').ok, true);
    assert.equal(command(3, 'squad-promote', '1').ok, true);
    assert.equal(squad.leader, '1');
    assert.equal(command(3, 'squad-remove', '0').ok, true);
    if (!coop) {
      command(6, 'squad-create', 'Enemy');
      const enemy = state.squads.list.find(entry => entry.team === 1);
      command(6, 'take');
      assert.equal(command(6, 'squad-join', squad.id).reason, 'wrong-team');
      assert.equal(command(6, 'squad-promote', '1').reason, 'wrong-team');
      assert.equal(command(6, 'squad-remove', '1').reason, 'wrong-team');
      assert.equal(command(0, 'squad-join', enemy.id).reason, 'wrong-team');
      assert.equal(command(3, 'squad-remove', '6').reason, 'wrong-team');
    }
  });
}

test('squad cleanup releases bot-replaced leaders and keeps snapshots detached and team-private', () => {
  const {match, state, command} = fixture();
  command(0, 'squad-create', 'Alpha');
  command(1, 'squad-join', state.squads.list[0].id);
  command(6, 'squad-create', 'Enemy');
  command(0, 'take');
  match.actors[0].bot = {};
  reconcileCocsSquads(match, state);
  assert.equal(state.squads.list[0].leader, '1');
  assert.equal(state.command.seat[0], null);
  const board = cocsSquadSnapshot(match, state);
  board[0].squads[0].members.push('fake');
  assert.deepEqual(state.squads.list[0].members, ['1']);
  const snapshot = {actors: match.actors, cocs: {squadBoard: board, commandResults: [{team: 0}, {team: 1}]}};
  const own = filterCocsSnapshot(snapshot, 0).cocs;
  assert.deepEqual(Object.keys(own.squadBoard), ['0']);
  assert.deepEqual(own.commandResults, [{team: 0}]);
  const spectator = filterCocsSnapshot(snapshot, null).cocs;
  assert.deepEqual(spectator.squadBoard, {});
  assert.deepEqual(spectator.commandResults, []);
});

test('new squad actions reuse scalar command values and existing wire identity', () => {
  for (const [action, value] of [['squad-create', 'Alpha'], ['squad-join', 'squad-0-1'], ['squad-leave', null], ['squad-promote', '2'], ['squad-remove', 2]]) {
    const parsed = parseCommandMessage({action, value, roundRev: 2, actionSeq: 4});
    assert.equal(parsed.action, action);
    assert.equal(parsed.value, value);
    assert.equal(parsed.actionSeq, 4);
  }
  assert.equal(parseCommandMessage({action: 'squad-join', value: {id: 'squad-0-1'}}), null);
});
