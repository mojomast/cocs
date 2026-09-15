import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 ACHIEVEMENTS,
 GEAR,
 MAX_LEVEL,
 PRESTIGE_MAX_TIER,
 PRESTIGE_TIERS,
 PRESTIGE_XP,
 achievementContext,
 achievementStatus,
 awardMatch,
 defaultProgression,
 gearById,
 levelFromXp,
 matchRewardSummary,
 matchSummaryCard,
 matchXp,
 nextUnlockFor,
 normalizeGear,
 normalizeProgression,
 prestigeFromXp,
 prestigeTier,
 prestigeXpBonus,
 rankTitle,
 resolveGear,
 totalXpForLevel,
 unlockedAchievements,
 unlockedItems,
 xpForLevel,
} from './progression.mjs';

test('xp curve is monotonic and levelFromXp tracks exact boundaries',()=>{
 for(let level=1;level<MAX_LEVEL-1;level++)assert.ok(xpForLevel(level+1)>xpForLevel(level));
 assert.equal(levelFromXp(0).level,1);
 assert.equal(levelFromXp(xpForLevel(1)-1).level,1);
 assert.equal(levelFromXp(xpForLevel(1)).level,2);
 const two=xpForLevel(1)+xpForLevel(2);
 assert.equal(levelFromXp(two-1).level,2);
 assert.equal(levelFromXp(two).level,3);
 assert.equal(levelFromXp(1e9).level,MAX_LEVEL);
 assert.equal(levelFromXp(1e9).progress,1);
 assert.ok(levelFromXp(xpForLevel(1)/2).progress>0&&levelFromXp(xpForLevel(1)/2).progress<1);
});
test('gear resolves additive armour/health and multiplicative combat stats',()=>{
 const scope=resolveGear(['scope']);
 assert.equal(scope.modifiers.spread,.85);
 assert.ok(Math.abs(scope.modifiers.damage-1.06)<1e-9);
 const both=resolveGear(['scope','plating','stim']);
 assert.equal(both.modifiers.armor,25);
 assert.equal(both.modifiers.health,20);
 assert.ok(Math.abs(both.modifiers.speed-1.04*.98)<1e-9);
 assert.equal(both.items.length,3);
 assert.equal(resolveGear(['nope']).items.length,0);
});
test('normalizeGear enforces one per slot and level gating',()=>{
 assert.deepEqual(normalizeGear({primary:'heavy-barrel'},2),{});
 assert.equal(normalizeGear({primary:'heavy-barrel'},5).primary,'heavy-barrel');
 assert.equal(normalizeGear({armor:'plating',utility:'stim',primary:'scope'},20).utility,'stim');
 assert.equal(normalizeGear({primary:'not-real'},20).primary,undefined);
 for(const item of GEAR)assert.equal(gearById(item.id),item);
});
test('unlocks arrive with levels',()=>{
 assert.ok(unlockedItems(1).some(item=>item.id==='attachment-extended-mag'));
 assert.ok(unlockedItems(2).some(item=>item.id==='gear-scope'));
 assert.ok(unlockedItems(10).some(item=>item.kind==='finish'));
 assert.equal(rankTitle(1),'Recruit');
 assert.equal(rankTitle(12),'Veteran');
 assert.equal(rankTitle(60),'Mythic');
});
test('matchXp rewards frags, objective play and wins deterministically',()=>{
 const base=matchXp({actor:{frags:5,scoreStats:{}}});
 assert.equal(base,40+60);
 assert.equal(matchXp({win:true,actor:{frags:5,scoreStats:{}}}),base+80);
 const objective=matchXp({actor:{frags:0,scoreStats:{objectiveCaptures:2,objectiveTime:10}}});
 assert.ok(objective>40);
 assert.equal(matchXp({actor:{frags:5,scoreStats:{}}}),base);
});
test('awardMatch levels up, records stats and grants unlocks once',()=>{
 const result={win:true,actor:{frags:40,scoreStats:{captures:1}}};
 const first=awardMatch(defaultProgression(),result);
 assert.ok(first.gained>=300);
 assert.ok(first.levelUp);
 assert.equal(first.profile.matches,1);
 assert.equal(first.profile.wins,1);
 assert.equal(first.profile.kills,40);
 assert.ok(first.unlocked.length>0);
 const second=awardMatch(first.profile,{actor:{frags:0,scoreStats:{}}});
 assert.equal(second.profile.matches,2);
 assert.equal(second.unlocked.filter(item=>item.id===first.unlocked[0].id).length,0);
});
test('matchRewardSummary surfaces XP, level progress and the next unlock',()=>{
 const profile=normalizeProgression({xp:500}),summary=matchRewardSummary({profile,gained:500,levelUp:true,unlocked:[{id:'gear-scope',kind:'gear',name:'Precision Scope',level:2}]});
 assert.equal(summary.gained,500);
 assert.equal(summary.xp,500);
 assert.equal(summary.level,2);
 assert.equal(summary.into,0);
 assert.equal(summary.needed,xpForLevel(2));
 assert.equal(summary.progress,0);
 assert.equal(summary.toNext,xpForLevel(2));
 assert.equal(summary.levelUp,true);
 assert.equal(summary.unlocked.length,1);
 assert.ok(summary.nextUnlock&&typeof summary.nextUnlock.name==='string');
 assert.ok(summary.nextUnlock.level>=2);
 assert.equal(profile.unlocks[summary.nextUnlock.id],undefined);
 assert.equal(nextUnlockFor(profile).id,summary.nextUnlock.id);
 const empty=matchRewardSummary();
 assert.equal(empty.gained,0);
 assert.equal(empty.level,1);
 assert.ok(empty.nextUnlock);
 const award=awardMatch(defaultProgression(),{win:true,actor:{frags:40,scoreStats:{captures:1}}});
 const live=matchRewardSummary(award);
 assert.equal(live.gained,award.gained);
 assert.equal(live.level,award.profile.level);
 assert.ok(live.progress>=0&&live.progress<=1);
 assert.deepEqual(live.unlocked,award.unlocked);
});
test('matchXp folds in challenge bonus XP without changing the base reward',()=>{
 const base=matchXp({actor:{frags:5,scoreStats:{}}});
 assert.equal(matchXp({actor:{frags:5,scoreStats:{}},bonusXp:50}),base+50);
 assert.equal(matchXp({actor:{frags:5,scoreStats:{}},bonusXp:-10}),base);
 assert.equal(matchXp({actor:{frags:5,scoreStats:{}},bonusXp:'25'}),base+25);
});
test('awardMatch records explicit per-mode career stats and round-trips',()=>{
 const first=awardMatch(defaultProgression(),{win:true,mode:'deathmatch',actor:{frags:9,scoreStats:{}}});
 assert.deepEqual(first.profile.byMode.deathmatch,{matches:1,wins:1,kills:9,best:9});
 const second=awardMatch(first.profile,{win:false,mode:'deathmatch',actor:{frags:4,scoreStats:{}}});
 assert.deepEqual(second.profile.byMode.deathmatch,{matches:2,wins:1,kills:13,best:9});
 const ctf=awardMatch(second.profile,{win:false,mode:'ctf',actor:{frags:3,scoreStats:{captures:1}}});
 assert.deepEqual(ctf.profile.byMode.ctf,{matches:1,wins:0,kills:3,best:3});
 assert.deepEqual(normalizeProgression({}).byMode,{});
 const round=normalizeProgression(JSON.parse(JSON.stringify(ctf.profile)));
 assert.deepEqual(round.byMode,ctf.profile.byMode);
 assert.deepEqual(normalizeProgression({byMode:{deathmatch:{matches:-1,wins:'2',kills:1.9,best:NaN},'':'x'}}).byMode,{deathmatch:{matches:0,wins:2,kills:1,best:0}});
});
test('prestige banks one rank per PRESTIGE_XP of overflow and caps at the last tier',()=>{
 const capXp=totalXpForLevel(MAX_LEVEL);
 assert.equal(levelFromXp(capXp).level,MAX_LEVEL);
 assert.equal(prestigeFromXp(capXp).rank,0);
 assert.equal(prestigeFromXp(capXp+PRESTIGE_XP-1).rank,0);
 assert.equal(prestigeFromXp(capXp+PRESTIGE_XP).rank,1);
 assert.equal(prestigeFromXp(capXp+PRESTIGE_XP*2).rank,2);
 assert.equal(prestigeFromXp(capXp+PRESTIGE_XP*2).tier.name,'Silver');
 const maxed=prestigeFromXp(capXp+PRESTIGE_XP*PRESTIGE_MAX_TIER+PRESTIGE_XP*5);
 assert.equal(maxed.rank,PRESTIGE_MAX_TIER);
 assert.equal(maxed.maxed,true);
 assert.equal(maxed.progress,1);
 assert.equal(maxed.toNext,0);
 assert.equal(prestigeFromXp(-50).rank,0);
 assert.equal(prestigeTier(0),null);
 assert.equal(prestigeTier(1).name,PRESTIGE_TIERS[0].name);
 assert.equal(prestigeTier(99).name,PRESTIGE_TIERS[PRESTIGE_MAX_TIER-1].name);
 assert.equal(prestigeXpBonus(0),0);
 assert.ok(prestigeXpBonus(3)>prestigeXpBonus(1));
});

test('awardMatch pays a prestige XP bonus once the cap is reached',()=>{
 const capXp=totalXpForLevel(MAX_LEVEL);
 const base=awardMatch(normalizeProgression({xp:capXp}),{actor:{frags:0,scoreStats:{}}});
 assert.equal(base.prestigeBonus,0,'no prestige yet, no bonus');
 const prestiged=awardMatch(normalizeProgression({xp:capXp+PRESTIGE_XP}),{actor:{frags:0,scoreStats:{}}});
 assert.ok(prestiged.prestigeBonus>0,'prestige rank grants a bonus');
 assert.equal(prestiged.profile.prestige,1);
 assert.equal(prestiged.profile.prestigeTier,PRESTIGE_TIERS[0].name);
});

test('achievements unlock deterministically from career context and pay XP once',()=>{
 const profile=normalizeProgression({xp:0,matches:0,wins:0,kills:0});
 assert.deepEqual(unlockedAchievements(profile).map(a=>a.id),[]);
 const first=awardMatch(profile,{win:true,actor:{frags:5,deaths:0,scoreStats:{}}});
 assert.ok(first.achievements.some(a=>a.id==='first-blood'),'first win unlocks First Blood');
 assert.ok(first.achievements.some(a=>a.id==='flawless'),'flawless win unlocks Flawless');
 assert.ok(first.achievementXp>=350);
 assert.equal(first.profile.achievements['first-blood'],true);
 const again=awardMatch(first.profile,{win:true,actor:{frags:5,deaths:0,scoreStats:{}}});
 assert.equal(again.achievements.some(a=>a.id==='first-blood'),false,'an unlocked achievement never re-fires');
 assert.equal(again.achievementXp,0);
 assert.equal(achievementStatus(first.profile).find(a=>a.id==='first-blood').unlocked,true);
});

test('achievement context derives best kills, modes, challenges and campaign progress',()=>{
 const profile=normalizeProgression({xp:0,matches:30,wins:12,kills:120,bestStreak:11,flawlessWins:2,challengesCompleted:10,byMode:{deathmatch:{matches:10,wins:6,kills:60,best:27},ctf:{matches:5,wins:3,kills:20,best:8},koth:{matches:5,wins:1,kills:10,best:4},rocket:{matches:5,wins:1,kills:15,best:5},instagib:{matches:5,wins:1,kills:15,best:3}}});
 const ctx=achievementContext(profile,{campaignDone:6,campaignTotal:6});
 assert.equal(ctx.bestKills,27);
 assert.equal(ctx.modes,5);
 assert.equal(ctx.challenges,10);
 const ids=unlockedAchievements(profile,{campaignDone:6,campaignTotal:6}).map(a=>a.id);
 for(const expected of ['first-blood','veteran','gladiator','centurion','sharpshooter','flawless','streak-master','mode-explorer','challenger','campaign-clear'])assert.ok(ids.includes(expected),expected);
 assert.equal(ids.includes('ascendant'),false,'prestige achievement needs a prestige rank');
 assert.equal(unlockedAchievements(profile,{campaignDone:5,campaignTotal:6}).some(a=>a.id==='campaign-clear'),false);
});

test('achievementStatus reports eligibility without mutating the profile',()=>{
 const profile=normalizeProgression({xp:0,matches:1,wins:1,kills:5});
 const status=achievementStatus(profile);
 assert.equal(status.length,ACHIEVEMENTS.length);
 const first=status.find(a=>a.id==='first-blood');
 assert.equal(first.unlocked,false);
 assert.equal(first.eligible,true);
 assert.equal(profile.achievements['first-blood'],undefined);
 const round=normalizeProgression(JSON.parse(JSON.stringify(awardMatch(profile,{win:true,actor:{frags:5,scoreStats:{}}}).profile)));
 assert.equal(round.achievements['first-blood'],true);
 assert.equal(round.prestige,0);
});

test('career panels expose prestige/achievement aria and the page provides every field they read',async()=>{
 const root=new URL('../',import.meta.url);
 const screen=await readFile(new URL('app/ui/screens/ProgressionScreen.tsx',root),'utf8');
 const page=await readFile(new URL('app/page.tsx',root),'utf8');
 const results=await readFile(new URL('app/ui/screens/ResultModals.tsx',root),'utf8');
 // The career tabs, prestige pips and achievement rows are labelled for AT.
 assert.match(screen,/ariaLabel="Career track"/);
 assert.match(screen,/achievement-row/);
 assert.match(screen,/prestige-row/);
 assert.match(screen,/prestige-pip/);
 assert.match(results,/aria-label="Match rewards"/);
 assert.match(results,/NEW ACHIEVEMENTS/);
 // Every ui.* field the screens read must exist in the page bag.
 const start=page.indexOf('const ui:UiBag={'),end=page.indexOf('};',start);
 assert.ok(start>=0&&end>start,'ui bag literal found');
 const bag=page.slice(start,end);
 const has=name=>new RegExp('(^|[,{\\s])'+name+'\\s*[:,}]').test(bag);
 for(const src of [screen,results]){
  const names=new Set();
  for(const m of src.matchAll(/const \{([^}]*)\}\s*=\s*ui;/g))for(const part of m[1].split(',')){const name=part.trim().split(':').pop().trim();if(name&&!name.includes('='))names.add(name);}
  for(const m of src.matchAll(/\bui\.([A-Za-z0-9_]+)/g))names.add(m[1]);
  const missing=[...names].filter(name=>!has(name));
  assert.deepEqual(missing,[],`page ui bag is missing: ${missing.join(', ')}`);
 }
});

test('matchSummaryCard composes the result, reward and career tracks',()=>{
 const hud={actorId:0,modeName:'Deathmatch',mapName:'Exchange',time:154,actors:[{id:0,frags:12,deaths:3}]};
 const profile=normalizeProgression({xp:500,matches:4,wins:2,kills:30});
 const reward=matchRewardSummary({profile,gained:500,levelUp:true,unlocked:[],achievements:[],nextUnlock:{id:'gear-scope',kind:'gear',name:'Precision Scope',level:2}});
 const achievements=[{id:'first-blood',name:'First Blood',description:'Win a match.',xp:100,unlocked:true},{id:'veteran',name:'Veteran',description:'Finish 25 matches.',xp:200,unlocked:false}];
 const card=matchSummaryCard({hud,reward,profile,achievements,historyEntry:{result:'win',modeName:'Deathmatch',mapName:'Exchange',kills:12,deaths:3,duration:154}});
 assert.equal(card.modeName,'Deathmatch');
 assert.equal(card.mapName,'Exchange');
 assert.equal(card.result,'win');
 assert.equal(card.kills,12);
 assert.equal(card.deaths,3);
 assert.equal(card.kd,4);
 assert.equal(card.duration,154);
 assert.equal(card.xp,500);
 assert.equal(card.level,2);
 assert.equal(card.levelUp,true);
 assert.equal(card.prestige,0);
 assert.equal(card.achievementCount,1);
 assert.deepEqual(card.achievements.map(a=>a.id),['first-blood']);
 assert.deepEqual(card.nextUnlock,reward.nextUnlock);
 const empty=matchSummaryCard();
 assert.equal(empty.result,null);
 assert.equal(empty.kills,0);
 assert.equal(empty.kd,0);
 assert.equal(empty.level,1);
 assert.equal(empty.achievementCount,0);
 assert.ok(empty.nextUnlock&&typeof empty.nextUnlock.name==='string');
});

test('normalizeProgression clamps, recomputes level and re-validates gear',()=>{
 const profile=normalizeProgression({xp:xpForLevel(1)+xpForLevel(2),level:99,matches:-3,gear:{primary:'heavy-barrel',armor:'plating',utility:'stim'},unlocks:{'gear-scope':true}});
 assert.equal(profile.xp,1250);
 assert.equal(profile.level,3);
 assert.equal(profile.matches,0);
 assert.equal(profile.gear.primary,undefined);
 assert.equal(profile.gear.armor,'plating');
 assert.equal(profile.gear.utility,undefined);
 assert.ok(profile.unlocks['gear-scope']);
 assert.deepEqual(defaultProgression(),normalizeProgression(null));
});
