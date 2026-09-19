import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match} from './core.mjs';
import {CHARACTERS, HARNESSES, RULES} from './data.mjs';
import {resolveKit} from './kits.mjs';
import {cocsTemplate, cocsSnapshot, cocsTeamVisibility, cocsSpotDamageScale} from './cocs.mjs';
import {coopPrimeNode} from './cocs-coop.mjs';
import {terminalInteract} from './cocs-terminals.mjs';
import {latticeCaptureRate, latticeInteractionRate} from './lattice-support.mjs';
import {LATTICE_OPERATOR_ROLES, LATTICE_HARNESS_ROLES, latticeLoadoutRoles} from './lattice-roles.mjs';

const dt = RULES.dt;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const arena = {
  blocks: [], bounds: {minX: -100, maxX: 100, minZ: -100, maxZ: 100},
  nodes: [
    {id: 'hq-0', kind: 'hq', owner: 0, x: -60, z: 0},
    {id: 'point', kind: 'economy', owner: null, x: 0, z: 0, radius: 8},
    {id: 'relay', kind: 'relay', owner: null, x: -25, z: 0, radius: 8},
    {id: 'hq-1', kind: 'hq', owner: 1, x: 60, z: 0},
  ],
  lattice: [['hq-0', 'point'], ['point', 'hq-1'], ['hq-0', 'relay'], ['relay', 'hq-1']],
};
const place = (actor, x = 0, z = 0, team = 0) => Object.assign(actor, {
  x, y: 0, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, pitch: 0,
  bot: null, team, protection: 0, cooldown: 0, active: 0, weaponSwitch: 0,
});
function fixture(character = 'chatgpt', harness = 'openclaw', mode = 'cocs', count = 2) {
  let seed = 17;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const match = new Match(character, harness, random, 'exchange', {
    mode, humanCount: count, botCount: 0, skipNav: true, timeLimit: 900, cocsPolicy: () => [],
  });
  match.arena = arena; match.pickups = []; match.vehicles = [];
  match.actors = match.actors.slice(0, count);
  match.actors.forEach((actor, index) => place(actor, index ? 80 : 0, 0, index ? 1 : 0));
  match.cocsPolicy = () => [];
  if (mode === 'cocs' || mode === 'cocs-coop') {
    match.objectiveState = cocsTemplate(mode, arena, match.config);
    if (match.objectiveState.coop) Object.assign(match.objectiveState.coop, {initialized: true, intermissionTicks: 100000, autoSpend: false});
  }
  return match;
}
const step = (match, count = 1, controls = {}) => {
  for (let i = 0; i < count; i++) match.step(dt, {inputs: {0: controls}});
};
const node = match => match.objectiveState.nodes.find(node => node.id === 'point');
const events = match => match.events.filter(event => event.type === 'lattice-support');

test('pure field-role API covers the actual 9×7 roster, locks loadouts, and stays declarative', () => {
  assert.deepEqual(Object.keys(LATTICE_OPERATOR_ROLES).sort(), CHARACTERS.map(row => row.id).sort());
  assert.deepEqual(Object.keys(LATTICE_HARNESS_ROLES).sort(), HARNESSES.map(row => row.id).sort());
  for (const character of CHARACTERS) for (const harness of HARNESSES) {
    const kit = resolveKit(character.id, harness.id), roles = latticeLoadoutRoles(character.id, harness.id);
    assert.equal(roles.operator, kit.lattice.operator);
    assert.equal(roles.harness, kit.lattice.harness);
    for (const role of Object.values(roles)) {
      assert.ok(role.description.length > 40);
      assert.ok(Object.isFrozen(role.hook));
      assert.ok(['support', 'assault', 'scout', 'engineer'].includes(role.role));
    }
  }
  assert.equal(latticeLoadoutRoles('claude', 'codex').harness, LATTICE_HARNESS_ROLES.claudecode);
  const source = readFileSync(new URL('./lattice-support.mjs', import.meta.url), 'utf8');
  for (const id of [...CHARACTERS, ...HARNESSES].map(row => row.id)) {
    assert.ok(!source.includes(`=== '${id}'`), `no simulation branch on ${id}`);
  }
});

for (const mode of ['cocs', 'cocs-coop']) {
  test(`${mode}: each capture specialist earns a bounded, conditional objective advantage through Match.step`, () => {
    for (const [id, expected] of [['mistral', 1.2], ['gemini', 1.2], ['grok', 1.25], ['qwen', 1.35]]) {
      const match = fixture(id, 'openclaw', mode), actor = match.actors[0];
      step(match);
      const before = node(match).progress[0];
      const controls = {};
      if (id === 'mistral') { actor.vx = 5; controls.x = 1; }
      if (id === 'gemini') { actor.ammo[2] = 20; controls.weapon = 2; step(match, 1, controls); }
      if (id === 'grok') { actor.verbState.heat = .06; actor.verbState.decayIn = 1.5; }
      const start = node(match).progress[0];
      step(match, 1, controls);
      close(node(match).progress[0] - start, dt / match.objectiveState.captureSeconds * expected);
      assert.ok(node(match).progress[0] > before);
      // A crowd never multiplies the same field contribution.
      close(latticeCaptureRate(match, Array(32).fill(actor)), expected);
    }
  });

  test(`${mode}: DeepSeek stationary overwatch and Kimi moving context create team-only, non-damage intel`, () => {
    for (const id of ['deepseek', 'kimi']) {
      const match = fixture(id, 'openclaw', mode), [actor, enemy] = match.actors;
      place(enemy, 16, 0, 1);
      if (id === 'kimi') actor.vx = 5;
      step(match, 1, id === 'kimi' ? {x: 1} : {});
      assert.ok(match.objectiveState.fieldSupport.intel[0][enemy.id], id);
      assert.equal(cocsSnapshot(match).spots.find(spot => spot.id === enemy.id)?.intelOnly, true, 'shipped team-marker renderer receives intel');
      const contacts = cocsTeamVisibility(match, match.objectiveState, 0).contacts;
      assert.ok(contacts.find(contact => contact.id === enemy.id)?.revealed);
      assert.equal(match.objectiveState.fieldSupport.intel[1][enemy.id], undefined);
      assert.equal(cocsSpotDamageScale(match, actor, enemy), 1);
      enemy.powerups.cloak = 2;
      step(match);
      assert.equal(match.objectiveState.fieldSupport.intel[0][enemy.id], undefined, 'cloak removes stale intel');
    }
  });

  test(`${mode}: Meta repairs a cut by committing to a four-second crouch channel`, () => {
    const match = fixture('meta', 'openclaw', mode);
    node(match).owner = 0; match.objectiveState.cuts = ['point'];
    step(match, 120, {crouch: true});
    assert.ok(match.objectiveState.cuts.includes('point'));
    step(match, 1, {x: 1});
    assert.equal(match.objectiveState.fieldSupport.actors[0].channel, 0, 'movement interrupts');
    place(match.actors[0]);
    step(match, 240, {crouch: true});
    assert.ok(!match.objectiveState.cuts.includes('point'));
    assert.equal(events(match).filter(event => event.effect === 'repair').length, 1);
  });

  test(`${mode}: Claude cleanses an ally while holding, and ChatGPT shares actual ammo after a swap`, () => {
    const review = fixture('claude', 'claudecode', mode);
    node(review).owner = 0;
    place(review.actors[1], 2, 0, 0); review.actors[1].slow = 10;
    step(review);
    assert.equal(review.actors[1].slow, 0);
    review.actors[1].slow = 10;
    step(review, 2);
    assert.ok(review.actors[1].slow > 9, 'cleanse cannot spam');

    const supply = fixture('chatgpt', 'openclaw', mode), [actor, ally] = supply.actors;
    node(supply).owner = 0; place(ally, 2, 0, 0);
    actor.weapon = 0; actor.ammo[4] = 40;
    ally.weapon = 4; ally.ammo[4] = 1;
    step(supply);
    const before = actor.ammo[4] + ally.ammo[4];
    step(supply, 1, {weapon: 4});
    assert.ok(ally.ammo[4] > 1);
    close(actor.ammo[4] + ally.ammo[4], before);
    assert.ok(actor.ammo[4] >= 1);
  });

  test(`${mode}: all seven harness field actions execute only after accepted power input`, () => {
    for (const harness of HARNESSES.map(row => row.id)) {
      const match = fixture('qwen', harness, mode), [actor, ally] = match.actors;
      const state = match.objectiveState, target = node(match);
      target.owner = 0; target.progress[1] = .6;
      place(ally, 2, 0, 0); ally.slow = 10; ally.weapon = 4; ally.ammo[4] = 1;
      actor.ammo[4] = 40; actor.req = 10; state.flux[0] = 20;
      if (harness === 'codex') state.cuts = ['point'];
      step(match);
      const beforeAmmo = ally.ammo[4], beforeFlux = state.flux[0];
      step(match, 1, {power: true});
      const action = events(match).find(event => event.source === 'harness');
      assert.equal(action?.effect, LATTICE_HARNESS_ROLES[harness].hook.type, harness);
      if (harness === 'openclaw') assert.ok(target.progress[1] < .45);
      if (harness === 'hermes') { assert.ok(actor.req < 7); assert.ok(state.flux[0] > beforeFlux + 3); }
      if (harness === 'opencode') assert.ok(ally.ammo[4] > beforeAmmo);
      if (harness === 'claudecode') assert.equal(ally.slow, 0);
      if (harness === 'codex') assert.ok(!state.cuts.includes('point'));
      if (harness === 'cline') assert.ok(state.fieldSupport.actors[0].captureUntil > state.tick);
      if (harness === 'roo') assert.equal(state.fieldSupport.nodes.point.ward.resist, .2);
      const count = events(match).filter(event => event.source === 'harness').length;
      step(match, 3, {power: true});
      assert.equal(events(match).filter(event => event.source === 'harness').length, count, 'held/rejected power is inert');
    }
  });
}

test('Qwen accelerates actual terminal and PRIME channels; NPCs do not inherit Tool Use', () => {
  for (const character of ['qwen', 'chatgpt']) {
    const match = fixture(character, 'openclaw', 'cocs-coop'), actor = match.actors[0], state = match.objectiveState;
    node(match).owner = 0;
    assert.equal(coopPrimeNode(match, state, actor, 'point').ok, true);
    const terminal = Object.values(state.terminals.terminals).find(entry => entry.kind === 'HACK');
    assert.ok(terminal);
    place(actor, terminal.x, terminal.z);
    assert.equal(terminalInteract(match, state, actor.id, terminal.id).ok, true);
    const initial = terminal.channel.remaining;
    step(match);
    close(initial - terminal.channel.remaining, dt * (character === 'qwen' ? 1.35 : 1));
    place(actor);
    // Re-arm PRIME after leaving its leash for the terminal.
    state.nodes.find(entry => entry.id === 'point').primeChannel = null;
    coopPrimeNode(match, state, actor, 'point');
    const primeStart = node(match).primeChannel.remaining;
    step(match);
    close(primeStart - node(match).primeChannel.remaining, dt * (character === 'qwen' ? 1.35 : 1));
    actor.isNpc = true;
    assert.equal(latticeInteractionRate(match, actor), 1);
  }
});

test('field bonuses take max with HACK/PRIME, preserve contest, and ward uses max with FORTIFY', () => {
  const match = fixture('qwen', 'roo'), [actor, enemy] = match.actors, target = node(match);
  target.hack = {team: 0, until: 100, multiplier: 2};
  target.prime = {team: 0, until: 100, captureUntil: 100, captureMultiplier: 1.5};
  step(match);
  close(target.progress[0], dt / match.objectiveState.captureSeconds * 3);
  place(enemy, 1, 0, 1); const before = target.progress[0];
  step(match);
  assert.ok(target.progress[0] < before, 'no capture through contest');
  target.owner = 0; target.progress = {0: 0, 1: 0};
  step(match, 1, {power: true});
  place(actor, 50);
  const progress = target.progress[1];
  step(match);
  close(target.progress[1] - progress, dt / match.objectiveState.captureSeconds * .8);
  target.captureResist = .4;
  const fortified = target.progress[1];
  step(match);
  close(target.progress[1] - fortified, dt / match.objectiveState.captureSeconds * .6);
});

test('courier conversion is solvent, cap-aware, connectivity-gated, and shared per point', () => {
  const match = fixture('qwen', 'hermes', 'cocs', 3), state = match.objectiveState, actor = match.actors[0];
  node(match).owner = 0; actor.req = 10; state.flux[0] = state.fluxCap - 1;
  state.fluxPassive = 0;
  step(match, 1, {power: true});
  close(actor.reqSpent, 4 / 3);
  close(state.flux[0], state.fluxCap);
  const spent = actor.reqSpent;
  // Another courier cannot bypass the point cooldown.
  const second = match.actor(3, 'qwen', 'hermes'); match.actors.push(second); match.spawn(second);
  place(second, 2, 0, 0); second.req = 10;
  state.flux[0] = 20;
  match.step(dt, {inputs: {3: {power: true}}});
  assert.equal(second.reqSpent ?? 0, 0);
  assert.equal(actor.reqSpent, spent);
  // Full pool, cut link, or insufficient personal REQ never spend currency.
  for (const scenario of ['full', 'cut', 'poor']) {
    const m = fixture('qwen', 'hermes'), a = m.actors[0], s = m.objectiveState;
    node(m).owner = 0; a.req = scenario === 'poor' ? 0 : 10;
    s.flux[0] = scenario === 'full' ? s.fluxCap : 20;
    if (scenario === 'cut') s.cuts = ['point'];
    step(m, 1, {power: true});
    assert.equal(a.reqSpent ?? 0, 0, scenario);
    assert.equal(events(m).filter(event => event.effect === 'delivery').length, 0);
  }
});

test('supply conserves ammo, respects source/recipient caps, and duplicate supports cannot stack', () => {
  const match = fixture('qwen', 'opencode', 'cocs', 4), [actor, ally, ally2, enemy] = match.actors;
  node(match).owner = 0;
  place(ally, 2, 0, 0); place(ally2, -2, 0, 0); place(enemy, 3, 0, 1);
  for (const target of [ally, ally2, enemy]) { target.weapon = 4; target.ammo[4] = 1; }
  ally.ammo[4] = match.weaponForIndex(ally, 4).cap - 1;
  actor.ammo[4] = 4;
  const total = match.actors.reduce((sum, a) => sum + a.ammo[4], 0);
  step(match, 1, {power: true});
  close(match.actors.reduce((sum, a) => sum + a.ammo[4], 0), total);
  assert.equal(actor.ammo[4], 1, 'donor keeps its last round');
  assert.equal(ally.ammo[4], match.weaponForIndex(ally, 4).cap);
  assert.equal(ally2.ammo[4], 3);
  assert.equal(enemy.ammo[4], 1);
  // Respawn/loadout manipulation cannot re-open a recipient cooldown.
  const other = match.actor(4, 'qwen', 'opencode'); match.actors.push(other); match.spawn(other);
  place(other, 0, 2, 0); other.ammo[4] = 40;
  match.step(dt, {inputs: {4: {power: true}}});
  assert.equal(ally2.ammo[4], 3);
});

test('duplicate disruption/wards share node budgets; capture windows expire and reset on death', () => {
  for (const harness of ['openclaw', 'roo']) {
    const match = fixture('qwen', harness), state = match.objectiveState, target = node(match);
    const other = match.actor(2, 'qwen', harness); match.actors.push(other); match.spawn(other); place(other, 2);
    target.owner = 0; target.progress[1] = .7;
    match.step(dt, {inputs: {0: {power: true}, 2: {power: true}}});
    assert.equal(events(match).filter(event => event.source === 'harness').length, 1, harness);
    if (harness === 'openclaw') assert.ok(target.progress[1] > .54, 'only one 15% disruption');
    else assert.equal(state.fieldSupport.nodes.point.ward.until, state.tick + 240);
  }
  const match = fixture('gemini', 'cline'), actor = match.actors[0];
  actor.ammo[2] = 12;
  step(match, 1, {weapon: 2});
  assert.ok(match.objectiveState.fieldSupport.actors[0].captureUntil > 0, 'first-tick accepted swap is observed');
  const until = match.objectiveState.fieldSupport.actors[0].captureUntil;
  step(match, 1, {weapon: 3});
  assert.equal(match.objectiveState.fieldSupport.actors[0].captureUntil, until, 'rapid swaps cannot refresh');
  step(match, 182);
  close(latticeCaptureRate(match, [actor]), 1);
  // A fresh dash window must not survive a subsequent death/respawn.
  step(match, 1, {power: true});
  assert.ok(latticeCaptureRate(match, [actor]) > 1);
  actor.deaths++;
  close(latticeCaptureRate(match, [actor]), 1);
});

test('NPCs, vehicles, dead sources and out-of-range activations cannot apply field support', () => {
  for (const blocked of ['npc', 'vehicle', 'dead', 'range']) {
    const match = fixture('qwen', 'codex'), actor = match.actors[0];
    node(match).owner = 0; match.objectiveState.cuts = ['point'];
    if (blocked === 'npc') actor.isNpc = true;
    if (blocked === 'vehicle') actor.vehicleId = 'absent';
    if (blocked === 'dead') { actor.health = 0; actor.dead = 100; }
    if (blocked === 'range') place(actor, 40);
    step(match, 1, {power: true});
    assert.ok(match.objectiveState.cuts.includes('point'), blocked);
    assert.equal(events(match).length, 0, blocked);
  }
});

test('repair channels reset under damage/contest; recon requires LoS and preserves a stronger SCAN', () => {
  const repair = fixture('meta', 'codex'), actor = repair.actors[0];
  node(repair).owner = 0; repair.objectiveState.cuts = ['point'];
  step(repair, 120, {crouch: true});
  repair.damage(actor, 1, repair.actors[1]);
  step(repair, 1, {crouch: true});
  assert.equal(repair.objectiveState.fieldSupport.actors[0].channel, 0);
  place(repair.actors[1], 2, 0, 1);
  step(repair, 1, {power: true, crouch: true});
  assert.ok(repair.objectiveState.cuts.includes('point'), 'activation cannot repair a contested point');
  const recon = fixture('deepseek'), enemy = recon.actors[1];
  place(enemy, 16, 0, 1);
  recon.arena = {...arena, blocks: [{x: 8, z: 0, w: 2, d: 10, h: 10}]};
  step(recon);
  assert.equal(recon.objectiveState.spots[enemy.id], undefined, 'wall blocks recon');
  recon.arena = arena;
  recon.objectiveState.spots[enemy.id] = {team: 0, until: 999, by: 99};
  step(recon);
  assert.equal(recon.objectiveState.spots[enemy.id].by, 99);
  close(cocsSpotDamageScale(recon, recon.actors[0], enemy), 1.15);
});

test('non-LATTICE modes get no field effects or state for every operator/harness pair', () => {
  for (const character of CHARACTERS) for (const harness of HARNESSES) {
    const match = fixture(character.id, harness.id, 'teamdeathmatch');
    step(match, 2, {power: true});
    assert.equal(events(match).length, 0);
    assert.equal(match.objectiveState?.fieldSupport, undefined);
    assert.equal(latticeInteractionRate(match, match.actors[0]), 1);
  }
});

test('fixed-seed field outcomes and detached snapshots are deterministic across every legal loadout', () => {
  for (const character of CHARACTERS) for (const harness of HARNESSES) {
    const run = () => {
      const match = fixture(character.id, harness.id);
      node(match).owner = 0;
      place(match.actors[1], 2, 0, 0); match.actors[1].slow = 10;
      step(match, 12, {power: true, x: 1});
      return {state: cocsSnapshot(match), events: events(match)};
    };
    assert.deepEqual(run(), run(), `${character.id}/${harness.id}`);
  }
  const match = fixture(); step(match);
  const snapshot = cocsSnapshot(match);
  snapshot.fieldSupport.actors[0].captureUntil = 9999;
  assert.notEqual(match.objectiveState.fieldSupport.actors[0].captureUntil, 9999);
});
