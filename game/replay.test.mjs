import test from 'node:test';
import assert from 'node:assert/strict';
import {QUICK_MATCH_PRESETS,presetConfig,shuffleSelection,nextArenaSelection,surpriseSelection} from './replay.mjs';
import {missionFor,CAMPAIGN_MISSIONS} from './campaign-data.mjs';
import {arenaMeta,mapsForMode} from './arenas.mjs';
import {GAME_MODES,normalizeConfig} from './config.mjs';
import {CHARACTERS,HARNESSES,validLoadout} from './data.mjs';

test('presets are normalized, reset modifiers and preserve callsign',()=>{
 for(const preset of QUICK_MATCH_PRESETS){
  const config=presetConfig(preset.id,{playerName:'Pilot',damage:2,speed:1.5});
  assert.deepEqual(config,normalizeConfig(config));
  assert.equal(config.playerName,'Pilot');
  assert.equal(config.damage,1);
  assert.equal(config.speed,1);
  for(const [key,value] of Object.entries(preset.rules))assert.equal(config[key],value);
 }
 assert.deepEqual(QUICK_MATCH_PRESETS.map(p=>[p.rules.botCount,p.rules.difficulty]),[[0,'easy'],[2,'easy'],[1,'normal'],[3,'easy']]);
});

test('shuffle is deterministic with injected RNG and covers compatible choices',()=>{
 const sequence=()=>{let i=0;return ()=>[.2,.7,.9][i++%3];};
 assert.deepEqual(shuffleSelection(sequence()),shuffleSelection(sequence()));
 const pool=mapsForMode('deathmatch',{legacy:true});
 for(let c=0;c<CHARACTERS.length;c++)for(let h=0;h<HARNESSES.length;h++)for(let m=0;m<pool.length;m++){
  const values=[(c+.5)/CHARACTERS.length,(h+.5)/HARNESSES.length,(m+.5)/pool.length];
  const selection=shuffleSelection(()=>values.shift());
  assert.equal(selection.character,CHARACTERS[c].id);
  assert.equal(selection.mapId,pool[m].id);
  assert.ok(validLoadout(selection.character,selection.harness));
  if(selection.character==='claude')assert.equal(selection.harness,'claudecode');
 }
});

test('next arena rotates only the map and leaves the loadout untouched',()=>{
 const pool=mapsForMode('deathmatch',{legacy:true});
 assert.ok(pool.length>1);
 for(let i=0;i<pool.length;i++)for(const roll of [0,.25,.5,.999999]){
  const next=nextArenaSelection(pool[i].id,()=>roll);
  assert.deepEqual(next,{mapId:pool[(i+1)%pool.length].id});
  assert.notEqual(next.mapId,pool[i].id);
 }
 assert.equal(nextArenaSelection('unknown',()=>0).mapId,pool[0].id);
 assert.deepEqual(nextArenaSelection('unknown',()=>0),{mapId:pool[0].id});
});

test('next arena can opt into a compatible random loadout',()=>{
 const pool=mapsForMode('deathmatch',{legacy:true});
 for(let i=0;i<pool.length;i++)for(const roll of [0,.25,.5,.999999]){
  const next=nextArenaSelection(pool[i].id,()=>roll,{randomize:true});
  assert.equal(next.mapId,pool[(i+1)%pool.length].id);
  assert.ok(validLoadout(next.character,next.harness));
  assert.deepEqual(next,nextArenaSelection(pool[i].id,()=>roll,{randomize:true}));
 }
});

test('surprise selection randomises mode plus a compatible loadout',()=>{
 const sequence=()=>{let i=0;return ()=>[0,.2,.7,.9][i++%4];};
 const first=surpriseSelection(sequence()),second=surpriseSelection(sequence());
 assert.deepEqual(first,second);
 assert.ok(GAME_MODES.some(mode=>mode.id===first.mode));
 assert.ok(validLoadout(first.character,first.harness));
 assert.ok(first.mapId);
 assert.equal(surpriseSelection(()=>0,{mode:'puma-race'}).mode,'puma-race');
 assert.equal(surpriseSelection(()=>0,{mode:'puma-race'}).mapId,'puma-circuit');
});

test('next arena restricts the rotation to maps that support the active mode',()=>{
  const combat=mapsForMode('deathmatch',{legacy:true});
  assert.ok(combat.every(map=>!map.race&&arenaMeta(map.id).play.includes('deathmatch')));
  for(const mode of ['puma-race','puma-soccer','cocs','cocs-coop']){
   const options={legacy:true,mode},pool=mapsForMode(mode,options);
   assert.ok(pool.length>1,`${mode} has an expanded rotation`);
   for(let i=0;i<pool.length;i++){
    assert.ok(arenaMeta(pool[i].id).play.includes(mode),`${pool[i].id} explicitly supports ${mode}`);
    assert.deepEqual(nextArenaSelection(pool[i].id,()=>.5,options),{mapId:pool[(i+1)%pool.length].id});
    const roll=(i+.5)/pool.length;
    assert.equal(shuffleSelection(()=>roll,options).mapId,pool[i].id,'every compatible map is selectable');
   }
   assert.equal(nextArenaSelection('convoy-line',()=>.5,options).mapId,pool[0].id,'incompatible selections rotate to the default');
  }
  assert.equal(nextArenaSelection('convoy-line',()=>.5,{legacy:true,mode:'puma-race'}).mapId,'puma-circuit');
  assert.equal(nextArenaSelection('convoy-line',()=>.5,{legacy:true,mode:'puma-soccer'}).mapId,'puma-pitch');
});
test('surprise campaign launches keep the mission and its authored map together',()=>{
 for(let i=0;i<CAMPAIGN_MISSIONS.length;i++){
  const selection=surpriseSelection(()=>(i+.1)/CAMPAIGN_MISSIONS.length,{mode:'campaign'});
  assert.equal(selection.mission,CAMPAIGN_MISSIONS[i].id);
  assert.equal(selection.mapId,missionFor(selection.mission).mapId);
 }
});
