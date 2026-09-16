// In-game patch notes. The title-screen footer is the running version; this
// module is the human-readable release digest the Changelog screen renders. The
// full historical record lives in docs/CHANGELOG.md and is linked from the UI.
export const RELEASE_VERSION = 'v4.13';
export const RELEASE_CODENAME = 'ATTRACT';
export const REPO_URL = 'https://github.com/mojomast/tokenarena';
export const FULL_CHANGELOG_URL = `${REPO_URL}/blob/main/docs/CHANGELOG.md`;

export const CHANGELOG = [
  {version:'v4.13',codename:'ATTRACT',date:'2026-09-16',tag:'Title-screen demo controls',highlights:[
    'The demo announcement bar now belongs to the title screen foreground, so it no longer floats over the main-menu controls.',
    'The menu top bar gains a fullscreen toggle that mirrors the browser fullscreen state.',
    'A "Back to demo" button returns to the live demo, hides the title overlay, and offers on-screen and arrow-key controls to cycle through the demo modes.',
  ]},
  {version:'v4.12',codename:'SYNC',date:'2026-09-15',tag:'Version sync, checkpoints and feedback',highlights:[
    'A client open across a deploy now detects the newer build via /api/version and over a protocol-version change, and offers a one-click reload.',
    'Campaign checkpoints persist across sessions and resume the mission at the banked step; the checkpoint clears when the mission is won.',
    'Campaign stars shown on the mission-select screen now match the reward logic (time and score), instead of using a separate time-only rule.',
    'Enemy telegraphs and single-player abilities are captioned and audible, and VIP Escort gets its extraction beacon marker.',
    'Reconnecting a spectator or inviter once again targets their previous room and seat intent.',
  ]},
  {version:'v4.11',codename:'HARDENED',date:'2026-09-15',tag:'Wiring, cache and correctness pass',highlights:[
    'The menu demo now keeps rendering on the room browser, lobby and patch-notes screens instead of freezing, and the rank screen composites its operator preview.',
    'The document is served no-cache so a browser can never keep running a deleted bundle after a deploy; the deployment verifier enforces it.',
    'Objective and reward correctness: team scoreboards for the newer modes, Juggernaut awarded on crown points, and finite soccer goal positions.',
    'Network and lobby robustness: case-insensitive room codes, invite links for spectators, a clear fallback when a room is full or closed, and voice config no longer drops congested sockets.',
    'HUD/UX wiring: practice-vs-bots honors its bot/difficulty pickers, mission select opens from the rank screen, local spectate lists only its real controls, and the radar draws off-screen bearing arrows.',
  ]},
  {version:'v4.10',codename:'CLARITY',date:'2026-09-15',tag:'The demo keeps showing the match',highlights:[
    'The title demo no longer reveals the operator model between scenarios. The view now decides from the showcase setting itself, not from whether a snapshot happens to be ready, so a cycling build can never fall back to the model preview.',
  ]},
  {version:'v4.9',codename:'INVITE',date:'2026-09-15',tag:'Invite links and a clearer title demo',highlights:[
    'Copy an invite link from the lobby or the room browser; opening it auto-connects and drops the player straight into that room, with a fallback to the room browser if the code has closed.',
    'The title-screen vignette was lightened and the broadcast lower-third now sits above it with a darker, higher-contrast card, so the mode, map and score stay readable over the demo.',
  ]},
  {version:'v4.8',codename:'BROADCAST',date:'2026-09-15',tag:'Docs, patch notes and a broadcast title demo',highlights:[
    'A broadcast-style lower-third now overlays the title-screen demo, reporting the live mode, map, score and objective with animated metric blocks and a scrolling ticker.',
    'A Changelog screen joins the menu, showing the running release and recent patch notes with a link to the full history.',
    'The demo background no longer flashes the full-screen operator model between scenarios: the view holds the arena until the next showcase snapshot arrives.',
    'The documentation was rebuilt: a world-class README, a full docs/ tree with architecture, systems and testing references, and a complete CHANGELOG.md.',
  ]},
  {version:'v4.7',codename:'SPECTACLE',date:'2026-09-15',tag:'Menu showcase, vehicles and atmosphere',highlights:[
    'The title reel now shuffles a curated set of mode/map showpieces instead of a fixed order, and rebuilds atomically so it never drops to a static model preview.',
    'Titan, Scout and Transport vehicles are placed on the warzone maps alongside Pumas and Hornets.',
    'Campaign missions author weather (blizzard, ash, storms) with scripted mid-mission changes and timed story transmissions that play as voice-over beats.',
    'A broadcast-style lower-third on the title screen reports the live demo mode, map, score and objective — and a full Changelog screen lands in the menu.',
  ]},
  {version:'v4.6',codename:'TUNED',date:'2026-09-15',tag:'Weapon balance and single-player',highlights:[
    'Distinct roles and retuned time-to-kill for all ten weapons, with DPS/TTK balance metrics.',
    'Out-of-combat health regeneration in campaign and horde (delayed after damage, reset on respawn/resupply/checkpoint).',
    'Speaker/mission-lore data, campaign briefings, procedural weapon rigs, material fidelity presets and richer announcer audio.',
  ]},
  {version:'v4.5',codename:'CONNECTED',date:'2026-09-15',tag:'Netcode, replay and world',highlights:[
    'Snapshot delta compression with bandwidth accounting, deterministic prediction/reconciliation and interpolation, and protocol v2 with a full-snapshot fallback.',
    'Replay kill feed, objective timeline and a seekable summary; cinematic, over-shoulder, free-look and tactical cameras.',
    'Titan/Scout/Transport chassis, levelgen compounds/terraces/towers, biome props and structural map-schema validation.',
    'Server matchmaking with balanced teams, room lifecycle (warmup/ready/map-vote/rematch), leaderboards and anti-cheat bounds.',
  ]},
  {version:'v4.4',codename:'BROADER',date:'2026-09-14',tag:'Objectives, presentation, accessibility',highlights:[
    'New objective modes Holdout (quorum hold) and Uplink (sequential relay); Endless Horde with score banking and escalating bosses.',
    'Economy pickups (weapon upgrade, deployable sentry), in-menu 3D weapon inspect, hit reactions, storm lightning/thunder, wet sheen and wind.',
    'Per-mode music themes and victory/defeat stings; deuteranopia/protanopia/tritanopia palettes, high-contrast UI and full keyboard remapping.',
    'Replay export/import, match summary card, room filters and practice-vs-bots.',
  ]},
  {version:'v4.3',codename:'DEEPER',date:'2026-09-14',tag:'Mutators, maps and career',highlights:[
    'Composable mutators (low gravity, turbo, instagib, one-shot, mirror loadout, big head, no recoil) plus per-mode loadouts and sniper/pistol presets with ammo/megahealth supplies.',
    'Two new maps (Dune Ravine, Ember Caldera) with biome props and deterministic destructible crates and barrels.',
    'Prestige ranks after max level, twelve achievements with unlock toasts, and a Career track panel.',
  ]},
  {version:'v4.2',date:'2026-09-14',tag:'Campaign, weather and meta',highlights:[
    'Five campaign missions with stealth, duel and boss-phase content; horde gains lancer, sentinel and Harbinger enemies plus new wave modifiers.',
    'Deterministic weather and time of day (rain, snow, ash, storm) with pooled visuals and dynamic audio intensity.',
    'Local match history, per-mode leaderboards, weekly challenges, campaign stars/medals, expanded results medals and an Arsenal inspector.',
    'Persisted, selectable quality tiers: Auto, Low, Medium and High.',
  ]},
  {version:'v4.1',date:'2026-09-14',tag:'Modes, single-player and presentation',highlights:[
    'Juggernaut, Team Elimination and VIP Escort modes; multi-phase Warden bosses; sudden-death timers so every mode terminates.',
    'Horde between-wave upgrades and wave modifiers, new enemy roles (mender/sapper/overseer, shield tank, mortar artillery), campaign checkpoint resume and a third mission.',
    'Death variety, ambient FX, audio variants, richer models, impact decals and a quality/LOD controller with a CPU triangle budget.',
    'Daily challenges, per-mode career stats, full loadout presets, a theater library, help legend and a team-grouped spectator board.',
  ]},
  {version:'v4.0',date:'2026-09-14',tag:'The big improvement pass',highlights:[
    'Single-player enemies spawn in authored areas with per-type leashes; both campaign missions run scripted timelines with real win conditions.',
    'Vehicles only spawn in vehicle modes; CTF carriers are slowed and cannot use powers; the KOTH hill rotates and zone ownership grants buffs; Arms Race demotes on death with a catch-up bonus.',
    'A high-poly rolling soccer ball and per-vertex colours in the CPU software renderer.',
    'The results screen shows XP/level/next-unlock, unlocks queue as toasts, and the theater lists jump-to highlights.',
  ]},
  {version:'v3.10',date:'2026-09-14',tag:'Mobile touch controls',highlights:[
    'Floating dual sticks (move left, look right) fix the bug where any left-side touch flung the stick full forward.',
    'Large fire and jump thumb buttons with compact action buttons that no longer overlap, multi-touch safe.',
    'A fullscreen button and a simplified racing layout (brake/reset plus boost/item).',
  ]},
  {version:'v3.0',date:'2026-09-14',tag:'Menu redesign',highlights:[
    'A new design system: one Shell, Panel, Btn, Modal and shared Stats/Tabs/Segmented/Chip/Meter primitives under app/ui/.',
    'Balanced menu layouts with the loadout in the elastic column and a sticky action rail that never falls below the fold.',
    'The previous inline menu markup is replaced, with the legacy boundary recorded in app/legacy/README.md.',
  ]},
  {version:'v2.0',date:'2026-09-13',tag:'Progression, unlocks and gear',highlights:[
    'XP and ranks with a deterministic curve, level rewards and six rank titles from Recruit to Mythic.',
    'Eight gear pieces and three weapon finishes unlock as you level, shown on a new Rank screen.',
    'Equip gear per slot to tune health, armour, speed, damage and spread; server persistence awards results authoritatively.',
  ]},
  {version:'v1.6',date:'2026-09-11',tag:'Theater and a living menu',highlights:[
    'Every finished match is recorded as compact keyframes; replay any recording with scrubbing, speed control and cinematic cameras.',
    'A camera director with seven rigs and auto-cuts to kills, explosions and captures.',
    'The main menu renders a live, auto-directed bot match behind the UI.',
  ]},
  {version:'v0.4',date:'2026-09-07',tag:'Local multiplayer',highlights:[
    'A Node game server authoritative over rooms, with per-actor inputs, sequenced 60 Hz inputs and 20 Hz snapshots.',
    'Client-side prediction and reconciliation for instant movement, aim and fire, plus interpolated remote actors.',
    'Session tokens, seat-holding, reconnection with token reattach, and bot handoff with host migration.',
  ]},
];

// Newest release first, defensively sorted so a bad edit cannot scramble the UI.
export const changelogReleases = () => [...CHANGELOG].sort((a, b) => {
  const parse = v => String(v || '').replace(/^v/, '').split('.').map(n => Number(n) || 0);
  const [a1, a2 = 0, a3 = 0] = parse(a.version), [b1, b2 = 0, b3 = 0] = parse(b.version);
  return b1 - a1 || b2 - a2 || b3 - a3;
});
