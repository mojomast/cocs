'use client';

// Single-player HUD: everything hugs the screen edges so the centre viewport
// stays clear. Objective chain on the left edge, a thin status strip along the
// top edge, boss/hold bars just under it, and story lines low-centre above the
// bottom HUD.
export function SinglePlayerHud({single}:{single?:any}){
 if(!single)return null;
 return <div className="sp-hud" aria-label="Mission status">
  <section className="sp-objectives hud-panel">
   <p className="sp-kicker">{single.horde?'HORDE':`${single.chapter?single.chapter+' / ':''}${single.tag}`}</p>
   <h2 className="sp-title">{single.title}</h2>
   <p className="sp-objective">{single.objective}</p>
   {!single.horde&&single.stepTotal>0&&<ol className="sp-steps">{single.steps.map((step:any,index:number)=><li key={step.id} className={step.done?'done':step.active?'active':''}><b>{step.done?'✓':index+1}</b><span>{step.text}</span></li>)}</ol>}
  </section>
  <div className="sp-status">
   <span><small>{single.horde?'WAVE':'OBJECTIVE'}</small><b>{single.horde?`${single.wave}/${single.waveTarget}`:`${single.stepIndex+1}/${single.stepTotal}`}</b></span>
   <span><small>HOSTILES</small><b>{single.enemiesLabel}</b></span>
   <span><small>LIVES</small><b>{single.lives}</b></span>
   <span><small>KILLS</small><b>{single.kills}</b></span>
   {single.waypoint&&<span className="sp-waypoint"><small>NEXT</small><b>{single.waypoint.label}{single.waypoint.distance!==null?` · ${single.waypoint.distance}m`:''}</b></span>}
  </div>
  {(single.boss||single.hold)&&<div className="sp-bars">
   {single.boss&&<div className="sp-boss"><small>WARDEN · {single.boss.hp} / {single.boss.maxHp}</small><span className="hud-bar"><i style={{width:`${Math.round(single.boss.ratio*100)}%`}}/></span></div>}
   {single.hold&&<div className="sp-hold"><small>HOLD · {Math.max(0,Math.ceil(single.hold.seconds-single.hold.progress))}s</small><span className="hud-bar"><i style={{width:`${Math.round(single.hold.ratio*100)}%`}}/></span></div>}
  </div>}
  {single.story&&<p className="sp-story" role="status" aria-live="polite"><b>{single.story.speaker}</b>{single.story.text}</p>}
 </div>;
}
