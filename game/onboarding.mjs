// First-run coach content. Pure and engine-free so the steps and the
// show/dismiss decision are unit-testable and shared by the UI.
export const ONBOARDING_STORAGE_KEY = 'token-arena-onboarded';

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({id: 'move', title: 'MOVE', detail: 'WASD to move, Space to jump, Shift to sprint, Ctrl or C to crouch and slide.'}),
  Object.freeze({id: 'fight', title: 'FIGHT', detail: 'Left mouse fires, right mouse aims, R reloads, F melees and G throws a frag. Scroll or use 1-0 to switch weapons.'}),
  Object.freeze({id: 'objective', title: 'PLAY THE OBJECTIVE', detail: 'Hold the hill, carry the flag, or push the payload cart. The current goal and score run along the top of the screen.'}),
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
  return stored !== true && stored !== '1' && entered !== true;
}
