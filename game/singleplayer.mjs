import {CHARACTERS,POWERUPS} from './data.mjs';
import {CAMPAIGN_MISSIONS,missionFor} from './campaign-data.mjs';
import {applyEnemyFields,enemyById,enemyLeash,bossPhaseProfile,bossMaxPhase,ENEMY_SPEED_VARIANCE,DEFAULT_ENEMY_ID,NPC_ZONE_KINDS} from './enemy-types.mjs';
import {coverPoint} from './bots.mjs';

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
 Object.freeze({husk:4,spitter:1,sapper:1,brute:0}),
 Object.freeze({husk:5,spitter:2,mender:1,brute:0}),
 Object.freeze({husk:6,spitter:2,sapper:1,mortar:1,brute:1}),
 Object.freeze({husk:6,spitter:2,overseer:1,bulwark:1,brute:1}),
 Object.freeze({husk:7,spitter:3,overseer:1,mortar:2,bulwark:1,brute:1}),
 Object.freeze({husk:8,spitter:3,mender:1,overseer:1,mortar:2,bulwark:2,brute:2}),
]);
// Stable spawn order for a wave. Derived from the composition table so adding a
// row entry is the only change needed to field a new archetype.
export const HORDE_TYPES = Object.freeze([...new Set(HORDE_COMPOSITION.flatMap(row=>Object.keys(row).filter(key=>key!=='elite')))]);
// Marked on NPCs so the base respawn timer can never revive them.
const NPC_DEAD = 1e9;
const STORY_SECONDS = 7;
// Between-wave economy: a full resupply on every clear, plus a choose-1-of-3
// upgrade every 3-5 waves. The gap cycles deterministically through this table,
// so a run never depends on Math.random. Choices reuse the shared POWERUPS
// vocabulary and are re-applied on every resupply, making them run upgrades.
export const HORDE_UPGRADE_GAPS = Object.freeze([3,4,5]);
export const HORDE_UPGRADES = Object.freeze(POWERUPS.map(powerup=>Object.freeze({id:powerup.id,name:powerup.name,description:powerup.description,color:powerup.color,duration:powerup.duration})));
const hordeUpgradeInfo = id => HORDE_UPGRADES.find(choice=>choice.id===id)||null;
export function hordeUpgradeChoices(offerIndex=0){
 const ids=POWERUPS.map(powerup=>powerup.id),count=Math.min(3,ids.length),start=((Math.round(offerIndex)||0)%ids.length+ids.length)%ids.length,choices=[];
 for(let i=0;i<count;i++)choices.push(ids[(start+i)%ids.length]);
 return choices;
}

// Wave modifiers give every tier a readable identity and a clear telegraph
// (`horde-wave` carries the modifier, and `horde-modifier` announces the twist
// for the HUD). The cycle is deterministic and difficulty-independent, so a
// settled run always fields the same sequence of twists.
export const HORDE_WAVE_MODIFIERS = Object.freeze([
 Object.freeze({id:'swarm',name:'SWARM',description:'A fast, fragile rush with no heavy support.'}),
 Object.freeze({id:'mixed',name:'MIXED',description:'Balanced ranks of husks, spitters and heavies.'}),
 Object.freeze({id:'artillery',name:'ARTILLERY',description:'Indirect fire — keep moving or eat the shells.'}),
 Object.freeze({id:'shielded',name:'SHIELDED',description:'An armoured front line leads the push.'}),
 Object.freeze({id:'elite',name:'ELITE GATE',description:'An elite unit anchors the wave.'}),
 Object.freeze({id:'flanked',name:'FLANKED',description:'Lancers break cover and hit from the sides.'}),
 Object.freeze({id:'fortified',name:'FORTIFIED',description:'A shield-bearer formation anchors the line.'}),
 Object.freeze({id:'champion',name:'CHAMPION',description:'A boss takes the field and calls in reinforcements.'}),
]);
const HORDE_MODIFIER_ORDER = Object.freeze(['swarm','mixed','artillery','shielded','mixed','elite','flanked','fortified','champion']);
export function hordeWaveModifier(wave,difficultyId='easy'){
 const index=Math.max(1,Math.round(wave)),id=HORDE_MODIFIER_ORDER[(index-1)%HORDE_MODIFIER_ORDER.length];
 const base=HORDE_WAVE_MODIFIERS.find(modifier=>modifier.id===id)||HORDE_WAVE_MODIFIERS[0];
 return {...base,wave:index,difficulty:difficultyId};
}
// Resolves the full wave plan: the base composition plus the modifier's twist.
// Twists swap (never inflate) bodies so the live cap and difficulty pacing stay
// authoritative, and wave one is left untouched as the tutorial wave.
export function hordeWavePlan(wave,difficultyId='easy',{endless=false}={}){
 const counts={...hordeWaveComposition(wave,difficultyId)};
 const modifier=hordeWaveModifier(wave,difficultyId);
 // Endless runs escalate a boss on a fixed five-wave cadence, alternating the
 // two boss classes so a long run never settles into one fight. The bounded run
 // keeps the authored champion modifier untouched.
 if(endless&&hordeBossWave(wave,{endless:true})){
  counts.boss=true;
  const bossType=Math.floor(Math.max(1,Math.round(wave))/5)%2===1?'warden':'harbinger';
  counts[bossType]=(counts[bossType]||0)+1;
  return {counts,modifier:{...modifier,id:'champion',name:'CHAMPION',description:'A boss takes the field and calls in reinforcements.',boss:true}};
 }
 if(modifier.id==='artillery'&&(counts.mortar||0)<1){
  const source=counts.spitter>0?'spitter':counts.brute>0?'brute':'husk';
  if(counts[source]>0)counts[source]-=1;
  counts.mortar=(counts.mortar||0)+1;
 }
 if(modifier.id==='shielded'&&(counts.bulwark||0)<1){
  const source=counts.brute>0?'brute':counts.spitter>0?'spitter':'husk';
  if(counts[source]>0)counts[source]-=1;
  counts.bulwark=(counts.bulwark||0)+1;
 }
 if(modifier.id==='flanked'&&(counts.lancer||0)<1){
  const source=counts.husk>0?'husk':counts.spitter>0?'spitter':counts.brute>0?'brute':'husk';
  if((counts[source]||0)>0)counts[source]-=1;
  counts.lancer=(counts.lancer||0)+1;
 }
 if(modifier.id==='fortified'&&(counts.sentinel||0)<1){
  const source=counts.brute>0?'brute':counts.husk>0?'husk':'spitter';
  if((counts[source]||0)>0)counts[source]-=1;
  counts.sentinel=(counts.sentinel||0)+1;
 }
 if(modifier.id==='elite')counts.elite=true;
 if(modifier.id==='champion'){counts.boss=true;counts.harbinger=(counts.harbinger||0)+1;}
 return {counts,modifier};
}

export function hordeWaveComposition(wave,difficultyId='easy'){
 const pacing=hordePacing(difficultyId),index=Math.max(1,Math.round(wave));
 const row=HORDE_COMPOSITION[Math.min(index-1,HORDE_COMPOSITION.length-1)];
 const overflow=Math.max(0,index-HORDE_COMPOSITION.length);
 const counts={};
 for(const kind of HORDE_TYPES)counts[kind]=0;
 for(const [kind,base] of Object.entries(row)){if(kind==='elite'||!(kind in counts))continue;counts[kind]+=Math.round((base||0)*pacing.countScale);}
 counts.husk+=Math.floor(overflow*pacing.growth);
 let total=HORDE_TYPES.reduce((sum,kind)=>sum+counts[kind],0);
 if(total>pacing.maxAlive){
  for(const kind of [...HORDE_TYPES].reverse()){
   if(kind==='husk'||total<=pacing.maxAlive)continue;
   const cut=Math.min(counts[kind],total-pacing.maxAlive);
   counts[kind]-=cut;total-=cut;
  }
 }
 const elite=Boolean(pacing.eliteEvery)&&index%pacing.eliteEvery===0;
 return {...counts,elite};
}

export const hordeWaveSize = (wave,difficulty='easy') => {
 const composition=hordeWaveComposition(wave,difficulty);
 return HORDE_TYPES.reduce((sum,kind)=>sum+(composition[kind]||0),0);
};

// Endless scoring. A cleared wave pays a base value that grows with the wave
// index and the difficulty multiplier; boss waves pay a flat bonus. The formula
// is pure integer arithmetic so a run's score is reproducible from its wave
// history alone. `hordeBossWave` is the single source of truth for when a
// champion takes the field: bounded runs use the modifier cycle, endless runs
// escalate a boss every fifth wave from wave five.
export const HORDE_BOSS_BONUS = 500;
export const hordeWaveScore = (wave,difficulty='easy') => {
 const index=Math.max(1,Math.round(wave)),pacing=hordePacing(difficulty);
 return Math.round((100+index*25)*pacing.countScale);
};
export const hordeBossWave = (wave,{endless=false}={}) => {
 const index=Math.max(1,Math.round(wave));
 if(endless)return index>=5&&index%5===0;
 return hordeWaveModifier(index).id==='champion';
};
export const hordeWaveScoreTotal = (wave,difficulty='easy',{endless=false}={}) => {
 const index=Math.max(1,Math.round(wave));
 let total=0;
 for(let w=1;w<=index;w++)total+=hordeWaveScore(w,difficulty)+(hordeBossWave(w,{endless})?HORDE_BOSS_BONUS:0);
 return total;
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

// A horde run banks its final record once, at the moment it ends, so the
// end-of-run summary is a pure read of `state.summary` and never depends on
// later frame state. Bounded and endless runs share the same shape.
function hordeSummary(match,state,outcome){
 const player=match.actors[0];
 return {outcome,wave:state.wave||0,target:state.waveTarget||0,endless:state.endless===true,score:state.score||0,bestWave:state.bestWave||0,kills:player?.frags||0,deaths:player?.deaths||0,elapsed:state.elapsed||0,lives:state.lives||0,upgrades:(state.upgrades||[]).length};
}
function win(match,state,text){if(match.over)return;state.phase='won';state.winner=0;state.message={text,at:match.time};match.objectiveState.winner=0;match.teamScores[0]=Math.max(match.teamScores[0]||0,1);if(state.kind==='horde'){state.summary=hordeSummary(match,state,'won');match.emit('horde-summary',{...state.summary});}match.emit('mission-won',{text});match.endMatch('objective');}
function lose(match,state,text){if(match.over)return;state.phase='lost';state.winner=1;state.message={text,at:match.time};match.objectiveState.winner=1;match.teamScores[1]=Math.max(match.teamScores[1]||0,1);if(state.kind==='horde'){state.summary=hordeSummary(match,state,'lost');match.emit('horde-summary',{...state.summary});}match.emit('mission-lost',{text});match.endMatch('objective');}

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
  const state={kind:mode,playerId:0,phase:'intermission',timer:0,elapsed:0,lives:2,deaths:0,nextId:1,enemies:[],allies:[],groups:{},entered:{},everHadEnemies:false,boss:null,winner:null,message:null,objective:'',script:[],fired:{},defendProgress:0,lastEvent:0,steps:[],stepIndex:0,stepElapsed:0,holdProgress:0,waypoint:null,storyLine:null,bark:null,bossPhase:0,bossPhaseName:null,bossPhaseMax:1,summonCount:0,checkpoint:null,upgrades:[],upgradeOffers:0,pendingUpgrade:null,upgradeSelected:null,nextUpgradeWave:HORDE_UPGRADE_GAPS[0],upgradeGapIndex:0,waveModifier:null,endless:false,score:0,bestWave:0,waveSize:0,summary:null};
  let resumeStep=null;
  if(mode==='horde'){
   const pacing=hordePacing(match.config.difficulty);
   // Endless is opt-in so the bounded wave-target run stays the default. An
   // endless run has no wave target; it ends only when the player's lives run
   // out (or the clock expires), and banks a wave/score record for the summary.
   state.endless=match.config.endless===true;
   state.waveTarget=state.endless?0:Math.max(1,Math.round(match.config.fragLimit||10));
   state.wave=0;state.timer=pacing.intermission;state.phase='intermission';state.lives=3;
   state.objective=state.endless?'Survive as long as you can. Every wave pays score.':`Survive ${state.waveTarget} hostile waves.`;
  } else {
  const mission=missionFor(match.config.mission);
  state.mission=mission;state.phase='active';state.lives=mission.lives??3;
  state.objective=mission.objective;state.win=snapZone(match,mission.win);state.timer=0;
  state.script=(mission.script||[]).map((event,index)=>({id:event.id??`${mission.id}-script-${index}`,...event}));
  for(const event of state.script)if(event.when==='player-in-zone')Object.assign(event,snapZone(match,event));
  state.steps=(mission.steps||[]).map(step=>snapStep(match,step));
  // The boss phase pip strip needs to know how many phases the mission authors.
  const scanPhases=actions=>{for(const action of actions||[])if(Number.isFinite(action?.bossPhase))state.bossPhaseMax=Math.max(state.bossPhaseMax,Math.max(1,Math.round(action.bossPhase)));};
  for(const event of state.script)scanPhases([event]);
  for(const step of state.steps){scanPhases(step.onStart);scanPhases(step.onComplete);}
  const player=match.actors[0];
  if(Number.isFinite(match.config.checkpoint))resumeStep=Math.round(match.config.checkpoint);
  if(player&&mission.start){placeAt(match,player,mission.start.x,mission.start.z);if(Number.isFinite(mission.start.yaw)){player.yaw=mission.start.yaw;player.bodyYaw=mission.start.yaw;}}
 }
 match.modeState=state;
 if(mode==='campaign'&&resumeStep!==null)resumeSinglePlayer(match,resumeStep);
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
 state.wave+=1;state.phase='wave';state.timer=0;state.enemies=[];state.boss=null;state.bossPhase=0;state.bossPhaseName=null;
 const plan=hordeWavePlan(state.wave,match.config.difficulty,{endless:state.endless===true}),composition=plan.counts,modifier=plan.modifier;
 state.waveModifier={id:modifier.id,name:modifier.name,description:modifier.description};
 state.bestWave=Math.max(state.bestWave||0,state.wave);
 const group=`wave-${state.wave}`;
 const eliteType=composition.bulwark>0?'bulwark':composition.brute>0?'brute':composition.mortar>0?'mortar':composition.overseer>0?'overseer':null;
 let count=0;
 // Iterate the planned keys, not the base HORDE_TYPES table, so modifier
 // twists can inject archetypes (lancer/sentinel) or a champion boss that is
 // not part of the standing composition.
 for(const kind of Object.keys(composition)){
  const amount=composition[kind];
  if(kind==='elite'||kind==='boss'||!Number.isFinite(amount)||amount<=0)continue;
  const size=Math.round(amount);
  spawnGroup(match,state,{type:kind,count:size,group,elite:composition.elite&&kind===eliteType},{team:1});
  count+=size;
 }
 if(state.boss!=null){const boss=actorById(match,state.boss);if(boss)state.bossPhaseMax=Math.max(state.bossPhaseMax||1,bossMaxPhase(boss.npcType));}
 match.emit('horde-wave',{wave:state.wave,target:state.waveTarget,count,elite:Boolean(composition.elite),boss:Boolean(composition.boss),modifier:modifier.id,modifierName:modifier.name});
 match.emit('horde-modifier',{wave:state.wave,id:modifier.id,name:modifier.name,description:modifier.description});
}

// Applies one POWERUPS entry as a run-long horde blessing. The timed powerup
// pipeline drives the actual stat change; the timer is stretched so the buff
// survives the next wave and is refreshed again on every resupply.
function grantHordeUpgrade(match,player,id){
 if(!player||player.health<=0)return false;
 const powerup=POWERUPS.find(entry=>entry.id===id);
 if(!powerup)return false;
 match.applyPowerup(player,id);
 if(player.powerups[id]!==undefined)player.powerups[id]=Math.max(player.powerups[id],(powerup.duration||0)*3);
 if(typeof match.refreshPowerups==='function')match.refreshPowerups(player);
 return true;
}

export function resupplyHorde(match,state){
 const player=match.actors[0];
 if(!player||player.health<=0)return false;
 player.health=player.maxHealth;
 player.armor=Math.max(player.armor||0,100);
 for(let index=0;index<player.ammo.length;index++){
  const amount=player.ammo[index];
  if(index!==player.weapon&&amount!==Infinity&&!(amount>0))continue;
  const weapon=typeof match.weaponForIndex==='function'?match.weaponForIndex(player,index):null;
  const cap=weapon?.cap;
  if(amount===Infinity||!Number.isFinite(cap))player.ammo[index]=Infinity;
  else player.ammo[index]=Math.max(amount,cap);
 }
 for(const id of state.upgrades||[])grantHordeUpgrade(match,player,id);
 match.emit('horde-resupply',{wave:state.wave,health:player.health,armor:player.armor,upgrades:(state.upgrades||[]).length});
 return true;
}

export function offerHordeUpgrade(match,state){
 if(!state||state.kind!=='horde')return null;
 const choices=hordeUpgradeChoices(state.upgradeOffers||0);
 state.upgradeOffers=(state.upgradeOffers||0)+1;
 state.pendingUpgrade={wave:state.wave,choices};
 state.upgradeGapIndex=((state.upgradeGapIndex||0)+1)%HORDE_UPGRADE_GAPS.length;
 state.nextUpgradeWave=state.wave+HORDE_UPGRADE_GAPS[state.upgradeGapIndex];
 match.emit('horde-upgrade',{wave:state.wave,choices:[...choices],count:choices.length});
 return choices;
}

export function selectHordeUpgrade(match,id){
 const state=match.modeState;
 if(!state||state.kind!=='horde')return false;
 const pending=state.pendingUpgrade;
 if(!pending||!pending.choices.includes(id)||!hordeUpgradeInfo(id))return false;
 state.upgrades=[...(state.upgrades||[]),id];
 state.pendingUpgrade=null;
 state.upgradeSelected={id,wave:state.wave,at:match.time};
 const player=match.actors[0];
 if(player)grantHordeUpgrade(match,player,id);
 match.emit('horde-upgrade-selected',{id,wave:state.wave,count:state.upgrades.length});
 return true;
}

function stepHorde(match,state,dt){
 if(state.phase==='intermission'){
  state.timer=Math.max(0,state.timer-dt);
  if(state.timer<=0)startWave(match,state);
  return;
 }
 if(state.phase!=='wave')return;
 if(aliveEnemies(match,state)>0)return;
 const bossWave=hordeBossWave(state.wave,{endless:state.endless===true});
 const gained=hordeWaveScore(state.wave,match.config.difficulty)+(bossWave?HORDE_BOSS_BONUS:0);
 state.score=(state.score||0)+gained;
 match.emit('horde-wave-cleared',{wave:state.wave,score:state.score,gained});
 resupplyHorde(match,state);
 if(!state.endless&&state.wave>=state.waveTarget){win(match,state,`You survived ${state.waveTarget} waves.`);return;}
 if(state.wave>=state.nextUpgradeWave)offerHordeUpgrade(match,state);
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
 if(Number.isFinite(action.bossPhase)){state.bossPhase=Math.max(0,Math.round(action.bossPhase));state.bossPhaseMax=Math.max(state.bossPhaseMax||1,state.bossPhase);if(action.name)state.bossPhaseName=action.name;match.emit('boss-phase',{phase:state.bossPhase,name:action.name||null});}
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

// Ticks the role abilities of the new enemy archetypes. Deterministic and
// allocation-light: one pass for auras, one for support pulses, one for sapper
// fuses. Every bonus is recomputed from a stored base each frame so buffs never
// compound when auras overlap.
function updateEnemyRoles(match,state,dt){
 const ids=state.enemies;
 if(!ids||!ids.length)return;
 const allies=[];
 for(const id of ids){const actor=actorById(match,id);if(actor&&actor.health>0)allies.push(actor);}
 if(!allies.length)return;
 for(const actor of allies){actor.auraDamage=1;actor.auraSpeed=1;}
 for(const leader of allies){
  const aura=leader.npcLeader;if(!aura)continue;
  for(const ally of allies){
   if(ally===leader)continue;
   if(Math.hypot(ally.x-leader.x,ally.z-leader.z)>aura.radius)continue;
   if(aura.damageBonus)ally.auraDamage=Math.max(ally.auraDamage,1+aura.damageBonus);
   if(aura.speedBonus)ally.auraSpeed=Math.max(ally.auraSpeed,1+aura.speedBonus);
  }
  if(Number.isFinite(leader.auraWindup)){
   leader.auraWindup-=dt;
   if(leader.auraWindup<=0){leader.auraWindup=undefined;match.emit('overseer-aura',{actor:leader.id,x:leader.x,z:leader.z,radius:aura.radius,damageBonus:aura.damageBonus,speedBonus:aura.speedBonus});}
   continue;
  }
  if(!Number.isFinite(leader.auraTimer))leader.auraTimer=aura.interval??4;
  leader.auraTimer-=dt;
  if(leader.auraTimer<=0){leader.auraTimer=aura.interval??4;leader.auraWindup=aura.telegraph??.6;match.emit('enemy-telegraph',{kind:'overseer',actor:leader.id,x:leader.x,z:leader.z,radius:aura.radius,duration:leader.auraWindup});}
 }
 for(const mender of allies){
  const aura=mender.npcSupport;if(!aura)continue;
  if(Number.isFinite(mender.abilityWindup)){
   mender.abilityWindup-=dt;
   if(mender.abilityWindup<=0){
    mender.abilityWindup=undefined;let healed=0;
    for(const ally of allies){
     if(ally===mender)continue;
     if(Math.hypot(ally.x-mender.x,ally.z-mender.z)>aura.radius)continue;
     if(ally.health<ally.maxHealth){const amount=Math.min(ally.maxHealth-ally.health,aura.heal);ally.health+=amount;healed+=amount;}
     if(aura.damageBonus)ally.auraDamage=Math.max(ally.auraDamage,1+aura.damageBonus);
    }
    match.emit('mender-heal',{actor:mender.id,x:mender.x,z:mender.z,radius:aura.radius,healed});
   }
   continue;
  }
  if(!Number.isFinite(mender.abilityTimer))mender.abilityTimer=aura.interval;
  mender.abilityTimer-=dt;
  if(mender.abilityTimer>0)continue;
  mender.abilityTimer=aura.interval;mender.abilityWindup=aura.telegraph??.5;
  match.emit('enemy-telegraph',{kind:'mender',actor:mender.id,x:mender.x,z:mender.z,radius:aura.radius,duration:mender.abilityWindup});
 }
 for(const actor of allies){
  const base=Number.isFinite(actor.auraBaseDamage)?actor.auraBaseDamage:(actor.auraBaseDamage=Number.isFinite(actor.damageMultiplier)?actor.damageMultiplier:1);
  const flank=actor.npcFlank,burning=Boolean(flank)&&Number.isFinite(actor.flankerBurstUntil)&&actor.flankerBurstUntil>state.elapsed;
  actor.damageMultiplier=base*(actor.auraDamage||1)*(burning?1+(flank.damageBonus??0):1);
  actor.speedMultiplier=(actor.auraSpeed||1)*(burning?1+(flank.speedBonus??0):1);
 }
 const player=match.actors[0];
 if(!player||match.over)return;
 // Flankers seek a nav node that breaks the player's sightline, hold it for a
 // beat, then burst out with a speed/damage spike. coverPoint() is pure and
 // stable, so the chosen cover is identical for identical sim state.
 for(const flanker of allies){
  const flank=flanker.npcFlank;if(!flank)continue;
  if(Number.isFinite(flanker.flankWindup)){
   flanker.flankWindup-=dt;
   if(flanker.flankWindup<=0){
    flanker.flankWindup=undefined;
    flanker.flankerBurstUntil=state.elapsed+(flank.burst??.8);
    flanker.flankCooldown=flank.cooldown??6;
    match.emit('enemy-flank',{actor:flanker.id,x:flanker.x,z:flanker.z,speedBonus:flank.speedBonus??.55,damageBonus:flank.damageBonus??.3,point:flanker.flankPoint??null});
   }
   continue;
  }
  if(!Number.isFinite(flanker.flankCooldown))flanker.flankCooldown=flank.cooldown??6;
  flanker.flankCooldown-=dt;
  if(flanker.flankCooldown>0||player.health<=0)continue;
  const distance=Math.hypot(player.x-flanker.x,player.z-flanker.z);
  if(distance>(flank.chargeDistance??18))continue;
  const cover=coverPoint(match,flanker,player);
  if(!cover)continue;
  flanker.flankPoint={x:cover.x,y:cover.y??0,z:cover.z};
  flanker.flankWindup=flank.telegraph??.5;
  if(flanker.bot){flanker.bot.destination={x:cover.x,y:cover.y??0,z:cover.z};flanker.bot.route=[];flanker.bot.think=Math.max(flanker.bot.think||0,flank.hold??1.1);}
  match.emit('enemy-telegraph',{kind:'flanker',actor:flanker.id,x:cover.x,z:cover.z,radius:2,duration:flanker.flankWindup});
 }
 // Shield-bearers pulse a temporary front shield onto allies inside the
 // formation, telegraphed first so the clump can be broken by fire or movement.
 for(const sentinel of allies){
  const wall=sentinel.npcPhalanx;if(!wall)continue;
  if(Number.isFinite(sentinel.phalanxWindup)){
   sentinel.phalanxWindup-=dt;
   if(sentinel.phalanxWindup<=0){
    sentinel.phalanxWindup=undefined;sentinel.phalanxTimer=wall.interval??3.4;let shielded=0;
    for(const ally of allies){
     if(ally===sentinel)continue;
     if(Math.hypot(ally.x-sentinel.x,ally.z-sentinel.z)>wall.radius)continue;
     ally.temporaryShield=Math.min(wall.cap??90,(ally.temporaryShield||0)+(wall.shield??45));
     shielded++;
    }
    match.emit('phalanx-shield',{actor:sentinel.id,x:sentinel.x,z:sentinel.z,radius:wall.radius,shield:wall.shield??45,shielded});
   }
   continue;
  }
  if(!Number.isFinite(sentinel.phalanxTimer))sentinel.phalanxTimer=wall.interval??3.4;
  sentinel.phalanxTimer-=dt;
  if(sentinel.phalanxTimer>0)continue;
  sentinel.phalanxTimer=wall.interval??3.4;
  sentinel.phalanxWindup=wall.telegraph??.55;
  match.emit('enemy-telegraph',{kind:'phalanx',actor:sentinel.id,x:sentinel.x,z:sentinel.z,radius:wall.radius,duration:sentinel.phalanxWindup});
 }
 for(const sapper of allies){
  const bomb=sapper.npcSapper;if(!bomb)continue;
  if(!Number.isFinite(sapper.sapperCooldown))sapper.sapperCooldown=bomb.cooldown??1.2;
  const distance=Math.hypot(player.x-sapper.x,player.z-sapper.z);
  if(!Number.isFinite(sapper.sapperFuse)){
   sapper.sapperCooldown=Math.max(0,sapper.sapperCooldown-dt);
   if(player.health>0&&distance<=bomb.trigger&&sapper.sapperCooldown<=0){sapper.sapperFuse=bomb.fuse;match.emit('enemy-telegraph',{kind:'sapper',actor:sapper.id,x:sapper.x,z:sapper.z,radius:bomb.radius,duration:bomb.telegraph??bomb.fuse});}
   continue;
  }
  sapper.sapperFuse-=dt;
  if(sapper.sapperFuse>0)continue;
  const hit=player.health>0&&distance<=bomb.radius;
  if(hit)match.damage(player,bomb.damage*(1-distance/bomb.radius),sapper);
  sapper.health=0;sapper.dead=NPC_DEAD;
  match.emit('enemy-detonate',{actor:sapper.id,x:sapper.x,z:sapper.z,radius:bomb.radius,hit});
 }
 // Artillery batteries mark a spot, telegraph for a full second, then drop an
 // AoE on that fixed point. Moving out of the circle avoids the shell, so the
 // counterplay is footwork instead of cover.
 for(const gunner of allies){
  const gun=gunner.npcArtillery;if(!gun)continue;
  if(Number.isFinite(gunner.artilleryWindup)){
   gunner.artilleryWindup-=dt;
   if(gunner.artilleryWindup<=0){
    gunner.artilleryWindup=undefined;
    const mark=gunner.artilleryMark;gunner.artilleryMark=null;
    const distance=mark?Math.hypot(player.x-mark.x,player.z-mark.z):Infinity,hit=Boolean(mark)&&player.health>0&&distance<=gun.radius;
    if(hit)match.damage(player,gun.damage*(1-distance/gun.radius),gunner);
    match.emit('enemy-artillery',{actor:gunner.id,x:mark?.x??gunner.x,z:mark?.z??gunner.z,radius:gun.radius,damage:gun.damage,hit});
   }
   continue;
  }
  if(!Number.isFinite(gunner.artilleryCooldown))gunner.artilleryCooldown=gun.cooldown??5.5;
  gunner.artilleryCooldown-=dt;
  if(gunner.artilleryCooldown>0)continue;
  if(!player||player.health<=0)continue;
  const range=Math.hypot(player.x-gunner.x,player.z-gunner.z);
  if(range>gun.maxRange||range<gun.minRange)continue;
  gunner.artilleryCooldown=gun.cooldown??5.5;
  gunner.artilleryWindup=gun.telegraph??1.2;
  gunner.artilleryMark={x:player.x,z:player.z};
  match.emit('enemy-telegraph',{kind:'artillery',actor:gunner.id,x:player.x,z:player.z,radius:gun.radius,duration:gunner.artilleryWindup});
 }
 // Bosses escalate through named phases: each overlay rewrites speed and damage
 // and swaps in a harder telegraphed ground-slam. The phase counter is authored
 // by the campaign script (`bossPhase`), so the mechanical profile and the HUD
 // pip strip stay in lockstep without any per-frame allocation.
 for(const boss of allies){
  if(boss.isBoss!==true)continue;
  const phase=Math.max(1,Math.round(state.bossPhase||boss.bossPhase||1));
  const profile=bossPhaseProfile(boss.npcType,phase);
  boss.bossPhase=phase;
  const damageBase=Number.isFinite(boss.bossBaseDamage)?boss.bossBaseDamage:(boss.bossBaseDamage=Number.isFinite(boss.auraBaseDamage)?boss.auraBaseDamage:(boss.damageMultiplier||1));
  const speedBase=Number.isFinite(boss.bossBaseSpeed)?boss.bossBaseSpeed:(boss.bossBaseSpeed=Number.isFinite(boss.speedMultiplier)?boss.speedMultiplier:1);
  if(profile){
   boss.damageMultiplier=damageBase*(boss.auraDamage||1)*(profile.damageMult??1);
   boss.speedMultiplier=speedBase*(boss.auraSpeed||1)*(profile.speedMult??1);
  }
  // Summoner bosses (the Harbinger) birth adds on a cooldown. Count scales with
  // the boss phase and the live cap keeps the wave bounded, so the mechanic adds
  // pressure without letting a fight run away from the player.
  const summon=boss.npcSummon;
  if(summon){
   if(!Number.isFinite(boss.summonTimer))boss.summonTimer=summon.interval??11;
   boss.summonTimer-=dt;
   if(boss.summonTimer<=0){
    boss.summonTimer=summon.interval??11;
    if(aliveEnemies(match,state)<(summon.maxAlive??28)){
     const count=Math.max(1,Math.round((summon.count??2)+((boss.bossPhase??1)-1)));
     const angle=(boss.id%4)*(Math.PI/2),radius=summon.radius??12;
     const x=boss.x+Math.cos(angle)*radius,z=boss.z+Math.sin(angle)*radius;
     const group=`boss-summon-${boss.id}-${++state.summonCount}`;
     spawnGroup(match,state,{type:summon.type||'husk',count,group,x,z,zone:{x:boss.x,z:boss.z,r:radius,leash:radius+8,kind:'hold'}},{team:1});
     match.emit('boss-summon',{actor:boss.id,x,z,unit:summon.type||'husk',count});
    }
   }
  }
  const stomp=profile?.stomp;
  if(!stomp)continue;
  if(Number.isFinite(boss.bossStompWindup)){
   boss.bossStompWindup-=dt;
   if(boss.bossStompWindup<=0){
    boss.bossStompWindup=undefined;
    const mark=boss.bossStompMark;boss.bossStompMark=null;
    const distance=mark?Math.hypot(player.x-mark.x,player.z-mark.z):Infinity,hit=Boolean(mark)&&player.health>0&&distance<=stomp.radius;
    if(hit)match.damage(player,stomp.damage*(1-distance/stomp.radius),boss);
    match.emit('boss-slam',{actor:boss.id,x:mark?.x??boss.x,z:mark?.z??boss.z,radius:stomp.radius,damage:stomp.damage,hit,phase});
   }
   continue;
  }
  if(!Number.isFinite(boss.bossStompCooldown))boss.bossStompCooldown=stomp.cooldown??6;
  boss.bossStompCooldown-=dt;
  if(boss.bossStompCooldown>0||player.health<=0)continue;
  const range=Math.hypot(player.x-boss.x,player.z-boss.z),minRange=stomp.minRange??0,maxRange=Math.max(stomp.radius,stomp.maxRange??stomp.radius);
  if(range>maxRange||range<minRange)continue;
  boss.bossStompCooldown=stomp.cooldown??6;
  boss.bossStompWindup=stomp.telegraph??1;
  boss.bossStompMark={x:player.x,z:player.z};
  match.emit('enemy-telegraph',{kind:'boss',actor:boss.id,x:player.x,z:player.z,radius:stomp.radius,duration:boss.bossStompWindup,phase});
 }
}

export function resumeSinglePlayer(match,stepOrCheckpoint){
 const state=match.modeState;
 if(!state||state.kind!=='campaign'||!state.steps.length)return false;
 const raw=typeof stepOrCheckpoint==='object'&&stepOrCheckpoint!==null?stepOrCheckpoint.step:stepOrCheckpoint;
 const step=Math.max(0,Math.min(state.steps.length,Math.round(Number(raw)||0)));
 state.stepIndex=step;state.stepElapsed=0;state.holdProgress=0;state.entered={};state.defendProgress=0;
 state.checkpoint=step;
 const player=match.actors[0];
 if(player&&state.mission?.start){placeAt(match,player,state.mission.start.x,state.mission.start.z);if(Number.isFinite(state.mission.start.yaw)){player.yaw=state.mission.start.yaw;player.bodyYaw=state.mission.start.yaw;}}
 state.waypoint=null;match.waypoint=null;
 if(step<state.steps.length&&state.steps[step].text)state.objective=state.steps[step].text;
 match.emit('singleplayer-checkpoint',{missionId:state.mission?.id??null,step});
 return true;
}

export function applyCampaignCheckpoint(match,checkpoint){
 if(!checkpoint||typeof checkpoint!=='object')return false;
 const state=match.modeState;
 if(!state||state.kind!=='campaign')return false;
 if(checkpoint.missionId&&state.mission&&checkpoint.missionId!==state.mission.id)return false;
 return resumeSinglePlayer(match,checkpoint);
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
 updateEnemyRoles(match,state,dt);
 if(match.over)return;
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
 const pending=state.pendingUpgrade;
 const upgrades=pending?pending.choices.map(hordeUpgradeInfo).filter(Boolean):[];
 const bossPhase=state.bossPhase||0,bossPhaseTotal=Math.max(1,state.bossPhaseMax||1);
 const checkpoint=Number.isFinite(state.checkpoint)?{step:Math.max(0,Math.round(state.checkpoint)),missionId:state.mission?.id??null}:null;
 return {kind:state.kind,phase:state.phase,elapsed:state.elapsed,wave:state.wave||0,waveTarget:state.waveTarget||0,endless:state.endless===true,score:state.score||0,bestWave:state.bestWave||0,summary:state.summary?{...state.summary}:null,waveTimer:state.timer||0,waveModifier:state.waveModifier?{...state.waveModifier}:null,enemiesAlive,enemiesTotal:state.enemies.length,kills:player?.frags||0,deaths:player?.deaths||0,lives:state.lives,objective:state.objective||'',message:state.message&&match.time-state.message.at<5?state.message.text:'',story,bark,bossPhase,bossPhaseName:state.bossPhaseName||null,bossPhaseTotal,waypoint:state.waypoint?{id:state.waypoint.id,x:state.waypoint.x,z:state.waypoint.z,label:state.waypoint.label}:null,winner:state.winner??null,mission:state.mission?{id:state.mission.id,name:state.mission.name,tag:state.mission.tag,chapter:state.mission.chapter||'',index:missionIndex,total:CAMPAIGN_MISSIONS.length,brief:state.mission.brief,intro:state.mission.intro||null,outro:state.mission.outro||null}:null,steps:state.steps.map((item,index)=>({id:item.id,label:item.label||'',text:item.text||'',detail:item.detail||'',active:index===state.stepIndex,done:index<state.stepIndex})),hold,boss:boss?{name:boss.name,hp:Math.max(0,Math.round(boss.health)),maxHp:boss.maxHealth,alive:boss.health>0,phase:bossPhase,phaseName:state.bossPhaseName||null,phases:bossPhaseTotal}:null,checkpoint,upgrades,upgradeWave:pending?pending.wave:null,upgradeSelected:state.upgradeSelected?.id??null,upgradeCount:(state.upgrades||[]).length,defend:state.win?.kind==='defend'?{seconds:state.win.seconds??30,progress:Math.min(state.win.seconds??30,Math.round(state.defendProgress||0))}:null};
}
