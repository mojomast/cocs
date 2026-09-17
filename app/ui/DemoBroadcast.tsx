'use client';

// Broadcast-style lower-third for the title-screen demo. Sits above the canvas,
// below the menu shell, and reads the pure digest from game/broadcast.mjs. It
// re-mounts per scenario (the page passes a new `key`) so it wipes in on a cut.
//
// The optional `visible` and `subjects` props are additive: `demoBroadcast()`
// data stays untouched, while the Back to Demo view can hide the whole graphic
// with the demo HUD toggle and show which subjects the camera is following.
export function DemoBroadcast({data,reduced=false,visible=true,subjects=[],activeSubjectId=null}:{data:any;reduced?:boolean;visible?:boolean;subjects?:any[];activeSubjectId?:any}){
 if(visible===false||!data?.live)return null;
 const metrics=Array.isArray(data.metrics)?data.metrics.slice(0,4):[];
 const ticker=Array.isArray(data.ticker)?data.ticker:[];
 const subjectList=Array.isArray(subjects)?subjects.filter(Boolean).slice(0,6):[];
 return <aside className={`demo-broadcast${reduced?' demo-broadcast--reduced':''}`} role="status" aria-live="off" aria-label={`Live demo: ${data.modeName} on ${data.mapName}`}>
  <div className="demo-broadcast__bar">
   <div className="demo-broadcast__id">
    <span className="demo-broadcast__live"><i/>{reduced?'DEMO':'LIVE'}</span>
    <span className="demo-broadcast__mode">{data.modeName}</span>
    <span className="demo-broadcast__map">{data.mapName}<em>{data.phase}</em></span>
   </div>
   <div className="demo-broadcast__call">
    <strong>{data.headline}</strong>
    {data.action&&<span>{data.action}</span>}
   </div>
   <div className="demo-broadcast__metrics">
    {metrics.map((metric:any,i:number)=><span className="demo-broadcast__metric" key={`${metric.label}-${i}`}>
     <small>{metric.label}</small><b>{metric.value}</b>
    </span>)}
   </div>
  </div>
  {subjectList.length>0&&<div className="demo-broadcast__subjects" style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',maxWidth:1440,margin:'2px auto 0',padding:'6px 16px',border:'1px solid rgba(131,244,213,.22)',borderTop:'none',background:'rgba(4,10,13,.94)',font:'11px var(--font-mono)',letterSpacing:'.12em',textTransform:'uppercase'}}>
   {subjectList.map((subject:any)=>{const active=subject.id===activeSubjectId;return <span key={String(subject.id)} style={{display:'inline-flex',alignItems:'center',gap:6,color:active?'#a6f7d8':'#9fbcb1'}}>
    <i aria-hidden="true" style={{width:7,height:7,borderRadius:'50%',background:active?'#a6f7d8':'#4c6469',boxShadow:active?'0 0 8px #a6f7d8':undefined}}/>
    {subject.name}{active?' · CAMERA':''}
   </span>;})}
  </div>}
  {ticker.length>0&&<div className="demo-broadcast__ticker"><div className="demo-broadcast__track">
   {[0,1].map(copy=>ticker.map((line:string,i:number)=><span className="demo-broadcast__headline" key={`${copy}-${i}`}>{line}</span>))}
  </div></div>}
 </aside>;
}
