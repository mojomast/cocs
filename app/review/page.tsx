'use client';
import {useEffect,useRef,useState} from 'react';
import {SightReticle} from '../ui/screens/SightReticle';

// Isolated inspection surface using the real Match and ArenaView, not a model mock.
export default function ReviewPage(){
 const canvas=useRef<HTMLCanvasElement>(null),panel=useRef<HTMLDivElement>(null);
 const [error,setError]=useState(''),[display,setDisplay]=useState<any>(null),[showReticle,setShowReticle]=useState(false);
 const runtime=useRef<any>(null);
 useEffect(()=>{let dispose:(()=>void)|undefined,cancelled=false;
  setShowReticle(new URLSearchParams(location.search).get('reticle')==='1');
  import('../../game/review.mjs').then(({mountReview})=>{if(!cancelled&&canvas.current&&panel.current)dispose=mountReview(canvas.current,panel.current,{runtime,onDisplay:setDisplay});}).catch(e=>setError(String(e)));
  return()=>{cancelled=true;dispose?.();};
 },[]);
 return <main style={{position:'fixed',inset:0,background:'#101820',color:'#eee'}}>
  <canvas ref={canvas} style={{width:'100%',height:'100%',display:'block'}} aria-label="Phase one game inspection viewport"/>
  {showReticle&&display&&<SightReticle ui={{runtime,display,player:null,crosshairGap:4}}/>}
  <div ref={panel} style={{position:'absolute',top:8,left:8,right:8,background:'#101820e8',padding:10,font:'12px monospace',maxHeight:'35vh',overflow:'auto'}}/>
  {error&&<pre role="alert" style={{position:'absolute',bottom:10,left:10}}>{error}</pre>}
 </main>;
}
