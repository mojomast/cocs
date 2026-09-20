import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {createMovementState, stepMovement} from './movement.mjs';

// Phase 4 (docs/design/CLASS_OVERHAUL.md §5, §12.2): the `mobility` input is a
// held control end to end. Core derives a single press edge while it is held
// and a release edge on the true->false transition; the movement layer is only
// allowed to cancel a grapple on that explicit release, never on the absence of
// one activation pulse.

const DT = 1 / 60;
const rng = (seed = 7) => {
  let n = seed;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
};
const matchFor = (character, harness) => new Match(character, harness, rng(), 'crosswire', {
  mode: 'deathmatch', difficulty: 'normal', humanCount: 1, botCount: 0, timeLimit: 300, fragLimit: 15,
});
const eventsOf = match => match.events;

test('core derives one mobility press edge while KeyX is held and clears it on release', () => {
  const match = matchFor('kimi', 'openclaw');
  const a = match.actors[0];
  assert.equal(a.movement.verb, 'blink-step', 'the Kimi seat owns the aimed mobility verb');
  match.step(DT, {x: 0, z: 0, mobility: true});
  assert.equal(a.inputMobility, true, 'the held state is latched for edge derivation');
  assert.equal(eventsOf(match).filter(e => e.type === 'windup-start' && e.actor === a.id).length, 1, 'the press edge starts one wind-up');
  for (let i = 0; i < 10; i++) match.step(DT, {x: 0, z: 0, mobility: true});
  assert.equal(eventsOf(match).filter(e => e.type === 'windup-start' && e.actor === a.id).length, 1, 'holding does not re-press');
  assert.equal(a.inputMobility, true, 'the held state persists across ticks');
  match.step(DT, {x: 0, z: 0});
  assert.equal(a.inputMobility, false, 'releasing clears the held state');
});

test('a held mobility stream keeps an active grapple hooked and release clears it', () => {
  const match = matchFor('chatgpt', 'openclaw');
  const a = match.actors[0];
  assert.equal(a.movement.verb, 'grapple');
  // Seed the active phase directly so the test pins the input semantics, not a
  // particular arena wall behind the actor.
  const state = a.movement;
  state.phase = 'active';
  state.grapple = {x: a.x, y: a.y + 2, z: a.z - 6};
  state.activeTime = 0;
  state.landingArmed = false;
  for (let i = 0; i < 12; i++) match.step(DT, {x: 0, z: 0, mobility: true});
  assert.equal(state.phase, 'active', 'a held mobility input never releases the hook');
  assert.equal(a.inputMobility, true);
  assert.ok(!eventsOf(match).some(e => e.type === 'grapple-release'), 'holding produces no release');
  match.step(DT, {x: 0, z: 0});
  const release = eventsOf(match).filter(e => e.type === 'grapple-release').pop();
  assert.ok(release, 'the true->false transition releases the hook');
  assert.equal(release.reason, 'release');
  assert.equal(state.phase, 'ready');
  assert.equal(a.inputMobility, false);
  assert.ok(state.cooldown > 0, 'the released hook pays the 6 s cooldown');
});

test('a one-tick mobility pulse at the movement layer does not cancel an active grapple', () => {
  // What a one-tick pulse looks like to the verb stepper: `mobility` true on the
  // activation tick, then empty inputs. Only an explicit `mobilityReleased`
  // cancels, so the core's held->release derivation is the single source of the
  // release edge (a forwarded one-tick pulse must never fake one).
  const state = createMovementState({character: 'chatgpt', harness: 'openclaw'}, {mode: 'deathmatch'});
  const ctx = {dt: DT, x: 0, y: 6, z: 0, vy: 0, grounded: false, castRay: () => ({x: 0, y: 6, z: -10})};
  const pulse = stepMovement(state, {mobility: true}, ctx);
  assert.equal(state.phase, 'active', 'the pulse activates the hook');
  assert.ok(pulse.events.some(event => event.type === 'grapple-hook'));
  for (let i = 0; i < 6; i++) {
    const frame = stepMovement(state, {}, {...ctx, z: -i * 0.05});
    assert.ok(!frame.events.some(event => event.type === 'grapple-release'), 'omitting mobility is not a release');
  }
  assert.equal(state.phase, 'active', 'the hook survives the pulse');
  const released = stepMovement(state, {mobilityReleased: true}, ctx);
  assert.equal(state.phase, 'ready', 'only an explicit release cancels');
  assert.ok(released.events.some(event => event.type === 'grapple-release' && event.reason === 'release'));
});
