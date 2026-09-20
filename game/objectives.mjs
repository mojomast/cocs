import {RULES} from './data.mjs';
import {floorAt} from './core.mjs';
import {modeRule} from './config.mjs';
import {stepAssault,assignAssaultTeams,assaultActiveSector} from './assault.mjs';
import {stepPayload,standing} from './payload.mjs';
import {stepCocs} from './cocs.mjs';
import {TOOL_USE} from './operator-verbs.mjs';
// Qwen's Tool Use rides timed objective progress (cap 1.35x, never flag
// pickup/capture, §3.2/§4.7). One helper so every mode uses the same source.
const toolUseMultiplier=actor=>TOOL_USE.interactionMultiplier(actor?.verbState,{kind:'objective'});
const bestToolUse=(actors)=>{let best=1;for(const actor of actors||[])if(actor&&actor.health>0)best=Math.max(best,toolUseMultiplier(actor));return best;};
export function updateAssault(match,dt){const state=match.objectiveState,rules=modeRule(match.config.mode);assignAssaultTeams(state);const sector=assaultActiveSector(state),attacker=state.attacker??0,inside=actor=>actor.health>0&&actor.team===attacker&&Math.hypot(actor.x-sector.x,actor.z-sector.z)<=sector.radius&&Math.abs((actor.y??0)-(Number.isFinite(sector.y)?sector.y:0))<=5;if(sector)for(const actor of match.actors)if(inside(actor))actor.scoreStats.objectiveTime+=dt*toolUseMultiplier(actor);const result=stepAssault(state,match.actors,dt,{rules,emit:(type,data)=>match.emit(type,data),teamScores:match.teamScores,scoreLimit:match.config.fragLimit});if(result.scored>0&&sector)for(const actor of match.actors)if(inside(actor))actor.scoreStats.objectiveCaptures++;if(result.breached||state.winner===state.attacker){state.winner=state.attacker;match.endMatch('objective');}}

export function updatePayload(match,dt){const state=match.objectiveState,rules=modeRule(match.config.mode),attacker=state.attacker??0,defender=state.defender??1;for(const actor of match.actors)if(actor.team===attacker&&standing(state,actor))actor.scoreStats.objectiveTime+=dt*toolUseMultiplier(actor);const result=stepPayload(state,match.actors,dt,{rules,emit:(type,data)=>match.emit(type,data),teamScores:match.teamScores,scoreLimit:match.config.fragLimit});
 // Defenders who are actually standing in the contest ring while the cart is
 // frozen earn objective time at the same rate as attackers, and entering the
 // contest emits one bucketed beat (the zone `objectiveEventState` pattern).
 const contested=state.contested===true,eventState=match.objectiveEventState.get('payload')||{bucket:0},bucket=contested?1:0;
 if(bucket!==eventState.bucket){eventState.bucket=bucket;if(bucket===1){const position=state.position||{x:0,z:0};match.emit('payload-contest',{team:defender,attacker,defender,x:position.x,z:position.z});}}
 match.objectiveEventState.set('payload',eventState);
 if(contested)for(const actor of match.actors)if(actor.team===defender&&standing(state,actor))actor.scoreStats.objectiveTime+=dt*toolUseMultiplier(actor);
 if(result.checkpoint){for(const actor of match.actors)if(actor.team===attacker&&standing(state,actor,1))actor.scoreStats.objectiveCaptures++;}if(result.delivered||state.winner===state.attacker){state.winner=state.attacker;match.teamScores[state.attacker]=Math.max(match.teamScores[state.attacker]||0,match.config.fragLimit);match.endMatch('objective');}}

// Team Elimination is a ticket pool: each team owns a shared count of lives and
// every death spends one. The first side to hit zero lives loses; kills are kept
// as the tie-break stat while `teamScores` mirrors the surviving tickets.
export function updateElimination(match,dt=RULES.dt){const state=match.objectiveState;if(!state||state.kind!=='elimination'||match.over)return;const rules=modeRule(match.config.mode),initial=state.livesPerTeam,used={0:0,1:0},elim={0:0,1:0};for(const a of match.actors){if(a.team!==0&&a.team!==1)continue;used[a.team]+=a.deaths||0;elim[a.team]+=a.frags||0;a.scoreStats.eliminations=a.frags||0;a.eliminations=a.frags||0;}const previous=state.lives||{0:initial,1:initial},priorUsed=state.deaths||{0:0,1:0},attrition=state.attrition||(state.attrition={0:0,1:0}),attritionStart=Number.isFinite(rules.eliminationAttritionStart)?rules.eliminationAttritionStart:45,attritionEvery=Number.isFinite(rules.eliminationAttritionEvery)?rules.eliminationAttritionEvery:9;if(match.time>=attritionStart){if(!Number.isFinite(state.attritionTimer))state.attritionTimer=attritionEvery;state.attritionTimer-=dt;if(state.attritionTimer<=0){state.attritionTimer=attritionEvery;const behind=elim[0]===elim[1]?[0,1]:[elim[0]<elim[1]?0:1];for(const team of behind)attrition[team]+=1;}}const live=team=>Math.max(0,initial-used[team]-attrition[team]);state.lives={0:live(0),1:live(1)};state.deaths=used;state.eliminations=elim;match.teamScores[0]=state.lives[0];match.teamScores[1]=state.lives[1];for(const team of [0,1])if(state.lives[team]<previous[team])match.emit('elimination-life',{team,lives:state.lives[team],spent:used[team],eliminations:elim[team],attrition:attrition[team],cause:used[team]>(priorUsed[team]||0)?'death':'attrition'});const out0=state.lives[0]<=0,out1=state.lives[1]<=0;let winner=null;if(out0&&out1)winner=elim[0]>=elim[1]?0:1;else if(out0)winner=1;else if(out1)winner=0;if(winner!==null){state.winner=winner;match.endMatch('elimination');match.emit('elimination-win',{team:winner,lives:{...state.lives}});match.emit('objective-win',{team:winner,score:match.teamScores[winner]});return;}const deadline=match.config.timeLimit,sudden=rules.suddenDeathSeconds??20;if(!state.suddenDeath&&match.time>=deadline-sudden&&state.lives[0]===state.lives[1]){state.suddenDeath=true;state.suddenDeathTimer=sudden;match.emit('sudden-death',{mode:'elimination',time:match.time});}if(state.suddenDeath&&match.time<deadline&&state.lives[0]!==state.lives[1]){winner=state.lives[0]>state.lives[1]?0:1;state.winner=winner;state.tiebreak='sudden-death';match.endMatch('sudden-death');match.emit('elimination-win',{team:winner,lives:{...state.lives}});match.emit('objective-win',{team:winner,score:match.teamScores[winner]});return;}if(match.time>=deadline){if(state.lives[0]!==state.lives[1])winner=state.lives[0]>state.lives[1]?0:1;else if(elim[0]!==elim[1])winner=elim[0]>elim[1]?0:1;else{const frags=[0,1].map(team=>match.actors.reduce((sum,a)=>a.team===team?sum+(a.frags||0):sum,0));winner=frags[0]>=frags[1]?0:1;}state.winner=winner;state.tiebreak=state.tiebreak||'time';match.endMatch('time');match.emit('objective-tiebreak',{mode:'elimination',team:winner,lives:{...state.lives}});match.emit('objective-win',{team:winner,score:match.teamScores[winner]});}}

// Juggernaut tracks one powered role. The carrier banks points for surviving and
// for kills, and the role transfers to whoever kills them; time expiry awards the
// points leader. Points live on the objective so the snapshot stays deterministic.
export function updateJuggernaut(match,dt=RULES.dt){const state=match.objectiveState;if(!state||state.kind!=='juggernaut'||match.over)return;const rules=modeRule(match.config.mode),points=state.points||(state.points={});let jug=match.actors.find(a=>a.id===state.juggernautId&&a.health>0);if(!jug){const next=match.actors.filter(a=>a.health>0).sort((a,b)=>(points[b.id]||0)-(points[a.id]||0)||a.id-b.id)[0]||match.actors[0];if(next&&next.id!==state.juggernautId)match.setJuggernaut(next.id);jug=next;}if(jug&&jug.health>0)points[jug.id]=(points[jug.id]||0)+dt*(rules.juggernautRate??.75);for(const a of match.actors){a.points=points[a.id]||0;a.scoreStats.points=a.points;}const top=Math.max(0,...match.actors.map(a=>points[a.id]||0)),tops=match.actors.filter(a=>(points[a.id]||0)===top),unique=tops.length===1?tops[0].id:null;if(unique!==null&&top>=match.config.fragLimit){state.winner=unique;match.endMatch('objective');match.emit('juggernaut-win',{actor:unique,points:top});match.emit('objective-win',{actor:unique,score:top});return;}const deadline=match.config.timeLimit,sudden=rules.suddenDeathSeconds??20;if(!state.suddenDeath&&match.time>=deadline-sudden&&unique===null){state.suddenDeath=true;state.suddenDeathTimer=sudden;match.emit('sudden-death',{mode:'juggernaut',time:match.time});}if(state.suddenDeath&&match.time<deadline&&unique!==null){state.winner=unique;state.tiebreak='sudden-death';match.endMatch('sudden-death');match.emit('juggernaut-win',{actor:unique,points:top});match.emit('objective-win',{actor:unique,score:top});return;}if(match.time>=deadline){let leader=unique;if(leader===null){const ranked=[...match.actors].sort((a,b)=>(points[b.id]||0)-(points[a.id]||0)||(b.frags||0)-(a.frags||0)||a.id-b.id);leader=ranked[0]?.id??null;}state.winner=leader;state.tiebreak=state.tiebreak||'time';match.endMatch('time');match.emit('objective-tiebreak',{mode:'juggernaut',actor:leader,points:points[leader]||0});match.emit('objective-win',{actor:leader,score:points[leader]||0});return;}}

// Extraction is a live escort: a single VIP actor must be walked to the beacon
// while the escort team shadows them. The VIP only advances when a friendly is
// close, so the mode is about keeping the package moving rather than camping the
// pad. Losing the VIP or running out the clock hands the round to the hunters.
const extractionVip=(match,state)=>(state.vipId==null?null:(match.actors.find(a=>a.id===state.vipId)||null));
function spawnExtractionVip(match,state){
 let nextId=0;for(const a of match.actors)nextId=Math.max(nextId,a.id+1);
 const vip=match.actor(nextId,'claude','openclaw');
 vip.team=state.escortTeam;vip.isNpc=true;vip.isVip=true;vip.name='VIP';
 vip.npcProfile={health:260,armor:60,speedMult:.92,damageMult:.28,scale:1.08,color:'#ffe08a',accent:'#3a2a07',points:0};
 vip.meleeDamage=0;vip.bot=null;
 match.actors.push(vip);match.spawn(vip);
 state.vipId=nextId;
 match.emit('vip-deploy',{actor:nextId,team:vip.team});
 return vip;
}
function stepExtractionVip(match,state,dt){
 const vip=extractionVip(match,state);
 if(!vip||vip.health<=0)return;
 const near=match.actors.some(a=>a!==vip&&a.health>0&&a.team===state.escortTeam&&Math.hypot(a.x-vip.x,a.z-vip.z)<=state.escortRadius);
 if(!near)return;
 const dx=state.extract.x-vip.x,dz=state.extract.z-vip.z,d=Math.hypot(dx,dz);
 if(d<=1e-3)return;
 const step=Math.min(d,state.speed*dt),nx=vip.x+dx/d*step,nz=vip.z+dz/d*step,y=floorAt(nx,nz,match.arena);
 if(y===null)return;
 vip.x=nx;vip.z=nz;vip.y=y;vip.lastValid={x:nx,y,z:nz};vip.vx=0;vip.vz=0;
}
export function updateExtraction(match,dt=RULES.dt){
 const state=match.objectiveState;if(!state||state.kind!=='extraction'||match.over)return;
 let vip=extractionVip(match,state);
 if(!vip)vip=spawnExtractionVip(match,state);
 if(vip&&vip.health<=0){state.vipDead=true;state.winner=state.defenderTeam;match.teamScores[state.defenderTeam]=Math.max(match.teamScores[state.defenderTeam]||0,1);match.emit('vip-down',{actor:state.vipId,team:state.defenderTeam});match.emit('objective-win',{team:state.defenderTeam,score:match.teamScores[state.defenderTeam]});match.endMatch('objective');return;}
 stepExtractionVip(match,state,dt);
 const escorts=vip&&vip.health>0?match.actors.filter(a=>a!==vip&&a.health>0&&a.team===state.escortTeam&&Math.hypot(a.x-vip.x,a.z-vip.z)<=state.escortRadius):[];
 if(escorts.length)for(const a of escorts)a.scoreStats.objectiveTime+=dt*toolUseMultiplier(a);
 const inside=Boolean(vip)&&Math.hypot(vip.x-state.extract.x,vip.z-state.extract.z)<=state.escortRadius,toolRate=bestToolUse(escorts);
 state.progress=inside?Math.min(state.captureSeconds,(state.progress||0)+dt*toolRate):Math.max(0,(state.progress||0)-dt);
 if(state.progress>=state.captureSeconds){state.winner=state.escortTeam;match.teamScores[state.escortTeam]=Math.max(match.teamScores[state.escortTeam]||0,1);for(const a of escorts)a.scoreStats.objectiveCaptures++;match.emit('vip-extracted',{actor:state.vipId,team:state.escortTeam});match.emit('objective-win',{team:state.escortTeam,score:match.teamScores[state.escortTeam]});match.endMatch('objective');return;}
 if(match.time>=match.config.timeLimit){state.winner=state.defenderTeam;state.tiebreak='time';match.teamScores[state.defenderTeam]=Math.max(match.teamScores[state.defenderTeam]||0,state.progress);match.emit('objective-tiebreak',{mode:'extraction',team:state.defenderTeam,progress:state.progress});match.emit('objective-win',{team:state.defenderTeam,score:match.teamScores[state.defenderTeam]});match.endMatch('objective');}
}

// Holdout: a Domination variant. The shared capture loop keeps zone ownership
// current; this pass tracks, per team, how long it has continuously held a
// quorum of zones. Reaching the window wins the round. Quorum is always less
// than the zone count, so both sides can never qualify at once and the window
// can never deadlock.
export function updateHoldout(match,dt=RULES.dt){
 const state=match.objectiveState;if(!state||state.kind!=='domination'||!state.holdCount||match.over)return;
 const zones=state.zones||[],quorum=Math.min(state.holdCount,zones.length),window=state.holdSeconds||30,counts={0:0,1:0};
 for(const zone of zones)if(zone.owner===0||zone.owner===1)counts[zone.owner]++;
 const qualifying=[0,1].filter(team=>counts[team]>=quorum),progress=state.holdProgress||(state.holdProgress={0:0,1:0});
 const holdRate=team=>{let best=1;for(const actor of match.actors)if(actor.team===team&&actor.health>0&&zones.some(z=>z.owner===team&&Math.hypot(actor.x-z.x,actor.z-z.z)<=z.radius))best=Math.max(best,toolUseMultiplier(actor));return best;};
 for(const team of [0,1])progress[team]=qualifying.includes(team)?Math.min(window,progress[team]+dt*holdRate(team)):0;
 const leader=qualifying.length===1?qualifying[0]:null;
 if(leader!==null&&progress[leader]>=window){
  state.holdTeam=leader;state.winner=leader;match.teamScores[leader]=Math.max(match.teamScores[leader]||0,match.config.fragLimit);
  match.emit('holdout-win',{team:leader,held:counts[leader],window});
  match.emit('objective-win',{team:leader,score:match.teamScores[leader]});
  match.endMatch('objective');return;
 }
 const bucket=leader===null?-1:Math.floor(progress[leader]/5);
 if(bucket!==state.holdBucket){state.holdBucket=bucket;match.emit('holdout-progress',{team:leader,progress:leader===null?0:progress[leader],window,counts:{...counts},quorum});}
 // Time expiry resolves deterministically: most hold progress, then most zones
 // held, then team score. Setting `winner` here lets the snapshot report a side
 // even when the clock, not the window, ends the round.
 if(match.time>=match.config.timeLimit&&state.winner===null){
  const progressNow=state.holdProgress||{0:0,1:0};
  let winner=progressNow[0]===progressNow[1]?(counts[0]===counts[1]?(match.teamScores[0]>=match.teamScores[1]?0:1):(counts[0]>counts[1]?0:1)):(progressNow[0]>progressNow[1]?0:1);
  state.winner=winner;state.tiebreak='time';
  match.emit('objective-tiebreak',{mode:'holdout',team:winner,progress:{...progressNow},counts:{...counts}});
  match.emit('objective-win',{team:winner,score:match.teamScores[winner]});
  match.endMatch('time');
 }
}

// Uplink: a sequential KOTH race. The shared capture loop maintains the single
// active hill; when a team completes a capture the stage banks, the relay jumps
// to the next authored node, and the first team through every stage wins. If
// the clock runs out first, the generic time path decides on banked stages and
// hill time, so the match always terminates.
export function updateUplink(match,dt=RULES.dt){
 const state=match.objectiveState;if(!state||state.kind!=='koth'||!Array.isArray(state.stages)||match.over)return;
 const hill=state.zones[0];if(!hill)return;
 const owner=hill.owner===0||hill.owner===1?hill.owner:null;
 if(owner!==null&&owner!==state.prevOwner){
  state.stageCaptures[owner]=(state.stageCaptures[owner]||0)+1;
  match.emit('uplink-capture',{team:owner,stage:(state.stage||0)+1,stages:state.stageCount,captures:{...state.stageCaptures}});
  state.stage=(state.stage||0)+1;
  if(state.stage>=state.stageCount){
   const captures=state.stageCaptures,winner=captures[0]===captures[1]?(match.teamScores[0]>=match.teamScores[1]?0:1):(captures[0]>captures[1]?0:1);
   state.winner=winner;match.teamScores[winner]=Math.max(match.teamScores[winner]||0,state.stageCount);
   match.emit('uplink-win',{team:winner,stages:state.stageCount,captures:{...captures}});
   match.emit('objective-win',{team:winner,score:state.stageCount});
   match.endMatch('objective');return;
  }
  const next=state.stages[state.stage];
  hill.id=next.id;hill.x=next.x;hill.z=next.z;hill.radius=next.radius??hill.radius;if(Number.isFinite(next.y))hill.y=next.y;
  hill.owner=null;hill.captureTeam=null;hill.progress=0;hill.contested=false;
  match.objectiveEventState.delete(hill.id);
  match.emit('uplink-stage',{stage:state.stage+1,stages:state.stageCount,zone:hill.id,x:hill.x,z:hill.z});
  state.prevOwner=null;
  return;
 }
 state.prevOwner=owner;
 // Time expiry resolves deterministically: most stages banked, then hill time,
 // then team score. This guarantees a winner even if the relay never completes.
 if(match.time>=match.config.timeLimit&&state.winner===null){
  const captures=state.stageCaptures||{0:0,1:0};
  const winner=captures[0]===captures[1]?(match.teamScores[0]>=match.teamScores[1]?0:1):(captures[0]>captures[1]?0:1);
  state.winner=winner;state.tiebreak='time';
  match.emit('objective-tiebreak',{mode:'uplink',team:winner,captures:{...captures}});
  match.emit('objective-win',{team:winner,score:match.teamScores[winner]});
  match.endMatch('time');
 }
}

export function updateObjectives(match,dt=RULES.dt){const state=match.objectiveState;if(!state||match.over)return;if(state.kind==='cocs'){stepCocs(match,dt);return;}if(state.kind==='extraction'){updateExtraction(match,dt);return;}if(state.kind==='assault'){match.updateAssault(dt);return;}if(state.kind==='payload'){match.updatePayload(dt);return;}if(state.kind==='elimination'){updateElimination(match,dt);return;}if(state.kind==='juggernaut'){updateJuggernaut(match,dt);return;}if(state.kind==='koth'&&Array.isArray(state.rotation)&&state.rotation.length>1){state.rotationTimer=(state.rotationTimer??state.rotationEvery??30)-dt;if(state.rotationTimer<=0){state.rotationTimer=state.rotationEvery??30;state.rotationIndex=((state.rotationIndex??0)+1)%state.rotation.length;const point=state.rotation[state.rotationIndex],hill=state.zones[0];hill.id=point.id;hill.x=point.x;hill.z=point.z;hill.radius=point.radius??hill.radius;if(Number.isFinite(point.y))hill.y=point.y;hill.owner=null;hill.captureTeam=null;hill.progress=0;hill.contested=false;match.objectiveEventState.delete(hill.id);match.emit('hill-rotate',{zone:hill.id,x:hill.x,z:hill.z});}}const rules=modeRule(match.config.mode),scratch=state._zoneScratch||(state._zoneScratch={inside:[],teams:new Set()}),inside=scratch.inside,teams=scratch.teams;for(const zone of state.zones){inside.length=0;for(const a of match.actors)if(a.health>0&&Math.hypot(a.x-zone.x,a.z-zone.z)<=zone.radius&&Math.abs((a.y??0)-(Number.isFinite(zone.y)?zone.y:0))<=5)inside.push(a);teams.clear();let firstTeam;for(const a of inside){if(teams.size===0)firstTeam=a.team;teams.add(a.team);}const toolRate=team=>{let best=1;for(const actor of inside)if(actor.team===team)best=Math.max(best,toolUseMultiplier(actor));return best;};const previous=zone.progress,previousOwner=zone.owner,previousCaptureTeam=zone.captureTeam,previousContested=zone.contested===true;zone.contested=teams.size>1;const eventState=match.objectiveEventState.get(zone.id)||{progressBucket:-1,scoreBucket:-1};if(zone.contested&&!previousContested)inside.forEach(a=>a.scoreStats.objectiveContests++);if(zone.contested){if(zone.owner!==null){const rate=100*dt*toolRate(zone.owner)/(zone.captureSeconds||rules.objective?.captureSeconds||5);zone.progress=Math.max(0,zone.progress-rate*.75);if(zone.progress===0){const challenger=inside.find(a=>a.team!==previousOwner)?.team??null;zone.owner=null;zone.captureTeam=challenger;if(challenger!==null)inside.filter(a=>a.team===challenger).forEach(a=>a.scoreStats.objectiveNeutralizations++);match.emit('zone-neutralized',{zone:zone.id,team:challenger});}}}else if(teams.size===1){const team=firstTeam,rate=100*dt*toolRate(team)/(zone.captureSeconds||rules.objective?.captureSeconds||5);if(zone.owner===team){zone.progress=100;match.teamScores[team]+=dt;const occupants=inside.filter(a=>a.team===team);occupants.forEach(a=>a.scoreStats.objectiveTime+=dt*toolUseMultiplier(a)/occupants.length);const scoreBucket=Math.floor(match.teamScores[team]);if(scoreBucket!==eventState.scoreBucket){eventState.scoreBucket=scoreBucket;match.emit('zone-score',{zone:zone.id,team,score:match.teamScores[team]});}}else if(zone.owner!==null){zone.progress=Math.max(0,zone.progress-rate);if(zone.progress===0){zone.owner=null;zone.captureTeam=team;inside.filter(a=>a.team===team).forEach(a=>a.scoreStats.objectiveNeutralizations++);match.emit('zone-neutralized',{zone:zone.id,team});}}else{if(zone.captureTeam!==team){zone.captureTeam=team;zone.progress=0;}zone.progress=Math.min(100,zone.progress+rate);if(zone.progress>=100){zone.owner=team;zone.captureTeam=null;inside.filter(a=>a.team===team).forEach(a=>a.scoreStats.objectiveCaptures++);match.emit('zone-capture',{zone:zone.id,team,score:match.teamScores[team]});}}}const progressBucket=Math.floor(zone.progress);if(progressBucket!==eventState.progressBucket||zone.contested!==previousContested||zone.owner!==previousOwner||zone.captureTeam!==previousCaptureTeam){eventState.progressBucket=progressBucket;match.emit('zone-progress',{zone:zone.id,team:zone.captureTeam??zone.owner,progress:zone.progress,contested:zone.contested});}match.objectiveEventState.set(zone.id,eventState);const zoneBuff=rules.zoneBuffs?.[zone.id]??(state.kind==='koth'?rules.zoneBuff:null);if(zoneBuff&&zone.owner!==null)for(const a of inside)if(a.team===zone.owner)match.applyPowerup(a,zoneBuff);}if(state.holdCount){updateHoldout(match,dt);return;}if(Array.isArray(state.stages)){updateUplink(match,dt);return;}const reached=[0,1].filter(team=>match.teamScores[team]>=match.config.fragLimit);if(reached.length){const [t0,t1]=reached,tied=reached.length>1&&match.teamScores[t0]===match.teamScores[t1];if(!tied){const winner=reached.length===1?t0:(match.teamScores[t0]>match.teamScores[t1]?t0:t1);state.winner=winner;match.endMatch('objective');match.emit('objective-win',{team:winner,score:match.teamScores[winner]});}}}
