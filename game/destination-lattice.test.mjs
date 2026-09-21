import test from 'node:test';
import assert from 'node:assert/strict';
import {DESTINATION_LATTICE_MAPS} from './destination-lattice-maps.mjs';
import {getMap} from './maps.mjs';
import {arenaMeta,arenaSupportsMode} from './arenas.mjs';
import {GAME_MODES,COCS_RUNG_IDS,cocsRung} from './config.mjs';
import {validateMapSchema,validateLattice,CAPTURABLE_ARCHETYPES} from './map-schema.mjs';
import {floorAt,obstructed,walkEdge,navigation,Match} from './core.mjs';
import {terrainSupportAt} from './terrain.mjs';
import {mulberry32} from './levelgen.mjs';
import {cocsTemplate,capturableBy,connectedToHq,enterEndgame,updateLiveNodes} from './cocs.mjs';
import {TERMINAL_KINDS} from './cocs-terminals.mjs';
import {COOP_SIEGE} from './cocs-difficulty.mjs';
import {RULES} from './data.mjs';

const DT=RULES.dt;
const graphs=new WeakMap();
const graphFor=map=>{
 if(!graphs.has(map))graphs.set(map,navigation(map));
 return graphs.get(map);
};
const at=(map,x,z)=>({x,z,y:floorAt(x,z,map)});
const capturable=state=>state.nodes.filter(n=>CAPTURABLE_ARCHETYPES.includes(n.archetype));
const byId=(state,id)=>state.nodes.find(n=>n.id===id);

function supported(map,p,label,radius=.65){
 const floor=at(map,p.x,p.z);
 assert.ok(Number.isFinite(floor.y),`${label}: runtime floor exists`);
 const rendered=terrainSupportAt(p.x,p.z,map.terrain,map.terrain.maxSlope);
 assert.ok(rendered,`${label}: rendered triangle supports the anchor`);
 assert.ok(Math.abs(rendered.y-floor.y)<1e-6,`${label}: collision and rendered floor agree`);
 if(p.y!==undefined)assert.ok(Math.abs(p.y-floor.y)<1e-6,`${label}: authored height agrees with runtime`);
 assert.equal(obstructed(floor.x,floor.y,floor.z,radius,map),false,`${label}: capsule clearance`);
 return floor;
}

function attachment(map,graph,p,label){
 const floor=supported(map,p,label);
 // A nearby node alone can hide a sealed room or a roof pruned from navigation.
 // Require a real floor-walking edge in BOTH directions into the retained graph.
 const index=graph.nodes.findIndex(n=>Math.hypot(n.x-floor.x,n.z-floor.z)<6.4
  &&walkEdge(floor,n,map)&&walkEdge(n,floor,map));
 assert.ok(index>=0,`${label}: physical two-way connection to retained nav`);
 return index;
}

function reached(edges,start){
 const seen=new Set([start]),queue=[start];
 for(let i=0;i<queue.length;i++)for(const next of edges[queue[i]])if(!seen.has(next)){
  seen.add(next);queue.push(next);
 }
 return seen;
}

function sampledWalk(map,a,b,label,slope=.3){
 const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5));
 let previous=supported(map,a,`${label}: start`);
 for(let i=1;i<=count;i++){
  const next=supported(map,{x:a.x+(b.x-a.x)*i/count,z:a.z+(b.z-a.z)*i/count},`${label}: sample ${i}`);
  assert.ok(walkEdge(previous,next,map),`${label}: forward ground edge ${i}`);
  assert.ok(walkEdge(next,previous,map),`${label}: reverse ground edge ${i}`);
  assert.ok(Math.abs(next.y-previous.y)<=Math.hypot(next.x-previous.x,next.z-previous.z)*slope+1e-6,
   `${label}: ordinary-operator ramp grade`);
  previous=next;
 }
}

function makeOperations(map,seed=91,extra={}){
 const match=new Match('chatgpt','openclaw',mulberry32(seed),map.id,{
  mode:'cocs-coop',humanCount:1,botCount:0,timeLimit:900,cocsPolicy:()=>[],...extra,
 });
 assert.equal(match.arena.id,map.id,'Match must resolve the destination, never a fallback map');
 return match;
}

function pin(map,actor,p){
 Object.assign(actor,at(map,p.x,p.z),{vx:0,vy:0,vz:0,grounded:true});
}

test('the destination lattice collection contains both distinct registered theatres',()=>{
 assert.deepEqual(DESTINATION_LATTICE_MAPS.map(m=>m.id),['asterion-relay','monsoon-foundry']);
 assert.equal(Object.isFrozen(DESTINATION_LATTICE_MAPS),true);
 for(const map of DESTINATION_LATTICE_MAPS){
  assert.equal(getMap(map.id),map);
  assert.equal(map.collection,'destinations');
  assert.equal(arenaMeta(map).group,'outdoor');
  assert.equal(arenaMeta(map).scale,'warzone');
  assert.deepEqual(arenaMeta(map).play,map.arena.play);
  for(const mode of GAME_MODES.filter(m=>m.rules?.score==='cocs'))assert.ok(arenaSupportsMode(map.id,mode.id),mode.id);
 }
 assert.notEqual(DESTINATION_LATTICE_MAPS[0].destination.theme,DESTINATION_LATTICE_MAPS[1].destination.theme);
});

for(const map of DESTINATION_LATTICE_MAPS){
 test(`${map.id}: complete lattice doctrine and measured spacing/arrival clearance`,()=>{
  assert.deepEqual(validateMapSchema(map),[]);
  assert.deepEqual(validateLattice(map),[]);
  assert.ok(Object.isFrozen(map)&&Object.isFrozen(map.nodes)&&Object.isFrozen(map.lattice));
  assert.deepEqual(map.nodes.map(n=>n.archetype).sort(),['economy','economy','front','front','hq','hq','relay']);
  assert.equal(new Set(map.nodes.map(n=>n.label)).size,7);
  assert.ok(capturable(map).every(n=>n.r>=12));
  assert.equal(map.terminals.filter(t=>t.kind==='relay').length,1);
  assert.equal(map.terminals.filter(t=>t.kind==='vault').length,2);
  assert.deepEqual(map.lanes.map(l=>l.kind).sort(),['cqc','vehicle-road','zipline-flank']);
  assert.ok(map.playBounds.frontage<=240&&map.playBounds.laneSep<=80&&map.playBounds.maxNodeSpacing<=140);
  for(const [a,b] of map.lattice){
   const from=byId(map,a),to=byId(map,b);
   assert.ok(Math.hypot(from.x-to.x,from.z-to.z)<=map.playBounds.maxNodeSpacing,`${a}/${b}: measured node spacing`);
  }
  for(const depot of map.depots){
   const clearance=Math.min(...map.nodes.map(n=>Math.hypot(n.x-depot.x,n.z-depot.z)));
   assert.ok(clearance>=30,`${depot.id}: real node clearance`);
   assert.ok(Math.abs(clearance-depot.nodeDistanceMeters)<1e-6,`${depot.id}: accurate declared clearance`);
   assert.ok(depot.exits>=2);
  }
  for(const team of [0,1])assert.equal(map.depots.filter(d=>d.hq&&d.team===team).length,1);
  for(const device of map.traversal){
   assert.ok(device.arrival.r>=5&&device.arrival.seconds>=1&&device.approaches>=2,device.id);
   for(const n of capturable(map))assert.ok(Math.hypot(n.x-device.arrival.x,n.z-device.arrival.z)>n.r,
    `${device.id}: arrival outside ${n.id}'s capture radius`);
   for(const [x,z] of [...map.teamSpawns[0],...map.teamSpawns[1]])assert.ok(Math.hypot(x-device.arrival.x,z-device.arrival.z)>=15,
    `${device.id}: spawn separation`);
  }
 });

 test(`${map.id}: all authored and Operations runtime anchors connect bidirectionally on their real floor`,()=>{
  const graph=graphFor(map),state=cocsTemplate('cocs-coop',map,{});
  assert.ok(graph.nodes.length>0);
  const start=attachment(map,graph,byId(map,'hq-0'),'HQ root');
  const reverse=graph.nodes.map(()=>[]);
  graph.edges.forEach((edges,i)=>edges.forEach(j=>reverse[j].push(i)));
  const outbound=reached(graph.edges,start),inbound=reached(reverse,start);
  assert.equal(outbound.size,graph.nodes.length,'entire retained graph reachable from HQ');
  assert.equal(inbound.size,graph.nodes.length,'entire retained graph can return to HQ');
  const anchors=[...map.nodes,...map.terminals,...map.depots,...map.vehicles,
   ...Object.values(state.terminals.terminals),
   ...map.spawns.map(([x,z],i)=>({x,z,id:`spawn-${i}`})),
   ...[0,1].flatMap(team=>map.teamSpawns[team].map(([x,z],i)=>({x,z,id:`team-${team}-${i}`}))),
   ...map.pickups.map(([kind,x,z],i)=>({x,z,id:`${kind}-${i}`})),
   ...map.traversal.flatMap(d=>[d.from,d.to??d.target,d.arrival].map((p,i)=>({...p,id:`${d.id}-${i}`})))];
  for(const [i,p] of anchors.entries()){
   const index=attachment(map,graph,p,p.id??`anchor-${i}`);
   assert.ok(outbound.has(index)&&inbound.has(index),`${p.id??i}: HQ round trip`);
  }
  for(const d of map.traversal){
   for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,r=d.arrival.r-.65;
    const p={x:d.arrival.x+Math.cos(angle)*r,z:d.arrival.z+Math.sin(angle)*r};
    attachment(map,graph,p,`${d.id}: arrival apron ${i}`);
   }
  }
  // A point-sized depot check can miss a garage whose Puma exits are sealed.
  for(const d of map.depots)for(const side of [-1,1]){
   for(let step=0;step<=5;step++)supported(map,{x:d.x+side*step,z:d.z},`${d.id}: vehicle exit ${side}/${step}`,1.8);
   sampledWalk(map,d,{x:d.x+side*5,z:d.z},`${d.id}: exit ${side}`);
  }
 });

 test(`${map.id}: every service deck has sampled ground ascent and descent from both ends`,()=>{
  const graph=graphFor(map),decks=map.destination.serviceDecks;
  assert.ok(decks.length>=4);
  for(const d of decks){
   const top=supported(map,{x:d.x,z:d.z},`${d.id}: top`);
   for(const side of [-1,1]){
    const toe={x:d.x+side*(d.length/2+d.ramp),z:d.z};
    const shoulder={x:d.x+side*d.length/2,z:d.z};
    const low=supported(map,toe,`${d.id}: toe ${side}`);
    assert.ok(Math.abs(top.y-low.y-d.rise)<1e-6,`${d.id}: declared rise is real`);
    assert.ok(Math.abs(floorAt(shoulder.x,shoulder.z,map)-top.y)<1e-6,`${d.id}: flat roof shoulder`);
    attachment(map,graph,toe,`${d.id}: toe ${side}`);
    sampledWalk(map,toe,top,`${d.id}: ascent ${side}`);
    sampledWalk(map,top,toe,`${d.id}: descent ${side}`);
   }
   attachment(map,graph,top,`${d.id}: roof centre`);
  }
 });

 for(const rungId of COCS_RUNG_IDS)test(`${map.id}: ${rungId} retains authored frontier, live budget and endgame shape`,()=>{
  const rung=cocsRung(rungId),state=cocsTemplate('cocs',map,{rung:rungId});
  assert.equal(state.synthesized,false);
  assert.equal(state.rung,rungId);
  assert.deepEqual(state.nodes.map(n=>n.id),map.nodes.map(n=>n.id));
  assert.deepEqual(state.edges,map.lattice);
  assert.equal(state.zones.length,5);
  assert.equal(state.liveMin,rung.live.opening);
  assert.equal(state.liveMax,rung.live.max);
  assert.equal(state.endgameLive,rung.live.endgame);
  assert.deepEqual(map.destination.liveNodes,rung.live);
  assert.equal(state.liveNodeIds.length,3);
  assert.equal(state.dominanceCount,3);
  assert.equal(state.dominanceFastCount,4);
  for(const team of [0,1]){
   assert.equal(byId(state,`hq-${team}`).owner,team);
   assert.equal(capturableBy(state,`front-${team}`,team),true);
   assert.equal(capturableBy(state,'relay-0',team),false,'relay requires winning an adjacent gate');
  }
  byId(state,'front-0').owner=0;
  updateLiveNodes(state);
  assert.equal(capturableBy(state,'relay-0',0),true,'the authored gate unlocks the shared relay');
  assert.equal(connectedToHq(state,'front-0',0),true);
  enterEndgame(state);
  assert.deepEqual([...state.liveNodeIds].sort(),capturable(state).map(n=>n.id).sort());
  assert.ok(state.nodes.filter(n=>n.archetype==='hq').every(n=>!n.live),'HQ anchors remain outside capture budget');
 });

 test(`${map.id}: Operations interact banks and redeems a shard at the real HQ vault`,()=>{
  const match=makeOperations(map),state=match.objectiveState,actor=match.actors[0];
  assert.equal(state.synthesized,false);
  assert.equal(state.coopMode,true);
  const hq=byId(state,state.coop.siege.hqId),vault=state.terminals.terminals[`vault-${hq.id}`];
  assert.ok(vault&&hq.owner===0);
  supported(map,vault,'runtime HQ vault');
  // Seed only the carried reward; banking, edge debounce, spend and payout all
  // go through real Match.step input at the authored HQ, not a terminal mock.
  const source=state.terminals.terminals['deploy-relay-0'];
  source.shards[0]='carried';
  state.terminals.vault.cargo[actor.id]={actor:actor.id,team:0,source:source.id,deaths:actor.deaths??0};
  actor.team=0;actor.bot=null;
  const interact=held=>{
   pin(map,actor,hq);
   match.step(DT,{inputs:{[actor.id]:{interact:held}}});
  };
  interact(true);
  assert.equal(state.terminals.stats.vaultStores,1);
  assert.equal(state.terminals.vault.cargo[actor.id],undefined);
  assert.deepEqual(state.terminals.vault.byNode[hq.id][0],[source.id]);
  interact(true);
  assert.equal(state.terminals.stats.vaultPulls,0,'holding interact does not spend the banked shard');
  interact(false);
  const req=actor.req??0,spent=state.fluxSpent[0];
  interact(true);
  assert.equal(state.terminals.stats.vaultPulls,1);
  assert.equal(state.fluxSpent[0]-spent,TERMINAL_KINDS.VAULT.pullCost);
  assert.equal(actor.req-req,TERMINAL_KINDS.VAULT.pullReq);
  assert.deepEqual(state.terminals.vault.byNode[hq.id][0],[]);
  assert.equal(source.shards[0],'spent');
 });

 test(`${map.id}: Operations siege can damage and repair its authored HQ`,()=>{
  const match=makeOperations(map,92,{humanCount:2}),state=match.objectiveState,coop=state.coop;
  match.step(DT,{inputs:{}});
  Object.assign(coop,{wave:COOP_SIEGE.waveArm,initialized:true,phase:'relax',waveTicks:10,waveTimerTicks:100000,pressure:0});
  for(const n of capturable(state))n.owner=1;
  updateLiveNodes(state);
  const [defender,attacker]=match.actors,hq=byId(state,coop.siege.hqId);
  // Keep the test independent of Director roster generation and bot combat.
  for(const actor of match.actors){actor.bot=null;pin(map,actor,byId(state,'hq-1'));}
  attacker.team=1;defender.team=0;
  pin(map,attacker,{x:hq.x+2,z:hq.z});
  supported(map,attacker,'siege attacker');
  const before=coop.siege.health;
  match.step(DT,{inputs:{}});
  assert.equal(coop.siege.armed,true);
  assert.ok(coop.siege.health<before,'enemy on the real HQ apron deals siege damage');
  const damaged=coop.siege.health;
  pin(map,attacker,byId(state,'hq-1'));
  pin(map,defender,hq);
  match.step(DT,{inputs:{}});
  assert.ok(coop.siege.health>damaged,'friendly on the same apron repairs the HQ');
 });

 test(`${map.id}: a bounded Operations opening replays deterministically`,()=>{
  const a=makeOperations(map,93,{botCount:1,aiSeats:true}),b=makeOperations(map,93,{botCount:1,aiSeats:true});
  // 90 fixed ticks, two small rosters: a replay smoke gate, not a wave/combat or
  // performance benchmark. Compare the actual snapshots at three checkpoints.
  for(let tick=1;tick<=90;tick++){
   a.step(DT,{inputs:{}});b.step(DT,{inputs:{}});
   assert.equal(a.over,false,`premature termination at tick ${tick}`);
   for(const actor of a.actors)assert.ok([actor.x,actor.y,actor.z].every(Number.isFinite),`actor ${actor.id} at tick ${tick}`);
   if(tick%30===0)assert.deepEqual(a.snapshot(),b.snapshot(),`same seed/input at tick ${tick}`);
  }
  assert.ok(a.time>0&&a.objectiveState.tick>=90,'the replay actually advanced the simulation');
  assert.equal(a.objectiveState.synthesized,false);
  assert.equal(a.objectiveState.coop.siege.hqId,'hq-0');
 });
}
