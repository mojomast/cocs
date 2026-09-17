// Phase 4 team-mode respawn switching (§3.7, §12.2 Phase 4): Match.setLoadout
// queues an operator/harness pair and consumes it on the next spawn, rebuilding
// the class stats, movement state and signature-verb state. The server owns the
// mode/lockout gate; these tests pin the sim-side contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';

const seeded = (seed = 7) => {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
};

test('setLoadout queues a different pair, normalises the Claude lock and cancels a stale queue', () => {
  const m = new Match('mistral', 'openclaw', seeded(), 'crosswire', { mode: 'ctf', humanCount: 1, botCount: 0 });
  const a = m.actors[0];
  assert.equal(a.character, 'mistral');
  assert.equal(m.setLoadout(0, { character: 'mistral', harness: 'openclaw' }), false, 'the current pair is a no-op');
  assert.equal(m.setLoadout(9, { character: 'grok', harness: 'hermes' }), false, 'unknown actor is rejected');
  assert.equal(m.setLoadout(0, { character: 'claude', harness: 'hermes' }), true);
  assert.equal(a.character, 'mistral', 'a live actor keeps its kit until it respawns');
  assert.deepEqual(m.pendingLoadouts.get(0), { character: 'claude', harness: 'claudecode' }, 'the Claude lock normalises the pending pair');
  // Returning to the current pair cancels the queued switch instead of silently
  // keeping it.
  assert.equal(m.setLoadout(0, { character: 'mistral', harness: 'openclaw' }), false);
  assert.equal(m.pendingLoadouts.has(0), false, 'a no-op clears the queue');
});

test('a mid-death switch lands on respawn with rebuilt stats, movement and verb state', () => {
  const m = new Match('mistral', 'openclaw', seeded(11), 'crosswire', { mode: 'ctf', humanCount: 1, botCount: 0 });
  const a = m.actors[0];
  const oldMaxHealth = a.maxHealth, oldVerb = a.verbState?.verb;
  assert.equal(a.movement.verb, 'air-dash');
  a.protection = 0;
  m.damage(a, 1e6, a);
  assert.ok(a.health <= 0, 'the actor is dead');
  assert.equal(m.setLoadout(0, { character: 'claude', harness: 'openclaw' }), true);
  for (let i = 0; i < 600 && a.health <= 0; i++) m.step(1 / 60);
  assert.ok(a.health > 0, 'the actor respawned');
  assert.equal(a.character, 'claude');
  assert.equal(a.harness, 'claudecode');
  assert.notEqual(a.maxHealth, oldMaxHealth, 'max health was recomputed for the new class');
  assert.equal(a.health, a.maxHealth, 'the respawn is at full health for the new class');
  assert.equal(a.movement.character, 'claude', 'movement state was rebuilt for the new class');
  assert.equal(a.movement.verb, 'safety-glide', 'the new class owns its movement verb');
  assert.equal(a.verbState.operator, 'claude', 'signature-verb state was rebuilt');
  assert.equal(a.verbState.verb, 'alignment-review');
  assert.notEqual(a.verbState.verb, oldVerb);
  const event = m.events.find(e => e.type === 'loadout-switch');
  assert.ok(event, 'a loadout-switch event fired');
  assert.equal(event.actor, 0);
  assert.deepEqual(event.from, { character: 'mistral', harness: 'openclaw' });
  assert.deepEqual(event.to, { character: 'claude', harness: 'claudecode' });
});

test('a queued switch with no actual change emits no event and leaves gear untouched', () => {
  const m = new Match('grok', 'hermes', seeded(3), 'crosswire', { mode: 'ctf', humanCount: 1, botCount: 0 });
  const a = m.actors[0];
  a.gear = { health: 5, speed: 1.04 };
  a.attachments = { optic: 'scope' };
  a.finish = 'gold';
  const before = { ...a.gear };
  assert.equal(m.setLoadout(0, { character: 'grok', harness: 'hermes' }), false);
  a.protection = 0;
  m.damage(a, 1e6, a);
  for (let i = 0; i < 600 && a.health <= 0; i++) m.step(1 / 60);
  assert.equal(m.events.filter(e => e.type === 'loadout-switch').length, 0, 'no spurious switch event');
  assert.deepEqual(a.gear, before, 'gear survives the respawn untouched');
  assert.deepEqual(a.attachments, { optic: 'scope' });
  assert.equal(a.finish, 'gold');
});
