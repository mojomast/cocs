// Spectator/kill-cam marker kit. The pooled world marker is presentation-only:
// generated geometry, `depthTest:false`, keyed slot reuse, a static pose when
// asked and exactly-once disposal. Pure pool coverage; the view wiring lives in
// view.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {FollowMarkerPool,FOLLOW_MARKER_COLOR,KILLER_MARKER_COLOR} from './effects-fx.mjs';

test('the marker pool keeps keyed roles, hides unmarked ones and never grows past its budget',()=>{
 const scene=new T.Scene(),pool=new FollowMarkerPool(scene,2);
 assert.equal(pool.limit,2);
 const follow=pool.place('follow',1,0,2,{time:0,pulse:false});
 assert.ok(follow?.active&&follow.group.visible);
 assert.deepEqual(follow.group.position.toArray(),[1,0,2]);
 assert.equal(follow.material.depthTest,false,'the marker reads through geometry');
 assert.equal(follow.group.userData.followMarker,true);
 assert.equal(follow.ring.position.y,.07);
 assert.equal(follow.chevron.position.y,1.72);
 assert.equal(follow.chevron.visible,true);
 assert.equal(follow.bracket.visible,false);
 assert.equal(follow.material.color.getHexString(),FOLLOW_MARKER_COLOR.slice(1));
 assert.equal(pool.place('follow',3,0,4,{time:0,pulse:false}),follow,'a role keeps its slot frame to frame');
 assert.deepEqual(follow.group.position.toArray(),[3,0,4]);
 const killer=pool.place('killer',5,0,6,{kind:'killer',color:KILLER_MARKER_COLOR,time:0,pulse:false});
 assert.notEqual(killer,follow);
 assert.equal(killer.bracket.visible,true,'the killer role carries the bracket');
 assert.equal(killer.chevron.visible,false);
 assert.equal(killer.material.color.getHexString(),KILLER_MARKER_COLOR.slice(1));
 // Both roles are live in this frame; a role that is not re-placed next frame
 // hides at `end` and releases its key.
 assert.equal(pool.end(),2,'both roles are marked this frame');
 assert.equal(pool.place('killer',5,0,6,{kind:'killer',color:KILLER_MARKER_COLOR,time:0,pulse:false}),killer);
 assert.equal(pool.end(),1,'only the killer stayed marked');
 assert.equal(follow.active,false);assert.equal(follow.group.visible,false);
 assert.equal(killer.active,true);assert.equal(killer.group.visible,true);
 pool.end();
 assert.equal(pool.byKey.size,0,'an unplaced pair leaves nothing on screen');
 assert.ok(pool.slots.every(entry=>!entry.active&&!entry.group.visible));
 // A third role recycles the oldest slot instead of allocating.
 const recycled=pool.place('follow',9,0,9,{pulse:false});
 assert.equal(pool.slots.length,2,'the pool budget holds');
 assert.equal(recycled,follow,'the oldest slot is reused first');
 pool.clear();
 assert.equal(pool.byKey.size,0);
 assert.equal(scene.children.filter(child=>child.visible).length,0);
 // Bound to the scene and disposed exactly once.
 const resources=new Set([pool.ringGeo,pool.chevronGeo,pool.bracketGeo]);
 for(const entry of pool.slots)resources.add(entry.material);
 const counts=new Map();for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 pool.dispose();
 assert.ok([...counts.values()].every(count=>count===1),'every marker resource disposes exactly once');
 assert.equal(scene.children.length,0);
});

test('the marker pulse is deterministic, optional and bounded',()=>{
 const scene=new T.Scene(),pool=new FollowMarkerPool(scene,1);
 const slot=pool.place('follow',0,0,0,{time:.35,pulse:true});
 const bob=slot.chevron.position.y,beat=slot.ring.scale.x;
 assert.ok(bob>1.72&&bob<1.8,'a pulsed chevron bobs within a bounded arc');
 assert.ok(beat>1&&beat<1.1,'a pulsed ring beats within a bounded range');
 pool.place('follow',0,0,0,{time:.35,pulse:true});
 assert.equal(slot.chevron.position.y,bob,'the same time reproduces the same pose');
 pool.place('follow',0,0,0,{time:.9,pulse:false});
 assert.equal(slot.chevron.position.y,1.72,'a static request parks the chevron');
 assert.equal(slot.ring.scale.x,1,'a static request parks the ring');
 assert.equal(slot.chevron.rotation.y,0);
 pool.dispose();
});
