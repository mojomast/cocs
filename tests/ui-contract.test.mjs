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
  assert.match(component, /targets\.count < 600\) return null/, 'a sparse raster keeps the DOM logo instead');
  assert.match(css, /\.has-particle-logo \.logo-glyph,\.has-particle-logo \.logo-word\{visibility:hidden\}/, 'the fallback stays in layout for assistive tech');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.particle-logo-canvas,\.logo-shell::before\{transition:none\}\}/, 'the canvas fade has an OS gate');
  assert.match(css, /\.motion-reduced \.particle-logo-canvas,\.motion-reduced \.logo-shell::before\{transition:none\}/, 'and an in-game twin');
});
