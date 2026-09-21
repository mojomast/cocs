'use client';
import {ArrowDown,ArrowUp,Camera,ChevronLeft,ChevronRight,Eye,EyeOff,Gauge,Pause,Play,Settings,Undo2} from 'lucide-react';
import styles from './DemoControls.module.css';

// The unobtrusive control dock shown in the "Back to Demo" view. Every
// capability has a visible button (the hotkeys are accelerators, never the only
// way in): scenario skip, enter arena, camera ownership (auto/follow/free),
// camera-style cycling, view reset, HUD toggle, pause/resume, rotation pin
// release and the Demo Options modal. Free-roam extras (vertical thrust, speed,
// reset) appear only while free roam is active so the dock stays quiet.
export function DemoControls({
 state='menu',labels={},subjects=[],cameraStyle='auto',hudVisible=true,pinned=false,freeSpeed=16,running=null,notice=null,error=null,
 onEnterArena,onPrevScenario,onNextScenario,onAuto,onFollow,onFree,onStyle,onResetView,onToggleHud,onOptions,onPause,onResume,onReleasePins,onSpeed,onLift,
 music,onMusic,ambience,onAmbience,announcer,onAnnouncer,weather,onWeather,
}:{
 state?:string;labels:any;subjects?:any[];cameraStyle?:string;hudVisible?:boolean;pinned?:boolean;freeSpeed?:number;running?:any;notice?:string|null;error?:string|null;
 onEnterArena:()=>void;onPrevScenario:()=>void;onNextScenario:()=>void;onAuto:()=>void;onFollow:(dir:number)=>void;onFree:()=>void;onStyle:(dir:number)=>void;onResetView:()=>void;onToggleHud:()=>void;onOptions:()=>void;onPause:()=>void;onResume:()=>void;onReleasePins:()=>void;onSpeed:(dir:number)=>void;onLift:(value:number)=>void;
 music:boolean;onMusic:(value:boolean)=>void;ambience:boolean;onAmbience:(value:boolean)=>void;announcer:boolean;onAnnouncer:(value:boolean)=>void;weather:string|null;onWeather:()=>void;
}){
 const followActive=state==='follow';
 const freeActive=state==='free';
 const paused=state==='paused';
 const subject=followActive?labels?.cameraLabel||'FOLLOW SUBJECT':null;
 const hold=(value:number)=>({
  onPointerDown:(e:any)=>{if(e.button!==undefined&&e.button!==0)return;e.currentTarget.setPointerCapture?.(e.pointerId);onLift(value);},
  onPointerUp:()=>onLift(0),
  onPointerCancel:()=>onLift(0),
  onLostPointerCapture:()=>onLift(0),
  onKeyDown:(e:any)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();onLift(value);}},
  onKeyUp:(e:any)=>{if(e.key===' '||e.key==='Enter')onLift(0);},
 });
  return <div className={`demo-controls ${styles.toolbar}`} role="group" aria-label="Back to demo controls" onPointerUp={(e:any)=>{const button=e.target?.closest?.('button');button?.blur?.();}}>
  <div className="demo-controls__row">
   <button type="button" className="icon-button" onClick={onPrevScenario} aria-label="Previous scenario" title="Previous scenario (Left arrow)"><ChevronLeft size={18}/></button>
   <span className="demo-controls__label" aria-live="polite">{running?.modeName||'DEMO'}<em>{running?.mapName||''}</em></span>
   <button type="button" className="icon-button" onClick={onNextScenario} aria-label="Next scenario" title="Next scenario (Right arrow)"><ChevronRight size={18}/></button>
   <button type="button" className="secondary-button demo-controls__enter" onClick={onEnterArena} title="Leave the demo and open the arena menu">ENTER ARENA</button>
  </div>
  <div className="demo-controls__row" role="group" aria-label="Camera ownership">
   <button type="button" className="demo-option" aria-pressed={state==='auto'} onClick={onAuto} title="Automatic direction (releases manual pins; also the Return to Auto action)">AUTO DIRECTOR</button>
   <span className="demo-follow" style={{display:'inline-flex',alignItems:'center',gap:6}}>
    <button type="button" className="icon-button" style={{width:30,height:30}} onClick={()=>onFollow(-1)} aria-label="Previous subject" title="Previous subject ( [ )"><ChevronLeft size={14}/></button>
    <button type="button" className="demo-option" aria-pressed={followActive} onClick={()=>onFollow(1)} title={`Follow a subject (${subjects.length} in frame) and cycle to the next one ( ] )`}>{subject||'FOLLOW SUBJECT'}</button>
    <button type="button" className="icon-button" style={{width:30,height:30}} onClick={()=>onFollow(1)} aria-label="Next subject" title="Next subject ( ] )"><ChevronRight size={14}/></button>
   </span>
   <button type="button" className="demo-option" aria-pressed={freeActive} onClick={onFree} title="Free roam: fly the camera (F)">FREE ROAM</button>
  </div>
  <div className="demo-controls__row" role="group" aria-label="Camera style and presentation">
   <span className="demo-follow" style={{display:'inline-flex',alignItems:'center',gap:6}}>
    <button type="button" className="icon-button" style={{width:30,height:30}} onClick={()=>onStyle(-1)} aria-label="Previous camera style" title="Previous camera style"><ChevronLeft size={14}/></button>
    <button type="button" className="demo-option" onClick={()=>onStyle(1)} title="Cycle the director rig (B)"><Camera size={13}/> {labels?.styleLabel||String(cameraStyle).toUpperCase()}</button>
    <button type="button" className="icon-button" style={{width:30,height:30}} onClick={()=>onStyle(1)} aria-label="Next camera style" title="Next camera style (B)"><ChevronRight size={14}/></button>
   </span>
   <button type="button" className="demo-option" onClick={onResetView} title={freeActive?'Reset the free camera pose (R)':'Return to automatic direction and release manual camera pins'}>{freeActive?'RESET VIEW':'RETURN TO AUTO'} <Undo2 size={12}/></button>
   <button type="button" className="demo-option" aria-pressed={hudVisible} onClick={onToggleHud} title="Hide or restore the demo graphics, ticker and subject labels (H)">{hudVisible?<Eye size={13}/>:<EyeOff size={13}/>} HUD · {hudVisible?'ON':'HIDDEN'}</button>
   {paused
    ? <button type="button" className="demo-option" onClick={onResume} title="Resume the demo; releases manual pins (P)"><Play size={13}/> RESUME</button>
    : <button type="button" className="demo-option" onClick={onPause} title="Freeze the demo (P)"><Pause size={13}/> PAUSE</button>}
   {pinned&&<button type="button" className="demo-option" onClick={onReleasePins} title="Release the manual scenario pin and resume automatic rotation">RELEASE PIN</button>}
   <button type="button" className="demo-option" onClick={onOptions} title="Demo options: rotation, mode, map, duration, bots"><Settings size={13}/> DEMO OPTIONS</button>
  </div>
  {freeActive&&<div className="demo-controls__row" role="group" aria-label="Free roam flight controls">
   <button type="button" className="demo-option" aria-label="Ascend while held" title="Ascend while held (Space)" {...hold(1)}><ArrowUp size={13}/> ASCEND</button>
   <button type="button" className="demo-option" aria-label="Descend while held" title="Descend while held (Ctrl/C)" {...hold(-1)}><ArrowDown size={13}/> DESCEND</button>
   <button type="button" className="demo-option" onClick={()=>onSpeed(-1)} aria-label={`Slower: current speed ${freeSpeed}`} title="Slower"><Gauge size={13}/> −</button>
   <span className="demo-controls__label" style={{minWidth:70}} role="group" aria-label={`Free roam speed ${freeSpeed} units per second`}>{freeSpeed} u/s</span>
   <button type="button" className="demo-option" onClick={()=>onSpeed(1)} aria-label={`Faster: current speed ${freeSpeed}`} title="Faster (hold Shift to boost)"><Gauge size={13}/> +</button>
   <button type="button" className="demo-option" onClick={onResetView} title="Reset the camera pose (R)">RESET VIEW</button>
  </div>}
  <div className="demo-options" role="group" aria-label="Demo music and environment options">
   <button type="button" className="demo-option" aria-pressed={music} onClick={()=>onMusic(!music)}>MUSIC · {music?'ON':'OFF'}</button>
   <button type="button" className="demo-option" aria-pressed={ambience} onClick={()=>onAmbience(!ambience)}>AMBIENCE · {ambience?'ON':'OFF'}</button>
   <button type="button" className="demo-option" aria-pressed={announcer} onClick={()=>onAnnouncer(!announcer)}>ANNOUNCER · {announcer?'ON':'OFF'}</button>
   <button type="button" className="demo-option" aria-pressed={weather!==null} onClick={onWeather}>ENVIRONMENT · {weather?String(weather).toUpperCase():'AUTO'}</button>
  </div>
   {(notice||error)&&<p className={styles.notice} role={error?'alert':'status'}>{error||notice}</p>}
   <p className={styles.help}>
   Drag or move the mouse to look · WASD fly (Space/Ctrl rise &amp; fall, Shift boost) · H HUD · B style · F free roam · [ ] subject · R reset · P pause · Esc exits
  </p>
 </div>;
}
