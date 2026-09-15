import test from 'node:test';
import assert from 'node:assert/strict';
import {Matchmaker, balanceTeams, ratingFor, QUEUE_MAX} from './rooms.mjs';
import {Room, WARMUP_SECONDS, REMATCH_RATIO} from './room.mjs';

function rng(){let n=11;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);}
const find=(msgs,type,to)=>msgs.find(m=>m.msg.type===type&&(to===undefined||m.to===to))?.msg;
const last=(msgs,type)=>[...msgs].reverse().find(m=>m.msg.type===type)?.msg;

test('ratingFor derives a monotonic, bounded rating from a career profile', () => {
 assert.equal(ratingFor(null), 0);
 assert.equal(ratingFor({}), 0);
 const low = ratingFor({xp: 1000, wins: 2, kills: 10});
 const high = ratingFor({xp: 9000, wins: 20, kills: 200});
 assert.ok(high > low);
 assert.equal(ratingFor({xp: -50, wins: -3, kills: -9}), 0);
 assert.ok(Number.isFinite(ratingFor({xp: 'nope', wins: NaN})));
});

test('balanceTeams splits ratings evenly and is deterministic', () => {
 const players = [1000, 800, 600, 400, 200, 0].map((rating, index) => ({peerId: index + 1, rating}));
 const first = balanceTeams(players);
 const again = balanceTeams(players);
 assert.deepEqual(first.teams.map(team => team.map(p => p.peerId)), again.teams.map(team => team.map(p => p.peerId)));
 assert.equal(first.teams[0].length, 3);
 assert.equal(first.teams[1].length, 3);
 assert.equal(first.difference, 200, 'the best 3v3 split of this ladder leaves a 200 gap');
 assert.equal(first.average, 500);
 for (const player of players) assert.ok([...first.teams[0], ...first.teams[1]].some(p => p.peerId === player.peerId));
});

test('balanceTeams keeps the gap minimal when ratings are lopsided', () => {
 const players = [900, 100, 90, 80].map((rating, index) => ({peerId: index + 1, rating}));
 const {teams, difference} = balanceTeams(players);
 const sum = team => team.reduce((total, p) => total + p.rating, 0);
 assert.equal(difference, Math.abs(sum(teams[0]) - sum(teams[1])));
 assert.ok(difference <= 790, `gap should be minimal, got ${difference}`);
});

test('Matchmaker enqueues, de-duplicates and reports positions', () => {
 const queue = new Matchmaker({teamSize: 2});
 assert.equal(queue.enqueue({peerId: 1, rating: 10}).peerId, 1);
 queue.enqueue({peerId: 2, rating: 20});
 queue.enqueue({peerId: 1, rating: 99});
 assert.equal(queue.size(), 2, 'duplicate peer is ignored');
 assert.equal(queue.has(2), true);
 assert.equal(queue.position(2), 1);
 assert.equal(queue.remove(2), true);
 assert.equal(queue.remove(2), false);
 assert.equal(queue.size(), 1);
 assert.deepEqual(queue.list().map(p => p.peerId), [1]);
});

test('Matchmaker enforces the queue ceiling', () => {
 const queue = new Matchmaker({teamSize: 1, max: 2});
 queue.enqueue({peerId: 1});
 queue.enqueue({peerId: 2});
 assert.equal(queue.enqueue({peerId: 3}), null);
 assert.equal(queue.size(), 2);
 assert.ok(QUEUE_MAX >= 2);
});

test('Matchmaker drafts a balanced pair of teams once enough players wait', () => {
 const queue = new Matchmaker({teamSize: 2, minPlayers: 4});
 queue.enqueue({peerId: 1, name: 'A', rating: 100});
 queue.enqueue({peerId: 2, name: 'B', rating: 80});
 queue.enqueue({peerId: 3, name: 'C', rating: 60});
 assert.equal(queue.draft(), null, 'not enough players yet');
 queue.enqueue({peerId: 4, name: 'D', rating: 40});
 const draft = queue.draft();
 assert.ok(draft);
 assert.equal(draft.players.length, 4);
 assert.equal(draft.teams[0].length, 2);
 assert.equal(draft.teams[1].length, 2);
 assert.equal(queue.size(), 0, 'drafted players leave the queue');
});

test('host warmup arms a countdown and starts on tick', () => {
 const room = new Room('r', rng(), {warmupSeconds: 2});
 room.join(1, 'Host'); room.join(2, 'P2');
 room.host(1, {botCount: 0, timeLimit: 60}, 'crosswire');
 room.drain();
 assert.equal(room.beginWarmup(1), true);
 assert.equal(room.phase, 'warmup');
 let lobby = last(room.drain(), 'lobby');
 assert.equal(lobby.lifecycle.phase, 'warmup');
 assert.ok(lobby.lifecycle.warmup > 0);
 room.tick(1);
 assert.equal(room.started, false, 'warmup has not elapsed');
 for (let i = 0; i < 8 && !room.started; i++) room.tick(.25);
 assert.equal(room.started, true);
 assert.equal(room.phase, 'live');
 assert.ok(find(room.drain(), 'start'));
});

test('ready-up reaches the quorum and skips the warmup countdown', () => {
 const room = new Room('r', rng(), {warmupSeconds: 30});
 room.join(1, 'Host'); room.join(2, 'P2');
 room.host(1, {botCount: 0, timeLimit: 60}, 'crosswire');
 room.drain();
 room.setReady(1);
 room.setReady(2);
 const lifecycle = room.lifecycle();
 assert.equal(lifecycle.ready, 2);
 assert.equal(lifecycle.readyNeeded, 1, `${REMATCH_RATIO} of two players rounds up to one`);
 assert.equal(room.beginWarmup(1), true);
 assert.equal(room.started, true, 'a ready quorum starts immediately');
 assert.equal(room.phase, 'live');
});

test('map votes tally one choice per player and expose a deterministic winner', () => {
 const room = new Room('r', rng());
 room.join(1, 'A'); room.join(2, 'B'); room.join(3, 'C');
 room.drain();
 room.mapVote(1, 'crosswire');
 room.mapVote(2, 'crosswire');
 room.mapVote(3, 'exchange');
 let lobby = last(room.drain(), 'lobby');
 assert.deepEqual(lobby.lifecycle.mapVotes, {crosswire: 2, exchange: 1});
 assert.equal(lobby.lifecycle.mapVoteWinner, 'crosswire');
 room.mapVote(3, 'crosswire');
 lobby = last(room.drain(), 'lobby');
 assert.deepEqual(lobby.lifecycle.mapVotes, {crosswire: 3}, 'a player has one live vote');
 room.mapVote(1, 'exchange');
 lobby = last(room.drain(), 'lobby');
 assert.deepEqual(lobby.lifecycle.mapVotes, {crosswire: 2, exchange: 1}, 're-voting moves the vote');
});

test('rematch requires a majority of connected players', () => {
 const room = new Room('r', rng(), {graceMs: 60000});
 room.join(1, 'A'); room.join(2, 'B');
 room.host(1, {botCount: 0, timeLimit: 1, fragLimit: 5}, 'crosswire');
 room.start(1);
 room.match.over = true;
 room.tick(1 / 60);
 assert.equal(room.phase, 'results');
 room.drain();
 assert.equal(room.requestRematch(1), false, 'one of two is not a majority');
 assert.equal(room.requestRematch(2), true, 'two of two is a majority');
 assert.equal(room.lifecycle().rematchReady, true);
});

test('lifecycle revision advances on ready, vote and phase changes', () => {
 const room = new Room('r', rng());
 room.join(1, 'A'); room.join(2, 'B');
 room.host(1, {botCount: 0, timeLimit: 60}, 'crosswire');
 room.drain();
 const before = room.lifecycle().revision;
 room.setReady(1);
 assert.ok(room.lifecycle().revision > before);
 const afterReady = room.lifecycle().revision;
 room.mapVote(2, 'crosswire');
 assert.ok(room.lifecycle().revision > afterReady);
});

test('a live match reports the results phase and a deterministic rematch gate', () => {
 const room = new Room('r', rng());
 room.join(1, 'A'); room.join(2, 'B');
 room.host(1, {botCount: 0, timeLimit: 60, fragLimit: 5}, 'crosswire');
 room.start(1);
 assert.equal(room.phase, 'live');
 assert.equal(room.lifecycle().phase, 'live');
 assert.equal(room.lifecycle().rematchReady, false);
 assert.ok(WARMUP_SECONDS >= 0);
});
