'use client';

export function SinglePlayerHud({single}:{single?:any}){
 if(!single)return null;
 return <div className="race-hud singleplayer-hud" aria-label="Mission status">
  <div className="race-metrics">
   {single.horde?<div><small>WAVE</small><strong>{single.wave} / {single.waveTarget}</strong></div>:<div><small>{single.chapter||single.tag}</small><strong>{single.title}</strong></div>}
   <div><small>HOSTILES</small><strong>{single.enemiesLabel}</strong></div>
   <div><small>LIVES</small><strong>{single.lives}</strong></div>
   <div><small>KILLS</small><strong>{single.kills}</strong></div>
  </div>
  <div className="race-item"><small>{single.horde?'SURVIVAL':`OBJECTIVE ${single.stepIndex+1} / ${single.stepTotal}`}</small><strong>{single.objective}</strong><span>{single.status}</span></div>
  {single.waypoint&&<div className="race-item waypoint-item"><small>NEXT</small><strong>{single.waypoint.label}{single.waypoint.distance!==null?` · ${single.waypoint.distance}m`:''}</strong></div>}
  {single.hold&&<div className="race-item"><small>HOLD</small><strong>{Math.max(0,Math.ceil(single.hold.seconds-single.hold.progress))}s</strong><div className="race-track"><i style={{width:`${Math.round(single.hold.ratio*100)}%`}}/></div></div>}
  {single.boss&&<div className="race-item"><small>WARDEN</small><strong>{single.boss.name}</strong><span>{single.boss.hp} / {single.boss.maxHp}</span><div className="race-track"><i style={{width:`${Math.round(single.boss.ratio*100)}%`}}/></div></div>}
  {single.story&&<p className="story-line" role="status" aria-live="polite"><b>{single.story.speaker}</b>{single.story.text}</p>}
  {!single.story&&single.message&&<p className="race-help" role="status" aria-live="polite">{single.message}</p>}
 </div>;
}
