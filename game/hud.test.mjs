import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleHud, escapeHint, voiceHint, reloadProgress, dynamicCrosshairGap, lowAmmo, postureLabel, hitMarker, projectToScreen, damageNumberStyle, boundList, damageBearing, killBanner, weaponTag, ammoText, commandBrief, isTeamMode, matchStartBanner, modeColumns, modeGoal, modePrimary, modeTargetText, objectiveCopy, suddenDeathBanner, grenadeStatus, killstreakCallout, ladderStatus, streakStatus, audioCaption, scoreAnnouncer, multikillLabel, spreeLabel, recentKills, killCallout, matchAwards, killFeedWeapon, connectionQuality, spectateActor, nextSpectateTarget, spectatorBoard, spectatorTeams, weaponRangeInfo, weaponRangeLabel, scoreStats} from './hud.mjs';
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
  assert.equal(hitMarker({hit:true,time:10,feed:[{killer:'ChatGPT',victim:'Grok',self:false,time:9.5}]}, player), 'kill');
  assert.equal(hitMarker({hit:true,time:10,feed:[{killer:'Grok',victim:'ChatGPT',self:false,time:9.5}]}, player), 'hit');
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
  assert.equal(by('objective').value, '20.0s');
  assert.equal(by('flag').name, 'ChatGPT');
  assert.equal(by('deaths').name, 'Grok');
  assert.equal(by('deaths').value, '11 DEATHS');
  assert.equal(by('ratio').name, 'ChatGPT');
  assert.equal(by('ratio').value, '3.00');
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
 assert.equal(suddenDeathBanner({suddenDeath:true,over:true}),null);
 assert.equal(suddenDeathBanner({}),null);
});

test('grenade status reports readiness and remaining cooldown',()=>{
 assert.deepEqual(grenadeStatus({grenadeCooldown:0}),{ready:true,cooldown:0,label:'FRAG READY'});
 const cooling=grenadeStatus({grenadeCooldown:3.24});
 assert.equal(cooling.ready,false);
 assert.equal(cooling.label,'FRAG 3.2s');
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
  assert.equal(audioCaption({type: 'unknown-event'}), null);
  assert.equal(audioCaption(null), null);
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
