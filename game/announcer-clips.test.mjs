import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createAnnouncerSelector} from './announcer-clips.mjs';
const base=new URL('../public/audio/announcer/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base)));
test('all twelve existing cue types have three real, distinct WAV takes',()=>{
 const cues=['capture','flag-pickup','flag-return','goal','killstreak','spree','multikill','victory','defeat','score','boss','objective'];
 assert.equal(manifest.clips.length,36);
 for(const cue of cues){
  const takes=manifest.clips.filter(c=>c.cue===cue);
  assert.deepEqual(takes.map(c=>c.seed),[42,137,526]);
  assert.equal(new Set(takes.map(c=>c.sha256)).size,3);
  for(const c of takes){
   const bytes=readFileSync(new URL(c.file,base));
   assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
   assert.equal(createHash('sha256').update(bytes).digest('hex'),c.sha256);
   assert.ok(c.duration>.15&&c.duration<12);assert.ok(c.rms>.001);
  }
 }
});
test('selection never repeats immediately, remains per-cue and handles unknown cues',()=>{
 for(const random of [()=>0,()=>.999999,()=>1,()=>NaN,()=>-1]){
  const select=createAnnouncerSelector(manifest.clips,random);let last;
  for(let i=0;i<50;i++){const next=select('capture');assert.notEqual(next.file,last);assert.ok(next.url.startsWith('/audio/announcer/'));last=next.file;select('goal');}
  assert.equal(select('unknown'),null);
 }
});
test('single-take fallback and invalid filenames',()=>{
 const select=createAnnouncerSelector([manifest.clips[0]]);assert.equal(select('capture').file,select('capture').file);
 assert.throws(()=>createAnnouncerSelector([{cue:'capture',file:'../../private'}]));
});
