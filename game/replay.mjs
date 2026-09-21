import {DEFAULT_CONFIG,GAME_MODES,normalizeConfig} from './config.mjs';
import {CHARACTERS,HARNESSES,validLoadout,resolveLoadout} from './data.mjs';
import {MAPS} from './maps.mjs';
import {activeMaps,mapsForMode} from './arenas.mjs';
import {CAMPAIGN_MISSIONS} from './campaign-data.mjs';

export const QUICK_MATCH_PRESETS = [
 {id:'warmup',name:'Warmup',detail:'0 bots / explore',rules:{mode:'deathmatch',botCount:0,difficulty:'easy'}},
 {id:'casual',name:'Casual Skirmish',detail:'2 bots / easy',rules:{mode:'deathmatch',botCount:2,difficulty:'easy'}},
 {id:'duel',name:'Duel',detail:'1 bot / normal',rules:{mode:'deathmatch',botCount:1,difficulty:'normal'}},
 {id:'rockets',name:'Rocket Party',detail:'3 bots / easy',rules:{mode:'rockets',botCount:3,difficulty:'easy'}},
];

export function presetConfig(id,config={}){
 const preset=QUICK_MATCH_PRESETS.find(p=>p.id===id);
 return normalizeConfig(preset?{...DEFAULT_CONFIG,...preset.rules,playerName:config.playerName}:config);
}

export function selectionPool({legacy=true,mode='deathmatch'}={}){
 const pool=mapsForMode(mode,{legacy});
 return pool.length?pool:(legacy?MAPS:activeMaps());
}

export function shuffleSelection(random=Math.random,{legacy=true,mode='deathmatch'}={}){
 const pool=selectionPool({legacy,mode});
 const character=CHARACTERS[Math.floor(random()*CHARACTERS.length)].id;
 const compatible=HARNESSES.filter(h=>validLoadout(character,h.id));
 const harness=compatible[Math.floor(random()*compatible.length)].id;
 return {...resolveLoadout(character,harness),mapId:pool[Math.floor(random()*pool.length)].id};
}

export function nextArenaSelection(mapId,random=Math.random,{legacy=true,mode='deathmatch',randomize=false}={}){
 const pool=selectionPool({legacy,mode});
 const current=pool.findIndex(m=>m.id===mapId),next=((current+1)%pool.length+pool.length)%pool.length;
 const base=randomize?shuffleSelection(random,{legacy,mode}):{};
 return {...base,mapId:pool[next].id};
}

export function surpriseSelection(random=Math.random,{legacy=true,mode=null}={}){
 const modes=mode?[mode]:GAME_MODES.map(item=>item.id);
 const picked=modes[Math.floor(random()*modes.length)];
  const selection=shuffleSelection(random,{legacy,mode:picked});
  // Campaign geometry and authored anchors form one contract, including in a
  // surprise launch. Never pair an arbitrary arena with the saved mission.
  const mission=picked==='campaign'?CAMPAIGN_MISSIONS[Math.floor(random()*CAMPAIGN_MISSIONS.length)]:null;
  return {...selection,...(mission?{mapId:mission.mapId,mission:mission.id}:{}),mode:picked};
}
