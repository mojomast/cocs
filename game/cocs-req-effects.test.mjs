// WP1.3 truthful personal REQ slice: every catalogue row the picker offers must
// create an authoritative world-state delta through the real `Match.step`
// purchase path in each mode it claims, and a refused or unavailable purchase
// must never debit REQ or occupy `reqBuff`/world state.
//
// Plan: docs/V8.4-IMPROVEMENT-PLAN.md WP1.3 / B4. Design authority:
// COCS-MODE-SPEC §6A.5 (catalogue), §6A.7 (depot spend point).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {RULES} from './data.mjs';
import {cocsBuyAction} from './cocs.mjs';
import {coopBuyAction} from './cocs-coop.mjs';
import {REQ_MODE_IDS, reqPurchaseOptions} from './cocs-economy.mjs';

const DT = RULES.dt;
const mulberry32 = seed => {
 let a = seed >>> 0;
 return () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
};
// Two real matches with the shipped arena/Match construction. OPERATIONS runs on
// `lattice-slice`, the traversal-authored map that carries the depot the Puma
// spends at (`warfront` has no traversal layer).
const pvpMatch = (over = {}) => new Match('chatgpt', 'openclaw', mulberry32(11), 'warfront', {mode: 'cocs', botCount: 2, humanCount: 4, aiSeats: true, timeLimit: 300, ...over});
const coopMatch = (over = {}) => new Match('chatgpt', 'openclaw', mulberry32(7), 'lattice-slice', {mode: 'cocs-coop', botCount: 2, humanCount: 4, aiSeats: true, timeLimit: 900, ...over});
// One fixed step carrying the buy exactly as the wire path does.
const buy = (match, actor, itemId, extra = {}) => {
 const state = match.objectiveState;
 match.step(DT, {cocs: {buys: [{tick: state.tick, peerId: 'p1', cardId: `buy-${itemId}`, actorId: actor.id, itemId, ...extra}]}});
};
// The world slice a purchase is allowed to change, minus the wallet/buff fields
// the spend itself owns. Two different digests = one real world-state delta.
const worldDigest = (match, actor) => JSON.stringify({
 health: actor.health,
 temporaryShield: actor.temporaryShield ?? 0,
 haste: actor.powerups?.haste ?? 0,
 ammo: actor.ammo ?? [],
 vehicles: match.vehicles.map(vehicle => ({id: vehicle.id, depotId: vehicle.depotId ?? null})),
 purchases: Object.values(match.objectiveState.traversal?.depots ?? {}).map(depot => ({id: depot.id, purchaseId: depot.purchaseId ?? null})),
});
// Purchase-owned world state only: a refused buy must not move any of it. The
// free depot loaners and bot movement/combat are deliberately excluded because
// the sim initializes them on the same step regardless of the purchase.
const purchaseDigest = (match, actor) => JSON.stringify({
 temporaryShield: actor.temporaryShield ?? 0,
 haste: actor.powerups?.haste ?? 0,
 ammo: actor.ammo ?? [],
 bought: match.vehicles.filter(vehicle => vehicle.purchasedBy !== undefined && vehicle.purchasedBy !== null).map(vehicle => ({id: vehicle.id, depotId: vehicle.depotId ?? null, by: vehicle.purchasedBy})),
 purchases: Object.values(match.objectiveState.traversal?.depots ?? {}).map(depot => ({id: depot.id, purchaseId: depot.purchaseId ?? null})),
});
const offeredIds = (mode, match) => reqPurchaseOptions({team: 0, mode, actor: match.actors[0], state: match.objectiveState})
 .items.filter(entry => entry.modes.includes(mode)).map(entry => entry.id);

// One case per advertised row: `arm(actor, match, state)` makes the effect
// observable, `verify(actor, match, state)` asserts the exact world delta the
// catalogue copy promises.
const CASES = {
 'field-repair': {
  cost: 40,
  arm: actor => { actor.health = 40; actor.temporaryShield = 0; },
  verify: actor => assert.equal(actor.health, 90, '+50 health, capped at max health'),
 },
 'ammo-crate': {
  cost: 25,
  arm: actor => { actor.ammo[1] = 0; },
  verify: (actor, match) => {
   const cap = match.weaponForIndex(actor, 1)?.cap;
   assert.ok(Number.isFinite(cap) && cap > 0, 'slot 1 has a finite magazine cap');
   assert.equal(actor.ammo[1], cap, 'the magazine refills to capacity');
  },
 },
 haste: {
  cost: 35,
  arm: actor => { actor.powerups ??= {}; actor.powerups.haste = 0; },
  verify: actor => assert.equal(actor.powerups.haste, 15, 'the 15 s haste window is set'),
 },
 overshield: {
  cost: 50,
  arm: actor => { actor.temporaryShield = 0; },
  verify: actor => assert.equal(actor.temporaryShield, 50, 'the 50-point temporary shield is set'),
 },
 puma: {
  cost: 150,
  arm: (actor, match, state) => { state.traversal.depots['depot-hq-w'].owner = 0; },
  verify: (actor, match, state) => {
   const depot = state.traversal.depots['depot-hq-w'];
   assert.ok(depot.purchaseId, 'the depot records the purchase');
   const vehicle = match.vehicles.find(entry => entry.id === depot.purchaseId);
   assert.ok(vehicle && vehicle.depotId === 'depot-hq-w', 'the Puma spawns at its depot');
  },
 },
};

test('every PvPvE-offered REQ row writes its advertised world delta through Match.step', () => {
 const mode = REQ_MODE_IDS.pvp;
 assert.deepEqual(offeredIds(mode, pvpMatch()), ['field-repair', 'ammo-crate', 'haste', 'overshield'], 'the tested set is exactly what the picker offers in PvPvE');
 for (const id of offeredIds(mode, pvpMatch())) {
  const match = pvpMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  const testCase = CASES[id];
  testCase.arm(actor, match, state);
  actor.req = 500; actor.reqSpent = 0; actor.reqBuff = undefined;
  const digestBefore = worldDigest(match, actor);
  buy(match, actor, id);
  testCase.verify(actor, match, state);
  assert.notEqual(worldDigest(match, actor), digestBefore, `${id} changed world state, not just the wallet`);
  assert.equal(actor.req, 500 - testCase.cost, `${id} debits its exact cost`);
  assert.equal(actor.reqSpent, testCase.cost, `${id} records the spend`);
  assert.equal(actor.reqBuff, id, `${id} stamps the personal buff`);
 }
});

test('every OPERATIONS-offered REQ row (including the Puma) writes its advertised world delta through Match.step', () => {
 const mode = REQ_MODE_IDS.coop;
 assert.deepEqual(offeredIds(mode, coopMatch()), ['field-repair', 'ammo-crate', 'haste', 'overshield', 'puma'], 'the tested set is exactly what the picker offers in OPERATIONS');
 for (const id of offeredIds(mode, coopMatch())) {
  const match = coopMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  const testCase = CASES[id];
  testCase.arm(actor, match, state);
  actor.req = 500; actor.reqSpent = 0; actor.reqBuff = undefined;
  const digestBefore = worldDigest(match, actor);
  buy(match, actor, id, id === 'puma' ? {depotId: 'depot-hq-w'} : {});
  testCase.verify(actor, match, state);
  assert.notEqual(worldDigest(match, actor), digestBefore, `${id} changed world state, not just the wallet`);
  assert.equal(actor.req, 500 - testCase.cost, `${id} debits its exact cost`);
  assert.equal(actor.reqSpent, testCase.cost, `${id} records the spend`);
  // `reqBuff` is the personal-buff slot: the launched buffs own it. The Puma is
  // a vehicle row and its authoritative state is the spawned depot Puma above.
  if (id !== 'puma') assert.equal(actor.reqBuff, id, `${id} stamps the personal buff`);
 }
});

test('refused and unavailable REQ purchases preserve REQ, reqBuff and world state in both modes', () => {
 // Unsupported catalogue rows: never purchasable through the sim in either mode.
 for (const [mode, match] of [[REQ_MODE_IDS.pvp, pvpMatch()], [REQ_MODE_IDS.coop, coopMatch()]]) {
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.req = 500; actor.reqSpent = 0; actor.reqBuff = undefined;
  const digestBefore = purchaseDigest(match, actor);
  buy(match, actor, 'sentry');
  assert.equal(actor.req, 500, `${mode}: an unsupported row never debits`);
  assert.equal(actor.reqSpent, 0, `${mode}: an unsupported row never records a spend`);
  assert.equal(actor.reqBuff, undefined, `${mode}: an unsupported row never occupies the buff slot`);
  assert.equal(purchaseDigest(match, actor), digestBefore, `${mode}: an unsupported row changes no purchase state`);
  assert.equal((state.coop?.buyLog ?? []).length, 0, `${mode}: no OPERATIONS buy log entry`);
  const direct = state.coop ? coopBuyAction(match, state, {actorId: actor.id, peerId: 'p1', itemId: 'sentry'}) : cocsBuyAction(match, state, {actorId: actor.id, peerId: 'p1', itemId: 'sentry'});
  assert.equal(direct.ok, false);
  assert.equal(direct.reason, 'not-launched');
 }

 // The Puma is wrong-mode for PvPvE: the sim path refuses before any debit.
 {
  const match = pvpMatch();
  const actor = match.actors[0];
  actor.req = 500; actor.reqSpent = 0; actor.reqBuff = undefined;
  const digestBefore = purchaseDigest(match, actor);
  buy(match, actor, 'puma', {depotId: 'depot-hq-w'});
  assert.equal(actor.req, 500, 'PvPvE puma never debits');
  assert.equal(actor.reqSpent, 0);
  assert.equal(actor.reqBuff, undefined);
  assert.equal(purchaseDigest(match, actor), digestBefore, 'PvPvE puma spawns nothing');
  assert.equal(cocsBuyAction(match, match.objectiveState, {actorId: actor.id, peerId: 'p1', itemId: 'puma', depotId: 'depot-hq-w'}).reason, 'not-launched');
 }

 // Insufficient REQ: the exact float decides and the refusal is inert.
 {
  const match = coopMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.req = 39; actor.reqSpent = 0; actor.reqBuff = undefined; actor.health = 40;
  buy(match, actor, 'field-repair');
  assert.equal(actor.req, 39, 'an unaffordable row never debits');
  assert.equal(actor.reqSpent, 0);
  assert.equal(actor.health, 40, 'no heal lands');
  assert.equal(actor.reqBuff, undefined, 'no buff state is occupied');
  assert.equal((state.coop.buyLog ?? []).length, 0, 'no OPERATIONS buy log entry');
  const direct = coopBuyAction(match, state, {actorId: actor.id, peerId: 'p1', itemId: 'field-repair'});
  assert.equal(direct.reason, 'insufficient-req');
 }

 // One active buff: a conflicting buff is refused and changes nothing, while a
 // re-buy of the active buff is still allowed to refresh (fresh card identity).
 {
  const match = pvpMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  actor.req = 500; actor.reqSpent = 0; actor.reqBuff = undefined;
  buy(match, actor, 'overshield');
  assert.equal(actor.req, 450);
  assert.equal(actor.reqBuff, 'overshield');
  const digestBefore = purchaseDigest(match, actor);
  buy(match, actor, 'haste');
  assert.equal(actor.req, 450, 'the refused conflicting buff never debits');
  assert.equal(actor.reqSpent, 50, 'only the first buff was charged');
  assert.equal(actor.powerups?.haste ?? 0, 0, 'no haste window is created');
  assert.equal(actor.reqBuff, 'overshield', 'the active buff slot is unchanged');
  assert.equal(purchaseDigest(match, actor), digestBefore);
  assert.equal(cocsBuyAction(match, state, {actorId: actor.id, peerId: 'p1', itemId: 'haste'}).reason, 'one-active-buff');
 }

 // A vehicle row is not a personal buff: even if the vehicle path stamps the
 // buff slot, a later personal buff is not blocked by it.
 {
  const match = coopMatch();
  const state = match.objectiveState;
  const actor = match.actors[0];
  state.traversal.depots['depot-hq-w'].owner = 0;
  actor.req = 350; actor.reqSpent = 0; actor.reqBuff = undefined;
  buy(match, actor, 'puma', {depotId: 'depot-hq-w'});
  assert.equal(actor.req, 200, 'the Puma debit lands');
  actor.reqBuff = 'puma';
  buy(match, actor, 'haste');
  assert.equal(actor.req, 165, 'a vehicle stamp never blocks a personal buff');
  assert.equal(actor.powerups?.haste, 15, 'the buff window lands');
  assert.equal(actor.reqBuff, 'haste', 'the slot now holds the real buff');
 }
});
