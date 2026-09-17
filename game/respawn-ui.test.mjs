// Phase 4 respawn overlay gate (§3.7, §6.2). Pure view-model tests: the screen
// itself is covered by tests/ui-contract.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { respawnSwitchAllowed, respawnOverlayView } from './respawn-ui.mjs';

test('respawn switching is team modes minus puma race/soccer and single-player', () => {
  for (const mode of ['ctf', 'koth', 'domination', 'assault', 'teamdeathmatch', 'combined-arms', 'payload', 'holdout', 'uplink', 'team-elimination', 'vip-escort']) {
    assert.equal(respawnSwitchAllowed(mode), true, `${mode} allows switching`);
  }
  for (const mode of ['deathmatch', 'armsrace', 'instagib', 'rockets', 'arsenal', 'juggernaut', 'puma-race', 'puma-soccer', 'horde', 'campaign', null, undefined, '']) {
    assert.equal(respawnSwitchAllowed(mode), false, `${String(mode)} locks the pick`);
  }
});

test('the overlay opens only for a dead team-mode actor outside sudden death', () => {
  const hud = { config: { mode: 'ctf' }, suddenDeath: false, over: false, feed: [] };
  const dead = { health: 0, character: 'mistral', harness: 'openclaw', dead: 2 };
  const view = respawnOverlayView(hud, dead);
  assert.equal(view.open, true);
  assert.equal(view.character, 'mistral');
  assert.equal(view.harness, 'openclaw');
  assert.equal(view.respawnIn, 2);
  assert.equal(respawnOverlayView(hud, { ...dead, health: 100 }).open, false, 'alive actors never see the overlay');
  assert.equal(respawnOverlayView({ ...hud, suddenDeath: true }, dead).open, false, 'sudden death locks the pick');
  assert.equal(respawnOverlayView({ ...hud, objectives: { suddenDeath: true } }, dead).open, false);
  assert.equal(respawnOverlayView({ ...hud, over: true }, dead).open, false, 'a finished match locks the pick');
  assert.equal(respawnOverlayView(hud, { ...dead, isVip: true }).open, false, 'the VIP is locked');
  assert.equal(respawnOverlayView({ ...hud, config: { mode: 'deathmatch' } }, dead).open, false, 'FFA is locked');
  assert.equal(respawnOverlayView({ ...hud, config: { mode: 'puma-soccer' } }, dead).open, false, 'soccer is locked');
  assert.equal(respawnOverlayView({ ...hud, config: { mode: 'horde' } }, dead).open, false, 'single-player is locked');
});
