import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {awardMatch,defaultProgression,matchSummaryCard,normalizeGear,normalizeProgression} from '../game/progression.mjs';
import {normalizeAttachments} from '../game/attachments.mjs';
import {FINISH_IDS} from '../game/cosmetics.mjs';
import {validPlayerId,validProgressToken} from '../game/protocol.mjs';
import {MAX_DELTA,PLACEMENT_MATCHES,clampRating,defaultLadderRecord,normalizeLadderRecord,rankFor} from '../game/ranked.mjs';

export const PLAYER_CAP=500;
// How many settled match ids the ladder store remembers for the exactly-once
// guard. A server restart cannot replay an in-memory room, so this is a
// belt-and-braces bound: recent settlements survive a reload, older ids age out.
export const LADDER_SETTLEMENT_CAP=512;
export {validPlayerId,validProgressToken};
const newToken=()=>randomBytes(24).toString('hex');

// ---------------------------------------------------------------------------
// Anti-cheat sanity bounds. A client can report any actor result it likes, so
// the authoritative store clamps implausible counters before they inflate a
// career. Bounds are generous (a 15-minute match cannot honestly produce more
// than a few hundred kills) but tight enough to reject forged payloads.
export const SANITY = Object.freeze({
 maxKills: 1000,
 maxDeaths: 1000,
 maxObjectiveTime: 3600,
 maxCaptures: 80,
 maxStreak: 1000,
 maxMatchSeconds: 3600,
 maxXpPerMatch: 20000,
});

// Clamp a match result to sane bounds. Returns a new object; never mutates the
// caller's payload. Non-finite and negative counters collapse to zero.
export function sanityCheckResult(result = {}) {
 const source = result && typeof result === 'object' ? result : {};
 const actor = source.actor && typeof source.actor === 'object' ? source.actor : {};
 const stats = actor.scoreStats && typeof actor.scoreStats === 'object' ? actor.scoreStats : {};
 const count = (value, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
 };
 const objectiveTime = (() => {
  const n = Number(stats.objectiveTime);
  return Number.isFinite(n) ? Math.max(0, Math.min(SANITY.maxObjectiveTime, n)) : 0;
 })();
 const cleanStats = { ...stats, objectiveTime };
 for (const field of ['captures', 'flagReturns', 'flagPickups', 'flagDrops', 'objectiveCaptures', 'objectiveNeutralizations', 'objectiveContests']) {
  if (field in cleanStats) cleanStats[field] = count(cleanStats[field], SANITY.maxCaptures);
 }
 return {
  ...source,
  actor: { ...actor, frags: count(actor.frags, SANITY.maxKills), deaths: count(actor.deaths, SANITY.maxDeaths), scoreStats: cleanStats },
  bestStreak: count(source.bestStreak, SANITY.maxStreak),
  time: Number.isFinite(Number(source.time)) ? Math.max(0, Math.min(SANITY.maxMatchSeconds, Number(source.time))) : 0,
 };
}

// True when a result was already within bounds (used to flag suspicious
// payloads without rejecting the whole match).
export function withinSanity(result = {}) {
 const source = result && typeof result === 'object' ? result : {};
 const actor = source.actor && typeof source.actor === 'object' ? source.actor : {};
 const stats = actor.scoreStats && typeof actor.scoreStats === 'object' ? actor.scoreStats : {};
 const over = (value, max) => Number.isFinite(Number(value)) && Number(value) > max;
 return !(over(actor.frags, SANITY.maxKills) || over(actor.deaths, SANITY.maxDeaths) || over(stats.objectiveTime, SANITY.maxObjectiveTime) || over(source.bestStreak, SANITY.maxStreak));
}

export class ProgressionStore{
 constructor(file=null,options={}){
  this.file=file?path.resolve(file):null;
  this.max=Math.max(1,options.max??PLAYER_CAP);
  this.players=new Map();
  this.tokens=new Map();
  this.pinned=new Set();
  this._dirty=false;
  this._rev=0;
  this._writing=null;
  this._retryAt=0;
  this._failures=0;
  this.lastPersistError=null;
  this.ladder=new Map();
  this.ladderSettled=new Map();
  this.ladderOrder=[];
  if(this.file)this.load();
 }
 load(){
  try{
   const raw=JSON.parse(fs.readFileSync(this.file,'utf8'));
   const entries=Array.isArray(raw)?raw:Array.isArray(raw?.players)?raw.players:[];
   this.players=new Map();this.tokens=new Map();
   this.ladder=new Map();this.ladderSettled=new Map();this.ladderOrder=[];
   for(const entry of entries){
    const id=entry?.id;
    if(!validPlayerId(id))continue;
    const profile={...normalizeProgression(entry),id};
    if(validProgressToken(entry?.ownerToken)){profile.ownerToken=entry.ownerToken;this.tokens.set(entry.ownerToken,id);}
    else delete profile.ownerToken;
    const previous=this.players.get(id);
    if(previous?.ownerToken)this.tokens.delete(previous.ownerToken);
    this.players.set(id,profile);
   }
   // Ladder ratings live beside the career profiles in the same atomic store so
   // one write persists both. Legacy array/{players} files simply boot unrated.
   const ladderSource=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw.ladder:null;
   if(ladderSource&&typeof ladderSource==='object'){
    const ratings=ladderSource.players&&typeof ladderSource.players==='object'?ladderSource.players:{};
    for(const [id,value] of Object.entries(ratings)){
     if(!validPlayerId(id))continue;
     const record=normalizeLadderRecord(value);
     if(record)this.ladder.set(id,record);
    }
    for(const item of Array.isArray(ladderSource.settled)?ladderSource.settled:[]){
     const matchId=typeof item?.matchId==='string'&&item.matchId?item.matchId.slice(0,64):null;
     if(!matchId||this.ladderSettled.has(matchId))continue;
     this.ladderSettled.set(matchId,{matchId,count:Math.max(0,Math.floor(Number(item.count)||0))});
     this.ladderOrder.push(matchId);
    }
    while(this.ladderOrder.length>LADDER_SETTLEMENT_CAP)this.ladderSettled.delete(this.ladderOrder.shift());
   }
  }catch{this.players=new Map();this.tokens=new Map();this.ladder=new Map();this.ladderSettled=new Map();this.ladderOrder=[];}
 }
 touch(id){const profile=this.players.get(id);if(profile){this.players.delete(id);this.players.set(id,profile);}return profile;}
 clone(profile){if(!profile)return null;const copy={...profile,byMode:Object.fromEntries(Object.entries(profile.byMode||{}).map(([mode,stats])=>[mode,{...(stats||{})}])),gear:{...profile.gear},attachments:{...profile.attachments},unlocks:{...profile.unlocks},achievements:{...(profile.achievements||{})}};if(validPlayerId(profile.id))copy.ladder=this.ladderFor(profile.id);return copy;}
 get(id){if(!validPlayerId(id)||!this.players.has(id))return null;return this.clone(this.touch(id));}
 getOwned(id,token){if(!validPlayerId(id)||!validProgressToken(token))return null;const profile=this.players.get(id);if(!profile||profile.ownerToken!==token)return null;return this.clone(this.touch(id));}
 // -------------------------------------------------------------------
 // Ranked V2 ladder. Ratings live in the same store and file as careers so a
 // reload restores them; settlements are keyed by match id so a result can
 // never be applied twice.
 // -------------------------------------------------------------------
 ladderFor(id){if(!validPlayerId(id))return {...defaultLadderRecord()};const record=this.ladder.get(id);return record?{...record}:{...defaultLadderRecord()};}
 ladderRating(id){return this.ladderFor(id).rating;}
 ladderBoard({limit=50}={}){
  const rows=[];
  for(const [id,record] of this.ladder){
   if(!this.players.has(id))continue;
   const rank=rankFor(record.rating,record.matches);
   rows.push({playerId:id,rating:record.rating,matches:record.matches,peak:record.peak,provisional:record.matches<PLACEMENT_MATCHES,rank});
  }
  rows.sort((a,b)=>b.rating-a.rating||a.matches-b.matches||String(a.playerId).localeCompare(String(b.playerId)));
  const max=Math.max(1,Math.min(500,Number(limit)||50));
  return rows.slice(0,max).map((row,index)=>({...row,position:index+1}));
 }
 // Apply one finished match. `entries` come from game/ranked.mjs `settleMatch`
 // and carry {playerId, delta}. The store recomputes each rating from the
 // current record, so a duplicated or replayed settlement cannot move a rating
 // twice; a duplicate match id is rejected outright and returns null.
 applyLadderSettlement(matchId,entries){
  const key=typeof matchId==='string'&&matchId?matchId.slice(0,64):null;
  if(!key||this.ladderSettled.has(key))return null;
  const applied=[];
  for(const entry of Array.isArray(entries)?entries:[]){
   if(!entry||!validPlayerId(entry?.playerId))continue;
   const delta=Number(entry.delta);
   if(!Number.isFinite(delta))continue;
   this.ensure(entry.playerId);
   const current=this.ladder.get(entry.playerId)??defaultLadderRecord();
   const before=current.rating;
   const after=clampRating(before+Math.max(-MAX_DELTA,Math.min(MAX_DELTA,Math.round(delta))));
   const appliedDelta=after-before;
   const next={rating:after,matches:current.matches+1,peak:Math.max(current.peak??before,after),lastDelta:appliedDelta,lastMatchId:key};
   this.ladder.set(entry.playerId,next);
   applied.push({playerId:entry.playerId,before,after,delta:appliedDelta,matches:next.matches,placement:current.matches<PLACEMENT_MATCHES});
  }
  this.ladderSettled.set(key,{matchId:key,count:applied.length});
  this.ladderOrder.push(key);
  while(this.ladderOrder.length>LADDER_SETTLEMENT_CAP)this.ladderSettled.delete(this.ladderOrder.shift());
  this._dirty=true;this._rev++;this.flush();
  return applied.length?applied:null;
 }
 setPinned(ids){this.pinned=ids instanceof Set?ids:new Set(ids??[]);}
 uniqueId(){let id;do{id=randomUUID();}while(this.players.has(id));return id;}
 identify(playerId,token){
  const tok=validProgressToken(token)?token:null;
  if(tok){const owned=this.tokens.get(tok);if(owned&&this.players.has(owned))return{profile:this.clone(this.touch(owned)),token:tok};}
  const pid=validPlayerId(playerId)?playerId:null;
  const existing=pid?this.players.get(pid):null;
  if(existing&&!existing.ownerToken){const claimed=tok??newToken();existing.ownerToken=claimed;this.tokens.set(claimed,pid);this.touch(pid);return{profile:this.clone(existing),token:claimed};}
  if(pid&&!existing){const claimed=tok??newToken();const profile={...defaultProgression(),id:pid,ownerToken:claimed};this.players.set(pid,profile);this.tokens.set(claimed,pid);this.trim();return{profile:this.clone(profile),token:claimed};}
  const claimed=tok??newToken();const id=this.uniqueId();const profile={...defaultProgression(),id,ownerToken:claimed};this.players.set(id,profile);this.tokens.set(claimed,id);this.trim();return{profile:this.clone(profile),token:claimed};
 }
 ensure(id){if(!validPlayerId(id))return null;if(!this.players.has(id)){this.players.set(id,{...defaultProgression(),id});this.trim();}return this.touch(id);}
 setGear(id,gear,attachments,finish){
  const profile=this.ensure(id);
  if(!profile)return null;
  profile.gear=normalizeGear(gear&&typeof gear==='object'?gear:{},profile.level);
  if(attachments!==undefined)profile.attachments=normalizeAttachments(attachments&&typeof attachments==='object'?attachments:{},profile.level);
  if(finish!==undefined)profile.finish=FINISH_IDS.includes(finish)?finish:null;
  this._dirty=true;this._rev++;this.flush();
  return this.get(id);
 }
 setGearOwned(id,token,gear,attachments,finish){return this.getOwned(id,token)?this.setGear(id,gear,attachments,finish):null;}
 award(id,result={}){
  const existing=this.players.get(id);
  const profile=this.ensure(id);
  if(!profile)return null;
  const token=existing?.ownerToken??profile.ownerToken;
  const clean=withinSanity(result)?result:sanityCheckResult(result);
  const awarded=awardMatch(profile,clean);
  awarded.profile.id=id;
  if(token)awarded.profile.ownerToken=token;
  this.players.set(id,awarded.profile);
  this.trim();
  this._dirty=true;this._rev++;this.flush();
  return {profile:this.get(id),gained:awarded.gained,baseGained:awarded.baseGained,prestigeBonus:awarded.prestigeBonus,achievementXp:awarded.achievementXp,levelUp:awarded.levelUp,prestigeUp:awarded.prestigeUp,unlocked:awarded.unlocked,achievements:awarded.achievements,progress:awarded.progress,toNext:awarded.toNext,result:result?.win===true?'win':result?.draw===true?'draw':'loss',actor:result?.actor??null,mode:result?.mode??null,flagged:withinSanity(result)?false:true};
 }
 awardOwned(id,token,result){return this.getOwned(id,token)?this.award(id,result):null;}
 // Cross-session leaderboard. One row per profile, ranked deterministically by
 // wins, then XP, then kills, then best single-match kills. `mode` optionally
 // filters to a single mode's stored stats. Pure read; never mutates profiles.
 leaderboard({mode=null,limit=50}={}) {
  const rows=[];
  for(const profile of this.players.values()){
   const byMode=profile.byMode||{};
   const stats=mode?(byMode[mode]||{matches:0,wins:0,kills:0,best:0}):null;
   const wins=mode?Number(stats.wins)||0:Number(profile.wins)||0;
   const kills=mode?Number(stats.kills)||0:Number(profile.kills)||0;
   const best=mode?Number(stats.best)||0:Object.values(byMode).reduce((max,entry)=>Math.max(max,Number(entry?.best)||0),0);
   const matches=mode?Number(stats.matches)||0:Number(profile.matches)||0;
   if(mode&&!matches)continue;
   rows.push({id:profile.id,level:profile.level,xp:Number(profile.xp)||0,wins,kills,matches,best,prestige:Number(profile.prestige)||0,mode:mode??null});
  }
  rows.sort((a,b)=>(b.wins-a.wins)||(b.xp-a.xp)||(b.kills-a.kills)||(b.best-a.best)||String(a.id).localeCompare(String(b.id)));
  const max=Math.max(1,Math.min(500,Number(limit)||50));
  return rows.slice(0,max).map((row,index)=>({...row,rank:index+1}));
 }
 // Post-match summary card for the client results screen. Composes the stored
 // profile with the award payload so the network path shows the same XP,
 // prestige and achievement progress as the local path.
 summary(id,award={}){
  const profile=this.get(id);
  if(!profile)return null;
  const achievements=(Array.isArray(award?.achievements)?award.achievements:[]).map(a=>({...a,unlocked:true}));
  return matchSummaryCard({reward:award,profile,achievements,result:award?.result??null,historyEntry:{result:award?.result??null,kills:award?.actor?.frags,deaths:award?.actor?.deaths}});
 }
 trim(){
  for(const id of [...this.players.keys()]){
   if(this.players.size<=this.max)break;
   if(this.pinned.has(id))continue;
   const profile=this.players.get(id);
   if(profile?.ownerToken)this.tokens.delete(profile.ownerToken);
   this.players.delete(id);
   this.ladder.delete(id);
  }
 }
 persist(){
  if(!this.file)return Promise.resolve(true);
  if(this._writing)return this._writing;
  const tmp=`${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  this._writing=(async()=>{
   try{
    await fsp.mkdir(path.dirname(this.file),{recursive:true});
    const rev=this._rev;
    const payload={version:2,players:[...this.players.values()],ladder:{players:Object.fromEntries([...this.ladder].filter(([id])=>this.players.has(id))),settled:this.ladderOrder.map(matchId=>({...this.ladderSettled.get(matchId),matchId}))}};
    await fsp.writeFile(tmp,JSON.stringify(payload,null,1));
    await fsp.rename(tmp,this.file);
    if(this._rev===rev)this._dirty=false;
    this._retryAt=0;this._failures=0;this.lastPersistError=null;
    return true;
   }catch(error){
    this._dirty=true;this.lastPersistError=error;
    this._failures=(this._failures??0)+1;
    this._retryAt=Date.now()+Math.min(30000,1000*2**Math.min(this._failures-1,5));
    try{await fsp.unlink(tmp);}catch{}
    return false;
   }finally{
    this._writing=null;
    if(this._dirty&&(!this._retryAt||Date.now()>=this._retryAt))this.flush();
   }
  })();
  return this._writing;
 }
 flush(){
  if(!this.file)return Promise.resolve(true);
  if(this._writing)return this._writing;
  if(!this._dirty)return Promise.resolve(true);
  if(this._retryAt&&Date.now()<this._retryAt)return Promise.resolve(false);
  return this.persist();
 }
 async whenPersisted(){
  if(!this.file)return true;
  while(true){
   if(this._writing){await this._writing;continue;}
   if(!this._dirty)return true;
   if(this._retryAt&&Date.now()<this._retryAt)return false;
   await this.flush();
  }
 }
 all(){return [...this.players.values()].map(profile=>({...profile,byMode:Object.fromEntries(Object.entries(profile.byMode||{}).map(([mode,stats])=>[mode,{...(stats||{})}])),gear:{...profile.gear},attachments:{...profile.attachments},unlocks:{...profile.unlocks},achievements:{...(profile.achievements||{})}}));}
}
