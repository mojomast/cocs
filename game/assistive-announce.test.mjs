// WP2.2 — the single assistive announcement channel.
//
// These are DOM-mutation-contract tests at the model level: every tick returns
// the exact string the one live region would render, so "announced once" and
// "no churn" are asserted against the rendered text rather than a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTIVE_PRIORITY,
  assistiveCandidates,
  assistiveChannelStep,
  assistiveCueText,
  createAssistiveChannel,
} from './assistive-announce.mjs';

const TICK = .08;

/** Run `ticks` snapshots through the channel and collect what the live region
 *  would have rendered, marking the ticks that gained new text. */
function run(view, ticks, {start = 0, previous = null} = {}) {
  let state = previous, time = start;
  const frames = [];
  for (let i = 0; i < ticks; i++) {
    const step = assistiveChannelStep(state, typeof view === 'function' ? view(time, i) : view, time);
    state = step.state;
    frames.push({time, text: assistiveCueText(step.cue), cue: step.cue, announced: step.announced});
    time += TICK;
  }
  return {frames, state, time};
}

const announcements = frames => frames.filter(frame => frame.announced);
const death = (overrides = {}) => ({alive: false, death: {text: 'BOT 3 ELIMINATED YOU'}, ...overrides});

test('unchanged combat produces no announcement and no text churn', () => {
  // 10 seconds of the 80 ms HUD tick with a live player and no events.
  const idle = run({alive: true}, 125);
  assert.equal(announcements(idle.frames).length, 0, 'steady combat never announces');
  assert.ok(idle.frames.every(frame => frame.text === ''), 'the live region stays empty');

  // A kill beat is event-gated by the page; the channel announces the text
  // once and every later tick renders the exact same string.
  const kill = run({alive: true, kill: {text: 'YOU ELIMINATED BOT 7', detail: 'WITH RAIL'}}, 30);
  assert.equal(announcements(kill.frames).length, 1, 'one kill, one announcement');
  const first = announcements(kill.frames)[0];
  assert.equal(first.text, 'YOU ELIMINATED BOT 7. WITH RAIL');
  for (const frame of kill.frames) assert.equal(typeof frame.text, 'string');
  const rendered = new Set(kill.frames.filter(frame => frame.time >= first.time).map(frame => frame.text));
  assert.equal(rendered.size, 1, 'the text never changes while the beat is steady');
});

test('objective transitions are announced once per beat, not per tick', () => {
  const capture = (node, time) => ({alive: true, scoreCue: {kind: 'capture', text: 'OBJECTIVE SECURED · FRONT', detail: '+12 OP', priority: 75, ttl: 4, dedupeKey: `capture:0:${node}`}});
  const frames = [];
  let state = null, time = 0;
  for (let i = 0; i < 25; i++) { const step = assistiveChannelStep(state, capture('relay', time), time); state = step.state; frames.push({time, ...step}); time += TICK; }
  for (let i = 0; i < 25; i++) { const step = assistiveChannelStep(state, capture('array', time), time); state = step.state; frames.push({time, ...step}); time += TICK; }
  const fired = frames.filter(frame => frame.announced).map(frame => assistiveCueText(frame.cue).replace(/\u200B/g, ''));
  assert.deepEqual(fired, ['OBJECTIVE SECURED · FRONT. +12 OP', 'OBJECTIVE SECURED · FRONT. +12 OP'], 'two captures, two announcements');
  const keys = frames.filter(frame => frame.cue).map(frame => frame.cue.key);
  assert.ok(new Set(keys).size <= 2, 'no per-tick cue identity churn');
});

test('order and spend-notice transitions announce once each', () => {
  const pending = run({alive: true, order: {key: 'pending:ATTACK', text: 'SENDING ATTACK'}}, 40);
  assert.equal(announcements(pending.frames).length, 1);
  assert.equal(announcements(pending.frames)[0].text, 'SENDING ATTACK');
  // The strip replaces SENDING with LAST once the order is filed, then with a
  // notice on refusal: each distinct line is one announcement.
  const issued = run({alive: true, order: {key: 'issued:ATTACK', text: 'LAST ATTACK'}}, 5, {previous: pending.state});
  assert.equal(announcements(issued.frames).length, 1);
  const notice = run({alive: true, notice: {key: 'notice-7', text: 'REPAIR REJECTED · NO THREAD'}}, 5, {previous: issued.state});
  assert.equal(announcements(notice.frames).length, 1);
  assert.match(announcements(notice.frames)[0].text, /REJECTED/);
});

test('elimination and respawn announce once each instead of per countdown tick', () => {
  const alive = run({alive: true}, 5);
  // 8 seconds dead: the respawn countdown ticks the whole time in the view,
  // but only the health edge may announce anything.
  const dead = run(time => death({respawnIn: Math.max(0, 5 - time)}), 60, {start: alive.time, previous: alive.state});
  const deadAnnouncements = announcements(dead.frames);
  assert.equal(deadAnnouncements.length, 1, 'one elimination announcement');
  assert.equal(deadAnnouncements[0].cue.kind, 'death');
  assert.doesNotMatch(deadAnnouncements[0].text, /RESPAWN IN|AWAITING/i, 'the announced death carries no countdown wording');
  const deadText = new Set(dead.frames.filter(frame => frame.time >= deadAnnouncements[0].time).map(frame => frame.text));
  assert.equal(deadText.size, 1, 'the death line is stable for the whole respawn wait');

  const respawned = run({alive: true}, 60, {start: dead.time, previous: dead.state});
  const respawnAnnouncements = announcements(respawned.frames);
  assert.equal(respawnAnnouncements.length, 1, 'one respawn announcement');
  assert.equal(respawnAnnouncements[0].cue.kind, 'respawn');
  assert.equal(respawnAnnouncements[0].text, 'RESPAWNED. BACK IN THE FIGHT');

  // A second life announces its own death and respawn exactly once more.
  const second = run(time => death(), 20, {start: respawned.time, previous: respawned.state});
  assert.equal(announcements(second.frames).length, 1);
  assert.equal(announcements(second.frames)[0].cue.kind, 'death');
  assert.equal(announcements(second.frames)[0].cue.key, 'death:2');
});

test('FFA and team death paths share the channel and never mention the loadout editor', () => {
  // The view intentionally carries no mode; the death/respawn cues are the
  // same. Neither line may advertise the team-only respawn loadout editor.
  const died = run(time => ({alive: time < .4 || time >= .8, death: time >= .4 && time < .8 ? {text: 'ELIMINATED'} : null}), 20);
  for (const frame of died.frames) {
    assert.doesNotMatch(frame.text, /LOADOUT|LOCK IN/i);
  }
  const kinds = announcements(died.frames).map(frame => frame.cue.kind);
  assert.deepEqual(kinds, ['death', 'respawn']);
});

test('a combat kill still announces while a routine score cue is showing', () => {
  const score = {kind: 'score', text: 'RED SCORES', score: 3, amount: 1};
  const frames = [];
  let state = null, time = 0;
  const push = view => { const step = assistiveChannelStep(state, view, time); state = step.state; frames.push({time, ...step}); time += TICK; };
  for (let i = 0; i < 3; i++) push({alive: true, scoreCue: score});
  for (let i = 0; i < 3; i++) push({alive: true, scoreCue: score, kill: {text: 'YOU ELIMINATED BOT 2'}});
  const fired = frames.filter(frame => frame.announced).map(frame => assistiveCueText(frame.cue));
  assert.deepEqual(fired, ['RED SCORES · 3', 'YOU ELIMINATED BOT 2'], 'the personal kill is not lost behind the routine score');
  assert.ok(ASSISTIVE_PRIORITY.kill > ASSISTIVE_PRIORITY.score, 'kill outranks a routine score beat');
});

test('a persistent banner is not re-announced after a death interruption', () => {
  const sudden = {text: 'SUDDEN DEATH', detail: 'NEXT SCORE WINS'};
  const frames = [];
  let state = null, time = 0;
  const push = view => { const step = assistiveChannelStep(state, view, time); state = step.state; frames.push({time, ...step}); time += TICK; };
  for (let i = 0; i < 5; i++) push({alive: true, sudden});                 // sudden announced once
  for (let i = 0; i < 40; i++) push(death({sudden}));                      // death replaces it
  for (let i = 0; i < 90; i++) push({alive: true, sudden});                // respawn, then back to sudden
  const fired = frames.filter(frame => frame.announced).map(frame => assistiveCueText(frame.cue));
  assert.deepEqual(fired, ['SUDDEN DEATH. NEXT SCORE WINS', 'BOT 3 ELIMINATED YOU', 'RESPAWNED. BACK IN THE FIGHT'], 'the persistent banner is not repeated after it was displaced');
});

test('the candidate builder maps LATTICE beats into one priority band', () => {
  const siege = assistiveCandidates({scoreCue: {kind: 'siege', text: 'HQ UNDER SIEGE', priority: 100}})[0];
  const secure = assistiveCandidates({scoreCue: {kind: 'capture', text: 'OBJECTIVE SECURED · FRONT', priority: 75}})[0];
  assert.ok(siege.priority > secure.priority, 'a siege outranks a routine secure');
  assert.ok(siege.priority < ASSISTIVE_PRIORITY.start, 'match start still leads the objective band');
  assert.ok(secure.priority > ASSISTIVE_PRIORITY.score, 'any real objective beat outranks a routine score');
  assert.equal(createAssistiveChannel().alive, null, 'a fresh channel fabricates no death edge');
  const mounted = run(death(), 3);
  assert.equal(announcements(mounted.frames).length, 0, 'mounting while already dead is not a new elimination');
});
