import test from 'node:test';
import assert from 'node:assert/strict';
import {latticeCoach,latticeOrderKey,latticeBriefing,latticeTargetModel} from './lattice-guide.mjs';
import {capturableBy,cocsTemplate,enterEndgame} from './cocs.mjs';
import {cocsTargetableNodes} from './cocs-orders.mjs';
import {localBoardCards} from './lattice-board.mjs';
import {getMap} from './maps.mjs';

const map={nodes:[{id:'hq-0',x:0,z:0,r:4,archetype:'hq'},{id:'front-0',x:20,z:0,r:6,archetype:'front'},{id:'relay-0',x:40,z:0,r:6,archetype:'relay'}],lattice:[['hq-0','front-0'],['front-0','relay-0']]};
const fixture=()=>({config:{mode:'cocs'},cocs:{nodes:map.nodes.map(n=>({...n,owner:n.archetype==='hq'?0:null,live:n.archetype!=='hq'}))}});
const player={id:0,team:0,x:39,z:0,health:100};

test('coach never recommends a nearer node behind an uncaptured link',()=>{
 const hud=fixture();
 const initial=JSON.stringify(hud);
 const coach=latticeCoach(hud,player,map);
 assert.equal(coach.targetId,'front-0');
 assert.equal(coach.nodes.find(n=>n.id==='relay-0').legal,false);
 assert.equal(JSON.stringify(hud),initial,'guidance does not mutate authoritative state');
 hud.cocs.nodes[1].owner=0;
 const advanced=latticeCoach(hud,player,map);
 assert.equal(advanced.targetId,'relay-0');
 assert.match(advanced.detail,/automatic/);
});

test('coach explains contested capture and prioritizes a threatened supply link',()=>{
 const hud=fixture();hud.cocs.nodes[1].owner=0;hud.cocs.nodes[1].contested=true;
 const coach=latticeCoach(hud,{...player,x:0},map);
 assert.equal(coach.targetId,'front-0');assert.match(coach.detail,/Clear the enemies/);
 assert.equal(latticeCoach({...hud,config:{mode:'deathmatch'}},player,map),null);
 assert.match(latticeCoach(hud,{...player,health:0},map).title,/RESPAWN/);
});

test('order shortcuts preserve chat and weapon keys unless a LATTICE order is armed',()=>{
 for(const mode of ['cocs','cocs-coop']){
  assert.deepEqual(latticeOrderKey({mode,action:'commandGo'}),{type:'arm',verb:'GO'});
  assert.deepEqual(latticeOrderKey({mode,armed:true,code:'Digit3'}),{type:'pick',index:3});
  assert.deepEqual(latticeOrderKey({mode,armed:true,code:'Enter'}),{type:'issue'});
  assert.deepEqual(latticeOrderKey({mode,armed:true,code:'Escape'}),{type:'cancel'});
  for(const code of ['Enter','Digit3','Escape'])assert.equal(latticeOrderKey({mode,code}),null);
 }
 for(const options of [{mode:'deathmatch'},{mode:'cocs',spectate:true},{mode:'cocs',repeat:true}])assert.equal(latticeOrderKey({...options,action:'commandAttack'}),null);
});

test('briefings honor remaps and distinguish automatic capture from interact actions',()=>{
 const guide=latticeBriefing('cocs-coop',{interact:'KeyJ',mobility:'KeyL',commandScan:'KeyZ'});
 assert.match(guide.steps[0].detail,/automatic/);
 assert.match(guide.steps[2].detail,/Z SCAN/);
 assert.match(guide.steps[3].detail,/press J/);
 assert.match(guide.movement,/L uses/);
 assert.match(guide.objective,/five Director waves/);
 assert.equal(latticeBriefing('deathmatch'),null);
});

// ---------------------------------------------------------------------------
// F04 — one shared legal-target model, hysteresis and the siege override.
// ---------------------------------------------------------------------------
const labelledMap={
 nodes:[
  {id:'hq-0',x:0,z:0,r:4,archetype:'hq',label:'WEST HQ'},
  {id:'front-0',x:-30,z:0,r:6,archetype:'front',label:'WEST BASTION'},
  {id:'econ-n',x:30,z:0,r:6,archetype:'front',label:'NORTH SIPHON'},
  {id:'front-1',x:60,z:0,r:6,archetype:'front',label:'EAST BASTION'},
 ],
 lattice:[['hq-0','front-0'],['hq-0','econ-n'],['econ-n','front-1']],
 bounds:{minX:-80,maxX:80,minZ:-40,maxZ:40},
};
const liveNodes=(overrides={})=>({
 tick:300, coop:true,
 nodes:labelledMap.nodes.map(node=>({...node,owner:node.archetype==='hq'?0:null,live:node.archetype==='hq'?false:true,progress:[0,0],contested:false})),
 ...overrides,
});
const hudFor=snapshot=>({config:{mode:'cocs-coop'},cocs:snapshot});
const siege=(extra={})=>({director:{siege:{armed:true,hqId:'hq-0',health:60,max:100,attackers:3,defenders:1,...extra}}});
const coopPlayer=(x=0)=>({id:0,team:0,x,z:0,health:100});

test('the shared model only calls a neutral node legal when it is adjacent to owned ground',()=>{
 const model=latticeTargetModel(liveNodes(),labelledMap,coopPlayer(0));
 const front=model.byId['front-0'],far=model.byId['front-1'];
 assert.equal(front.legal,true,'front-0 links straight to the owned HQ');
 assert.equal(front.attackable,true);
 assert.equal(front.adjacent,true);
 assert.equal(front.supply,'LINKED');
 assert.equal(far.legal,false,'front-1 is only linked to a neutral node, not owned ground');
 assert.equal(model.ranked.some(node=>node.id==='front-1'),false);
 assert.deepEqual(model.ranked.map(node=>node.id).sort(),['econ-n','front-0']);
});

test('small positional changes hold advice; an urgent event supersedes it',()=>{
 const snapshot=liveNodes();
 const first=latticeCoach(hudFor(snapshot),coopPlayer(-5),labelledMap);
 assert.equal(first.targetId,'front-0');
 assert.equal(first.advice.held,false);
 // Without hysteresis the distance tiebreak flips to econ-n on the east side.
 const east=latticeCoach(hudFor(snapshot),coopPlayer(5),labelledMap);
 assert.equal(east.targetId,'econ-n');
 const held=latticeCoach(hudFor(snapshot),coopPlayer(5),labelledMap,{previous:first});
 assert.equal(held.targetId,'front-0','a small positional change must not oscillate the advice');
 assert.equal(held.advice.held,true);
 assert.equal(held.advice.urgent,false);
 // An enemy starting a capture on our node is an urgent event and supersedes.
 const threatened=snapshot.nodes.map(node=>node.id==='hq-0'?{...node,owner:0}:node);
 const contested=liveNodes({nodes:threatened.map(node=>node.id==='front-0'?{...node,owner:0,contested:true}:node)});
 const urgent=latticeCoach(hudFor(contested),coopPlayer(5),labelledMap,{previous:first});
 assert.equal(urgent.targetId,'front-0','the contested hold is the new urgent target');
 assert.equal(urgent.advice.urgent,true);
 // Once a held capture target is ours, the old capture advice is invalid.
 const captured=liveNodes({nodes:threatened.map(node=>node.id==='front-0'?{...node,owner:0}:node)});
 const advanced=latticeCoach(hudFor(captured),coopPlayer(5),labelledMap,{previous:first});
 assert.equal(advanced.targetId,'econ-n','a completed capture releases the held target');
 assert.equal(advanced.advice.held,false);
});

test('an Operations HQ siege overrides optional forward pushes and defers them',()=>{
 const snapshot=liveNodes(siege());
 const model=latticeTargetModel(snapshot,labelledMap,coopPlayer(0));
 assert.equal(model.siege.active,true);
 assert.equal(model.siege.nodeId,'hq-0');
 assert.equal(model.shortlist[0].id,'hq-0','the siege defence leads the shortlist');
 assert.equal(model.byId['front-0'].deferred,true,'forward pushes are marked optional');
 const coach=latticeCoach(hudFor(snapshot),coopPlayer(5),labelledMap,{previous:latticeCoach(hudFor(liveNodes()),coopPlayer(5),labelledMap)});
 assert.equal(coach.targetId,'hq-0','the siege supersedes a held forward push');
 assert.match(coach.title,/DEFEND WEST HQ/);
 assert.match(coach.detail,/forward pushes can wait/);
 assert.equal(coach.advice.kind,'siege');
 assert.equal(coach.advice.urgent,true);
 const lifted=latticeCoach(hudFor(liveNodes()),coopPlayer(5),labelledMap,{previous:coach});
 assert.equal(lifted.targetId,'econ-n','a lifted siege returns the field advice');
});

test('a capture staging from a cut-off owned node ranks below a linked route',()=>{
 // front-1 is enemy-held and only retakeable through front-0, which no longer
 // traces a supply line back to the HQ; econ-n hangs directly off the HQ.
 const graph={nodes:[
  {id:'hq-0',x:0,z:0,r:4,archetype:'hq',label:'WEST HQ'},
  {id:'front-0',x:-20,z:0,r:6,archetype:'front',label:'WEST BASTION'},
  {id:'front-1',x:-40,z:0,r:6,archetype:'front',label:'EAST BASTION'},
  {id:'econ-n',x:20,z:0,r:6,archetype:'economy',label:'NORTH SIPHON'},
 ],lattice:[['hq-0','econ-n'],['hq-0','front-0'],['front-0','front-1']]};
 const snapshot={tick:300,nodes:graph.nodes.map(node=>({...node,owner:node.id==='front-0'||node.id==='hq-0'?0:node.id==='front-1'?1:null,live:true}))};
 // CUT front-0 so the owned node (and the retake staged through it) loses its line home.
 const model=latticeTargetModel(snapshot,graph,coopPlayer(18),{cuts:['front-0']});
 assert.equal(model.byId['front-0'].connected,false);
 assert.equal(model.byId['front-0'].supply,'CUT OFF');
 assert.equal(model.byId['front-1'].connected,false,'the retake staging through a cut node is not linked');
 assert.equal(model.byId['econ-n'].legal,true);
 assert.equal(model.byId['econ-n'].connected,true);
 assert.equal(model.ranked[0].id,'econ-n','a linked route outranks a cut-off push');
 const coach=latticeCoach({config:{mode:'cocs'},cocs:snapshot},coopPlayer(18),graph,{cuts:['front-0']});
 assert.match(coach.title,/NORTH SIPHON/);
 assert.doesNotMatch(coach.title,/front-/i);
});

test('a node without a navigation route is never recommended',()=>{
 const snapshot=liveNodes();
 const model=latticeTargetModel(snapshot,labelledMap,coopPlayer(0),{route:point=>point.x>0?null:42});
 assert.equal(model.routeSource,'navigation');
 assert.equal(model.byId['econ-n'].legal,true,'adjacency alone does not certify a ground route');
 assert.equal(model.byId['econ-n'].reachable,false,'no navigation route to the north siphon');
 assert.deepEqual(model.ranked.map(node=>node.id),['front-0']);
 const coach=latticeCoach(hudFor(snapshot),coopPlayer(0),labelledMap,{route:point=>point.x>0?null:42});
 assert.equal(coach.targetId,'front-0','only the routed node is suggested');
});

// ---------------------------------------------------------------------------
// WP1.2 — production navigation, team-visible cuts and ARRAY endgame parity.
// ---------------------------------------------------------------------------

// The authored production shape: `navNodes` with no prebuilt `nav`/`edges`,
// exactly like every `getMap()` result. On this flat arena `navigation()` can
// certify a ground route to the west bastion while the off-grid node at (40,40)
// has no nav node inside the resolver's 5 m snap radius.
const routeMap={
 id:'route-proof',name:'Route Proof',nextGen:true,
 bounds:{minX:-40,maxX:40,minZ:-40,maxZ:40},
 blocks:[],spawns:[[-30,0]],pickups:[],
 navNodes:[{x:-30,z:0},{x:-18,z:0},{x:18,z:0},{x:30,z:0}],
 nodes:[
  {id:'hq-0',x:-30,z:0,r:5,archetype:'hq',label:'WEST HQ'},
  {id:'front-0',x:-18,z:0,r:6,archetype:'front',label:'WEST BASTION'},
  {id:'front-1',x:18,z:0,r:6,archetype:'front',label:'EAST BASTION'},
  {id:'front-2',x:40,z:40,r:6,archetype:'front',label:'OFF-GRID BASTION'},
 ],
 lattice:[['hq-0','front-0'],['front-0','front-1'],['front-1','front-2']],
};
const routeSnapshot=()=>({tick:300,nodes:[
 {id:'hq-0',owner:0,archetype:'hq',live:false,progress:[0,0]},
 {id:'front-0',owner:null,archetype:'front',live:true,progress:[0,0]},
 {id:'front-1',owner:0,archetype:'front',live:true,progress:[0,0]},
 {id:'front-2',owner:null,archetype:'front',live:true,progress:[0,0]},
]});
const routePlayer={id:0,team:0,x:-30,z:0,health:100};

test('a production-shape map routes from navNodes and drops unreachable targets',()=>{
 const model=latticeTargetModel(routeSnapshot(),routeMap,routePlayer);
 assert.equal(model.routeSource,'navigation','authored navNodes resolve a real route context');
 const near=model.byId['front-0'],far=model.byId['front-2'];
 assert.equal(near.legal,true);
 assert.equal(near.reachable,true);
 assert.ok(Number.isFinite(near.routeCost),'the ground route cost comes from the navigation graph');
 assert.equal(far.legal,true,'adjacency alone still certifies topology');
 assert.equal(far.reachable,false,'the off-grid node has no navigation node within snap range');
 assert.equal(model.ranked.some(node=>node.id==='front-2'),false,'ranked advice never offers an unreachable target');
 const board={nodes:[]};
 assert.deepEqual(cocsTargetableNodes(board,'ATTACK',{model,map:routeMap}).map(node=>node.id),['front-0']);
 const hold=cocsTargetableNodes(board,'HOLD',{model,map:routeMap});
 assert.deepEqual(hold.map(node=>node.id).filter(id=>id!=='hq-0').sort(),['front-0','front-1']);
 assert.equal(hold.some(node=>node.id==='front-2'),false,'unreachable targets are omitted for HOLD too');
 const scan=cocsTargetableNodes(board,'SCAN',{model,map:routeMap});
 assert.ok(scan.some(node=>node.id==='front-2'),'SCAN keeps its authored ground-route exemption');
 // Coach and board read the same model: neither offers the unreachable node.
 const coach=latticeCoach({config:{mode:'cocs'},cocs:routeSnapshot()},routePlayer,routeMap);
 assert.equal(coach.targetId,'front-0');
 assert.doesNotMatch(coach.title,/OFF-GRID/);
 const cards=localBoardCards({nodes:[],live:[],front:null},routeSnapshot(),routePlayer,{model});
 assert.ok(cards.some(card=>card.id==='local-node-front-0'),'the board offers the routed capture');
 assert.equal(cards.some(card=>card.id==='local-node-front-2'),false,'the board never offers an unreachable target');
});

test('the live Match navigation graph is accepted ahead of the map-derived graph',()=>{
 // A deliberately broken map-derived context must not be consulted when the
 // caller hands over the Match graph the page already built.
 const model=latticeTargetModel(routeSnapshot(),routeMap,routePlayer,{nav:[{x:-30,y:0,z:0},{x:-18,y:0,z:0}],navEdges:[[1],[0]]});
 assert.equal(model.routeSource,'navigation');
 assert.equal(model.byId['front-0'].reachable,true);
 assert.equal(model.byId['front-1'].reachable,false,'an explicit route context overrides the authored graph');
});

test('the registered Lattice Foundry map routes from its authored navNodes',()=>{
 const production=getMap('lattice-slice');
 const snapshot={tick:1,nodes:production.nodes.map(node=>({
  id:node.id,archetype:node.archetype,
  owner:node.id==='hq-0'?0:node.id==='hq-1'?1:null,
  live:node.archetype!=='hq',progress:[0,0],
 }))};
 const model=latticeTargetModel(snapshot,production,{id:0,team:0,x:-116,z:0,health:100});
 assert.equal(model.routeSource,'navigation','the real map resolves the production navigation graph');
 const front=model.byId['front-0'];
 assert.equal(front.legal,true);
 assert.equal(front.reachable,true);
 assert.ok(Number.isFinite(front.routeCost)&&front.routeCost>0,'the route cost is a real path distance');
 assert.deepEqual(model.ranked.map(node=>node.id),['front-0']);
});

test('team-visible cuts change supply and ranking but never capture legality',()=>{
 const cutMap={
  id:'cut-proof',bounds:{minX:-40,maxX:40,minZ:-40,maxZ:40},
  nodes:[
   {id:'hq-0',x:-30,z:0,r:5,archetype:'hq',label:'WEST HQ'},
   {id:'front-0',x:-10,z:0,r:6,archetype:'front',label:'WEST BASTION'},
   {id:'front-1',x:10,z:0,r:6,archetype:'front',label:'EAST BASTION'},
   {id:'econ-n',x:-30,z:-20,r:6,archetype:'economy',label:'NORTH SIPHON'},
  ],
  lattice:[['hq-0','front-0'],['front-0','front-1'],['hq-0','econ-n']],
 };
 const cutSnapshot=cuts=>({tick:300,nodes:[
  {id:'hq-0',owner:0,archetype:'hq',live:false,progress:[0,0]},
  {id:'front-0',owner:0,archetype:'front',live:true,progress:[0,0]},
  {id:'front-1',owner:1,archetype:'front',live:true,progress:[0,0]},
  {id:'econ-n',owner:null,archetype:'economy',live:true,progress:[0,0]},
 ],intel:{0:{cutNodes:cuts},1:{cutNodes:[]}}});
 const player={id:0,team:0,x:-30,z:-20,health:100};
 const linked=latticeTargetModel(cutSnapshot([]),cutMap,player);
 const cut=latticeTargetModel(cutSnapshot(['front-0']),cutMap,player);
 assert.equal(linked.byId['front-0'].supply,'LINKED');
 assert.equal(cut.byId['front-0'].supply,'CUT OFF','a cut node stops paying');
 assert.equal(cut.byId['front-0'].connected,false);
 assert.equal(cut.byId['front-1'].connected,false,'a retake staged through a cut node loses its line home');
 assert.equal(cut.byId['front-1'].supply,'CUT OFF');
 assert.equal(cut.byId['econ-n'].supply,'LINKED','the untouched siphon stays linked');
 for(const id of ['front-0','front-1','econ-n']){
  assert.equal(cut.byId[id].legal,linked.byId[id].legal,`${id} legality is cut-independent`);
  assert.equal(cut.byId[id].attackable,linked.byId[id].attackable,`${id} capture legality is cut-independent`);
 }
 assert.equal(linked.ranked[0].id,'front-1','the linked retake leads');
 assert.equal(cut.ranked[0].id,'econ-n','a cut-off push ranks below the linked siphon');
 // The same team-visible state may arrive as an explicit local/co-op list.
 const explicit=latticeTargetModel(cutSnapshot([]),cutMap,player,{cuts:['front-0']});
 assert.equal(explicit.byId['front-0'].supply,'CUT OFF');
});

test('ARRAY capture legality matches capturableBy before and during the endgame',()=>{
 const arrayMap={
  id:'array-proof',bounds:{minX:-40,maxX:40,minZ:-30,maxZ:30},
  blocks:[],spawns:[[-24,0]],pickups:[],navNodes:[],
  nodes:[
   {id:'hq-0',x:-24,z:0,r:5,archetype:'hq'},
   {id:'front-0',x:0,z:0,r:6,archetype:'front'},
   {id:'front-1',x:20,z:0,r:6,archetype:'front'},
   {id:'front-2',x:0,z:20,r:6,archetype:'front'},
   {id:'array-e',x:36,z:0,r:4,archetype:'array'},
  ],
  lattice:[['hq-0','front-0'],['front-0','front-1'],['front-0','front-2'],['front-0','array-e']],
 };
 const state=cocsTemplate('cocs',arrayMap,{});
 state.nodes.find(node=>node.id==='front-0').owner=0;
 state.nodes.find(node=>node.id==='front-2').live=false;
 const snapshot=()=>({cocs:{tick:0,nodes:state.nodes.map(node=>({
  id:node.id,x:node.x,z:node.z,archetype:node.archetype,owner:node.owner,
  live:node.live===true,progress:[Number(node.progress?.[0])||0,Number(node.progress?.[1])||0],
  contested:node.contested===true,
 }))}});
 const options=()=>({adjacency:state.adjacency,endgame:state.endgame});
 const player={id:0,team:0,x:-24,z:0,health:100};
 const before=latticeTargetModel(snapshot(),arrayMap,player,options());
 assert.equal(before.byId['array-e'].legal,false,'ARRAY anchors stay closed before the endgame');
 assert.equal(before.byId['array-e'].attackable,false);
 assert.equal(capturableBy(state,'array-e',0),false);
 for(const node of before.nodes)if(!node.mine)assert.equal(node.attackable,capturableBy(state,node.id,0),`${node.id} pre-endgame parity`);
 enterEndgame(state);
 const after=latticeTargetModel(snapshot(),arrayMap,player,options());
 assert.equal(after.byId['array-e'].legal,true,'the endgame opens the ARRAY anchor');
 assert.equal(after.byId['array-e'].attackable,true);
 for(const node of after.nodes)if(!node.mine)assert.equal(node.attackable,capturableBy(state,node.id,0),`${node.id} endgame parity`);
});
