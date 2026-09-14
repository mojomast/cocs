import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,floorAt} from './core.mjs';
import {GAME_MODES,DIFFICULTIES,normalizeConfig,DEFAULT_CONFIG} from './config.mjs';
import {CAMPAIGN_MISSIONS,missionFor} from './campaign-data.mjs';
import {ENEMY_TYPES,ENEMY_SPEED_VARIANCE,enemyById,applyEnemyFields,enemyBehavior} from './enemy-types.mjs';
import {initializeSinglePlayer,hordeWaveSize,hordeWaveComposition,hordeWaveModifier,hordeWavePlan,HORDE_WAVE_MODIFIERS,HORDE_UPGRADES,HORDE_TYPES,hordeUpgradeChoices,resupplyHorde,offerHordeUpgrade,selectHordeUpgrade,resumeSinglePlayer,applyCampaignCheckpoint,isSinglePlayerMode,singlePlayerSnapshot,spawnGroup,SINGLEPLAYER_MODES} from './singleplayer.mjs';

const make=(mode,options={})=>new Match('chatgpt','openclaw',()=>.5,options.mapId||'convoy-line',{mode,botCount:3,humanCount:1,timeLimit:300,...options});
const firstEnemies=(match)=>match.actors.filter(actor=>actor.isNpc&&actor.team===1);
const clearGroup=(match,group)=>{for(const id of match.modeState.groups[group]||[]){const actor=match.actors.find(a=>a.id===id);if(actor){actor.health=0;actor.dead=1;}}};
const autoplay=(missionId,mapId,tint=1e12,difficulty='easy')=>{const match=make('campaign',{mission:missionId,mapId,difficulty});match.actors[0].protection=tint;let guard=0;while(!match.over&&guard++<60*60*5){const state=match.modeState,step=state.steps[state.stepIndex];if(step){if(step.marker){match.actors[0].x=step.marker.x;match.actors[0].z=step.marker.z;}if(step.complete?.kind==='group-dead')clearGroup(match,step.complete.group);}match.step(1/60,{inputs:{}});}return match;};

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

test('horde clears resupply the player and offer deterministic upgrades',()=>{
 const match=make('horde',{fragLimit:10,mapId:'colosseum'});
 const state=match.modeState,player=match.actors[0];
 player.health=12;player.armor=0;player.ammo[0]=0;
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 resupplyHorde(match,state);
 assert.equal(player.health,player.maxHealth,'health is restored');
 assert.ok(player.armor>=100,'armor is restored');
 assert.ok(player.ammo[0]>0,'the current weapon is resupplied');
 assert.ok(captured.some(entry=>entry.type==='horde-resupply'));
 const choices=offerHordeUpgrade(match,state);
 assert.equal(choices.length,3);
 assert.equal(new Set(choices).size,3,'three distinct choices');
 assert.ok(choices.every(id=>HORDE_UPGRADES.some(upgrade=>upgrade.id===id)),'choices reuse the POWERUPS vocabulary');
 assert.deepEqual(hordeUpgradeChoices(0),hordeUpgradeChoices(0),'offer selection is deterministic');
 assert.ok(captured.some(entry=>entry.type==='horde-upgrade'));
 const snap=match.snapshot().singleplayer;
 assert.equal(snap.upgrades.length,3,'snapshot exposes the pending choices');
 assert.equal(snap.upgradeWave,state.wave);
 const pick=choices[0];
 assert.equal(selectHordeUpgrade(match,pick),true);
 assert.ok(player.powerups[pick]>0,'the chosen buff is active on the player');
 assert.equal(state.pendingUpgrade,null,'the pending choice is consumed');
 assert.equal(match.snapshot().singleplayer.upgradeSelected,pick);
 assert.equal(match.snapshot().singleplayer.upgradeCount,1);
 assert.equal(selectHordeUpgrade(match,pick),false,'a spent choice cannot be picked twice');
});

test('clearing the third horde wave offers an upgrade during intermission',()=>{
 const match=make('horde',{fragLimit:6,mapId:'colosseum'});
 match.actors[0].protection=1e9;
 let guard=0;
 while(!match.over&&!match.modeState.pendingUpgrade&&guard++<60*1200){
  for(const actor of firstEnemies(match)){actor.health=0;actor.dead=1;}
  match.step(1/60,{inputs:{}});
 }
 assert.ok(match.modeState.wave>=3,'reached the upgrade wave');
 assert.ok(match.modeState.pendingUpgrade,'a choose-1-of-3 upgrade is offered');
 assert.equal(match.snapshot().singleplayer.upgrades.length,3);
});

test('horde composition fields the new archetypes without breaking wave one',()=>{
 assert.equal(hordeWaveSize(1),3);
 assert.ok(hordeWaveSize(8)>hordeWaveSize(2),'waves keep growing');
 for(const id of ['mender','sapper','overseer'])assert.ok(HORDE_TYPES.includes(id),`${id} is in the horde table`);
 const late=hordeWaveComposition(6,'normal');
 assert.ok(late.mender+late.sapper+late.overseer>=1,'late waves field role archetypes');
});

test('campaign checkpoints persist and resume a retry from the saved step',()=>{
 const match=autoplay('convoy-run','convoy-line');
 const snap=match.snapshot().singleplayer;
 assert.ok(snap.checkpoint,'the run banks a checkpoint');
 assert.equal(snap.checkpoint.missionId,'convoy-run');
 assert.equal(snap.checkpoint.step,3,'the central-bridge checkpoint saves the next step');
 const retry=make('campaign',{mission:'convoy-run',mapId:'convoy-line'});
 retry.config.checkpoint=3;
 retry.initializeSinglePlayer();
 assert.equal(retry.modeState.stepIndex,3);
 const retrySnap=retry.snapshot().singleplayer;
 assert.equal(retrySnap.checkpoint.step,3);
 assert.equal(retrySnap.steps[2].done,true,'earlier steps are treated as complete');
 assert.equal(retrySnap.steps[3].active,true,'resume lands on the saved step');
 assert.equal(applyCampaignCheckpoint(retry,{missionId:'reactor-run',step:1}),false,'wrong mission is rejected');
 assert.equal(applyCampaignCheckpoint(retry,{missionId:'convoy-run',step:1}),true);
 assert.equal(retry.modeState.stepIndex,1);
});

test('boss phases surface as a named, pip-counted snapshot entry',()=>{
 const match=make('campaign',{mission:'reactor-run',mapId:'titan-valley'});
 const state=match.modeState;
 const ids=spawnGroup(match,state,{type:'warden',count:1,x:0,z:0},{team:1});
 const boss=match.actors.find(actor=>actor.id===ids[0]);
 boss.health=boss.maxHealth*.45;
 match.step(1/60,{inputs:{}});
 assert.equal(state.bossPhase,2,'the boss-hp script advances the phase');
 assert.equal(state.bossPhaseName,'OVERCLOCKED','the authored phase name is stored');
 const snap=match.snapshot().singleplayer;
 assert.equal(snap.bossPhase,2);
 assert.equal(snap.boss.phase,2);
 assert.equal(snap.boss.phaseName,'OVERCLOCKED');
 assert.equal(snap.bossPhaseName,'OVERCLOCKED');
 assert.ok(snap.boss.phases>=3,'the snapshot counts the authored phases');
 assert.equal(snap.bossPhaseTotal,snap.boss.phases);
 assert.equal(snap.boss.alive,true,'boss-dead win semantics are untouched');
});

test('sapper telegraphs its fuse, then detonates inside the blast radius',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const state=match.modeState,player=match.actors[0];
 player.protection=0;player.health=player.maxHealth;
 const ids=spawnGroup(match,state,{type:'sapper',count:1,zone:{x:player.x,z:player.z,r:2,leash:12,kind:'hold'}},{team:1});
 const sapper=match.actors.find(actor=>actor.id===ids[0]);
 sapper.x=player.x;sapper.z=player.z;sapper.y=player.y;
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 const before=player.health;
 for(let i=0;i<200;i++)match.step(1/60,{inputs:{}});
 assert.ok(captured.some(entry=>entry.type==='enemy-telegraph'&&entry.kind==='sapper'&&entry.duration>0),'the fuse is telegraphed');
 assert.ok(captured.some(entry=>entry.type==='enemy-detonate'&&entry.radius>0),'the sapper detonates');
 assert.ok(player.health<before,'the blast connects');
});

test('mender telegraphs and lands a heal pulse on nearby allies',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const state=match.modeState,player=match.actors[0];player.protection=1e9;
 const menderId=spawnGroup(match,state,{type:'mender',count:1},{team:1})[0];
 const allyId=spawnGroup(match,state,{type:'husk',count:1},{team:1})[0];
 const mender=match.actors.find(actor=>actor.id===menderId);
 const ally=match.actors.find(actor=>actor.id===allyId);
 ally.health=5;
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 for(let i=0;i<260;i++){ally.x=mender.x;ally.z=mender.z;ally.y=mender.y;match.step(1/60,{inputs:{}});}
 assert.ok(captured.some(entry=>entry.type==='enemy-telegraph'&&entry.kind==='mender'),'the heal is telegraphed');
 assert.ok(captured.some(entry=>entry.type==='mender-heal'&&entry.healed>0),'the pulse heals an ally');
 assert.ok(ally.health>5,'the ally is topped up');
});

test('overseer pulses its command aura on a cooldown',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const state=match.modeState;
 spawnGroup(match,state,{type:'overseer',count:1},{team:1});
 spawnGroup(match,state,{type:'husk',count:1},{team:1});
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 for(let i=0;i<400;i++)match.step(1/60,{inputs:{}});
 assert.ok(captured.some(entry=>entry.type==='enemy-telegraph'&&entry.kind==='overseer'),'the command shout is telegraphed');
 assert.ok(captured.some(entry=>entry.type==='overseer-aura'&&entry.radius>0),'the aura pulse fires');
});

test('mortar marks, telegraphs and lands an AoE on a stationary player',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const state=match.modeState,player=match.actors[0];
 state.phase='wave';state.wave=1;
 player.protection=0;player.health=player.maxHealth;
 const id=spawnGroup(match,state,{type:'mortar',count:1,x:player.x+16,z:player.z,zone:{x:player.x+16,z:player.z,r:4,leash:30,kind:'hold'}},{team:1})[0];
 const mortar=match.actors.find(a=>a.id===id);mortar.bot=null;
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 const before=player.health;
 for(let i=0;i<600;i++){mortar.x=player.x+16;mortar.z=player.z;mortar.y=player.y;mortar.health=mortar.maxHealth;match.step(1/60,{inputs:{}});}
 assert.ok(captured.some(e=>e.type==='enemy-telegraph'&&e.kind==='artillery'&&e.duration>0),'the shell is telegraphed');
 assert.ok(captured.some(e=>e.type==='enemy-artillery'&&e.radius>0),'the shell lands');
 assert.ok(player.health<before,'a stationary player is hit');
});

test('the bulwark front plate blunts damage and a flank bypasses it',()=>{
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});
 const id=spawnGroup(match,match.modeState,{type:'bulwark',count:1},{team:1})[0];
 const tank=match.actors.find(a=>a.id===id);
 tank.armor=0;tank.protection=0;tank.health=tank.maxHealth;tank.yaw=0;
 const front={x:tank.x,y:tank.y,z:tank.z-6,health:100,damageMultiplier:1};
 match.damage(tank,100,front);const fromFront=tank.health;
 tank.health=tank.maxHealth;
 const back={x:tank.x,y:tank.y,z:tank.z+6,health:100,damageMultiplier:1};
 match.damage(tank,100,back);const fromBack=tank.health;
 assert.ok(fromFront>fromBack,'the front plate absorbs more than a flank shot');
 assert.ok(fromBack<tank.maxHealth,'the flank shot connects');
});

test('throne-siege plays through the finale to a win',()=>{
 const match=autoplay('throne-siege','throne');
 const snap=match.snapshot().singleplayer;
 assert.equal(match.over,true);
 assert.equal(snap.winner,0);
 assert.equal(snap.mission.id,'throne-siege');
 assert.ok(snap.bossPhaseTotal>=3,'the finale authors a multi-phase boss');
});

test('area confinement keeps zoned NPCs leashed and moving on the new maps',()=>{
 for(const mapId of ['throne','gauntlet']){
  const match=make('horde',{fragLimit:1,mapId});
  const zone={x:0,z:0,r:8,leash:12,kind:'spawn'};
  const player=match.actors[0];
  player.x=-38;player.z=-38;player.y=floorAt(-38,-38,match.arena)??0;player.protection=1e9;
  const ids=spawnGroup(match,match.modeState,{type:'spitter',count:5,zone},{team:1});
  const seen=new Set();
  for(let i=0;i<1200;i++){
   match.step(1/60,{inputs:{}});
   if(i%120===0)for(const id of ids){const actor=match.actors.find(candidate=>candidate.id===id);if(actor&&actor.health>0)seen.add(`${actor.x.toFixed(0)}|${actor.z.toFixed(0)}`);}
  }
  for(const id of ids){const actor=match.actors.find(candidate=>candidate.id===id);if(!actor||actor.health<=0)continue;assert.ok(Math.hypot(actor.x-zone.x,actor.z-zone.z)<=zone.leash+1,`${mapId} enemy ${id} held its leash`);}
  assert.ok(seen.size>1,`${mapId} zoned NPCs keep patrolling`);
 }
});

test('horde waves cycle readable modifiers and telegraph each twist',()=>{
 assert.equal(hordeWaveModifier(1).id,'swarm','wave one is the tutorial swarm');
 assert.ok(hordeWaveModifier(1).name&&hordeWaveModifier(1).description,'every modifier is named and described');
 assert.ok(HORDE_WAVE_MODIFIERS.some(modifier=>modifier.id==='shielded'),'shielded waves exist');
 assert.ok(HORDE_WAVE_MODIFIERS.some(modifier=>modifier.id==='artillery'),'artillery waves exist');
 assert.ok(HORDE_WAVE_MODIFIERS.some(modifier=>modifier.id==='elite'),'elite-gated waves exist');
 const artillery=hordeWavePlan(3),shielded=hordeWavePlan(4);
 assert.equal(artillery.modifier.id,'artillery');
 assert.ok((artillery.counts.mortar||0)>=1,'an artillery wave fields an indirect-fire piece');
 assert.equal(shielded.modifier.id,'shielded');
 assert.ok((shielded.counts.bulwark||0)>=1,'a shielded wave fields an armoured unit');
 assert.equal(hordeWavePlan(1).counts.mortar||0,0,'wave one is not altered');
 assert.equal(hordeWaveSize(1),3,'wave one size is pinned');
 assert.equal(hordeWaveSize(8)>hordeWaveSize(2),true,'waves keep growing under modifiers');
 const match=make('horde',{fragLimit:2,mapId:'colosseum'});match.actors[0].protection=1e9;
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 for(let i=0;i<60*9&&!match.over;i++)match.step(1/60,{inputs:{}});
 assert.ok(captured.some(entry=>entry.type==='horde-wave'&&typeof entry.modifier==='string'),'the wave telegraphs its modifier');
 assert.ok(captured.some(entry=>entry.type==='horde-modifier'&&entry.name),'the twist is announced to the HUD');
 const snap=match.snapshot().singleplayer;
 assert.ok(snap.waveModifier&&snap.waveModifier.id,'the snapshot exposes the active modifier');
});

test('boss phases mechanically escalate the Warden and telegraph a ground slam',()=>{
 const match=make('campaign',{mission:'reactor-run',mapId:'titan-valley'});
 const state=match.modeState,player=match.actors[0];
 player.protection=1e9;player.health=player.maxHealth;
 const id=spawnGroup(match,state,{type:'warden',count:1,x:player.x+7,z:player.z},{team:1})[0];
 const boss=match.actors.find(actor=>actor.id===id);
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 for(let i=0;i<600;i++){
  boss.x=player.x+7;boss.z=player.z;boss.y=player.y;boss.health=boss.maxHealth*.5;
  match.step(1/60,{inputs:{}});
 }
 assert.equal(boss.bossPhase,2,'the boss-hp script advances the mechanical phase');
 assert.ok(boss.speedMultiplier>1,'phase two accelerates the boss');
 assert.ok(boss.damageMultiplier>1,'phase two hits harder');
 assert.ok(captured.some(entry=>entry.type==='enemy-telegraph'&&entry.kind==='boss'),'the slam is telegraphed');
 assert.ok(captured.some(entry=>entry.type==='boss-slam'&&entry.radius>0),'the slam lands');
 assert.ok(captured.some(entry=>entry.type==='boss-slam'&&entry.phase===2),'the slam carries its phase');
});

test('the throne finale resumes from a checkpoint and keeps its finale win',()=>{
 const order=CAMPAIGN_MISSIONS.map(mission=>mission.id);
 const retry=make('campaign',{mission:'throne-siege',mapId:'throne'});
 const total=retry.modeState.steps.length;
 retry.config.checkpoint=2;
 retry.initializeSinglePlayer();
 assert.equal(retry.modeState.stepIndex,2);
 const snap=retry.snapshot().singleplayer;
 assert.equal(snap.mission.id,'throne-siege');
 assert.equal(snap.checkpoint.step,2);
 assert.equal(snap.steps[1].done,true);
 assert.equal(snap.steps[2].active,true);
 assert.equal(applyCampaignCheckpoint(retry,{missionId:order[0],step:1}),false,'a different mission is rejected');
 assert.equal(applyCampaignCheckpoint(retry,{missionId:'throne-siege',step:3}),true);
 assert.equal(retry.modeState.stepIndex,3);
});

test('ghost-wire and crown-duel terminate with a win on every difficulty',()=>{
 for(const difficulty of DIFFICULTIES){
  const ghost=autoplay('ghost-wire','frost-gate',1e12,difficulty.id),ghostSnap=ghost.snapshot().singleplayer;
  assert.equal(ghost.over,true,`ghost-wire/${difficulty.id} ends`);
  assert.equal(ghostSnap.winner,0,`ghost-wire/${difficulty.id} wins`);
  assert.equal(ghostSnap.phase,'won',`ghost-wire/${difficulty.id} phase`);
  assert.equal(ghostSnap.mission.id,'ghost-wire');
  assert.equal(ghostSnap.steps.filter(step=>step.done).length,ghostSnap.steps.length,`ghost-wire/${difficulty.id} full chain`);
  const crown=autoplay('crown-duel','fortress',1e12,difficulty.id),crownSnap=crown.snapshot().singleplayer;
  assert.equal(crown.over,true,`crown-duel/${difficulty.id} ends`);
  assert.equal(crownSnap.winner,0,`crown-duel/${difficulty.id} wins`);
  assert.equal(crownSnap.mission.id,'crown-duel');
  assert.ok(crownSnap.bossPhaseTotal>=3,`crown-duel/${difficulty.id} authors a multi-phase Harbinger`);
 }
});

test('the lancer flanks to cover and bursts after a telegraph',()=>{
 const match=make('horde',{fragLimit:1,mapId:'colosseum'});
 const state=match.modeState,player=match.actors[0];
 player.protection=1e9;player.health=player.maxHealth;
 const id=spawnGroup(match,state,{type:'lancer',count:1,zone:{x:player.x,z:player.z,r:8,leash:14,kind:'hold'}},{team:1})[0];
 const lancer=match.actors.find(actor=>actor.id===id);
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 for(let i=0;i<600&&!match.over;i++){player.x=lancer.x+3;player.z=lancer.z;match.updateSinglePlayer(1/60);}
 assert.ok(captured.some(entry=>entry.type==='enemy-telegraph'&&entry.kind==='flanker'),'the flank is telegraphed');
 assert.ok(captured.some(entry=>entry.type==='enemy-flank'),'the flank resolves');
 assert.ok(lancer.flankPoint&&Number.isFinite(lancer.flankPoint.x)&&Number.isFinite(lancer.flankPoint.z),'a real cover point was chosen');
 assert.ok(lancer.speedMultiplier>1,'the burst speeds the lancer up');
});

test('the sentinel shields nearby allies in formation',()=>{
 const match=make('horde',{fragLimit:1,mapId:'colosseum'});
 const state=match.modeState,player=match.actors[0];player.protection=1e9;
 const zone={x:player.x+30,z:player.z+30,r:6,leash:12,kind:'hold'};
 const sentinelId=spawnGroup(match,state,{type:'sentinel',count:1,x:zone.x,z:zone.z,zone},{team:1})[0];
 const huskId=spawnGroup(match,state,{type:'husk',count:1,x:zone.x,z:zone.z,zone},{team:1})[0];
 const sentinel=match.actors.find(actor=>actor.id===sentinelId),husk=match.actors.find(actor=>actor.id===huskId);
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 for(let i=0;i<400&&!match.over;i++){husk.x=sentinel.x;husk.z=sentinel.z;husk.y=sentinel.y;match.updateSinglePlayer(1/60);}
 assert.ok(captured.some(entry=>entry.type==='enemy-telegraph'&&entry.kind==='phalanx'),'the formation pulse is telegraphed');
 assert.ok(captured.some(entry=>entry.type==='phalanx-shield'&&entry.shielded>=1),'allies inside the wall are shielded');
 assert.ok(husk.temporaryShield>0,'the ally carries the front shield');
});

test('the Harbinger summons adds and its phases escalate',()=>{
 const match=make('horde',{fragLimit:1,mapId:'colosseum'});
 const state=match.modeState,player=match.actors[0];player.protection=1e9;
 const id=spawnGroup(match,state,{type:'harbinger',count:1,x:player.x+12,z:player.z,zone:{x:player.x+12,z:player.z,r:8,leash:24,kind:'hold'}},{team:1})[0];
 const boss=match.actors.find(actor=>actor.id===id);boss.summonTimer=0;
 const captured=[],original=match.emit.bind(match);
 match.emit=(type,data)=>{captured.push({type,...data});original(type,data);};
 const before=match.actors.length;
 state.bossPhase=2;
 for(let i=0;i<3;i++)match.updateSinglePlayer(1/60);
 assert.ok(captured.some(entry=>entry.type==='boss-summon'),'the boss summons');
 assert.ok(match.actors.length>before,'the summon deploys actors');
 assert.ok(match.actors.some(actor=>actor.npcType==='husk'),'the summon brings husks');
 assert.equal(boss.bossPhase,2);
 assert.ok(boss.speedMultiplier>1&&boss.damageMultiplier>1,'phase two escalates the boss');
});

test('horde modifiers inject flankers, shield-bearers and a champion boss',()=>{
 assert.equal(hordeWaveModifier(7).id,'flanked');
 assert.equal(hordeWaveModifier(8).id,'fortified');
 assert.equal(hordeWaveModifier(9).id,'champion');
 assert.ok((hordeWavePlan(7).counts.lancer||0)>=1,'a flanked wave fields a lancer');
 assert.ok((hordeWavePlan(8).counts.sentinel||0)>=1,'a fortified wave fields a sentinel');
 assert.equal(hordeWavePlan(9).counts.boss,true,'a champion wave marks a boss');
 assert.ok((hordeWavePlan(9).counts.harbinger||0)>=1,'a champion wave fields the Harbinger');
 const match=make('horde',{fragLimit:10,mapId:'colosseum'});match.actors[0].protection=1e9;
 let guard=0;
 while(!match.over&&match.modeState.wave<9&&guard++<60*60*3){
  for(const actor of firstEnemies(match)){actor.health=0;actor.dead=1;}
  if(match.modeState.phase==='intermission')match.modeState.timer=0;
  match.step(1/60,{inputs:{}});
 }
 assert.ok(match.modeState.wave>=9,'reached the champion wave');
 assert.ok(match.actors.some(actor=>actor.isBoss&&actor.npcType==='harbinger'),'the champion deploys a Harbinger');
 assert.equal(match.modeState.waveModifier.id,'champion');
});
