'use client';

// Single-player HUD: everything hugs the screen edges so the centre viewport
// stays clear. Objective chain on the left edge, a thin status strip along the
// top edge, boss/hold bars just under it, and story lines low-centre above the
// bottom HUD.
export function SinglePlayerHud({single,onSelectUpgrade,onResumeCheckpoint}:{single?:any;onSelectUpgrade?:(id:string)=>void;onResumeCheckpoint?:()=>void}){
 if(!single)return null;
 const upgrades:any[]=Array.isArray(single.upgrades)?single.upgrades:Array.isArray(single.upgrade?.pending)?single.upgrade.pending:[];
 const selectedRaw=single.upgradeSelected??single.upgrade?.selected??null;
 const selected=selectedRaw&&typeof selectedRaw==='object'?(selectedRaw.id??selectedRaw.name??null):selectedRaw;
 const choose=(id:string)=>{
  if(typeof onSelectUpgrade==='function'){onSelectUpgrade(id);return;}
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('horde-upgrade-select',{detail:{id}}));
 };
 const bossPhase=Number(single.boss?.phase??single.bossPhase)||0;
 const bossPhases=Math.max(1,Number(single.boss?.phases??single.bossPhaseTotal)||1);
 const bossPhaseName=single.boss?.phaseName??single.bossPhaseName??null;
 const checkpoint=single.checkpoint&&Number.isFinite(Number(single.checkpoint.step))?single.checkpoint:null;
 const notice=single.notice&&single.notice.text?single.notice:null;
 return <div className="sp-hud" role="region" aria-label="Mission status">
   <section className="sp-objectives hud-panel" aria-label={single.horde?'Horde objectives':'Mission objectives'}>
    <p className="sp-kicker">{single.horde?'HORDE':`${single.chapter?single.chapter+' / ':''}${single.tag}`}</p>
    <h2 className="sp-title">{single.title}</h2>
    <p className="sp-objective">{single.objective}</p>
    {!single.horde&&single.stepTotal>0&&<ol className="sp-steps">{single.steps.map((step:any,index:number)=><li key={step.id} className={step.done?'done':step.active?'active':''}><b>{step.done?'✓':index+1}</b><span>{step.text}</span></li>)}</ol>}
    {checkpoint&&typeof onResumeCheckpoint==='function'&&single.phase!=='won'&&<button type="button" className="btn btn-ghost btn-sm sp-checkpoint" style={{pointerEvents:'auto'}} aria-label={`Resume from checkpoint ${Math.min(checkpoint.step+1,single.stepTotal||checkpoint.step+1)}${single.stepTotal?` of ${single.stepTotal}`:''}`} onClick={onResumeCheckpoint}>RESUME CHECKPOINT{single.stepTotal?` ${Math.min(checkpoint.step+1,single.stepTotal)} / ${single.stepTotal}`:''}</button>}
   </section>
   <div className="sp-status" role="group" aria-label="Mission vitals">
   <span><small>{single.horde?'WAVE':'OBJECTIVE'}</small><b>{single.horde?`${single.wave}/${single.waveTarget}`:`${single.stepIndex+1}/${single.stepTotal}`}</b></span>
   <span><small>HOSTILES</small><b>{single.enemiesLabel}</b></span>
   <span><small>LIVES</small><b>{single.lives}</b></span>
   <span><small>KILLS</small><b>{single.kills}</b></span>
   {single.waypoint&&<span className="sp-waypoint"><small>NEXT</small><b>{single.waypoint.label}{single.waypoint.distance!==null?` · ${single.waypoint.distance}m`:''}</b></span>}
  </div>
  {(single.boss||single.hold)&&<div className="sp-bars">
   {single.boss&&<div className="sp-boss"><small>{single.boss.name}{bossPhase>0?` · PHASE ${bossPhase}${bossPhases>1?`/${bossPhases}`:''}`:''}{bossPhaseName?` · ${bossPhaseName}`:''} · {single.boss.hp} / {single.boss.maxHp}</small><span className="hud-bar"><i style={{width:`${Math.round(single.boss.ratio*100)}%`}}/></span>{bossPhases>1&&<span className="sp-boss-phases" role="status" aria-label={`Boss phase ${bossPhase} of ${bossPhases}`}>{Array.from({length:bossPhases},(_,index)=><i key={index} aria-hidden="true" className={index<bossPhase?'on':''}/>)}</span>}</div>}
   {single.hold&&<div className="sp-hold"><small>HOLD · {Math.max(0,Math.ceil(single.hold.seconds-single.hold.progress))}s</small><span className="hud-bar"><i style={{width:`${Math.round(single.hold.ratio*100)}%`}}/></span></div>}
  </div>}
  {upgrades.length>0&&<section className="sp-upgrades hud-panel" aria-label="Wave upgrade">
   <p className="sp-kicker">{single.upgradeWave?`WAVE ${single.upgradeWave} UPGRADE`:'WAVE UPGRADE'}</p>
    <p className="sp-upgrade-hint">Choose one boost — it lasts the rest of the run.</p>
    <div className="sp-upgrade-options" role="group" aria-label="Wave upgrade choices">
     {upgrades.map((choice:any)=><button type="button" key={choice.id} className={`sp-upgrade${selected===choice.id?' selected':''}`} aria-pressed={selected===choice.id} aria-label={`${choice.name}: ${choice.description}`} style={{'--sp-upgrade-color':choice.color||'#70ffe6',pointerEvents:'auto'} as any} onClick={()=>choose(choice.id)}>
      <strong>{choice.name}</strong>
      <small>{choice.description}</small>
     </button>)}
    </div>
    {selected&&<p className="sp-upgrade-selected" role="status">ACQUIRED · {String(selected).toUpperCase()}</p>}
  </section>}
  {notice&&<p className={`sp-notice sp-notice--${notice.tone||'default'}`} role="status" aria-live="polite">{notice.text}</p>}
  {single.story&&<p className="sp-story" role="status" aria-live="polite"><b>{single.story.speaker}</b>{single.story.text}</p>}
 </div>;
}
