import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

const root = new URL('../', import.meta.url);

// The `ui` bag in app/page.tsx is loosely typed, so a screen that reads a field
// the page never provides compiles fine but throws at runtime (undefined field
// used as a value/function). This guards that contract.
test('every app/ui screen field exists in the page ui bag', async () => {
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  const start = page.indexOf('const ui:UiBag={');
  const end = page.indexOf('};', start);
  assert.ok(start >= 0 && end > start, 'ui bag literal found in app/page.tsx');
  const bag = page.slice(start, end);

  const dir = new URL('app/ui/screens/', root);
  const has = name => new RegExp('(^|[,{\\s])' + name + '\\s*[:,}]').test(bag);
  const failures = [];

  for (const file of await readdir(dir)) {
    if (!file.endsWith('.tsx')) continue;
    const src = await readFile(new URL(file, dir), 'utf8');
    // Module specifiers are not bag fields. Without this, importing
    // `game/class-ui.mjs` scans as a `ui.mjs` field read and fails the contract.
    const source = src.replace(/['"][^'"]*\.(?:mjs|js|ts|tsx)['"]/g, '""');
    const names = new Set();
    for (const m of source.matchAll(/const \{([^}]*)\}\s*=\s*ui;/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(':').pop().trim();
        if (name && !name.includes('=')) names.add(name);
      }
    }
    for (const m of source.matchAll(/\bui\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
    const missing = [...names].filter(name => !has(name));
    if (missing.length) failures.push(`${file}: ${missing.join(', ')}`);
  }

  assert.deepEqual(failures, [], `screens read ui fields the page does not provide:\n${failures.join('\n')}`);
});

// The lobby lifecycle surface and the measured RTT are consumed through the bag
// and the `net` snapshot. A screen reading these without a page binding would
// throw at runtime, so pin the exact wiring here.
test('the page wires the lobby lifecycle senders and the measured RTT', async () => {
 const page = await readFile(new URL('app/page.tsx', root), 'utf8');
 for (const field of ['netReady', 'netMapVote', 'netRematch', 'netWarmup']) {
  assert.ok(new RegExp(`(^|[,{\\s])${field}\\s*[,:]`).test(page), `the ui bag provides ${field}`);
  assert.ok(new RegExp(`const ${field}=`).test(page), `the page defines ${field}`);
 }
 assert.match(page, /rtt:Number\.isFinite\(n\?\.rtt\)\?n\.rtt:null/, 'netInfo carries the measured RTT');
 assert.match(page, /lifecycle:n\?\.lifecycle\?\?null/, 'netInfo carries the lobby lifecycle verbatim');
 assert.match(page, /disconnectedAt:Number\.isFinite\(n\?\.disconnectedAt\)/, 'netInfo carries the observed disconnect for the seat-hold estimate');
 assert.match(page, /stampLocalPing\(hud,/, 'the live scoreboard stamps the measured RTT onto the local row');
});

// The combat HUD wave threads kill richness, the bounded damage ledger and the
// assist credit from the page's event handling into the pure HUD models. These
// are additive: the net snapshot still carries `feed` and the measured RTT, and
// the new readouts never open a second live channel.
test('the page threads the kill richness, damage ledger and assist credit additively', async () => {
 const [page, hud, respawn] = await Promise.all([
  readFile(new URL('app/page.tsx', root), 'utf8'),
  readFile(new URL('app/ui/screens/PlayingHud.tsx', root), 'utf8'),
  readFile(new URL('app/ui/screens/RespawnOverlay.tsx', root), 'utf8'),
 ]);
 assert.match(page, /r\.killMeta=boundList\(r\.killMeta,/, 'the death event threads overkill, streaks and assist into a bounded record');
 assert.match(page, /killFeed=Array\.isArray\(snap\?\.feed\)\?snap\.feed\.map/, 'the snapshot feed is copied and enriched, never replaced in place');
 assert.match(page, /damageLog:damageRecap\(r\.damageLog,time\)/, 'the HUD snapshot carries the aged, bounded recap');
 assert.match(page, /damageLog:hud\?\.damageLog\?\?\[\]/, 'the ui bag exposes the recap to the death surfaces');
 assert.match(page, /r\.damageLog=boundList\(r\.damageLog,row,3\)/, 'the ledger keeps the last three incoming hits');
 assert.match(page, /assistCredit\(r\.assistAt,e\.actor,when\)/, 'assist credit reads the five second local-damage window');
 assert.match(page, /shieldBreak:s\.time-\(r\.lastShieldBreak\?\?-10\)<\.18/, 'the HUD hit marker window carries the shield break');
 assert.match(hud, /killFeedBadges\(e\)/, 'the feed renders the non-color badges');
 assert.match(hud, /hud\.killFeed\?\?hud\.feed/, 'the enriched feed copy falls back to the snapshot feed');
 assert.match(hud, /qualityNote\(hud\.quality\)/, 'the net note is a pure read of the quality model');
 assert.match(respawn, /death-recap--respawn/, 'the passive respawn summary renders the recap');
});

// Crosshair depth (Video tab) is additive: the shipped colour/size/dynamic-gap
// vars keep their names, the new knobs default to the old reticle, and every
// new control keeps a 44 px touch row.
test('the crosshair depth knobs stay additive and keep the reticle CSS-var contract', async () => {
 const [reticle, config, panel, css] = await Promise.all([
  readFile(new URL('app/ui/screens/SightReticle.tsx', root), 'utf8'),
  readFile(new URL('game/config.mjs', root), 'utf8'),
  readFile(new URL('app/game-ui/configuration.tsx', root), 'utf8'),
  readFile(new URL('app/globals.css', root), 'utf8'),
 ]);
 assert.ok(reticle.includes("'--crosshair-color':display.color,'--crosshair-size':display.size,'--crosshair-gap':`${crosshairGap}px`"), 'the pinned reticle vars survive unchanged');
 assert.match(reticle, /'--crosshair-base-gap'/, 'the base gap is an additive var');
 assert.match(reticle, /'--crosshair-thickness':display\.crosshairThickness\?\?1/, 'thickness is an additive var');
 assert.match(reticle, /'--ads-color':display\.adsColor\?\?display\.color/, 'the ADS colour is an additive var');
 assert.match(reticle, /display\.crosshairOutline!==false\?' has-outline'/, 'the outline class is additive and on by default');
 assert.match(reticle, /display\.crosshairDot===true\?' has-dot'/, 'the centre dot class is opt-in');
 assert.match(config, /crosshairOutline:c\.crosshairOutline!==false/, 'normalizeDisplay keeps the outline default');
 assert.match(config, /crosshairGap:number\(c\.crosshairGap,0,0,4\)/, 'the gap is clamped additively');
 assert.match(config, /crosshairDot:c\.crosshairDot===true/, 'the dot is opt-in in the normalizer');
 assert.match(panel, /label="Crosshair gap"/, 'the settings Video tab has the gap control');
 assert.match(panel, /label="Crosshair thickness"/, 'the thickness control exists');
 assert.match(panel, /label="Crosshair outline"/, 'the outline toggle exists');
 assert.match(panel, /label="Centre dot"/, 'the dot toggle exists');
 assert.match(panel, /label="ADS reticle color"/, 'the ADS colour control exists');
 assert.match(css, /\.crosshair-advanced \[data-slot=slider\] \{ min-height: 44px; \}/, 'the new sliders keep a 44 px touch row');
 assert.match(css, /\.crosshair-advanced \.config-toggle \{ min-height: 44px;/, 'the new toggles keep a 44 px touch row');
});

// Subtitle presentation, hold-vs-toggle inputs and per-sight ADS multipliers
// are additive display fields. The caption keeps its pinned class/role prefix
// and only gains CSS vars/data attributes; every new control keeps a 44 px row.
test('subtitle, hold-vs-toggle and per-sight ADS controls stay additive with 44 px rows', async () => {
  const [config, panel, hud, css, page] = await Promise.all([
    readFile(new URL('game/config.mjs', root), 'utf8'),
    readFile(new URL('app/game-ui/configuration.tsx', root), 'utf8'),
    readFile(new URL('app/ui/screens/PlayingHud.tsx', root), 'utf8'),
    readFile(new URL('app/globals.css', root), 'utf8'),
    readFile(new URL('app/page.tsx', root), 'utf8'),
  ]);
  assert.match(config, /captionScale:number\(c\.captionScale,1,CAPTION_SCALE_MIN,CAPTION_SCALE_MAX\)/, 'the caption scale is normalized additively');
  assert.match(config, /captionBackground:choice\(c\.captionBackground,\[\.\.\.CAPTION_BACKGROUNDS\],'dim'\)/, 'the background falls back to the shipped dim');
  assert.match(config, /captionPosition:choice\(c\.captionPosition,\[\.\.\.CAPTION_POSITIONS\],'bottom'\)/, 'the position falls back to bottom');
  assert.match(config, /adsToggle:c\.adsToggle===true/, 'the ADS toggle defaults on the held behavior');
  assert.match(config, /crouchToggle:c\.crouchToggle===true/);
  assert.match(config, /sprintToggle:c\.sprintToggle===true/);
  assert.match(config, /adsSensitivityNear:number\(c\.adsSensitivityNear,1,ADS_SENSITIVITY_MULT_MIN,ADS_SENSITIVITY_MULT_MAX\)/, 'per-sight multipliers clamp additively');
  assert.match(config, /export function adsSensitivityMultiplier/, 'the resolver is a pure helper');
  assert.match(config, /if\(kind==='iron'\)return 'near'/, 'the live sight kind picks the bucket');

  assert.match(panel, /className="caption-options" role="group" aria-label="Subtitle presentation"/, 'the caption controls are one named group');
  assert.match(panel, /label="Caption text size"/);
  assert.match(panel, /label="Caption background"/);
  assert.match(panel, /label="Caption position"/);
  assert.match(panel, /className="input-options" role="group" aria-label="Hold or toggle controls"/, 'the toggles are one named group');
  assert.match(panel, /label="ADS toggle"/);
  assert.match(panel, /label="Crouch toggle"/);
  assert.match(panel, /label="Sprint toggle"/);
  assert.match(panel, /label="ADS multiplier · near sights"/);
  assert.match(panel, /label="ADS multiplier · holo sights"/);
  assert.match(panel, /label="ADS multiplier · scope sights"/);

  assert.match(hud, /className="audio-caption" role="group"/, 'the pinned caption class/role prefix survives');
  assert.match(hud, /'--caption-scale':String\(display\.captionScale\?\?1\)/, 'the caption scale rides a CSS var');
  assert.match(hud, /data-caption-background=\{display\.captionBackground\?\?'dim'\}/, 'the background rides a data attribute');
  assert.match(hud, /data-caption-position=\{display\.captionPosition\?\?'bottom'\}/, 'the position rides a data attribute');
  assert.match(css, /\.audio-caption\[data-caption-background=solid\]\{background:#071317\}/);
  assert.match(css, /\.audio-caption\[data-caption-position=top\]\{bottom:auto;top:calc\(var\(--safe-top\) \+ 150px\)\}/);
  assert.match(css, /\.game-hud \.audio-caption\{font-size:calc\(12px \* var\(--hud-scale,1\) \* var\(--caption-scale,1\)\)\}/, 'the pinned HUD scale rule survives and stacks the caption scale');
  assert.match(css, /\.caption-options \[data-slot=slider\], \.ads-advanced \[data-slot=slider\] \{ min-height: 44px; \}/, 'the new sliders keep a 44 px touch row');
  assert.match(css, /\.caption-options \.config-toggle, \.input-options \.config-toggle \{ min-height: 44px; \}/, 'the new toggles keep a 44 px touch row');
  assert.match(css, /\.keybind-transfer textarea \{ min-height: 88px;/, 'the import field is a real touch target');

  assert.match(page, /adsSensitivityMultiplier\(d,r\?\.view\?\.getActiveSight\?\.\(\)\)/, 'the gain helper reads the live sight');
  assert.equal((page.match(/\(d\.adsSensitivity\?\?1\)\*adsSightGain\(r,d\)/g) ?? []).length, 3, 'both mouse gain sites and the touch gain site use the per-sight scale');
});

// THEATER / PROGRESSION discovery wave: the page owns retention, bookmarks and
// the next-three unlock list, and the screens render them without opening a
// second live region. The `ui` bag fields are pinned here as well as by the
// generic screen-field scan above.
test('the page wires retention, replay bookmarks and the next-three unlock list', async () => {
 const [page, theater, selection, results, settings] = await Promise.all([
  readFile(new URL('app/page.tsx', root), 'utf8'),
  readFile(new URL('app/ui/screens/TheaterScreen.tsx', root), 'utf8'),
  readFile(new URL('app/ui/screens/SelectionScreen.tsx', root), 'utf8'),
  readFile(new URL('app/ui/screens/ResultModals.tsx', root), 'utf8'),
  readFile(new URL('app/ui/screens/SettingsDialog.tsx', root), 'utf8'),
 ]);
 assert.match(page, /const nextUnlocks=nextUnlocksFor\(profile,3\)/, 'the page computes the discovery list from the pure helper');
 const start = page.indexOf('const ui:UiBag={');
 const end = page.indexOf('};', start);
 const bag = page.slice(start, end);
 for (const field of ['nextUnlocks', 'pruneDemos', 'bookmarkDemo', 'removeBookmark']) {
  assert.ok(new RegExp('(^|[,{\\s])' + field + '\\s*[:,}]').test(bag), `the ui bag provides ${field}`);
 }
 assert.match(selection, /nextUnlocks\.map\(/, 'Selection lists the next three unlocks');
 assert.match(results, /NEXT UNLOCKS/, 'the results card renders the discovery list');
 assert.match(theater, /demoSummaryText/, 'the Theater copy action builds the pure summary text');
 assert.match(theater, /await copyToClipboard\(/, 'the copy resolves through the shared clipboard helper before success is claimed');
 assert.match(theater, /COPIED/, 'success is a resolved-copy label');
 assert.doesNotMatch(theater, /aria-live/, 'the Theater adds no live region');
 assert.doesNotMatch(settings, /aria-live/, 'the help filter and comparison add no live region');
 assert.match(settings, /filterHelpSections/, 'the Help filter is a pure helper');
 assert.match(settings, /weaponRangeInfo/, 'the weapon comparison reads the shared range model');
});

// Screens that churned polite announcements tick-by-tick are demoted to plain
// named groups. The HUD's single live channel is the only announcement surface.
test('churning readouts are demoted from live regions to named groups', async () => {
  const [director, demo, board, panel, page] = await Promise.all([
    readFile(new URL('app/ui/screens/OperationsDirectorHud.tsx', root), 'utf8'),
    readFile(new URL('app/ui/DemoControls.tsx', root), 'utf8'),
    readFile(new URL('app/ui/screens/CommandBoardHud.tsx', root), 'utf8'),
    readFile(new URL('app/game-ui/configuration.tsx', root), 'utf8'),
    readFile(new URL('app/page.tsx', root), 'utf8'),
  ]);
  const lineWith = (source, needle) => source.split('\n').find(line => line.includes(needle)) ?? '';
  const bonus = lineWith(director, 'director-readout__bonus');
  assert.ok(bonus.includes('role="group"') && !bonus.includes('aria-live'), 'the bonus progress is a non-live group');
  const speed = lineWith(demo, 'u/s');
  assert.ok(speed.includes('role="group"') && !speed.includes('aria-live'), 'the free-speed value is a non-live group');
  const chip = lineWith(board, 'cocs-board__chip');
  assert.ok(chip.includes('role="group"') && !chip.includes('role="status"'), 'the duplicate board status chip is demoted');
  const modeDetail = lineWith(panel, 'mode-detail');
  assert.ok(modeDetail.includes('role="group"') && !modeDetail.includes('role="status"'), 'the mode detail is a non-live group');
  const banner = lineWith(page, 'update-banner');
  assert.ok(banner.includes('role="group"') && !banner.includes('role="status"'), 'the update banner is a non-live group');
});

// Keybind export/import rides the existing panel and the existing onChange, so
// RESET KEYS and duplicate-key surfacing keep their behavior.
test('the keybind panel exports and imports the action mapping beside RESET KEYS', async () => {
  const panel = await readFile(new URL('app/game-ui/configuration.tsx', root), 'utf8');
  assert.match(panel, /import \{[^}]*normalizeBindings[^}]*\} from '\.\.\/\.\.\/game\/keybinds\.mjs'/, 'the panel imports the same normalizer saved storage uses');
  assert.match(panel, /const bindingJson=\(\)=>JSON\.stringify\(Object\.fromEntries\(KEYBIND_ACTIONS\.map/, 'export walks every bindable action');
  assert.match(panel, /onChange\(normalizeBindings\(source\)\)/, 'import routes through the existing onChange');
  assert.match(panel, /EXPORT JSON/);
  assert.match(panel, /COPY JSON/);
  assert.match(panel, /IMPORT JSON/);
  assert.match(panel, /RESET KEYS/);
  assert.match(panel, /Duplicate keys: \{conflicts\.join\(', '\)\}/, 'conflict surfacing survives');
});

// Interface-freeze audio host wiring: every newer channel is optional-chained,
// and the hold-vs-toggle prefs latch the existing runtime flags so the sim input
// shape never grows a field.
test('the page hosts the optional audio channels and latches the toggle prefs', async () => {
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  assert.match(page, /r\.audio\?\.setKillcam\?\.\(view\.killcamActive\?\.\(\)===true\)/, 'the frame loop mirrors the killcam state');
  assert.match(page, /r\.audio\?\.setSpectating\?\.\(r\.net\?\.spectate===true\|\|r\.spectateLocal===true\)/, 'the frame loop mirrors spectating');
  assert.match(page, /if\(r\.menuTab!==menuTab\)\{r\.menuTab=menuTab;r\.audio\?\.setMenuTab\?\.\(menuTab\);\}/, 'the menu tab only fires on a change and when the method exists');
  assert.match(page, /audio\?\.announcerCue\?\.\(win\?'victory':'defeat'\)/, 'the local match over voices the result');
  assert.match(page, /const toggleCrouch=\(boundAction==='crouch'\|\|e\.code==='KeyC'\)&&r\.display\?\.crouchToggle===true/);
  assert.match(page, /const toggleSprint=boundAction==='sprint'&&r\.display\?\.sprintToggle===true/);
  assert.match(page, /if\(!toggleCrouch&&!toggleSprint\)keys\.add\(e\.code\)/, 'a latched key never enters the held code set');
  assert.match(page, /sprint:r\.toggleSprint===true\|\|r\.touch\?\.sprint===true,crouch:r\.toggleCrouch===true\|\|r\.touch\?\.crouch===true/, 'the latch feeds the existing sprint/crouch booleans');
  assert.match(page, /if\(r\.display\?\.adsToggle===true\)r\.ads=r\.ads!==true;else r\.ads=true/, 'right mouse latches ADS when asked');
  assert.match(page, /else if\(e\.button===2\)\{if\(r\.display\?\.adsToggle!==true\)r\.ads=false;\}/, 'release only clears the held ADS');
  assert.match(page, /r\.toggleCrouch=false;r\.toggleSprint=false/, 'leaving combat clears both latches');
});

test('the page only feeds a local match to the audio engine while it owns the screen', async () => {
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  assert.match(page, /\['playing','paused','results'\]\.includes\(modeRef\.current\)\)audio\.update\(r\.match\.actors\[0\]/, 'the stale-match audio update is gated to screen-owning modes');
});

test('the title logo is a particle canvas with the DOM mark kept as the fallback', async () => {
  const [screen, component, css] = await Promise.all([
    readFile(new URL('app/ui/screens/TitleScreen.tsx', root), 'utf8'),
    readFile(new URL('app/game-ui/particle-logo.tsx', root), 'utf8'),
    readFile(new URL('app/styles/ui.css', root), 'utf8'),
  ]);
  assert.match(screen, /<ParticleLogo label=\{BRAND\?\.name\|\|'COCS'\}\/>/, 'the title mounts the particle canvas');
  assert.match(screen, /<h1 className="logo" aria-label=\{BRAND\?\.name\|\|'COCS'\}>/, 'the DOM mark keeps its accessible name');
  assert.match(component, /className="particle-logo-canvas" aria-hidden="true"/, 'the canvas is decorative');
  assert.match(component, /classList\.add\('has-particle-logo'\)/, 'the DOM glyphs are hidden only after a frame renders');
  assert.match(component, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/, 'reduced motion is detected for the static frame');
  assert.match(component, /targets\.count < 300\) return null/, 'a sparse raster keeps the DOM logo instead');
  assert.match(component, /getContext\('2d'\)/, 'the title field is a lightweight 2D canvas, not a second WebGL context');
  assert.doesNotMatch(component, /WebGLRenderer|three/, 'the title logo no longer pulls in the 3D renderer');
  assert.match(css, /\.has-particle-logo \.logo-glyph,\.has-particle-logo \.logo-word\{visibility:hidden\}/, 'the fallback stays in layout for assistive tech');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.particle-logo-canvas,\.logo-shell::before\{transition:none\}\}/, 'the canvas fade has an OS gate');
  assert.match(css, /\.motion-reduced \.particle-logo-canvas,\.motion-reduced \.logo-shell::before\{transition:none\}/, 'and an in-game twin');
});

// Fieldwork v8.6 — the PvP team-FLUX purchase cards and the NEGLECT meter are
// additive, non-live readouts. They keep the HUD's single live channel
// untouched, every control keeps a 44px row, and no new snapshot field is
// introduced: the cards read roleBoard/FLUX/threads and the meter reads the
// existing `neglect` number.
test('the team-FLUX purchase cards and NEGLECT chip are non-live, 44px and snapshot-driven', async () => {
  const [hud, board, css, page] = await Promise.all([
    readFile(new URL('app/ui/screens/PlayingHud.tsx', root), 'utf8'),
    readFile(new URL('app/ui/screens/CommandBoardHud.tsx', root), 'utf8'),
    readFile(new URL('app/globals.css', root), 'utf8'),
    readFile(new URL('app/page.tsx', root), 'utf8'),
  ]);
  const lineWith = (source, needle) => source.split('\n').find(line => line.includes(needle)) ?? '';
  const buys = lineWith(hud, 'className="cocs-buys"');
  assert.ok(buys.includes('role="group"') && !buys.includes('aria-live'), 'the purchase strip is one non-live group');
  assert.match(hud, /TEAM FLUX <small>/, 'the strip names the team FLUX pool and THREADS');
  assert.match(hud, /command\.purchases\.cards\.map/, 'the cards render the pure purchase view');
  assert.match(hud, /command\.onPurchaseCocs\?\.\(card\)/, 'the cards dispatch through the page handler');
  const neglect = lineWith(hud, 'cocs-chip--neglect');
  assert.ok(neglect.includes('NEGLECT <b>') && !neglect.includes('aria-live'), 'NEGLECT is a word + number, never a live region');
  assert.match(hud, /economy\.neglect\.label/, 'the tier word rides the readout');
  assert.match(hud, /economy\.neglect\.multiplier/, 'the passive multiplier is spoken on demand');
  assert.match(board, /export function TeamFluxStore/, 'the board hosts the same purchase model');
  assert.match(board, /cocs-board__flux/, 'the board store has its own compact class');
  assert.match(board, /onPurchase=\{command\.onPurchaseCocs\}/, 'the board dispatches through the same handler');
  assert.doesNotMatch(lineWith(board, 'cocs-board__flux-toggle'), /aria-live/, 'the board store is not a live region');
  assert.match(page, /onPurchaseCocs:purchaseCocs/, 'the page folds the handler into the command bag');
  assert.match(page, /const purchaseCocs=\(card:any\)=>/, 'the page has one purchase entry point');
  assert.match(page, /spendCocs\(card\.action\?\?card\.verb,card\.target\?\?null,\{role:card\.role\?\?null\}\)/, 'purchases ride the existing spendCocs queue');
  assert.match(hud, /\{!command\.spectate&&command\.purchases\?\.visible/, 'the purchase strip is hidden for spectators');
  assert.match(hud, /\{!command\.spectate&&<div className="cocs-strip"/, 'the order strip hides for spectators');
  assert.match(hud, /\{cocsCommand&&<CocsReadout /, 'the read-only cocs info still renders for spectators');
  assert.match(hud, /\{!command\.spectate&&command\.interactPrompt/, 'spectators get no act-now interact prompt');
  assert.match(css, /\.cocs-buy\{[^}]*min-height:44px/, 'every purchase card keeps a 44 px row');
  assert.match(css, /\.cocs-board__flux-toggle\{[^}]*min-height:44px/, 'the board store toggle keeps a 44 px row');
});

// Spectators must never accumulate a silent local queue. Every dispatch path
// (strip issue, board activation, spend, purchase) refuses before it can push
// `r.cocsOrders`/`r.cocsSpends`, and entering spectate drains the queues.
test('spectator dispatch can never queue COCS orders or spends', async () => {
  const [page, view] = await Promise.all([
    readFile(new URL('app/page.tsx', root), 'utf8'),
    readFile(new URL('game/cocs-orders.mjs', root), 'utf8'),
  ]);
  assert.match(page, /const spectatingCocs=\(\)=>\{const r=runtime\.current;return hud\?\.spectate===true\|\|r\?\.net\?\.spectate===true\|\|r\?\.spectateLocal===true;\}/, 'one spectator predicate covers local and network viewing');
  assert.match(page, /const spendCocs=\(verb:string,target:any,options\?:\{role\?:string\|null\}\)=>\{\s*if\(spectatingCocs\(\)\)return \{ok:false,reason:'SPECTATING'\};/, 'a spectator spend refuses before queueing');
  assert.match(page, /const issueCocsOrder=\(\)=>\{const r=runtime\.current;if\(!r\|\|hud\?\.spectate===true\|\|r\.net\?\.spectate===true\|\|r\.spectateLocal===true\)return;/, 'a spectator strip issue refuses before queueing');
  assert.match(page, /if\(hud\?\.spectate===true\|\|r\.net\?\.spectate===true\|\|r\.spectateLocal===true\)return \{ok:false,reason:'SPECTATING'\};/, 'a spectator board activation refuses before queueing');
  assert.match(page, /if\(r\.net\?\.spectate\|\|r\.spectateLocal\|\|hud\.spectate\)return \{ok:false,reason:'SPECTATING'\};/, 'a spectator REQ buy refuses before queueing');
  assert.match(page, /const sendCocsCommand=\(action:string,value:any=null,opts\?:\{cardId\?:string;tick\?:number\}\)=>\{const r=runtime\.current;if\(!r\|\|spectatingCocs\(\)\)return null;/, 'a spectator command refuses before queueing');
  assert.match(page, /r\.cocsOrders=\[\];r\.cocsSpends=\[\];r\.cocsSpendSeq=0;r\.cocsBuys=\[\];r\.cocsBuySeq=0;r\.cocsBuysPending=\[\];r\.cocsCommands=\[\];r\.cocsCommandSeq=0;r\.cocsCommandSeat=null;setCocsReqPending\(\[\]\);/, 'entering spectate drains the local queues');
  assert.match(page, /cocsBoardRef\.current=\{\.\.\.cocsBoardRef\.current,open:false,pinned:false,active:0,collapsed:false\};setCocsBoard\(\{open:false,pinned:false,active:0\}\);/, 'entering spectate closes the command board');
  assert.match(view, /visible: !spectate && cards\.some/, 'the purchase view is inherently hidden for spectators');
});
