import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,MELEE} from './core.mjs';

const open=()=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'exchange',{mode:'deathmatch',botCount:0,humanCount:2});
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};m.pickups=[];m.vehicles=[];
 const [a,b]=m.actors;
 Object.assign(a,{x:0,y:0,z:0,health:100,armor:0,protection:0,shotWait:0,weaponSwitch:0,melee:0,yaw:0,pitch:0,punchYaw:0,punchPitch:0});
 Object.assign(b,{x:0,y:0,z:-2,health:100,armor:0,protection:0});
 a.ammo[0]=Infinity;
 return {m,a,b};
};

test('melee damages a close target in front and reports the hit',()=>{
 const {m,a,b}=open();
 assert.equal(m.melee(a),true);
 assert.equal(b.health,100-MELEE.damage);
 const event=m.events.find(e=>e.type==='melee');
 assert.ok(event&&event.hit===b.id);
});

test('melee respects its cooldown',()=>{
 const {m,a,b}=open();
 assert.equal(m.melee(a),true);
 assert.equal(m.melee(a),false,'a second swing inside the cooldown is refused');
 assert.equal(b.health,100-MELEE.damage);
});

test('melee misses targets out of range or behind the attacker',()=>{
 const {m,a,b}=open();
 Object.assign(b,{z:-10,health:100});
 a.melee=0;
 assert.equal(m.melee(a),true);
 assert.equal(b.health,100,'out of range is a miss');
 Object.assign(b,{z:2,health:100});
 a.melee=0;
 assert.equal(m.melee(a),true);
 assert.equal(b.health,100,'behind the attacker is a miss');
 assert.ok(m.events.some(e=>e.type==='melee'&&e.hit===null));
});

test('melee never hits a teammate',()=>{
 const m=new Match('chatgpt','openclaw',()=>.5,'launchpad',{mode:'ctf',botCount:0,humanCount:2});
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};m.pickups=[];m.vehicles=[];
 const [a,b]=m.actors;
 a.team=0;b.team=0;
 Object.assign(a,{x:0,y:0,z:0,health:100,protection:0,melee:0,yaw:0,pitch:0});
 Object.assign(b,{x:0,y:0,z:-1.5,health:100,armor:0,protection:0});
 assert.equal(m.melee(a),true);
 assert.equal(b.health,100);
});
