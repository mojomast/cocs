// WP1.3 personal REQ purchase surface: real-model tests for the dispatched
// record shape, the snapshot-only confirmation rule and the refusal path, plus
// focused source assertions for the page wiring (the page itself needs a
// browser pointer lock, so it cannot be mounted in-process).
//
// Plan: docs/V8.4-IMPROVEMENT-PLAN.md WP1.3. Data authority:
// game/cocs-economy.mjs `reqPurchaseOptions`; sim authority:
// `Match.prepareCocs` -> `coopBuyAction` / `cocsBuyAction`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Match} from '../game/core.mjs';
import {RULES} from '../game/data.mjs';
import {reqPurchaseOptions} from '../game/cocs-economy.mjs';

register('./tsx-loader.mjs', import.meta.url);
const {CommandBoardHud, ReqStore, reconcileReqBuys, reqReasonCopy} = await import('../app/ui/screens/CommandBoardHud.tsx');

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
// Shipped arena construction: OPERATIONS runs on the traversal-authored
// `lattice-slice` (the map that carries the depot the Puma spends at).
const pvpMatch = (over = {}) => new Match('chatgpt', 'openclaw', mulberry32(11), 'warfront', {mode: 'cocs', botCount: 2, humanCount: 4, aiSeats: true, timeLimit: 300, ...over});
const coopMatch = (over = {}) => new Match('chatgpt', 'openclaw', mulberry32(7), 'lattice-slice', {mode: 'cocs-coop', botCount: 2, humanCount: 4, aiSeats: true, timeLimit: 900, ...over});

// The pending shape the page records at dispatch. `baselineSpent` is the HUD
// snapshot's `reqSpent` for the actor when the button was pressed.
const pendingBuy = (over = {}) => ({
  cardId: 'buy-0-10-1', itemId: 'field-repair', label: 'Field Repair', cost: 40,
  actorId: 0, tick: 10, baselineSpent: 0, sinceEventId: 0, status: 'queued', ...over,
});

test('the real catalogue drives the rendered store in both modes', () => {
  const pvp = pvpMatch();
  const coop = coopMatch();
  const pvpModel = reqPurchaseOptions({team: 0, mode: 'cocs', actor: {id: 0, req: 200, reqBuff: null}, state: pvp.objectiveState});
  const coopModel = reqPurchaseOptions({team: 0, mode: 'cocs-coop', actor: {id: 0, req: 200, reqBuff: null}, state: coop.objectiveState});
  assert.deepEqual(pvpModel.items.map(item => item.id), ['field-repair', 'ammo-crate', 'haste', 'overshield', 'puma'], 'the PvPvE picker offers the four launched buffs plus the wrong-mode Puma');
  assert.equal(pvpModel.items.find(item => item.id === 'puma').disabledReason, 'wrong-mode', 'the Puma is never launched in PvPvE');
  assert.deepEqual(coopModel.items.map(item => item.id), ['field-repair', 'ammo-crate', 'haste', 'overshield', 'puma'], 'OPERATIONS offers the depot Puma too');
  for (const model of [pvpModel, coopModel]) {
    const html = render(ReqStore, {req: model, pending: [], onBuy: () => {}, reducedMotion: false, defaultOpen: true});
    for (const item of model.items) {
      assert.ok(html.includes(item.name), `${item.id} name is rendered`);
      assert.ok(html.includes(item.effectCopy), `${item.id} effect copy is rendered`);
      assert.ok(html.includes(`COST <b>${item.cost}</b> REQ`), `${item.id} cost is rendered`);
      assert.ok(html.includes(item.enabled ? 'READY · AFFORDABLE' : reqReasonCopy(item.disabledReason)), `${item.id} state is truthful`);
    }
    assert.match(html, /AUTHORITATIVE BALANCE <b>200<\/b> REQ/, 'the balance comes from the model');
  }
});

test('a queued purchase is never confirmed until the authoritative snapshot changes', () => {
  const pending = [pendingBuy()];
  const held = reconcileReqBuys(pending, {actorId: 0, tick: 12, spent: 0, buys: [], events: []});
  assert.deepEqual(held.confirmed, [], 'dispatch alone confirms nothing');
  assert.deepEqual(held.refused, []);
  assert.equal(held.remaining.length, 1, 'the row stays pending while REQ is unchanged');
  const short = reconcileReqBuys(pending, {actorId: 0, tick: 11, spent: 39.999});
  assert.deepEqual(short.confirmed, [], 'a partial debit never confirms a 40 REQ purchase');
  const debited = reconcileReqBuys(pending, {actorId: 0, tick: 11, spent: 40});
  assert.equal(debited.confirmed.length, 1, 'the exact authoritative debit confirms');
  assert.equal(debited.remaining.length, 0, 'the confirmed row leaves the pending list');
  const evented = reconcileReqBuys(pending, {actorId: 0, tick: 11, spent: 0, events: [{id: 5, type: 'cocs-buy', actor: 0, itemId: 'field-repair', cost: 40}]});
  assert.equal(evented.confirmed.length, 1, 'a cocs-buy event confirms');
  const logged = reconcileReqBuys(pending, {actorId: 0, tick: 11, buys: [{tick: 11, actor: 0, itemId: 'field-repair'}]});
  assert.equal(logged.confirmed.length, 1, 'an OPERATIONS buyLog entry confirms');
  const foreign = reconcileReqBuys(pending, {actorId: 7, tick: 11, spent: 0, buys: [{tick: 11, actor: 0, itemId: 'field-repair'}], events: [{id: 9, type: 'cocs-buy', actor: 0, itemId: 'field-repair'}]});
  assert.deepEqual(foreign.confirmed, [], 'another actor\'s debit never confirms this purchase');
});

test('a shared debit confirms only the deterministic work it can pay for', () => {
  const pending = [
    pendingBuy({cardId: 'a', itemId: 'field-repair', label: 'Field Repair', cost: 40}),
    pendingBuy({cardId: 'b', itemId: 'ammo-crate', label: 'Ammo Crate', cost: 25}),
  ];
  const partial = reconcileReqBuys(pending, {actorId: 0, tick: 6, spent: 25});
  assert.deepEqual(partial.confirmed.map(buy => buy.itemId), ['ammo-crate'], '25 spent cannot fake the 40 REQ row');
  assert.deepEqual(partial.remaining.map(buy => buy.itemId), ['field-repair']);
  const both = reconcileReqBuys(pending, {actorId: 0, tick: 7, spent: 65});
  assert.deepEqual(both.confirmed.map(buy => buy.itemId).sort(), ['ammo-crate', 'field-repair']);
});

test('a refusal names its reason and drops the pending row', () => {
  const denied = reconcileReqBuys([pendingBuy({refusalReason: 'one-active-buff'})], {actorId: 0, tick: 11, spent: 0});
  assert.equal(denied.refused.length, 1);
  assert.equal(denied.refused[0].reason, 'one-active-buff');
  assert.equal(denied.remaining.length, 0, 'a refused row never lingers as pending');
  assert.equal(reqReasonCopy('one-active-buff'), 'ANOTHER BUFF IS ACTIVE', 'the refusal reason is player-facing');
  assert.equal(reqReasonCopy('depot'), 'DEPOT', 'unknown reasons fall back to a readable word');
  const expired = reconcileReqBuys([pendingBuy()], {actorId: 0, tick: 200, spent: 0, graceTicks: 90, reasonFor: () => 'insufficient-req'});
  assert.equal(expired.refused.length, 1, 'grace expiry refuses an unconfirmed row');
  assert.equal(expired.refused[0].reason, 'insufficient-req', 'the page-supplied snapshot reason is used');
  const silent = reconcileReqBuys([pendingBuy()], {actorId: 0, tick: 200, spent: 0, graceTicks: 90});
  assert.equal(silent.refused[0].reason, 'not-applied', 'an unknown refusal is still honest');
  assert.equal(reqReasonCopy(silent.refused[0].reason), 'NOT APPLIED');
});

test('the record shape the page queues is applied by the real Match.step buy path and confirms from the snapshot', () => {
  // OPERATIONS: the deterministic record the page pushes into r.cocsBuys.
  const coop = coopMatch();
  const actor = coop.actors[0];
  actor.req = 500; actor.reqSpent = 0; actor.reqBuff = undefined;
  const state = coop.objectiveState;
  const tick = Number(state.tick) || 0;
  const record = {tick, peerId: '0', cardId: `buy-0-${tick}-1`, team: 0, actorId: actor.id, itemId: 'ammo-crate'};
  coop.step(RULES.dt, {cocs: {buys: [record]}});
  assert.equal(actor.req, 475, 'the queued record debits its exact cost');
  assert.equal(actor.reqSpent, 25);
  assert.equal(state.coop.buyLog.at(-1).itemId, 'ammo-crate', 'the authoritative buy log records the purchase');
  const snapshot = coop.snapshot().cocs;
  const row = snapshot.req.find(entry => String(entry.id) === String(actor.id));
  const confirmed = reconcileReqBuys([{...pendingBuy({itemId: 'ammo-crate', label: 'Ammo Crate', cost: 25, baselineSpent: 0})}], {actorId: actor.id, tick: snapshot.tick, spent: row.spent, buys: snapshot.buys, events: coop.events});
  assert.equal(confirmed.confirmed.length, 1, 'the real snapshot confirms the queued record');
  assert.equal(confirmed.remaining.length, 0);

  // PvPvE: the same shape, no buy log, confirmed by the authoritative REQ delta.
  const pvp = pvpMatch();
  const pvActor = pvp.actors[0];
  pvActor.req = 500; pvActor.reqSpent = 0; pvActor.reqBuff = undefined;
  const pvTick = Number(pvp.objectiveState.tick) || 0;
  pvp.step(RULES.dt, {cocs: {buys: [{tick: pvTick, peerId: '0', cardId: `buy-0-${pvTick}-1`, team: 0, actorId: pvActor.id, itemId: 'haste'}]}});
  assert.equal(pvActor.req, 465, 'PvPvE queue path debits REQ');
  const pvSnapshot = pvp.snapshot().cocs;
  const pvRow = pvSnapshot.req.find(entry => String(entry.id) === String(pvActor.id));
  const pvConfirmed = reconcileReqBuys([pendingBuy({itemId: 'haste', label: 'Haste', cost: 35, tick: pvTick, baselineSpent: 0})], {actorId: pvActor.id, tick: pvSnapshot.tick, spent: pvRow.spent, buys: [], events: []});
  assert.equal(pvConfirmed.confirmed.length, 1, 'the spend delta confirms without a per-item log');

  // A doomed local Puma (no owned depot) never debits: the page pre-gates it.
  const doomed = coopMatch();
  const doomedActor = doomed.actors[0];
  doomedActor.req = 500; doomedActor.reqSpent = 0; doomedActor.reqBuff = undefined;
  doomed.step(RULES.dt, {cocs: {buys: [{tick: Number(doomed.objectiveState.tick) || 0, peerId: '0', cardId: 'buy-0-1-1', team: 0, actorId: doomedActor.id, itemId: 'puma', depotId: 'depot-hq-e'}]}});
  assert.equal(doomedActor.req, 500, 'an unusable depot purchase preserves REQ');
  assert.equal((doomed.objectiveState.coop.buyLog ?? []).length, 0, 'a refused Puma leaves no authoritative log entry');
});

test('the page wires buyCocs to the deterministic local queue and net.buy without claiming acceptance', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /import \{reqPurchaseOptions\} from '\.\.\/game\/cocs-economy\.mjs'/, 'the page reads the shared catalogue, not its own prices');
  assert.match(page, /import \{depotPurchaseState\} from '\.\.\/game\/cocs-traversal\.mjs'/, 'the page pre-gates the depot Puma against the real depot state');
  assert.match(page, /import \{reconcileReqBuys,reqReasonCopy\} from '\.\/ui\/screens\/CommandBoardHud'/, 'the page imports the shared confirmation model');
  const dispatch = page.slice(page.indexOf('const buyCocs='), page.indexOf('if(runtime.current)cocsBoardControlRef.current='));
  assert.ok(dispatch.length > 0, 'the dispatch handler is present');
  assert.match(dispatch, /const buyCocs=\(itemId:string,options\?:\{depotId\?:string\}\)=>\{/, 'buyCocs is the one purchase entry point');
  assert.match(dispatch, /if\(item\.enabled!==true\)return \{ok:false,reason:reqReasonCopy\(item\.disabledReason\)\}/, 'the pre-flight refuses with the real model reason');
  assert.match(dispatch, /const depotId=item\.target==='depot'\?\(store\.depotId\?\?options\?\.depotId\?\?null\):null/, 'the Puma spend point resolves from the nearest friendly depot');
  assert.match(dispatch, /r\.cocsBuySeq=seq;const cardId=`buy-\$\{team\}-\$\{tick\}-\$\{seq\}`/, 'both paths share the deterministic (tick, peerId, cardId) identity');
  assert.match(dispatch, /\(r\.cocsBuys\?\?=\[\]\)\.push\(\{tick,peerId,cardId,team,actorId,itemId/, 'local buys queue the same record shape as orders and spends');
  assert.match(dispatch, /r\.net\.buy\(itemId,\{\.\.\.\(depotId\?\{depotId\}:\{\}\),cardId\}\)/, 'online buys go through net.buy with the same card id');
  assert.match(dispatch, /status:'queued'/, 'the dispatch records a pending status');
  assert.doesNotMatch(dispatch, /ACCEPTED|CONFIRMED/, 'the dispatch never claims acceptance');
  assert.match(page, /const cocsBuys=r\.cocsBuys\?\.length\?r\.cocsBuys\.splice\(0,r\.cocsBuys\.length\):null;/, 'the local step drains r.cocsBuys');
  assert.match(page, /cocs:\{orders:cocsOrders\?\?\[\],spends:cocsSpends\?\?\[\],buys:cocsBuys\?\?\[\]\}/, 'the local step appends buys to the cocs bag');
  assert.match(page, /reconcileReqBuys\(pending,\{actorId/, 'the page reconciles pending buys against the snapshot');
  assert.match(page, /CONFIRMED · \$\{confirmed\.cost\} REQ/, 'confirmation is snapshot-driven');
  assert.match(page, /REJECTED · \$\{reqReasonCopy\(refused\.reason\)\}/, 'a refusal names the reason');
  assert.match(page, /req:reqStore,onBuyReq:buyCocs,reqPending:cocsReqPending/, 'the board host receives the catalogue, handler and pending rows');
  assert.match(page, /depotPurchaseState\(live,depot\)/, 'a live bought Puma disables the local row before the click');
  assert.match(page, /reqPurchaseOptions\(\{team,mode,actor:/, 'the rendered model and the pre-flight share one call');
  const reject = page.slice(page.indexOf('n.onCocsReject='), page.indexOf('n.onLobby='));
  assert.match(reject, /cocsBuysPending/, 'a server reject finds the matching pending purchase');
  assert.match(reject, /REJECTED/, 'the pending purchase refusal is named');
});

test('CommandBoardHud exposes the purchase entry only through the page-provided catalogue', () => {
  const model = reqPurchaseOptions({team: 0, mode: 'cocs', actor: {id: 0, req: 90, reqBuff: null}, state: {command: {seat: [null, null]}, nodes: []}});
  const board = {
    widthPercent: 42,
    listboxIds: ['card-1'],
    summary: {chip: '⚠ 0 blocked · ▶ 1', needsYou: 0, running: 1, done: 0},
    cards: [],
    sections: [{id: 'running', label: 'RUNNING', count: 1, cards: [], expandable: false}],
  };
  const base = {open: true, collapsed: false, pinned: false, activeId: null, reducedMotion: false, commandKey: 'B', commandShortcut: 'B', onSelect: () => {}, onActivate: () => {}, onClose: () => {}, onTogglePin: () => {}};
  const html = render(CommandBoardHud, {...base, command: {boardView: board, req: model, reqPending: [{itemId: 'haste', status: 'queued'}], onBuyReq: () => {}}});
  assert.match(html, /REQ STORE · <b>90<\/b> REQ/, 'the board carries the store');
  assert.match(html, /aria-expanded="false"/, 'the store starts collapsed and compact');
  const open = render(ReqStore, {req: model, pending: [{itemId: 'haste', status: 'queued'}], onBuy: () => {}, reducedMotion: false, defaultOpen: true});
  assert.match(open, /QUEUED · AWAITING AUTHORITY/, 'the pending row is visible to the board keyboard cycle');
  assert.match(open, /AUTHORITATIVE BALANCE <b>90<\/b> REQ/);
});
