import {WEAPONS} from './data.mjs';
import {CAMPAIGN_MISSION_IDS,DEFAULT_MISSION_ID} from './campaign-data.mjs';
export const GAME_MODES = [
 {id:'deathmatch',name:'Deathmatch',description:'Everyone for themselves. Start with a Pulse Rifle, scavenge the rest, first to the frag limit wins.',rules:{team:false,score:'frags',fragLimit:15}},
   {id:'ctf',name:'Capture the Flag',description:'Steal the enemy flag and run it home while keeping your own safe. Classic, chaotic, worth it.',rules:{team:true,score:'captures',fragLimit:3}},
  {id:'koth',name:'King of the Hill',description:'Take the central hill and hold it second by second. Contest it to freeze the enemy clock.',rules:{team:true,score:'hillTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,objective:{kind:'koth',captureSeconds:5}}},
  {id:'domination',name:'Domination',description:'Capture three control zones and bleed points for every second your team owns them.',rules:{team:true,score:'zoneTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,objective:{kind:'domination',captureSeconds:5}}},
  {id:'assault',name:'Assault',description:'Attackers take sectors in order, defenders hold to the last one. Breach the final sector to win.',rules:{team:true,score:'sectors',fragLimit:3,minFragLimit:1,maxFragLimit:9,objective:{kind:'assault',captureSeconds:6}}},
 {id:'teamdeathmatch',name:'Team Deathmatch',description:'Shared team score with friendly fire off. Win together or feed together.',rules:{team:true,score:'teamFrags',fragLimit:30}},
  {id:'instagib',name:'Instagib',description:'Rail only, unlimited ammo. One unprotected hit eliminates. No supplies, no powers, no mercy.'},
  {id:'rockets',name:'Rocket Arena',description:'Unlimited rockets for everyone. Health and armor stay on the menu.'},
  {id:'arsenal',name:'Full Arsenal',description:'Every weapon unlocked with unlimited ammo from the first spawn. Choose violence, repeatedly.'},
  {id:'armsrace',name:'Arms Race',description:'Every kill promotes you to the next weapon in the rack. Finish the last gun to win.',rules:{team:false,score:'ladder',fragLimit:10,minFragLimit:10,maxFragLimit:10}},
  {id:'combined-arms',name:'Combined Arms',description:'Command infantry, armour and aircraft across the largest battlefields. Hold the zones together.',rules:{team:true,score:'zoneTime',fragLimit:200,minFragLimit:50,maxFragLimit:900,objective:{kind:'domination',captureSeconds:6},maxBots:16}},
  {id:'payload',name:'Payload',description:'Escort the payload cart down the track to the final point. Checkpoints bank progress; defenders stall it and roll it back. Attackers win on delivery, defenders on the clock.',rules:{team:true,score:'payload',fragLimit:3,minFragLimit:1,maxFragLimit:6,objective:{kind:'payload',captureSeconds:5}}},
 {id:'puma-race',name:'Puma Circuit',description:'Race Pumas around the circuit. Cross every gate in order and finish the lap target first.',rules:{team:false,score:'laps',fragLimit:3,minFragLimit:1,maxFragLimit:10,maxBots:7}},
 {id:'puma-soccer',name:'Puma Soccer',description:'Team car soccer on the circuit infield. Fling the ball into the enemy goal while defending your own.',rules:{team:true,score:'goals',fragLimit:5,minFragLimit:1,maxFragLimit:15,maxBots:3}},
 {id:'horde',name:'Horde',description:'Lone-wolf survival: hold out against escalating waves of hostile NPCs. Pick any combat arena and see how many waves you last.',rules:{team:true,score:'waves',fragLimit:10,minFragLimit:1,maxFragLimit:30}},
 {id:'campaign',name:'Campaign',description:'Scripted single-player missions with NPC assaults, objectives and set-piece events, built on the existing arenas.',rules:{team:true,score:'missions',fragLimit:6,minFragLimit:1,maxFragLimit:6}},
];
export const DIFFICULTIES = [
 {id:'easy',name:'Easy',description:'Relaxed reactions, loose aim and plenty of breathing room.',reaction:1.2,think:.5,error:.3,fireDelay:.48},
 {id:'normal',name:'Normal',description:'Measured reactions and forgiving aim. The house default.',reaction:.65,think:.3,error:.12,fireDelay:.2},
 {id:'hard',name:'Hard',description:'Quicker reactions and tighter aim. Bring a plan.',reaction:.16,think:.14,error:.023,fireDelay:0},
 {id:'nightmare',name:'Nightmare',description:'Very fast reactions and precise aim. They already know where you spawned.',reaction:.08,think:.1,error:.01,fireDelay:0},
];
export const DEFAULT_CONFIG = Object.freeze({mode:'deathmatch',botCount:2,difficulty:'easy',fragLimit:15,timeLimit:300,respawn:2,speed:1,gravity:1,damage:1,fastPowers:false,lifeSteal:false,unlimitedAmmo:false,suddenDeath:false,randomLoadout:false,oneShot:false,bounty:false,berserk:false,startingWeapon:0,playerName:'',mission:DEFAULT_MISSION_ID});
export const DEFAULT_DISPLAY = Object.freeze({fov:82,crosshair:'cross',color:'#c2ffea',size:1,showFps:false,showWeapon:true,resolutionScale:1,bloom:.34,exposure:1.15,postFx:true,teamPalette:'default',reducedMotion:false,invertY:false,adsSensitivity:.85,touchSensitivity:1,captions:false,showKillFeed:true,showDamageNumbers:true,showRadar:true});
const number=(v,fallback,min,max)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
const choice=(v,values,fallback)=>values.includes(v)?v:fallback;
export const modeRule=mode=>GAME_MODES.find(m=>m.id===mode)?.rules||GAME_MODES[0].rules;
export const teamMode=modeOrConfig=>Boolean(modeRule(typeof modeOrConfig==='string'?modeOrConfig:modeOrConfig?.mode).team);
export function normalizeConfig(value={}){
 const c=value&&typeof value==='object'?{...value}:{};
  const mode=choice(c.mode,GAME_MODES.map(m=>m.id),'deathmatch');
 if(mode==='puma-race'||mode==='puma-soccer')Object.assign(c,{speed:1,gravity:1,damage:1,fastPowers:false,lifeSteal:false,unlimitedAmmo:false,suddenDeath:false,randomLoadout:false,oneShot:false,bounty:false,berserk:false,startingWeapon:0});
    const rules=modeRule(mode),minGoal=rules.minFragLimit??(mode==='ctf'?1:5),maxGoal=rules.maxFragLimit??50;
    return {mode,botCount:Math.round(number(c.botCount,DEFAULT_CONFIG.botCount,0,rules.maxBots??8)),difficulty:choice(c.difficulty,DIFFICULTIES.map(d=>d.id),DEFAULT_CONFIG.difficulty),fragLimit:Math.round(number(c.fragLimit,rules.fragLimit??15,minGoal,maxGoal)),timeLimit:Math.round(number(c.timeLimit,300,60,900)),respawn:number(c.respawn,2,1,5),speed:choice(c.speed,[.75,1,1.25,1.5],1),gravity:choice(c.gravity,[.4,.7,1],1),damage:choice(c.damage,[.5,1,1.5,2],1),fastPowers:c.fastPowers===true,lifeSteal:c.lifeSteal===true,unlimitedAmmo:c.unlimitedAmmo===true,suddenDeath:c.suddenDeath===true,randomLoadout:c.randomLoadout===true,oneShot:c.oneShot===true,bounty:c.bounty===true,berserk:c.berserk===true,startingWeapon:Math.round(number(c.startingWeapon,0,0,Math.max(0,WEAPONS.length-1))),playerName:typeof c.playerName==='string'?c.playerName.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,20):'',mission:choice(c.mission,CAMPAIGN_MISSION_IDS,DEFAULT_MISSION_ID)};
}
export function normalizeDisplay(value={}){
 const c=value&&typeof value==='object'?value:{};
 return {fov:Math.round(number(c.fov,82,65,110)),crosshair:choice(c.crosshair,['cross','dot','ring','chevron','split'],'cross'),color:typeof c.color==='string'&&/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#c2ffea',size:number(c.size,1,.6,1.8),showFps:c.showFps===true,showWeapon:c.showWeapon!==false,resolutionScale:number(c.resolutionScale,1,.5,1.5),bloom:number(c.bloom,.34,0,1),exposure:number(c.exposure,1.15,.6,1.8),postFx:c.postFx!==false,teamPalette:choice(c.teamPalette,['default','colorblind'],'default'),reducedMotion:c.reducedMotion===true,invertY:c.invertY===true,adsSensitivity:number(c.adsSensitivity,.85,.2,1.5),touchSensitivity:number(c.touchSensitivity,1,.3,3),captions:c.captions===true,showKillFeed:c.showKillFeed!==false,showDamageNumbers:c.showDamageNumbers!==false,showRadar:c.showRadar!==false};
}
export const modeWeapon=c=>c.mode==='instagib'?2:c.mode==='rockets'?1:null;
export function spawnInventory(c){const locked=modeWeapon(c),ammo=[Infinity,6,5,10,24,6,8,10,8,30];return ammo.map((amount,i)=>locked!==null?(i===locked?Infinity:0):c.mode==='arsenal'||i===0||c.unlimitedAmmo&&i===c.startingWeapon?Infinity:i===c.startingWeapon?amount:0);}
