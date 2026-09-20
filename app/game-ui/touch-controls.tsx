'use client';
import {useEffect,useRef} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {applyTouchAction,stickAxis,touchDisplay} from '../../game/touch.mjs';

// Mobile controls: a floating move stick on the left, a floating look stick on
// the right and a prioritised action cluster. Fire and jump (or boost and item
// while racing) are the large thumb buttons; everything else is a small button
// so it never crowds the sticks. Both sticks float to wherever the thumb lands
// inside their zone and use a fixed base radius, so the axis can never saturate
// from a collapsed element. Every control captures its own pointer id, so both
// sticks and any number of buttons work together under multi-touch.
//
// When an explicit COCS surface (command board, spend window) or the Training
// completion beat owns the cursor, the page passes `suspended`. The layer then
// gets `touch-layer--suspended` (all capture is inert in CSS) and every handler
// refuses to seed move/look/fire/jump, so a tap meant for the surface can never
// leak into combat input.
const LABELS:Record<string,string>={fire:'FIRE',ads:'ADS',alt:'ALT FIRE',jump:'JUMP',crouch:'SLIDE',reload:'RELOAD',power:'POWER',melee:'MELEE',grenade:'GRENADE',interact:'USE',swap:'SWAP',voice:'TALK',mobility:'MOBILITY'};
const COMBAT_SMALL=['ads','alt','crouch','reload','power','melee','mobility','grenade','interact','swap','voice'];
const CAR_LABELS:Record<string,string>={crouch:'BRAKE',interact:'RESET',power:'BOOST',fire:'USE ITEM'};

export function TouchControls({runtime,visible,onLook,onSwap,onPause,onFullscreen,fullscreen,mode,interactActive=false,interactLabel='USE',suspended=false,display}:{runtime:any;visible:boolean;onLook:(dx:number,dy:number)=>void;onSwap:()=>void;onPause:()=>void;onFullscreen?:()=>void;fullscreen?:boolean;mode?:string;interactActive?:boolean;interactLabel?:string;suspended?:boolean;display?:any}){
 const race=mode==='puma-race',soccer=mode==='puma-soccer',car=race||soccer,lattice=mode==='cocs'||mode==='cocs-coop';
 // Player-tuned scale/opacity/handedness. The CSS variables and the class are
 // produced by the pure `touchDisplay` helper; the JS stick metrics read the
 // same table so the knob travel can never drift from the rendered base.
 const touch=touchDisplay(display),{stickRadius,knobRadius,lookTravel}=touch.metrics;
 const small=car?['crouch','interact']:lattice?['ads','alt','crouch','reload','power','mobility','grenade','swap']:COMBAT_SMALL;
 const big=car?(soccer?['power']:['power','fire']):lattice&&interactActive?['fire','jump','interact']:['fire','jump'];
 const labels:Record<string,string>={...LABELS,...(car?CAR_LABELS:{}),...(lattice?{interact:interactLabel}:{})};
 const moveBaseRef=useRef<HTMLDivElement|null>(null),moveKnobRef=useRef<HTMLElement|null>(null),lookBaseRef=useRef<HTMLDivElement|null>(null),lookKnobRef=useRef<HTMLElement|null>(null);
 const moveState=useRef<{id:number|null;origin:{x:number;y:number}}>({id:null,origin:{x:0,y:0}});
 const lookState=useRef<{id:number|null;origin:{x:number;y:number};last:{x:number;y:number}}>({id:null,origin:{x:0,y:0},last:{x:0,y:0}});
 const cb=useRef({onLook,onSwap});
 useEffect(()=>{cb.current={onLook,onSwap};});
 // A surface opening mid-hold drops every captured stick and both touch axes;
 // the page's cursor transition already clears the runtime copy.
 useEffect(()=>{
  if(!suspended)return;
  const knob=(ref:{current:HTMLElement|null},x:number,y:number)=>{const el=ref.current;if(el)el.style.transform=`translate(${x}px, ${y}px)`;};
  const base=(ref:{current:HTMLElement|null},on:boolean)=>{const el=ref.current;if(el)el.style.opacity=on?'1':'0';};
  moveState.current.id=null;knob(moveKnobRef,0,0);base(moveBaseRef,false);
  lookState.current.id=null;knob(lookKnobRef,0,0);base(lookBaseRef,false);
  const r=runtime.current;if(r?.touch){r.touch.moveX=0;r.touch.moveY=0;r.touch.sprint=false;}
 },[suspended]);

 const setKnob=(ref:{current:HTMLElement|null},x:number,y:number)=>{const el=ref.current;if(el)el.style.transform=`translate(${x}px, ${y}px)`;};
 const placeBase=(ref:{current:HTMLElement|null},x:number,y:number,on:boolean)=>{const el=ref.current;if(!el)return;if(on){el.style.left=`${x}px`;el.style.top=`${y}px`;}el.style.opacity=on?'1':'0';};
 // Synthetic and edge-case pointers can arrive with no active pointer id;
 // setPointerCapture then throws InvalidStateError. Capture is an optimisation
 // (the handlers also track their own pointer id), so failure is non-fatal.
 const capture=(element:Element|null,id:number)=>{try{element?.setPointerCapture?.(id);}catch{}};
 const move=(x:number,y:number,sprint:boolean)=>{const r=runtime.current;if(!r)return;r.touch??={};r.touch.moveX=x;r.touch.moveY=y;r.touch.sprint=sprint;};

 const moveFrom=(x:number,y:number)=>{const v=stickAxis(x-moveState.current.origin.x,y-moveState.current.origin.y,stickRadius,knobRadius);move(v.x,v.y,v.sprint);setKnob(moveKnobRef,v.knobX,v.knobY);};
 const moveDown=(e:ReactPointerEvent<HTMLDivElement>)=>{e.preventDefault();if(suspended)return;if(moveState.current.id!==null)return;moveState.current.id=e.pointerId;moveState.current.origin={x:e.clientX,y:e.clientY};capture(e.currentTarget,e.pointerId);placeBase(moveBaseRef,e.clientX,e.clientY,true);setKnob(moveKnobRef,0,0);};
 const moveMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(suspended)return;if(moveState.current.id!==e.pointerId)return;e.preventDefault();moveFrom(e.clientX,e.clientY);};
 const moveUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(moveState.current.id!==e.pointerId)return;moveState.current.id=null;setKnob(moveKnobRef,0,0);move(0,0,false);placeBase(moveBaseRef,0,0,false);};

 const lookDown=(e:ReactPointerEvent<HTMLDivElement>)=>{e.preventDefault();if(suspended)return;if(lookState.current.id!==null)return;lookState.current.id=e.pointerId;lookState.current.origin={x:e.clientX,y:e.clientY};lookState.current.last={x:e.clientX,y:e.clientY};capture(e.currentTarget,e.pointerId);placeBase(lookBaseRef,e.clientX,e.clientY,true);setKnob(lookKnobRef,0,0);};
 const lookMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(suspended)return;if(lookState.current.id!==e.pointerId)return;const dx=e.clientX-lookState.current.last.x,dy=e.clientY-lookState.current.last.y;lookState.current.last={x:e.clientX,y:e.clientY};if(dx||dy)cb.current.onLook(dx,dy);const kx=e.clientX-lookState.current.origin.x,ky=e.clientY-lookState.current.origin.y,m=Math.hypot(kx,ky),s=m>lookTravel?lookTravel/m:1;setKnob(lookKnobRef,kx*s,ky*s);};
 const lookUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(lookState.current.id!==e.pointerId)return;lookState.current.id=null;setKnob(lookKnobRef,0,0);placeBase(lookBaseRef,0,0,false);};

 const press=(action:string)=>{if(suspended)return;applyTouchAction(runtime.current,action,true);if(action==='swap')cb.current.onSwap();};
 const release=(action:string)=>{applyTouchAction(runtime.current,action,false);};
 const holdProps=(action:string)=>({onPointerDown:(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.stopPropagation();if(suspended)return;capture(e.currentTarget,e.pointerId);press(action);},onPointerUp:(e:ReactPointerEvent<HTMLButtonElement>)=>{e.stopPropagation();release(action);},onPointerCancel:()=>release(action),onLostPointerCapture:()=>release(action)});

 if(!visible)return null;
 return <div className={`touch-layer${car?' touch-car':''}${lattice?' touch-tactical':''}${suspended?' touch-layer--suspended':''}${touch.leftHanded?' touch-layer--left-hand':''}`} style={touch.style as any} onContextMenu={e=>e.preventDefault()}>
  {!car&&<div className="touch-look" aria-hidden="true" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} onLostPointerCapture={lookUp}><span className="touch-hint touch-hint--look"/><div className="touch-look-base" ref={lookBaseRef}><i className="touch-knob" ref={lookKnobRef}/></div></div>}
  <div className="touch-move-zone" aria-hidden="true" onPointerDown={moveDown} onPointerMove={moveMove} onPointerUp={moveUp} onPointerCancel={moveUp} onLostPointerCapture={moveUp}><span className="touch-hint touch-hint--move"/><div className="touch-move-base" ref={moveBaseRef}><i className="touch-knob" ref={moveKnobRef}/></div></div>
  <div className="touch-util">
   <button type="button" className="touch-button touch-fullscreen" aria-label={fullscreen?'Exit full screen':'Enter full screen'} aria-pressed={!!fullscreen} onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(suspended)return;onFullscreen?.();}}>{fullscreen?'\u2715':'\u26F6'}</button>
   <button type="button" className="touch-button touch-pause-btn" aria-label="Pause" onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(suspended)return;onPause();}}>II</button>
  </div>
  <div className="touch-actions">
   {small.map(action=><button key={action} type="button" className={`touch-button touch-${action}`} aria-label={labels[action]} {...holdProps(action)}>{labels[action]}</button>)}
  </div>
  <div className="touch-primary">
   {big.map(action=><button key={action} type="button" className={`touch-button touch-${action}`} aria-label={labels[action]} {...holdProps(action)}>{labels[action]}</button>)}
  </div>
 </div>;
}
