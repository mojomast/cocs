import test from 'node:test';
import assert from 'node:assert/strict';
import {TOUCH_BUTTONS,applyLook,applyTouchAction,joystickVector,lookStep,moveAxis,stickAxis} from './touch.mjs';

test('joystick vectors clamp to the unit circle',()=>{
 assert.deepEqual(joystickVector(0,0,50),{x:0,y:0,magnitude:0});
 const right=joystickVector(100,0,50);
 assert.equal(right.magnitude,1);
 assert.ok(Math.abs(right.x-1)<1e-9&&Math.abs(right.y)<1e-9);
 const diagonal=joystickVector(50,50,50);
 assert.ok(diagonal.magnitude<=1+1e-9&&diagonal.x>0&&diagonal.y>0);
});

test('move axis applies a deadzone, forward sign and sprint threshold',()=>{
 assert.deepEqual(moveAxis(3,3,100),{x:0,y:0,sprint:false});
 const forward=moveAxis(0,-80,100);
 assert.ok(forward.y>0&&forward.x===0&&forward.sprint===false);
 assert.equal(moveAxis(0,-100,100).sprint,true);
 assert.ok(moveAxis(60,0,100).x>0);
 assert.ok(moveAxis(-60,0,100).x<0);
});

test('stick axis never saturates from a collapsed base and clamps knob travel',()=>{
 const idle=stickAxis(0,0,0);
 assert.deepEqual(idle,{x:0,y:0,sprint:false,magnitude:0,knobX:0,knobY:0});
 const pushed=stickAxis(1,1,0);
 assert.ok(pushed.magnitude<.5&&pushed.x===0&&pushed.y===0,'a tiny offset stays inside the deadzone even with a zero radius');
 const full=stickAxis(1000,0,0);
 assert.equal(full.magnitude,1);
 assert.ok(full.x>0&&full.sprint===true);
 assert.ok(Math.hypot(full.knobX,full.knobY)<=56.0001,'knob stays within the base');
 const big=stickAxis(0,-50,66,29);
 assert.ok(big.y>0&&big.magnitude<1&&Math.hypot(big.knobX,big.knobY)<=37.0001);
});

test('look steps accumulate yaw and clamp pitch',()=>{
 const look={yaw:0,pitch:0};
 applyLook(look,100,0,1);
 assert.ok(look.yaw<0);
 applyLook(look,0,10000,1);
 assert.equal(look.pitch,-1.45);
 applyLook(look,0,-10000,1);
 assert.equal(look.pitch,1.45);
 assert.deepEqual(lookStep(0,0,1),{yaw:0,pitch:0});
 assert.equal(applyLook(null,10,10),null);
 assert.equal(TOUCH_BUTTONS.length,11);
 assert.ok(TOUCH_BUTTONS.includes('voice'));
 assert.ok(TOUCH_BUTTONS.includes('melee'));
 assert.ok(TOUCH_BUTTONS.includes('grenade'));
});

test('applyTouchAction tracks held buttons and latches one-shot actions',()=>{
 const runtime={voice:{talking:[],setPushToTalk(v){this.talking.push(v);}}};
 applyTouchAction(runtime,'fire',true);
 applyTouchAction(runtime,'ads',true);
 applyTouchAction(runtime,'crouch',true);
 applyTouchAction(runtime,'voice',true);
  assert.equal(runtime.touch.fire,true);
  assert.equal(runtime.touch.ads,true);
  assert.equal(runtime.fireTap,true);
 assert.equal(runtime.touch.crouch,true);
 assert.deepEqual(runtime.voice.talking,[true]);
 applyTouchAction(runtime,'jump',true);
 applyTouchAction(runtime,'reload',true);
 applyTouchAction(runtime,'power',true);
 applyTouchAction(runtime,'interact',true);
 applyTouchAction(runtime,'melee',true);
 assert.equal(runtime.jump,true);
 assert.equal(runtime.reload,true);
 assert.equal(runtime.power,true);
 assert.equal(runtime.interact,true);
 assert.equal(runtime.melee,true);
 // Releasing one-shots must not re-arm them, and swap is handled by the caller.
 applyTouchAction(runtime,'jump',false);
 applyTouchAction(runtime,'swap',true);
 assert.equal(runtime.jump,true);
 applyTouchAction(runtime,'fire',false);
 applyTouchAction(runtime,'ads',false);
 applyTouchAction(runtime,'crouch',false);
 applyTouchAction(runtime,'voice',false);
  assert.equal(runtime.touch.fire,false);
  assert.equal(runtime.touch.ads,false);
  assert.equal(runtime.fireTap,true, 'release preserves the unconsumed tap');
 assert.equal(runtime.touch.crouch,false);
 assert.deepEqual(runtime.voice.talking,[true,false]);
 assert.equal(applyTouchAction(null,'fire',true),null);
});

test('inverted touch look flips pitch without touching yaw',()=>{
 const normal=lookStep(12,10,1,false),inverted=lookStep(12,10,1,true);
 assert.equal(normal.yaw,inverted.yaw);
 assert.equal(normal.pitch,-inverted.pitch);
});

test('grenade is a touch button and a one-shot action',()=>{
 assert.ok(TOUCH_BUTTONS.includes('grenade'));
 const runtime={};applyTouchAction(runtime,'grenade',true);
 assert.equal(runtime.grenade,true);
});
