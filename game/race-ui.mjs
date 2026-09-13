import {teamPresentation} from './team-presentation.mjs';
const ITEM_LABELS={turbo:'TURBO',shield:'SHIELD',oil:'OIL SLICK',pulse:'HOMING PULSE',mine:'MINE',triple:'TRIPLE PULSE',bolt:'LIGHTNING',star:'STAR'};
export function raceItemLabel(id){
 if(id===undefined||id===null||id==='')return 'NO ITEM';
 const key=String(id).toLowerCase();
 return ITEM_LABELS[key]??String(id).toUpperCase();
}
export function raceTime(seconds){
 const ticks=Math.floor(Math.max(0,Number(seconds)||0)*100);
 return `${String(Math.floor(ticks/6000)).padStart(2,'0')}:${String(Math.floor(ticks/100)%60).padStart(2,'0')}.${String(ticks%100).padStart(2,'0')}`;
}
export function raceStandings(snapshot){
 return [...(snapshot?.race?.standings??[])].sort((a,b)=>a.position-b.position).map(row=>({...row,name:snapshot?.actors?.find(a=>a.id===row.actorId)?.name??snapshot?.players?.find(a=>a.actorId===row.actorId)?.name??`Racer ${row.position}`}));
}
export function raceDisplay(snapshot,actorId=0){
 const race=snapshot?.race,row=race?.standings?.find(a=>a.actorId===actorId),laps=race?.laps??snapshot?.config?.fragLimit??3;
 return {position:row?.position??'-',total:race?.standings?.length??8,lap:Math.min(laps,row?.lap??1),laps,checkpoint:row&&Number.isFinite(row.nextGate)?row.nextGate+1:1,gates:race?.gates?.length??0,time:raceTime(row?.finishTime??race?.elapsed??0),item:raceItemLabel(row?.item),coins:Number(row?.coins)||0,countdown:race?.phase==='countdown'?String(Math.max(1,Math.ceil(race.countdown))):race?.phase==='finished'?'FINISHED':race?.elapsed<1?'GO!':'',effects:Object.entries(row?.effects??{}).filter(([,v])=>v>0).map(([key,v])=>`${raceItemLabel(key)} ${v.toFixed(1)}s`).join(' / ')};
}
export function raceResult(snapshot,actorId=0){
 const winner=snapshot?.race?.winnerId,rows=raceStandings(snapshot);
 return winner==null?'RACE COMPLETE.':winner===actorId?'YOU WIN THE RACE.':`${rows.find(row=>row.actorId===winner)?.name??'RACER'} WINS.`;
}
const soccerTeamName=team=>teamPresentation(team)?.key?.toUpperCase()??`TEAM ${team}`;
function soccerState(snapshot){const race=snapshot?.race;if(race?.kind==='soccer')return race;return snapshot?.kind==='soccer'?snapshot:null;}
function soccerScores(race){const raw=race?.scores??{};return {0:Number(raw[0]??raw['0'])||0,1:Number(raw[1]??raw['1'])||0};}
function soccerTeam(race,actorId){const row=(race?.standings??[]).find(r=>r.actorId===actorId);if(Number.isFinite(row?.team))return row.team;return Number.isFinite(race?.team)?race.team:0;}
export function soccerDisplay(snapshot,actorId=0){
 const race=soccerState(snapshot),scores=soccerScores(race),phase=race?.phase??'idle',elapsed=Number(race?.elapsed)||0;
 const countdown=phase==='kickoff'?String(Math.max(1,Math.ceil(Number(race?.countdown)||0))):phase==='over'?'FULL TIME':elapsed<1?'GO!':'';
 return {phase,countdown,time:raceTime(race?.elapsed??0),scores,team:soccerTeam(race,actorId),winner:race?.winnerTeam??null,goalLimit:Number(race?.goalLimit)||0,ballInPlay:phase==='playing'};
}
export function soccerResult(snapshot,actorId=0){
 const race=soccerState(snapshot),scores=soccerScores(race),winner=race?.winnerTeam;
 if(winner===null||winner===undefined)return `DRAW ${scores[0]}\u2013${scores[1]}.`;
 const own=soccerTeam(race,actorId),other=winner===0?1:0;
 return winner===own?`YOU WIN ${scores[winner]}\u2013${scores[other]}.`:`${soccerTeamName(winner)} WINS ${scores[winner]}\u2013${scores[other]}.`;
}
