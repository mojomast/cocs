// Cursor-mode state machine — the single owner of pointer lock intent.
//
// LATTICE STRIKE runs with the pointer locked, so DOM surfaces (the intermission
// spend window, the O1c command board, chat, the scoreboard, pause/result
// overlays) render but cannot receive mouse input. The contract this module
// models:
//
//   combat  — pointer lock is wanted; no visible cursor; mouse buttons fire.
//   cursor  — pointer lock is not wanted; the OS cursor is visible and DOM
//             surfaces are clickable. Combat inputs must be cleared on both
//             edges.
//
// Every interactive surface registers a reason while it is open. The cursor is
// released while at least one surface is registered (or while the player
// toggled the free cursor) and combat resumes when the last one closes. The
// browser's own Escape-exits-lock behaviour arrives as `cursorLockLost`; it
// enters cursor mode without ever requesting pause, and a short guard window
// consumes the same physical Escape keypress so the two paths cannot
// double-trigger.
//
// The transitions are pure and return `{state, changed, effects}`. Effects are
// intent only — the page performs them:
//   unlock     — call document.exitPointerLock().
//   lock       — ask the canvas for pointer lock (may need a user gesture;
//                failure is handled by the page's CLICK TO FIGHT affordance).
//   clearInput — clear held fire/ADS/look and queued intents.
//   requestPause / consumed / blocked — Escape routing decisions.
import {DEFAULT_BINDINGS} from './keybinds.mjs';

export const CURSOR_MODE = Object.freeze({COMBAT: 'combat', CURSOR: 'cursor'});

// Every surface that can hold the cursor. Implicit surfaces (`escape`, `free`)
// are never "blocking": Escape with only those active opens pause / resumes,
// while explicit surfaces keep Escape for their own close handling.
export const CURSOR_SURFACE = Object.freeze({
  FREE: 'free',
  ESCAPE: 'escape',
  SPEND: 'spend',
  BOARD: 'board',
  TERMINALS: 'terminals',
  CHAT: 'chat',
  SCOREBOARD: 'scoreboard',
  PAUSE: 'pause',
  RESULTS: 'results',
  SETTINGS: 'settings',
  DEMO: 'demo',
  RESPAWN: 'respawn',
  TRAINING: 'training',
  VOICE: 'voice',
  TACTICAL_MAP: 'tactical-map',
  SQUADS: 'squads',
});

export const CURSOR_IMPLICIT_SURFACES = Object.freeze([CURSOR_SURFACE.FREE, CURSOR_SURFACE.ESCAPE]);

// Keyboard priority across stacked interactive surfaces (F05). The page routes
// keys through `cursorKeyboardOwner`/`cursorCombatKeysBlocked` instead of
// testing individual surface names in a dozen branches: an intermission spend
// window is modal, the explicitly opened respawn editor outranks the standings
// drawn under it, and the command-board peek keeps its own keys.
export const CURSOR_KEYBOARD_ORDER = Object.freeze([
  CURSOR_SURFACE.TACTICAL_MAP,
  CURSOR_SURFACE.SQUADS,
  CURSOR_SURFACE.SPEND,
  CURSOR_SURFACE.RESPAWN,
  CURSOR_SURFACE.SCOREBOARD,
  CURSOR_SURFACE.BOARD,
  CURSOR_SURFACE.CHAT,
  CURSOR_SURFACE.TERMINALS,
  CURSOR_SURFACE.TRAINING,
  CURSOR_SURFACE.VOICE,
  CURSOR_SURFACE.SETTINGS,
  CURSOR_SURFACE.PAUSE,
  CURSOR_SURFACE.RESULTS,
  CURSOR_SURFACE.DEMO,
]);

// The board is a hold-to-peek affordance: it registers a surface (so the mouse
// works) but keeps combat movement and order keys live. Every other interactive
// surface owns the keyboard while it is the owner.
export const CURSOR_COMBAT_KEY_EXEMPT = Object.freeze([CURSOR_SURFACE.BOARD]);

export const CURSOR_SURFACE_LABELS = Object.freeze({
  [CURSOR_SURFACE.FREE]: 'FREE CURSOR',
  [CURSOR_SURFACE.ESCAPE]: 'MOUSE RELEASED',
  [CURSOR_SURFACE.SPEND]: 'SPEND WINDOW',
  [CURSOR_SURFACE.BOARD]: 'COMMAND BOARD',
  [CURSOR_SURFACE.TERMINALS]: 'TERMINALS & ROLES',
  [CURSOR_SURFACE.CHAT]: 'CHAT',
  [CURSOR_SURFACE.SCOREBOARD]: 'SCOREBOARD',
  [CURSOR_SURFACE.PAUSE]: 'PAUSED',
  [CURSOR_SURFACE.RESULTS]: 'RESULTS',
  [CURSOR_SURFACE.SETTINGS]: 'SETTINGS',
  [CURSOR_SURFACE.DEMO]: 'DEMO CONTROLS',
  [CURSOR_SURFACE.RESPAWN]: 'RESPAWN',
  [CURSOR_SURFACE.TRAINING]: 'LESSON COMPLETE',
  [CURSOR_SURFACE.VOICE]: 'VOICE',
  [CURSOR_SURFACE.TACTICAL_MAP]: 'TACTICAL MAP',
  [CURSOR_SURFACE.SQUADS]: 'SQUAD MANAGEMENT',
});

// One physical Escape can both exit pointer lock and arrive as a keydown. Any
// Escape within this window of the lock loss is treated as the same press.
export const ESCAPE_GUARD_MS = 400;

export function cursorSurfaceLabel(surface) {
  return CURSOR_SURFACE_LABELS[String(surface)] ?? String(surface ?? '').toUpperCase();
}

export function initialCursorMode() {
  return {mode: CURSOR_MODE.COMBAT, surfaces: [], escapeAt: -Infinity};
}

function normalize(state) {
  const surfaces = Array.isArray(state?.surfaces) ? state.surfaces.filter(surface => typeof surface === 'string') : [];
  const mode = state?.mode === CURSOR_MODE.CURSOR || surfaces.length ? CURSOR_MODE.CURSOR : CURSOR_MODE.COMBAT;
  return {mode, surfaces, escapeAt: Number.isFinite(state?.escapeAt) ? state.escapeAt : -Infinity};
}

const effects = patch => ({unlock: false, lock: false, clearInput: false, requestPause: false, consumed: false, blocked: false, ...patch});

export function cursorActive(state) {
  return normalize(state).mode === CURSOR_MODE.CURSOR;
}

/** Explicit (blocking) surfaces, ignoring the implicit escape/free reasons. */
export function cursorBlockingSurfaces(state) {
  return normalize(state).surfaces.filter(surface => !CURSOR_IMPLICIT_SURFACES.includes(surface));
}

/**
 * The single interactive surface that owns keyboard input right now, or null
 * when only combat/the implicit free cursor reasons are active. Priority comes
 * from CURSOR_KEYBOARD_ORDER; surfaces outside it fall back to open order.
 */
export function cursorKeyboardOwner(state) {
  const blocking = cursorBlockingSurfaces(state);
  if (!blocking.length) return null;
  let owner = null;
  for (const surface of blocking) {
    if (owner === null) { owner = surface; continue; }
    const rank = CURSOR_KEYBOARD_ORDER.indexOf(surface);
    if (rank === -1) continue;
    const ownerRank = CURSOR_KEYBOARD_ORDER.indexOf(owner);
    if (ownerRank === -1 || rank < ownerRank) owner = surface;
  }
  return owner;
}

/**
 * True when the page's combat key routing (movement, fire, weapon digits,
 * orders) must not run because an interactive surface owns the keyboard. The
 * board peek is exempt by default; pass `allow` to override the exemption.
 */
export function cursorCombatKeysBlocked(state, options = {}) {
  const owner = cursorKeyboardOwner(state);
  if (!owner) return false;
  const allow = Array.isArray(options.allow) ? options.allow : CURSOR_COMBAT_KEY_EXEMPT;
  return !allow.includes(owner);
}

/**
 * Open (or keep) an interactive surface. The first surface releases pointer
 * lock and clears held inputs; opening another one is a no-op transition.
 */
export function cursorOpen(state, surface, options = {}) {
  const current = normalize(state);
  const id = String(surface ?? '');
  if (!id) return {state: current, changed: false, effects: effects()};
  if (current.surfaces.includes(id)) return {state: current, changed: false, effects: effects()};
  const entering = current.mode !== CURSOR_MODE.CURSOR;
  // The first interactive surface clears held combat input even when the free
  // cursor was already on (F05): a spend window opening over a held movement
  // key must not keep driving the actor. Later surfaces in the same stack do
  // not re-clear, so closing a stack restores input exactly once.
  const firstBlocking = !CURSOR_IMPLICIT_SURFACES.includes(id) && cursorBlockingSurfaces(current).length === 0;
  const next = {
    mode: CURSOR_MODE.CURSOR,
    surfaces: [...current.surfaces, id],
    escapeAt: id === CURSOR_SURFACE.ESCAPE ? Number(options.at) || 0 : current.escapeAt,
  };
  return {state: next, changed: true, effects: effects({unlock: entering, clearInput: entering || firstBlocking})};
}

/**
 * Close an interactive surface. When the last surface closes the machine asks
 * for pointer lock again; the page falls back to a CLICK TO FIGHT affordance
 * when the browser refuses a gesture-less re-lock.
 */
export function cursorClose(state, surface) {
  const current = normalize(state);
  const id = String(surface ?? '');
  if (!current.surfaces.includes(id)) return {state: current, changed: false, effects: effects()};
  const surfaces = current.surfaces.filter(entry => entry !== id);
  if (surfaces.length) return {state: {...current, surfaces}, changed: true, effects: effects()};
  return {
    state: {...current, mode: CURSOR_MODE.COMBAT, surfaces: [], escapeAt: -Infinity},
    changed: true,
    effects: effects({lock: true, clearInput: true}),
  };
}

/**
 * Free-cursor toggle. With only the implicit escape/free reasons active it
 * returns to combat; while an explicit surface is open it refuses so the
 * surface's own close action stays the single obvious exit.
 */
export function cursorToggle(state, surface = CURSOR_SURFACE.FREE, options = {}) {
  const current = normalize(state);
  const id = String(surface ?? CURSOR_SURFACE.FREE);
  if (current.mode === CURSOR_MODE.CURSOR) {
    if (current.surfaces.length && current.surfaces.every(entry => entry === id || entry === CURSOR_SURFACE.ESCAPE)) {
      return cursorClear(current);
    }
    if (current.surfaces.includes(id)) return cursorClose(current, id);
    if (cursorBlockingSurfaces(current).length) return {state: current, changed: false, effects: effects({blocked: true})};
  }
  return cursorOpen(current, id, options);
}

/**
 * User-driven "back to combat": clear every surface and request lock. Used by
 * the CLICK TO FIGHT affordance once no explicit surface is holding the cursor.
 */
export function cursorClear(state) {
  const current = normalize(state);
  if (current.mode !== CURSOR_MODE.CURSOR) return {state: current, changed: false, effects: effects()};
  return {
    state: {...current, mode: CURSOR_MODE.COMBAT, surfaces: [], escapeAt: -Infinity},
    changed: true,
    effects: effects({lock: true, clearInput: true}),
  };
}

/**
 * Silent reset for mode changes (title, lobby, results, pause). No lock is
 * requested: the page is not in combat and owns its own lock policy there.
 */
export function cursorReset(state) {
  const current = normalize(state);
  if (current.mode !== CURSOR_MODE.CURSOR && !current.surfaces.length) return {state: current, changed: false, effects: effects()};
  return {state: {mode: CURSOR_MODE.COMBAT, surfaces: [], escapeAt: -Infinity}, changed: true, effects: effects()};
}

/**
 * The browser released pointer lock (Escape, tab switch, element removal).
 * From combat this is the player's release gesture: enter cursor mode and never
 * pause. From cursor mode it is the confirmation of an exit we already wanted.
 */
export function cursorLockLost(state, options = {}) {
  const current = normalize(state);
  if (current.mode === CURSOR_MODE.CURSOR) return {state: current, changed: false, escaped: false, effects: effects()};
  return {
    state: {mode: CURSOR_MODE.CURSOR, surfaces: [CURSOR_SURFACE.ESCAPE], escapeAt: Number(options.at) || 0},
    changed: true,
    escaped: true,
    effects: effects({clearInput: true}),
  };
}

/** Pointer lock was acquired: combat owns the pointer, so drop every surface. */
export function cursorLockGained(state) {
  const current = normalize(state);
  if (current.mode === CURSOR_MODE.COMBAT && !current.surfaces.length) return {state: current, changed: false, effects: effects()};
  return {
    state: {mode: CURSOR_MODE.COMBAT, surfaces: [], escapeAt: -Infinity},
    changed: true,
    effects: effects({clearInput: true}),
  };
}

/**
 * Escape routing while the cursor is free. Within the guard window it is the
 * same keypress that exited pointer lock — consumed, no pause. With an explicit
 * surface open, that surface's own Escape handler owns the key (`blocked`).
 * Otherwise the page may pause (local) or keep the cursor (network).
 */
export function cursorEscape(state, options = {}) {
  const current = normalize(state);
  if (current.mode !== CURSOR_MODE.CURSOR) return {state: current, changed: false, effects: effects()};
  const at = Number(options.at) || 0;
  if (current.escapeAt > 0 && at - current.escapeAt <= ESCAPE_GUARD_MS) {
    return {state: current, changed: false, effects: effects({consumed: true})};
  }
  if (cursorBlockingSurfaces(current).length) {
    return {state: current, changed: false, effects: effects({blocked: true})};
  }
  return {state: current, changed: false, effects: effects({requestPause: true})};
}

/** Human label for the active reasons, deduped and in open order. */
export function cursorSurfaceText(state) {
  const current = normalize(state);
  if (!current.surfaces.length) return '';
  return [...new Set(current.surfaces)].map(cursorSurfaceLabel).join(' · ');
}

/** The hint line the HUD shows while the cursor is free. */
export function cursorHint(state, options = {}) {
  const current = normalize(state);
  if (current.mode !== CURSOR_MODE.CURSOR) return '';
  const key = String(options.key ?? DEFAULT_BINDINGS.cursor ?? 'AltLeft').replace(/^Alt(Left|Right)$/, 'ALT').replace(/^Key/, '').replace(/Left$|Right$/, '').toUpperCase();
  const blocking = cursorBlockingSurfaces(current);
  if (blocking.length) return `CLOSE ${blocking.map(cursorSurfaceLabel).join(' / ')} · ${key} OR CLICK TO FIGHT`;
  return `${key} OR CLICK TO FIGHT`;
}
