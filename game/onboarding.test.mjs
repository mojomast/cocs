import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_CONTENT_VERSION,
  ONBOARDING_STATE_KEY,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  onboardingStepDetail,
  onboardingStepView,
  persistOnboardingState,
  readOnboardingState,
  shouldShowOnboarding,
} from './onboarding.mjs';

const step = id => ONBOARDING_STEPS.find(entry => entry.id === id);
const store = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    has: key => map.has(key),
    read: key => map.get(key) ?? null,
  };
};

test('onboarding steps are complete and address the core loop', () => {
  assert.ok(ONBOARDING_STEPS.length >= 4);
  assert.equal(ONBOARDING_STORAGE_KEY, 'token-arena-onboarded');
  assert.equal(ONBOARDING_STATE_KEY, 'token-arena-onboarding');
  assert.ok(Number.isInteger(ONBOARDING_CONTENT_VERSION) && ONBOARDING_CONTENT_VERSION >= 1);
  for (const entry of ONBOARDING_STEPS) {
    assert.equal(typeof entry.id, 'string');
    assert.ok(typeof entry.title === 'string' && entry.title.length > 0);
    assert.ok(typeof entry.detail === 'string' && entry.detail.length > 20);
  }
  const ids = ONBOARDING_STEPS.map(entry => entry.id);
  for (const expected of ['move', 'fight', 'objective']) assert.ok(ids.includes(expected), expected);
});

test('the coach waits for an explicit arena entry', () => {
  assert.equal(shouldShowOnboarding(undefined, false), false, 'a fresh title never mounts the coach');
  assert.equal(shouldShowOnboarding(null, false), false);
  assert.equal(shouldShowOnboarding(undefined, true), true, 'entering the arena opens a fresh coach');
  assert.equal(shouldShowOnboarding(null, true), true);
});

test('skip and completion persist separately under the content version', () => {
  const completed = store(), skipped = store();
  const completedState = persistOnboardingState(completed, 'completed');
  const skippedState = persistOnboardingState(skipped, 'skipped');
  assert.deepEqual(completedState, {status: 'completed', version: ONBOARDING_CONTENT_VERSION});
  assert.deepEqual(skippedState, {status: 'skipped', version: ONBOARDING_CONTENT_VERSION});
  assert.equal(JSON.parse(completed.read(ONBOARDING_STATE_KEY)).status, 'completed');
  assert.equal(JSON.parse(skipped.read(ONBOARDING_STATE_KEY)).status, 'skipped');
  assert.equal(shouldShowOnboarding(completedState, true), false, 'a completion suppresses the same content version');
  assert.equal(shouldShowOnboarding(skippedState, true), false, 'a skip is respected');
  assert.equal(shouldShowOnboarding({status: 'completed', version: ONBOARDING_CONTENT_VERSION - 1}, true), true, 'new content re-arms a completion');
  assert.equal(shouldShowOnboarding({status: 'skipped', version: ONBOARDING_CONTENT_VERSION - 1}, true), false, 'a skip stays skipped across versions');
});

test('the legacy onboarded bit migrates without re-onboarding anyone', () => {
  const legacy = store({[ONBOARDING_STORAGE_KEY]: '1'});
  const migrated = readOnboardingState(legacy);
  assert.deepEqual({status: migrated.status, version: migrated.version}, {status: 'completed', version: ONBOARDING_CONTENT_VERSION});
  assert.equal(shouldShowOnboarding(migrated, true), false, 'the grandfathered completion suppresses the coach');
  assert.equal(legacy.has(ONBOARDING_STORAGE_KEY), false, 'the legacy bit is consumed');
  const written = JSON.parse(legacy.read(ONBOARDING_STATE_KEY));
  assert.equal(written.status, 'completed');
  assert.equal(written.migrated, true);
  // The raw legacy value also reads correctly without a store write.
  assert.equal(shouldShowOnboarding('1', true), false);
  assert.equal(shouldShowOnboarding(true, true), false);
  // A malformed current record falls back to the legacy value.
  const broken = store({[ONBOARDING_STATE_KEY]: '{not json', [ONBOARDING_STORAGE_KEY]: '1'});
  assert.equal(readOnboardingState(broken).version, ONBOARDING_CONTENT_VERSION);
});

test('the intro control copy follows the current bindings', () => {
  const defaultMove = onboardingStepDetail(step('move'), {});
  assert.equal(defaultMove, 'WASD to move, Space to jump, Left Shift to sprint, Left Ctrl to crouch and slide.');
  const defaultFight = onboardingStepDetail(step('fight'), {});
  assert.equal(defaultFight, 'Left mouse fires, right mouse aims, R reloads, F melees and G throws a frag. Scroll or use 1-0 to switch weapons.');

  const remapped = {forward: 'KeyI', left: 'KeyJ', back: 'KeyK', right: 'KeyL', jump: 'KeyM', sprint: 'ShiftRight', crouch: 'ControlRight', reload: 'KeyY', melee: 'KeyU', grenade: 'KeyP'};
  const move = onboardingStepView(step('move'), remapped);
  assert.match(move.detail, /^IJKL to move, M to jump, Right Shift to sprint, Right Ctrl to crouch and slide\.$/);
  assert.doesNotMatch(move.detail, /WASD|Left Shift|Left Ctrl/);
  const fight = onboardingStepView(step('fight'), remapped);
  assert.match(fight.detail, /Y reloads, U melees and P throws a frag/);
  // Non-control steps keep their authored copy verbatim.
  const objective = onboardingStepView(step('objective'), remapped);
  assert.equal(objective.detail, step('objective').detail);
  assert.equal(move.title, step('move').title);
});
