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
// Player-tunable touch layout, persisted on the display object
// (`touchScale`/`touchOpacity`/`touchLeftHanded`). The 44px minimum target is a
// hard floor: scaling down never shrinks an actionable control below it.
export const TOUCH_SCALE_MIN=.8;
export const TOUCH_SCALE_MAX=1.3;
export const TOUCH_OPACITY_MIN=.4;
export const TOUCH_OPACITY_MAX=1;
export const TOUCH_TARGET_MIN=44;
const touchRange=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
// One pure interpretation of the display values shared by the layer and the
// stylesheet: the layer writes the CSS variables/class, the CSS reads them, and
// the JS stick math scales with the same factor so the knob travel matches the
// rendered base. `style` keys are the exact custom properties globals.css reads.
export function touchDisplay(value={}){
 const scale=touchRange(value?.touchScale,TOUCH_SCALE_MIN,TOUCH_SCALE_MAX,1);
 const opacity=touchRange(value?.touchOpacity,TOUCH_OPACITY_MIN,TOUCH_OPACITY_MAX,1);
 const leftHanded=value?.touchLeftHanded===true;
 return {
  scale,opacity,leftHanded,
  className:leftHanded?'touch-layer--left-hand':'',
  style:{'--touch-scale':String(scale),'--touch-opacity':String(opacity)},
  metrics:{stickRadius:Math.round(66*scale),knobRadius:Math.max(20,Math.round(29*scale)),lookTravel:Math.round(33*scale),targetMin:TOUCH_TARGET_MIN},
 };
}
// Effective on-screen target in px for a base size. Never below the 44px floor.
export const touchTargetSize=(base,scale=1)=>Math.max(TOUCH_TARGET_MIN,Math.round((Number(base)||0)*(Number.isFinite(Number(scale))?Number(scale):1)));
// Convert a pointer offset into a movement axis plus a clamped knob offset.
export function stickAxis(dx,dy,radius,knobRadius=24){
 const r=Math.max(TOUCH_STICK_RADIUS_MIN,Math.min(TOUCH_STICK_RADIUS_MAX,Number(radius)||0));
 const vector=joystickVector(dx,dy,r),axis=moveAxis(dx,dy,r),travel=Math.max(4,r-(Number(knobRadius)||0));
 return {x:axis.x,y:axis.y,sprint:axis.sprint,magnitude:vector.magnitude,knobX:vector.x*travel,knobY:vector.y*travel};
}
export const TOUCH_BUTTONS=Object.freeze(['fire','ads','alt','jump','crouch','reload','power','melee','grenade','interact','swap','voice','mobility']);
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
// (fire, ADS, alt fire, jump, crouch, mobility, voice) track the pointer; jump is
// held so touch gets the same landing re-arm/auto-hop semantics as a desktop
// bind. Reload, power and interact stay one-shot edges consumed by the sim loop.
// The alt button writes the held `touch.altFire` field `controlsFromState`
// reads (the button id stays short as `alt`).
export function applyTouchAction(runtime,action,pressed){
 if(!runtime)return null;
 runtime.touch??={};
  if(action==='fire'){runtime.touch.fire=pressed;if(pressed)runtime.fireTap=true;}
  else if(action==='ads')runtime.touch.ads=pressed;
  else if(action==='alt')runtime.touch.altFire=pressed;
  else if(action==='jump'){runtime.touch.jump=pressed;if(pressed)runtime.jump=true;}
  else if(action==='crouch')runtime.touch.crouch=pressed;
 else if(action==='mobility')runtime.touch.mobility=pressed;
 else if(action==='voice')runtime.voice?.setPushToTalk?.(pressed);
 else if(pressed){
   if(action==='reload')runtime.reload=true;
  else if(action==='power')runtime.power=true;
  else if(action==='melee')runtime.melee=true;
  else if(action==='grenade')runtime.grenade=true;
  else if(action==='interact')runtime.interact=true;
 }
 return runtime;
}
