import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS} from './maps.mjs';
import {authoredCapturePoints,objectiveTemplate} from './mode-data.mjs';
import {floorAt,Match,obstructed} from './core.mjs';
import {RULES} from './data.mjs';

const canonicalObjectiveMaps=['exchange','crosswire','foundry','launchpad','citadel','blood-gulch','skybreak','aether','sunscar-canyon','ironfall-megastructure','longreach-plateau'];

test('Crosswire explicitly uses the north hill without changing domination order',()=>{
  const map=MAPS.find(map=>map.id==='crosswire');
  const hill=objectiveTemplate('koth',map).zones[0];
  assert.deepEqual([hill.x,hill.z,hill.y],[0,-9,0]);
  assert.deepEqual(objectiveTemplate('domination',map).zones.map(p=>[p.id,p.x,p.z]),[['alpha',-9,0],['bravo',0,-9],['charlie',9,0]]);
});

test('classic team spawn pools preserve mirrored hill distances and equal high/low access at runtime',()=>{
  for(const id of ['exchange','foundry','crosswire']){
    const match=new Match('chatgpt','openclaw',()=>.5,id,{mode:'koth',bots:0});
    const {arena,teamSpawns}=match,hill=match.objectiveState.zones[0];
    assert.deepEqual(teamSpawns,arena.teamSpawns,`${id} authored pools used`);
    assert.deepEqual(teamSpawns[0].map(([x,z])=>[-x,z]),teamSpawns[1],`${id} mirrored pools`);
    const heights=Object.values(teamSpawns).map(pool=>pool.map(([x,z])=>floorAt(x,z,arena)));
    assert.deepEqual(heights[0],heights[1],`${id} elevation parity`);
    if(arena.raised){assert.ok(heights[0].includes(0));assert.ok(heights[0].includes(3.8));}
    const distances=Object.values(teamSpawns).map(pool=>pool.map(([x,z])=>Math.hypot(x-hill.x,z-hill.z,floorAt(x,z,arena)-hill.y)));
    assert.deepEqual(distances[0],distances[1],`${id} hill distance parity`);
    for(const pool of Object.values(teamSpawns))for(const [x,z] of pool){
      assert.notEqual(x,0,`${id} no exclusive center spawn`);
      assert.ok(Math.hypot(x-hill.x,z-hill.z)>hill.radius,`${id} no hill spawn`);
    }
  }
});

test('objective modes dispatch on the mode rules, not the mode name',()=>{
  const combined=objectiveTemplate('combined-arms',MAPS.find(map=>map.id==='titan-valley'));
  assert.equal(combined.kind,'domination');
  assert.equal(combined.zones.length,3);
  const assault=objectiveTemplate('assault',MAPS.find(map=>map.id==='rampart'));
  assert.equal(assault.kind,'assault');
  assert.equal(assault.sectors.length,3);
});

test('assault objective builds exactly the configured fragLimit sector count',()=>{
 const map=MAPS.find(value=>value.id==='rampart');
 const names=['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india'];
 for(const count of [1,3,5,9]){
  const state=objectiveTemplate('assault',map,{fragLimit:count});
  assert.equal(state.kind,'assault');
  assert.equal(state.sectors.length,count,`fragLimit ${count} sector count`);
  assert.equal(state.zones,state.sectors,'zones mirror sectors for the HUD');
  assert.equal(state.attacker,0);
  assert.equal(state.defender,1);
  assert.deepEqual(state.sectors.map(s=>s.id),names.slice(0,count));
 }
});

test('authoredCapturePoints resolves the same opening points the objective uses, on and off objectiveZones maps',()=>{
  const crosswire=MAPS.find(value=>value.id==='crosswire');
  const authored=authoredCapturePoints(crosswire);
  assert.deepEqual(authored.map(point=>point.id),['alpha','bravo','charlie'],'authored table order is preserved');
  assert.deepEqual(authored.map(point=>[point.x,point.z]),[[-9,0],[0,-9],[9,0]],'crosswire uses its authored table points');
  // A map with no objectiveZones and no authored table entry still resolves
  // three distinct nav/spawn candidates instead of leaving the hill frozen.
  const frostline=MAPS.find(value=>value.id==='frostline');
  const candidates=authoredCapturePoints(frostline);
  assert.equal(candidates.length,3,'candidate fallback still returns a full point set');
  assert.ok(candidates.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.z)),'candidate points are finite');
  assert.equal(new Set(candidates.map(point=>`${point.x},${point.z}`)).size,3,'candidate points are distinct');
  assert.deepEqual(authoredCapturePoints(frostline),candidates,'the resolution is deterministic');
  // Next-gen maps expose their authored zones through the same helper.
  const atrium=MAPS.find(value=>value.id==='atrium');
  assert.deepEqual(authoredCapturePoints(atrium).map(point=>[point.x,point.z]),atrium.objectiveZones.map(zone=>[zone.x,zone.z]));
});

test('KOTH places the hill at the authored center on next-gen maps',()=>{
  for(const id of ['sunken-hill','colosseum','catacombs','forge']){
    const map=MAPS.find(value=>value.id===id),hill=objectiveTemplate('koth',map).zones[0];
    assert.ok(Math.hypot(hill.x,hill.z)<9,`${id} hill should stay near the arena center (${hill.x},${hill.z})`);
  }
});

test('Juggernaut and Team Elimination objectives expose deterministic state',()=>{
  const map=MAPS.find(value=>value.id==='crosswire');
  const elimination=objectiveTemplate('team-elimination',map,{fragLimit:4});
  assert.equal(elimination.kind,'elimination');
  assert.equal(elimination.livesPerTeam,4);
  assert.deepEqual(elimination.lives,{0:4,1:4});
  assert.deepEqual(elimination.deaths,{0:0,1:0});
  assert.deepEqual(elimination.eliminations,{0:0,1:0});
  assert.equal(elimination.suddenDeath,false);
  assert.deepEqual(elimination.zones.map(z=>z.id),['alpha','bravo','charlie'],'elimination exposes push anchors');
  assert.ok(elimination.zones.length>=3&&elimination.zones.every(z=>Number.isFinite(z.x)&&Number.isFinite(z.z)),'elimination anchors are usable objective centers');
  const juggernaut=objectiveTemplate('juggernaut',map,{});
  assert.equal(juggernaut.kind,'juggernaut');
  assert.equal(juggernaut.juggernautId,0);
  assert.deepEqual(juggernaut.points,{});
  assert.equal(juggernaut.suddenDeath,false);
  assert.deepEqual(juggernaut.zones.map(z=>z.id),['alpha','bravo','charlie'],'juggernaut exposes hold anchors');
  assert.equal(objectiveTemplate('koth',map).kind,'koth');
  assert.equal(objectiveTemplate('domination',map).kind,'domination');
});

test('extraction objectives author a spawn, a beacon and a terminating win state',()=>{
 const map=MAPS.find(value=>value.id==='gauntlet');
 const state=objectiveTemplate('vip-escort',map,{fragLimit:1});
 assert.equal(state.kind,'extraction');
 assert.ok(Number.isFinite(state.spawn.x)&&Number.isFinite(state.spawn.z),'escort spawn');
 assert.ok(Number.isFinite(state.extract.x)&&Number.isFinite(state.extract.z),'extraction beacon');
 assert.notDeepEqual([state.spawn.x,state.spawn.z],[state.extract.x,state.extract.z],'spawn and beacon differ');
 assert.ok(state.captureSeconds>0&&state.escortRadius>0,'the beacon has a hold window and radius');
 assert.equal(state.winner,null);
 assert.equal(state.vipId,null);
});

test('Holdout authors a quorum hold window on top of Domination zones',()=>{
 const map=MAPS.find(value=>value.id==='crosswire');
 const state=objectiveTemplate('holdout',map,{fragLimit:5});
 assert.equal(state.kind,'domination','holdout reuses the domination capture loop');
 assert.equal(state.zones.length,3);
 assert.equal(state.holdCount,2,'a quorum smaller than the zone count cannot deadlock');
 assert.ok(state.holdCount<state.zones.length);
 assert.equal(state.holdSeconds,30);
 assert.deepEqual(state.holdProgress,{0:0,1:0});
 assert.equal(state.holdTeam,null);
 assert.equal(objectiveTemplate('domination',map,{fragLimit:5}).holdCount,undefined,'plain domination is untouched');
});

test('Uplink authors an ordered stage race on top of the KOTH hill',()=>{
 const map=MAPS.find(value=>value.id==='crosswire');
 const state=objectiveTemplate('uplink',map,{fragLimit:5});
 assert.equal(state.kind,'koth','uplink reuses the single-hill capture loop');
 assert.equal(state.zones.length,1);
 assert.equal(state.stageCount,3);
 assert.equal(state.stages.length,3);
 assert.equal(state.stage,0);
 assert.deepEqual(state.stageCaptures,{0:0,1:0});
 assert.deepEqual(state.zones[0].id,'hill');
 assert.deepEqual(state.stages.map(stage=>stage.id),['uplink-1','uplink-2','uplink-3']);
 for(const stage of state.stages)assert.ok(Number.isFinite(stage.x)&&Number.isFinite(stage.z),'stages are usable capture centers');
 assert.equal(objectiveTemplate('koth',map,{fragLimit:5}).stages,undefined,'plain KOTH is untouched');
});

test('KOTH and Domination objectives use safe authored points on every canonical map',()=>{
  for(const id of canonicalObjectiveMaps){
    const map=MAPS.find(value=>value.id===id);
    for(const mode of ['koth','domination']){
      const zones=objectiveTemplate(mode,map).zones;
      assert.equal(zones.length,mode==='koth'?1:3,`${id} ${mode} zone count`);
      for(const zone of zones){
        assert.ok(Number.isFinite(zone.x)&&Number.isFinite(zone.z),`${id} finite point`);
        assert.ok(zone.radius>0&&zone.radius<=3.5,`${id} capture radius`);
        assert.equal(floorAt(zone.x,zone.z,map),zone.y,`${id} support height`);
        assert.equal(obstructed(zone.x,zone.y,zone.z,RULES.radius,map),false,`${id} player-clear point`);
        assert.ok(!(map.blocks||[]).some(block=>block.kind!=='deck'&&Math.abs(zone.x-block.x)<block.w/2+.5&&Math.abs(zone.z-block.z)<block.d/2+.5&&zone.y<block.h),`${id} obstructed point`);
        if(map.platforms)assert.ok(map.platforms.some(platform=>Math.abs(zone.x-platform.x)+zone.radius<=platform.w/2&&Math.abs(zone.z-platform.z)+zone.radius<=platform.d/2),`${id} capture footprint`);
      }
    }
  }
});
