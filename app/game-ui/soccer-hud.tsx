'use client';
import {raceTime} from '../../game/race-ui.mjs';

const teamLabel=(team:any)=>Number(team)===0?'RED':Number(team)===1?'BLUE':team===undefined||team===null?'FREE':`TEAM ${team}`;
const phaseLabel=(phase:any)=>phase==='kickoff'?'KICKOFF':phase==='over'?'FULL TIME':'LIVE';

export function SoccerHud({soccer,state,actorId=0,touchControls=false,controls=''}:{soccer?:any;state?:any;actorId?:number;touchControls?:boolean;controls?:string}){
 const live=state??soccer?.race??soccer??{},scores=live.scores??{},standings=live.standings??[],row=standings.find((entry:any)=>entry.actorId===actorId);
 const phase=live.phase,elapsed=Number(live.elapsed)||0,goalLimit=Number(live.goalLimit)||0;
 const team=Number.isFinite(row?.team)?row.team:Number.isFinite(live.team)?live.team:null;
 const goals=Number(row?.goals??live.goals)||0;
 const countdown=phase==='kickoff'?String(Math.max(1,Math.ceil(Number(live.countdown)||0))):phase==='over'?'FULL TIME':elapsed<1?'GO!':'';
 const clock=soccer?.time??soccer?.clock??raceTime(elapsed);
 return <div className="race-hud soccer-hud" aria-label="Live soccer status"><div className="race-metrics"><div className="race-score"><small>RED</small><strong>{Number(scores[0])||0}</strong></div><div className="race-score"><small>BLUE</small><strong>{Number(scores[1])||0}</strong></div><div><small>MATCH TIME</small><strong>{clock}</strong></div><div className="race-coins"><small>GOAL LIMIT</small><strong>{goalLimit}</strong></div></div>{countdown&&<div className="race-countdown" role="status" aria-live="polite">{countdown}</div>}<div className="race-item"><small>YOUR SIDE</small><strong>{teamLabel(team)}</strong><span>{goals} GOAL{goals===1?'':'S'} · {phaseLabel(phase)}</span></div><p className="race-help">{touchControls?'Left stick throttle / steer. Push fully for boost.':controls}<br/>TAB standings / ESC pause</p></div>;
}
