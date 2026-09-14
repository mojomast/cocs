import {Match} from './core.mjs';
import {RULES} from './data.mjs';
import {seatShowcaseVehicles} from './showcase.mjs';

// A local "spectate bots" session reuses the menu showcase's all-bot trick:
// every seat runs the bot brain so the human only ever owns the camera.
/** @param {{character?:string,harness?:string,random?:()=>number,mapId?:string,config?:any,humanCount?:number}} [options] */
export function buildSpectateMatch({character='chatgpt',harness='openclaw',random=Math.random,mapId,config,humanCount=1}={}){
 const match=new Match(character,harness,random,mapId,{...config,humanCount});
 for(const a of match.actors)if(!a.bot)a.bot={route:[],think:0,target:-1,memory:0,reaction:0,stuck:0,last:{x:0,y:0,z:0},state:'roam',patrol:0,flank:null,flankDone:false,recover:0,suppressed:0,threat:-1,standoff:null,strafeReverse:-99};
 if(config?.mode==='combined-arms'||config?.mode==='puma-race'||config?.mode==='puma-soccer')seatShowcaseVehicles(match,.7);
 for(let tick=0;tick<Math.round(1/RULES.dt);tick++)match.step(RULES.dt,{inputs:{}});
 return {match};
}
