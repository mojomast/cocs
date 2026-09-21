import test from 'node:test';
import assert from 'node:assert/strict';
import {stepShowcase,showcaseSnapshot,showcaseFrameCap} from './showcase-runtime.mjs';
const fixture=()=>({time:0,acc:0,match:{time:0,steps:0,snapshots:0,events:[],serial:0,step(dt){this.time+=dt;this.steps++;},snapshot(){this.snapshots++;return {time:this.time}}}});
test('demo keeps fixed ticks and bounds catch-up without carrying an old backlog',()=>{
 const sc=fixture(),dt=1/60;
 for(let i=0;i<120;i++)stepShowcase(sc,dt/2,dt,{now:()=>0});
 assert.equal(sc.match.steps,60);assert.ok(Math.abs(sc.match.time-1)<1e-8);
 const before=sc.match.steps;assert.equal(stepShowcase(sc,1,dt,{now:()=>0}),2);assert.equal(sc.match.steps-before,2);
 assert.ok(sc.acc<dt);assert.equal(sc.performance.maxSteps,2);
});
test('slow demo ticks yield to the browser after the first expensive step',()=>{
 const sc=fixture();let now=0;sc.match.step=dt=>{sc.match.time+=dt;now+=8};
 assert.equal(stepShowcase(sc,.1,1/60,{now:()=>now}),1);assert.ok(sc.acc<1/60);
});
test('background snapshots are bounded, reused while paused, and refreshed with events',()=>{
 const sc=fixture();
 for(let at=0;at<1000;at+=1000/120){sc.match.time=at/1000;showcaseSnapshot(sc,at);}
 assert.ok(sc.match.snapshots>=29&&sc.match.snapshots<=31);
 const last=showcaseSnapshot(sc,1000);assert.equal(showcaseSnapshot(sc,2000),last,'paused state allocates nothing');
 sc.match.time+=1/60;sc.match.events=[{id:1}];sc.match.serial=1;
 const active=showcaseSnapshot(sc,2020,{active:true});assert.notEqual(active,last);assert.equal(active.events,sc.match.events);assert.equal(active.serial,1);
});
test('demo render caps preserve lower user caps and never cap gameplay',()=>{
 assert.equal(showcaseFrameCap(0,{showcase:true}),30);
 assert.equal(showcaseFrameCap(144,{showcase:true,active:true}),60);
 assert.equal(showcaseFrameCap(24,{showcase:true,active:true}),24);
 assert.equal(showcaseFrameCap(144),144);assert.equal(showcaseFrameCap(0),0);
});
