'use client';

export function SinglePlayerHud({single}:{single?:any}){
 if(!single)return null;
 return <div className="race-hud singleplayer-hud" aria-label="Mission status">
  <div className="race-metrics">
   {single.horde?<div><small>WAVE</small><strong>{single.wave} / {single.waveTarget}</strong></div>:<div><small>{single.tag}</small><strong>{single.title}</strong></div>}
   <div><small>HOSTILES</small><strong>{single.enemiesLabel}</strong></div>
   <div><small>LIVES</small><strong>{single.lives}</strong></div>
   <div><small>KILLS</small><strong>{single.kills}</strong></div>
  </div>
  <div className="race-item"><small>{single.horde?'SURVIVAL':single.missionLabel}</small><strong>{single.objective}</strong><span>{single.status}</span></div>
  {single.boss&&<div className="race-item"><small>WARDEN</small><strong>{single.boss.name}</strong><span>{single.boss.hp} / {single.boss.maxHp}</span><div className="race-track"><i style={{width:`${Math.round(single.boss.ratio*100)}%`}}/></div></div>}
  {single.defend&&<div className="race-item"><small>HOLD</small><strong>{Math.max(0,single.defend.seconds-single.defend.progress)}s</strong><div className="race-track"><i style={{width:`${Math.round(single.defend.ratio*100)}%`}}/></div></div>}
  {single.message&&<p className="race-help" role="status" aria-live="polite">{single.message}</p>}
 </div>;
}
