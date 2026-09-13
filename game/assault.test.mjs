import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSAULT_MODE_ID,assaultTemplate,assignAssaultTeams,assaultActiveSector,assaultSectors,stepAssault} from './assault.mjs';

const arena=(navNodes=[],blocks=[])=>({id:'proving',bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},blocks,navNodes});
const inField=s=>s.x>=-10&&s.x<=10&&s.z>=-10&&s.z<=10;
const captureActive=(state,team=0)=>{const active=assaultActiveSector(state);let result=null;for(let i=0;i<12&&active.owner===null;i++)result=stepAssault(state,[{team,health:100,x:active.x,z:active.z}],1,{});return result;};

test('mode id and team assignment are stable',()=>{
 assert.equal(ASSAULT_MODE_ID,'assault');
 const state=assaultTemplate(arena([{x:-5,z:0},{x:0,z:0},{x:5,z:0}]));
 assert.equal(state.attacker,null);assert.equal(state.defender,null);
 assert.equal(assignAssaultTeams(state),state);
 assert.equal(state.attacker,0);assert.equal(state.defender,1);
 state.attacker=4;assignAssaultTeams(state);assert.equal(state.attacker,4);
 assert.equal(assaultSectors(state),state.sectors);
});

test('capture only advances the active sector in order',()=>{
 const state=assaultTemplate(arena([{x:-5,z:0},{x:0,z:0},{x:5,z:0}]));
 assignAssaultTeams(state);
 const at=index=>({team:0,health:100,x:state.sectors[index].x,z:state.sectors[index].z});
 for(let i=0;i<10;i++)stepAssault(state,[at(0)],1,{});
 assert.equal(state.sectors[0].owner,0);assert.equal(state.active,1);
 for(let i=0;i<10;i++)stepAssault(state,[at(2)],1,{});
 assert.equal(state.sectors[2].owner,null);assert.equal(state.active,1);
 for(let i=0;i<10;i++)stepAssault(state,[at(1)],1,{});
 assert.equal(state.sectors[1].owner,0);assert.equal(state.active,2);
 assert.deepEqual(state.sectors.map(s=>s.owner),[0,0,null]);
});

test('a contested sector never captures',()=>{
 const state=assaultTemplate(arena([{x:-5,z:0},{x:0,z:0},{x:5,z:0}]));
 assignAssaultTeams(state);
 const sector=state.sectors[0];
 const pair=[{team:0,health:100,x:sector.x,z:sector.z},{team:1,health:100,x:sector.x,z:sector.z}];
 for(let i=0;i<30;i++)stepAssault(state,pair,1,{});
 assert.equal(sector.progress,0);assert.equal(sector.owner,null);assert.equal(state.active,0);
});

test('defenders recover progress and reclaim a captured sector',()=>{
 const state=assaultTemplate(arena([{x:-5,z:0},{x:0,z:0},{x:5,z:0}]));
 assignAssaultTeams(state);
 const sector=state.sectors[0],attacker={team:0,health:100,x:sector.x,z:sector.z},defender={team:1,health:100,x:sector.x,z:sector.z};
 for(let i=0;i<3;i++)stepAssault(state,[attacker],1,{});
 assert.ok(sector.progress>0&&sector.progress<100);
 const before=sector.progress;
 stepAssault(state,[defender],1,{});
 assert.ok(sector.progress<before);
 for(let i=0;i<20;i++)stepAssault(state,[defender],1,{});
 assert.equal(sector.progress,0);assert.equal(sector.owner,null);
 sector.owner=0;sector.progress=40;state.active=0;
 for(let i=0;i<6;i++)stepAssault(state,[defender],1,{});
 assert.equal(sector.owner,1);
});

test('breach only fires after the final sector falls',()=>{
 const state=assaultTemplate(arena([{x:-5,z:0},{x:0,z:0},{x:5,z:0}]));
 assignAssaultTeams(state);
 let result=captureActive(state);
 assert.equal(result.breached,false);assert.equal(state.active,1);assert.equal(state.winner,null);
 result=captureActive(state);
 assert.equal(result.breached,false);assert.equal(state.active,2);
 result=captureActive(state);
 assert.equal(result.breached,true);assert.equal(state.winner,0);assert.equal(state.active,3);
 assert.deepEqual(result.captured,['alpha','bravo','charlie']);
 assert.equal(assaultActiveSector(state),null);assert.equal(assaultSectors(state).length,3);
});

test('fixed-dt stepping is deterministic',()=>{
 const build=()=>{const state=assaultTemplate(arena([{x:-5,z:0},{x:0,z:0},{x:5,z:0}]));assignAssaultTeams(state);return state;};
 const a=build(),b=build(),actors=[{team:0,health:100,x:a.sectors[0].x,z:a.sectors[0].z}];
 for(let i=0;i<20;i++)assert.deepEqual(stepAssault(a,actors,.5,{}),stepAssault(b,actors,.5,{}));
 assert.deepEqual(a,b);assert.equal(a.active,1);
});

test('template derives exactly three safe sectors and ignores out-of-bounds points',()=>{
 const state=assaultTemplate(arena([{x:0,z:0},{x:100,z:0},{x:-6,z:-6},{x:6,z:-6},{x:-6,z:6},{x:6,z:6}],[{x:0,z:0,w:4,d:4,h:3}]));
 assert.equal(state.sectors.length,3);
 assert.deepEqual(state.sectors.map(s=>s.id),['alpha','bravo','charlie']);
 for(const sector of state.sectors){
  assert.ok(inField(sector));assert.ok(!(Math.abs(sector.x)<=2&&Math.abs(sector.z)<=2));
  assert.equal(sector.captureSeconds,6);assert.equal(sector.progress,0);assert.equal(sector.owner,null);
 }
});

test('template prefers ordered objectiveZones metadata',()=>{
 const zones=[{x:-8,z:0,radius:2,y:1},{x:0,z:0,radius:3,y:2},{x:8,z:0,radius:4,y:3}];
 const state=assaultTemplate({objectiveZones:zones});
 assert.deepEqual(state.sectors.map(s=>[s.x,s.z,s.radius,s.y]),[[-8,0,2,1],[0,0,3,2],[8,0,4,3]]);
 assert.deepEqual(state.sectors.map(s=>s.id),['alpha','bravo','charlie']);
});

test('authored assault zones are sanitized onto valid ground',()=>{
 const arena={bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20},blocks:[{x:0,z:0,w:8,d:8,h:5}],navNodes:[{x:12,z:10},{x:-12,z:-10}],spawns:[[-10,-10]],pickups:[],objectiveZones:[{x:NaN,z:NaN,y:1},{x:0,z:0,y:1},{x:15,z:0,y:1}]};
 const state=assaultTemplate(arena);
 for(const s of state.sectors){
  assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.z),'sector is finite');
  assert.ok(!(Math.abs(s.x)<4&&Math.abs(s.z)<4),'sector is not inside the block');
 }
});
