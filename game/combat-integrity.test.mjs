import assert from 'node:assert/strict';
import test from 'node:test';
import {Match, floorAt} from './core.mjs';

function combat(firstZ = -20, secondZ = -30, attachments = {magazine: 'piercing-rounds'}) {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'exchange', {
    botCount: 0, humanCount: 3,
    loadouts: {0: {character: 'chatgpt', harness: 'openclaw', attachments}},
  });
  m.arena = {...m.arena, blocks: [], raised: false, terrain: null, platforms: [], surfaces: []};
  m.vehicles = [];
  m.actors.forEach(a => Object.assign(a, {x: 0, y: 0, z: 0, health: 500, armor: 0, protection: 0}));
  const [a, first, second] = m.actors;
  Object.assign(a, {weapon: 2, yaw: 0, pitch: 0, shotWait: 0});
  a.ammo[2] = 5;
  first.z = firstZ;
  second.z = secondZ;
  return {m, a, first, second};
}

test('piercing rounds damage separated aligned actors, unlike stock rounds', () => {
  for (const piercing of [false, true]) {
    const {m, a, first, second} = combat(-20, -30, piercing ? {magazine: 'piercing-rounds'} : {});
    assert.equal(m.fire(a), true);
    assert.ok(first.health < 500);
    assert.equal(second.health < 500, piercing);
  }
});

test('piercing continuation stops at a wall beyond the first actor', () => {
  const {m, a, first, second} = combat();
  m.arena.blocks = [{x: 0, z: -25, w: 8, d: 1, h: 8}];
  m.fire(a);
  assert.ok(first.health < 500);
  assert.equal(second.health, 500);
});

test('piercing continuation consumes the first impact distance from weapon range', () => {
  for (const offset of [-1, 1]) {
    const {m, a, first, second} = combat(-70);
    second.z = -(m.weaponFor(a).range + offset);
    m.fire(a);
    assert.ok(first.health < 500);
    assert.equal(second.health < 500, offset < 0);
  }
});

function ctf() {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'launchpad', {mode: 'ctf', botCount: 0, humanCount: 2});
  m.arena = {...m.arena, blocks: [], raised: false, platforms: [{x: 0, z: 0, w: 100, d: 100, y: 4}]};
  m.flagSpawns = {0: [-10, 0], 1: [10, 0]};
  for (const f of Object.values(m.flags)) Object.assign(f, {x: m.flagSpawns[f.team][0], y: 4, z: 0});
  return m;
}

test('CTF base pickup requires matching height and still works on raised bases', () => {
  const m = ctf(), a = m.actors[0], flag = m.flags[1];
  for (const y of [0, 8]) {
    Object.assign(a, {x: flag.x, y, z: flag.z});
    m.objective(a);
    assert.equal(flag.state, 'at-base');
  }
  a.y = 4;
  m.objective(a);
  assert.equal(flag.carrier, a.id);
  assert.equal(flag.y, a.y);
});

test('CTF dropped pickup and friendly return require matching drop height', () => {
  for (const team of [0, 1]) {
    const m = ctf(), a = m.actors[team], carrier = m.actors[0], flag = m.flags[1];
    Object.assign(flag, {state: 'carried', carrier: carrier.id});
    m.dropFlag(carrier, {x: 0, y: 9, z: 0});
    assert.equal(flag.y, 4, 'airborne drops settle on supported ground');
    for (const y of [0, 8]) {
      Object.assign(a, {x: 0, y, z: 0});
      m.objective(a);
      assert.equal(flag.state, 'dropped');
    }
    a.y = 4;
    m.objective(a);
    assert.equal(flag.state, team === 1 ? 'at-base' : 'carried');
    assert.equal(flag.y, 4);
    if (team === 1) assert.deepEqual(m.events.find(e => e.type === 'flag-return').pos, {x: 10, y: 4, z: 0});
  }
});

test('CTF capture requires home height and resets enemy base height', () => {
  const m = ctf(), a = m.actors[0], flag = m.flags[1];
  Object.assign(a, {x: 10, y: 4, z: 0});
  m.objective(a);
  for (const y of [0, 8]) {
    Object.assign(a, {x: -10, y});
    m.objective(a);
    assert.equal(m.teamScores[0], 0);
    assert.equal(flag.y, y, 'carried flag follows carrier height');
  }
  a.y = 4;
  m.objective(a);
  assert.equal(m.teamScores[0], 1);
  assert.equal(flag.state, 'at-base');
  assert.deepEqual({x: flag.x, y: flag.y, z: flag.z}, {x: 10, y: 4, z: 0});
});

test('elevated death and void drops preserve supported height in events and snapshots', () => {
  for (const fall of [false, true]) {
    const m = ctf(), a = m.actors[0], flag = m.flags[1];
    Object.assign(a, {x: 10, y: 4, z: 0, protection: 0, lastValid: {x: 0, y: 4, z: 0}});
    m.objective(a);
    if (fall) { Object.assign(a, {x: 100, y: -50}); m.fall(a); }
    else m.damage(a, 10000, m.actors[1]);
    assert.equal(flag.state, 'dropped');
    assert.equal(flag.y, 4);
    assert.equal(m.events.find(e => e.type === 'flag-drop').pos.y, 4);
    assert.equal(m.snapshot().flags.find(f => f.team === 1).y, 4);
    assert.equal(m.snapshot().objectives.flags.find(f => f.team === 1).y, 4);
  }
});

test('authored elevated flag bases initialize at their supported height', () => {
  const m = new Match('chatgpt', 'openclaw', () => .5, 'blood-gulch', {mode: 'ctf', botCount: 0});
  for (const flag of Object.values(m.flags)) {
    assert.equal(flag.y, floorAt(flag.x, flag.z, m.arena));
    assert.ok(flag.y > 0);
  }
});

test('a ground-level death beside a tall wall does not drop the flag on its roof', () => {
  const m = ctf(), a = m.actors[0], flag = m.flags[1];
  m.arena.platforms = [];
  m.arena.blocks = [{x: 0, z: 0, w: 2, d: 2, h: 20}];
  Object.assign(a, {x: 1.4, y: 0, z: 0, protection: 0});
  Object.assign(flag, {state: 'carried', carrier: a.id});
  m.damage(a, 10000, m.actors[1]);
  assert.equal(flag.state, 'dropped');
  assert.equal(flag.y, 0);
  assert.deepEqual(m.events.find(e => e.type === 'flag-drop').pos, {x: 1.4, y: 0, z: 0});
});

test('a blocktop death drops the flag on that top, including floating-point tolerance', () => {
  for (const y of [6, 6 - 5e-7]) {
    const m = ctf(), a = m.actors[0], flag = m.flags[1];
    m.arena.blocks = [{x: 0, z: 0, w: 2, d: 2, h: 6}, {x: 1.4, z: 0, w: 2, d: 2, h: 20}];
    Object.assign(a, {x: 0, y, z: 0, protection: 0});
    Object.assign(flag, {state: 'carried', carrier: a.id});
    m.damage(a, 10000, m.actors[1]);
    assert.equal(flag.y, 6);
    assert.equal(m.snapshot().flags.find(f => f.team === 1).y, 6);
  }
});

test('drops choose a lower platform rather than an overhead surface', () => {
  const m = ctf(), a = m.actors[0], flag = m.flags[1];
  m.arena.platforms.push({x: 0, z: 0, w: 4, d: 4, y: 20});
  Object.assign(flag, {state: 'carried', carrier: a.id});
  m.dropFlag(a, {x: 0, y: 8, z: 0});
  assert.equal(flag.y, 4);
});

test('flag returns and captures reset to authored floor height beside tall walls', () => {
  for (const capture of [false, true]) {
    const m = ctf(), a = m.actors[capture ? 0 : 1], flag = m.flags[1];
    m.arena.blocks = [{x: 11.4, z: 0, w: 2, d: 2, h: 20}];
    Object.assign(a, {x: capture ? -10 : 0, y: 4, z: 0});
    Object.assign(flag, {x: 0, y: 4, z: 0, state: capture ? 'carried' : 'dropped', carrier: capture ? a.id : null});
    m.objective(a);
    assert.equal(flag.state, 'at-base');
    assert.equal(flag.x, 10);
    assert.equal(flag.y, 4);
  }
});
