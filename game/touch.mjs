// Pure touch-input math. Kept engine- and DOM-free so the joystick curve and
// look mapping are unit-testable and shared by the on-screen controls.
export const TOUCH_DEADZONE=.14;
export const TOUCH_SPRINT=.9;
export const TOUCH_LOOK_SCALE=.004;
// The stick base is measured from the DOM. A collapsed or as-yet-unlaid-out base
// reports a tiny radius, which used to divide the pointer offset up to a full
// phantom tilt (the reported "any touch snaps the stick forward"). Floor the
// radius and derive the visible knob travel from it.
export const TOUCH_STICK_RADIUS_MIN=28;
export const TOUCH_STICK_RADIUS_MAX=96;
// Convert a pointer offset into a movement axis plus a clamped knob offset.
export function stickAxis(dx,dy,radius,knobRadius=24){
 const r=Math.max(TOUCH_STICK_RADIUS_MIN,Math.min(TOUCH_STICK_RADIUS_MAX,Number(radius)||0));
 const vector=joystickVector(dx,dy,r),axis=moveAxis(dx,dy,r),travel=Math.max(4,r-(Number(knobRadius)||0));
 return {x:axis.x,y:axis.y,sprint:axis.sprint,magnitude:vector.magnitude,knobX:vector.x*travel,knobY:vector.y*travel};
}
export const TOUCH_BUTTONS=Object.freeze(['fire','ads','jump','crouch','reload','power','melee','grenade','interact','swap','voice']);
// Screen-space joystick vector: x right, y down, magnitude clamped to 1.
export function joystickVector(dx,dy,radius=1){
 const r=Math.max(1e-6,Number(radius)||1),nx=(Number(dx)||0)/r,ny=(Number(dy)||0)/r,magnitude=Math.hypot(nx,ny);
 if(magnitude<=1e-6)return {x:0,y:0,magnitude:0};
 const clamped=Math.min(1,magnitude),scale=clamped/magnitude;
 return {x:nx*scale,y:ny*scale,magnitude:clamped};
}
// Convert a screen joystick offset into a movement axis where y is forward.
export function moveAxis(dx,dy,radius=1){
 const vector=joystickVector(dx,dy,radius);
 if(vector.magnitude<=TOUCH_DEADZONE)return {x:0,y:0,sprint:false};
 const gain=Math.min(1,(vector.magnitude-TOUCH_DEADZONE)/(1-TOUCH_DEADZONE))/vector.magnitude;
 return {x:vector.x*gain,y:-vector.y*gain,sprint:vector.magnitude>=TOUCH_SPRINT};
}
export function lookStep(dx,dy,sensitivity=1,invert=false){
 const scale=TOUCH_LOOK_SCALE*(Number.isFinite(sensitivity)&&sensitivity>0?sensitivity:1),x=Number(dx)||0,y=Number(dy)||0;
 return {yaw:x?-x*scale:0,pitch:y?(invert?1:-1)*y*scale:0};
}
export function applyLook(look,dx,dy,sensitivity=1,invert=false){
 if(!look)return null;
 const step=lookStep(dx,dy,sensitivity,invert);
 look.yaw=(Number.isFinite(look.yaw)?look.yaw:0)+step.yaw;
 look.pitch=Math.max(-1.45,Math.min(1.45,(Number.isFinite(look.pitch)?look.pitch:0)+step.pitch));
 return look;
}
export const isTouchDevice=()=>typeof window!=='undefined'&&(window.matchMedia?.('(pointer: coarse)')?.matches===true||(typeof navigator!=='undefined'&&navigator.maxTouchPoints>0));
// Apply an on-screen button press/release to the imperative runtime. Held actions
// (fire, ADS, crouch, voice) track the pointer; one-shot actions (jump, reload,
// power, interact) only latch on press and are consumed by the simulation loop.
export function applyTouchAction(runtime,action,pressed){
 if(!runtime)return null;
 runtime.touch??={};
  if(action==='fire'){runtime.touch.fire=pressed;if(pressed)runtime.fireTap=true;}
  else if(action==='ads')runtime.touch.ads=pressed;
 else if(action==='crouch')runtime.touch.crouch=pressed;
 else if(action==='voice')runtime.voice?.setPushToTalk?.(pressed);
 else if(pressed){
  if(action==='jump')runtime.jump=true;
  else if(action==='reload')runtime.reload=true;
  else if(action==='power')runtime.power=true;
  else if(action==='melee')runtime.melee=true;
  else if(action==='grenade')runtime.grenade=true;
  else if(action==='interact')runtime.interact=true;
 }
 return runtime;
}
