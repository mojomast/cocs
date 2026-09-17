'use client';
// Active aiming reference. This is the single element that owns the hip
// crosshair and the ADS reticle(s), and it decides which is visible inside its
// own requestAnimationFrame loop instead of waiting for the 80ms HUD snapshot.
// The loop also reads the live weapon/optic and the live ADS flag, so an ADS
// weapon swap updates the reticle immediately. The reticle is DOM/SVG, so it
// stays crisp at native UI resolution.
import {useEffect,useRef} from 'react';
import {resolveActiveSight,reticleWarp,scopeCrossPaths} from '../../../game/reticle.mjs';

// Read the live aim state and live weapon/optic from whichever source the
// current mode uses: local input, the reconciled network actor, or the local
// match actor. The HUD snapshot is deliberately not the source of truth here.
function readLive(runtime:any, fallback:any){
  const r=runtime?.current;
  const out={ads:false,weapon:fallback?.weapon,optic:fallback?.attachments?.visual?.optic??null};
  if(!r)return out;
  if(r.ads===true)out.ads=true;
  const id=r.net?.actorId??r.net?.state?.actors?.[0]?.id;
  const netActor=id!=null?r.renderState?.actors?.find((a:any)=>a.id===id):null;
  const actor=netActor||r.match?.actors?.[0]||null;
  if(actor){out.ads=out.ads||actor.ads===true;out.weapon=actor.weapon??out.weapon;out.optic=actor.attachments?.visual?.optic??out.optic;}
  // Phase-1 ADS presentation follows the renderer's interruptible pose/FOV
  // controller. Authoritative aiming and immediate input are unchanged.
  const transition=r.view?._adsController?.state;
  if(transition)out.ads=transition.reticle.ready===true;
  return out;
}

// Curved cross paths that genuinely pass through the aiming centre at (50,50):
// a quadratic's midpoint is 0.25*P0 + 0.5*C + 0.25*P2, so a control point at
// 50 - warp puts the midpoint exactly on 50 while the ends bow out by warp.
const crossPaths=(warp:number)=>scopeCrossPaths(warp);

export function SightReticle({ui}:{ui:any}){
  const {runtime,player,display,crosshairGap}=ui;
  const layerRef=useRef<HTMLDivElement>(null);
  const hRef=useRef<SVGPathElement>(null);
  const vRef=useRef<SVGPathElement>(null);
  const reduced=display?.reducedMotion===true;
  const initial=resolveActiveSight({weapon:player?.weapon,optic:player?.attachments?.visual?.optic});
  const initialPaths=crossPaths(reduced?0:reticleWarp(initial));
  useEffect(()=>{
    let raf=0,ads:boolean|null=null,wasScope:boolean|null=null,key='';
    const tick=()=>{
      const el=layerRef.current;
      if(el){
        const live=readLive(runtime,player);
        const sight=resolveActiveSight({weapon:live.weapon,optic:live.optic});
        const scope=sight.kind==='scope';
        if(live.ads!==ads){ads=live.ads;el.classList.toggle('is-ads',live.ads===true);}
        if(scope!==wasScope){wasScope=scope;el.classList.toggle('is-scope',scope);}
        const nextKey=`${sight.magnification}|${reduced?1:0}`;
        if(scope&&nextKey!==key){
          key=nextKey;
          const paths=crossPaths(reduced?0:reticleWarp(sight));
          hRef.current?.setAttribute('d',paths.h);
          vRef.current?.setAttribute('d',paths.v);
          el.classList.toggle('no-warp',reduced);
        }
      }
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[runtime,player,reduced]);
  const ticks=[.16,.32,.48];
  return <div ref={layerRef} className={`aim-layer${reduced?' no-warp':''}`} role="presentation" style={{'--crosshair-color':display.color,'--crosshair-size':display.size,'--crosshair-gap':`${crosshairGap}px`} as any}>
    <div className={`crosshair shape-${display.crosshair}`}><span/><span/><span/><span/></div>
    <div className="ads-reticle dot"/>
    <div className="ads-reticle scope">
      <div className="scope-lens"/>
      <svg className="scope-reticle" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path ref={hRef} className="scope-line" vectorEffect="non-scaling-stroke" d={initialPaths.h}/>
        <path ref={vRef} className="scope-line" vectorEffect="non-scaling-stroke" d={initialPaths.v}/>
        {ticks.map((t:number)=><g key={t}>
          <line className="scope-tick" vectorEffect="non-scaling-stroke" x1={(50+t*100).toFixed(1)} y1="47.5" x2={(50+t*100).toFixed(1)} y2="52.5"/>
          <line className="scope-tick" vectorEffect="non-scaling-stroke" x1={(50-t*100).toFixed(1)} y1="47.5" x2={(50-t*100).toFixed(1)} y2="52.5"/>
          <line className="scope-tick" vectorEffect="non-scaling-stroke" x1="47.5" y1={(50+t*100).toFixed(1)} x2="52.5" y2={(50+t*100).toFixed(1)}/>
          <line className="scope-tick" vectorEffect="non-scaling-stroke" x1="47.5" y1={(50-t*100).toFixed(1)} x2="52.5" y2={(50-t*100).toFixed(1)}/>
        </g>)}
      </svg>
      <div className="scope-dot"/>
    </div>
  </div>;
}
