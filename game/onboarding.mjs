// First-run coach content. Pure and engine-free so the steps and the
// show/dismiss decision are unit-testable and shared by the UI.
//
// WP2.3: the old key is a single unversioned bit (`'1'`) written by both GOT IT
// and SKIP. New records live under `ONBOARDING_STATE_KEY` as
// `{status: 'completed' | 'skipped', version}`; the legacy value is migrated on
// read and grandfathered so an existing installation is never re-onboarded.
// `shouldShowOnboarding` additionally requires an explicit arena entry, so the
// coach can no longer cover the title's primary action on a fresh load.
import {DEFAULT_BINDINGS, bindingLabel} from './keybinds.mjs';

export const ONBOARDING_STORAGE_KEY = 'token-arena-onboarded';
export const ONBOARDING_STATE_KEY = 'token-arena-onboarding';
export const ONBOARDING_CONTENT_VERSION = 2;

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({id: 'move', title: 'MOVE', detail: 'WASD to move, Space to jump, Shift to sprint, Ctrl or C to crouch and slide.'}),
  Object.freeze({id: 'fight', title: 'FIGHT', detail: 'Left mouse fires, right mouse aims, R reloads, F melees and G throws a frag. Scroll or use 1-0 to switch weapons.'}),
  Object.freeze({id: 'objective', title: 'PLAY THE OBJECTIVE', detail: 'Hold the hill, carry the flag, or push the payload cart. The current goal and score run along the top of the screen.'}),
  Object.freeze({id: 'lattice', title: 'LATTICE STRIKE', detail: 'Start at your front gate. Stand inside a capture ring, then take a linked node. Keep the supply line back to HQ connected to earn team FLUX. LATTICE quick start opens a field briefing; the pause menu keeps it available during play.'}),
  Object.freeze({id: 'systems', title: 'NEW SYSTEMS', detail: 'Juggernaut, Team Elimination and VIP Escort remix the objective; Horde waves grant lasting upgrades; dailies and Theater highlights track progress.'}),
  Object.freeze({id: 'mutators', title: 'MUTATORS & WEATHER', detail: 'Match Setup toggles mutators like One-shot, Bounty, Berserk, Random weapon and Sudden death. Arenas pick their own weather — rain, snow, ash or storms — and time of day; reduce motion clears it.'}),
  Object.freeze({id: 'career', title: 'PRESTIGE & ACHIEVEMENTS', detail: 'Milestones unlock achievements for bonus XP, and overflow XP past level 60 banks prestige ranks with permanent XP bonuses. Track both under Rank → Career track.'}),
  Object.freeze({id: 'adapt', title: 'MAKE IT YOURS', detail: 'Set invert look, sensitivity, captions and HUD clarity in Settings. Pick a colour-vision palette (deuteranopia, protanopia or tritanopia) or high-contrast UI, and remap any key by pressing it.'}),
  Object.freeze({id: 'replays', title: 'REPLAYS & SUMMARY', detail: 'Theater exports any recorded match to a .json file and imports one back. The results screen opens on a Summary card with XP, level, prestige progress and achievements unlocked.'}),
  Object.freeze({id: 'browser', title: 'ROOM BROWSER & PRACTICE', detail: 'Filter open rooms by mode, map or size, or hit Practice vs Bots to launch a local match with no server at all.'}),
]);

// Skimmable in-game legend for the systems added on top of the core loop. Kept
// engine-free so the Help tab, the tests and any future tooling share one source.
export const HELP_SECTIONS = Object.freeze([
  Object.freeze({
    id: 'lattice', title: 'LATTICE STRIKE & OPERATIONS',
    summary: 'Take connected ground, support the push, protect your HQ.',
    items: Object.freeze([
      'FIRST MINUTE · Leave HQ for your front gate. Stand in the capture ring and clear opponents; capture is automatic. Next, push the central relay or a side siphon linked to a node you own.',
      'SUPPLY · Connected nodes earn team FLUX. Losing a link to HQ stops that income, even if the forward node still belongs to you. Defend the links as well as the points.',
      'WIN · In PvP, hold a majority long enough for dominance; at the time limit, objective score decides. In OPERATIONS, clear all five Director waves before time expires and keep the HQ alive.',
      'COMMAND · Arm SCAN, GO/HOLD or ATTACK, select a numbered target, then press Enter to issue. Escape cancels an armed order. Hold the command-board key to inspect the team plan. The field briefing and HUD show your remapped keys.',
      'ROUTES · At an anchor, Interact rides the device. In its outer ring it may CUT/LOCK instead; read the prompt first. A broken route offers REPAIR. Ground routes are available to every loadout.',
      'DEPOTS & TERMINALS · Hold a depot apron to capture; Interact enters its loaner. In OPERATIONS, Interact at a terminal starts the displayed HACK / DEPLOY / VAULT action; protect the channel.',
      'CLIMB · Grapple users aim at a higher solid surface and hold Mobility to reel upward; release to detach. Other operators have their own mobility verbs. Use the ramps when your mobility is unavailable.',
      'SPEND · OPERATIONS opens a between-wave FLUX window for fortify, repair, resupply and reinforce. Respond to the HQ siege alarm before committing to another forward push.',
    ]),
  }),
  Object.freeze({
    id: 'modes',
    title: 'OBJECTIVE MODES',
    summary: 'Team modes with a twist, all under MATCH SETUP.',
    items: Object.freeze([
      'JUGGERNAUT · One operator wears the crown, shield and damage aura. Bank the most points, or kill the crown to seize it and the bounty.',
      'TEAM ELIMINATION · Shared team lives, no free respawns. Every death burns a ticket; first team out of lives loses the round.',
      'VIP ESCORT · Move the lone VIP to the extraction beacon and hold the pad. Lose the VIP and the round is over.',
      'PAYLOAD · Push the cart through every checkpoint. ASSAULT · Breach sectors in order. CTF · Steal and return the enemy flag.',
    ]),
  }),
  Object.freeze({
    id: 'horde',
    title: 'HORDE & CAMPAIGN',
    summary: 'Solo survival and scripted missions from SINGLE PLAYER.',
    items: Object.freeze([
      'HORDE · Waves escalate around you and you keep three lives for the whole run.',
      'Clear a wave, then pick one UPGRADE from the wave panel — it lasts the rest of the run.',
      'CAMPAIGN · Objectives, bosses, story lines and checkpoints across the existing arenas.',
      'Escape pauses; RESUME CHECKPOINT on the objective panel returns to the last safe step.',
    ]),
  }),
  Object.freeze({
    id: 'mutators',
    title: 'MUTATORS & WEATHER',
    summary: 'Remix the rules and read the sky.',
    items: Object.freeze([
      'MATCH SETUP → Modifiers toggles One-shot kills, Bounty on sprees, Berserk, Random starting weapon, Sudden death, Life steal, Unlimited ammo and Half cooldowns.',
      'WEATHER · Every arena selects rain, snow, ash, storm or clear skies from its biome and time of day. Reduce motion forces clear weather.',
      'Arenas rotate through day, dusk and night; halo maps like Aether Ring and Skybreak Isles add a bright ring sky.',
    ]),
  }),
  Object.freeze({
    id: 'career',
    title: 'PRESTIGE & ACHIEVEMENTS',
    summary: 'Long-term goals beyond the level cap.',
    items: Object.freeze([
      'ACHIEVEMENTS · First Blood, Centurion (100 kills), Flawless, Streak Master, Campaign Clear and more unlock automatically and pay bonus XP.',
      'PRESTIGE · Once you hit level 60, overflow XP banks a prestige rank every 6000 XP, each tier granting a permanent match-XP bonus.',
      'Rank → Career track lists every achievement and prestige tier with its reward.',
    ]),
  }),
  Object.freeze({
    id: 'challenges',
    title: 'DAILY CHALLENGES',
    summary: 'Rotating bonus objectives that pay XP.',
    items: Object.freeze([
      'A fresh set rotates every day, shown on the loadout screen and under Rank → Challenge track.',
      'Finish matches to advance them; completed challenges bank bonus XP toward unlocks.',
    ]),
  }),
  Object.freeze({
    id: 'theater',
    title: 'THEATER & HIGHLIGHTS',
    summary: 'Every finished solo or online match is recorded.',
    items: Object.freeze([
      'Filter the library by mode, map or length, then WATCH to replay it.',
      'EXPORT downloads a replay as a .json file; IMPORT REPLAY loads one back onto this device.',
      'HIGHLIGHTS jumps straight to eliminations, captures and killstreaks; the scrub bar seeks anywhere.',
      'Cinematic cameras 1–7, [ / ] changes subject, Space pauses, R restarts, Escape exits.',
    ]),
  }),
  Object.freeze({
    id: 'browser',
    title: 'ROOM BROWSER & PRACTICE',
    summary: 'Find the right fight, or skip the server entirely.',
    items: Object.freeze([
      'Filter live rooms by mode, map or player count before you join, or WATCH one already in progress.',
      'PRACTICE VS BOTS starts a local match with your operator and arena — pick the mode, bot count and difficulty.',
      'QUICK JOIN drops you into the first open room; CREATE & HOST opens your own code.',
    ]),
  }),
  Object.freeze({
    id: 'access',
    title: 'ACCESSIBILITY',
    summary: 'Make the arena readable for you.',
    items: Object.freeze([
      'View & crosshair holds resolution scale, glow, brightness, FOV, crosshair shape and colour.',
      'Colour vision palettes — deuteranopia, protanopia and tritanopia — recolour teams, the radar and score banners; the 3D arena follows.',
      'High-contrast UI strengthens borders, text and focus rings across every menu.',
      'Remap any action under Controls by selecting it and pressing a key; touch controls have their own sensitivity slider.',
      'Every menu tab, panel and modal is keyboard reachable; Tab cycles focus and Escape closes the active dialog.',
    ]),
  }),
  Object.freeze({
    id: 'results',
    title: 'RESULTS & CAREER',
    summary: 'The summary card and long-term tracks.',
    items: Object.freeze([
      'The results screen opens on SUMMARY: kills, K/D, time, XP earned, level and prestige progress.',
      'Achievements unlocked that round are listed on the summary card and under Rank → Career track.',
      'Overflow XP past level 60 banks prestige ranks, each granting a permanent match-XP bonus.',
    ]),
  }),
  Object.freeze({
    id: 'maps',
    title: 'ARENAS & NEW MAPS',
    summary: 'From stone colosseums to orbital rings.',
    items: Object.freeze([
      'CLASSIC · The Colosseum, Frost Gate, Sunken Hill, Riverbend, Iron Fortress, The Atrium, The Catacombs, Slagworks and The Forge.',
      'BATTLEFIELDS · Neon Vertical, Substation 7, Warfront Delta and Skyfall Basin add rooftops, bulkheads, armour and air superiority.',
      'ISLES · Skybreak Isles and Aether Ring offer three-route island layouts with trampolines and boost launchers.',
      'OBJECTIVE · The Throne (Juggernaut), The Gauntlet (Elimination), Convoy Line (Payload), Proving Grounds (Arms Race) and Titan Valley (Combined Arms).',
    ]),
  }),
]);

export function shouldShowOnboarding(stored, entered) {
  // Title-first: no explicit arena entry, no coach. The old helper accepted
  // `entered: false` and still showed the coach over the title.
  if (entered !== true) return false;
  const state = normalizeOnboardingState(stored);
  if (!state) return true;
  // A skip is an explicit decline and stays declined; a completion re-arms
  // only when the coach content itself gains a new version.
  if (state.status === 'skipped') return false;
  return state.version < ONBOARDING_CONTENT_VERSION;
}

// --- Versioned storage ------------------------------------------------------
// `normalizeOnboardingState` accepts the new JSON record, a JSON string or the
// legacy truthy bit so every historical shape reads without breaking.
export function normalizeOnboardingState(raw) {
  if (raw === true || raw === '1' || raw === 'true') return Object.freeze({status: 'completed', version: ONBOARDING_CONTENT_VERSION, legacy: true});
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const status = value.status === 'completed' ? 'completed' : value.status === 'skipped' ? 'skipped' : null;
  if (!status) return null;
  const version = Math.floor(Number(value.version));
  return Object.freeze({status, version: Number.isFinite(version) && version > 0 ? version : 1, legacy: value.legacy === true});
}

/** Read the versioned record, migrating (once) the legacy bit in place. */
export function readOnboardingState(store) {
  let current = null, legacy = null;
  try {
    current = store?.getItem?.(ONBOARDING_STATE_KEY) ?? null;
    legacy = store?.getItem?.(ONBOARDING_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  const parsed = normalizeOnboardingState(current);
  if (parsed) return parsed;
  if (!normalizeOnboardingState(legacy)) return null;
  const migrated = Object.freeze({status: 'completed', version: ONBOARDING_CONTENT_VERSION});
  try {
    store?.setItem?.(ONBOARDING_STATE_KEY, JSON.stringify({...migrated, migrated: true}));
    store?.removeItem?.(ONBOARDING_STORAGE_KEY);
  } catch {}
  return migrated;
}

/** Record an explicit completion or skip under the current content version. */
export function persistOnboardingState(store, status) {
  const state = Object.freeze({status: status === 'skipped' ? 'skipped' : 'completed', version: ONBOARDING_CONTENT_VERSION});
  try {
    store?.setItem?.(ONBOARDING_STATE_KEY, JSON.stringify(state));
    store?.removeItem?.(ONBOARDING_STORAGE_KEY);
  } catch {}
  return state;
}

// --- Binding-derived control copy -------------------------------------------
// The first two lessons teach controls, so their detail lines follow the live
// bindings the input path reads; every other step keeps its authored copy.
const bound = (bindings, action) => bindingLabel((bindings ?? {})[action] ?? DEFAULT_BINDINGS[action]);

export function onboardingStepDetail(step, bindings = {}) {
  if (!step) return '';
  if (step.id === 'move') {
    const move = ['forward', 'left', 'back', 'right'].map(action => bound(bindings, action)).join('');
    return `${move} to move, ${bound(bindings, 'jump')} to jump, ${bound(bindings, 'sprint')} to sprint, ${bound(bindings, 'crouch')} to crouch and slide.`;
  }
  if (step.id === 'fight') {
    return `Left mouse fires, right mouse aims, ${bound(bindings, 'reload')} reloads, ${bound(bindings, 'melee')} melees and ${bound(bindings, 'grenade')} throws a frag. Scroll or use 1-0 to switch weapons.`;
  }
  return step.detail;
}

export function onboardingStepView(step, bindings = {}) {
  return step ? {...step, detail: onboardingStepDetail(step, bindings)} : step;
}
