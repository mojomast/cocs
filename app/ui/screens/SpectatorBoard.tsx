'use client';
import {useId,useState} from 'react';

type SpectatorActor={id:number|string;name:string;health:number;current?:boolean;juggernaut?:boolean;points?:number;frags?:number;deaths?:number;armor?:number};
type SpectatorGroup={key:string;label:string;score?:number|null;lives?:number|null;players:SpectatorActor[]};
type SpectatorBoardProps={
 groups?:SpectatorGroup[];
 objective?:{title?:string;line?:string}|null;
 onFollow?:(id:number|string)=>void;
 camera?:string;
 cameraModes?:Record<string,string>;
 onCamera?:(mode:string)=>void;
 controls?:string;
};
const whole=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value):0;

// One bounded roster and one detail panel, rather than a card per actor.
export function SpectatorBoard({groups=[],objective,onFollow,camera,cameraModes,onCamera,controls}:SpectatorBoardProps){
 const [collapsed,setCollapsed]=useState(false);
 const rosterId=useId();
 const actors=groups.flatMap(group=>group.players);
 const followed=actors.find(actor=>actor.current);
 const followedGroup=groups.find(group=>group.players.some(actor=>actor.current));
 const alive=actors.filter(actor=>actor.health>0);
 const cycle=(step:number)=>{
  if(!alive.length)return;
  const index=alive.findIndex(actor=>actor.current);
  onFollow?.(alive[index<0?(step>0?0:alive.length-1):(index+step+alive.length)%alive.length].id);
 };
 return <div className={`spectator-board spectator-compact${collapsed?' is-collapsed':''}`} role="group" aria-label="Spectator targets">
  <div className="spectator-heading"><span>ROSTER <small>{alive.length}/{actors.length} ALIVE</small></span><button type="button" aria-expanded={!collapsed} aria-controls={rosterId} onClick={()=>setCollapsed(value=>!value)}>{collapsed?'Show':'Hide'}</button></div>
  <div className="spectator-followed">
   <span className="spectator-followed-label">{camera==='free'?'SELECTED · FREE CAMERA':followed?'FOLLOWING':'SPECTATING'}</span>
   {followed?<><strong title={followed.name}>{followed.juggernaut&&<i className="spectator-crown" aria-hidden="true">♛</i>}{followed.name}</strong><span className="spectator-followed-stats">{followedGroup?.label} · {followed.health>0?`${whole(followed.health)} HP`:'DOWN'}{followed.armor!==undefined&&` · ${whole(followed.armor)} ARMOR`}<br/>{whole(followed.frags)} K / {whole(followed.deaths)} D{(followed.juggernaut||!!followed.points)&&` · ${whole(followed.points)} CROWN PTS`}</span></>:<span className="spectator-followed-stats">{actors.length?'Choose a live actor to follow.':'Waiting for actors…'}</span>}
   <div className="spectator-follow-actions"><button type="button" aria-label="Follow previous live actor" disabled={!alive.length} onClick={()=>cycle(-1)}>‹ Prev</button><button type="button" aria-label="Follow next live actor" disabled={!alive.length} onClick={()=>cycle(1)}>Next ›</button></div>
  </div>
  <div id={rosterId} className="spectator-targets" hidden={collapsed}>
   {groups.map(group=><section key={group.key} className="spectator-group" aria-label={group.label}>
    <div className="spectator-group-label"><span>{group.label}</span><small>{group.players.filter(actor=>actor.health>0).length}/{group.players.length} ALIVE</small>{group.score!=null&&<b title="Team score">{whole(group.score)} PTS</b>}{group.lives!=null&&<em>{whole(group.lives)} LIVES</em>}</div>
    <div className="spectator-roster-labels" aria-hidden="true"><span>ACTOR</span><span>HP</span><span>K</span></div>
    <div className="spectator-group-players">{group.players.map(actor=><button type="button" key={actor.id} className={`spectator-row${actor.current?' current':''}${actor.health>0?'':' is-down'}`} disabled={actor.health<=0} aria-pressed={!!actor.current} aria-label={`Follow ${actor.name}${actor.current?' (current)':''}${actor.juggernaut?' · crown holder':''}`} title={`${actor.name} · ${actor.health>0?`${whole(actor.health)} HP`:'Down'} · ${whole(actor.frags)} kills`} onClick={()=>onFollow?.(actor.id)}>
     <span className="spectator-actor-name">{actor.current&&<i aria-hidden="true">▸</i>}{actor.juggernaut&&<i className="spectator-crown" aria-hidden="true">♛</i>}{actor.name}</span><span className="spectator-actor-health">{actor.health>0?whole(actor.health):'DOWN'}</span><span className="spectator-actor-score">{whole(actor.frags)}</span>
    </button>)}</div>
   </section>)}
  </div>
  {(cameraModes||objective||controls)&&<div className="spectator-footer">
   <details className="spectator-help"><summary>{cameraModes?`${cameraModes[camera??'auto']??'Camera'} · controls`:'Objective & controls'}</summary>
    {cameraModes&&<label className="spectator-camera">CAMERA<select aria-label="Spectator camera" value={camera??'auto'} onChange={event=>onCamera?.(event.target.value)}>{Object.entries(cameraModes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
    {objective&&<p className="spectator-objective"><b>{objective.title}</b><span>{objective.line}</span></p>}{controls&&<p className="spectator-controls">{controls}</p>}
   </details>
  </div>}
 </div>;
}
