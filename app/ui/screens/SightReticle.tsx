'use client';
// Active aiming reference. This is the single element that owns the hip
// crosshair and the ADS reticle, and it decides which is visible inside its own
// requestAnimationFrame loop instead of waiting for the 80ms HUD snapshot. That
// keeps the aim transition immediate without re-rendering the whole HUD every
// frame. The reticle is DOM/SVG, so it stays crisp at native UI resolution.
import {useEffect,useRef} from 'react';
import {resolveActiveSight,reticleWarp} from '../../../game/reticle.mjs';

// Read the live aim state from whichever source the current mode uses: local
// input, the reconciled network actor, or the local match actor.
function readAds(runtime:any){
  const r=runtime?.current;
  if(!r)return false;
  if(r.ads===true)return true;
  const id=r.net?.actorId;
  const netActor=id!=null?r.renderState?.actors?.find((a:any)=>a.id===id):null;
  if(netActor)return netActor.ads===true;
  return r.match?.actors?.[0]?.ads===true;
}

export function SightReticle({ui}:{ui:any}){
  const {runtime,player,display,crosshairGap}=ui;
  const layerRef=useRef<HTMLDivElement>(null);
  const sight=resolveActiveSight({weapon:player?.weapon,optic:player?.attachments?.visual?.optic});
  const scope=sight.kind==='scope';
  useEffect(()=>{
    let raf=0;let ads:boolean|null=null;
    const tick=()=>{
      const el=layerRef.current;
      if(el){const next=readAds(runtime);if(next!==ads){ads=next;el.classList.toggle('is-ads',next);}}
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[runtime,scope]);
  // Barrel/pincushion bow that sells the lens: the cross lines curve toward the
  // centre and the tick marks compress outward, like a real magnified reticle.
  const warp=reticleWarp(sight);
  const hPath=`M0 ${(50+warp).toFixed(2)} Q50 50 100 ${(50+warp).toFixed(2)}`;
  const vPath=`M${(50+warp).toFixed(2)} 0 Q50 50 ${(50+warp).toFixed(2)} 100`;
  const ticks=scope?[.16,.32,.48]:[];
  return <div ref={layerRef} className={`aim-layer${scope?' scope-sight':''}`} role="presentation" style={{'--crosshair-color':display.color,'--crosshair-size':display.size,'--crosshair-gap':`${crosshairGap}px`} as any}>
    <div className={`crosshair shape-${display.crosshair}`}><span/><span/><span/><span/></div>
    <div className={`ads-reticle${scope?' scope':''}`}>
      {scope?<>
        <div className="scope-lens"/>
        <svg className="scope-reticle" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="scope-line" vectorEffect="non-scaling-stroke" d={hPath}/>
          <path className="scope-line" vectorEffect="non-scaling-stroke" d={vPath}/>
          {ticks.map((t:number)=><g key={t}>
            <line className="scope-tick" vectorEffect="non-scaling-stroke" x1={(50+t*100).toFixed(1)} y1="46.5" x2={(50+t*100).toFixed(1)} y2="53.5"/>
            <line className="scope-tick" vectorEffect="non-scaling-stroke" x1={(50-t*100).toFixed(1)} y1="46.5" x2={(50-t*100).toFixed(1)} y2="53.5"/>
            <line className="scope-tick" vectorEffect="non-scaling-stroke" x1="46.5" y1={(50+t*100).toFixed(1)} x2="53.5" y2={(50+t*100).toFixed(1)}/>
            <line className="scope-tick" vectorEffect="non-scaling-stroke" x1="46.5" y1={(50-t*100).toFixed(1)} x2="53.5" y2={(50-t*100).toFixed(1)}/>
          </g>)}
          <circle className="scope-dot" cx="50" cy="50" r="0.7" vectorEffect="non-scaling-stroke"/>
        </svg>
      </>:null}
    </div>
  </div>;
}
