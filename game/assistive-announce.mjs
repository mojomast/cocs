// WP2.2 — the single prioritized, event-gated assistive announcement channel.
//
// The HUD snapshot updates roughly every 80 ms. Anything with `role="status"`
// (or `aria-live`) that carries a countdown, distance, cooldown or score will
// therefore re-announce on every tick and drown out the handful of events a
// player actually needs to hear. This module is that one live channel: the
// readouts stay visible but non-live, and only real transitions are announced
// here, each once.
//
// A cue is a plain object `{key, kind, priority, ttl, text, detail}`. The
// channel holds the showing cue for its TTL so the next tick cannot replace a
// beat mid-sentence, and it reports `announced` only when the rendered text
// actually gained new content. React therefore mutates the live region only on
// transitions; an unchanged snapshot renders the exact same text and is silent.
//
// Death and respawn are edges derived from the local actor's health, never from
// the respawn countdown: elimination announces once when health crosses to
// zero, respawn announces once when it comes back. FFA and team matches share
// the same channel; the team-only loadout editor never enters this path.

export const ASSISTIVE_PRIORITY = Object.freeze({
  death: 130,
  respawn: 125,
  sudden: 120,
  start: 115,
  callout: 109,
  kill: 108,
  // LATTICE objective beats keep their own `priority` (siege/loss/secure/...)
  // and are mapped into the 100-101.2 band so an urgent siege still outranks a
  // routine kill while a routine capture does not.
  objective: 100,
  score: 95,
  notice: 85,
  order: 80,
});

export const ASSISTIVE_TTL = Object.freeze({
  death: 6,
  respawn: 5,
  sudden: 6,
  start: 3,
  callout: 2.5,
  kill: 2,
  objective: 4,
  score: 2,
  notice: 4,
  order: 3,
});

const text = value => (typeof value === 'string' ? value.trim() : '');

/** Fresh channel state. `alive: null` means "not observed yet", so mounting
 *  this component while already dead does not fabricate a death edge. */
export function createAssistiveChannel() {
  return {alive: null, deathSerial: 0, respawnSerial: 0, cue: null, muted: []};
}

/** The exact string the one live region renders. */
export function assistiveCueText(cue) {
  if (!cue) return '';
  const detail = text(cue.detail);
  return detail ? `${cue.text}. ${detail}` : String(cue.text ?? '');
}

/** Priority for an objective/score beat. LATTICE beats carry their own rank
 *  from `acceptCocsAnnouncement`; ordinary score events share one band. */
export function assistiveObjectivePriority(cue) {
  const rank = Number(cue?.priority);
  return Number.isFinite(rank)
    ? ASSISTIVE_PRIORITY.objective + rank / 100
    : ASSISTIVE_PRIORITY.score;
}

/** Event-gated candidates, highest priority first after sorting. Only beats
 *  that already exist in the snapshot (TTL applied by the page) are offered;
 *  a candidate that keeps the same key across ticks is not re-announced. */
export function assistiveCandidates(view = {}) {
  const cues = [];
  const add = (key, kind, priority, ttl, line, detail = '', order = 0) => {
    const body = text(line);
    if (!body) return;
    cues.push({key, kind, priority, ttl, text: body, detail: text(detail), order});
  };
  add('sudden', 'sudden', ASSISTIVE_PRIORITY.sudden, ASSISTIVE_TTL.sudden, view.sudden?.text, view.sudden?.detail);
  add('start', 'start', ASSISTIVE_PRIORITY.start, ASSISTIVE_TTL.start, view.start?.text, view.start?.detail);
  if (view.scoreCue?.text) {
    const cue = view.scoreCue;
    const objective = Number.isFinite(Number(cue.priority));
    const value = Number(cue.score);
    // A repeated scoreline reads identically ("RED SCORES"); the current total
    // is folded into the announced line so consecutive scores are distinct.
    const line = objective || !Number.isFinite(value)
      ? text(cue.text)
      : `${text(cue.text)} · ${value}`;
    const ttl = Number(cue.ttl) > 0 ? Number(cue.ttl) : objective ? ASSISTIVE_TTL.objective : ASSISTIVE_TTL.score;
    add(
      `objective:${text(cue.dedupeKey) || text(cue.kind) || 'score'}:${Number.isFinite(value) ? value : ''}`,
      objective ? 'objective' : 'score',
      assistiveObjectivePriority(cue),
      ttl,
      line,
      objective ? cue.detail : (Number(cue.amount) > 1 ? `${Number(cue.amount)}×` : ''),
    );
  }
  add('callout', 'callout', ASSISTIVE_PRIORITY.callout, ASSISTIVE_TTL.callout, view.callout?.text, view.callout?.detail);
  add('kill', 'kill', ASSISTIVE_PRIORITY.kill, ASSISTIVE_TTL.kill, view.kill?.text, view.kill?.detail);
  add('order', 'order', ASSISTIVE_PRIORITY.order, ASSISTIVE_TTL.order, view.order?.text, view.order?.detail);
  if (view.notice?.text) {
    add(
      `notice:${text(view.notice.key) || text(view.notice.text)}`,
      'notice',
      ASSISTIVE_PRIORITY.notice,
      ASSISTIVE_TTL.notice,
      view.notice.text,
    );
  }
  return cues;
}

/**
 * Advance the channel one snapshot.
 *
 * @param previous previous channel state (or null on first render)
 * @param view     `{alive, death, sudden, start, scoreCue, callout, kill, order, notice}`
 * @param now      authoritative snapshot time (`hud.time`), never a wall clock
 * @returns `{state, cue, announced}`; `announced` is true only when the live
 *          region gains new text (clearing it is not an announcement).
 */
export function assistiveChannelStep(previous, view = {}, now = 0) {
  const state = previous && typeof previous === 'object'
    ? {...previous, muted: Array.isArray(previous.muted) ? previous.muted.slice() : []}
    : createAssistiveChannel();
  const time = Number.isFinite(Number(now)) ? Number(now) : 0;
  const alive = view.alive !== false;
  const candidates = [];

  // Health edges always take the channel: elimination and respawn are the two
  // beats a player cannot infer from the (non-live) countdown readouts.
  if (state.alive === true && alive === false) {
    state.deathSerial = (Number(state.deathSerial) || 0) + 1;
    candidates.push({
      key: `death:${state.deathSerial}`, kind: 'death', priority: ASSISTIVE_PRIORITY.death,
      ttl: ASSISTIVE_TTL.death, text: text(view.death?.text) || 'ELIMINATED',
      detail: text(view.death?.detail), order: 0,
    });
  }
  if (state.alive === false && alive === true) {
    state.respawnSerial = (Number(state.respawnSerial) || 0) + 1;
    candidates.push({
      key: `respawn:${state.respawnSerial}`, kind: 'respawn', priority: ASSISTIVE_PRIORITY.respawn,
      ttl: ASSISTIVE_TTL.respawn, text: 'RESPAWNED', detail: 'BACK IN THE FIGHT', order: 0,
    });
  }
  state.alive = alive;
  for (const cue of assistiveCandidates(view)) candidates.push(cue);

  const shown = state.cue && typeof state.cue === 'object' ? state.cue : null;
  const before = assistiveCueText(shown);
  const fresh = Boolean(shown) && time - shown.at >= 0 && time - shown.at < (Number(shown.ttl) > 0 ? Number(shown.ttl) : 1.6);
  const finish = cue => {
    let next = cue;
    if (next && next.key !== shown?.key && assistiveCueText(next) === before) {
      // A genuinely new beat can repeat the same wording (a recapture of the
      // same node, a second score at the same total). The zero-width marker is
      // not spoken, but it mutates the one live region so the repeat is not
      // silently deduplicated by the browser/AT pair.
      next = {...next, text: `${next.text}\u200B`};
    }
    state.cue = next;
    return {state, cue: next, announced: assistiveCueText(next) !== '' && assistiveCueText(next) !== before};
  };

  // A beat that was displaced by a more urgent cue cannot come back while the
  // same underlying condition persists (the visible banner already told its
  // story once); it re-arms only after it leaves the candidate list.
  const muted = new Set(state.muted);
  for (const key of [...muted]) if (!candidates.some(cue => cue.key === key)) muted.delete(key);
  const keep = () => { state.muted = [...muted]; };
  const edge = candidates.find(cue => cue.kind === 'death' || cue.kind === 'respawn');
  if (edge) {
    if (shown && shown.key !== edge.key) muted.add(shown.key);
    keep();
    return finish({...edge, at: time});
  }

  const available = candidates.filter(cue => !muted.has(cue.key)).sort((a, b) => b.priority - a.priority || a.order - b.order);
  if (!available.length) {
    keep();
    if (fresh) return {state, cue: shown, announced: false};
    return finish(null);
  }
  const best = available[0];
  if (!fresh) { keep(); return finish({...best, at: time}); }
  if (best.key === shown.key) { keep(); return {state, cue: shown, announced: false}; }
  if (best.priority >= shown.priority) {
    muted.add(shown.key);
    keep();
    return finish({...best, at: time});
  }
  keep();
  return {state, cue: shown, announced: false};
}
