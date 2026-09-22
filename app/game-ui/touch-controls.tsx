'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {applyTouchAction,stickAxis,touchDisplay} from '../../game/touch.mjs';

// Mobile controls: a floating move stick on the left, a floating look stick on
// the right and a prioritised action cluster. Fire and jump (or boost and item
// while racing) are the large thumb buttons. ADS, crouch and reload stay close;
// secondary actions live in a hold-and-slide tray. Both sticks float where the thumb lands
// inside their zone and use a fixed base radius, so the axis can never saturate
// from a collapsed element. Every control captures its own pointer id, so both
// sticks and any number of buttons work together under multi-touch.
//
// When an explicit COCS surface (command board, spend window) or the Training
// completion beat owns the cursor, the page passes `suspended`. The layer then
// gets `touch-layer--suspended` (all capture is inert in CSS) and every handler
// refuses to seed move/look/fire/jump, so a tap meant for the surface can never
// leak into combat input.
const LABELS:Record<string,string>={fire:'FIRE',ads:'ADS',alt:'ALT FIRE',jump:'JUMP',crouch:'CROUCH',reload:'RELOAD',power:'POWER',melee:'MELEE',grenade:'GRENADE',interact:'USE',swap:'SWAP',voice:'TALK',mobility:'MOBILITY',fullscreen:'FULLSCREEN'};
const SECONDARY=['swap','grenade','melee','power','mobility','alt','interact','voice','fullscreen'];
const HELD_SECONDARY=new Set(['alt','mobility','voice']);
const CAR_LABELS:Record<string,string>={crouch:'BRAKE',interact:'RESET',power:'BOOST',fire:'USE ITEM'};

export function TouchControls({runtime,visible,onLook,onSwap,onPause,onFullscreen,fullscreen,mode,interactActive=false,interactLabel='USE',suspended=false,display}:{runtime:any;visible:boolean;onLook:(dx:number,dy:number)=>void;onSwap:()=>void;onPause:()=>void;onFullscreen?:()=>void;fullscreen?:boolean;mode?:string;interactActive?:boolean;interactLabel?:string;suspended?:boolean;display?:any}){
 const race=mode==='puma-race',soccer=mode==='puma-soccer',car=race||soccer,lattice=mode==='cocs'||mode==='cocs-coop';
 // Player-tuned scale/opacity/handedness. The CSS variables and the class are
 // produced by the pure `touchDisplay` helper; the JS stick metrics read the
 // same table so the knob travel can never drift from the rendered base.
 const touch=touchDisplay(display),{stickRadius,knobRadius,lookTravel}=touch.metrics;
 const small=car?['crouch']:['ads','reload','crouch'];
 const big=car?(soccer?['power']:['power','fire']):interactActive?['fire','jump','interact']:['fire','jump'];
 const secondary=car?['interact','fullscreen']:SECONDARY.filter(action=>action!=='interact'||!interactActive);
 const labels:Record<string,string>={...LABELS,...(car?CAR_LABELS:{}),...(lattice?{interact:interactLabel}:{})};
 const moveBaseRef=useRef<HTMLDivElement|null>(null),moveKnobRef=useRef<HTMLElement|null>(null),lookBaseRef=useRef<HTMLDivElement|null>(null),lookKnobRef=useRef<HTMLElement|null>(null);
 const moveState=useRef<{id:number|null;origin:{x:number;y:number}}>({id:null,origin:{x:0,y:0}});
 const lookState=useRef<{id:number|null;origin:{x:number;y:number};last:{x:number;y:number}}>({id:null,origin:{x:0,y:0},last:{x:0,y:0}});
 const menuId=useId(),menuRef=useRef<HTMLDivElement|null>(null),menuPointer=useRef<number|null>(null),menuAction=useRef<string|null>(null);
 const [moreOpen,setMoreOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[toggles,setToggles]=useState({ads:false,crouch:false});
  const cb=useRef({onLook,onSwap});
  const captures=useRef(new Map<number,Element>()),heldActions=useRef(new Map<string,number>());
 useEffect(()=>{cb.current={onLook,onSwap};});
  // Drop browser capture AND local ownership on interruptions. Clearing only
  // runtime axes leaves a stick owned by a finger the browser has forgotten.
  useEffect(()=>{
   const reset=()=>{
   menuPointer.current=null;menuAction.current=null;setMoreOpen(false);setSelected(null);setToggles({ads:false,crouch:false});
   const knob=(ref:{current:HTMLElement|null},x:number,y:number)=>{const el=ref.current;if(el)el.style.transform=`translate(${x}px, ${y}px)`;};
   const base=(ref:{current:HTMLElement|null},on:boolean)=>{const el=ref.current;if(el)el.style.opacity=on?'1':'0';};
   moveState.current.id=null;knob(moveKnobRef,0,0);base(moveBaseRef,false);
   lookState.current.id=null;knob(lookKnobRef,0,0);base(lookBaseRef,false);
   for(const action of heldActions.current.keys())applyTouchAction(runtime.current,action,false,{adsToggle:false,crouchToggle:false});
   heldActions.current.clear();
   for(const [id,el] of captures.current){try{if(el.hasPointerCapture?.(id))el.releasePointerCapture(id);}catch{}}
   captures.current.clear();
   const r=runtime.current;if(r?.touch){r.touch.moveX=0;r.touch.moveY=0;r.touch.sprint=false;r.touch.fire=r.touch.jump=r.touch.ads=r.touch.altFire=r.touch.crouch=r.touch.mobility=false;}
   };
   if(suspended||!visible)reset();
   const hidden=()=>{if(document.hidden)reset();};
   window.addEventListener('blur',reset);document.addEventListener('visibilitychange',hidden);
   return()=>{window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',hidden);reset();};
  },[suspended,visible,mode,runtime]);

 const setKnob=(ref:{current:HTMLElement|null},x:number,y:number)=>{const el=ref.current;if(el)el.style.transform=`translate(${x}px, ${y}px)`;};
 const placeBase=(ref:{current:HTMLElement|null},x:number,y:number,on:boolean)=>{const el=ref.current;if(!el)return;if(on){el.style.left=`${x}px`;el.style.top=`${y}px`;}el.style.opacity=on?'1':'0';};
 // Synthetic and edge-case pointers can arrive with no active pointer id;
 // setPointerCapture then throws InvalidStateError. Capture is an optimisation
 // (the handlers also track their own pointer id), so failure is non-fatal.
  const capture=(element:Element|null,id:number)=>{if(element)captures.current.set(id,element);try{element?.setPointerCapture?.(id);}catch{}};
  // Native pointerup/cancel releases capture after dispatch. Only lifecycle
  // cleanup above releases it explicitly while a contact is still active.
  const releaseCapture=(id:number)=>{captures.current.delete(id);};
 const move=(x:number,y:number,sprint:boolean)=>{const r=runtime.current;if(!r)return;r.touch??={};r.touch.moveX=x;r.touch.moveY=y;r.touch.sprint=sprint;};

 const moveFrom=(x:number,y:number)=>{const v=stickAxis(x-moveState.current.origin.x,y-moveState.current.origin.y,stickRadius,knobRadius);move(v.x,v.y,v.sprint);setKnob(moveKnobRef,v.knobX,v.knobY);};
  const moveDown=(e:ReactPointerEvent<HTMLDivElement>)=>{e.preventDefault();if(suspended)return;if(moveState.current.id!==null)return;moveState.current.id=e.pointerId;moveState.current.origin={x:e.clientX,y:e.clientY};capture(e.currentTarget,e.pointerId);move(0,0,false);placeBase(moveBaseRef,e.clientX,e.clientY,true);setKnob(moveKnobRef,0,0);};
 const moveMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(suspended)return;if(moveState.current.id!==e.pointerId)return;e.preventDefault();moveFrom(e.clientX,e.clientY);};
  const moveUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(moveState.current.id!==e.pointerId)return;moveState.current.id=null;releaseCapture(e.pointerId);setKnob(moveKnobRef,0,0);move(0,0,false);placeBase(moveBaseRef,0,0,false);};

 const lookDown=(e:ReactPointerEvent<HTMLDivElement>)=>{e.preventDefault();if(suspended)return;if(lookState.current.id!==null)return;lookState.current.id=e.pointerId;lookState.current.origin={x:e.clientX,y:e.clientY};lookState.current.last={x:e.clientX,y:e.clientY};capture(e.currentTarget,e.pointerId);placeBase(lookBaseRef,e.clientX,e.clientY,true);setKnob(lookKnobRef,0,0);};
 const lookMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(suspended)return;if(lookState.current.id!==e.pointerId)return;const dx=e.clientX-lookState.current.last.x,dy=e.clientY-lookState.current.last.y;lookState.current.last={x:e.clientX,y:e.clientY};if(dx||dy)cb.current.onLook(dx,dy);const kx=e.clientX-lookState.current.origin.x,ky=e.clientY-lookState.current.origin.y,m=Math.hypot(kx,ky),s=m>lookTravel?lookTravel/m:1;setKnob(lookKnobRef,kx*s,ky*s);};
  const lookUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(lookState.current.id!==e.pointerId)return;lookState.current.id=null;releaseCapture(e.pointerId);setKnob(lookKnobRef,0,0);placeBase(lookBaseRef,0,0,false);};

 // Mobile ADS/crouch are always toggles, independently of desktop preferences.
 // Vehicle brake stays held so a released thumb cannot leave the brake latched.
 const togglePrefs={adsToggle:true,crouchToggle:!car};
 const press=(action:string)=>{if(suspended)return;if(action==='fullscreen'){onFullscreen?.();return;}applyTouchAction(runtime.current,action,true,togglePrefs);if(action==='swap')cb.current.onSwap();if(action==='ads'||action==='crouch')setToggles({ads:runtime.current?.touch?.ads===true,crouch:runtime.current?.touch?.crouch===true});};
 const release=(action:string)=>{applyTouchAction(runtime.current,action,false,togglePrefs);};
  const releaseAction=(action:string,e:ReactPointerEvent<HTMLButtonElement>)=>{e.stopPropagation();if(heldActions.current.get(action)!==e.pointerId)return;heldActions.current.delete(action);releaseCapture(e.pointerId);release(action);};
   const holdProps=(action:string)=>({onPointerDown:(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.stopPropagation();if(suspended)return;if(heldActions.current.has(action))return;heldActions.current.set(action,e.pointerId);capture(e.currentTarget,e.pointerId);press(action);},onPointerUp:(e:ReactPointerEvent<HTMLButtonElement>)=>releaseAction(action,e),onPointerCancel:(e:ReactPointerEvent<HTMLButtonElement>)=>releaseAction(action,e),onLostPointerCapture:(e:ReactPointerEvent<HTMLButtonElement>)=>releaseAction(action,e)});

 // Hold MORE, slide to an action and release to use it. Held abilities stay
 // active while the finger rests over their tile. A second finger may also tap
 // tiles while MORE is held; closing the tray always releases those holds.
 const selectMore=(action:string|null)=>{
  if(menuAction.current===action)return;
  const previous=menuAction.current;
  if(previous&&HELD_SECONDARY.has(previous)&&heldActions.current.get(previous)===menuPointer.current){heldActions.current.delete(previous);release(previous);}
  menuAction.current=action;setSelected(action);
  if(action&&HELD_SECONDARY.has(action)&&!heldActions.current.has(action)){heldActions.current.set(action,menuPointer.current!);press(action);}
 };
 const closeMore=(commit=false)=>{
  const action=menuAction.current;
  if(commit&&action&&!HELD_SECONDARY.has(action))press(action);
  selectMore(null);
  for(const action of secondary){const id=heldActions.current.get(action);if(id===undefined)continue;heldActions.current.delete(action);release(action);const el=captures.current.get(id);captures.current.delete(id);try{if(el?.hasPointerCapture?.(id))el.releasePointerCapture(id);}catch{}}
  menuPointer.current=null;setMoreOpen(false);
 };
 const moreMove=(e:ReactPointerEvent<HTMLButtonElement>)=>{
  if(suspended||menuPointer.current!==e.pointerId)return;
  const tile=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-touch-secondary]');
  selectMore(tile&&menuRef.current?.contains(tile)?tile.dataset.touchSecondary??null:null);
 };
 const moreEnd=(e:ReactPointerEvent<HTMLButtonElement>,commit=false)=>{if(menuPointer.current!==e.pointerId)return;e.preventDefault();e.stopPropagation();releaseCapture(e.pointerId);closeMore(commit);};
 const actionButton=(action:string)=>{const toggle=!car&&(action==='ads'||action==='crouch'),on=toggle&&toggles[action as 'ads'|'crouch'];return <button key={action} type="button" className={`touch-button touch-${action}`} aria-label={labels[action]} aria-pressed={toggle?on:undefined} {...holdProps(action)}>{labels[action]}{toggle&&<small>{on?'ON':'TAP'}</small>}</button>;};

 if(!visible)return null;
 return <div className={`touch-layer${car?' touch-car':''}${lattice?' touch-tactical':''}${suspended?' touch-layer--suspended':''}${touch.leftHanded?' touch-layer--left-hand':''}`} style={touch.style as any} onContextMenu={e=>e.preventDefault()}>
  {!car&&<div className="touch-look" aria-hidden="true" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} onLostPointerCapture={lookUp}><span className="touch-hint touch-hint--look"/><div className="touch-look-base" ref={lookBaseRef}><i className="touch-knob" ref={lookKnobRef}/></div></div>}
  <div className="touch-move-zone" aria-hidden="true" onPointerDown={moveDown} onPointerMove={moveMove} onPointerUp={moveUp} onPointerCancel={moveUp} onLostPointerCapture={moveUp}><span className="touch-hint touch-hint--move"/><div className="touch-move-base" ref={moveBaseRef}><i className="touch-knob" ref={moveKnobRef}/></div></div>
  <div className="touch-util">
   <button type="button" className="touch-button touch-pause-btn" aria-label="Pause" onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(suspended)return;onPause();}}>II</button>
  </div>
  <div className="touch-actions">
   {small.map(actionButton)}
   <button type="button" className="touch-button touch-more" aria-label="Hold for more actions" aria-expanded={moreOpen} aria-controls={menuId}
    onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(suspended||menuPointer.current!==null)return;menuPointer.current=e.pointerId;capture(e.currentTarget,e.pointerId);setMoreOpen(true);}}
    onPointerMove={moreMove} onPointerUp={e=>moreEnd(e,true)} onPointerCancel={e=>moreEnd(e)} onLostPointerCapture={e=>moreEnd(e)}>MORE<small>HOLD</small></button>
  </div>
  {moreOpen&&!suspended&&<div ref={menuRef} id={menuId} className="touch-more-panel" role="group" aria-label="Secondary actions">
   <p>SLIDE TO SELECT · RELEASE TO USE</p>
   <div className="touch-more-grid">{secondary.map(action=><button key={action} type="button" className={`touch-button touch-${action}${selected===action?' is-selected':''}`} data-touch-secondary={action} aria-label={action==='fullscreen'?(fullscreen?'Exit full screen':'Enter full screen'):labels[action]} {...holdProps(action)}>{labels[action]}{HELD_SECONDARY.has(action)&&<small>HOLD</small>}</button>)}</div>
  </div>}
  <div className="touch-primary">
   {big.map(actionButton)}
  </div>
 </div>;
}
