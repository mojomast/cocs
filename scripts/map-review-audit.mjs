import {MAPS} from '../game/maps.mjs';
import {arenaMeta} from '../game/arenas.mjs';
import {CAMPAIGN_MISSIONS} from '../game/campaign-data.mjs';
import {navigation,floorAt,obstructed,visible} from '../game/core.mjs';
import {writeFileSync} from 'node:fs';
const wanted=process.argv.find(v=>v.startsWith('--maps='))?.slice(7).split(',');
const output=process.argv.find(v=>v.startsWith('--out='))?.slice(6);
const power=new Set(['rocket','rail','megahealth','overshield','overcharge']);
const rows=[];
for(const map of MAPS.filter(m=>!wanted||wanted.includes(m.id))){
 const started=performance.now(),nav=navigation(map);
 const nearest=p=>{let idx=-1,distance=Infinity;for(let i=0;i<nav.nodes.length;i++){const q=nav.nodes[i],d=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z);if(d<distance){idx=i;distance=d;}}return {idx,distance};};
 const point=(x,z)=>{const y=floorAt(x,z,map);const p={x,y:y??0,z};return {...p,supported:y!==null,blocked:y===null||obstructed(x,p.y,z,.38,map),nav:nearest(p)};};
 const spawns=map.spawns.map(([x,z])=>point(x,z)),pickups=map.pickups.map(([kind,x,z])=>({kind,...point(x,z)}));
 const paths=new Map();
 function distances(start){if(paths.has(start))return paths.get(start);const d=nav.nodes.map(()=>Infinity),visited=new Uint8Array(d.length);if(start<0)return d;d[start]=0;for(let step=0;step<d.length;step++){let u=-1;for(let i=0;i<d.length;i++)if(!visited[i]&&(u<0||d[i]<d[u]))u=i;if(u<0||!Number.isFinite(d[u]))break;visited[u]=1;for(const v of nav.edges[u]||[]){const a=nav.nodes[u],b=nav.nodes[v],cost=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);d[v]=Math.min(d[v],d[u]+cost);}}paths.set(start,d);return d;}
 for(const s of spawns){const d=distances(s.nav.idx);s.powerRoutes=pickups.filter(p=>power.has(p.kind)).map(p=>({kind:p.kind,x:p.x,z:p.z,travel:Number.isFinite(d[p.nav.idx])?Math.round((d[p.nav.idx]+s.nav.distance+p.nav.distance)*10)/10:null,elevation:p.y-s.y}));s.exposedSpawns=spawns.filter(q=>q!==s&&visible({...s,y:s.y+1.45},{...q,y:q.y+1.45},map)).length;}
 const issues=[];spawns.forEach((s,i)=>{if(s.blocked)issues.push(`spawn ${i} unsupported/blocked`);if(s.nav.distance>3)issues.push(`spawn ${i} nav distance ${s.nav.distance.toFixed(1)}`);});pickups.forEach((p,i)=>{if(p.blocked)issues.push(`pickup ${i} ${p.kind} unsupported/blocked`);if(p.nav.distance>3)issues.push(`pickup ${i} ${p.kind} nav distance ${p.nav.distance.toFixed(1)}`);});
 rows.push({id:map.id,name:map.name,modes:arenaMeta(map).play,description:map.description,nextGen:!!map.nextGen,structures:map.structures?.length??0,blocks:map.blocks.length,navNodes:nav.nodes.length,missions:CAMPAIGN_MISSIONS.filter(m=>m.mapId===map.id).map(m=>m.id),spawns,pickups,issues,review:'automated geometric/navigation audit only; visual/manual route review outstanding',ms:Math.round(performance.now()-started)});
 console.error(`${map.id}: ${nav.nodes.length} nav nodes; ${issues.length} issues`);
}
const text=JSON.stringify(rows,null,2);if(output)writeFileSync(output,text);else console.log(text);
