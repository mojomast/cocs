// Serialized CPU benchmark: construction, synchronous pre-roll and snapshots.
// Renderer/GPU performance is measured separately in the browser.
import {performance} from 'node:perf_hooks';
import {Match} from '../game/core.mjs';
import {normalizeConfig,DEFAULT_CONFIG} from '../game/config.mjs';
import {RULES} from '../game/data.mjs';
import {CinematicDirector} from '../game/director.mjs';
import {buildShowcase} from '../game/showcase-build.mjs';
import {seatShowcaseVehicles,pickShowcase} from '../game/showcase.mjs';
import {seededRng} from '../game/demo-playlist.mjs';
const scenarios=[['meridian-exchange','deathmatch',5],['verdant-reliquary','koth',5],['ember-crucible','teamdeathmatch',7],['tidal-citadel','ctf',7],['sunscar-convoy','combined-arms',7],['asterion-relay','cocs',7],['monsoon-foundry','cocs',7],['ion-speedway','puma-race',5],['aurora-stadium','puma-soccer',3]];
const rows=[];
for(const [mapId,mode,botCount] of scenarios){
 let steps=0,snapshots=0,installs=0,buildMs=0,stepMs=0,snapshotMs=0;
 class TimedMatch extends Match{
  constructor(...args){const start=performance.now();super(...args);buildMs+=performance.now()-start;}
  step(...args){const start=performance.now();try{return super.step(...args)}finally{steps++;stepMs+=performance.now()-start}}
  snapshot(){const start=performance.now();try{return super.snapshot()}finally{snapshots++;snapshotMs+=performance.now()-start}}
 }
 const r={},view={setCinema(){},setMatch(){installs++},setPlayerId(){},setDirector(){},setShowcase(){}};
 const build=buildShowcase({r,view,showcaseOk:()=>true,makeRng:()=>seededRng(44),pickShowcase,normalizeConfig,DEFAULT_CONFIG,Match:TimedMatch,seatShowcaseVehicles,RULES,CinematicDirector,reducedMotion:()=>false,setShowcaseLive(){}});
 const start=performance.now();if(!build({id:mode,mapId,mode,botCount,difficulty:'normal',timeLimit:120,fragLimit:mode==='puma-race'?1:100,seatVehicles:mode==='combined-arms'?.7:0}))throw Error(mapId);
 if(r.showcaseMatchedId!==mapId){view.setMatch(r.showcase.match.snapshot());view.setShowcase(r.showcase.match.snapshot());}
 rows.push({mapId,mode,actors:r.showcase.match.actors.length,totalMs:performance.now()-start,buildMs,stepMs,snapshotMs,steps,snapshots,installs});
}
console.log(JSON.stringify({method:'Fixed seed 44; sequential cold map construction and first-frame synchronization; CPU only.',rows},null,2));
