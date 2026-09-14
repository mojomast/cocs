import {CHARACTERS} from './data.mjs';
import {CAMPAIGN_MISSIONS,missionFor} from './campaign-data.mjs';
import {applyEnemyFields,enemyById,enemyLeash,ENEMY_SPEED_VARIANCE,DEFAULT_ENEMY_ID,NPC_ZONE_KINDS} from './enemy-types.mjs';

// Single-player simulation. Horde spawns escalating waves of fragile enemies;
// campaign runs a linear, story-driven sequence of objectives with world
// waypoints and scripted enemy deployments. Both use `enemy-types.mjs` so the
// enemies are a different class than multiplayer bots (tiny health pools and
// per-type behaviour) and reuse the shared bot brain for pathing and aim.
export const SINGLEPLAYER_MODES = Object.freeze(['horde','campaign']);
export const isSinglePlayerMode = mode => SINGLEPLAYER_MODES.includes(mode);

// Per-difficulty horde pacing. Easy gives the player long breathing room, a
// small live cap and slow wave growth; Nightmare floods the arena. `baseWave`
// is folded into the composition below so `hordeWaveSize` stays the single
// source of truth for how big a wave is.
export const HORDE_CONFIG = Object.freeze({
 easy: Object.freeze({baseWave:3,growth:1,maxAlive:12,intermission:7,eliteEvery:6,countScale:.75}),
 normal: Object.freeze({baseWave:4,growth:1.3,maxAlive:16,intermission:5,eliteEvery:5,countScale:1}),
 hard: Object.freeze({baseWave:5,growth:1.6,maxAlive:20,intermission:4,eliteEvery:4,countScale:1.2}),
 nightmare: Object.freeze({baseWave:6,growth:2,maxAlive:24,intermission:3,eliteEvery:3,countScale:1.4}),
});
export const hordePacing = id => HORDE_CONFIG[id] || HORDE_CONFIG.easy;
// Wave-indexed archetype table. Each row is the un-scaled, late-game shape of
// a wave; the difficulty `countScale` shrinks or swells it, and every wave
// past the table keeps growing husks according to the difficulty `growth`.
export const HORDE_COMPOSITION = Object.freeze([
 Object.freeze({husk:3,spitter:1,brute:0}),
 Object.freeze({husk:4,spitter:1,brute:0}),
 Object.freeze({husk:4,spitter:2,brute:0}),
 Object.freeze({husk:5,spitter:2,brute:0}),
 Object.freeze({husk:6,spitter:2,brute:1}),
 Object.freeze({husk:7,spitter:3,brute:1}),
]);
// Marked on NPCs so the base respawn timer can never revive them.
const NPC_DEAD = 1e9;
const STORY_SECONDS = 7;

export function hordeWaveComposition(wave,difficultyId='easy'){
 const pacing=hordePacing(difficultyId),index=Math.max(1,Math.round(wave));
 const row=HORDE_COMPOSITION[Math.min(index-1,HORDE_COMPOSITION.length-1)];
 const overflow=Math.max(0,index-HORDE_COMPOSITION.length);
 const counts={husk:Math.round((row.husk||0)*pacing.countScale)+Math.floor(overflow*pacing.growth),spitter:Math.round((row.spitter||0)*pacing.countScale),brute:Math.round((row.brute||0)*pacing.countScale)};
 let total=counts.husk+counts.spitter+counts.brute;
 if(total>pacing.maxAlive){counts.husk=Math.max(0,counts.husk-(total-pacing.maxAlive));total=counts.husk+counts.spitter+counts.brute;}
 if(total>pacing.maxAlive)counts.spitter=Math.max(0,counts.spitter-(total-pacing.maxAlive));
 const elite=Boolean(pacing.eliteEvery)&&index%pacing.eliteEvery===0;
 return {...counts,elite};
}

export const hordeWaveSize = (wave,difficulty='easy') => {
 const composition=hordeWaveComposition(wave,difficulty);
 return composition.husk+composition.spitter+composition.brute;
};

const actorById = (match,id) => (match.actors||[]).find(actor => actor.id === id) || null;
const aliveById = (match,id) => { const actor = actorById(match,id); return Boolean(actor) && actor.health > 0; };
const aliveEnemies = (match,state) => (state.enemies||[]).reduce((count,id) => count + (aliveById(match,id)?1:0),0);
const allScriptDone = state => !state.script.length || state.script.every(event => state.fired[event.id]);

function placeAt(match,actor,x,z){
 let best=null,bestDistance=Infinity;
 for(const node of match.nav||[]){const distance=Math.hypot((node.x??0)-x,(node.z??0)-z);if(distance<bestDistance){bestDistance=distance;best=node;}}
 if(best){actor.x=best.x;actor.z=best.z;if(Number.isFinite(best.y))actor.y=best.y;}
 else if(Number.isFinite(x)&&Number.isFinite(z)){actor.x=x;actor.z=z;}
 actor.lastValid=null;actor.vx=0;actor.vy=0;actor.vz=0;
}

function placeActor(actor,point){
 actor.x=point.x;actor.z=point.z;
 actor.y=Number.isFinite(point.y)?point.y:0;
 actor.lastValid={x:actor.x,y:actor.y,z:actor.z};
 actor.vx=0;actor.vy=0;actor.vz=0;actor.grounded=true;
}

// De-clumps a group spawn: instead of snapping every member onto the single
// nearest nav node, greedily pick DISTINCT on-floor nodes inside the spawn
// radius, then fall back to ring points snapped back onto the nav graph.
export function placeGroup(match,actors,x,z,radius){
 if(!actors.length)return actors;
 const r=Math.max(.5,Number.isFinite(radius)?radius:8),chosen=[];
 const accept=(px,pz,py)=>{
  for(const picked of chosen)if(Math.hypot(picked.x-px,picked.z-pz)<1)return false;
  chosen.push({x:px,y:py,z:pz});return true;
 };
 const candidates=[];
 for(const node of match.nav||[]){
  if(!Number.isFinite(node.x)||!Number.isFinite(node.z))continue;
  const distance=Math.hypot(node.x-x,node.z-z);
  if(distance<=r)candidates.push({x:node.x,y:node.y,z:node.z,distance});
 }
 candidates.sort((a,b)=>a.distance-b.distance||a.x-b.x||a.z-b.z);
 for(const candidate of candidates){if(chosen.length>=actors.length)break;accept(candidate.x,candidate.z,candidate.y);}
 if(chosen.length<actors.length){
  for(let ring=1;ring<=6&&chosen.length<actors.length;ring++){
   const ringRadius=r*(ring/6),steps=Math.max(8,Math.round(2*Math.PI*ringRadius/1.5));
   for(let step=0;step<steps&&chosen.length<actors.length;step++){
    const angle=(step/steps)*Math.PI*2+ring*.37,px=x+Math.cos(angle)*ringRadius,pz=z+Math.sin(angle)*ringRadius;
    let best=null,bestDistance=Infinity;
    for(const node of match.nav||[]){const distance=Math.hypot(node.x-px,node.z-pz);if(distance<bestDistance){bestDistance=distance;best=node;}}
    if(best&&Math.hypot(best.x-x,best.z-z)<=r)accept(best.x,best.z,best.y);
   }
  }
 }
 for(let i=0;i<actors.length;i++){
  const point=chosen[i]||{x,z,y:Number.isFinite(match.nav?.[0]?.y)?match.nav[0].y:0};
  placeActor(actors[i],point);
 }
 return actors;
}

// Normalizes the authored `zone`/`x,z` on a spawn request into the npcZone
// contract every NPC carries: {x,z,r,leash,kind}.
function npcZoneSpec(request,type){
 const source=request.zone||(Number.isFinite(request.x)&&Number.isFinite(request.z)?request:null);
 if(!source)return null;
 const x=Number.isFinite(source.x)?source.x:(Number.isFinite(request.x)?request.x:0);
 const z=Number.isFinite(source.z)?source.z:(Number.isFinite(request.z)?request.z:0);
 const r=Number.isFinite(source.r)?source.r:Number.isFinite(source.radius)?source.radius:Number.isFinite(request.r)?request.r:Number.isFinite(request.radius)?request.radius:8;
 const leash=Number.isFinite(source.leash)?source.leash:Number.isFinite(request.leash)?request.leash:Math.max(r,enemyLeash(type));
 const kind=NPC_ZONE_KINDS.includes(source.kind)?source.kind:NPC_ZONE_KINDS.includes(request.kind)?request.kind:request.patrol?'patrol':request.hold?'hold':'spawn';
 return {x,z,r,leash,kind};
}

function snapPoint(match,point){
 if(!point)return point;
 let best=null,bestDistance=Infinity;
 for(const node of match.nav||[]){const distance=Math.hypot((node.x??0)-(point.x??0),(node.z??0)-(point.z??0));if(distance<bestDistance){bestDistance=distance;best=node;}}
 return best?{...point,x:best.x,z:best.z}:point;
}
const snapZone = (match,zone) => snapPoint(match,zone);
const snapStep = (match,step) => step.marker ? {...step,marker:snapPoint(match,step.marker)} : {...step};
const inZone = (match,zone) => { const player=match.actors[0]; if(!player||!zone)return false; return Math.hypot(player.x-(zone.x??0),player.z-(zone.z??0))<=(zone.radius??3.5); };

function win(match,state,text){if(match.over)return;state.phase='won';state.winner=0;state.message={text,at:match.time};match.objectiveState.winner=0;match.teamScores[0]=Math.max(match.teamScores[0]||0,1);match.emit('mission-won',{text});match.endMatch('objective');}
function lose(match,state,text){if(match.over)return;state.phase='lost';state.winner=1;state.message={text,at:match.time};match.objectiveState.winner=1;match.teamScores[1]=Math.max(match.teamScores[1]||0,1);match.emit('mission-lost',{text});match.endMatch('objective');}

export function spawnGroup(match,state,spec,{team}){
 const request=spec||{};
 const count=Math.max(0,Math.min(24,Math.round(request.count??1)));
 const ids=[],created=[];
 for(let i=0;i<count;i++){
  const id=state.nextId++;
  const type=enemyById(request.type||(request.boss?DEFAULT_ENEMY_ID:undefined));
  const character=request.character??type.character??CHARACTERS[id%CHARACTERS.length].id;
  const harness=request.harness??type.harness??'openclaw';
  const actor=match.actor(id,character,harness);
  actor.team=team;actor.isNpc=true;
  applyEnemyFields(actor,type);
  actor.npcProfile={...actor.npcProfile,speedMult:(actor.npcProfile.speedMult||1)*(1+(match.random()*2-1)*ENEMY_SPEED_VARIANCE)};
  if(request.elite){actor.npcProfile={...actor.npcProfile,health:Math.round(actor.npcProfile.health*1.8),armor:(actor.npcProfile.armor||0)+40};actor.name=`${actor.name} · ELITE`;}
  actor.npcZone=npcZoneSpec(request,type);
  match.actors.push(actor);
  match.spawn(actor);
  ids.push(id);created.push(actor);
  if(team===1)state.enemies.push(id);else state.allies.push(id);
  if(actor.isBoss&&state.boss==null)state.boss=id;
 }
 if(created.length){const zone=created[0].npcZone;if(zone)placeGroup(match,created,zone.x,zone.z,zone.r);}
 if(request.group&&ids.length)state.groups[request.group]=(state.groups[request.group]||[]).concat(ids);
 if(team===1&&count>0)state.everHadEnemies=true;
 match.emit('npc-deploy',{team,count,boss:Boolean(request.boss),elite:Boolean(request.elite),type:request.type||null});
 return ids;
}

export function initializeSinglePlayer(match){
 // Single-player is always a lone human; drop any configured rivals.
 match.actors=match.actors.filter(actor=>actor.id===0);
 match.humanCount=1;
 match.config.botCount=0;
 const mode=match.config.mode;
 const state={kind:mode,playerId:0,phase:'intermission',timer:0,elapsed:0,lives:2,deaths:0,nextId:1,enemies:[],allies:[],groups:{},entered:{},everHadEnemies:false,boss:null,winner:null,message:null,objective:'',script:[],fired:{},defendProgress:0,lastEvent:0,steps:[],stepIndex:0,stepElapsed:0,holdProgress:0,waypoint:null,storyLine:null,bark:null,bossPhase:0};
 if(mode==='horde'){
  const pacing=hordePacing(match.config.difficulty);
  state.waveTarget=Math.max(1,Math.round(match.config.fragLimit||10));
  state.wave=0;state.timer=pacing.intermission;state.phase='intermission';state.lives=3;
  state.objective=`Survive ${state.waveTarget} hostile waves.`;
 } else {
  const mission=missionFor(match.config.mission);
  state.mission=mission;state.phase='active';state.lives=mission.lives??3;
  state.objective=mission.objective;state.win=snapZone(match,mission.win);state.timer=0;
  state.script=(mission.script||[]).map((event,index)=>({id:event.id??`${mission.id}-script-${index}`,...event}));
  for(const event of state.script)if(event.when==='player-in-zone')Object.assign(event,snapZone(match,event));
  state.steps=(mission.steps||[]).map(step=>snapStep(match,step));
  const player=match.actors[0];
  if(player&&mission.start){placeAt(match,player,mission.start.x,mission.start.z);if(Number.isFinite(mission.start.yaw)){player.yaw=mission.start.yaw;player.bodyYaw=mission.start.yaw;}}
 }
 match.modeState=state;
 match.objectiveState={kind:mode,zones:[],winner:null,singleplayer:true};
 match.teamScores=match.teamScores||{0:0,1:0};
 return state;
}

function releaseDead(match,state){
 const dead=new Set(state.enemies.filter(id=>!aliveById(match,id)));
 if(dead.size)match.actors=match.actors.filter(actor=>!dead.has(actor.id));
 state.enemies=[];
}

function startWave(match,state){
 state.wave+=1;state.phase='wave';state.timer=0;state.enemies=[];
 const composition=hordeWaveComposition(state.wave,match.config.difficulty);
 const group=`wave-${state.wave}`;
 if(composition.husk>0)spawnGroup(match,state,{type:'husk',count:composition.husk,group},{team:1});
 if(composition.spitter>0)spawnGroup(match,state,{type:'spitter',count:composition.spitter,group},{team:1});
 if(composition.brute>0)spawnGroup(match,state,{type:'brute',count:composition.brute,group,elite:composition.elite},{team:1});
 const count=composition.husk+composition.spitter+composition.brute;
 match.emit('horde-wave',{wave:state.wave,target:state.waveTarget,count,elite:composition.elite});
}

function stepHorde(match,state,dt){
 if(state.phase==='intermission'){
  state.timer=Math.max(0,state.timer-dt);
  if(state.timer<=0)startWave(match,state);
  return;
 }
 if(state.phase!=='wave')return;
 if(aliveEnemies(match,state)>0)return;
 match.emit('horde-wave-cleared',{wave:state.wave});
 if(state.wave>=state.waveTarget){win(match,state,`You survived ${state.waveTarget} waves.`);return;}
 state.phase='intermission';state.timer=hordePacing(match.config.difficulty).intermission;releaseDead(match,state);
}

// Shared action interpreter for both step actions and mission script events.
// A `story` beat plays a briefing line, `bark` is an in-world NPC transmission,
// `bossPhase` announces a boss phase change, and the rest mirror the authored
// objective/spawn/win vocabulary.
function applyAction(match,state,action){
 if(!action)return;
 if(action.story){state.storyLine={speaker:action.story.speaker||'OPS',text:action.story.text||'',at:match.time};match.emit('story-line',{speaker:state.storyLine.speaker,text:state.storyLine.text});}
 if(action.bark){const bark=typeof action.bark==='string'?{text:action.bark}:action.bark;state.bark={speaker:bark.speaker||'ENEMY',text:bark.text||'',at:match.time};match.emit('npc-bark',{speaker:state.bark.speaker,text:state.bark.text});}
 if(Number.isFinite(action.bossPhase)){state.bossPhase=Math.max(0,Math.round(action.bossPhase));match.emit('boss-phase',{phase:state.bossPhase,name:action.name||null});}
 if(action.announce){state.message={text:action.announce,at:match.time};match.emit('mission-message',{text:action.announce});}
 if(action.objective)state.objective=action.objective;
 if(Number.isFinite(action.lives))state.lives=Math.max(0,Math.round(action.lives));
 if(action.spawn)spawnGroup(match,state,action.spawn,{team:1});
 if(action.ally)spawnGroup(match,state,action.ally,{team:0});
 if(action.lose)lose(match,state,action.lose===true?'Mission failed.':String(action.lose));
 if(action.win)win(match,state,action.win===true?'Mission complete.':String(action.win));
}

function runStepActions(match,state,actions){
 if(!actions)return;
 for(const action of actions){
  if(!action)continue;
  applyAction(match,state,action);
  if(action.checkpoint)state.checkpoint=state.stepIndex;
  if(match.over)return;
 }
}

function stepComplete(match,state,step,dt){
 const complete=step.complete;if(!complete)return false;
 if(complete.kind==='enter-zone')return inZone(match,step.marker);
 if(complete.kind==='group-dead'){const ids=state.groups[complete.group];return Boolean(ids&&ids.length)&&ids.every(id=>!aliveById(match,id));}
 if(complete.kind==='boss-dead')return state.boss!=null&&!aliveById(match,state.boss);
 if(complete.kind==='timer')return state.stepElapsed>=(complete.seconds||0);
 if(complete.kind==='hold'){const on=step.marker?inZone(match,step.marker):true;state.holdProgress=on?(state.holdProgress||0)+dt:0;return state.holdProgress>=(complete.seconds||0);}
 return false;
}

function stepLinear(match,state,dt){
 const step=state.steps[state.stepIndex];
 if(!step){match.waypoint=null;state.waypoint=null;return;}
 if(!state.entered[step.id]){state.entered[step.id]=true;runStepActions(match,state,step.onStart);if(match.over)return;}
 state.stepElapsed+=dt;
 state.waypoint=step.marker?{id:step.id,x:step.marker.x,y:step.marker.y??0,z:step.marker.z,radius:step.marker.radius??4,label:step.marker.label||step.label||'OBJECTIVE'}:null;
 match.waypoint=state.waypoint;
 if(stepComplete(match,state,step,dt)){state.stepIndex+=1;state.stepElapsed=0;state.holdProgress=0;runStepActions(match,state,step.onComplete);}
}

function triggered(match,state,event,time){
 if(Number.isFinite(event.at))return time>=event.at;
 if(Number.isFinite(event.after))return time>=(state.lastEvent||0)+event.after;
 if(typeof event.when==='string'){
  if(event.when==='cleared')return state.everHadEnemies&&aliveEnemies(match,state)===0;
  if(event.when==='boss-dead')return state.boss!=null&&!aliveById(match,state.boss);
  if(event.when==='player-in-zone')return inZone(match,event);
  const atMost=/^enemiesAtMost:(\d+)$/.exec(event.when);
  if(atMost)return state.everHadEnemies&&aliveEnemies(match,state)<=Number(atMost[1]);
  const bossHp=/^boss-hp:(\d+(?:\.\d+)?)$/.exec(event.when);
  if(bossHp){
   if(state.boss==null)return false;
   const boss=actorById(match,state.boss);
   return Boolean(boss)&&boss.maxHealth>0&&boss.health>0&&boss.health/boss.maxHealth<=Number(bossHp[1]);
  }
 }
 return false;
}

function applyEvent(match,state,event){applyAction(match,state,event);}

function evaluateWin(match,state,dt,time){
 const condition=state.win;if(!condition||match.over)return;
 if(condition.kind==='eliminate'){if(state.everHadEnemies&&aliveEnemies(match,state)===0&&allScriptDone(state))win(match,state,'All hostiles eliminated.');return;}
 if(condition.kind==='survive'){if(time>=(condition.seconds||60))win(match,state,'You held the line.');return;}
 if(condition.kind==='assassinate'){if(state.boss!=null&&!aliveById(match,state.boss))win(match,state,'Target down.');return;}
 if(condition.kind==='reach'){if((!condition.requireCleared||aliveEnemies(match,state)===0)&&inZone(match,condition))win(match,state,'Extraction complete.');return;}
 if(condition.kind==='defend'){const on=inZone(match,condition);state.defendProgress=on?(state.defendProgress||0)+dt:0;if(state.defendProgress>=(condition.seconds||30))win(match,state,'Position held.');}
}

function stepCampaign(match,state,dt){
 if(state.steps.length){stepLinear(match,state,dt);if(match.over)return;}
 for(const event of state.script){
  if(state.fired[event.id])continue;
  if(!triggered(match,state,event,state.elapsed))continue;
  state.fired[event.id]=true;state.lastEvent=state.elapsed;
  applyEvent(match,state,event);
  if(match.over)return;
 }
 if(state.mission?.timeLimit&&state.elapsed>=state.mission.timeLimit){lose(match,state,'Time expired.');return;}
 if(state.win)evaluateWin(match,state,dt,state.elapsed);
}

function onPlayerDeath(match,state){
 state.lives=Math.max(0,(state.lives??0)-1);
 match.emit('singleplayer-life',{lives:state.lives});
 if(state.lives<=0)lose(match,state,state.kind==='campaign'&&state.mission?`${state.mission.name} failed.`:'Out of lives.');
}

export function updateSinglePlayer(match,dt){
 const state=match.modeState;
 if(!state||!isSinglePlayerMode(state.kind)||match.over)return;
 state.elapsed+=dt;
 const player=match.actors[0];
 if(!player)return;
 if(player.deaths>(state.deaths||0)){state.deaths=player.deaths;onPlayerDeath(match,state);if(match.over)return;}
 for(const actor of match.actors)if(actor.isNpc&&actor.health<=0&&(actor.dead??0)<NPC_DEAD)actor.dead=NPC_DEAD;
 if(match.time+dt>=match.config.timeLimit){lose(match,state,'The clock ran out.');return;}
 if(state.kind==='horde')stepHorde(match,state,dt);else stepCampaign(match,state,dt);
}

export function singlePlayerSnapshot(state,match){
 if(!state)return null;
 const enemiesAlive=aliveEnemies(match,state);
 const player=match.actors[0];
 const boss=state.boss!=null?actorById(match,state.boss):null;
 const step=state.steps[state.stepIndex];
 const missionIndex=state.mission?CAMPAIGN_MISSIONS.findIndex(mission=>mission.id===state.mission.id):-1;
 const story=state.storyLine&&match.time-state.storyLine.at<STORY_SECONDS?{speaker:state.storyLine.speaker,text:state.storyLine.text}:null;
 const bark=state.bark&&match.time-state.bark.at<STORY_SECONDS?{speaker:state.bark.speaker,text:state.bark.text}:null;
 const hold=step?.complete?.kind==='hold'?{seconds:step.complete.seconds||0,progress:Math.min(step.complete.seconds||0,state.holdProgress||0)}:null;
 return {kind:state.kind,phase:state.phase,elapsed:state.elapsed,wave:state.wave||0,waveTarget:state.waveTarget||0,waveTimer:state.timer||0,enemiesAlive,enemiesTotal:state.enemies.length,kills:player?.frags||0,deaths:player?.deaths||0,lives:state.lives,objective:state.objective||'',message:state.message&&match.time-state.message.at<5?state.message.text:'',story,bark,bossPhase:state.bossPhase||0,waypoint:state.waypoint?{id:state.waypoint.id,x:state.waypoint.x,z:state.waypoint.z,label:state.waypoint.label}:null,winner:state.winner??null,mission:state.mission?{id:state.mission.id,name:state.mission.name,tag:state.mission.tag,chapter:state.mission.chapter||'',index:missionIndex,total:CAMPAIGN_MISSIONS.length,brief:state.mission.brief,intro:state.mission.intro||null,outro:state.mission.outro||null}:null,steps:state.steps.map((item,index)=>({id:item.id,label:item.label||'',text:item.text||'',detail:item.detail||'',active:index===state.stepIndex,done:index<state.stepIndex})),hold,boss:boss?{name:boss.name,hp:Math.max(0,Math.round(boss.health)),maxHp:boss.maxHealth,alive:boss.health>0,phase:state.bossPhase||0}:null,defend:state.win?.kind==='defend'?{seconds:state.win.seconds??30,progress:Math.min(state.win.seconds??30,Math.round(state.defendProgress||0))}:null};
}
