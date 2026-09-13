export const ASSAULT_MODE_ID='assault';
export const ASSAULT_SECTOR_IDS=['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india'];
const DEFAULT_IDS=ASSAULT_SECTOR_IDS.slice(0,3);
// Config fragLimit drives the sector count (UI exposes 1-9). Named ids keep the
// HUD, event payloads and history stable for the legacy three-sector default.
export const assaultSectorIds=(count=DEFAULT_IDS.length)=>{const requested=Number(count),total=Math.max(1,Math.min(ASSAULT_SECTOR_IDS.length,Math.floor(Number.isFinite(requested)?requested:DEFAULT_IDS.length)));return Array.from({length:total},(_,i)=>ASSAULT_SECTOR_IDS[i]??`sector-${i+1}`);};
const boundsOf=arena=>arena.bounds||{minX:-13.55,maxX:13.55,minZ:-13.55,maxZ:13.55};
const insideBlock=(arena,x,z,y=0)=>(arena.blocks||[]).some(block=>Math.abs(x-block.x)<=block.w/2&&Math.abs(z-block.z)<=block.d/2&&y<block.h-1e-6);
const inBounds=(arena,x,z)=>{const b=boundsOf(arena);return x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;};
const sector=(id,point,captureSeconds)=>({id,x:point.x,z:point.z,radius:point.radius??3.5,y:point.y??0,progress:0,owner:null,captureTeam:null,captureSeconds});
const candidatePoints=arena=>{const values=[];for(const node of arena.navNodes||[])values.push({x:node.x,z:node.z,y:node.y});for(const spawn of arena.spawns||[])values.push({x:spawn[0],z:spawn[1]});for(const pickup of arena.pickups||[])values.push({x:pickup[1],z:pickup[2]});const b=boundsOf(arena);values.push({x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2,y:0});return values;};
export function assaultTemplate(arena,ids=DEFAULT_IDS){
 const source=arena||{},zones=Array.isArray(source.objectiveZones)?source.objectiveZones:[],captureSeconds=6;
 const valid=point=>Boolean(point)&&Number.isFinite(point.x)&&Number.isFinite(point.z)&&inBounds(source,point.x,point.z)&&!insideBlock(source,point.x,point.z,point.y??0);
 const safe=candidatePoints(source).filter(valid),pool=safe.length?safe:[{x:0,z:0,y:0}];
 // Reuse authored zones in order and top the sector list up from candidate/nav
 // points so the configured count is always honoured exactly.
 let fallback=0;
 const sectors=ids.map((id,index)=>{const zone=zones[index];return sector(id,valid(zone)?zone:pool[fallback++%pool.length],captureSeconds);});
 return {kind:'assault',attacker:null,defender:null,sectors,active:0,breached:false,winner:null};
}
export function assignAssaultTeams(state){if(state){if(state.attacker==null)state.attacker=0;if(state.defender==null)state.defender=1;}return state;}
export function assaultActiveSector(state){return state?.sectors?.[state.active]??null;}
export function assaultSectors(state){return state?.sectors??[];}
export function stepAssault(state,actors,dt,options={}){
 const {rules,emit,teamScores,scoreLimit}=options;
 if(!state||state.breached)return {scored:0,captured:[],breached:state?.breached??false,active:state?.active??0};
 const active=assaultActiveSector(state);
 if(!active)return {scored:0,captured:[],breached:state.breached,active:state.active};
 let dirty=!Array.isArray(state.captured);
 const attacker=state.attacker??0,defender=state.defender??1;
 const captureSeconds=active.captureSeconds||rules?.objective?.captureSeconds||6;
 const rate=100*dt/captureSeconds;
 const living=(actors||[]).filter(actor=>actor&&actor.health>0&&Math.hypot(actor.x-active.x,actor.z-active.z)<=active.radius&&Math.abs((actor.y??0)-(Number.isFinite(active.y)?active.y:0))<=5);
 const attackers=living.filter(actor=>actor.team===attacker).length,defenders=living.filter(actor=>actor.team===defender).length;
 let scored=0;
 if(attackers>0&&defenders>0){
  active.progress=Math.max(0,active.progress-rate*.6);
  if(active.progress===0&&active.owner!==null){emit?.('assault-sector-lost',{sector:active.id,team:active.owner,active:state.active});active.owner=null;active.captureTeam=null;dirty=true;}
 }else if(attackers>0){
  active.progress=Math.min(100,active.progress+rate);
  if(active.progress>=100){
   active.progress=100;active.owner=attacker;active.captureTeam=null;state.active+=1;scored+=1;dirty=true;
   emit?.('assault-sector-captured',{sector:active.id,team:attacker,active:state.active});
   if(state.active>=state.sectors.length){state.breached=true;state.winner=attacker;emit?.('assault-breach',{winner:attacker});}
  }
 }else if(defenders>0){
  active.progress=Math.max(0,active.progress-rate);
  if(active.progress===0&&active.owner===attacker){active.owner=defender;dirty=true;emit?.('assault-sector-lost',{sector:active.id,team:attacker,active:state.active});}
 }
 if(scored>0&&teamScores)teamScores[attacker]=(teamScores[attacker]||0)+scored;
 if(scored>0&&scoreLimit&&teamScores&&teamScores[attacker]>=scoreLimit)state.winner=attacker;
 if(dirty)state.captured=state.sectors.filter(value=>value.owner===attacker).map(value=>value.id);
 return {scored,captured:state.captured,breached:state.breached,active:state.active};
}
