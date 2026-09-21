import test from 'node:test';
import assert from 'node:assert/strict';
import {DESTINATION_MAPS} from './destination-maps.mjs';
import {MAPS,getMap} from './maps.mjs';
import {GAME_MODES} from './config.mjs';
import {ARENA_GROUPS,ARENA_SCALES,arenaMeta,arenaSupportsMode,mapsForMode,resolveMapForMode} from './arenas.mjs';
import {CAPTURABLE_ARCHETYPES,validateMapSchema,validateLattice} from './map-schema.mjs';
import {cocsTemplate} from './cocs.mjs';
import {CAMPAIGN_MISSIONS} from './campaign-data.mjs';

const IDS=[
 'meridian-exchange','verdant-reliquary','ember-crucible',
 'tidal-citadel','sunscar-convoy','asterion-relay','monsoon-foundry',
 'ion-speedway','aurora-stadium',
];
const MODES=[
 'deathmatch','ctf','koth','domination','assault','teamdeathmatch',
 'instagib','rockets','arsenal','armsrace','combined-arms','cocs','cocs-coop',
 'payload','puma-race','puma-soccer','horde','campaign','juggernaut',
 'team-elimination','vip-escort','holdout','uplink',
];
const SPORT_MODES=new Set(['puma-race','puma-soccer']);
// Static authoring budgets, not timing assertions. Existing lattice acceptance
// caps retained navigation at 2,500 nodes; bound authored seeds separately here.
// Collision and terrain caps leave room for the baseline circuit's dense rails
// and next-gen terrain while catching accidental unbounded generation.
const BUDGETS={blocks:2500,navNodes:2500,terrainVertices:65536,terrainTriangles:65536};
const finitePoint=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.z);

test('the nine destination maps are registered once, immutable and explicitly classified',()=>{
 assert.deepEqual(DESTINATION_MAPS.map(map=>map.id).sort(),[...IDS].sort());
 assert.equal(new Set(MAPS.map(map=>map.id)).size,MAPS.length,'global IDs remain unique');
 for(const map of DESTINATION_MAPS){
  assert.equal(getMap(map.id),map,`${map.id} resolves to the exported template`);
  assert.equal(MAPS.filter(entry=>entry.id===map.id).length,1);
  assert.ok(Object.isFrozen(map)&&Object.isFrozen(map.blocks)&&Object.isFrozen(map.navNodes),`${map.id} frozen geometry`);
  assert.ok(map.arena&&Object.isFrozen(map.arena)&&Object.isFrozen(map.arena.play),`${map.id} frozen explicit eligibility`);
  assert.ok(Array.isArray(map.arena.play)&&map.arena.play.length>0);
  assert.equal(new Set(map.arena.play).size,map.arena.play.length,`${map.id} no duplicate modes`);
  const meta=arenaMeta(map.id);
  assert.deepEqual(meta.play,map.arena.play,`${map.id} arena metadata is consumed`);
  assert.equal(meta.group,map.arena.group);
  assert.equal(meta.scale,map.arena.scale);
  assert.ok(ARENA_GROUPS.some(group=>group.id===meta.group));
  assert.ok(Object.hasOwn(ARENA_SCALES,meta.scale));
  assert.equal(meta.legacy,false,`${map.id} ships in the active catalogue`);
  assert.ok(typeof map.description==='string'&&map.description.length>20,`${map.id} selection description`);
  assert.ok(typeof map.tag==='string'&&map.tag.length>0,`${map.id} selection tag`);
 }
});

test('destination eligibility covers all 23 modes without implicit fallback permissions',()=>{
 assert.deepEqual(GAME_MODES.map(mode=>mode.id).sort(),[...MODES].sort());
 const covered=new Set();
 for(const map of DESTINATION_MAPS){
  for(const mode of map.arena.play)assert.ok(MODES.includes(mode),`${map.id} declares real mode ${mode}`);
  for(const mode of MODES){
   const advertised=map.arena.play.includes(mode);
   assert.equal(arenaSupportsMode(map.id,mode),advertised,`${map.id}/${mode} explicit eligibility`);
   assert.equal(mapsForMode(mode).includes(map),advertised,`${map.id}/${mode} selection visibility`);
   if(advertised){
    covered.add(mode);
    assert.equal(resolveMapForMode(map.id,mode),map.id,`${map.id}/${mode} survives launch resolution`);
   }
  }
 }
 assert.deepEqual([...covered].sort(),[...MODES].sort(),'every mode has a new selectable destination');
 // Campaign coverage must represent a playable mission, not just a play flag.
 const recovery=CAMPAIGN_MISSIONS.find(mission=>mission.id==='verdant-signal');
 assert.ok(recovery,'the recovery mission is registered');
 assert.equal(recovery.mapId,'verdant-reliquary');
 assert.equal(recovery.tag,'RECOVERY');
 for(const map of DESTINATION_MAPS.filter(map=>map.arena.play.includes('campaign'))){
  assert.ok(CAMPAIGN_MISSIONS.some(mission=>mission.mapId===map.id),`${map.id} campaign eligibility has a mission`);
 }
});

for(const map of DESTINATION_MAPS)test(`destination schema and static geometry budget: ${map.id}`,()=>{
 assert.deepEqual(validateMapSchema(map),[],`${map.id} structural schema`);
 assert.ok(map.blocks.length>0&&map.blocks.length<=BUDGETS.blocks,`${map.id} collision block budget: ${map.blocks.length}`);
 assert.ok(map.navNodes.length>=8&&map.navNodes.length<=BUDGETS.navNodes,`${map.id} authored navigation budget: ${map.navNodes.length}`);
 assert.ok(map.spawns.length>=2,`${map.id} has distinct spawn choices`);
 assert.ok(new Set(map.spawns.map(([x,z])=>`${x},${z}`)).size>=2);
 const surfaces=map.terrain?.surfaces??[];
 let vertices=0,triangles=0;
 for(const surface of surfaces){
  assert.ok(Array.isArray(surface.vertices)&&surface.vertices.length>=3,`${map.id} terrain polygon vertices`);
  // terrain.mjs accepts an indexed mesh or an implicit triangle fan.
  assert.ok(surface.triangles===undefined||Array.isArray(surface.triangles),`${map.id} terrain triangle indices`);
  vertices+=surface.vertices.length;triangles+=surface.triangles?.length??surface.vertices.length-2;
  for(const vertex of surface.vertices)assert.ok(Array.isArray(vertex)&&vertex.length===3&&vertex.every(Number.isFinite),`${map.id} finite terrain vertex`);
  for(const triangle of surface.triangles??[])assert.ok(Array.isArray(triangle)&&triangle.length===3&&triangle.every(index=>Number.isInteger(index)&&index>=0&&index<surface.vertices.length),`${map.id} valid terrain triangle`);
 }
 assert.ok(vertices<=BUDGETS.terrainVertices,`${map.id} terrain vertex budget: ${vertices}`);
 assert.ok(triangles<=BUDGETS.terrainTriangles,`${map.id} terrain triangle budget: ${triangles}`);
 // Exact supported placements and walking connectors belong to map-layout.test.
});

test('destination sports are exclusive and leave the established fallback maps intact',()=>{
 const sports=DESTINATION_MAPS.filter(map=>map.race);
 assert.deepEqual(sports.map(map=>map.id).sort(),['aurora-stadium','ion-speedway']);
 for(const map of DESTINATION_MAPS){
  const expected=map.id==='ion-speedway'?'puma-race':map.id==='aurora-stadium'?'puma-soccer':null;
  if(expected)assert.deepEqual(map.arena.play,[expected],`${map.id} only advertises its sport`);
  for(const mode of MODES){
   if(expected)assert.equal(arenaSupportsMode(map.id,mode),mode===expected,`${map.id} excludes ${mode}`);
   else if(SPORT_MODES.has(mode))assert.equal(arenaSupportsMode(map.id,mode),false,`${map.id} is not a sport map`);
  }
 }
 assert.equal(resolveMapForMode('aurora-stadium','puma-race'),'puma-circuit');
 assert.equal(resolveMapForMode('ion-speedway','puma-soccer'),'puma-pitch');
 for(const mode of ['cocs','cocs-coop'])assert.equal(resolveMapForMode('ion-speedway',mode),'lattice-slice');
});

test('Ion Speedway authors ordered gates, a full grid and finite track furniture',()=>{
 const map=DESTINATION_MAPS.find(entry=>entry.id==='ion-speedway'),track=map.race;
 assert.notEqual(track.kind,'soccer');
 assert.ok(track.centerline.length>=4);
 assert.equal(track.gates.length,track.centerline.length,'gate sequence matches the driving loop');
 assert.ok(track.grid.length>=8,'the full eight-racer grid fits');
 assert.ok(Array.isArray(track.itemBoxes)&&track.itemBoxes.length>0,'race initialization consumes itemBoxes');
 for(const point of [...track.centerline,...track.gates,...track.grid,...track.itemBoxes,...(track.boostPads??[]),...(track.coins??[])])assert.ok(finitePoint(point));
 for(const [index,gate] of track.gates.entries()){
  assert.ok(Number.isFinite(gate.nx)&&Number.isFinite(gate.nz));
  assert.ok(Math.abs(Math.hypot(gate.nx,gate.nz)-1)<1e-6,'gate normal is a unit direction');
  assert.ok(Number.isFinite(gate.halfWidth)&&gate.halfWidth>2.1,'a Puma can cross the gate');
  const before=track.centerline[(index+track.centerline.length-1)%track.centerline.length],after=track.centerline[(index+1)%track.centerline.length];
  assert.ok(gate.nx*(after.x-before.x)+gate.nz*(after.z-before.z)>0,'gate accepts forward travel');
 }
 for(const slot of track.grid)assert.ok(Number.isFinite(slot.heading));
 for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)assert.ok(Math.hypot(track.grid[i].x-track.grid[j].x,track.grid[i].z-track.grid[j].z)>4.2,'authored grid avoids chassis overlap');
 const furniture=[...track.itemBoxes,...(track.boostPads??[]),...(track.coins??[])];
 assert.ok(furniture.every(point=>typeof point.id==='string'&&point.id.length>0));
 assert.equal(new Set(furniture.map(point=>point.id)).size,furniture.length,'track furniture IDs are unique');
});

test('Aurora Stadium supplies centered kickoff, opposing goals and two slots per team',()=>{
 const map=DESTINATION_MAPS.find(entry=>entry.id==='aurora-stadium'),track=map.race;
 assert.equal(track.kind,'soccer');
 assert.ok(track.pitch.minX<0&&track.pitch.maxX>0&&track.pitch.minZ<0&&track.pitch.maxZ>0,'runtime ball reset at the origin is inside the pitch');
 assert.deepEqual(track.goals.map(goal=>goal.team).sort(),[0,1]);
 for(const goal of track.goals){
  assert.ok(finitePoint(goal));
  assert.ok(Number.isFinite(goal.nx)&&Number.isFinite(goal.nz));
  assert.ok(Math.abs(Math.hypot(goal.nx,goal.nz)-1)<1e-6);
  assert.ok(goal.halfWidth>2.1&&goal.height>0&&goal.depth>0);
  assert.equal(goal.nz,0,'runtime board mouths are on the X ends');
  assert.equal(goal.nx,goal.team===0?-1:1);
  assert.equal(goal.x,goal.team===0?track.pitch.minX:track.pitch.maxX);
 }
 for(const team of [0,1]){
  const slots=track.grid.filter(slot=>(slot.x<0?0:1)===team);
  assert.ok(slots.length>=2,`team ${team} has two kickoff slots`);
  assert.ok(slots.every(slot=>finitePoint(slot)&&Number.isFinite(slot.heading)));
 }
 assert.ok(Number.isFinite(track.ball.r)&&track.ball.r>0);
});

test('both destination theatres supply real lattices and the Operations HQ contract',()=>{
 const theatres=DESTINATION_MAPS.filter(map=>map.arena.play.some(mode=>mode==='cocs'||mode==='cocs-coop'));
 assert.deepEqual(theatres.map(map=>map.id).sort(),['asterion-relay','monsoon-foundry']);
 for(const map of theatres){
  assert.deepEqual(validateLattice(map),[],`${map.id} lattice doctrine`);
  assert.ok(map.playBounds.frontage<=240);
  assert.ok(Math.max(map.playBounds.maxX-map.playBounds.minX,map.playBounds.maxZ-map.playBounds.minZ)<=240);
  assert.deepEqual(map.lanes.map(lane=>lane.kind).sort(),['cqc','vehicle-road','zipline-flank']);
  assert.ok(map.terminals.length>0,`${map.id} has an economy terminal`);
  assert.ok(Array.isArray(map.traversal)&&map.traversal.length>0,`${map.id} has authored devices`);
  for(const team of [0,1])assert.ok(map.depots.some(depot=>depot.hq&&depot.team===team),`${map.id} team ${team} HQ depot`);
  for(const mode of ['cocs','cocs-coop']){
   assert.ok(map.arena.play.includes(mode),`${map.id} supports ${mode}`);
   const state=cocsTemplate(mode,map,{});
   assert.equal(state.synthesized,false,`${map.id}/${mode} never falls back to a generated lattice`);
   assert.equal(state.nodes.length,7,'two HQs plus five capturable nodes fit the published live budgets');
   assert.equal(state.nodes.filter(node=>CAPTURABLE_ARCHETYPES.includes(node.archetype)).length,5);
   assert.equal(state.zones.length,5);
   assert.equal(state.dominanceCount,3);
   assert.equal(state.liveMin,3);assert.equal(state.liveMax,5);assert.equal(state.endgameLive,5);
   for(const team of [0,1]){
    const hq=state.nodes.find(node=>node.id===`hq-${team}`);
    assert.ok(hq,`${map.id} preserves runtime HQ identity ${team}`);
    assert.equal(hq.archetype,'hq');assert.equal(hq.owner,team);
   }
  }
 }
});
