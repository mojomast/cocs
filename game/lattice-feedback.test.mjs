import test from 'node:test';
import assert from 'node:assert/strict';
import {latticeSoundCue,latticeCaption} from './lattice-feedback.mjs';
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
