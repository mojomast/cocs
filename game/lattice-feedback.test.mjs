import test from 'node:test';
import assert from 'node:assert/strict';
import {latticeSoundCue,latticeCaption,latticePresentationChanges} from './lattice-feedback.mjs';
import {SynthAudio} from './feedback.mjs';
test('LATTICE event audio is bounded and distinguishes secured ground from loss',()=>{
 const player={id:0,team:0};
 const audio=new SynthAudio();audio.ctx={currentTime:0};
 const heard=[];audio._beat=cue=>heard.push(cue);
 for(const type of ['cocs-capture','cocs-depot-capture','director-wave','director-wave-cleared','director-siege','director-siege-lifted'])audio.event({type,team:0},player);
 assert.equal(heard.length,6);
 assert.ok(heard.every(cue=>cue.notes.length<=4&&cue.gain<=.08&&cue.length<=.3));
 assert.notDeepEqual(latticeSoundCue({type:'cocs-capture',team:0},player),latticeSoundCue({type:'cocs-capture',team:1},player));
 assert.equal(latticeSoundCue({type:'cocs-device-use',actor:1},player),null);
 assert.equal(latticeSoundCue({type:'cocs-terminal-hack',team:1},player),null);
 for(const type of ['director-hq-damage','zone-progress','director-phase'])assert.equal(latticeSoundCue({type},player),null,'no progress/tick chatter');
 assert.match(latticeCaption({type:'director-siege'}),/FALL BACK/);
});

test('world-marker transitions fire once per flip and seed without a burst',()=>{
 const nodes=[{id:'front-0',owner:0,x:-54,y:4,z:0,r:6},{id:'relay-0',owner:null,x:0,y:4,z:0,r:6}];
 const depots=[{id:'depot-0',owner:null,x:-70,y:4,z:-50,radius:6}];
 const devices=[{id:'zip-a',state:'live',x:-30,y:2,z:0}];
 const first=latticePresentationChanges(null,{nodes,depots,devices});
 assert.equal(first.captures.length,0,'the first frame seeds markers instead of sparking');
 assert.equal(first.deviceChanges.length,0);
 const capture=latticePresentationChanges(first.next,{nodes:[{...nodes[0],owner:1},nodes[1]],depots,devices});
 assert.equal(capture.captures.length,1);
 assert.deepEqual({owner:capture.captures[0].owner,lost:capture.captures[0].lost,x:capture.captures[0].x,radius:capture.captures[0].radius},{owner:1,lost:false,x:-54,radius:6});
 const quiet=latticePresentationChanges(capture.next,{nodes:[{...nodes[0],owner:1},nodes[1]],depots,devices});
 assert.equal(quiet.captures.length,0,'a held node does not re-fire');
 const routed=latticePresentationChanges(quiet.next,{nodes:[{...nodes[0],owner:1},nodes[1]],depots:[{...depots[0],owner:1}],devices:[{...devices[0],state:'cut'}]});
 assert.equal(routed.captures.length,1);
 assert.equal(routed.captures[0].depot,true);
 assert.deepEqual(routed.deviceChanges.map(change=>[change.from,change.to]),[['live','cut']]);
 assert.equal(nodes[0].owner,0,'the authoritative node list is never mutated');
});
