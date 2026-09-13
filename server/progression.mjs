import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {awardMatch,defaultProgression,normalizeGear,normalizeProgression} from '../game/progression.mjs';
import {normalizeAttachments} from '../game/attachments.mjs';
import {FINISH_IDS} from '../game/cosmetics.mjs';

export const PLAYER_CAP=500;
export const validPlayerId=id=>typeof id==='string'&&/^[A-Za-z0-9-]{8,64}$/.test(id);
const validProgressToken=token=>typeof token==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(token);
const newToken=()=>randomBytes(24).toString('hex');

export class ProgressionStore{
 constructor(file=null,options={}){
  this.file=file?path.resolve(file):null;
  this.max=Math.max(1,options.max??PLAYER_CAP);
  this.players=new Map();
  this.tokens=new Map();
  this.pinned=new Set();
  if(this.file)this.load();
 }
 load(){
  try{
   const raw=JSON.parse(fs.readFileSync(this.file,'utf8'));
   const entries=Array.isArray(raw)?raw:Array.isArray(raw?.players)?raw.players:[];
   this.players=new Map();this.tokens=new Map();
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
  }catch{this.players=new Map();this.tokens=new Map();}
 }
 touch(id){const profile=this.players.get(id);if(profile){this.players.delete(id);this.players.set(id,profile);}return profile;}
 clone(profile){return profile?{...profile,gear:{...profile.gear},attachments:{...profile.attachments},unlocks:{...profile.unlocks}}:null;}
 get(id){if(!validPlayerId(id)||!this.players.has(id))return null;return this.clone(this.touch(id));}
 getOwned(id,token){if(!validPlayerId(id)||!validProgressToken(token))return null;const profile=this.players.get(id);if(!profile||profile.ownerToken!==token)return null;return this.clone(this.touch(id));}
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
  this.persist();
  return this.get(id);
 }
 setGearOwned(id,token,gear,attachments,finish){return this.getOwned(id,token)?this.setGear(id,gear,attachments,finish):null;}
 award(id,result={}){
  const existing=this.players.get(id);
  const profile=this.ensure(id);
  if(!profile)return null;
  const token=existing?.ownerToken??profile.ownerToken;
  const awarded=awardMatch(profile,result);
  awarded.profile.id=id;
  if(token)awarded.profile.ownerToken=token;
  this.players.set(id,awarded.profile);
  this.trim();
  this.persist();
  return {profile:this.get(id),gained:awarded.gained,levelUp:awarded.levelUp,unlocked:awarded.unlocked,progress:awarded.progress,toNext:awarded.toNext};
 }
 awardOwned(id,token,result){return this.getOwned(id,token)?this.award(id,result):null;}
 trim(){
  for(const id of [...this.players.keys()]){
   if(this.players.size<=this.max)break;
   if(this.pinned.has(id))continue;
   const profile=this.players.get(id);
   if(profile?.ownerToken)this.tokens.delete(profile.ownerToken);
   this.players.delete(id);
  }
 }
 persist(){
  if(!this.file)return true;
  const tmp=`${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try{
   fs.mkdirSync(path.dirname(this.file),{recursive:true});
   fs.writeFileSync(tmp,JSON.stringify([...this.players.values()],null,1));
   fs.renameSync(tmp,this.file);
   this._dirty=false;this._retryAt=0;this._failures=0;this.lastPersistError=null;
   return true;
  }catch(error){
   this._dirty=true;this.lastPersistError=error;
   this._failures=(this._failures??0)+1;
   this._retryAt=Date.now()+Math.min(30000,1000*2**Math.min(this._failures-1,5));
   try{fs.unlinkSync(tmp);}catch{}
   return false;
  }
 }
 flush(){
  if(!this.file||!this._dirty)return true;
  if(this._retryAt&&Date.now()<this._retryAt)return false;
  return this.persist();
 }
 all(){return [...this.players.values()].map(profile=>({...profile,gear:{...profile.gear},attachments:{...profile.attachments},unlocks:{...profile.unlocks}}));}
}
