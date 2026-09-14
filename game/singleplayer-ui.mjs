// Presentation adapter for the single-player HUD and result screen. Keeps
// React components free of snapshot-shape knowledge, mirroring race-ui.mjs.
export function singlePlayerDisplay(hud){
 const state=hud?.singleplayer;
 if(!state)return null;
 const horde=state.kind==='horde';
 const mission=state.mission;
 const waveTarget=Math.max(1,state.waveTarget||1);
 return {
  horde,
  kind:state.kind,
  phase:state.phase,
  tag:horde?'SURVIVAL':(mission?.tag||'MISSION'),
  title:horde?'HORDE':(mission?.name||'Mission'),
  objective:state.objective||'',
  message:state.message||'',
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
  missionLabel:mission?`MISSION ${mission.index+1} / ${mission.total}`:'',
  boss:state.boss&&state.boss.alive?{name:state.boss.name,hp:state.boss.hp,maxHp:state.boss.maxHp,ratio:state.boss.maxHp?Math.max(0,state.boss.hp/state.boss.maxHp):0}:null,
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
