// Builds the next menu-demo scenario (see SHOWCASES): a bot match with the
// camera driven by the cinematic director, or the car demo camera for the
// vehicle modes (match.race). The build is atomic: a scenario that fails to
// construct leaves the current reel intact instead of dropping the title screen
// back to the static operator preview.
//
// The historical index-based pick (`r.showcaseReel` + `pickShowcase`) is still
// the default so the pinned showcase tests keep working. Callers that own a
// rotation (app/page.tsx via game/demo-session.mjs) can pass `selectScenario`
// or hand an explicit spec to the returned builder; both paths produce the same
// match-ready spec shape.
import {shuffleShowcaseReel as defaultShuffleReel,SHOWCASE_MAX_SECONDS} from './showcase.mjs';
import {SHOWCASE_WARMUP_SECONDS} from './showcase-runtime.mjs';

export function buildShowcase({r,view,showcaseOk,makeRng,pickShowcase,normalizeConfig,DEFAULT_CONFIG,Match,seatShowcaseVehicles,RULES,CinematicDirector,reducedMotion,setShowcaseLive,shuffleShowcaseReel=defaultShuffleReel,selectScenario=/** @type {any} */(null),onError=/** @type {any} */(null)}){
 const clear=()=>{r.showcase=null;r.showcaseMatchedId=null;r.showcaseReel=null;view.setShowcase(null);view.setCinema(false);view.setDirector(null);setShowcaseLive(false);};
 const fail=error=>{try{onError?.(error);}catch{}return false;};
 return (overrideSpec=null)=>{
  if(!showcaseOk()){clear();return false;}
  try{
   const rng=makeRng();
   let spec=overrideSpec&&typeof overrideSpec==='object'?overrideSpec:null;
   if(!spec&&typeof selectScenario==='function')spec=selectScenario(rng);
   if(!spec){
    if(!Array.isArray(r.showcaseReel)||!r.showcaseReel.length)r.showcaseReel=shuffleShowcaseReel(rng);
    const index=r.showcaseReel.shift();
    spec=pickShowcase(index,rng,{legacy:r.legacyArenas===true});
   }
   const cfg=normalizeConfig({...DEFAULT_CONFIG,mode:spec.mode,botCount:spec.botCount,difficulty:spec.difficulty,timeLimit:spec.timeLimit,fragLimit:spec.fragLimit});
   const m=new Match('chatgpt','openclaw',rng,spec.mapId,cfg);
   for(const a of m.actors)if(!a.bot)a.bot={route:[],think:0,target:-1,memory:0,reaction:0,stuck:0,last:{x:0,y:0,z:0},state:'roam',patrol:0,flank:null,flankDone:false,recover:0,suppressed:0,threat:-1,standoff:null,strafeReverse:-99};
   if(spec.seatVehicles)seatShowcaseVehicles(m,spec.seatVehicles);
    // An autonomous reel does not need a human-ready countdown. Start sports
    // immediately, then warm every mode for just half a second of simulation.
    if(m.race?.phase==='countdown'){m.race.countdown=0;m.race.phase='racing';}
    if(m.race?.phase==='kickoff'){m.race.countdown=0;m.race.phase='playing';}
    for(let tick=0;tick<Math.round(SHOWCASE_WARMUP_SECONDS/RULES.dt);tick++)m.step(RULES.dt,{inputs:{}});
   const bd=m.arena.bounds,arenaR=bd?Math.hypot(bd.maxX-bd.minX,bd.maxZ-bd.minZ)/2:30,director=new CinematicDirector({random:makeRng(),center:m.center,radius:11,minShot:4,cutEvery:8,allowFirstPerson:false,tour:true,reduced:reducedMotion(),tourRadius:Math.min(30,Math.max(16,arenaR*.42)),structures:m.arena.structures,arena:m.arena});
   // Only now that the match exists do we touch the live view, and we reset the
   // cinema camera first so a previous race rig cannot leak into the new scene.
   view.setCinema(false);
    const snapshot=m.snapshot();snapshot.events=m.events;snapshot.serial=m.serial;
    view.setMatch(snapshot);
   view.lastEvent=m.serial;
   view.setPlayerId(-1);
   view.setDirector(director);
   view.setCinema(true);
    view.setShowcase(snapshot);
   const seconds=Number.isFinite(spec.scenarioSeconds)&&spec.scenarioSeconds>0?spec.scenarioSeconds:SHOWCASE_MAX_SECONDS;
    r.showcase={match:m,director,acc:0,time:0,mapId:spec.mapId,mode:spec.mode,modeId:spec.id,seconds,source:spec.source??null,category:spec.category??null,snapshot,snapshotAt:undefined,performance:{steps:0,frames:0,maxSteps:0,snapshots:1}};
   r.showcaseSpec={...spec};
    r.showcaseMatchedId=spec.mapId;
   r.showcaseIndex=(r.showcaseIndex||0)+1;
   setShowcaseLive(true);
   return true;
  }catch(error){
   console.error('showcase build failed',error);
   if(!r.showcase)clear();
   return fail(error);
  }
 };
}
