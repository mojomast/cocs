import {createElement} from 'react';
import {CHARACTERS,HARNESSES,WEAPONS} from './data.mjs';
import {WINGS,resolveKit} from './kits.mjs';
import {modeColumns,modePrimary,scoreStats,scoreText,teamName,isTeamMode} from './hud.mjs';
import {raceStandings,raceTime} from './race-ui.mjs';
import {formatNumber} from './format-ui.mjs';

const metricText=(field,value,actor)=>field==='objectiveTime'?`${formatNumber(value)}s`:field==='ladder'?`RUNG ${Math.max(1,(Number(actor?.ladder)||0)+1)}`:field==='weapon'?String(WEAPONS[Number(actor?.weapon)]?.short??actor?.weapon??'-'):scoreText(value);
const compareActors=(mode,a,b,teamScores)=>{if(mode==='teamdeathmatch'){const as=Number(teamScores?.[a?.team]??0),bs=Number(teamScores?.[b?.team]??0);if(as!==bs)return bs-as;}const ar=modePrimary(mode,a),br=modePrimary(mode,b);for(let i=0;i<Math.max(ar.length,br.length);i++)if(ar[i]!==br[i])return br[i]-ar[i];return (Number(b?.frags)||0)-(Number(a?.frags)||0)||(Number(a?.deaths)||0)-(Number(b?.deaths)||0)||String(a?.name??'').localeCompare(String(b?.name??''))||(Number(a?.id)||0)-(Number(b?.id)||0);};

// Streak label: the current killstreak with its milestone reward, or null when
// the player is not on one. Mirrors hud.streakStatus but keeps the reward tag.
export function streakLabel(actor){
 const streak=Math.max(0,Math.floor(Number(actor?.streak)||0));
 if(streak<=0)return null;
 return {streak,label:`${streak}`};
}

// Ping bucket for the scoreboard chip. Returns null when the actor has no
// reported latency (local/offline matches), so the column hides cleanly.
 export function pingLabel(actor){
  const raw=actor?.ping;
  if(raw===null||raw===undefined||raw==='')return null;
  const ping=Number(raw);
  if(!Number.isFinite(ping)||ping<0)return null;
 const ms=Math.round(ping);
 const quality=ms<60?'good':ms<120?'fair':'poor';
 return {ping:ms,quality,label:`${ms}`};
}

// The local client measures its own round-trip latency (`NetClient.rtt`); the
// server never reports it as an actor field. Fill it onto the local row only,
// never overwriting a server measurement and never inventing a row that is not
// in the snapshot. A shallow copy keeps source snapshots immutable.
export function stampLocalPing(source,actorId,rtt){
 if(rtt===null||rtt===undefined||rtt==='')return source;
 const ping=Number(rtt);
 if(!Number.isFinite(ping)||ping<0||actorId===null||actorId===undefined)return source;
 const actors=Array.isArray(source?.actors)?source.actors:null;
 if(!actors)return source;
 let stamped=false;
 const next=actors.map(actor=>{
  if(!actor||typeof actor!=='object'||actor.id!==actorId)return actor;
  if(actor.ping!==null&&actor.ping!==undefined&&actor.ping!=='')return actor;
  stamped=true;
  return {...actor,ping};
 });
 return stamped?{...source,actors:next}:source;
}

// Null-safe wing/spec chip for one scoreboard row. Actors without a
// character/harness (race and soccer snapshots, match history, tests) return
// null, so the row renders exactly as it did before the class overhaul.
export function actorKitChip(actor){
 const character=typeof actor?.character==='string'?actor.character:null;
 const harness=typeof actor?.harness==='string'?actor.harness:null;
 if(!character||!harness)return null;
 const kit=resolveKit(character,harness);
 const wing=WINGS.find(entry=>entry.id===kit.wing)??null;
 const spec=HARNESSES.find(entry=>entry.id===kit.harness)??null;
 if(!wing&&!spec)return null;
 return {
  wing:wing?{id:wing.id,label:wing.label,name:wing.name,color:wing.color}:null,
  spec:spec?{id:spec.id,name:spec.name,power:kit.active?.name??spec.power}:null,
 };
}

// Build the deterministic row order for a scoreboard. Team modes group by team
// (winning team first) and keep the per-team ordering; free-for-all is one
// group. `history` drops the local-player marker but keeps the ordering.
export function scoreboardGroups(source,{history=false}={}){
 const modeId=source?.config?.mode??source?.mode??'deathmatch';
 const teamScores=source?.teamScores;
 const actorId=history?null:source?.actorId;
 const actors=[...(source?.actors??source?.players??[])];
 const teamMode=isTeamMode(modeId);
 if(!teamMode)return [{team:null,label:null,score:null,actors:actors.sort((a,b)=>compareActors(modeId,a,b,teamScores))}];
 const teams=new Map();
 for(const actor of actors){
  const raw=actor?.team;
  const team=raw===null||raw===undefined||raw===''||!Number.isInteger(Number(raw))?null:Number(raw);
  if(!teams.has(team))teams.set(team,[]);
  teams.get(team).push(actor);
 }
 const ordered=[...teams.keys()].sort((a,b)=>{
  const as=Number(teamScores?.[a]??0),bs=Number(teamScores?.[b]??0);
  if(as!==bs)return bs-as;
  return (a??99)-(b??99);
 });
 return ordered.map(team=>({
  team,label:team===null?'UNASSIGNED':teamName(team),score:Number(teamScores?.[team]??0),
  actors:teams.get(team).sort((a,b)=>compareActors(modeId,a,b,teamScores)),
 }));
}

export function renderScoreboard(source,history=false){
 if(source?.config?.mode==='puma-race'||source?.mode==='puma-race')return createElement('div',{className:'scoreboard race-standings','aria-label':'Race standings'},
  createElement('div',{className:'race-score-row labels'},createElement('span',null,'PLACE / DRIVER'),createElement('span',null,'LAPS DONE'),createElement('span',null,'FINISH')),
  raceStandings(source).map(row=>{const you=!history&&row.actorId===(source.actorId??0);return createElement('div',{className:`race-score-row ${you?'you':''}`,key:row.actorId},createElement('span',null,createElement('b',null,row.position),' ',row.name,you?' / YOU':''),createElement('span',null,row.completedLaps,' / ',source.race.laps),createElement('span',null,row.finishTime==null?(source.race.phase==='finished'?'DNF':'RACING'):raceTime(row.finishTime)));}));
  if(source?.config?.mode==='puma-soccer'||source?.mode==='puma-soccer'){const rows=[...(source.race?.standings??[])].sort((a,b)=>(b.goals||0)-(a.goals||0)||a.actorId-b.actorId),actorId=history?null:source.actorId;const nameOf=row=>source.actors?.find(a=>a.id===row.actorId)?.name??source.players?.find(p=>p.actorId===row.actorId)?.name??`Player ${row.actorId}`;return createElement('div',{className:'scoreboard soccer-standings','aria-label':'Soccer standings'},
  createElement('div',{className:'soccer-score-row labels'},createElement('span',null,'PLAYER'),createElement('span',null,'TEAM'),createElement('span',null,'GOALS')),
  rows.map((row,index)=>{const you=!history&&row.actorId===actorId;return createElement('div',{className:`soccer-score-row ${you?'you':''}`,key:row.actorId},createElement('span',null,createElement('b',null,String(index+1).padStart(2,'0')),' ',nameOf(row),you?' / YOU':''),createElement('span',null,teamName(row.team)),createElement('span',null,Number(row.goals)||0));}));}
 const modeId=source?.config?.mode??source?.mode??'deathmatch',columns=modeColumns(modeId),teamScores=source?.teamScores,actorId=history?null:source?.actorId;
 const groups=scoreboardGroups(source,{history});
 const teamBanner=isTeamMode(modeId);
 const header=createElement('div',{className:'score-row labels',role:'row'},createElement('span',{role:'columnheader'},'OPERATOR'),createElement('strong',{role:'columnheader'},'KILLS'),createElement('span',{role:'columnheader'},'DEATHS'),createElement('span',{role:'columnheader'},'STREAK'),createElement('span',{role:'columnheader'},'PING'),columns.map(([,label])=>createElement('span',{key:label,role:'columnheader'},label)));
 let rank=0;
 const rows=[];
 for(const group of groups){
  if(group.team!==null)rows.push(createElement('div',{className:`score-team-heading team-${group.team}`,'aria-label':`${group.label} score`,key:`head-${group.team}`,role:'row'},createElement('strong',{role:'rowheader'},group.label),createElement('span',{role:'cell'},scoreText(group.score))));
  for(const a of group.actors){
   rank++;
   const stats=scoreStats(a),streak=streakLabel(a),ping=pingLabel(a),kitChip=actorKitChip(a),you=a.id===actorId;
   rows.push(createElement('div',{className:`score-row ${you?'you':''} ${a.team!==null&&a.team!==undefined?`team-${a.team}`:''}`,key:a.id??`${a.name}-${rank}`,role:'row',...(you?{'aria-current':'true'}:{})},
    createElement('span',{role:'rowheader'},createElement('b',null,String(rank).padStart(2,'0')),createElement('i',{style:{background:CHARACTERS.find(c=>c.id===a.character)?.color}}),a.name,
     kitChip?.wing&&createElement('small',{key:'wing',className:`score-chip score-chip--wing wing-${kitChip.wing.id}`,style:{color:kitChip.wing.color},title:`${kitChip.wing.name}${kitChip.spec?` · ${kitChip.spec.name}`:''}`},kitChip.wing.label),
     kitChip?.spec&&createElement('small',{key:'spec',className:'score-chip score-chip--spec',title:`${kitChip.spec.name} · ${kitChip.spec.power}`},kitChip.spec.name.toUpperCase()),
     you&&createElement('small',{'aria-hidden':'true'},'YOU'),
     you&&createElement('span',{key:'you',className:'sr-only'},'YOU')),
    createElement('strong',{role:'cell'},Number(a.frags)||0),
    createElement('span',{role:'cell'},Number(a.deaths)||0),
    createElement('span',{role:'cell',className:streak?`streak streak-${streak.streak>=3?'hot':'warm'}`:'streak'},streak?streak.label:'-'),
    createElement('span',{role:'cell',className:ping?`ping ping-${ping.quality}`:'ping'},ping?ping.label:'-'),
    columns.map(([field])=>createElement('span',{key:field,role:'cell'},metricText(field,stats[field],a)))));
  }
 }
  return createElement('div',{className:`scoreboard mode-scoreboard mode-scoreboard-${modeId}`,style:{'--score-columns':4+columns.length,'--score-width':`${220+(4+columns.length)*68}px`},role:'table','aria-label':`${modeId} ${history?'match history':'standings'}`},
  teamBanner&&createElement('div',{className:'team-score-banner','aria-label':'Team scores'},createElement('strong',null,modeId==='assault'?'SECTOR SCORE':modeId==='combined-arms'?'ZONE SCORE':'TEAM SCORE'),createElement('span',null,teamName(0),' ',scoreText(teamScores?.[0]??0)),createElement('span',null,teamName(1),' ',scoreText(teamScores?.[1]??0)),source?.winner!==null&&source?.winner!==undefined&&createElement('b',null,teamName(source.winner),' WINS')),
  header,
  rows);
}
