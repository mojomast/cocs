import assert from 'node:assert/strict';
import test from 'node:test';
import {getMap} from './maps.mjs';
import {EXPANSION_MAPS} from './expansion-maps.mjs';
import {ISLAND_MAPS} from './island-maps.mjs';
import {floorAt,moveActor,navigation,obstructed,walkEdge} from './core.mjs';
import {objectiveTemplate} from './mode-data.mjs';
import {RULES} from './data.mjs';

const maps=['exchange','crosswire','foundry','launchpad','citadel'].map(getMap).concat(EXPANSION_MAPS);
const graphs=new Map(maps.map(map=>[map,navigation(map)]));

test('all authored island pickups, spawns, team spawns and flags have clearance and exact connectors to both bases',()=>{
  for(const map of ISLAND_MAPS){
    const graph=navigation(map),incoming=graph.edges.map(()=>[]);
    graph.edges.forEach((edges,from)=>edges.forEach(to=>incoming[to].push(from)));
    const baseReachability=[0,1].flatMap(team=>{
      const base={...map.flagSpawns[team],y:0};
      return [graph.edges,incoming].map(edges=>{
        const starts=graph.nodes.flatMap((node,i)=>walkEdge(base,node,map)&&walkEdge(node,base,map)?[i]:[]);
        assert.ok(starts.length,`${map.id} team ${team} base connector`);
        const seen=new Set(starts),queue=[...starts];
        for(let i=0;i<queue.length;i++)for(const next of edges[queue[i]])if(!seen.has(next)){seen.add(next);queue.push(next);}
        return seen;
      });
    });
    // Check immutable authored coordinates directly, without Match spawn relocation.
    const points=[...map.pickups,...map.spawns.map(([x,z])=>['FFA spawn',x,z]),
      ...Object.entries(map.teamSpawns).flatMap(([team,pool])=>pool.map(([x,z])=>[`team ${team} spawn`,x,z])),
      ...Object.entries(map.flagSpawns).map(([team,p])=>[`team ${team} flag`,p.x,p.z])];
    for(const [kind,x,z] of points){
      const p={x,z,y:floorAt(x,z,map)},label=`${map.id} ${kind} ${x},${z}`;
      assert.equal(p.y,0,`${label} island floor support`);
      assert.ok(map.platforms.some(platform=>Math.abs(x-platform.x)+.65<=platform.w/2&&Math.abs(z-platform.z)+.65<=platform.d/2),`${label} supported footprint`);
      assert.equal(obstructed(x,p.y,z,RULES.radius,map),false,`${label} actor clearance`);
      assert.equal(obstructed(x,p.y,z,.65,map),false,`${label} navigation clearance`);
      assert.ok(graph.nodes.some((node,i)=>Math.hypot(node.x-x,node.z-z)>.1&&walkEdge(node,p,map)&&walkEdge(p,node,map)&&baseReachability.every(seen=>seen.has(i))),`${label} exact walking connector with routes to and from both bases`);
    }
  }
});

test('island authored spawn pools retain mirrored positions and team aliases',()=>{
  for(const map of ISLAND_MAPS){
    assert.equal(map.spawns.length,8,`${map.id} FFA pool size`);
    assert.equal(new Set(map.spawns.map(p=>p.join(','))).size,8,`${map.id} unique FFA spawns`);
    for(const [x,z] of map.spawns)assert.ok(map.spawns.some(([mx,mz])=>mx===-x&&mz===z),`${map.id} mirrored FFA spawn ${x},${z}`);
    assert.equal(map.teamSpawns[0].length,2,`${map.id} team pool size`);
    assert.deepEqual(map.teamSpawns[0].map(([x,z])=>[-x,z]),map.teamSpawns[1],`${map.id} mirrored team pools`);
    assert.deepEqual(map.teamSpawns.red,map.teamSpawns[0]);
    assert.deepEqual(map.teamSpawns.blue,map.teamSpawns[1]);
    assert.deepEqual(map.flagSpawns.red,map.flagSpawns[0]);
    assert.deepEqual(map.flagSpawns.blue,map.flagSpawns[1]);
    for(const [x,z] of [...map.teamSpawns[0],...map.teamSpawns[1]])assert.ok(map.spawns.some(([sx,sz])=>sx===x&&sz===z),`${map.id} consistent FFA/team spawn ${x},${z}`);
  }
});

test('classic and expansion gameplay points have runtime clearance and exact walking connectors',()=>{
  for(const map of maps){
    const graph=graphs.get(map);
    const points=[...map.spawns,...Object.values(map.teamSpawns||{}).flat(),...map.pickups.map(([,x,z])=>[x,z]),
      ...Object.values(map.flagSpawns||{}).map(p=>[p.x,p.z]),
      ...objectiveTemplate('domination',map).zones.map(p=>[p.x,p.z]),
      ...objectiveTemplate('koth',map).zones.map(p=>[p.x,p.z]),
      ...(map.jumpLinks||[]).flatMap(link=>[link.source,link.target]).map(p=>[p.x,p.z])];
    for(const [x,z] of points){
      const p={x,z,y:floorAt(x,z,map)},label=`${map.id} ${x},${z}`;
      assert.notEqual(p.y,null,`${label} support`);
      assert.equal(obstructed(x,p.y,z,RULES.radius,map),false,`${label} actor clearance`);
      assert.equal(obstructed(x,p.y,z,.65,map),false,`${label} navigation clearance`);
      // A nearby node alone does not prove that the exact authored point is reachable.
      assert.ok(graph.nodes.some((node,i)=>graph.edges[i].length&&Math.hypot(node.x-x,node.z-z)>.1&&walkEdge(node,p,map)&&walkEdge(p,node,map)),`${label} walking connector`);
    }
  }
});

test('Launchpad bot links connect exact launcher endpoints',()=>{
  const map=getMap('launchpad'),graph=graphs.get(map);
  assert.equal(map.jumpLinks.length,4);
  for(const pad of map.traversal.boostLaunchers){
    const link=map.jumpLinks.find(link=>link.traversal===pad.id);
    assert.deepEqual(link.source,{x:pad.x,z:pad.z,y:0});
    assert.deepEqual(link.target,{x:-pad.x||0,z:-pad.z||0,y:0});
    assert.deepEqual(pad.target,link.target);
    const from=graph.nodes.findIndex(p=>p.x===link.source.x&&p.z===link.source.z&&p.y===0);
    const to=graph.nodes.findIndex(p=>p.x===link.target.x&&p.z===link.target.z&&p.y===0);
    assert.ok(from>=0&&to>=0,pad.id);
    assert.ok(graph.edges[from].includes(to),pad.id);
  }
});

test('Launchpad flights physically clear the reactor and land opposite at multiple timesteps',()=>{
  const map=getMap('launchpad');
  for(const dt of [1/60,1/120,1/240])for(const pad of map.traversal.boostLaunchers){
    const actor={x:pad.x,y:0,z:pad.z,vx:0,vy:0,vz:0,grounded:true,coyote:0,jumpBuffer:0};
    moveActor(actor,{},dt,map);
    assert.equal(actor.traversalFlight,true,pad.id);
    let crossed=false;
    for(let i=0;i<Math.ceil(3/dt)&&!actor.grounded;i++){
      const before={x:actor.x,y:actor.y,z:actor.z};
      moveActor(actor,{},dt,map);
      // Targeted traversal bypasses horizontal collision, so sample the physical body too.
      const samples=Math.max(1,Math.ceil(Math.hypot(actor.x-before.x,actor.y-before.y,actor.z-before.z)/.05));
      for(let j=1;j<=samples;j++){
        const t=j/samples,x=before.x+(actor.x-before.x)*t,y=before.y+(actor.y-before.y)*t,z=before.z+(actor.z-before.z)*t;
        assert.equal(obstructed(x,y,z,RULES.radius,map),false,`${pad.id} dt=${dt} collision at ${x},${y},${z}`);
        if(Math.abs(x)<1.5&&Math.abs(z)<1.5){crossed=true;assert.ok(y>=3);}
      }
    }
    assert.ok(crossed,`${pad.id} crossed reactor`);
    assert.equal(actor.grounded,true,`${pad.id} landed`);
    assert.equal(actor.y,0,`${pad.id} ground landing`);
    assert.ok(Math.hypot(actor.x-pad.target.x,actor.z-pad.target.z)<.9,`${pad.id} opposite landing`);
  }
});
