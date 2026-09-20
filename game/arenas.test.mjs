import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS} from './maps.mjs';
import {GAME_MODES} from './config.mjs';
import {ARENA_GROUPS,ARENA_SCALES,DEFAULT_MAX_BOTS,activeMaps,arenaMeta,arenaSupportsMode,groupedMaps,mapsForMode,maxBotsFor,modeMapSummary,recommendedBots,resolveMapForMode} from './arenas.mjs';
import {shuffleSelection,nextArenaSelection} from './replay.mjs';
import {Match} from './core.mjs';

test('every arena has a valid group, scale and play list',()=>{
 const groups=new Set(ARENA_GROUPS.map(group=>group.id)),scales=new Set(Object.keys(ARENA_SCALES)),modes=new Set(GAME_MODES.map(mode=>mode.id));
 for(const map of MAPS){
  const meta=arenaMeta(map.id);
  assert.equal(meta.id,map.id);
  assert.ok(groups.has(meta.group),`${map.id} group ${meta.group}`);
  assert.ok(scales.has(meta.scale),`${map.id} scale ${meta.scale}`);
  assert.ok(ARENA_SCALES[meta.scale].bots>0);
  for(const mode of meta.play||[])assert.ok(modes.has(mode),`${map.id} play ${mode}`);
 }
 assert.equal(arenaMeta('missing-map'),null);
});
test('maps do not ship dead schema the runtime never reads',()=>{
 for(const map of MAPS)for(const field of ['objectiveNodes','variants','roofs','group','scale','mode'])assert.equal(map[field],undefined,`${map.id} ${field}`);
});

test('legacy arenas are archived unless explicitly enabled',()=>{
 const active=activeMaps(),all=activeMaps({legacy:true});
 assert.deepEqual(all.map(map=>map.id),MAPS.map(map=>map.id));
 assert.ok(active.length<all.length);
 assert.ok(active.every(map=>arenaMeta(map.id).legacy===false));
 for(const id of ['exchange','crosswire','foundry','launchpad','citadel','blood-gulch'])assert.ok(arenaMeta(id).legacy,`${id} legacy`);
 for(const id of ['skybreak','aether','frostline','ironfall-megastructure','derelict-station'])assert.equal(arenaMeta(id).legacy,false,id);
});

test('combined arms is vehicle-biased, supports the big maps and allows a larger roster',()=>{
 assert.equal(maxBotsFor('combined-arms'),16);
 assert.equal(maxBotsFor('deathmatch'),DEFAULT_MAX_BOTS);
 const maps=activeMaps().filter(map=>arenaSupportsMode(map.id,'combined-arms'));
 assert.ok(maps.length>=3);
 assert.ok(maps.every(map=>(map.terrain||map.vehicles||map.platforms)),'combined arms maps are large or vehicle-capable');
 assert.ok(!arenaSupportsMode('exchange','combined-arms'),'legacy skirmish arenas are not combined-arms');
 assert.equal(recommendedBots('combined-arms','longreach-plateau'),11);
 assert.ok(recommendedBots('combined-arms','exchange')<=16);
});
test('every arena advertising combined arms declares vehicles',()=>{
 const modes=new Set(GAME_MODES.map(mode=>mode.id));
 assert.ok(modes.has('combined-arms'));
 const advertised=MAPS.filter(map=>arenaSupportsMode(map.id,'combined-arms'));
 assert.ok(advertised.length>=3);
 for(const map of advertised)assert.ok((map.vehicles||[]).length>0,`${map.id} declares vehicles`);
});

test('mode map summaries and grouping render valid metadata',()=>{
 for(const map of MAPS){const summary=modeMapSummary('domination',map.id);assert.equal(summary.mapId,map.id);assert.ok(ARENA_GROUPS.some(group=>group.id===summary.group));assert.ok(summary.maxBots>=8);assert.ok(summary.recommendedBots>=0&&summary.recommendedBots<=summary.maxBots);}
 const groups=groupedMaps(activeMaps());
 assert.ok(groups.length>=3);
 for(const group of groups)assert.ok(group.maps.every(map=>arenaMeta(map.id).group===group.id));
 const ids=new Set(groups.flatMap(group=>group.maps.map(map=>map.id)));
 assert.equal(ids.size,activeMaps().length);
});

test('mode filtering hides unsupported maps and honours legacy',()=>{
 const ctf=activeMaps().filter(map=>arenaSupportsMode(map.id,'ctf'));
 assert.ok(ctf.length>0);
 assert.ok(ctf.every(map=>arenaSupportsMode(map.id,'ctf')));
 assert.ok(mapsForMode('deathmatch',{legacy:true}).length>=activeMaps().length);
});

test('lonely mode pools are spread across compatible arenas',()=>{
 const pool=mode=>mapsForMode(mode,{legacy:true}).map(map=>map.id);
 for(const [mode,floor] of [['juggernaut',10],['team-elimination',10],['vip-escort',10],['holdout',12],['uplink',12],['armsrace',12],['assault',10]])
  assert.ok(pool(mode).length>=floor,`${mode} pool widened (${pool(mode).length} maps)`);
 assert.ok(arenaSupportsMode('colosseum','juggernaut'),'arena maps host the crown');
 assert.ok(arenaSupportsMode('frostline','team-elimination'),'team battlefields host elimination');
 assert.ok(arenaSupportsMode('riverbend','vip-escort'),'route maps host the VIP escort');
 assert.ok(arenaSupportsMode('frost-gate','holdout')&&arenaSupportsMode('frost-gate','uplink'),'zone maps host the domination/koth variants');
 assert.ok(arenaSupportsMode('atrium','armsrace'),'connected arenas host Arms Race');
 assert.ok(arenaSupportsMode('warfront','assault'),'sector maps host assault');
 // The moving-hill rotation can now resolve authored/nav points, but LATTICE
 // content stays authored-only: no non-lattice map gains cocs or cocs-coop.
 assert.deepEqual(pool('cocs'),['lattice-slice']);
 assert.deepEqual(pool('cocs-coop'),['lattice-slice']);
});

test('legacy gating excludes archived arenas from shuffle and rotation',()=>{
 for(let k=0;k<20;k++)assert.equal(arenaMeta(shuffleSelection(()=>k/20,{legacy:false}).mapId).legacy,false);
 const next=nextArenaSelection('warfront',()=>.4,{legacy:false}).mapId;
 assert.equal(arenaMeta(next).legacy,false);
 assert.equal(nextArenaSelection('exchange',()=>0,{legacy:true}).mapId,MAPS[1].id);
});
test('resolveMapForMode keeps a compatible arena and repairs an incompatible one',()=>{
 assert.equal(resolveMapForMode('colosseum','deathmatch'),'colosseum');
 const repaired=resolveMapForMode('colosseum','ctf');
 assert.notEqual(repaired,'colosseum');
 assert.ok(arenaSupportsMode(repaired,'ctf'));
 assert.ok(!arenaMeta(repaired).legacy);
 assert.equal(resolveMapForMode('launchpad','ctf',{legacy:true}),'launchpad');
});
test('every CTF-capable arena authors distinct flag bases inside its bounds',()=>{
 const point=value=>Array.isArray(value)?[value[0],value[1]]:value?[value.x,value.z]:null;
 const ctf=MAPS.filter(map=>arenaSupportsMode(map.id,'ctf'));
 assert.ok(ctf.length>=8);
 for(const map of ctf){
  const flags=map.flagSpawns||map.flags,red=point(flags?.[0]??flags?.red),blue=point(flags?.[1]??flags?.blue);
  assert.ok(red&&blue&&Number.isFinite(red[0])&&Number.isFinite(red[1])&&Number.isFinite(blue[0])&&Number.isFinite(blue[1]),`${map.id} authors both flag bases`);
  assert.ok(Math.hypot(red[0]-blue[0],red[1]-blue[1])>16,`${map.id} bases are separated`);
  const b=map.bounds||{minX:-14,maxX:14,minZ:-14,maxZ:14};
  for(const [team,p] of [[0,red],[1,blue]])assert.ok(p[0]>b.minX&&p[0]<b.maxX&&p[1]>b.minZ&&p[1]<b.maxZ,`${map.id} team ${team} base in bounds`);
 }
});
test('CTF matches place both flags at the authored bases',()=>{
 for(const id of ['citadel','trenchline','signal-ridge','sunken-hill']){
  const match=new Match('chatgpt','openclaw',()=>.5,id,{mode:'ctf',botCount:0,humanCount:1}),flags=match.flags;
  assert.ok(flags[0]&&flags[1],id);
  assert.deepEqual([flags[0].x,flags[0].z],match.flagSpawns[0],`${id} red base`);
  assert.deepEqual([flags[1].x,flags[1].z],match.flagSpawns[1],`${id} blue base`);
  assert.notDeepEqual(match.flagSpawns[0],match.flagSpawns[1],`${id} distinct bases`);
 }
});
test('puma-soccer is confined to its pitch and does not bleed into other vehicle maps',()=>{
 assert.deepEqual(mapsForMode('puma-soccer').map(map=>map.id),['puma-pitch']);
 assert.equal(arenaSupportsMode('puma-pitch','puma-soccer'),true);
 assert.equal(arenaSupportsMode('puma-circuit','puma-soccer'),false);
 assert.equal(arenaSupportsMode('puma-pitch','puma-race'),false);
 assert.equal(maxBotsFor('puma-soccer'),3);
});
test('the biome next-gen maps are active outdoor arenas with distinct groups',()=>{
 for(const id of ['dune-ravine','ember-caldera']){
  const meta=arenaMeta(id);
  assert.ok(meta,`${id} is registered`);
  assert.equal(meta.legacy,false,`${id} is active`);
  assert.equal(meta.group,'outdoor');
  assert.ok(meta.play.includes('deathmatch')||meta.play.includes('rockets'),`${id} advertises a primary mode`);
  assert.ok(activeMaps().some(map=>map.id===id),`${id} is in the active rotation`);
 }
});

test('payload is enabled on route-capable arenas and reconciles an incompatible one',()=>{
 const payload=mapsForMode('payload');
 assert.ok(payload.length>=8,'payload has a broad arena rotation');
 assert.ok(payload.every(map=>(Array.isArray(map.spawns)&&map.spawns.length>=2)||map.teamSpawns),'payload arenas have a start and an end');
 assert.ok(arenaSupportsMode('sunscar-canyon','payload'));
 assert.ok(!arenaSupportsMode('colosseum','payload'));
 const repaired=resolveMapForMode('colosseum','payload');
 assert.ok(arenaSupportsMode(repaired,'payload'));
});
