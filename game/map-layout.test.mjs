import assert from 'node:assert/strict';
import test from 'node:test';
import {MAPS} from './maps.mjs';
import {arenaSupportsMode} from './arenas.mjs';
import {GAME_MODES,modeRule} from './config.mjs';
import {Match,floorAt,obstructed,walkEdge,navigation} from './core.mjs';
import {RULES} from './data.mjs';

for(const arena of MAPS)test(`registry runtime placements: ${arena.id}`,t=>{
  const modes=GAME_MODES.filter(mode=>arenaSupportsMode(arena.id,mode.id));
  assert.ok(modes.length,'map advertises at least one registered mode');
  const checked=new Set();
  const counts={modes:0,placements:0,authored:0,spawns:0,teamSpawns:0,actors:0,pickups:0,flags:0,objectives:0,payload:0};
  let nav,edges,roundTrip;
  for(const {id:mode} of modes){
    // Match owns the navigation cache; do not rebuild navigation per mode.
    const match=new Match('chatgpt','openclaw',()=>.5,arena.id,{mode,botCount:0,humanCount:2,fragLimit:3});
    assert.equal(match.arena,arena);
    assert.equal(match.config.mode,mode);
    if(!nav){
      // Race bots follow the circuit rather than an infantry graph. Independently
      // validate the authored track navigation without requiring it at startup.
      const graph=arena.race?navigation(arena):{nodes:match.nav,edges:match.edges};
      nav=graph.nodes;edges=graph.edges;
      assert.ok(nav.length>1,`${arena.id} has navigation`);
      const incoming=edges.map(()=>[]);
      edges.forEach((neighbors,from)=>neighbors.forEach(to=>incoming[to].push(from)));
      // Forward and reversed searches prove outbound AND return paths. Sharing
      // this root connects all passing placements, including opposite bases.
      const reach=[edges,incoming].map(graph=>{
        const seen=new Set([0]),queue=[0];
        for(let i=0;i<queue.length;i++)for(const next of graph[queue[i]])if(!seen.has(next)){
          seen.add(next);queue.push(next);
        }
        return seen;
      });
      roundTrip=nav.filter((_,i)=>reach.every(seen=>seen.has(i)));
      assert.ok(roundTrip.length>1,`${arena.id} has a round-trip navigation component`);
    }else{
      assert.equal(match.nav,nav,'Match reuses map navigation');
      assert.equal(match.edges,edges,'Match reuses map edges');
    }
    const check=(value,kind,id)=>{
      counts.placements++;counts[kind]++;
      const point=Array.isArray(value)?{x:value[0],z:value[1]}:value;
      const {x,z}=point,y=point.y===undefined?floorAt(x,z,arena):point.y;
      const label=`${arena.id}/${mode} ${kind} ${id} at ${x},${y},${z}`;
      assert.ok([x,y,z].every(Number.isFinite),`${label}: finite supported position`);
      const key=`${x},${y},${z}`;
      if(checked.has(key))return;
      const ground=floorAt(x,z,arena);
      assert.ok(Number.isFinite(ground),`${label}: ground support`);
      assert.ok(Math.abs(y-ground)<.01,`${label}: runtime floor height ${ground}`);
      assert.equal(obstructed(x,y,z,RULES.radius,arena),false,`${label}: actor clearance`);
      assert.equal(obstructed(x,y,z,.65,arena),false,`${label}: navigation clearance`);
      const p={x,y,z};
      assert.ok(roundTrip.some(node=>{
        const distance=Math.hypot(node.x-x,node.z-z);
        return distance>.1&&distance<=6.5&&walkEdge(p,node,arena)&&walkEdge(node,p,arena);
      }),`${label}: nonzero exact bidirectional walking connector with outbound/return graph paths`);
      checked.add(key);
    };
    if(counts.modes===0){
      // Check original pools too: spawn() repairs blocked authored positions,
      // which would otherwise conceal layout defects in final actor checks.
      arena.spawns.forEach((p,i)=>check(p,'authored',`spawn ${i}`));
      for(const [team,pool] of Object.entries(arena.teamSpawns||{}))pool.forEach((p,i)=>check(p,'authored',`team ${team} spawn ${i}`));
      for(const [team,p] of Object.entries(arena.flagSpawns||{}))check(p,'authored',`flag ${team}`);
      arena.pickups.forEach(([kind,x,z],i)=>check({x,z},'authored',`pickup ${i} ${kind}`));
    }
    match.spawns.forEach((p,i)=>check(p,'spawns',i));
    for(const [team,pool] of Object.entries(match.teamSpawns))pool.forEach((p,i)=>check(p,'teamSpawns',`${team}:${i}`));
    match.actors.forEach(p=>{
      if(!arena.race){check(p,'actors',p.id);return;}
      const vehicle=match.vehicleById(p.vehicleId);
      assert.ok(vehicle,`racer ${p.id} has a Puma`);
      assert.equal(vehicle.driver,p.id);
      check(vehicle.position,'actors',p.id);
      assert.equal(obstructed(vehicle.position.x,vehicle.position.y,vehicle.position.z,2.1,arena),false,`racer ${p.id} chassis clearance`);
    });
    match.pickups.forEach(p=>check(p,'pickups',`${p.id}:${p.kind}`));
    if(mode==='ctf')assert.equal(Object.values(match.flags).length,2,'both runtime flags exist');
    Object.values(match.flags).forEach(p=>check(p,'flags',p.team));
    const objectiveKind=modeRule(mode).objective?.kind;
    if(objectiveKind){
      assert.equal(match.objectiveState?.kind,objectiveKind,`${mode} creates its runtime objective`);
      assert.ok(match.objectiveState.zones.length>0,`${mode} has objective centers`);
    }
    match.objectiveState?.zones.forEach(p=>check(p,'objectives',p.id));
    if(mode==='payload')check(match.objectiveState.position,'payload','cart start');
    counts.modes++;
  }
  t.diagnostic(JSON.stringify({...counts,uniquePlacements:checked.size}));
});
