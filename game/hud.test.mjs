import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleHud, escapeHint, voiceHint, spectatorControls, SPECTATOR_RESERVED_KEYS, reloadProgress, dynamicCrosshairGap, lowAmmo, postureLabel, hitMarker, projectToScreen, damageNumberStyle, boundList, damageBearing, killBanner, weaponTag, ammoText, commandBrief, isTeamMode, matchStartBanner, modeColumns, modeGoal, modePrimary, modeTargetText, objectiveCopy, suddenDeathBanner, grenadeStatus, killstreakCallout, ladderStatus, streakStatus, audioCaption, altFireLabel, scoreAnnouncer, multikillLabel, spreeLabel, recentKills, killCallout, matchAwards, killFeedWeapon, connectionQuality, spectateActor, nextSpectateTarget, spectatorBoard, spectatorTeams, weaponRangeInfo, weaponRangeLabel, scoreStats, cocsDominanceStatus, cocsOperationsStatus, cocsOutcomeView, acceptCocsAnnouncement, cocsAnnouncePriority, cocsAnnouncementTTL, COCS_ANNOUNCE_PRIORITY, damageHitText, captionPriority, acceptCaption, CAPTION_TTL, teamStatusHud, economyHud} from './hud.mjs';
import {WEAPONS} from './data.mjs';
import {GAME_MODES,teamMode} from './config.mjs';
import {soccerDisplay,soccerResult} from './race-ui.mjs';

const player = {id:0, health:100, x:0, z:0, vehicleId:null};
const ride = {id:0, health:200, maxHealth:300, x:2, z:0, driver:null, respawnTimer:0, heat:.8, overheated:true};

test('entry prompt matches range, occupancy, life and flag restrictions', () => {
  assert.equal(vehicleHud(player, [ride]).prompt, 'E / ENTER PUMA');
  for (const change of [{x:2.4}, {driver:1}, {health:0}, {respawnTimer:1}]) assert.equal(vehicleHud(player, [{...ride, ...change}]).prompt, '');
  assert.equal(vehicleHud(player, [ride], [{carrier:0}]).prompt, '');
  assert.equal(vehicleHud({...player, health:0}, [ride]).prompt, '');
  assert.equal(vehicleHud(player, [ride], [], true).prompt, '');
  assert.equal(vehicleHud(undefined).prompt, '');
});

test('driver receives authoritative vehicle telemetry and exit prompt, including id zero', () => {
  const vehicle = {...ride, driver:0};
  const result = vehicleHud({...player, vehicleId:0}, [vehicle]);
  assert.equal(result.vehicle, vehicle);
  assert.equal(result.prompt, 'E / EXIT PUMA');
  assert.equal(vehicleHud({...player, vehicleId:0}, [ride]).vehicle, null);
  assert.equal(vehicleHud({...player, vehicleId:0}, [vehicle], [], true).vehicle, null);
});

test('Escape distinguishes local pause from the live online lobby', () => {
  assert.equal(escapeHint(false), 'ESC / PAUSE');
  assert.equal(escapeHint(true), 'ESC / LOBBY (MATCH CONTINUES)');
});

test('voice hint exposes PTT and voice activation without implying a silent mic', () => {
  assert.equal(voiceHint(false, 'ptt'), null);
  assert.equal(voiceHint(false, 'auto'), null);
  assert.equal(voiceHint(true, 'ptt'), 'V / TALK');
  assert.equal(voiceHint(true, 'auto'), 'VOICE / AUTO TALK');
  assert.equal(voiceHint(true, 'unknown'), 'VOICE ON');
});

test('vehicle prompts and the PTT hint follow remapped bindings', () => {
  const bindings = {interact: 'KeyL', voice: 'KeyI'};
  assert.equal(vehicleHud(player, [ride], [], false, bindings).prompt, 'L / ENTER PUMA');
  assert.equal(vehicleHud({...player, vehicleId: 0}, [{...ride, driver: 0}], [], false, bindings).prompt, 'L / EXIT PUMA');
  assert.equal(vehicleHud(player, [ride]).prompt, 'E / ENTER PUMA', 'pure callers keep the default label');
  assert.equal(voiceHint(true, 'ptt', bindings), 'I / TALK');
  assert.equal(voiceHint(true, 'auto', bindings), 'VOICE / AUTO TALK', 'auto talk has no key to name');
});

test('spectator controls label fixed keys as reserved and follow movement bindings', () => {
  const local = spectatorControls({local: true, cursorKey: 'O'});
  assert.match(local, /^O cursor/);
  assert.match(local, /RESERVED: \[ \/ \] follow, B camera, F free cam, H hide HUD/);
  assert.match(local, /Free cam: WASD \/ SPACE \/ LEFT SHIFT \/ LEFT CTRL\./);
  const remote = spectatorControls({local: false});
  assert.match(remote, /^RESERVED: \[ \/ \] follow, H hide HUD, P third person · ESC lobby$/);
  assert.deepEqual(SPECTATOR_RESERVED_KEYS, {camera: 'KeyB', freeCam: 'KeyF', hideHud: 'KeyH', thirdPerson: 'KeyP'});
  const remapped = spectatorControls({local: true, cursorKey: 'O', bindings: {forward: 'KeyI', left: 'KeyJ', back: 'KeyK', right: 'KeyL', jump: 'KeyU', sprint: 'ShiftRight', crouch: 'ControlRight'}});
  assert.match(remapped, /Free cam: IJKL \/ U \/ RIGHT SHIFT \/ RIGHT CTRL\./, 'free-cam copy reads the live movement bindings');
  assert.match(remapped, /RESERVED: \[ \/ \] follow, B camera/, 'fixed spectator keys stay labelled reserved even after a remap');
});

test('reloadProgress tracks a countdown timer and clamps to the bar', () => {
  assert.equal(reloadProgress({reloading:true,reloadTimer:1,reloadDuration:2}), .5);
  assert.equal(reloadProgress({reloading:true,reloadTimer:0,reloadDuration:2}), 1);
  assert.equal(reloadProgress({reloading:true,reloadTimer:2,reloadDuration:2}), 0);
  assert.equal(reloadProgress({reloading:false,reloadTimer:1,reloadDuration:2}), 0);
  assert.equal(reloadProgress({reloading:true,reloadDuration:0}), 1);
  assert.equal(reloadProgress(undefined), 0);
});

test('dynamicCrosshairGap grows with spread, respects size and stays bounded', () => {
  assert.equal(dynamicCrosshairGap(0), 0);
  assert.ok(dynamicCrosshairGap(.05) > dynamicCrosshairGap(.01));
  assert.equal(dynamicCrosshairGap(.05, 2), dynamicCrosshairGap(.05, 1) * 2);
  assert.ok(dynamicCrosshairGap(1) <= 24);
  assert.equal(dynamicCrosshairGap(undefined), 0);
});

test('lowAmmo warns only for finite weapons at a quarter capacity', () => {
  assert.equal(lowAmmo({weapon:1, ammo:[Infinity, 4, 0]}, WEAPONS), true);
  assert.equal(lowAmmo({weapon:1, ammo:[Infinity, 5, 0]}, WEAPONS), false);
  assert.equal(lowAmmo({weapon:0, ammo:[Infinity, 5, 0]}, WEAPONS), false);
  assert.equal(lowAmmo({weapon:1, ammo:[Infinity, 0, 0]}, WEAPONS), false);
  assert.equal(lowAmmo(undefined, WEAPONS), false);
});

test('postureLabel prioritizes slide, then crouch, then sprint', () => {
  assert.equal(postureLabel({sliding:true,crouching:true,sprinting:true}), 'SLIDE');
  assert.equal(postureLabel({crouching:true,sprinting:true}), 'CROUCH');
  assert.equal(postureLabel({sprinting:true}), 'SPRINT');
  assert.equal(postureLabel({}), null);
  assert.equal(postureLabel(undefined), null);
});

test('hitMarker promotes a recent local kill over a normal hit', () => {
  const player = {name:'ChatGPT'};
  assert.equal(hitMarker({hit:true,time:10}, player), 'hit');
  assert.equal(hitMarker({hit:true,critical:true,time:10}, player), 'critical');
  assert.equal(hitMarker({hit:true,critical:true,time:10,feed:[{killer:'ChatGPT',victim:'Grok',self:false,time:9.5}]}, player), 'kill');
  assert.equal(hitMarker({hit:true,time:10,feed:[{killer:'ChatGPT',victim:'Grok',self:false,time:9.5}]}, player), 'kill');
  assert.equal(hitMarker({kill:true,time:10}, player), 'kill');
  assert.equal(hitMarker({hit:true,time:10,feed:[{killer:'Grok',victim:'ChatGPT',self:false,time:9.5}]}, player), 'hit');
  assert.equal(hitMarker({hit:true,time:10,feed:[{killer:'ChatGPT',victim:'Grok',self:false,time:9.2}]}, player), 'hit');
  assert.equal(hitMarker({hit:false,time:10,feed:[{killer:'ChatGPT',victim:'Grok',self:false,time:9.8}]}, player), null);
  assert.equal(hitMarker({hit:false,time:10,feed:[{killer:'ChatGPT',victim:'Grok',time:1}]}, player), null);
  assert.equal(hitMarker({}, player), null);
});

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const camera = {matrixWorldInverse:{elements:identity}, projectionMatrix:{elements:identity}};
const rect = {left:100, top:50, width:800, height:600};

test('projectToScreen maps NDC to CSS pixels over the canvas rect', () => {
  assert.deepEqual(projectToScreen(camera, rect, {x:0, y:0, z:0}), {x:500, y:350, depth:0});
  assert.deepEqual(projectToScreen(camera, rect, {x:1, y:1, z:0}), {x:900, y:50, depth:0});
  assert.deepEqual(projectToScreen(camera, rect, {x:-1, y:-1, z:0}), {x:100, y:650, depth:0});
  assert.equal(projectToScreen(camera, rect, {x:0, y:0, z:2}), null);
  assert.equal(projectToScreen(camera, rect, {x:0, y:0, z:-2}), null);
  assert.equal(projectToScreen(camera, rect, {x:NaN, y:0, z:0}), null);
  assert.equal(projectToScreen(null, rect, {x:0, y:0, z:0}), null);
  assert.equal(projectToScreen(camera, null, {x:0, y:0, z:0}), null);
});

test('projectToScreen reads column-major THREE matrix elements', () => {
  const rotateZ = {matrixWorldInverse:{elements:[0,1,0,0, -1,0,0,0, 0,0,1,0, 0,0,0,1]}, projectionMatrix:{elements:identity}};
  const top = projectToScreen(rotateZ, rect, {x:1, y:0, z:0});
  assert.equal(top.x, 500);
  assert.equal(top.y, 50);
});

test('damageNumberStyle fades and rises, holding position under reduced motion', () => {
  assert.deepEqual(damageNumberStyle(0), {opacity:1, dy:0, done:false});
  assert.equal(damageNumberStyle(.3).dy, -14);
  assert.ok(damageNumberStyle(.6).done);
  assert.equal(damageNumberStyle(.6).opacity, 0);
  assert.equal(damageNumberStyle(.3, {reduced:true}).dy, 0);
  assert.equal(damageNumberStyle(undefined).opacity, 1);
});

test('boundList caps concurrent entries and tolerates missing or invalid lists', () => {
  assert.deepEqual(boundList([], 'a', 2), ['a']);
  assert.deepEqual(boundList(['a', 'b'], 'c', 2), ['b', 'c']);
  assert.deepEqual(boundList(undefined, 'a', 2), ['a']);
  assert.deepEqual(boundList(['a', 'b', 'c'], 'd', -1), ['a', 'b', 'c', 'd']);
});

test('damageBearing measures relative yaw with forward at zero', () => {
  const local = {x:0, z:0, yaw:0};
  assert.ok(Math.abs(damageBearing(local, {x:0, z:-1}).angle) < 1e-9);
  assert.ok(Math.abs(damageBearing(local, {x:-1, z:0}).angle - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(damageBearing(local, {x:1, z:0}).angle + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(damageBearing(local, {x:0, z:1}).angle) - Math.PI) < 1e-9);
  assert.equal(damageBearing({x:0, z:0, yaw:Math.PI / 2}, {x:-1, z:0}).angle, 0);
  assert.equal(damageBearing(local, null), null);
  assert.equal(damageBearing(null, {x:0, z:0}), null);
});

test('killBanner derives kill, death and self text with age', () => {
  const player = {name:'ChatGPT'}, close = (actual, expected) => { const rest = {...actual}; delete rest.age; assert.deepEqual(rest, expected); assert.ok(Math.abs(actual.age - .6) < 1e-9); };
  close(killBanner({time:10, feed:[{killer:'ChatGPT', victim:'Grok', self:false, time:9.4}]}, player), {kind:'kill', text:'YOU ELIMINATED Grok'});
  close(killBanner({time:10, feed:[{killer:'Grok', victim:'ChatGPT', self:false, time:9.4}]}, player), {kind:'death', text:'Grok ELIMINATED YOU'});
  close(killBanner({time:10, feed:[{killer:'The void', victim:'ChatGPT', self:true, time:9.4}]}, player), {kind:'self', text:'ELIMINATED'});
  assert.equal(killBanner({time:10, feed:[{killer:'Grok', victim:'Llama', self:false, time:9.4}]}, player), null);
  // Another actor's suicide or fall must not show the local ELIMINATED banner.
  assert.equal(killBanner({time:10, feed:[{killer:'The void', victim:'Llama', self:true, time:9.4}]}, player), null);
  assert.equal(killBanner({time:10, feed:[{killer:'Grok', victim:'Grok', self:true, time:9.4}]}, player), null);
  close(killBanner({time:10, feed:[{killer:'ChatGPT', victim:'ChatGPT', self:true, time:9.4}]}, player), {kind:'self', text:'ELIMINATED'});
  assert.equal(killBanner({time:10, feed:[{killer:'ChatGPT', victim:'Grok', self:false}]}, player), null);
  assert.equal(killBanner({}, player), null);
});

test('ability kills name the active in the kill feed and banner detail', () => {
  assert.equal(killFeedWeapon({ability:true, abilityName:'Claw Burst', weapon:0}, WEAPONS), 'CLAW BURST');
  assert.equal(killFeedWeapon({ability:true, abilityName:'Recompile'}, WEAPONS), 'RECOMPILE');
  assert.equal(killFeedWeapon({ability:true}, WEAPONS), null, 'an ability without a name falls back to no label');
  assert.equal(killFeedWeapon({ability:false, abilityName:'Claw Burst', weapon:2}, WEAPONS), 'RAIL', 'a non-ability kill keeps the weapon label');
  const feed = {killer:'Mistral', victim:'ChatGPT', self:false, time:9.4, weapon:0, ability:true, abilityName:'Claw Burst'};
  const death = killBanner({time:10, feed:[feed]}, {name:'ChatGPT'});
  assert.equal(death.kind, 'death');
  assert.equal(death.text, 'Mistral ELIMINATED YOU');
  assert.equal(death.detail, 'CLAW BURST');
  const own = killBanner({time:10, feed:[{...feed, abilityName:'Phase Step'}]}, {name:'Mistral'});
  assert.equal(own.text, 'YOU ELIMINATED ChatGPT');
  assert.equal(own.detail, 'WITH PHASE STEP');
  const plain = killBanner({time:10, feed:[{killer:'Mistral', victim:'ChatGPT', self:false, time:9.4}]}, {name:'ChatGPT'});
  assert.equal('detail' in plain, false, 'a weapon kill adds no detail key');
});

test('killBanner attributes a plain weapon kill through the shared weapon table', () => {
  const feed = {killer:'Grok', victim:'ChatGPT', self:false, time:9.4, weapon:2, ability:false};
  const death = killBanner({time:10, feed:[feed]}, {name:'ChatGPT'}, WEAPONS);
  assert.equal(death.kind, 'death');
  assert.equal(death.text, 'Grok ELIMINATED YOU');
  assert.equal(death.detail, 'RAIL');
  assert.equal(killBanner({time:10, feed:[feed]}, {name:'Grok'}, WEAPONS).detail, 'WITH RAIL');
  assert.equal('detail' in killBanner({time:10, feed:[feed]}, {name:'ChatGPT'}), false, 'a caller without the weapon table keeps the old line');
  // An ability still wins the format when both are present.
  assert.equal(killBanner({time:10, feed:[{...feed, ability:true, abilityName:'Claw Burst'}]}, {name:'ChatGPT'}, WEAPONS).detail, 'CLAW BURST');
});

test('damageHitText names the source, weapon, amount and remaining health', () => {
  assert.equal(damageHitText({name:'Grok', weapon:2, amount:42, health:18}, WEAPONS), 'HIT BY GROK · RAIL · 42 · 18 HP');
  assert.equal(damageHitText({amount:7}), 'HIT · 7');
  assert.equal(damageHitText({name:'Mistral', ability:true, abilityName:'Claw Burst', amount:30}), 'HIT BY MISTRAL · CLAW BURST · 30');
  assert.equal(damageHitText({name:'Grok', weapon:99, amount:12, health:88}, WEAPONS), 'HIT BY GROK · 12 · 88 HP', 'an unknown weapon index degrades without a dangling separator');
  assert.equal(damageHitText({health:0}), 'HIT · 0 HP');
  assert.equal(damageHitText({}), 'HIT');
  assert.equal(damageHitText(null), '');
  assert.equal(damageHitText(undefined), '');
});

test('caption priority reuses the assistive ranks and protects important lines', () => {
  assert.equal(CAPTION_TTL, 2.2);
  assert.equal(captionPriority({type:'mission-lost'}), 130);
  assert.equal(captionPriority({type:'boss-phase'}), 120);
  assert.equal(captionPriority({type:'killstreak'}), 109);
  assert.equal(captionPriority({type:'shot'}), 80);
  assert.equal(captionPriority(null), 80);
  assert.ok(captionPriority({type:'mission-lost'}) > captionPriority({type:'shot'}));

  const important = acceptCaption(null, 0, {text:'MISSION FAILED', priority:captionPriority({type:'mission-lost'})}, 10);
  assert.equal(important.text, 'MISSION FAILED');
  assert.equal(important.at, 10);
  assert.equal(acceptCaption(important, 10, {text:'Gunfire', priority:captionPriority({type:'shot'})}, 11), null, 'routine chatter cannot clobber a protected line');
  assert.equal(acceptCaption(important, 10, {text:'MISSION FAILED', priority:130}, 11), null, 'an identical line inside the window is deduped');
  assert.equal(acceptCaption(important, 10, {text:'Gunfire', priority:80}, 13).text, 'Gunfire', 'the 2.2 s window still releases the line');

  const boss = acceptCaption(null, 0, {text:'Boss phase', priority:120}, 1);
  assert.equal(acceptCaption(boss, 1, {text:'MISSION FAILED', priority:130}, 2).text, 'MISSION FAILED', 'a higher-ranked beat still pre-empts');
  const gun = acceptCaption(null, 0, {text:'Gunfire', priority:80}, 3);
  assert.equal(acceptCaption(gun, 3, {text:'Explosion', priority:80}, 3.5).text, 'Explosion', 'routine captions stay last-write-wins');
  assert.equal(acceptCaption(null, 0, {text:'   '}, 0), null);
  assert.equal(acceptCaption(null, 0, null, 0), null);
  // A legacy string state still participates as a routine line.
  assert.equal(acceptCaption('Reloading', 1, {text:'Explosion', priority:80}, 2).text, 'Explosion');
  assert.equal(acceptCaption('Reloading', 1, {text:'MISSION FAILED', priority:130}, 2).text, 'MISSION FAILED');
});

test('movement verbs, ability activations and threat pings have readable captions', () => {
  const expected = {
    power: 'Ability activated',
    'threat-ping': 'Threat ping',
    'move-start': 'Movement ability',
    'move-end': 'Movement ended',
    'windup-start': 'Movement wind-up',
    'slam-impact': 'Slam impact',
    'grapple-hook': 'Grapple hooked',
    'rope-place': 'Rope deployed',
    'rope-expire': 'Rope expired',
    'fuel-empty': 'Fuel empty',
    'no-lift': 'Movement blocked',
    'chain-cancel': 'Movement chained',
    'landing-recovery': 'Landing recovery',
  };
  for (const [type, text] of Object.entries(expected)) assert.equal(audioCaption({type}).text, text, type);
});

test('weaponTag and ammoText describe fire mode and unlimited ammo', () => {
  assert.equal(weaponTag(WEAPONS[0]), 'AUTO');
  assert.equal(weaponTag(WEAPONS[2]), 'SEMI');
  assert.equal(weaponTag(null), null);
  assert.equal(ammoText(5), '5');
  assert.equal(ammoText(Infinity), '∞');
  assert.equal(ammoText('∞'), '∞');
});

test('matchStartBanner announces FIGHT with the mode and map for a short window', () => {
  const start = matchStartBanner({time:.5, modeName:'Capture the Flag', mapName:'Exchange'});
  assert.deepEqual(start, {text:'FIGHT', detail:'CAPTURE THE FLAG · EXCHANGE', age:.5, duration:2.6});
  assert.equal(matchStartBanner({time:3, modeName:'Capture the Flag', mapName:'Exchange'}), null);
  assert.equal(matchStartBanner({}), null);
});

test('scoreAnnouncer fires only when a team score crosses an integer', () => {
  assert.deepEqual(scoreAnnouncer({teamScores:{0:2, 1:1}, config:{mode:'teamdeathmatch'}}, {0:1, 1:1}), {team:0, kind:'score', text:'RED SCORES', score:2, amount:1});
  assert.deepEqual(scoreAnnouncer({teamScores:{0:1, 1:3}, config:{mode:'ctf'}}, {0:1, 1:2}), {team:1, kind:'capture', text:'FLAG CAPTURED', score:3, amount:1});
  assert.equal(scoreAnnouncer({teamScores:{0:4.4, 1:1}, config:{mode:'domination'}}, {0:4.1, 1:1}), null);
  assert.equal(scoreAnnouncer({teamScores:{0:2, 1:1}, config:{mode:'deathmatch'}}, {0:2, 1:1}), null);
  assert.equal(scoreAnnouncer({teamScores:{0:2, 1:1}}, null), null);
});

test('multikillLabel names rapid kill chains and stops at the cap', () => {
  assert.equal(multikillLabel(0), null);
  assert.equal(multikillLabel(1), null);
  assert.equal(multikillLabel(2), 'DOUBLE KILL');
  assert.equal(multikillLabel(3), 'TRIPLE KILL');
  assert.equal(multikillLabel(4), 'OVERKILL');
  assert.equal(multikillLabel(5), 'MONSTER KILL');
  assert.equal(multikillLabel(9), 'MEGA KILL');
});

test('spreeLabel fires only on five-kill milestones', () => {
  assert.equal(spreeLabel(4), null);
  assert.equal(spreeLabel(5), 'KILLING SPREE');
  assert.equal(spreeLabel(6), null);
  assert.equal(spreeLabel(10), 'RAMPAGE');
  assert.equal(spreeLabel(15), 'DOMINATING');
  assert.equal(spreeLabel(25), 'GODLIKE');
  assert.equal(spreeLabel(40), 'LEGENDARY');
});

test('recentKills counts only kills inside the trailing window', () => {
  assert.equal(recentKills([1, 2, 3], 3, 4), 3);
  assert.equal(recentKills([1, 2, 3], 6, 4), 2);
  assert.equal(recentKills([1, 2, 3], 8, 4), 0);
  assert.equal(recentKills('nope', 3), 0);
  assert.equal(recentKills([1], NaN), 0);
});

test('killCallout prioritizes a spree milestone, then a multikill, then silence', () => {
  assert.equal(killCallout([], 10), null);
  assert.deepEqual(killCallout([9.5, 9.8], 10), {kind:'multikill', text:'DOUBLE KILL', detail:'2 KILL STREAK', streak:2, count:2});
  assert.equal(killCallout([8, 8.5, 9, 9.4, 9.7], 10).kind, 'spree');
  assert.equal(killCallout([8, 8.5, 9, 9.4, 9.7], 10).text, 'KILLING SPREE');
  assert.equal(killCallout([1], 10), null);
});

const awardActor = (id, name, frags, deaths, scoreStats = {}) => ({id, name, frags, deaths, scoreStats});
test('matchAwards names the standout players across the round stats', () => {
  const hud = {actors:[
    awardActor(0, 'ChatGPT', 12, 4, {objectiveTime:3, captures:1, flagReturns:2}),
    awardActor(1, 'Grok', 5, 11, {}),
    awardActor(2, 'Claude', 9, 9, {objectiveTime:20}),
  ]};
  const awards = matchAwards(hud);
  const by = id => awards.find(a => a.id === id);
  assert.equal(by('mvp').name, 'ChatGPT');
  assert.equal(by('objective').name, 'Claude');
  assert.equal(by('objective').value, '20s');
  assert.equal(by('flag').name, 'ChatGPT');
  assert.equal(by('deaths').name, 'Grok');
  assert.equal(by('deaths').value, '11 DEATHS');
  assert.equal(by('ratio').name, 'ChatGPT');
  assert.equal(by('ratio').value, '3');
});

test('matchAwards stays silent for solo practice and malformed input', () => {
  assert.deepEqual(matchAwards({actors:[awardActor(0, 'ChatGPT', 9, 2)]}), []);
  assert.deepEqual(matchAwards({}), []);
  assert.deepEqual(matchAwards(null), []);
});

test('matchAwards derives medals for captures, accuracy, damage and flawless rounds', () => {
  const hud = {actors:[
    awardActor(0, 'ChatGPT', 8, 5, {captures:3, shots:40, hits:20, damage:1800}),
    awardActor(1, 'Claude', 6, 0, {shots:50, hits:45, damage:1250}),
    awardActor(2, 'Grok', 2, 9, {shots:10, hits:2, damage:300}),
  ]};
  const by = id => matchAwards(hud).find(a => a.id === id);
  assert.equal(by('captures').name, 'ChatGPT');
  assert.equal(by('captures').value, '3 CAP');
  assert.equal(by('accuracy').name, 'Claude');
  assert.equal(by('accuracy').value, '90%');
  assert.equal(by('damage').name, 'ChatGPT');
  assert.equal(by('damage').value, '1800');
  assert.equal(by('flawless').name, 'Claude');
  assert.equal(by('flawless').value, '0 DEATHS');
  assert.equal(by('flawless').label, 'UNTOUCHABLE · NO DEATHS');
  // A quieter lobby omits medals that have no valid owner.
  const bare = matchAwards({actors:[awardActor(0, 'A', 4, 1), awardActor(1, 'B', 3, 2)]});
  assert.equal(bare.some(a => a.id === 'accuracy'), false);
  assert.equal(bare.some(a => a.id === 'flawless'), false);
});

test('weapon range labels expose band, effective range and falloff', () => {
  assert.equal(weaponRangeLabel({range: 24, falloff: {start: 6, end: 24, min: .4}}), 'SHORT · 6–24m · 40%');
  assert.equal(weaponRangeLabel({range: 90}), 'LONG · 90m');
  assert.equal(weaponRangeLabel({range: 52, falloff: {start: 14, end: 52, min: .5}}), 'MID · 14–52m · 50%');
  assert.equal(weaponRangeLabel({range: 70, falloff: {start: 16, end: 70, min: .62}}), 'LONG · 16–70m · 62%');
  assert.deepEqual(weaponRangeInfo({}), {band: 'SHORT', start: 0, end: 0, range: 0, factor: 1});
});

test('kill feed weapon labels map a kill weapon index or fall back to none', () => {
  assert.equal(killFeedWeapon({weapon: 2}, WEAPONS), 'RAIL');
  assert.equal(killFeedWeapon({weapon: 0}, WEAPONS), 'PULSE');
  assert.equal(killFeedWeapon({weapon: null}, WEAPONS), null);
  assert.equal(killFeedWeapon({}, WEAPONS), null);
  assert.equal(killFeedWeapon(null, WEAPONS), null);
  assert.equal(killFeedWeapon({weapon: 99}, WEAPONS), null);
});

test('connection quality grades jitter and loss and reports interpolation delay', () => {
  assert.deepEqual(connectionQuality({ jitter: 5, lossRate: 0, renderDelay: .1 }), { label: 'GOOD', tone: 'good', ms: 100, jitter: 5, loss: 0 });
  assert.equal(connectionQuality({ jitter: 40, lossRate: 0, renderDelay: .12 }).label, 'FAIR');
  assert.equal(connectionQuality({ jitter: 5, lossRate: .2, renderDelay: .15 }).label, 'POOR');
  assert.equal(connectionQuality(null).label, 'GOOD');
  assert.equal(connectionQuality(null).ms, 0);
});

test('spectator helpers follow a live target and cycle through live actors', () => {
  const actors = [{id: 0, health: 0}, {id: 1, health: 80}, {id: 2, health: 60}, {id: 3, health: 0}];
  assert.equal(spectateActor(actors, 2).id, 2);
  assert.equal(spectateActor(actors, 0).id, 1, 'a dead target falls back to the first live actor');
  assert.equal(spectateActor([], 5), null);
  assert.equal(nextSpectateTarget(actors, 1, 1), 2);
  assert.equal(nextSpectateTarget(actors, 2, 1), 1, 'cycles past dead actors');
  assert.equal(nextSpectateTarget(actors, 1, -1), 2, 'reverse wraps');
  assert.equal(nextSpectateTarget([{id: 0, health: 0}], null, 1), null);
});

test('spectator cycling starts at the first live actor when the current target is gone',()=>{
  const actors=[{id:0,health:0},{id:1,health:80},{id:2,health:60}];
  assert.equal(nextSpectateTarget(actors,0,1),1,'forward from a dead target picks the first live actor');
  assert.equal(nextSpectateTarget(actors,9,1),1,'unknown target forward picks the first live actor');
  assert.equal(nextSpectateTarget(actors,9,-1),2,'unknown target reverse picks the last live actor');
});

test('the sudden death banner shows until the match ends',()=>{
 assert.equal(suddenDeathBanner({suddenDeath:true,over:false})?.text,'SUDDEN DEATH');
 assert.equal(suddenDeathBanner({objectives:{suddenDeath:true},over:false})?.text,'SUDDEN DEATH','self-managed objective sudden death still banners');
 assert.equal(suddenDeathBanner({suddenDeath:true,over:true}),null);
 assert.equal(suddenDeathBanner({}),null);
});

test('grenade status reports readiness and remaining cooldown',()=>{
 assert.deepEqual(grenadeStatus({grenadeCooldown:0}),{ready:true,cooldown:0,label:'FRAG READY'});
 const cooling=grenadeStatus({grenadeCooldown:3.24});
 assert.equal(cooling.ready,false);
 assert.equal(cooling.label,'FRAG 3.3s');
 assert.equal(grenadeStatus(undefined).ready,true);
});

test('killstreak callouts describe the reward',()=>{
 assert.deepEqual(killstreakCallout({streak:5,reward:'overcharge'}),{kind:'streak',text:'5 KILLSTREAK',detail:'OVERCHARGE'});
 assert.equal(killstreakCallout({streak:0,reward:'overcharge'}),null);
 assert.equal(killstreakCallout({streak:5}),null);
 assert.equal(killstreakCallout(undefined),null);
});

test('audio captions describe events and ignore silent ones',()=>{
 assert.equal(audioCaption({type:'explosion'}).text,'Explosion');
 assert.equal(audioCaption({type:'pickup'}).text,'Pickup');
 assert.equal(audioCaption({type:'melee'}).text,'Melee');
 assert.equal(audioCaption({type:'spawn'}),null);
 assert.equal(audioCaption(null),null);
});

test('alt-fire captions name the same mode table the HUD chip reads',()=>{
 assert.equal(altFireLabel({mode:0}),'SALVO');
 assert.equal(altFireLabel({mode:'overload'}),'OVERLOAD');
 assert.equal(altFireLabel({mode:'SALVO'}),'SALVO','a pre-rendered label resolves by id');
 assert.equal(altFireLabel({modeLabel:'custom'}),'CUSTOM');
 assert.equal(altFireLabel({mode:999}),'');
 assert.equal(altFireLabel(null),'');
 assert.equal(audioCaption({type:'alt-fire',mode:0}).text,'Alt fire · SALVO');
 assert.equal(audioCaption({type:'alt-fire'}).text,'Alt fire','an unknown mode still names the beat');
 assert.equal(audioCaption({type:'shot',alt:true,weapon:2}).text,'Alt fire · OVERLOAD','an alt-flagged shot replaces the generic gunfire line');
 assert.equal(audioCaption({type:'shot',alt:true,altId:'chain',weapon:6}).text,'Alt fire · CHAIN','the sim altId resolves through the shared table');
 assert.equal(audioCaption({type:'shot',weapon:2}).text,'Gunfire','a normal shot keeps the existing caption');
 assert.equal(audioCaption({type:'launch',alt:true,altId:'mortar',weapon:4}).text,'Alt fire · MORTAR','an alt projectile launch names its mode');
 assert.equal(audioCaption({type:'launch',weapon:4}),null,'a normal rocket launch keeps its existing silent caption');
 assert.equal(audioCaption({type:'alt-state',weapon:0,alt:true}).text,'Alt mode · SALVO');
 assert.equal(audioCaption({type:'alt-state',weapon:0,alt:false}).text,'Alt mode off · SALVO');
 assert.equal(audioCaption({type:'alt-mode',mode:6}).text,'Alt mode · CHAIN');
 assert.equal(audioCaption({type:'alt-mode'}).text,'Alt mode');
 assert.equal(audioCaption({type:'alt-toggle',on:false}).text,'Alt fire off');
 assert.equal(audioCaption({type:'alt-toggle',on:true}).text,'Alt fire on');
});

test('ladder and streak status describe arms race and killstreaks',()=>{
 assert.deepEqual(ladderStatus({ladder:3},10),{rung:3,total:10,label:'LADDER 4/10'});
 assert.equal(ladderStatus({ladder:9},10).label,'LADDER FINAL');
 assert.equal(ladderStatus({ladder:99},10).label,'LADDER FINAL');
 assert.equal(ladderStatus({},10).label,'LADDER 1/10');
 assert.deepEqual(streakStatus({streak:4}),{streak:4,label:'4 STREAK'});
 assert.equal(streakStatus({streak:1}),null);
 assert.equal(streakStatus(undefined),null);
});

test('the spectator board lists live actors and marks the followed one',()=>{
 const actors=[{id:0,name:'A',health:100,team:0},{id:1,name:'B',health:0,team:1},{id:2,health:50,team:1}];
 assert.deepEqual(spectatorBoard(actors,2),[{id:0,name:'A',team:0,health:100,current:false},{id:2,name:'A2',team:1,health:50,current:true}]);
 assert.deepEqual(spectatorBoard(null,0),[]);
});

test('spectatorTeams groups live players by side, free agents last, crown points attached',()=>{
 const actors=[{id:0,name:'A',health:0,team:1},{id:1,name:'B',health:0,team:0},{id:2,name:'C',health:50,team:0,juggernaut:true},{id:3,health:60}];
 const groups=spectatorTeams(actors,2,{points:{2:7,3:2}});
 assert.deepEqual(groups.map(group=>group.team),[0,null],'dead actors drop out and free agents sort last');
 assert.equal(groups[0].key,'t0');
 assert.deepEqual(groups[0].players.map(player=>player.id),[2]);
 assert.equal(groups[0].players[0].current,true);
 assert.equal(groups[0].players[0].juggernaut,true);
 assert.equal(groups[0].players[0].points,7);
 assert.equal(groups[1].players[0].id,3);
 assert.equal(groups[1].players[0].name,'A3');
 assert.equal(groups[1].players[0].team,null);
 assert.equal(groups[1].players[0].points,2);
 const mixed=spectatorTeams([{id:0,health:5,team:1},{id:1,health:5,team:0},{id:2,health:5}],1);
 assert.deepEqual(mixed.map(group=>group.team),[0,1,null],'sides read left to right with free agents last');
 assert.deepEqual(spectatorTeams(null,0),[]);
 assert.deepEqual(spectatorTeams([{id:0,health:1,team:'x'}],0)[0].team,null,'non-numeric teams read as free agents');
});

const modeById = id => GAME_MODES.find(m => m.id === id);

test('modeGoal names the scoring objective for every mode', () => {
  assert.equal(modeGoal(modeById('deathmatch')), 'FRAGS');
  assert.equal(modeGoal(modeById('ctf')), 'CAPTURES');
  assert.equal(modeGoal(modeById('koth')), 'HILL CONTROL');
  assert.equal(modeGoal(modeById('domination')), 'ZONE CONTROL');
  assert.equal(modeGoal(modeById('assault')), 'SECTORS');
  assert.equal(modeGoal(modeById('teamdeathmatch')), 'TEAM FRAGS');
  assert.equal(modeGoal(modeById('payload')), 'CHECKPOINTS');
  assert.equal(modeGoal(modeById('puma-race')), 'LAPS');
  assert.equal(modeGoal(modeById('combined-arms')), 'ZONE CONTROL');
  assert.equal(modeGoal(modeById('armsrace')), 'LADDER');
  assert.equal(modeGoal(modeById('instagib')), 'FRAGS');
  assert.equal(modeGoal(modeById('rockets')), 'FRAGS');
  assert.equal(modeGoal(modeById('arsenal')), 'FRAGS');
  assert.equal(modeGoal(modeById('holdout')), 'QUORUM HOLD');
  assert.equal(modeGoal(modeById('uplink')), 'RELAY STAGES');
  assert.equal(modeGoal(modeById('vip-escort')), 'EXTRACTION');
  assert.equal(modeGoal(modeById('juggernaut')), 'CROWN POINTS');
  assert.equal(modeGoal(modeById('team-elimination')), 'TEAM LIVES');
});

test('isTeamMode distinguishes shared-score modes from free-for-alls', () => {
  assert.equal(isTeamMode(modeById('ctf')), true);
  assert.equal(isTeamMode(modeById('domination')), true);
  assert.equal(isTeamMode(modeById('combined-arms')), true);
  assert.equal(isTeamMode(modeById('deathmatch')), false);
  assert.equal(isTeamMode(modeById('armsrace')), false);
  assert.equal(isTeamMode(modeById('instagib')), false);
});

test('isTeamMode mirrors the canonical teamMode for every mode id and mode object', () => {
  for (const mode of GAME_MODES) {
    const expected = teamMode(mode.id);
    assert.equal(isTeamMode(mode.id), expected, `${mode.id} id`);
    assert.equal(isTeamMode(mode), expected, `${mode.id} object`);
  }
});

test('commandBrief routes combined-arms through zone control with a status', () => {
  const hud = {config: {mode: 'combined-arms', fragLimit: 200}, objectives: {kind: 'domination', zones: [
    {id: 'alpha', owner: 0, contested: false},
    {id: 'bravo', owner: 1, contested: true},
    {id: 'charlie', owner: null, contested: false},
  ]}, teamScores: {0: 40, 1: 25}};
  const brief = commandBrief(hud, {team: 0}, modeById('combined-arms'));
  assert.ok(brief.detail.includes('ZONES'), brief.detail);
  assert.ok(brief.detail.includes('40'), brief.detail);
  assert.ok(brief.status && /OWNED/.test(brief.status), brief.status);
});

test('commandBrief gives arms race a ladder brief with current and next weapon', () => {
  const brief = commandBrief({config: {mode: 'armsrace', fragLimit: 10}}, {team: 0, ladder: 3, weapon: 3}, modeById('armsrace'));
  assert.equal(brief.title, 'CLIMB THE LADDER');
  assert.ok(brief.detail.includes('LADDER 4/10'), brief.detail);
  assert.ok(brief.detail.includes(WEAPONS[3].name), brief.detail);
  assert.ok(brief.status.includes('NEXT WEAPON'), brief.status);
  assert.ok(brief.status.includes(WEAPONS[4].name), brief.status);
});

test('commandBrief appends the frag target to instagib, rockets and arsenal', () => {
  for (const id of ['instagib', 'rockets', 'arsenal']) {
    const brief = commandBrief({config: {mode: id, fragLimit: 20}}, {team: 0}, modeById(id));
    assert.ok(brief.detail.includes('FIRST TO 20 FRAGS'), `${id}: ${brief.detail}`);
  }
});

test('matchStartBanner adds the objective target alongside mode and map', () => {
  const banner = matchStartBanner({time: .5, modeName: 'Instagib', mapName: 'Exchange', config: {mode: 'instagib', fragLimit: 20}}, 2.6, modeById('instagib'));
  assert.equal(banner.text, 'FIGHT');
  assert.equal(banner.detail, 'INSTAGIB · EXCHANGE · FIRST TO 20 FRAGS');
  assert.equal(matchStartBanner({time: .5, modeName: 'Arms Race', mapName: 'Yard', config: {mode: 'armsrace', fragLimit: 10}}, 2.6, modeById('armsrace')).detail, 'ARMS RACE · YARD · CLIMB THE LADDER');
  assert.equal(matchStartBanner({time: .5, modeName: 'Capture the Flag', mapName: 'Exchange'}).detail, 'CAPTURE THE FLAG · EXCHANGE');
});

test('modeColumns covers the new objective and ladder scoreboards', () => {
  assert.deepEqual(modeColumns('assault'), [['objectiveCaptures', 'SECTORS'], ['objectiveTime', 'SECTOR TIME']]);
  assert.deepEqual(modeColumns('combined-arms'), [['objectiveTime', 'ZONE TIME'], ['objectiveCaptures', 'CAP'], ['objectiveNeutralizations', 'NEUT'], ['objectiveContests', 'CONTEST']]);
  assert.deepEqual(modeColumns('armsrace'), [['ladder', 'RUNG'], ['weapon', 'WEAPON']]);
  assert.deepEqual(modeColumns('deathmatch'), []);
  assert.deepEqual(modeColumns('puma-race'), []);
  assert.equal(modeColumns('ctf').length, 4);
  assert.equal(modeColumns('koth').length, 3);
  assert.equal(modeColumns('domination').length, 4);
  assert.equal(modeColumns('payload').length, 2);
});

test('modePrimary sorts each mode by the objective it scores', () => {
  const actor = {frags: 2, ladder: 4, weapon: 2, scoreStats: {objectiveCaptures: 3, objectiveTime: 12.5, captures: 1, flagPickups: 1, flagReturns: 1}};
  assert.deepEqual(modePrimary('assault', actor), [3, 12.5]);
  assert.deepEqual(modePrimary('combined-arms', actor), [12.5, 3]);
  assert.deepEqual(modePrimary('armsrace', actor), [4, 2]);
  assert.deepEqual(modePrimary('deathmatch', actor), [0]);
});

test('objectiveCopy explains every scoring model the setup screen offers', () => {
  for (const score of ['laps', 'frags', 'teamFrags', 'captures', 'hillTime', 'zoneTime', 'sectors', 'ladder', 'payload', 'goals']) {
    assert.ok(typeof objectiveCopy(score) === 'string' && objectiveCopy(score).length > 0, score);
  }
  assert.equal(objectiveCopy('unknown'), null);
});

test('puma soccer routes through the goals objective across the HUD helpers', () => {
  const mode = modeById('puma-soccer');
  assert.equal(modeGoal(mode), 'GOALS');
  assert.deepEqual(modeColumns('puma-soccer'), [['goals', 'GOALS']]);
  assert.deepEqual(modePrimary('puma-soccer', {goals: 4}), [4]);
});

test('soccer display and result read the race snapshot and local side', () => {
  const race = {kind: 'soccer', phase: 'playing', countdown: 0, elapsed: 65, timeLimit: 180, goalLimit: 5, scores: {0: 2, 1: 1}, winnerTeam: null, ball: {x: 0, y: 1, z: 0, r: 1.1}, standings: [{actorId: 0, team: 0, goals: 2, vehicleId: 0}, {actorId: 3, team: 1, goals: 1, vehicleId: 3}]};
  const display = soccerDisplay({race}, 0);
  assert.equal(display.phase, 'playing');
  assert.equal(display.time, '01:05.00');
  assert.deepEqual(display.scores, {0: 2, 1: 1});
  assert.equal(display.team, 0);
  assert.equal(display.winner, null);
  assert.equal(display.goalLimit, 5);
  assert.equal(display.ballInPlay, true);
  assert.equal(soccerResult({race}, 0), 'DRAW 2\u20131.');
  assert.equal(soccerResult({race: {...race, winnerTeam: 1}}, 0), 'BLUE WINS 1\u20132.');
  assert.equal(soccerResult({race: {...race, winnerTeam: 0}}, 0), 'YOU WIN 2\u20131.');
});

test('soccer command brief and goal announcer read the soccer snapshot', () => {
  const hud = {config: {mode: 'puma-soccer', fragLimit: 5}, race: {kind: 'soccer', phase: 'playing', elapsed: 65, goalLimit: 5, scores: {0: 2, 1: 1}, winnerTeam: null, ball: {x: 0, y: 1, z: 0, r: 1.1}, standings: [{actorId: 0, team: 0, goals: 2, vehicleId: 0}, {actorId: 3, team: 1, goals: 1, vehicleId: 3}]}};
  const brief = commandBrief(hud, {id: 0, team: 0}, modeById('puma-soccer'));
  assert.equal(brief.title, 'GO FOR GOAL');
  assert.ok(brief.detail.includes('RED 2'), brief.detail);
  assert.ok(brief.status.includes('BALL LIVE'), brief.status);
  assert.equal(audioCaption({type: 'soccer-goal'}).text, 'Goal');
  assert.deepEqual(scoreAnnouncer({teamScores: {0: 2, 1: 1}, config: {mode: 'puma-soccer'}}, {0: 1, 1: 1}), {team: 0, kind: 'goal', text: 'RED GOAL', score: 2, amount: 1});
});

test('modeGoal and modeTargetText name the juggernaut crown and team-elimination lives', () => {
  const juggernaut = modeById('juggernaut'), elimination = modeById('team-elimination');
  assert.equal(modeGoal(juggernaut), 'CROWN POINTS');
  assert.equal(modeGoal(elimination), 'TEAM LIVES');
  assert.equal(modeTargetText(juggernaut, 30), 'HOLD THE CROWN · MOST POINTS');
  assert.equal(modeTargetText(elimination, 20), 'TEAM LIVES · 20 EACH');
  assert.equal(modeTargetText(elimination), 'TEAM LIVES REMAINING');
  assert.equal(matchStartBanner({time: .5, modeName: 'Juggernaut', mapName: 'Crosswire', config: {mode: 'juggernaut', fragLimit: 30}}, 2.6, juggernaut).detail, 'JUGGERNAUT · CROSSWIRE · HOLD THE CROWN · MOST POINTS');
});

test('mode columns and primary sort cover juggernaut points and elimination tickets', () => {
  assert.deepEqual(modeColumns('juggernaut'), [['points', 'POINTS']]);
  assert.deepEqual(modeColumns('team-elimination'), [['eliminations', 'ELIMS']]);
  assert.deepEqual(modePrimary('juggernaut', {points: 12, juggernaut: true}), [12, 1]);
  assert.deepEqual(modePrimary('juggernaut', {points: 4}), [4, 0]);
  assert.deepEqual(modePrimary('team-elimination', {eliminations: 3, frags: 9}), [3, 9]);
});

test('objectiveCopy explains the juggernaut and elimination scoring models', () => {
  assert.ok(objectiveCopy('juggernaut').length > 0);
  assert.ok(objectiveCopy('elimination').length > 0);
  assert.notEqual(objectiveCopy('juggernaut'), objectiveCopy('elimination'));
});

test('single-player economy, checkpoint and boss events have readable captions', () => {
  assert.equal(audioCaption({type: 'horde-resupply'}).text, 'Resupplied');
  assert.equal(audioCaption({type: 'horde-upgrade'}).text, 'Upgrade available');
  assert.equal(audioCaption({type: 'horde-upgrade-selected'}).text, 'Upgrade acquired');
  assert.equal(audioCaption({type: 'enemy-detonate'}).text, 'Sapper detonation');
  assert.equal(audioCaption({type: 'singleplayer-checkpoint'}).text, 'Checkpoint saved');
  assert.equal(audioCaption({type: 'boss-phase'}).text, 'Boss phase');
  assert.equal(audioCaption({type: 'vehicle-enter'}).text, 'Mounted vehicle');
  assert.equal(audioCaption({type: 'vehicle-exit'}).text, 'Dismounted vehicle');
  assert.equal(audioCaption({type: 'vehicle-splatter'}).text, 'Vehicle splatter');
  assert.equal(audioCaption({type: 'assault-sector-captured'}).text, 'Sector captured');
  assert.equal(audioCaption({type: 'assault-sector-lost'}).text, 'Sector lost');
  assert.equal(audioCaption({type: 'unknown-event'}), null);
  assert.equal(audioCaption(null), null);
});

test('race events have readable captions', () => {
  assert.equal(audioCaption({type: 'race-coin'}).text, 'Coin collected');
  assert.equal(audioCaption({type: 'race-box'}).text, 'Item box');
  assert.equal(audioCaption({type: 'race-boost'}).text, 'Speed boost');
  assert.equal(audioCaption({type: 'race-item'}).text, 'Item deployed');
  assert.equal(audioCaption({type: 'race-hazard-hit'}).text, 'Hazard hit');
  assert.equal(audioCaption({type: 'race-lap'}).text, 'Lap complete');
  assert.equal(audioCaption({type: 'race-finish'}).text, 'Race finish');
});

test('scoreStats forwards juggernaut points and elimination tickets', () => {
  const stats = scoreStats({scoreStats: {points: 7, eliminations: 3, captures: 1}});
  assert.equal(stats.points, 7);
  assert.equal(stats.eliminations, 3);
  assert.equal(stats.captures, 1);
  assert.equal(scoreStats(undefined).points, 0);
  assert.equal(scoreStats({scoreStats: {points: 'x'}}).points, 0);
  assert.deepEqual(modeColumns('juggernaut'), [['points', 'POINTS']]);
  assert.deepEqual(modeColumns('team-elimination'), [['eliminations', 'ELIMS']]);
});

test('objective-variant modes get a real briefing instead of generic frag copy', () => {
 const me={...player,team:0};
 const holdout=commandBrief({config:{mode:'holdout'},objectives:{kind:'domination',holdCount:2,holdSeconds:30,holdProgress:{0:12,1:4},holdTeam:0}},me,modeById('holdout'));
 assert.equal(holdout.title,'HOLD THE QUORUM');
 assert.match(holdout.detail,/HELD/);
 const uplink=commandBrief({config:{mode:'uplink'},objectives:{kind:'koth',stage:1,stageCount:3,stageCaptures:{0:1,1:0}}},me,modeById('uplink'));
 assert.equal(uplink.title,'RUN THE RELAY');
 assert.match(uplink.detail,/RELAY 2 \/ 3/);
 const vip=commandBrief({config:{mode:'vip-escort'},objectives:{kind:'extraction',vipDead:false}},me,modeById('vip-escort'));
 assert.equal(vip.title,'ESCORT THE VIP');
});

test('objective-variant modes keep their scoreboard columns, ranking and start target', () => {
  assert.deepEqual(modeColumns('holdout'), [['objectiveTime', 'ZONE TIME'], ['objectiveCaptures', 'CAP'], ['objectiveContests', 'CONTEST']]);
  assert.deepEqual(modeColumns('uplink'), [['objectiveCaptures', 'RELAY'], ['objectiveContests', 'CONTEST']]);
  assert.deepEqual(modeColumns('vip-escort'), [['objectiveTime', 'ESCORT TIME'], ['objectiveCaptures', 'EXTRACT']]);
  assert.deepEqual(modePrimary('uplink', {scoreStats: {objectiveCaptures: 2, objectiveContests: 5}}), [2, 5]);
  assert.deepEqual(modePrimary('holdout', {scoreStats: {objectiveTime: 12, objectiveCaptures: 1}}), [12, 1]);
  assert.deepEqual(modePrimary('vip-escort', {scoreStats: {objectiveTime: 9, objectiveCaptures: 3}}), [9, 3]);
  assert.equal(modeTargetText(modeById('holdout')), 'HOLD A QUORUM');
  assert.equal(modeTargetText(modeById('uplink')), 'RUN THE RELAY');
  assert.equal(modeTargetText(modeById('vip-escort')), 'ESCORT THE VIP');
});

test('a gunner or passenger also receives their PUMA card and exit prompt', () => {
  assert.equal(vehicleHud({...player, vehicleId:0}, [{...ride, driver:1, gunner:0}]).prompt, 'E / EXIT PUMA');
  assert.equal(vehicleHud({...player, vehicleId:0}, [{...ride, driver:1, passengers:[0]}]).prompt, 'E / EXIT PUMA');
  assert.equal(vehicleHud({...player, vehicleId:0}, [{...ride, driver:1, passengers:[2]}]).vehicle, null);
});

// ---------------------------------------------------------------------------
// F03 public outcome progress: the primary status reads authoritative
// snapshot numbers, never a client clock, and tolerates absence.
// ---------------------------------------------------------------------------
const dominanceHud = over => ({
  config: {mode: 'cocs'},
  cocs: {
    nodes: [
      {id: 'hq-0', x: -108, z: 0, archetype: 'hq', owner: 0, progress: [0, 0], contested: false, live: false},
      {id: 'front-0', x: -54, z: 0, archetype: 'front', owner: 0, progress: [0, 0], contested: false, live: true},
      {id: 'relay-0', x: 0, z: 0, archetype: 'relay', owner: 1, progress: [0.2, 0.4], contested: false, live: true},
      {id: 'front-1', x: 54, z: 0, archetype: 'front', owner: 1, progress: [0, 0], contested: false, live: true},
    ],
    scores: {0: 25, 1: 40},
    liveNodeIds: ['front-0', 'relay-0', 'front-1'],
    winner: null,
    dominance: {
      team: 1, progress: 30, target: 45, remaining: 15, fast: true,
      count: 3, fastCount: 4, counts: {0: 1, 1: 4}, breakCount: 2, hold: 90, fastHold: 45,
    },
    ...over,
  },
});

test('cocsDominanceStatus formats the authoritative race and never counts down by itself', () => {
  const view = cocsDominanceStatus(dominanceHud(), {team: 0});
  assert.equal(view.team, 1);
  assert.equal(view.mine, false);
  assert.equal(view.holding, true);
  assert.equal(view.remaining, 15);
  assert.equal(view.timeText, '15s');
  assert.equal(view.fast, true);
  assert.equal(view.count, 3);
  assert.equal(view.counts[1], 4);
  assert.equal(view.breakCount, 2);
  assert.equal(cocsDominanceStatus(dominanceHud(), {team: 1}).mine, true);
  // A sub-five-second hold keeps a decimal and never promises zero early.
  const close = cocsDominanceStatus({cocs: {dominance: {team: 0, progress: 87.5, target: 90, remaining: 2.5, counts: {0: 3, 1: 0}, count: 3}}}, {team: 0});
  assert.equal(close.timeText, '2.5s');
  // Absent fields read neutral and never throw.
  const empty = cocsDominanceStatus({}, {team: 0});
  assert.equal(empty.holding, false);
  assert.equal(empty.team, null);
  assert.equal(empty.timeText, null);
  assert.deepEqual(empty.counts, {0: 0, 1: 0});
  assert.equal(cocsDominanceStatus(null, null).count, 0);
});

test('cocsOperationsStatus leads with waves and HQ integrity and tolerates absence', () => {
  const ops = cocsOperationsStatus({cocs: {outcome: {mode: 'operations', waves: {cleared: 2, total: 5}, hq: {id: 'hq-0', health: 840, max: 1400, percent: .6, armed: true}}}});
  assert.deepEqual(ops.waves, {cleared: 2, total: 5});
  assert.equal(ops.waveText, '2 / 5');
  assert.equal(ops.hqText, 'HQ 60%');
  assert.equal(ops.siege, true);
  // The pre-F03 surfaces (`waves` + `director.siege`) read the same way.
  const legacy = cocsOperationsStatus({cocs: {waves: {cleared: 1, par: 5}, director: {siege: {hqId: 'hq-0', health: 700, max: 1400, percent: .5, armed: false}}}});
  assert.equal(legacy.waveText, '1 / 5');
  assert.equal(legacy.hqText, 'HQ 50%');
  assert.equal(legacy.siege, false);
  const empty = cocsOperationsStatus({});
  assert.equal(empty.waveText, 'UNKNOWN');
  assert.equal(empty.hqText, 'HQ STATUS UNKNOWN');
  assert.equal(empty.siege, false);
});

test('cocsOutcomeView gives PvP and Operations distinct primary status copy', () => {
  const pvp = cocsOutcomeView(dominanceHud(), {team: 0}, modeById('cocs'));
  assert.equal(pvp.mode, 'pvp');
  assert.equal(pvp.title, 'BREAK THE DOMINANCE');
  assert.match(pvp.status, /BLUE DOMINANCE 4 NODES/);
  assert.match(pvp.status, /15s LEFT/);
  assert.match(pvp.status, /FAST/);
  assert.match(pvp.status, /TAKE 2 NODES TO RESET/);
  assert.match(pvp.action, /take 2 nodes/);
  assert.match(pvp.detail, /RED 25 OP/);
  const own = cocsOutcomeView(dominanceHud({dominance: {team: 0, progress: 10, target: 90, remaining: 80, fast: false, count: 3, fastCount: 4, counts: {0: 3, 1: 1}, breakCount: 1, hold: 90, fastHold: 45}}), {team: 0}, modeById('cocs'));
  assert.equal(own.title, 'HOLD THE LATTICE');
  assert.match(own.status, /KEEP 3 NODES/);
  assert.doesNotMatch(own.status, /TO RESET/);

  const opsHud = {config: {mode: 'cocs-coop'}, cocs: {coop: true, nodes: [], scores: {0: 35, 1: 0}, waves: {cleared: 2, par: 5}, director: {siege: {armed: true, hqId: 'hq-0', health: 840, max: 1400, percent: .6}}}};
  const ops = cocsOutcomeView(opsHud, {team: 0}, modeById('cocs-coop'));
  assert.equal(ops.mode, 'operations');
  assert.equal(ops.title, 'DEFEND THE HQ');
  assert.ok(ops.status.startsWith('HQ UNDER SIEGE'), ops.status);
  assert.match(ops.detail, /WAVES 2 \/ 5/);
  assert.match(ops.detail, /OP SCORE/);
  const calm = cocsOutcomeView({config: {mode: 'cocs-coop'}, cocs: {coop: true, nodes: [], scores: {0: 0, 1: 0}, waves: {cleared: 0, par: 5}, director: {siege: {armed: false, hqId: 'hq-0', health: 1400, max: 1400, percent: 1}}}}, {team: 0}, modeById('cocs-coop'));
  assert.equal(calm.title, 'CLEAR THE WAVES');
  assert.ok(calm.status.startsWith('HQ 100%'), calm.status);
  assert.match(calm.action, /win condition/);
});

test('commandBrief and modeTargetText label the Operations win condition, not the OP score', () => {
  const target = modeTargetText(modeById('cocs-coop'));
  assert.match(target, /WAVE/);
  assert.notEqual(target, 'HOLD THE LATTICE');
  assert.equal(modeTargetText(modeById('cocs')), 'HOLD THE LATTICE');
  const brief = commandBrief({config: {mode: 'cocs-coop'}, cocs: {coop: true, nodes: [], scores: {0: 12, 1: 0}, waves: {cleared: 1, par: 5}, director: {siege: {armed: false, hqId: 'hq-0', health: 1400, max: 1400, percent: 1}}}}, {team: 0}, modeById('cocs-coop'));
  assert.equal(brief.title, 'CLEAR THE WAVES');
  assert.match(brief.detail, /WAVES 1 \/ 5/);
  assert.match(brief.detail, /HQ 100%/);
  // PvP without a published race keeps the pre-F03 lattice copy.
  const plain = commandBrief({config: {mode: 'cocs'}, cocs: {nodes: [{id: 'front-0', x: 0, z: 0, archetype: 'front', owner: 0, progress: [0, 0], contested: false, live: true}], scores: {0: 5, 1: 0}, liveNodeIds: ['front-0']}}, {team: 0}, modeById('cocs'));
  assert.equal(plain.title, 'HOLD THE LATTICE');
  assert.match(plain.detail, /5 OP/);
});

test('the announcement priority policy is bounded, deduped and expiry-aware', () => {
  const ranks = Object.values(COCS_ANNOUNCE_PRIORITY);
  assert.ok(ranks.every(rank => Number.isFinite(rank) && rank >= 0));
  assert.equal(new Set(ranks).size, ranks.length, 'every bounded rank is distinct');
  assert.ok(COCS_ANNOUNCE_PRIORITY.siegeLifted > COCS_ANNOUNCE_PRIORITY.siege);
  assert.ok(COCS_ANNOUNCE_PRIORITY.siege > COCS_ANNOUNCE_PRIORITY.loss);
  assert.ok(COCS_ANNOUNCE_PRIORITY.loss > COCS_ANNOUNCE_PRIORITY.secure);
  assert.ok(COCS_ANNOUNCE_PRIORITY.wave > COCS_ANNOUNCE_PRIORITY.order);
  assert.ok(cocsAnnouncementTTL({ttl: 5}) > cocsAnnouncementTTL({}), 'an explicit TTL wins; unknown beats default short');
});

// ---------------------------------------------------------------------------
// QoL strip: team status and economy readouts are pure snapshot reads. They
// render in one non-live group in the match page; these tests pin the model.
// ---------------------------------------------------------------------------
test('team status models elimination lives, attrition and ally chips', () => {
 const hud = {
  teamScores: {0: 4, 1: 7},
  actors: [
   {id: 0, name: 'CHATGPT', team: 0, health: 100, armor: 50},
   {id: 1, name: 'BOT 1', team: 0, health: 0, armor: 0},
   {id: 2, name: 'BOT 2', team: 0, health: 60, armor: 20},
   {id: 3, name: 'GROK', team: 1, health: 80, armor: 0},
  ],
  objectives: {kind: 'elimination', lives: {0: 4, 1: 7}, livesPerTeam: 10, eliminations: {0: 6, 1: 3}, attrition: {0: 0, 1: 1}, suddenDeath: true},
 };
 const view = teamStatusHud({id: 0, team: 0}, hud);
 assert.equal(view.team, 0);
 assert.deepEqual(view.lives.teams.map(t => [t.name, t.lives, t.max, t.eliminations, t.attrition, t.mine, t.out]),
  [['RED', 4, 10, 6, 0, true, false], ['BLUE', 7, 10, 3, 1, false, false]]);
 assert.equal(view.lives.suddenDeath, true);
 assert.equal(view.lives.text, 'RED 4 · BLUE 7');
 assert.deepEqual(view.allies.map(a => [a.name, a.health, a.armor, a.down]), [['BOT 1', 0, 0, true], ['BOT 2', 60, 20, false]]);
 assert.match(view.label, /Team lives: RED 4 of 10, BLUE 7 of 10\. Sudden death\./);
 assert.match(view.label, /Allies: BOT 1 down, BOT 2 60 health 20 armor\./);
 // An out-of-lives team reads as such without inventing a score.
 assert.equal(teamStatusHud({id: 0, team: 1}, {...hud, objectives: {...hud.objectives, lives: {0: 0, 1: 2}}}).lives.teams[0].out, true);
 // Nothing to say: solo actor, no objective readout.
 assert.equal(teamStatusHud({id: 0, team: 0}, {actors: [{id: 0, team: 0, health: 100}], objectives: null}), null);
 assert.equal(teamStatusHud({id: 0}, {actors: [{id: 0, health: 100}, {id: 1, health: 100}], objectives: null}), null, 'a free-for-all has no team strip');
 assert.equal(teamStatusHud({id: 0, team: 0}, {...hud, spectate: true}), null, 'spectating keeps the spectator board');
 assert.equal(teamStatusHud(null, null), null);
});

test('team status reads control-zone capture, contest and hold windows', () => {
 const zones = [
  {id: 'alpha', owner: 0, contested: false, progress: 100, captureTeam: null},
  {id: 'bravo', owner: null, contested: true, progress: 40, captureTeam: 0},
  {id: 'charlie', owner: 1, contested: false, progress: 65, captureTeam: 1},
 ];
 const hud = {teamScores: {0: 30, 1: 20}, actors: [{id: 0, team: 0, health: 100}, {id: 1, team: 0, health: 90}, {id: 2, team: 1, health: 70}], objectives: {kind: 'domination', zones}};
 const view = teamStatusHud({id: 0, team: 0}, hud);
 assert.equal(view.zones.owned, 1);
 assert.equal(view.zones.enemyOwned, 1);
 assert.equal(view.zones.contested, 1);
 assert.equal(view.zones.text, '1/3 ZONES · 1 CONTESTED');
 assert.equal(view.zones.focus.id, 'bravo');
 assert.equal(view.zones.focusText, 'BRAVO CONTESTED');
 assert.equal(view.allies.length, 1);
 const taking = teamStatusHud({id: 0, team: 0}, {...hud, objectives: {kind: 'domination', zones: [{id: 'alpha', owner: null, contested: false, progress: 45, captureTeam: 0}]}});
 assert.equal(taking.zones.focusText, 'TAKING ALPHA 45%');
 const hold = teamStatusHud({id: 0, team: 0}, {...hud, objectives: {kind: 'domination', holdCount: 2, holdSeconds: 30, holdProgress: {0: 12.4, 1: 9}, holdTeam: 0, zones}});
 assert.equal(hold.hold.quorum, 2);
 assert.equal(hold.hold.seconds, 30);
 assert.equal(hold.hold.progress[0], 12);
 assert.equal(hold.hold.mine, true);
 assert.equal(hold.hold.text, 'HOLD 12s / 30s');
});

test('team status reads the uplink relay race, assault sectors and payload distance', () => {
 const relay = teamStatusHud({id: 0, team: 0}, {actors: [{id: 0, team: 0, health: 100}], objectives: {kind: 'koth', stage: 1, stageCount: 3, stageCaptures: {0: 1, 1: 0}, zones: [{id: 'uplink-2', owner: 0, contested: false, progress: 100}]}});
 assert.equal(relay.stages.text, 'RELAY 2/3 · YOU 1');
 assert.equal(relay.stages.mine, 1);
 assert.equal(relay.zones, null, 'the stage race replaces the generic hill readout');
 const assault = teamStatusHud({id: 0, team: 0}, {actors: [{id: 0, team: 0, health: 100}], objectives: {kind: 'assault', attacker: 0, defender: 1, breached: false, active: 1, zones: [{id: 'alpha', owner: 0, progress: 100, contested: false}, {id: 'bravo', owner: null, progress: 45.6, contested: true, captureTeam: 0}, {id: 'charlie', owner: null, progress: 0, contested: false}]}});
 assert.equal(assault.assault.index, 1);
 assert.equal(assault.assault.progress, 46);
 assert.equal(assault.assault.text, 'SECTOR 2/3 · 46% · ATTACK');
 const payload = teamStatusHud({id: 0, team: 1}, {actors: [{id: 0, team: 1, health: 100}], objectives: {kind: 'payload', payload: {progress: 42.6, distance: 84.25, total: 200, contested: true, pushing: 0, delivered: false, checkpointsReached: 1, checkpointCount: 3}}});
 assert.equal(payload.payload.percent, 43);
 assert.equal(payload.payload.distance, 84.25);
 assert.equal(payload.payload.contested, true);
 assert.equal(payload.payload.mine, false, 'the enemy push does not read as yours');
 assert.equal(payload.payload.text, 'PAYLOAD 43% · 84/200m · CONTESTED');
 assert.match(payload.label, /PAYLOAD 43%, 84\/200m, CONTESTED\./);
});

test('team status badges the VIP with live health or a down state', () => {
 const base = {teamScores: {0: 0, 1: 0}, actors: [{id: 0, team: 0, health: 100}, {id: 7, name: 'VIP', team: 0, isVip: true, health: 72, maxHealth: 100}], objectives: {kind: 'extraction', vipId: 7, escortTeam: 0, defenderTeam: 1, vipDead: false, progress: 2, captureSeconds: 4}};
 const view = teamStatusHud({id: 0, team: 0}, base);
 assert.equal(view.vip.name, 'VIP');
 assert.equal(view.vip.health, 72);
 assert.equal(view.vip.mine, true);
 assert.equal(view.vip.text, 'VIP 72 HP');
 assert.match(view.label, /VIP 72 health\./);
 const down = teamStatusHud({id: 0, team: 0}, {...base, actors: [base.actors[0], {...base.actors[1], health: 0}], objectives: {...base.objectives, vipDead: true}});
 assert.equal(down.vip.dead, true);
 assert.equal(down.vip.text, 'VIP DOWN');
 assert.match(down.label, /VIP down\./);
});

test('economy HUD surfaces the upgrade countdown and sentry status', () => {
 const view = economyHud({id: 0, team: 0, upgradeTimer: 6.4, upgradeWeapon: 2}, {deployables: [
  {id: 9, owner: 0, team: 0, health: 80, life: 11.2, cooldown: 0},
  {id: 4, owner: 1, team: 1, health: 80, life: 8, cooldown: 0},
 ]}, WEAPONS);
 assert.equal(view.upgrade.index, 2);
 assert.equal(view.upgrade.weapon, 'RAIL');
 assert.equal(view.upgrade.text, 'UPGRADE RAIL · 7s');
 assert.equal(view.mine.length, 1);
 assert.equal(view.mine[0].alive, true);
 assert.equal(view.mine[0].text, 'SENTRY 80 HP · 12s');
 assert.equal(view.enemy.length, 1);
 assert.match(view.label, /Weapon upgrade RAIL 7 seconds\./);
 assert.match(view.label, /Your sentry at 80 health, 12 seconds left\./);
 // Absence stays invisible, and an enemy sentry never reads as friendly.
 assert.equal(economyHud({id: 0, team: 0}, {deployables: []}), null);
 assert.equal(economyHud({id: 0, team: 0, upgradeTimer: 0, upgradeWeapon: 2}, {deployables: [{id: 1, owner: 2, team: 1, health: 80, life: 5}]}).mine.length, 0);
 const expired = economyHud({id: 0, team: 0}, {deployables: [{id: 3, owner: 0, team: 0, health: 0, life: 0}]});
 assert.equal(expired.deployables[0].alive, false);
 assert.equal(expired.deployables[0].text, 'SENTRY DOWN');
 assert.equal(economyHud(null, null), null);
});

test('deployable and weapon-upgrade beats have readable captions', () => {
 assert.equal(audioCaption({type: 'deployable'}).text, 'Sentry deployed');
 assert.equal(audioCaption({type: 'deployable-fire'}).text, 'Sentry firing');
 assert.equal(audioCaption({type: 'deployable-expire'}).text, 'Sentry expired');
 assert.equal(audioCaption({type: 'weapon-upgrade'}).text, 'Weapon upgrade');
});
