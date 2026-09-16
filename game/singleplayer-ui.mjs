// Presentation adapter for the single-player HUD and result screen. Keeps
// React components free of snapshot-shape knowledge, mirroring race-ui.mjs.
import {missionStars,isMissionComplete} from './campaign-progress.mjs';
export function singlePlayerDisplay(hud){
 const state=hud?.singleplayer;
 if(!state)return null;
 const horde=state.kind==='horde';
 const mission=state.mission;
 const player=(Array.isArray(hud?.actors)?hud.actors.find(actor=>actor.id===(hud.actorId??0)):null)||hud?.actors?.[0];
 const waypoint=state.waypoint?{...state.waypoint,distance:player&&Number.isFinite(Number(player.x))?Math.round(Math.hypot(Number(player.x)-state.waypoint.x,Number(player.z)-state.waypoint.z)):null}:null;
 const waveTarget=Math.max(1,state.waveTarget||1);
 const steps=Array.isArray(state.steps)?state.steps:[];
 const upgrades=Array.isArray(state.upgrades)?state.upgrades:Array.isArray(state.upgrade?.pending)?state.upgrade.pending:[];
 const selectedRaw=state.upgradeSelected??state.upgrade?.selected??null;
 const upgradeSelected=selectedRaw&&typeof selectedRaw==='object'?(selectedRaw.id??selectedRaw.name??null):selectedRaw;
 const bossPhase=Math.max(0,Number(state.bossPhase??state.boss?.phase)||0);
 const bossPhaseTotal=Math.max(1,Number(state.bossPhaseTotal??state.boss?.phases)||1);
 const bossPhaseName=state.bossPhaseName??state.boss?.phaseName??null;
 const rawCheckpoint=state.checkpoint;
 const checkpoint=rawCheckpoint&&typeof rawCheckpoint==='object'
  ?{step:Math.max(0,Math.round(Number(rawCheckpoint.step)||0)),missionId:rawCheckpoint.missionId??mission?.id??null}
  :Number.isFinite(Number(rawCheckpoint))?{step:Math.max(0,Math.round(Number(rawCheckpoint))),missionId:mission?.id??null}:null;
 const rawNotice=state.notice??state.singleNotice??hud?.singleNotice??null;
 const notice=rawNotice&&rawNotice.text?{type:rawNotice.type||'info',text:String(rawNotice.text),tone:rawNotice.tone||(rawNotice.type==='enemy-detonate'?'danger':rawNotice.type==='horde-resupply'?'accent':'default')}:null;
 return {
  horde,
  kind:state.kind,
  phase:state.phase,
  tag:horde?'SURVIVAL':(mission?.tag||'MISSION'),
  title:horde?'HORDE':(mission?.name||'Mission'),
  chapter:mission?.chapter||'',
  objective:state.objective||'',
  message:state.message||'',
  story:state.story||null,
  waypoint,
  steps,
  stepIndex:steps.filter(step=>step.done).length,
  stepTotal:steps.length,
  wave:state.wave||0,
  waveTarget,
  waveProgress:Math.min(1,(state.wave||0)/waveTarget),
  enemiesAlive:state.enemiesAlive||0,
  enemiesTotal:state.enemiesTotal||0,
  enemiesLabel:`${state.enemiesAlive||0} / ${state.enemiesTotal||0}`,
  lives:Number.isFinite(state.lives)?state.lives:0,
  kills:state.kills||0,
  deaths:state.deaths||0,
  elapsed:Math.round(state.elapsed||0),
  missionIndex:mission?(mission.index+1):0,
  missionTotal:mission?.total||0,
  missionLabel:mission?`${mission.chapter||'MISSION'} ${mission.index+1} / ${mission.total}`:'',
  hold:state.hold?{seconds:state.hold.seconds,progress:state.hold.progress,ratio:state.hold.seconds?Math.min(1,state.hold.progress/state.hold.seconds):0}:null,
  boss:state.boss&&state.boss.alive?{name:state.boss.name,hp:state.boss.hp,maxHp:state.boss.maxHp,ratio:state.boss.maxHp?Math.max(0,state.boss.hp/state.boss.maxHp):0,phase:bossPhase,phaseName:bossPhaseName,phases:bossPhaseTotal}:null,
  bossPhase,
  bossPhaseName,
  bossPhaseTotal,
  checkpoint,
  upgrades,
  upgradeWave:Number.isFinite(Number(state.upgradeWave))?Number(state.upgradeWave):null,
  upgradeSelected,
  upgradeCount:Number.isFinite(Number(state.upgradeCount))?Number(state.upgradeCount):(Array.isArray(state.acquired)?state.acquired.length:0),
  notice,
  defend:state.defend?{seconds:state.defend.seconds,progress:state.defend.progress,ratio:state.defend.seconds?Math.min(1,state.defend.progress/state.defend.seconds):0}:null,
  status:state.phase==='intermission'?`NEXT WAVE IN ${Math.max(0,Math.ceil(state.waveTimer||0))}S`:state.phase==='wave'?'WAVE ACTIVE':state.phase==='won'?'MISSION COMPLETE':state.phase==='lost'?'MISSION FAILED':state.phase==='active'?'IN PROGRESS':'STANDBY',
 };
}
export function singlePlayerResult(hud){
 const state=hud?.singleplayer;
 if(!state)return 'MISSION COMPLETE.';
 const won=state.winner===0;
 if(state.kind==='horde')return won?`YOU SURVIVED ${state.waveTarget} WAVES.`:'OVERRUN.';
 const name=(state.mission?.name||'MISSION').toUpperCase();
 return won?`${name} COMPLETE.`:`${name} FAILED.`;
}
export function singlePlayerSummary(hud){
 const state=hud?.singleplayer;
 if(!state)return '';
 if(state.kind==='horde')return `Cleared ${Math.max(0,(state.wave||1)-1)} of ${state.waveTarget} waves · ${state.kills||0} kills.`;
 const won=state.winner===0;
 return `${won?'Objective complete':'Objective failed'} · ${state.kills||0} kills · ${Math.round(state.elapsed||0)}s.`;
}
export function missionBrief(hud){
 const state=hud?.singleplayer;
 const mission=state?.mission;
 if(!mission)return null;
 return {name:mission.name,tag:mission.tag,chapter:mission.chapter||'',brief:mission.brief||'',intro:mission.intro||null,outro:mission.outro||null};
}
// Campaign mission select. A mission's par time is a deterministic function of
// its step count so three stars stay comparable across devices and sessions.
export function campaignMissionPar(mission){
 const steps=Array.isArray(mission?.steps)?mission.steps.length:0;
 return 120+steps*45;
}
// Mission-select view. Star rating delegates to the authoritative
// `missionStars` rule in campaign-progress so the display and the rewards
// cannot disagree.
export function campaignMissionView(missions=[],progress={},selectedId=null){
 const list=Array.isArray(missions)?missions:[],completed=progress?.completed||{};
 return list.map((mission,index)=>{
  const entry=completed[mission.id]||null,previous=index>0?list[index-1]:null,par=campaignMissionPar(mission),done=isMissionComplete(entry);
  return {
   id:mission.id,
   order:index+1,
   name:mission.name,
   chapter:mission.chapter||'',
   tag:mission.tag||'',
   brief:mission.brief||'',
   index,
   selected:selectedId===mission.id,
   unlocked:index===0||isMissionComplete(completed[previous?.id]),
   completed:done,
   stars:done?missionStars(mission,entry):0,
   parTime:par,
   bestTime:Number.isFinite(Number(entry?.bestTime))?Number(entry.bestTime):null,
   bestScore:Number.isFinite(Number(entry?.bestScore))?Number(entry.bestScore):null,
   attempts:Math.max(0,Math.round(Number(entry?.attempts)||0)),
   wins:Math.max(0,Math.round(Number(entry?.wins)||0)),
  };
 });
}
export function campaignProgressSummary(missions=[],progress={}){
 const views=campaignMissionView(missions,progress,null),total=views.length,stars=views.reduce((sum,view)=>sum+view.stars,0);
 return {total,done:views.filter(view=>view.completed).length,stars,maxStars:total*3,ratio:total?views.filter(view=>view.completed).length/total:0};
}
