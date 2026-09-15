import test from 'node:test';
import assert from 'node:assert/strict';
import {actorWon, rankTuple, compareRanks, rankLeaders} from './outcome.mjs';
import {Match} from './core.mjs';

const result = (winner, actors) => ({ winner, actors });
const actor = (team, frags) => ({ team, frags });
const rng = () => { let n = 31; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };

test('every team mode awards the authoritative winner, not the frag leader', () => {
  for (const mode of ['ctf', 'teamdeathmatch', 'koth', 'domination', 'assault', 'payload', 'combined-arms']) {
    const winner = actor(0, 1), loser = actor(1, 9);
    const state = result(0, [winner, loser]);
    assert.equal(actorWon(state, mode, winner), true, `${mode}: winning team with fewer frags`);
    assert.equal(actorWon(state, mode, loser), false, `${mode}: frag leader on the losing team`);
  }
});

test('a team draw or missing winner awards nobody', () => {
  assert.equal(actorWon(result(null, [actor(0, 3), actor(1, 3)]), 'assault', actor(0, 3)), false);
  assert.equal(actorWon({ winner: null, actors: [actor(0, 3)] }, 'teamdeathmatch', actor(0, 3)), false);
});

test('frag modes award the highest frag count including ties', () => {
  const a = actor(undefined, 5), b = actor(undefined, 5), c = actor(undefined, 2);
  const state = result(null, [a, b, c]);
  assert.equal(actorWon(state, 'deathmatch', a), true);
  assert.equal(actorWon(state, 'deathmatch', b), true);
  assert.equal(actorWon(state, 'deathmatch', c), false);
  assert.equal(actorWon(result(null, [actor(undefined, 0), actor(undefined, 3)]), 'instagib', actor(undefined, 0)), false);
  assert.equal(actorWon(result(null, [actor(undefined, 3), actor(undefined, 1)]), 'rockets', actor(undefined, 3)), true);
});

test('arms race awards the ladder leader, not the frag leader', () => {
  const ladderLeader = { frags: 1, ladder: 3 }, fragLeader = { frags: 9, ladder: 1 };
  const state = result(null, [ladderLeader, fragLeader]);
  assert.equal(actorWon(state, 'armsrace', ladderLeader), true, 'higher rung wins');
  assert.equal(actorWon(state, 'armsrace', fragLeader), false, 'frag leader on a lower rung loses');
  const tie = result(null, [{ frags: 9, ladder: 2 }, { frags: 4, ladder: 2 }]);
  assert.equal(actorWon(tie, 'armsrace', { frags: 9, ladder: 2 }), true, 'frags break a ladder tie');
  assert.equal(actorWon(tie, 'armsrace', { frags: 4, ladder: 2 }), false);
  assert.equal(actorWon(result(null, [{ frags: 0, ladder: 0 }]), 'armsrace', { frags: 0, ladder: 0 }), false, 'a scoreless match is a draw');
});

test('arms race leaders and the timeout winner follow the ladder without frag sudden death', () => {
  const m = new Match('chatgpt', 'openclaw', rng(), 'proving-grounds', { mode: 'armsrace', botCount: 0, humanCount: 2, timeLimit: 60, suddenDeath: true });
  m.actors[0].ladder = 4; m.actors[0].frags = 1;
  m.actors[1].ladder = 2; m.actors[1].frags = 9;
  assert.deepEqual(m.leaders().map(a => a.id), [0], 'leaders rank by ladder first');
  m.time = m.config.timeLimit - 1 / 60;
  m.step(1 / 60);
  assert.equal(m.suddenDeath, false, 'arms race must not enter frag sudden death');
  assert.equal(m.over, true);
  assert.equal(m.snapshot().overReason, 'time');
  const state = m.snapshot();
  assert.equal(actorWon(state, 'armsrace', state.actors.find(a => a.id === 0)), true);
  assert.equal(actorWon(state, 'armsrace', state.actors.find(a => a.id === 1)), false);
});

test('missing inputs never award a win', () => {
  assert.equal(actorWon(null, 'ctf', actor(0, 1)), false);
  assert.equal(actorWon(result(0, []), 'ctf', null), false);
});

test('race wins follow the racer ID, including zero, without requiring frags', () => {
  const racers = [{ id: 0, team: 1, frags: 0 }, { id: 7, team: 0, frags: 0 }, { id: 9, team: 7, frags: 20 }];
  for (const winnerId of [7, 0]) {
    for (const state of [{ winner: winnerId, actors: racers }, { winner: winnerId, race: { winnerId }, actors: racers }]) {
      for (const racer of racers) assert.equal(actorWon(state, 'puma-race', racer), racer.id === winnerId);
    }
  }
});

test('race wins require a result and an actual winner', () => {
  for (const state of [null, {}, { winner: null }, { race: { winnerId: null } }]) {
    assert.equal(actorWon(state, 'puma-race', { id: 0, frags: 10 }), false);
    assert.equal(actorWon(state, 'puma-race', { frags: 10 }), false);
  }
  assert.equal(actorWon({ winner: 0 }, 'puma-race', null), false);
});

test('a score-limit team finish is reported as a frag ending', () => {
  const m = new Match('chatgpt', 'openclaw', rng(), 'crosswire', { mode: 'teamdeathmatch', botCount: 0, humanCount: 2, fragLimit: 5, timeLimit: 60 });
  m.actors[0].team = 0; m.actors[1].team = 1;
  m.teamScores[0] = m.config.fragLimit - 1;
  m.actors[0].protection = 0; m.actors[1].protection = 0;
  m.damage(m.actors[1], 1000, m.actors[0]);
  assert.equal(m.over, true);
  assert.equal(m.snapshot().overReason, 'frag');
});

test('leaders() and the shared rankTuple agree for every ranked mode', () => {
  const cases = [
    { mode: 'deathmatch', setup: a => { a[0].frags = 5; a[1].frags = 2; } },
    { mode: 'instagib', setup: a => { a[0].frags = 1; a[1].frags = 4; } },
    { mode: 'armsrace', setup: a => { a[0].ladder = 3; a[0].frags = 1; a[1].ladder = 1; a[1].frags = 9; } },
    { mode: 'ctf', team: true, setup: a => { a[0].scoreStats.captures = 2; a[1].scoreStats.captures = 0; } },
    { mode: 'koth', team: true, setup: a => { a[0].scoreStats.objectiveTime = 5; a[1].scoreStats.objectiveTime = 1; } },
    { mode: 'domination', team: true, setup: a => { a[0].scoreStats.objectiveTime = 5; a[1].scoreStats.objectiveTime = 1; } },
    { mode: 'combined-arms', team: true, setup: a => { a[0].scoreStats.objectiveTime = 5; a[1].scoreStats.objectiveTime = 1; } },
    { mode: 'assault', team: true, setup: a => { a[0].scoreStats.objectiveCaptures = 2; a[1].scoreStats.objectiveCaptures = 0; } },
    { mode: 'payload', team: true, setup: a => { a[0].scoreStats.objectiveCaptures = 2; a[1].scoreStats.objectiveCaptures = 0; } },
  ];
  for (const { mode, team, setup } of cases) {
    const m = new Match('chatgpt', 'openclaw', rng(), 'exchange', { mode: 'deathmatch', botCount: 0, humanCount: 2 });
    m.config.mode = mode;
    m.actors[0].team = team ? 0 : undefined;
    m.actors[1].team = team ? 1 : undefined;
    m.actors.forEach(a => { a.frags = 0; a.ladder = 0; a.scoreStats = { ...a.scoreStats, captures: 0, objectiveTime: 0, objectiveCaptures: 0 }; });
    setup(m.actors);
    if (team) m.teamScores = { 0: 3, 1: 1 };
    const best = m.actors.reduce((top, a) => { const rank = rankTuple(a, mode); return !top || compareRanks(rank, top) < 0 ? rank : top; }, null);
    const topIds = m.actors.filter(a => compareRanks(rankTuple(a, mode), best) === 0).map(a => a.id);
    assert.deepEqual(rankLeaders(m.actors, mode).map(a => a.id), topIds, `${mode}: rankLeaders matches rankTuple maxima`);
    assert.deepEqual(m.leaders().map(a => a.id), topIds, `${mode}: leaders() matches the shared ranking`);
  }
});

test('a timed team finish is reported as a time ending even with a winner', () => {
  const m = new Match('chatgpt', 'openclaw', rng(), 'crosswire', { mode: 'teamdeathmatch', botCount: 0, humanCount: 2, fragLimit: 30, timeLimit: 60 });
  m.teamScores[0] = 3; m.teamScores[1] = 1;
  m.config.timeLimit = 1;
  for (let i = 0; i < 70; i++) m.step(1 / 60);
  const state = m.snapshot();
  assert.equal(state.over, true);
  assert.equal(state.overReason, 'time');
  assert.equal(state.winner, 0);
});

test('juggernaut is awarded on crown points, not frags', () => {
  const crown = {id:0, team:0, frags:1, points:30}, chaser = {id:1, team:1, frags:9, points:5};
  const byPoints = { winner: 0, actors: [crown, chaser] };
  assert.equal(actorWon(byPoints, 'juggernaut', crown), true, 'crown holder wins');
  assert.equal(actorWon(byPoints, 'juggernaut', chaser), false, 'frag leader without the crown loses');
  const noWinner = { winner: null, actors: [crown, chaser] };
  assert.equal(actorWon(noWinner, 'juggernaut', crown), true, 'time ending ranks by points');
  assert.equal(actorWon(noWinner, 'juggernaut', chaser), false);
});

test('rankTuple ranks juggernaut by points before frags', () => {
  const a = { frags: 1, points: 20 }, b = { frags: 9, points: 2 };
  assert.ok(compareRanks(rankTuple(a, 'juggernaut'), rankTuple(b, 'juggernaut')) < 0);
});
