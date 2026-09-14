import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,floorAt} from './core.mjs';
import {GAME_MODES,normalizeConfig,DEFAULT_CONFIG} from './config.mjs';
import {CAMPAIGN_MISSIONS,missionFor} from './campaign-data.mjs';
import {ENEMY_TYPES,ENEMY_SPEED_VARIANCE,enemyById,applyEnemyFields,enemyBehavior} from './enemy-types.mjs';
import {initializeSinglePlayer,hordeWaveSize,isSinglePlayerMode,singlePlayerSnapshot,spawnGroup,SINGLEPLAYER_MODES} from './singleplayer.mjs';

const make=(mode,options={})=>new Match('chatgpt','openclaw',()=>.5,options.mapId||'convoy-line',{mode,botCount:3,humanCount:1,timeLimit:300,...options});
const firstEnemies=(match)=>match.actors.filter(actor=>actor.isNpc&&actor.team===1);
const clearGroup=(match,group)=>{for(const id of match.modeState.groups[group]||[]){const actor=match.actors.find(a=>a.id===id);if(actor){actor.health=0;actor.dead=1;}}};
const autoplay=(missionId,mapId,tint=1e12)=>{const match=make('campaign',{mission:missionId,mapId});match.actors[0].protection=tint;let guard=0;while(!match.over&&guard++<60*60*5){const state=match.modeState,step=state.steps[state.stepIndex];if(step){if(step.marker){match.actors[0].x=step.marker.x;match.actors[0].z=step.marker.z;}if(step.complete?.kind==='group-dead')clearGroup(match,step.complete.group);}match.step(1/60,{inputs:{}});}return match;};

test('single-player modes are registered and configuration keeps the mission',()=>{
 for(const id of SINGLEPLAYER_MODES)assert.ok(GAME_MODES.some(mode=>mode.id===id),id);
 assert.equal(isSinglePlayerMode('horde'),true);
 assert.equal(isSinglePlayerMode('deathmatch'),false);
 assert.equal(normalizeConfig({mode:'campaign',mission:'reactor-run'}).mission,'reactor-run');
 assert.equal(normalizeConfig({mode:'campaign',mission:'bogus'}).mission,CAMPAIGN_MISSIONS[0].id);
 assert.equal(normalizeConfig({mode:'horde'}).fragLimit,10);
 assert.equal(DEFAULT_CONFIG.mission,missionFor(DEFAULT_CONFIG.mission).id);
});

test('horde leaves a lone player with three lives and an empty battlefield',()=>{
 const match=make('horde',{fragLimit:3,mapId:'colosseum'});
 assert.equal(match.actors.length,1);
 assert.equal(match.config.botCount,0);
 assert.equal(match.modeState.waveTarget,3);
 assert.equal(match.modeState.lives,3);
 assert.deepEqual(match.objectiveState.zones,[]);
 assert.ok(match.actors[0].bot===null,'player is not a bot');
});

test('horde waves spawn fast fragile husks, not normal bots',()=>{
 assert.equal(hordeWaveSize(1),3);assert.ok(hordeWaveSize(8)>hordeWaveSize(2));
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});match.actors[0].protection=1e9;
 for(let i=0;i<600&&!match.over;i++)match.step(1/60,{inputs:{}});
 const enemies=firstEnemies(match);
 assert.ok(enemies.length>=3);
 assert.ok(enemies.every(actor=>actor.bot&&actor.isNpc&&actor.npcProfile),'enemies carry a profile');
 assert.ok(enemies.every(actor=>actor.maxHealth<=ENEMY_TYPES.brute.health),'enemies are far softer than bots');
 for(let wave=0;wave<40&&!match.over;wave++){for(let i=0;i<200&&!match.over;i++){for(const actor of firstEnemies(match))if(actor.health>0){actor.health=0;actor.dead=1;}match.step(1/60,{inputs:{}});}}
 assert.equal(match.over,true);
 assert.equal(match.snapshot().winner,0);
});

test('dead enemies never respawn',()=>{
 const match=make('horde',{fragLimit:5,mapId:'colosseum'});match.actors[0].protection=1e9;
 for(let i=0;i<600;i++)match.step(1/60,{inputs:{}});
 const target=firstEnemies(match)[0];target.health=0;target.dead=2;
 for(let i=0;i<10;i++)match.step(1/60,{inputs:{}});
 assert.ok(target.dead>1e8,'respawn timer stays pinned high');
 for(let i=0;i<300;i++)match.step(1/60,{inputs:{}});
 assert.equal(target.health,0,'dead enemy stays dead');
});

test('losing all lives ends the run on the hostile side',()=>{
 const match=make('horde',{fragLimit:10,mapId:'colosseum'});
 for(let i=0;i<600&&!match.over;i++)match.step(1/60,{inputs:{}});
 const enemy=firstEnemies(match)[0];
 for(let death=0;death<3&&!match.over;death++){const player=match.actors[0];player.protection=0;match.damage(player,1e6,enemy);for(let i=0;i<240&&!match.over;i++)match.step(1/60,{inputs:{}});}
 assert.equal(match.over,true);
 assert.equal(match.snapshot().winner,1);
 assert.equal(match.modeState.lives,0);
});

test('campaign starts the player at the authored point facing the mission direction',()=>{
 const match=make('campaign',{mission:'convoy-run',mapId:'convoy-line'});
 const start=missionFor('convoy-run').start,player=match.actors[0];
 assert.ok(Math.hypot(player.x-start.x,player.z-start.z)<3,`player near ${start.x},${start.z}`);
 assert.ok(Math.abs(Math.atan2(Math.sin(player.yaw-start.yaw),Math.cos(player.yaw-start.yaw)))<.2,'player faces east');
 assert.equal(match.modeState.steps.length,missionFor('convoy-run').steps.length);
 assert.equal(match.objectiveState.kind,'campaign');
});

test('the first campaign objective sets a waypoint and the next spawns themed enemies',()=>{
 const match=make('campaign',{mission:'convoy-run',mapId:'convoy-line'});
 for(let i=0;i<10;i++)match.step(1/60,{inputs:{}});
 assert.ok(match.waypoint,'first waypoint is live');
 assert.equal(match.waypoint.label,'DEPOT');
 assert.ok(match.modeState.storyLine,'opening story line played');
 const rally=match.modeState.steps[0].marker;match.actors[0].x=rally.x;match.actors[0].z=rally.z;
 for(let i=0;i<10;i++)match.step(1/60,{inputs:{}});
 const enemies=firstEnemies(match);
 assert.ok(enemies.length>0,'encounter deployed');
 assert.ok(enemies.some(actor=>actor.npcType==='husk'),'husks present');
 assert.ok(enemies.some(actor=>actor.npcType==='spitter'),'spitters present');
 assert.ok(enemies.every(actor=>actor.maxHealth<100),'low health pools');
 assert.equal(match.waypoint.label,'TENEMENTS');
});

test('convoy-run plays through every step to a win',()=>{
 const match=autoplay('convoy-run','convoy-line');
 const snap=match.snapshot().singleplayer;
 assert.equal(match.over,true);
 assert.equal(snap.winner,0);
 assert.equal(snap.phase,'won');
 assert.equal(snap.steps.filter(step=>step.done).length,snap.steps.length);
 assert.ok(snap.steps.length>=5);
});

test('reactor-run ends with a Warden boss and a win',()=>{
 const match=autoplay('reactor-run','titan-valley');
 const snap=match.snapshot().singleplayer;
 assert.equal(snap.winner,0);
 assert.equal(snap.mission.id,'reactor-run');
 const warden=match.actors.find(actor=>actor.isBoss);
 assert.equal(warden.maxHealth,ENEMY_TYPES.warden.health);
});

test('single-player snapshot exposes objective steps, story and waypoint data',()=>{
 const match=make('campaign',{mission:'convoy-run',mapId:'convoy-line'});
 for(let i=0;i<10;i++)match.step(1/60,{inputs:{}});
 const snap=match.snapshot().singleplayer;
 assert.equal(snap.kind,'campaign');
 assert.ok(Array.isArray(snap.steps)&&snap.steps.length>0);
 assert.equal(snap.steps[0].active,true);
 assert.ok(snap.waypoint&&snap.waypoint.label);
 assert.ok(snap.story&&snap.story.speaker&&snap.story.text);
 assert.equal(snap.mission.total,CAMPAIGN_MISSIONS.length);
 assert.equal(singlePlayerSnapshot(null,match),null);
});

test('spawnGroup fields groups by type and tracks bosses',()=>{
 const match=make('campaign',{mission:'convoy-run',mapId:'convoy-line'});
 initializeSinglePlayer(match);
 const state=match.modeState;
 const ids=spawnGroup(match,state,{type:'brute',count:2,group:'pack',x:0,z:0},{team:1});
 assert.equal(ids.length,2);
 assert.deepEqual(state.groups.pack,ids);
 assert.ok(ids.every(id=>match.actors.find(a=>a.id===id).npcType==='brute'));
 spawnGroup(match,state,{type:'warden',count:1,x:0,z:0},{team:1});
 assert.ok(state.boss!=null&&match.actors.find(a=>a.id===state.boss).isBoss);
});

test('enemy fields build a fragile, differentiated enemy',()=>{
 const match=make('horde',{fragLimit:3,mapId:'colosseum'});
 initializeSinglePlayer(match);
 const actor=match.actor(99,'chatgpt','openclaw');
 applyEnemyFields(actor,'husk');
 assert.equal(actor.npcType,'husk');
 assert.equal(actor.npcProfile.health,30);
 assert.ok(actor.npcProfile.health<100);
 assert.equal(actor.meleeDamage,ENEMY_TYPES.husk.meleeDamage);
 actor.bot={route:[],think:0,target:-1,memory:0,reaction:0,stuck:0,last:{x:0,y:0,z:0},state:'roam',patrol:0,flank:null,flankDone:false,recover:0,suppressed:0,threat:-1,standoff:null,strafeReverse:-99};
 const behavior=enemyBehavior(actor);
 assert.equal(behavior.meleeOnly,true);
 assert.ok(behavior.meleeRange>2);
 assert.equal(enemyById('missing').id,'spitter');
});

test('enemy deploys vary speed within a class and carry reduced firepower',()=>{
 let n=987654321;const random=()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);
 const match=new Match('chatgpt','openclaw',random,'convoy-line',{mode:'campaign',botCount:0,humanCount:1,mission:'convoy-run'});
 const state=match.modeState;
 spawnGroup(match,state,{type:'spitter',count:8},{team:1});
 const enemies=match.actors.filter(actor=>actor.isNpc);
 const speeds=enemies.map(actor=>actor.npcProfile.speedMult);
 assert.ok(speeds.length===8);
 assert.ok(new Set(speeds.map(speed=>speed.toFixed(4))).size>1,'speeds are not uniform');
 const base=ENEMY_TYPES.spitter.speedMult;
 assert.ok(speeds.every(speed=>speed>base*(1-ENEMY_SPEED_VARIANCE)-1e-9&&speed<base*(1+ENEMY_SPEED_VARIANCE)+1e-9),'speed stays inside the variance band');
 for(const actor of enemies){
  assert.ok(actor.gearDamage<1,'enemy hits softer than a normal actor');
  assert.ok(Math.abs(actor.gearDamage-actor.npcProfile.damageMult)<1e-9,'damage multiplier reaches the weapon pipeline');
 }
 assert.ok(ENEMY_TYPES.husk.damageMult<.5&&ENEMY_TYPES.spitter.damageMult<.5,'swarm classes are heavily damped');
 assert.ok(ENEMY_TYPES.brute.damageMult<1&&ENEMY_TYPES.warden.damageMult<=1,'heavies are damped too');
});

test('area confinement keeps zoned NPCs inside their leash when the player is far',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const state=match.modeState,zone={x:0,z:0,r:8,leash:12,kind:'spawn'};
 const player=match.actors[0];
 player.x=-42;player.z=-42;player.y=floorAt(-42,-42,match.arena)??0;player.protection=1e9;
 const ids=spawnGroup(match,state,{type:'spitter',count:6,zone},{team:1});
 assert.equal(ids.length,6);
 for(let i=0;i<1800;i++)match.step(1/60,{inputs:{}});
 for(const id of ids){
  const actor=match.actors.find(candidate=>candidate.id===id);
  if(!actor||actor.health<=0)continue;
  const distance=Math.hypot(actor.x-zone.x,actor.z-zone.z);
  assert.ok(distance<=zone.leash+1,`enemy ${id} strayed ${distance.toFixed(2)}m (leash ${zone.leash})`);
 }
});

test('hard patrol zones loop NPCs inside their radius instead of wandering the map',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const zone={x:0,z:0,r:8,leash:12,kind:'patrol'};
 const ids=spawnGroup(match,match.modeState,{type:'husk',count:4,zone},{team:1});
 const seen=new Set();
 for(let i=0;i<1800;i++){
  match.step(1/60,{inputs:{}});
  if(i%120===0)for(const id of ids){const actor=match.actors.find(candidate=>candidate.id===id);if(actor&&actor.health>0)seen.add(`${actor.x.toFixed(1)}|${actor.z.toFixed(1)}`);}
 }
 for(const id of ids){
  const actor=match.actors.find(candidate=>candidate.id===id);
  if(!actor||actor.health<=0)continue;
  assert.ok(Math.hypot(actor.x-zone.x,actor.z-zone.z)<=zone.leash+1,`patrol ${id} held its leash`);
 }
 assert.ok(seen.size>1,'patrollers keep moving instead of freezing in place');
});

test('group spawns de-clump onto distinct in-radius floor points',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const zone={x:0,z:0,r:8,leash:12,kind:'hold'};
 const ids=spawnGroup(match,match.modeState,{type:'husk',count:8,zone},{team:1});
 const actors=ids.map(id=>match.actors.find(candidate=>candidate.id===id));
 const keys=new Set(actors.map(actor=>`${actor.x.toFixed(3)}|${actor.z.toFixed(3)}`));
 assert.equal(keys.size,8,'every member occupies a distinct position');
 for(const actor of actors){
  assert.ok(Math.hypot(actor.x-zone.x,actor.z-zone.z)<=zone.r+1e-6,'member stays inside the spawn radius');
  assert.notEqual(floorAt(actor.x,actor.z,match.arena),null,'member snaps to the floor');
 }
 for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++)assert.ok(Math.hypot(actors[i].x-actors[j].x,actors[i].z-actors[j].z)>1,'members are pairwise separated');
});

test('campaign scripts fire a timed reinforcement and bark exactly once',()=>{
 const match=make('campaign',{mission:'convoy-run',mapId:'convoy-line'});
 const state=match.modeState;
 match.actors[0].protection=1e9;
 const event=state.script.find(candidate=>Number.isFinite(candidate.at)&&candidate.bark&&candidate.spawn);
 assert.ok(event,'convoy-run authors a timed, barked reinforcement');
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 const before=match.actors.length;
 const barkCount=()=>captured.filter(entry=>entry.type==='npc-bark'&&entry.text===event.bark.text).length;
 for(let i=0;i<Math.ceil((event.at+2)*60);i++)match.step(1/60,{inputs:{}});
 assert.equal(barkCount(),1,'the timed bark fires once');
 assert.ok(match.actors.length>before,'the timed reinforcement deployed actors');
 assert.equal(state.fired[event.id],true,'the script event is marked fired');
 const actorsAfter=match.actors.length;
 for(let i=0;i<180;i++)match.step(1/60,{inputs:{}});
 assert.equal(barkCount(),1,'the one-shot script event never fires twice');
 assert.equal(match.actors.length,actorsAfter,'no duplicate reinforcements');
});
