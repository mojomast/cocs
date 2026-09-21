import test from 'node:test';
import assert from 'node:assert/strict';
import {TACTICAL_MARKER_LIMITS,tacticalActors,tacticalCommandGate,tacticalMapGeometry,tacticalMapGeometryForView,tacticalNearestTarget,tacticalObjectives} from './tactical-map.mjs';
import {ISLAND_MAPS} from './island-maps.mjs';

const player={id:0,team:0,x:10,z:20,yaw:0,health:100};

test('LATTICE map uses own-team unexpired intel positions, never enemy actors or legacy contacts',()=>{
  const hud={actors:[player,{id:1,team:0,x:2,z:3,health:100,name:'Squad'},
    {id:2,team:1,x:999,z:999,health:100},{id:3,team:1,x:777,z:777,health:100}],
    cocs:{tick:100,spots:[{id:2,team:0,x:4,z:5,until:101},{id:3,team:1,x:6,z:7,until:200},
      {id:4,team:0,x:8,z:9,until:100}],fieldSupport:{intel:{0:{5:{x:11,z:12,until:120}},1:{6:{x:13,z:14,until:120}}}},
      contacts:{0:[{id:3,own:false,revealed:true,spotted:true,x:777,z:777}]}}};
  const pins=tacticalActors(hud,player);
  assert.equal(pins.friendly.length,2);
  assert.deepEqual(pins.enemy.map(p=>[p.id,p.x,p.z]),[['intel-2',4,5],['intel-5',11,12]]);
  assert.deepEqual(tacticalActors({...hud,spectate:true},player).enemy,[]);
  assert.equal(tacticalActors({...hud,spectate:true},player).friendly.length,1);
});

test('non-LATTICE enemies come from unclamped radar contacts, not actor positions',()=>{
  const hud={actors:[{id:99,team:1,x:1000,z:1000,health:100}]};
  const radar={range:50,contacts:[{kind:'actor',id:9,team:1,x:.2,y:.4},
    {kind:'actor',id:99,team:1,x:1,y:0,offscreen:true,revealed:true},
    {kind:'actor',id:3,team:0,x:0,y:0},{kind:'actor',id:4,team:1,x:0,y:0,dead:true}]};
  assert.deepEqual(tacticalActors(hud,player,radar).enemy.map(p=>[p.id,p.x,p.z]),[['intel-9',20,0]]);
  const rotated=tacticalActors(hud,{...player,yaw:Math.PI/2},radar).enemy[0];
  assert.ok(Math.abs(rotated.x+10)<1e-8);
  assert.ok(Math.abs(rotated.z-10)<1e-8);
});

test('marker work is bounded and keeps player first',()=>{
  const actors=Array.from({length:200},(_,i)=>({id:i+1,team:0,x:i,z:i,health:100}));
  const spots=Array.from({length:200},(_,i)=>({id:i+500,team:0,x:i,z:i,until:10}));
  const pins=tacticalActors({actors,cocs:{tick:1,spots}},player);
  assert.equal(pins.friendly.length,TACTICAL_MARKER_LIMITS.friendly);
  assert.equal(pins.friendly[0].self,true);
  assert.equal(pins.enemy.length,TACTICAL_MARKER_LIMITS.enemy);
});

test('map authority requires real seat, living player and connected command handlers',()=>{
  const callback=()=>{};
  const command={strip:{canIssue:true},commander:{mine:true,seat:0},armCocsVerb:callback,pickCocsTarget:callback,issueCocsOrder:callback};
  assert.equal(tacticalCommandGate({},player,command).allowed,true);
  assert.equal(tacticalCommandGate({},player,{...command,commander:{mine:false}}).allowed,false);
  assert.equal(tacticalCommandGate({spectate:true},player,command).allowed,false);
  assert.equal(tacticalCommandGate({over:true},player,command).allowed,false);
  assert.equal(tacticalCommandGate({},{...player,health:0},command).allowed,false);
  assert.equal(tacticalCommandGate({},player,{...command,issueCocsOrder:null}).allowed,false);
  assert.equal(tacticalCommandGate({},player,null).allowed,false);
});

test('position selection uses only supplied legal targets and preserves ranking on ties',()=>{
  const targets=[{id:'first',x:-10,z:0},{id:'second',x:10,z:0},{id:'bad',x:NaN,z:0}];
  assert.equal(tacticalNearestTarget({x:0,z:0},targets).id,'first');
  assert.equal(tacticalNearestTarget({x:9,z:0},targets).id,'second');
  assert.equal(tacticalNearestTarget({x:0,z:0},[]),null);
  assert.equal(tacticalNearestTarget({x:NaN,z:0},targets),null);
});

test('static geometry preserves footprints, terrain, named routes and legacy bounds',()=>{
  const map={blocks:[{x:0,z:0,w:4,d:6,h:3}],terrain:{surfaces:[{vertices:[[0,0,0],[4,0,0],[0,0,4]],triangles:[[0,1,2]]}]},
    lanes:[{id:'road',kind:'vehicle-road',waypoints:[[0,0],[10,0]],variants:[[[0,1],[10,1]]]}]};
  const before=JSON.stringify(map),geometry=tacticalMapGeometry(map);
  assert.equal(geometry.solids,'M-2,-3h4v6h-4Z');
  assert.equal(geometry.terrain.length,1);
  assert.equal(geometry.terrain[0].path,'M0,0L4,0L0,4Z');
  assert.equal(geometry.lanes.length,2);
  assert.ok(geometry.width>=30);
  assert.equal(JSON.stringify(map),before);
});

test('island floor descriptors preserve every disconnected walkable footprint over void',()=>{
  for (const map of ISLAND_MAPS) {
    const before=JSON.stringify(map),geometry=tacticalMapGeometry(map);
    assert.equal(geometry.voidOutside,true,map.name);
    assert.equal(geometry.terrain.length,0);
    assert.equal(geometry.platforms.length,map.platforms.length);
    for (const platform of map.platforms) {
      const floor=geometry.platforms.find(p=>p.x===platform.x&&p.z===platform.z);
      assert.ok(floor,`${map.name}: missing floor at ${platform.x}, ${platform.z}`);
      assert.equal(floor.w,platform.w);
      assert.equal(floor.d,platform.d);
      assert.equal(floor.elevation,platform.y);
    }
    // The gap between the central island and either base must remain void;
    // cover blocks are not a replacement for the broad walkable floors.
    assert.equal(geometry.platforms.some(p=>Math.abs(23-p.x)<=p.w/2&&Math.abs(p.z)<=p.d/2),false);
    assert.equal(JSON.stringify(map),before);
  }
  assert.equal(tacticalMapGeometry({blocks:[]}).voidOutside,false);
});

test('platform elevation uses surface tops, renders upper overlaps last and expands legacy bounds',()=>{
  const map={platforms:[
    {x:50,z:0,w:20,d:10,y:9,thickness:100,route:'upper'},
    {x:50,z:0,w:20,d:10,topY:-3,thickness:100,route:'lower'},
    {x:0,z:0,w:0,d:8,y:0},
  ]};
  const geometry=tacticalMapGeometry(map);
  assert.deepEqual(geometry.platforms.map(p=>p.elevation),[-3,9]);
  assert.equal(geometry.platforms[0].path,'M40,-5h20v10h-20Z');
  assert.notEqual(geometry.platforms[0].fill,geometry.platforms[1].fill);
  assert.equal(geometry.bounds.maxX,60);
  assert.equal(geometry.solids,'');
});

test('geometry cache defers unseen map work and reuses immutable identity across reopen',()=>{
  let reads=0;
  const map=Object.freeze({id:'deferred',get blocks(){reads++;return [];}});
  assert.equal(tacticalMapGeometryForView(map,false),null);
  assert.equal(reads,0);
  const first=tacticalMapGeometryForView(map,true);
  assert.ok(first);
  const builtReads=reads;
  assert.ok(builtReads>0);
  assert.equal(tacticalMapGeometryForView(map,false),null);
  assert.strictEqual(tacticalMapGeometryForView(map,true),first);
  assert.equal(reads,builtReads);
  // Same id with a new authored object must not reuse the previous geometry.
  const replacement=Object.freeze({id:'deferred',platforms:[{x:0,z:0,w:8,d:8,y:3}]});
  assert.equal(tacticalMapGeometryForView(replacement,false),null);
  assert.notStrictEqual(tacticalMapGeometryForView(replacement,true),first);
  assert.strictEqual(tacticalMapGeometryForView(map,true),first);
});

test('friendly labels use current own-team player squad membership, including self and leader',()=>{
  const hud={actors:[player,{id:1,team:0,x:2,z:3,health:100,name:'Piper'},
    {id:2,team:0,x:4,z:5,health:100,name:'Scout',subagentRole:'scout'},
    {id:3,team:1,x:6,z:7,health:100,name:'Opponent'}],cocs:{squadBoard:{
      0:{squads:[{id:'squad-0-1',team:0,name:'North Watch',leader:'0',members:['0','1']},
        {id:'malformed',team:1,name:'Wrong team',leader:'2',members:['2']}]},
      1:{squads:[{id:'squad-1-1',team:1,name:'Enemy secret',leader:'3',members:['3']}]},
    }}};
  const before=JSON.stringify(hud),pins=tacticalActors(hud,player);
  assert.equal(pins.friendly[0].label,'You · North Watch squad · leader');
  assert.equal(pins.friendly[0].squadLeader,true);
  assert.equal(pins.friendly[1].label,'Piper · North Watch squad');
  assert.equal(pins.friendly[1].squadId,'squad-0-1');
  assert.equal(pins.friendly[2].label,'Scout · scout');
  assert.equal(pins.friendly[2].squadName,null);
  assert.equal(JSON.stringify(hud),before);
  assert.equal(JSON.stringify(pins).includes('Enemy secret'),false);
  const spectator=tacticalActors({...hud,spectate:true},player).friendly[0];
  assert.equal(spectator.label,'Following');
  assert.equal(spectator.squadName,null);
  const next={...hud,cocs:{squadBoard:{0:{squads:[{id:'squad-0-1',team:0,name:'North Watch',leader:'1',members:['1']}]}}}};
  const changed=tacticalActors(next,player);
  assert.equal(changed.friendly[0].label,'You');
  assert.equal(changed.friendly[1].label,'Piper · North Watch squad · leader');
});

test('objectives reflect live ownership and carry authored capture radius and names',()=>{
  const map={nodes:[{id:'front',x:0,z:0,r:14,label:'West Bastion'}]};
  const hud={cocs:{nodes:[{id:'front',x:0,z:0,owner:1,live:true,contested:true}]}};
  const objective=tacticalObjectives(hud,map,player)[0];
  assert.equal(objective.label,'West Bastion');
  assert.equal(objective.radius,14);
  assert.equal(objective.owner,1);
  assert.equal(objective.nodeId,'front');
  assert.match(objective.status,/Enemy.*Contested/);
  const general=tacticalObjectives({objectives:{kind:'payload',position:{x:1,z:2},progress:50},singleplayer:{waypoint:{x:3,z:4,label:'Exit'}},flags:[{team:0,x:5,z:6,state:'home'}]}, {},player);
  assert.deepEqual(general.map(p=>p.kind),['flag','payload','waypoint']);
  assert.equal(general[1].status,'50% delivered');
});
