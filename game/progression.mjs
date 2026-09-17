import {ATTACHMENTS,normalizeAttachments as normalizeAttachmentLoadout} from './attachments.mjs';
import {WEAPON_FINISHES,CROSSHAIR_STYLES,FINISH_IDS,CROSSHAIR_IDS} from './cosmetics.mjs';
export const PROGRESSION_VERSION=1;
export const MAX_LEVEL=60;
export const GEAR_SLOTS=[{id:'primary',name:'Weapon Kit'},{id:'armor',name:'Armour'},{id:'utility',name:'Utility'}];
// §4.8 asymmetric-but-testable gear. Every item names one power axis and one
// different cost axis, spends within its slot's net budget, and resolves
// through the §4.8 envelope caps below. Points are unitless: one point is +1%
// on a multiplier (damage, speed, spread) or +1 flat point of health/armour.
export const GEAR_AXES=Object.freeze(['offense','mobility','ehp','handling']);
export const GEAR_BUDGET=Object.freeze({primary:15,armor:25,utility:24});
export const GEAR_CAPS=Object.freeze({offense:1.15,mobility:1.1,ehp:15,spread:.85,handling:.9});
export const GEAR=[
 {id:'scope',slot:'primary',name:'Precision Scope',level:2,powerAxis:'handling',costAxis:'mobility',budget:GEAR_BUDGET.primary,description:'Tighter spread and a harder first shot for ranged duels. The glass is heavy, and the footwork pays for it.',modifiers:{spread:.85,damage:1.1,speed:.9}},
 {id:'heavy-barrel',slot:'primary',name:'Heavy Barrel',level:5,powerAxis:'offense',costAxis:'handling',budget:GEAR_BUDGET.primary,description:'The hardest-hitting barrel in the pool, at the cost of muzzle control and a little footwork. Subtlety is for other operators.',modifiers:{damage:1.15,spread:1.1,speed:.97}},
 {id:'light-frame',slot:'primary',name:'Light Frame',level:8,powerAxis:'offense',costAxis:'ehp',budget:GEAR_BUDGET.primary,description:'A fast-handling build with reduced armour. Travel light, hit hard.',modifiers:{damage:1.08,spread:.9,armor:-5}},
 {id:'plating',slot:'armor',name:'Composite Plating',level:3,powerAxis:'ehp',costAxis:'mobility',budget:GEAR_BUDGET.armor,description:'A pre-fight slab of extra spawn armour. Because the best offense is not dying.',modifiers:{armor:25,speed:.98}},
 {id:'reactive',slot:'armor',name:'Reactive Weave',level:6,powerAxis:'ehp',costAxis:'mobility',budget:GEAR_BUDGET.armor,description:'Balanced armour and health for long slogs. Designed for “just one more round.”',modifiers:{armor:15,health:10}},
 {id:'stim',slot:'utility',name:'Combat Stim',level:4,powerAxis:'ehp',costAxis:'mobility',budget:GEAR_BUDGET.utility,description:'Extra health and a sliver of speed on every spawn. Performance-enhancing, but legal here.',modifiers:{health:20,speed:1.04}},
 {id:'servo',slot:'utility',name:'Servo Assist',level:7,powerAxis:'mobility',costAxis:'handling',budget:GEAR_BUDGET.utility,description:'The fastest rig in the pool for objective sprints. The servos jitter your aim; your W key says thank you.',modifiers:{speed:1.1,spread:1.07}},
 {id:'mag',slot:'utility',name:'Stabiliser Mag',level:9,powerAxis:'handling',costAxis:'mobility',budget:GEAR_BUDGET.utility,description:'Steadies the muzzle with a tiny speed trade. Poetry, in full auto.',modifiers:{spread:.92,speed:.99}},
];
export const COSMETICS=[
 ...WEAPON_FINISHES.map(item=>({id:item.id,kind:'finish',name:item.name,level:item.level,description:item.description})),
 ...CROSSHAIR_STYLES.map(item=>({id:item.id,kind:'crosshair',name:item.name,level:item.level??1,description:item.description})),
];
export const UNLOCKS=[...GEAR.map(item=>({id:`gear-${item.id}`,kind:'gear',ref:item.id,name:item.name,level:item.level,description:item.description})),...ATTACHMENTS.map(item=>({id:`attachment-${item.id}`,kind:'attachment',ref:item.id,name:item.name,level:item.level,description:item.description})),...COSMETICS];
export const RANK_TITLES=[{level:1,name:'Recruit',blurb:'Fresh weights and no idea what a strafe jump is.'},{level:5,name:'Operator',blurb:'Can hold a lane without panic-firing.'},{level:10,name:'Veteran',blurb:'Knows every map by its sightlines.'},{level:20,name:'Elite',blurb:'Wins duels before you finish reloading.'},{level:35,name:'Legend',blurb:'The bots whisper your callsign to each other.'},{level:50,name:'Mythic',blurb:'The scoreboard renders your name in a special font.'}];

// ---------------------------------------------------------------------------
// Prestige: the long-term layer that begins once the level cap is reached.
// Every PRESTIGE_XP of overflow XP banks one prestige rank, and each rank maps
// to a named tier with a deterministic reward. Pure, so the panel, the server
// mirror and the tests all derive the same rank from the same total XP.
export const PRESTIGE_XP=6000;
export const PRESTIGE_TIERS=Object.freeze([
 {level:1,name:'Bronze',color:'#d08a4e',reward:'Bronze prestige emblem',perk:'+5% match XP'},
 {level:2,name:'Silver',color:'#c9d4dc',reward:'Silver prestige emblem',perk:'+10% match XP'},
 {level:3,name:'Gold',color:'#ffd166',reward:'Gold prestige emblem',perk:'+15% match XP'},
 {level:4,name:'Platinum',color:'#8fe0ff',reward:'Platinum prestige emblem',perk:'+20% match XP'},
 {level:5,name:'Diamond',color:'#b79bff',reward:'Diamond prestige emblem',perk:'+25% match XP'},
 {level:6,name:'Apex',color:'#ff9f6b',reward:'Apex prestige emblem',perk:'+30% match XP'},
]);
export const PRESTIGE_MAX_TIER=PRESTIGE_TIERS.length;

// ---------------------------------------------------------------------------
// Achievements: deterministic, idempotent career milestones. Each definition
// checks a derived context object, so unlocking is a pure function of the
// profile (plus campaign/challenge counts passed in by the caller). Unlocks are
// stored once and pay a flat XP bounty.
export const ACHIEVEMENTS=Object.freeze([
 {id:'first-blood',name:'First Blood',description:'Win your first match.',xp:100,check:ctx=>ctx.wins>=1},
 {id:'veteran',name:'Veteran',description:'Finish 25 matches.',xp:200,check:ctx=>ctx.matches>=25},
 {id:'gladiator',name:'Gladiator',description:'Win 10 matches.',xp:300,check:ctx=>ctx.wins>=10},
 {id:'centurion',name:'Centurion',description:'Score 100 career eliminations.',xp:250,check:ctx=>ctx.kills>=100},
 {id:'sharpshooter',name:'Sharpshooter',description:'Score 25 eliminations in a single match.',xp:250,check:ctx=>ctx.bestKills>=25},
 {id:'flawless',name:'Flawless',description:'Win a match without dying.',xp:250,check:ctx=>ctx.flawless>=1},
 {id:'streak-master',name:'Streak Master',description:'Reach a 10 killstreak.',xp:300,check:ctx=>ctx.bestStreak>=10},
 {id:'mode-explorer',name:'Mode Explorer',description:'Play 5 different modes.',xp:200,check:ctx=>ctx.modes>=5},
 {id:'collector',name:'Collector',description:'Claim 20 unlocks.',xp:200,check:ctx=>ctx.unlocked>=20},
 {id:'challenger',name:'Challenger',description:'Complete 10 daily or weekly challenges.',xp:250,check:ctx=>ctx.challenges>=10},
 {id:'campaign-clear',name:'Campaign Clear',description:'Complete every campaign mission.',xp:500,check:ctx=>ctx.campaignTotal>0&&ctx.campaignDone>=ctx.campaignTotal},
 {id:'ascendant',name:'Ascendant',description:'Reach your first prestige rank.',xp:500,check:ctx=>ctx.prestige>=1},
]);

export function xpForLevel(level){const l=Math.max(1,Math.min(MAX_LEVEL-1,Math.round(level)));return 500+(l-1)*250;}
export function totalXpForLevel(level){
 const l=Math.max(1,Math.min(MAX_LEVEL,Math.round(Number(level)||1)));
 let total=0;for(let i=1;i<l;i++)total+=xpForLevel(i);
 return total;
}
// Overflow XP past the level cap, split into prestige ranks. Deterministic and
// monotonic: every PRESTIGE_XP banks exactly one rank, capped at the last tier.
export function prestigeFromXp(xp){
 const total=Math.max(0,Math.floor(Number.isFinite(Number(xp))?Number(xp):0));
 const capXp=totalXpForLevel(MAX_LEVEL);
 const overflow=Math.max(0,total-capXp);
 const raw=Math.floor(overflow/PRESTIGE_XP);
 const rank=Math.min(PRESTIGE_MAX_TIER,raw);
 const into=raw>=PRESTIGE_MAX_TIER?PRESTIGE_XP:overflow-rank*PRESTIGE_XP;
 const tier=rank>0?PRESTIGE_TIERS[rank-1]:null;
 return {rank,overflow,into,needed:PRESTIGE_XP,progress:rank>=PRESTIGE_MAX_TIER?1:Math.min(1,into/PRESTIGE_XP),toNext:rank>=PRESTIGE_MAX_TIER?0:Math.max(0,PRESTIGE_XP-into),tier:tier?{...tier}:null,maxed:rank>=PRESTIGE_MAX_TIER};
}
export function prestigeTier(rank){
 const r=Math.max(0,Math.min(PRESTIGE_MAX_TIER,Math.round(Number(rank)||0)));
 return r>0?{...PRESTIGE_TIERS[r-1]}:null;
}
export function prestigeXpBonus(rank){
 const tier=prestigeTier(rank);
 if(!tier)return 0;
 return .05*tier.level;
}
export function levelFromXp(xp){
 let remaining=Math.max(0,Math.floor(Number.isFinite(Number(xp))?Number(xp):0)),level=1;
 while(level<MAX_LEVEL&&remaining>=xpForLevel(level)){remaining-=xpForLevel(level);level++;}
 const needed=xpForLevel(level),capped=level>=MAX_LEVEL;
 return {level,into:remaining,needed,total:Math.max(0,Math.floor(Number.isFinite(Number(xp))?Number(xp):0)),progress:capped?1:Math.min(1,remaining/needed),toNext:capped?0:Math.max(0,needed-remaining)};
}
export function rankTitle(level){let title='Recruit';for(const rank of RANK_TITLES)if(level>=rank.level)title=rank.name;return title;}
export function rankBlurb(level){let blurb=RANK_TITLES[0].blurb;for(const rank of RANK_TITLES)if(level>=rank.level)blurb=rank.blurb;return blurb;}
export function gearById(id){return GEAR.find(item=>item.id===id)||null;}
export function unlockedItems(level){const l=Math.max(1,Math.round(level));return UNLOCKS.filter(item=>item.level<=l);}
const round3=value=>Math.round(value*1000)/1000;
const clampNumber=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:min));
// Budget points for a modifier set, oriented so a positive value is a benefit:
// offense = +damage %, mobility = +speed %, handling = tighter spread %,
// ehp = flat health + armour points.
export function gearPoints(modifiers){
 const m=modifiers&&typeof modifiers==='object'?modifiers:{},num=value=>Number.isFinite(value)?value:1;
 return Object.freeze({
  offense:round3((num(m.damage)-1)*100),
  mobility:round3((num(m.speed)-1)*100),
  handling:round3((1-num(m.spread))*100),
  ehp:round3((Number(m.health)||0)+(Number(m.armor)||0)),
 });
}
// Splits an item's declared power and cost axes out of its modifier points and
// reports the §4.8 cost ratio (must be ≥0.6 for upgraded items). `net` is the
// item's total signed points, which the slot budget caps.
export function gearBudget(item){
 const points=gearPoints(item?.modifiers),power=round3(Math.max(0,Number(points[item?.powerAxis])||0)),cost=round3(Math.max(0,-(Number(points[item?.costAxis])||0)));
 const net=round3(Object.values(points).reduce((sum,value)=>sum+value,0));
 return Object.freeze({budget:Number(item?.budget)||0,points,power,cost,net,ratio:power>0?round3(cost/power):0});
}
// §4.8 envelope caps, applied once at the end of resolution so no caller can
// bypass them: offense/damage ≤1.15×, mobility/speed ≤1.10×, pooled EHP
// (health + armour) ≤ +15 points, spread ≥0.85× and spread ≤ 1/0.90 (the
// handling ≥0.90× floor). EHP over the cap scales both pools down
// proportionally so a full loadout cannot stack past the envelope.
function poolEhp(health,armor){
 const total=health+armor;
 if(!(total>GEAR_CAPS.ehp))return {health,armor};
 const scale=GEAR_CAPS.ehp/total;let h=round3(health*scale),a=round3(armor*scale);
 const drift=round3(h+a-GEAR_CAPS.ehp);
 if(drift>0){
  if(a>=h)a=round3(Math.max(0,a-drift));
  else h=round3(Math.max(0,h-drift));
 }
 return {health:h,armor:a};
}
export function resolveGear(ids){
 const list=(Array.isArray(ids)?ids:Object.values(ids||{})).map(gearById).filter(Boolean),modifiers={health:0,armor:0,speed:1,damage:1,spread:1};
 for(const item of list)for(const [key,value] of Object.entries(item.modifiers)){if(key==='health'||key==='armor')modifiers[key]+=value;else modifiers[key]*=value;}
 modifiers.speed=clampNumber(modifiers.speed,.5,GEAR_CAPS.mobility);
 modifiers.damage=clampNumber(modifiers.damage,.5,GEAR_CAPS.offense);
 modifiers.spread=clampNumber(modifiers.spread,GEAR_CAPS.spread,1/GEAR_CAPS.handling);
 modifiers.armor=Math.max(0,Number(modifiers.armor)||0);
 modifiers.health=Math.max(0,Number(modifiers.health)||0);
 const pooled=poolEhp(modifiers.health,modifiers.armor);
 modifiers.health=pooled.health;modifiers.armor=pooled.armor;
 return Object.freeze({items:Object.freeze(list),modifiers:Object.freeze(modifiers)});
}
export function normalizeGear(value,level=MAX_LEVEL){
 const source=value&&typeof value==='object'?value:{},out={};
 for(const slot of GEAR_SLOTS){
  const requested=source[slot.id],item=gearById(requested);
  if(!item||item.slot!==slot.id||item.level>level)continue;
  out[slot.id]=item.id;
 }
 return out;
}
export function matchXp({win=false,actor=null,bonusXp=0}={}){
 const stats=actor?.scoreStats||{},frags=Number(actor?.frags)||0;
 const objective=(Number(stats.objectiveTime)||0)*1.5+(Number(stats.objectiveCaptures)||0)*30+(Number(stats.captures)||0)*120+(Number(stats.flagPickups)||0)*15+(Number(stats.flagReturns)||0)*10;
 const bonus=Math.max(0,Math.round(Number(bonusXp)||0));
 return Math.max(10,Math.round(40+frags*12+objective+(win?80:0)))+bonus;
}
export function modeKey(mode){return typeof mode==='string'&&mode.trim()?mode.trim().slice(0,40):'unknown';}
const count=value=>Math.max(0,Math.floor(Number(value)||0));
export function normalizeByMode(value){
 const source=value&&typeof value==='object'?value:{},out={};
 for(const [mode,raw] of Object.entries(source)){
  if(typeof mode!=='string'||!mode.trim())continue;
  const entry=raw&&typeof raw==='object'?raw:{};
  out[modeKey(mode)]={matches:count(entry.matches),wins:count(entry.wins),kills:count(entry.kills),best:count(entry.best)};
 }
 return out;
}
export function normalizeAchievements(value){
 const source=value&&typeof value==='object'?value:{},out={};
 for(const item of ACHIEVEMENTS)if(source[item.id]===true)out[item.id]=true;
 return out;
}
export function defaultProgression(){return normalizeProgression({});}
export function normalizeProgression(value){
 const source=value&&typeof value==='object'?value:{},xp=Math.max(0,Math.floor(Number.isFinite(Number(source.xp))?Number(source.xp):0)),calculated=levelFromXp(xp),rawUnlocks=source.unlocks&&typeof source.unlocks==='object'?source.unlocks:{},unlocks={};
 for(const item of UNLOCKS)if(rawUnlocks[item.id]===true||item.level<=calculated.level)unlocks[item.id]=true;
 const prestige=prestigeFromXp(xp);
 return {version:PROGRESSION_VERSION,xp,level:calculated.level,matches:Math.max(0,Math.floor(Number(source.matches)||0)),wins:Math.max(0,Math.floor(Number(source.wins)||0)),kills:Math.max(0,Math.floor(Number(source.kills)||0)),flawlessWins:Math.max(0,Math.floor(Number(source.flawlessWins)||0)),bestStreak:Math.max(0,Math.floor(Number(source.bestStreak)||0)),challengesCompleted:Math.max(0,Math.floor(Number(source.challengesCompleted)||0)),byMode:normalizeByMode(source.byMode),gear:normalizeGear(source.gear,calculated.level),attachments:normalizeAttachmentLoadout(source.attachments,calculated.level),finish:FINISH_IDS.includes(source.finish)?source.finish:null,crosshair:CROSSHAIR_IDS.includes(source.crosshair)?source.crosshair:null,unlocks,achievements:normalizeAchievements(source.achievements),prestige:prestige.rank,prestigeTier:prestige.tier?prestige.tier.name:null};
}
// Derived context for achievement checks. Everything comes from the profile
// plus optional campaign counts supplied by the caller, so unlocking is a pure
// function of stored state and never depends on wall-clock time.
export function achievementContext(profile,extra={}){
 const p=profile&&typeof profile==='object'?profile:{},byMode=p.byMode||{};
 const bestKills=Object.values(byMode).reduce((max,stats)=>Math.max(max,count(stats?.best)),0);
 return {
  matches:count(p.matches),wins:count(p.wins),kills:count(p.kills),
  bestKills,modes:Object.keys(byMode).length,unlocked:Object.keys(p.unlocks||{}).length,
  flawless:count(p.flawlessWins),bestStreak:count(p.bestStreak),
  challenges:count(p.challengesCompleted),prestige:prestigeFromXp(p.xp).rank,
  campaignDone:count(extra.campaignDone),campaignTotal:count(extra.campaignTotal),
 };
}
export function unlockedAchievements(profile,extra={}){
 const ctx=achievementContext(profile,extra);
 return ACHIEVEMENTS.filter(item=>{try{return item.check(ctx)===true;}catch{return false;}});
}
export function achievementStatus(profile,extra={}){
 const unlocked=normalizeAchievements(profile?.achievements),ctx=achievementContext(profile,extra);
 return ACHIEVEMENTS.map(item=>({id:item.id,name:item.name,description:item.description,xp:item.xp,unlocked:unlocked[item.id]===true,eligible:item.check(ctx)===true}));
}
export function awardMatch(profile,result={}){
 const next=normalizeProgression(profile),before=next.level;
 const base=matchXp(result);
 const prestigeBonus=Math.round(base*prestigeXpBonus(prestigeFromXp(next.xp).rank));
 next.xp+=base+prestigeBonus;
 next.matches+=1;if(result.win===true)next.wins+=1;
 const kills=Math.max(0,Math.floor(Number(result.actor?.frags)||0));next.kills+=kills;
 if(result.win===true&&Math.max(0,Math.floor(Number(result.actor?.deaths)||0))===0)next.flawlessWins+=1;
 next.bestStreak=Math.max(next.bestStreak,Math.max(0,Math.floor(Number(result.bestStreak)||0)));
 next.challengesCompleted+=Math.max(0,Math.floor(Number(result.challengesCompleted)||0));
 const mode=modeKey(result.mode),byMode={...next.byMode},modeStats={matches:0,wins:0,kills:0,best:0,...(byMode[mode]||{})};
 modeStats.matches+=1;if(result.win===true)modeStats.wins+=1;modeStats.kills+=kills;modeStats.best=Math.max(modeStats.best,kills);
 byMode[mode]=modeStats;next.byMode=byMode;
 const achievements=[];
 for(const item of unlockedAchievements(next,{campaignDone:result.campaignDone,campaignTotal:result.campaignTotal})){
  if(next.achievements[item.id]!==true){next.achievements[item.id]=true;achievements.push(item);}
 }
 const achievementXp=achievements.reduce((sum,item)=>sum+item.xp,0);
 next.xp+=achievementXp;
 const level=levelFromXp(next.xp);
 next.level=level.level;next.prestige=prestigeFromXp(next.xp).rank;next.prestigeTier=prestigeFromXp(next.xp).tier?.name??null;
 const unlocked=[];
 for(const item of unlockedItems(level.level))if(!next.unlocks[item.id]){next.unlocks[item.id]=true;unlocked.push(item);}
 return {profile:next,gained:base+prestigeBonus+achievementXp,baseGained:base,prestigeBonus,achievementXp,levelUp:level.level>before,prestigeUp:prestigeFromXp(next.xp).rank>prestigeFromXp(profile?.xp).rank,unlocked,achievements,progress:level.progress,toNext:level.toNext};
}
export function nextUnlockFor(profile){
 const unlocked=(profile&&typeof profile.unlocks==='object'&&profile.unlocks)||{};
 return UNLOCKS.filter(item=>unlocked[item.id]!==true).sort((a,b)=>a.level-b.level||String(a.name).localeCompare(String(b.name)))[0]||null;
}
// Compact post-match summary card. Pure composition of the snapshot, the
// reward strip and the career tracks so the results screen can surface
// achievements and prestige progress without re-deriving them in JSX.
/** @param {{hud?:any,reward?:any,profile?:any,achievements?:any[],historyEntry?:any,result?:any}} [input] */
export function matchSummaryCard({hud=null,reward=null,profile=null,achievements=[],historyEntry=null,result=null}={}){
 const p=profile&&typeof profile==='object'?profile:defaultProgression();
 const level=levelFromXp(p.xp),prestige=prestigeFromXp(p.xp);
 const list=Array.isArray(achievements)?achievements:[];
 const unlocked=list.filter(a=>a?.unlocked===true);
 const actors=Array.isArray(hud?.actors)?hud.actors:[];
 const local=actors.find(a=>a&&a.id===(hud?.actorId??0))||actors[0]||result?.actor||null;
 const kills=Number(local?.frags)||Number(historyEntry?.kills)||0;
 const deaths=Number(local?.deaths)||Number(historyEntry?.deaths)||0;
 const duration=Math.round(Number(hud?.time)||Number(historyEntry?.duration)||0);
 const outcome=historyEntry?.result||result||(reward?.levelUp?'win':null);
 return {
  modeName:hud?.modeName||historyEntry?.modeName||null,
  mapName:hud?.mapName||historyEntry?.mapName||null,
  result:outcome,
  kills,deaths,
  kd:deaths>0?Math.round((kills/deaths)*100)/100:kills,
  duration,
  xp:Math.max(0,Math.floor(Number(reward?.gained)||0)),
  level:level.level,
  progress:level.progress,
  toNext:level.toNext,
  levelUp:reward?.levelUp===true,
  prestige:prestige.rank,
  prestigeTier:prestige.tier?prestige.tier.name:null,
  prestigeProgress:prestige.progress,
  prestigeToNext:prestige.toNext,
  prestigeMaxed:prestige.maxed,
  achievements:unlocked.map(a=>({id:a.id,name:a.name,description:a.description,xp:Math.max(0,Math.floor(Number(a.xp)||0))})),
  achievementCount:unlocked.length,
  nextUnlock:reward?.nextUnlock||nextUnlockFor(p),
 };
}

export function matchRewardSummary(award={}){
 const profile=award&&award.profile?award.profile:defaultProgression(),level=levelFromXp(profile.xp),next=nextUnlockFor(profile),prestige=prestigeFromXp(profile.xp);
 return {
  gained:Math.max(0,Math.floor(Number(award?.gained)||0)),
  baseGained:Math.max(0,Math.floor(Number(award?.baseGained)||0)),
  prestigeBonus:Math.max(0,Math.floor(Number(award?.prestigeBonus)||0)),
  achievementXp:Math.max(0,Math.floor(Number(award?.achievementXp)||0)),
  xp:level.total,level:level.level,into:level.into,needed:level.needed,
  progress:level.progress,toNext:level.toNext,levelUp:award?.levelUp===true,
  unlocked:Array.isArray(award?.unlocked)?award.unlocked:[],
  achievements:Array.isArray(award?.achievements)?award.achievements:[],
  prestige:prestige.rank,prestigeTier:prestige.tier?{...prestige.tier}:null,prestigeProgress:prestige.progress,prestigeToNext:prestige.toNext,prestigeMaxed:prestige.maxed,
  nextUnlock:next?{id:next.id,kind:next.kind,name:next.name,level:next.level}:null,
 };
}
