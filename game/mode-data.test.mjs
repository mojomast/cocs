import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS} from './maps.mjs';
import {objectiveTemplate} from './mode-data.mjs';
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

test('KOTH places the hill at the authored center on next-gen maps',()=>{
  for(const id of ['sunken-hill','colosseum','catacombs','forge']){
    const map=MAPS.find(value=>value.id===id),hill=objectiveTemplate('koth',map).zones[0];
    assert.ok(Math.hypot(hill.x,hill.z)<9,`${id} hill should stay near the arena center (${hill.x},${hill.z})`);
  }
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
