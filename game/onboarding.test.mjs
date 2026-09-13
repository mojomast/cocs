import test from 'node:test';
import assert from 'node:assert/strict';
import {ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, shouldShowOnboarding} from './onboarding.mjs';

test('onboarding steps are complete and address the core loop', () => {
  assert.ok(ONBOARDING_STEPS.length >= 4);
  assert.equal(ONBOARDING_STORAGE_KEY, 'token-arena-onboarded');
  for (const step of ONBOARDING_STEPS) {
    assert.equal(typeof step.id, 'string');
    assert.ok(typeof step.title === 'string' && step.title.length > 0);
    assert.ok(typeof step.detail === 'string' && step.detail.length > 20);
  }
  const ids = ONBOARDING_STEPS.map(step => step.id);
  for (const expected of ['move', 'fight', 'objective']) assert.ok(ids.includes(expected), expected);
});

test('onboarding shows once', () => {
  assert.equal(shouldShowOnboarding(undefined, false), true);
  assert.equal(shouldShowOnboarding('1', false), false);
  assert.equal(shouldShowOnboarding(true, false), false);
});
