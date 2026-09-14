'use client';
import {useEffect,useRef} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {applyTouchAction,stickAxis} from '../../game/touch.mjs';

// Mobile controls: a floating move stick on the left, a floating look stick on
// the right and a prioritised action cluster. Fire and jump (or boost and item
// while racing) are the large thumb buttons; everything else is a small button
// so it never crowds the sticks. Both sticks float to wherever the thumb lands
// inside their zone and use a fixed base radius, so the axis can never saturate
// from a collapsed element. Every control captures its own pointer id, so both
// sticks and any number of buttons work together under multi-touch.
const LABELS:Record<string,string>={fire:'FIRE',ads:'ADS',jump:'JUMP',crouch:'SLIDE',reload:'RELOAD',power:'POWER',melee:'MELEE',grenade:'GRENADE',interact:'USE',swap:'SWAP',voice:'TALK'};
const COMBAT_SMALL=['ads','crouch','reload','power','melee','grenade','interact','swap','voice'];
const CAR_LABELS:Record<string,string>={crouch:'BRAKE',interact:'RESET',power:'BOOST',fire:'USE ITEM'};
const STICK_RADIUS=66,STICK_KNOB=29,LOOK_TRAVEL=33;

export function TouchControls({runtime,visible,onLook,onSwap,onPause,onFullscreen,fullscreen,mode}:{runtime:any;visible:boolean;onLook:(dx:number,dy:number)=>void;onSwap:()=>void;onPause:()=>void;onFullscreen?:()=>void;fullscreen?:boolean;mode?:string}){
 const race=mode==='puma-race',soccer=mode==='puma-soccer',car=race||soccer;
 const small=car?['crouch','interact']:COMBAT_SMALL;
 const big=car?(soccer?['power']:['power','fire']):['fire','jump'];
 const labels={...LABELS,...(car?CAR_LABELS:{})};
 const moveBaseRef=useRef<HTMLDivElement|null>(null),moveKnobRef=useRef<HTMLElement|null>(null),lookBaseRef=useRef<HTMLDivElement|null>(null),lookKnobRef=useRef<HTMLElement|null>(null);
 const moveState=useRef<{id:number|null;origin:{x:number;y:number}}>({id:null,origin:{x:0,y:0}});
 const lookState=useRef<{id:number|null;origin:{x:number;y:number};last:{x:number;y:number}}>({id:null,origin:{x:0,y:0},last:{x:0,y:0}});
 const cb=useRef({onLook,onSwap});
 useEffect(()=>{cb.current={onLook,onSwap};});

 const setKnob=(ref:{current:HTMLElement|null},x:number,y:number)=>{const el=ref.current;if(el)el.style.transform=`translate(${x}px, ${y}px)`;};
 const placeBase=(ref:{current:HTMLElement|null},x:number,y:number,on:boolean)=>{const el=ref.current;if(!el)return;if(on){el.style.left=`${x}px`;el.style.top=`${y}px`;}el.style.opacity=on?'1':'0';};
 const move=(x:number,y:number,sprint:boolean)=>{const r=runtime.current;if(!r)return;r.touch??={};r.touch.moveX=x;r.touch.moveY=y;r.touch.sprint=sprint;};

 const moveFrom=(x:number,y:number)=>{const v=stickAxis(x-moveState.current.origin.x,y-moveState.current.origin.y,STICK_RADIUS,STICK_KNOB);move(v.x,v.y,v.sprint);setKnob(moveKnobRef,v.knobX,v.knobY);};
 const moveDown=(e:ReactPointerEvent<HTMLDivElement>)=>{e.preventDefault();if(moveState.current.id!==null)return;moveState.current.id=e.pointerId;moveState.current.origin={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture?.(e.pointerId);placeBase(moveBaseRef,e.clientX,e.clientY,true);setKnob(moveKnobRef,0,0);};
 const moveMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(moveState.current.id!==e.pointerId)return;e.preventDefault();moveFrom(e.clientX,e.clientY);};
 const moveUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(moveState.current.id!==e.pointerId)return;moveState.current.id=null;setKnob(moveKnobRef,0,0);move(0,0,false);placeBase(moveBaseRef,0,0,false);};

 const lookDown=(e:ReactPointerEvent<HTMLDivElement>)=>{e.preventDefault();if(lookState.current.id!==null)return;lookState.current.id=e.pointerId;lookState.current.origin={x:e.clientX,y:e.clientY};lookState.current.last={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture?.(e.pointerId);placeBase(lookBaseRef,e.clientX,e.clientY,true);setKnob(lookKnobRef,0,0);};
 const lookMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(lookState.current.id!==e.pointerId)return;const dx=e.clientX-lookState.current.last.x,dy=e.clientY-lookState.current.last.y;lookState.current.last={x:e.clientX,y:e.clientY};if(dx||dy)cb.current.onLook(dx,dy);const kx=e.clientX-lookState.current.origin.x,ky=e.clientY-lookState.current.origin.y,m=Math.hypot(kx,ky),s=m>LOOK_TRAVEL?LOOK_TRAVEL/m:1;setKnob(lookKnobRef,kx*s,ky*s);};
 const lookUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(lookState.current.id!==e.pointerId)return;lookState.current.id=null;setKnob(lookKnobRef,0,0);placeBase(lookBaseRef,0,0,false);};

 const press=(action:string)=>{applyTouchAction(runtime.current,action,true);if(action==='swap')cb.current.onSwap();};
 const release=(action:string)=>{applyTouchAction(runtime.current,action,false);};
 const holdProps=(action:string)=>({onPointerDown:(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture?.(e.pointerId);press(action);},onPointerUp:(e:ReactPointerEvent<HTMLButtonElement>)=>{e.stopPropagation();release(action);},onPointerCancel:()=>release(action),onLostPointerCapture:()=>release(action)});

 if(!visible)return null;
 return <div className={`touch-layer${car?' touch-car':''}`} onContextMenu={e=>e.preventDefault()}>
  {!car&&<div className="touch-look" aria-hidden="true" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} onLostPointerCapture={lookUp}><span className="touch-hint touch-hint--look"/><div className="touch-look-base" ref={lookBaseRef}><i className="touch-knob" ref={lookKnobRef}/></div></div>}
  <div className="touch-move-zone" aria-hidden="true" onPointerDown={moveDown} onPointerMove={moveMove} onPointerUp={moveUp} onPointerCancel={moveUp} onLostPointerCapture={moveUp}><span className="touch-hint touch-hint--move"/><div className="touch-move-base" ref={moveBaseRef}><i className="touch-knob" ref={moveKnobRef}/></div></div>
  <div className="touch-util">
   <button type="button" className="touch-button touch-fullscreen" aria-label={fullscreen?'Exit full screen':'Enter full screen'} aria-pressed={!!fullscreen} onPointerDown={e=>{e.preventDefault();e.stopPropagation();onFullscreen?.();}}>{fullscreen?'\u2715':'\u26F6'}</button>
   <button type="button" className="touch-button touch-pause-btn" aria-label="Pause" onPointerDown={e=>{e.preventDefault();e.stopPropagation();onPause();}}>II</button>
  </div>
  <div className="touch-actions">
   {small.map(action=><button key={action} type="button" className={`touch-button touch-${action}`} aria-label={labels[action]} {...holdProps(action)}>{labels[action]}</button>)}
  </div>
  <div className="touch-primary">
   {big.map(action=><button key={action} type="button" className={`touch-button touch-${action}`} aria-label={labels[action]} {...holdProps(action)}>{labels[action]}</button>)}
  </div>
 </div>;
}
