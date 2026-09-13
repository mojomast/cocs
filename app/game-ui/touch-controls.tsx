'use client';
import {useRef} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {applyTouchAction,moveAxis} from '../../game/touch.mjs';

// On-screen mobile controls: a left thumbstick, a drag-anywhere look surface and
// a cluster of action buttons. All state is written imperatively to the runtime
// so the per-frame loop never re-renders React.
const ACTIONS=['ads','jump','crouch','reload','power','melee','grenade','interact','swap','voice'];
const LABELS:Record<string,string>={ads:'ADS',jump:'JUMP',crouch:'SLIDE',reload:'RELOAD',power:'POWER',interact:'USE',swap:'SWAP',voice:'TALK',melee:'MELEE',grenade:'GRENADE'};

export function TouchControls({runtime,visible,onLook,onSwap,onPause,mode}:{runtime:any;visible:boolean;onLook:(dx:number,dy:number)=>void;onSwap:()=>void;onPause:()=>void;mode?:string}){
 const race=mode==='puma-race',soccer=mode==='puma-soccer',car=race||soccer,actions=soccer?['power','crouch','interact']:race?['crouch','interact']:ACTIONS,labels=soccer?{...LABELS,power:'BOOST',crouch:'BRAKE',interact:'RESET'}:race?{...LABELS,crouch:'BRAKE',interact:'RESET'}:LABELS;
 const stick=useRef<HTMLDivElement|null>(null),knob=useRef<HTMLDivElement|null>(null),state=useRef({stickId:null as number|null,lookId:null as number|null,center:{x:0,y:0},last:{x:0,y:0}});
 const move=(x:number,y:number,sprint:boolean)=>{const r=runtime.current;if(!r)return;r.touch??={};r.touch.moveX=x;r.touch.moveY=y;r.touch.sprint=sprint;};
 const setKnob=(x:number,y:number)=>{const el=knob.current;if(el)el.style.transform=`translate(${x}px, ${y}px)`;};
 const axisFrom=(clientX:number,clientY:number,rect:DOMRect)=>moveAxis(clientX-state.current.center.x,clientY-state.current.center.y,rect.width/2);
 const stickDown=(e:ReactPointerEvent<HTMLDivElement>)=>{e.preventDefault();const rect=stick.current?.getBoundingClientRect();if(!rect)return;state.current.stickId=e.pointerId;state.current.center={x:rect.left+rect.width/2,y:rect.top+rect.height/2};stick.current?.setPointerCapture?.(e.pointerId);const dx=e.clientX-state.current.center.x,dy=e.clientY-state.current.center.y;setKnob(dx*.4,dy*.4);const axis=axisFrom(e.clientX,e.clientY,rect);move(axis.x,axis.y,axis.sprint);};
 const stickMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(state.current.stickId!==e.pointerId)return;e.preventDefault();const rect=stick.current?.getBoundingClientRect();if(!rect)return;const dx=e.clientX-state.current.center.x,dy=e.clientY-state.current.center.y;setKnob(dx*.4,dy*.4);const axis=axisFrom(e.clientX,e.clientY,rect);move(axis.x,axis.y,axis.sprint);};
 const stickUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(state.current.stickId!==e.pointerId)return;state.current.stickId=null;setKnob(0,0);move(0,0,false);};
 const lookDown=(e:ReactPointerEvent<HTMLDivElement>)=>{if(state.current.lookId!==null)return;state.current.lookId=e.pointerId;state.current.last={x:e.clientX,y:e.clientY};(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);};
 const lookMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(state.current.lookId!==e.pointerId)return;const dx=e.clientX-state.current.last.x,dy=e.clientY-state.current.last.y;state.current.last={x:e.clientX,y:e.clientY};if(dx||dy)onLook(dx,dy);};
 const lookUp=(e:ReactPointerEvent<HTMLDivElement>)=>{if(state.current.lookId===e.pointerId)state.current.lookId=null;};
 const press=(action:string)=>{applyTouchAction(runtime.current,action,true);if(action==='swap')onSwap();};
 const release=(action:string)=>{applyTouchAction(runtime.current,action,false);};
 const holdProps=(action:string)=>({onPointerDown:(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.stopPropagation();(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);press(action);},onPointerUp:(e:ReactPointerEvent<HTMLButtonElement>)=>{e.stopPropagation();release(action);},onPointerCancel:()=>release(action),onLostPointerCapture:()=>release(action)});
 if(!visible)return null;
  return <div className={`touch-layer${car?' touch-race':''}${soccer?' touch-soccer':''}`} onContextMenu={e=>e.preventDefault()}>
  <div className="touch-look" aria-hidden="true" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} onLostPointerCapture={lookUp}/>
  <div className="touch-stick" ref={stick} aria-hidden="true" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp} onLostPointerCapture={stickUp}><i className="touch-knob" ref={knob}/></div>
  <div className="touch-buttons">
   {actions.map(action=><button key={action} type="button" className={`touch-button touch-${action}`} aria-label={labels[action]} {...holdProps(action)}>{labels[action]}</button>)}
   {!soccer&&<button type="button" className="touch-button touch-fire" aria-label={race?'Use item':'Fire'} {...holdProps('fire')}>{race?'USE ITEM':'FIRE'}</button>}
   <button type="button" className="touch-button touch-pause" aria-label="Pause" onPointerDown={(e)=>{e.preventDefault();e.stopPropagation();onPause();}}>II</button>
  </div>
 </div>;
}
