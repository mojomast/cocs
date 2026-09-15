'use client';

// Broadcast-style lower-third for the title-screen demo. Sits above the canvas,
// below the menu shell, and reads the pure digest from game/broadcast.mjs. It
// re-mounts per scenario (the page passes a new `key`) so it wipes in on a cut.
export function DemoBroadcast({data,reduced=false}:{data:any;reduced?:boolean}){
 if(!data?.live)return null;
 const metrics=Array.isArray(data.metrics)?data.metrics.slice(0,4):[];
 const ticker=Array.isArray(data.ticker)?data.ticker:[];
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
  {ticker.length>0&&<div className="demo-broadcast__ticker"><div className="demo-broadcast__track">
   {[0,1].map(copy=>ticker.map((line:string,i:number)=><span className="demo-broadcast__headline" key={`${copy}-${i}`}>{line}</span>))}
  </div></div>}
 </aside>;
}
