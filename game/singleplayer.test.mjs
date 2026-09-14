import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {GAME_MODES,normalizeConfig,DEFAULT_CONFIG} from './config.mjs';
import {CAMPAIGN_MISSIONS,missionFor} from './campaign-data.mjs';
import {initializeSinglePlayer,hordeWaveSize,isSinglePlayerMode,singlePlayerSnapshot,spawnGroup,SINGLEPLAYER_MODES} from './singleplayer.mjs';

const make=(mode,options={})=>new Match('chatgpt','openclaw',()=>.5,'colosseum',{mode,botCount:3,humanCount:1,timeLimit:300,...options});
const stepUntil=(match,frames,check)=>{for(let i=0;i<frames&&!match.over;i++){match.step(1/60,{inputs:{}});if(check&&check(i))return;}};
const killEnemies=(match)=>{for(const actor of match.actors)if(actor.isNpc&&actor.health>0){actor.health=0;actor.dead=1;}};

test('single-player modes are registered and configuration keeps the mission',()=>{
 for(const id of SINGLEPLAYER_MODES)assert.ok(GAME_MODES.some(mode=>mode.id===id),id);
 assert.equal(isSinglePlayerMode('horde'),true);
 assert.equal(isSinglePlayerMode('deathmatch'),false);
 assert.equal(DEFAULT_CONFIG.mission,missionFor(DEFAULT_CONFIG.mission).id);
 assert.equal(normalizeConfig({mode:'campaign',mission:'last-stand'}).mission,'last-stand');
 assert.equal(normalizeConfig({mode:'campaign',mission:'bogus'}).mission,'boot-camp');
 assert.equal(normalizeConfig({mode:'horde'}).fragLimit,10);
});

test('horde initialization leaves a lone player and an empty battlefield',()=>{
 const match=make('horde',{fragLimit:3});
 assert.equal(match.actors.length,1);
 assert.equal(match.config.botCount,0);
 assert.equal(match.modeState.kind,'horde');
 assert.equal(match.modeState.waveTarget,3);
 assert.equal(match.modeState.enemies.length,0);
 assert.equal(match.objectiveState.kind,'horde');
 assert.deepEqual(match.objectiveState.zones,[]);
 assert.ok(match.actors[0].bot===null,'player is not a bot');
});

test('horde waves grow, spawn hostile NPCs with the bot brain, and clear to a win',()=>{
 assert.equal(hordeWaveSize(1),3);assert.ok(hordeWaveSize(6)>hordeWaveSize(2));assert.ok(hordeWaveSize(50)<=18);
 const match=make('horde',{fragLimit:2});match.actors[0].protection=1e9;
 stepUntil(match,600);
 assert.equal(match.modeState.phase,'wave');
 const enemies=match.actors.filter(actor=>actor.isNpc);
 assert.equal(enemies.length,3);
 assert.ok(enemies.every(actor=>actor.bot&&actor.team===1&&actor.isNpc));
 for(let wave=0;wave<50&&!match.over;wave++){stepUntil(match,60);killEnemies(match);stepUntil(match,200);}
 assert.equal(match.over,true);
 assert.equal(match.overReason,'objective');
 assert.equal(match.snapshot().winner,0);
 assert.equal(match.modeState.phase,'won');
});

test('dead horde NPCs never respawn and are released between waves',()=>{
 const match=make('horde',{fragLimit:5});stepUntil(match,600);
 const target=match.actors.find(actor=>actor.isNpc);target.health=0;target.dead=2;
 stepUntil(match,10);
 const dead=target.dead;
 assert.ok(dead>=1e9,'dead NPC is pinned out of the respawn queue');
 stepUntil(match,300);
 assert.equal(target.health,0,'dead NPC stays dead');
 assert.ok(target.dead>1e8,'respawn timer stays pinned high');
});

test('losing all lives ends horde on the hostile team',()=>{
 const match=make('horde',{fragLimit:10});stepUntil(match,600);
 const enemy=match.actors.find(actor=>actor.isNpc);
 for(let death=0;death<2&&!match.over;death++){const player=match.actors[0];player.protection=0;match.damage(player,1e6,enemy);stepUntil(match,240);}
 assert.equal(match.over,true);
 assert.equal(match.snapshot().winner,1);
 assert.equal(match.modeState.lives,0);
 assert.equal(match.modeState.phase,'lost');
});

test('campaign missions spawn their garrisons up front',()=>{
 for(const mission of CAMPAIGN_MISSIONS){
  const match=make('campaign',{mission:mission.id,fragLimit:6});
  assert.equal(match.modeState.kind,'campaign');
  assert.equal(match.modeState.mission.id,mission.id);
  assert.equal(match.objectiveState.kind,'campaign');
  assert.ok(match.modeState.enemies.length>0,`${mission.id} deploys NPCs`);
  assert.ok(match.actors.filter(actor=>actor.isNpc).length>0,`${mission.id} NPC actors exist`);
  assert.ok(match.modeState.lives>=1);
 }
});

test('boot camp plays its script and wins when the hostiles are gone',()=>{
 const match=make('campaign',{mission:'boot-camp'});
 const start=match.modeState.enemies.length;
 assert.equal(start,5);
 stepUntil(match,120);
 assert.ok(match.modeState.fired.brief,'opening message fired');
 killEnemies(match);
 stepUntil(match,600);
 assert.ok(match.modeState.fired.done,'cleared message fired');
 assert.equal(match.over,true);
 assert.equal(match.snapshot().winner,0);
 assert.equal(match.modeState.phase,'won');
});

test('high value target requires the Warden to fall',()=>{
 const match=make('campaign',{mission:'high-value-target'});
 stepUntil(match,120);
 assert.ok(match.modeState.boss!=null,'boss deployed');
 const boss=match.actors.find(actor=>actor.id===match.modeState.boss);
 assert.equal(boss.isBoss,true);
 assert.ok(boss.maxHealth>=500,'boss is tougher than a normal NPC');
 killEnemies(match);
 stepUntil(match,300);
 assert.equal(match.over,true);
 assert.equal(match.snapshot().winner,0);
});

test('survive and defend missions end on their timers with a living player',()=>{
 const survive=make('campaign',{mission:'reinforce'});
 survive.actors[0].protection=1e9;
 stepUntil(survive,60*80);
 assert.equal(survive.over,true,'survive mission completes');
 assert.equal(survive.snapshot().winner,0);
 const defend=make('campaign',{mission:'hold-the-line'});
 const zone=defend.modeState.win;
 defend.actors[0].protection=1e9;
 const player=defend.actors[0];
 for(let i=0;i<60*60&&!defend.over;i++){player.x=zone.x;player.z=zone.z;defend.step(1/60,{inputs:{}});}
 assert.equal(defend.over,true,'defend mission completes');
 assert.equal(defend.snapshot().winner,0);
});

test('extraction only completes after the reinforcements are cleared',()=>{
 const match=make('campaign',{mission:'extraction'});
 match.actors[0].protection=1e9;
 const zone=match.modeState.win;
 // Reach the beacon while enemies remain: it must not win.
 match.actors[0].x=zone.x;match.actors[0].z=zone.z;
 stepUntil(match,120);
 assert.equal(match.over,false,'cannot extract with hostiles alive');
 killEnemies(match);stepUntil(match,120); // triggers the reinforcement wave
 assert.ok(match.modeState.fired.push,'reinforcement event fired');
 killEnemies(match);
 for(let i=0;i<600&&!match.over;i++){match.actors[0].x=zone.x;match.actors[0].z=zone.z;match.step(1/60,{inputs:{}});}
 assert.equal(match.over,true);
 assert.equal(match.snapshot().winner,0);
});

test('single-player snapshot exposes wave, mission, boss and objective state',()=>{
 const match=make('horde',{fragLimit:4});stepUntil(match,600);
 const snap=match.snapshot().singleplayer;
 assert.equal(snap.kind,'horde');
 assert.equal(snap.waveTarget,4);
 assert.equal(snap.enemiesAlive,3);
 assert.equal(snap.enemiesTotal,3);
 assert.equal(typeof snap.lives,'number');
 assert.ok(snap.lives<=2&&snap.lives>=0);
 assert.equal(typeof snap.objective,'string');
 assert.equal(singlePlayerSnapshot(null,match),null);
 const mission=make('campaign',{mission:'high-value-target'});stepUntil(mission,120);
 const camp=mission.snapshot().singleplayer;
 assert.equal(camp.mission.id,'high-value-target');
 assert.equal(camp.mission.total,CAMPAIGN_MISSIONS.length);
 assert.ok(camp.boss&&camp.boss.maxHp>0);
});

test('spawnGroup fields a boss and an elite with scaled durability',()=>{
 const match=make('horde',{fragLimit:3});
 initializeSinglePlayer(match);
 const state=match.modeState;
 spawnGroup(match,state,{count:1,boss:true,character:'chatgpt',harness:'openclaw'},{team:1});
 spawnGroup(match,state,{count:1,elite:true,character:'chatgpt',harness:'openclaw'},{team:1});
 const boss=match.actors.find(actor=>actor.isBoss);
 const elite=match.actors.find(actor=>actor.isNpc&&!actor.isBoss);
 assert.equal(state.boss,boss.id);
 assert.equal(boss.name,'WARDEN');
 assert.ok(boss.maxHealth>=elite.maxHealth*2);
 assert.ok(elite.name.includes('ELITE'));
 assert.equal(state.enemies.length,2);
});
