// Builds the next menu-demo scenario (see SHOWCASES): a bot match with the
// camera driven by the cinematic director, or the car demo camera for the
// vehicle modes (match.race). The build is atomic: a scenario that fails to
// construct leaves the current reel intact instead of dropping the title screen
// back to the static operator preview.
import {shuffleShowcaseReel as defaultShuffleReel} from './showcase.mjs';

export function buildShowcase({r,view,showcaseOk,makeRng,pickShowcase,normalizeConfig,DEFAULT_CONFIG,Match,seatShowcaseVehicles,RULES,CinematicDirector,reducedMotion,setShowcaseLive,shuffleShowcaseReel=defaultShuffleReel}){
 const clear=()=>{r.showcase=null;r.showcaseMatchedId=null;r.showcaseReel=null;view.setShowcase(null);view.setCinema(false);view.setDirector(null);setShowcaseLive(false);};
 return ()=>{
  if(!showcaseOk()){clear();return false;}
  try{
   const rng=makeRng();
   if(!Array.isArray(r.showcaseReel)||!r.showcaseReel.length)r.showcaseReel=shuffleShowcaseReel(rng);
   const index=r.showcaseReel.shift();
   const spec=pickShowcase(index,rng,{legacy:r.legacyArenas===true});
   const cfg=normalizeConfig({...DEFAULT_CONFIG,mode:spec.mode,botCount:spec.botCount,difficulty:spec.difficulty,timeLimit:spec.timeLimit,fragLimit:spec.fragLimit});
   const m=new Match('chatgpt','openclaw',rng,spec.mapId,cfg);
   for(const a of m.actors)if(!a.bot)a.bot={route:[],think:0,target:-1,memory:0,reaction:0,stuck:0,last:{x:0,y:0,z:0},state:'roam',patrol:0,flank:null,flankDone:false,recover:0,suppressed:0,threat:-1,standoff:null,strafeReverse:-99};
   if(spec.seatVehicles)seatShowcaseVehicles(m,spec.seatVehicles);
   // Clear the countdown and start the cars moving before the first menu frame.
   for(let tick=0;tick<Math.round(4/RULES.dt);tick++)m.step(RULES.dt,{inputs:{}});
   const bd=m.arena.bounds,arenaR=bd?Math.hypot(bd.maxX-bd.minX,bd.maxZ-bd.minZ)/2:30,director=new CinematicDirector({random:makeRng(),center:m.center,radius:11,cutEvery:2.1,tour:true,reduced:reducedMotion(),tourRadius:Math.min(30,Math.max(16,arenaR*.42)),structures:m.arena.structures});
   // Only now that the match exists do we touch the live view, and we reset the
   // cinema camera first so a previous race rig cannot leak into the new scene.
   view.setCinema(false);
   view.setMatch(m.snapshot());
   view.lastEvent=m.serial;
   view.setPlayerId(-1);
   view.setDirector(director);
   view.setCinema(true);
   view.setShowcase(m.snapshot());
   r.showcase={match:m,director,acc:0,time:0,mapId:spec.mapId,mode:spec.mode,modeId:spec.id};
   r.showcaseMatchedId=null;
   r.showcaseIndex=(r.showcaseIndex||0)+1;
   setShowcaseLive(true);
   return true;
  }catch(error){
   console.error('showcase build failed',error);
   if(!r.showcase)clear();
   return false;
  }
 };
}
