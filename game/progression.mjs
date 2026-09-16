import {ATTACHMENTS,normalizeAttachments as normalizeAttachmentLoadout} from './attachments.mjs';
import {WEAPON_FINISHES,CROSSHAIR_STYLES,FINISH_IDS,CROSSHAIR_IDS} from './cosmetics.mjs';
export const PROGRESSION_VERSION=1;
export const MAX_LEVEL=60;
export const GEAR_SLOTS=[{id:'primary',name:'Weapon Kit'},{id:'armor',name:'Armour'},{id:'utility',name:'Utility'}];
export const GEAR=[
 {id:'scope',slot:'primary',name:'Precision Scope',level:2,description:'Tighter spread and a small damage lift for ranged duels. Reads the room before it reads the target.',modifiers:{spread:.85,damage:1.06}},
 {id:'heavy-barrel',slot:'primary',name:'Heavy Barrel',level:5,description:'More damage and punch at the cost of mobility. Subtlety is for other operators.',modifiers:{damage:1.12,spread:1.1,speed:.97}},
 {id:'light-frame',slot:'primary',name:'Light Frame',level:8,description:'A fast-handling build with reduced armour. Travel light, hit hard.',modifiers:{damage:1.08,spread:.9,armor:-5}},
 {id:'plating',slot:'armor',name:'Composite Plating',level:3,description:'A pre-fight slab of extra spawn armour. Because the best offense is not dying.',modifiers:{armor:25,speed:.98}},
 {id:'reactive',slot:'armor',name:'Reactive Weave',level:6,description:'Balanced armour and health for long slogs. Designed for “just one more round.”',modifiers:{armor:15,health:10}},
 {id:'stim',slot:'utility',name:'Combat Stim',level:4,description:'Extra health and a sliver of speed on every spawn. Performance-enhancing, but legal here.',modifiers:{health:20,speed:1.04}},
 {id:'servo',slot:'utility',name:'Servo Assist',level:7,description:'A movement-focused rig for objective sprints. Your W key says thank you.',modifiers:{speed:1.08}},
 {id:'mag',slot:'utility',name:'Stabiliser Mag',level:9,description:'Steadies the muzzle with a tiny speed trade. Poetry, in full auto.',modifiers:{spread:.92,speed:.99}},
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
export function resolveGear(ids){
 const list=(Array.isArray(ids)?ids:Object.values(ids||{})).map(gearById).filter(Boolean),modifiers={health:0,armor:0,speed:1,damage:1,spread:1};
 for(const item of list)for(const [key,value] of Object.entries(item.modifiers)){if(key==='health'||key==='armor')modifiers[key]+=value;else modifiers[key]*=value;}
 modifiers.speed=Math.max(.5,Math.min(1.6,modifiers.speed));modifiers.damage=Math.max(.5,Math.min(2,modifiers.damage));modifiers.spread=Math.max(.5,Math.min(1.6,modifiers.spread));modifiers.armor=Math.max(0,modifiers.armor);
 return {items:list,modifiers};
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
