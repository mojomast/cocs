// `botLoadouts` / `aiSeats` / `botPolicy` and ability damage tagging — Phase 3D
// prerequisites for the balance sweep (docs/design/CLASS_OVERHAUL.md §7.5, §14).
//
// These pin the harness seams the sweep relies on:
//   - bot seats can be given deterministic {character, harness, gear,
//     attachments} loadouts at construction;
//   - with the option absent, the historical RNG draw order (and therefore
//     every pinned bot identity sequence in the existing suites) is unchanged;
//   - `aiSeats` gives the leading human seats the bot AI, and `botPolicy`
//     overrides the AI policy for the neutral sweep;
//   - damage dealt by a harness active is tagged, weapon damage is not.

import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {ATTACHMENTS} from './attachments.mjs';
import {botBehavior} from './bot-personalities.mjs';

const seeded = () => { let n = 17; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); };
const identity = match => match.actors.map(actor => `${actor.character}/${actor.harness}/${actor.gear ? 'gear' : 'stock'}`);

test('botLoadouts pins bot characters, harnesses, gear and attachments', () => {
  const attachment = ATTACHMENTS[0].id;
  const match = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {
    botCount: 3, humanCount: 1,
    botLoadouts: [
      {character: 'grok', harness: 'cline'},
      {character: 'mistral', harness: 'roo', gear: {utility: 'stim'}},
      {character: 'meta', harness: 'codex', attachments: [attachment]},
    ],
  });
  assert.equal(match.actors.length, 4);
  assert.equal(match.actors[0].character, 'chatgpt');
  assert.equal(match.actors[0].harness, 'openclaw');
  assert.equal(match.actors[1].character, 'grok');
  assert.equal(match.actors[1].harness, 'cline');
  assert.equal(match.actors[2].character, 'mistral');
  assert.equal(match.actors[2].harness, 'roo');
  assert.equal(match.actors[2].gear.health, 15, 'utility stim resolves through the §4.8 EHP cap');
  assert.ok(match.actors[3].attachments?.items?.some(item => item.id === attachment), 'attachment resolved');
  assert.equal(match.actors[3].harness, 'codex');
});

test('botLoadouts may omit fields and keeps the Claude Code lock', () => {
  const match = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {
    botCount: 2, humanCount: 1,
    botLoadouts: [{character: 'claude'}, {harness: 'hermes'}],
  });
  const [, claude, second] = match.actors;
  assert.equal(claude.character, 'claude');
  assert.equal(claude.harness, 'claudecode', 'the Claude Code lock still applies to pinned bots');
  assert.equal(second.character, 'grok');
  assert.equal(second.harness, 'hermes');
});

test('absent botLoadouts does not perturb the historical RNG consumption order', () => {
  const plain = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {botCount: 5, humanCount: 1});
  const empty = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {botCount: 5, humanCount: 1, botLoadouts: []});
  const holes = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {botCount: 5, humanCount: 1, botLoadouts: [null, undefined, null, undefined, null]});
  assert.deepEqual(identity(empty), identity(plain));
  assert.deepEqual(identity(holes), identity(plain));
  const rerun = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {botCount: 5, humanCount: 1});
  assert.deepEqual(identity(rerun), identity(plain));
});

test('pinned bots replay deterministically under identical seeds', () => {
  const options = {
    botCount: 3, humanCount: 1, timeLimit: 60, mode: 'deathmatch',
    botLoadouts: [{character: 'kimi', harness: 'opencode'}, {character: 'qwen', harness: 'roo'}, {character: 'gemini', harness: 'hermes'}],
  };
  const run = () => {
    const match = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', options);
    for (let step = 0; step < 900; step++) match.step(1 / 60, {inputs: {}});
    return match.snapshot();
  };
  assert.deepEqual(run(), run());
});

test('aiSeats runs the bot AI on the leading seats and is inert by default', () => {
  const start = 'crosswire';
  const ai = new Match('chatgpt', 'openclaw', seeded(), start, {botCount: 1, humanCount: 1, aiSeats: true, timeLimit: 60});
  const idle = new Match('chatgpt', 'openclaw', seeded(), start, {botCount: 1, humanCount: 1, timeLimit: 60});
  const [aiActor] = ai.actors, [idleActor] = idle.actors;
  const aiStart = {x: aiActor.x, z: aiActor.z}, idleStart = {x: idleActor.x, z: idleActor.z};
  for (let step = 0; step < 900; step++) {
    ai.step(1 / 60, {inputs: {}});
    idle.step(1 / 60, {inputs: {}});
  }
  assert.ok(Math.hypot(aiActor.x - aiStart.x, aiActor.z - aiStart.z) > 1, 'aiSeats actor navigates');
  assert.equal(idleActor.x, idleStart.x);
  assert.equal(idleActor.z, idleStart.z);
  assert.ok(aiActor.bot && idleActor.bot === null);
});

test('botPolicy overrides role, personality and archetype through Match', () => {
  const neutral = {role: 'adaptive', personality: 'skirmisher', archetype: 'flanker'};
  const match = new Match('grok', 'openclaw', seeded(), 'crosswire', {
    botCount: 1, humanCount: 1, aiSeats: true, botPolicy: neutral,
  });
  assert.deepEqual(match.actors[0].bot.policy, neutral);
  const behavior = botBehavior(match.actors[0]);
  assert.equal(behavior.role, 'adaptive');
  assert.equal(behavior.personality, 'skirmisher');
  assert.equal(behavior.archetype, 'flanker');
  // Without a policy the class personality still wins.
  const plain = botBehavior({character: 'grok', harness: 'openclaw', id: 0});
  assert.notEqual(plain.archetype, 'flanker');
  assert.equal(Object.hasOwn(plain, 'policy'), false);
});

test('harness active damage is tagged as ability damage, weapon damage is not', () => {
  const match = new Match('chatgpt', 'openclaw', seeded(), 'crosswire', {
    mode: 'deathmatch', botCount: 0, humanCount: 2,
    loadouts: {
      0: {character: 'chatgpt', harness: 'openclaw'},
      1: {character: 'chatgpt', harness: 'openclaw'},
    },
  });
  const [attacker, target] = match.actors;
  for (const actor of match.actors) { actor.protection = 0; actor.health = 100; actor.armor = 0; }
  Object.assign(attacker, {x: -9, y: 0, z: 8, yaw: 0, pitch: 0, cooldown: 0});
  Object.assign(target, {x: -9, y: 0, z: 4, yaw: 0, pitch: 0});
  assert.equal(match.power(attacker), true);
  const tagged = match.events.find(event => event.type === 'damage' && event.ability === true);
  assert.ok(tagged, 'Claw Burst damage carries ability:true');
  assert.equal(tagged.source, 0);
  assert.equal(tagged.actor, 1);
  assert.ok(tagged.amount > 0);
  match.events.length = 0;
  target.health = 100;
  attacker.weapon = 0;
  attacker.ammo[0] = Infinity;
  attacker.shotWait = 0;
  attacker.yaw = 0; // crosswire: yaw 0 faces -z, toward the target
  attacker.pitch = 0;
  match.fire(attacker);
  const weaponHits = match.events.filter(event => event.type === 'damage' && event.source === 0);
  assert.ok(weaponHits.length > 0, 'the pulse rifle connects');
  assert.ok(weaponHits.every(event => event.ability === undefined), 'weapon damage is untagged');
});
