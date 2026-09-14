// First-run coach content. Pure and engine-free so the steps and the
// show/dismiss decision are unit-testable and shared by the UI.
export const ONBOARDING_STORAGE_KEY = 'token-arena-onboarded';

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({id: 'move', title: 'MOVE', detail: 'WASD to move, Space to jump, Shift to sprint, Ctrl or C to crouch and slide.'}),
  Object.freeze({id: 'fight', title: 'FIGHT', detail: 'Left mouse fires, right mouse aims, R reloads, F melees and G throws a frag. Scroll or use 1-0 to switch weapons.'}),
  Object.freeze({id: 'objective', title: 'PLAY THE OBJECTIVE', detail: 'Hold the hill, carry the flag, or push the payload cart. The current goal and score run along the top of the screen.'}),
  Object.freeze({id: 'systems', title: 'NEW SYSTEMS', detail: 'Juggernaut, Team Elimination and VIP Escort remix the objective; Horde waves grant lasting upgrades; dailies and Theater highlights track progress.'}),
  Object.freeze({id: 'adapt', title: 'MAKE IT YOURS', detail: 'Set invert look, sensitivity, captions, HUD clarity and colourblind team colours in Settings at any time.'}),
]);

// Skimmable in-game legend for the systems added on top of the core loop. Kept
// engine-free so the Help tab, the tests and any future tooling share one source.
export const HELP_SECTIONS = Object.freeze([
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
      'HIGHLIGHTS jumps straight to eliminations, captures and killstreaks; the scrub bar seeks anywhere.',
      'Cinematic cameras 1–7, [ / ] changes subject, Space pauses, R restarts, Escape exits.',
    ]),
  }),
  Object.freeze({
    id: 'access',
    title: 'ACCESSIBILITY',
    summary: 'Make the arena readable for you.',
    items: Object.freeze([
      'View & crosshair holds resolution scale, glow, brightness, FOV, crosshair shape and colour.',
      'Subtitles / audio captions, reduce motion and the colourblind team palette live there too.',
      'Remap any action under Controls; touch controls have their own sensitivity slider.',
    ]),
  }),
]);

export function shouldShowOnboarding(stored, entered) {
  return stored !== true && stored !== '1' && entered !== true;
}
