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
 return {position:row?.position??'-',total:race?.standings?.length??8,lap:Math.min(laps,row?.lap??1),laps,checkpoint:row?row.nextGate+1:1,gates:race?.gates?.length??0,time:raceTime(row?.finishTime??race?.elapsed??0),item:raceItemLabel(row?.item),coins:Number(row?.coins)||0,countdown:race?.phase==='countdown'?String(Math.max(1,Math.ceil(race.countdown))):race?.phase==='finished'?'FINISHED':race?.elapsed<1?'GO!':'',effects:Object.entries(row?.effects??{}).filter(([,v])=>v>0).map(([key,v])=>`${raceItemLabel(key)} ${v.toFixed(1)}s`).join(' / ')};
}
export function raceResult(snapshot,actorId=0){
 const winner=snapshot?.race?.winnerId,rows=raceStandings(snapshot);
 return winner==null?'RACE COMPLETE.':winner===actorId?'YOU WIN THE RACE.':`${rows.find(row=>row.actorId===winner)?.name??'RACER'} WINS.`;
}
