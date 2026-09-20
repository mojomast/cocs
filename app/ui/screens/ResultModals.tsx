'use client';
import {useRef,useState} from 'react';
import {Award,Crosshair,Flag,Shield,Skull,Target,Trophy,Zap} from 'lucide-react';
import {Modal,Panel,Btn,Stats,Tabs,Chip,Meter} from '../primitives';
import type {ScreenProps} from '../contract';
import {LatticeBriefing} from './LatticeGuide';
import {formatNumber} from '../../../game/format-ui.mjs';
import {matchLearningSummary} from '../../../game/result-learning.mjs';
import {leaveNeedsConfirm} from '../../../game/net.mjs';

const MEDAL_ICONS:any={mvp:Trophy,objective:Target,flag:Flag,captures:Flag,accuracy:Crosshair,damage:Zap,flawless:Shield,ratio:Crosshair,deaths:Skull};
const medalIcon=(id:string)=>{const Icon=MEDAL_ICONS[id]||Award;return <Icon size={16}/>;};

export function MedalStrip({awards,player}:any){
 const list=Array.isArray(awards)?awards:[];
 if(!list.length)return <p className="field-note">Play a full match against at least one opponent to collect medals.</p>;
 return <div className="medal-strip" role="list" aria-label="Match medals">
  {list.map((award:any)=><div key={award.id} className={`medal medal--${award.id}${award.name===player?.name?' you':''}`} role="listitem" aria-label={`${award.label}: ${award.name}, ${award.value}`}>
   <span className="medal-icon" aria-hidden="true">{medalIcon(award.id)}</span>
   <span className="medal-main"><small>{award.label}</small><strong>{award.name}</strong></span>
   <em>{award.value}</em>
  </div>)}
 </div>;
}

export function PauseModal({ui}:ScreenProps){
 const {mode,resume,changeMode,pauseQuick,openSettings,display,toggleCaptions,toggleReducedMotion,modalRef,settings}=ui;
 const captionsOn=display?.captions===true;
 const motionReduced=display?.reducedMotion===true;
 // WP2.1: while Settings is stacked on top, this dialog is a lower layer. It
 // stays rendered so closing Settings returns here, but it is inert, hidden
 // from the accessibility tree and cannot claim `aria-modal`.
 const covered=settings===true;
 // I6 / I13 — quick settings + one-tap captions / reduced-motion pills instead
 // of embedding the whole settings form; the full form opens in SettingsDialog.
 const footer=<>
  <button type="button" className="chip pause-toggle" aria-pressed={captionsOn} onClick={toggleCaptions} title="Toggle subtitles / audio captions">CC · {captionsOn?'ON':'OFF'}</button>
  <button type="button" className="chip pause-toggle" aria-pressed={motionReduced} onClick={toggleReducedMotion} title="Toggle reduced motion">MOTION · {motionReduced?'REDUCED':'FULL'}</button>
  <Btn variant="primary" className="modal-foot-primary" onClick={resume}>RESUME MATCH</Btn>
 </>;
 return <Modal open={mode==='paused'} covered={covered} onClose={resume} size="lg" eyebrow="PAUSED" title="Take a breath." panelRef={modalRef} footer={footer}>
  <div className="layout layout--2">
   <Panel label="MATCH">
    <div className="stack">
     <Btn variant="primary" onClick={resume}>RESUME MATCH</Btn>
     <Btn onClick={()=>changeMode('selection')}>RETURN TO LOADOUT</Btn>
     <p className="field-note">The arena will wait for you. Jump pads and boost launchers can extend your launch.</p>
    </div>
   </Panel>
   <Panel label="QUICK SETTINGS">
    <div className="stack">
     {pauseQuick}
     <Btn onClick={e=>openSettings?.('game',e.currentTarget)}>OPEN GRAPHICS &amp; SETTINGS</Btn>
    </div>
   </Panel>
   </div>
   <LatticeBriefing mode={ui.hud?.config?.mode} bindings={ui.bindings} compact/>
  </Modal>;
}

// Post-match summary card: result line, XP/level progress, prestige progress
// and the achievements unlocked this round. Pure view over the page's
// matchSummary composition so the results screen never re-derives career state.
export function MatchSummaryCard({summary}:any){
 if(!summary)return null;
 const resultLabel=summary.result==='win'?'VICTORY':summary.result==='draw'?'DRAW':summary.result==='loss'?'DEFEAT':'MATCH';
 const achievements=Array.isArray(summary.achievements)?summary.achievements:[];
 const nextUnlocks=Array.isArray(summary.nextUnlocks)?summary.nextUnlocks:[];
 return <section className="match-summary" role="group" aria-label="Match summary">
  <div className="match-summary-head">
   <span className={`match-summary-result result-${summary.result||'none'}`}>{resultLabel}</span>
   <span className="match-summary-context">{[summary.modeName,summary.mapName].filter(Boolean).join(' · ').toUpperCase()}</span>
  </div>
  <Stats items={[
   {label:'KILLS',value:summary.kills},
   {label:'DEATHS',value:summary.deaths},
   {label:'K/D',value:formatNumber(summary.kd,2)},
   {label:'TIME',value:`${Math.round(Number(summary.duration)||0)}s`},
   {label:'XP EARNED',value:`+${summary.xp}`},
  ]}/>
  <div className="match-summary-track">
   <div className="row row--between"><span className="label">LEVEL {summary.level}</span><span className="label">{summary.levelUp?'RANK UP':summary.toNext>0?`${summary.toNext} XP TO NEXT`:'MAX LEVEL'}</span></div>
   <Meter ratio={Number(summary.progress)||0}/>
  </div>
  <div className="match-summary-track">
   <div className="row row--between"><span className="label">{summary.prestige>0?`PRESTIGE ${summary.prestige}${summary.prestigeTier?` · ${String(summary.prestigeTier).toUpperCase()}`:''}`:'PRESTIGE'}</span><span className="label">{summary.prestigeMaxed?'MAX PRESTIGE':summary.prestige>0?`${summary.prestigeToNext} XP TO NEXT`:'REACH LEVEL 60'}</span></div>
   <Meter ratio={Number(summary.prestigeProgress)||0}/>
  </div>
  {achievements.length>0&&<div className="stack stack--tight">
   <span className="label">ACHIEVEMENTS UNLOCKED · {achievements.length}</span>
   <div className="achievement-strip" role="list">{achievements.map((a:any)=><div key={a.id} className="achievement-row unlocked" role="listitem"><span className="achievement-icon" aria-hidden="true">★</span><span className="card-main"><span className="card-name">{a.name}<small>{a.description}</small></span></span><span className="label">+{a.xp} XP</span></div>)}</div>
  </div>}
  {nextUnlocks.length>0&&<div className="stack stack--tight">
   <span className="label">NEXT UNLOCKS</span>
   <div className="next-unlock-list" role="list">{nextUnlocks.map((item:any)=><div key={item.id} className="next-unlock-row" role="listitem"><span className="chip chip--accent">LV {item.level}</span><span className="card-main"><span className="card-name">{item.name}<small>{String(item.kind||'').toUpperCase()}</small></span></span></div>)}</div>
  </div>}
 </section>;
}

// F08 — why the match ended, what this player actually contributed and how the
// award was built. Rendered above the career tracks so an objective/support
// player sees their credit before any long-term progression. Every value is a
// pure read of the final snapshot and the award payload; nothing here grants or
// records XP, so repeated visits cannot duplicate credit.
export function LearningSummaryCard({learning}:any){
 const contribution=learning?.contribution,xp=learning?.xp;
 if(!contribution)return null;
 // WP1.5: a spectator has no seat, so the model carries no personal rows and
 // labels its public rows as match totals. The player path is unchanged.
 const spectator=contribution.viewer==='spectator';
 const group=(label:string,rows:any[])=>rows.length?<div className="stack stack--tight">
  <span className="label">{label}</span>
  <Stats items={rows.map((row:any)=>({label:row.label,value:row.value,hint:row.hint||undefined}))}/>
 </div>:null;
 return <section className="stack stack--tight" role="group" aria-label={spectator?'Why the match ended and the public match totals':'Why the match ended and what you contributed'}>
  <div className="row row--between"><span className="eyebrow">WHY IT ENDED</span><span className="label">{String(contribution.kind).toUpperCase()}</span></div>
  <p className="field-note">{contribution.endReason}</p>
  <p className="learning-headline"><b>{contribution.headline}</b></p>
  {group(contribution.personalLabel??'YOUR CONTRIBUTION',contribution.personal)}
  {group(contribution.teamLabel??'TEAM TOTALS',contribution.team)}
  {group('SAVED PROGRESS',contribution.saved)}
  {xp?.available&&<div className="stack stack--tight">
   <span className="label">XP BREAKDOWN</span>
   <Stats items={xp.categories.map((entry:any)=>({label:entry.label,value:String(entry.value).startsWith('-')?entry.value:`+${entry.value}`}))}/>
   <p className="field-note">CATEGORIES SUM TO <b>{xp.totalLabel} XP</b> · the match record grants this award exactly once.</p>
  </div>}
 </section>;
}

// F11 — one focused invitation: a mode-appropriate primary action with its
// map/mode/duration, a deliberate new-loadout option, one attainable challenge
// and an explicit leave-queue/practice path for empty or repeated online
// searches. The plan is a pure read; the page handlers do the starting.
export function NextMatchPanel({plan,onAction}:any){
 if(!plan?.primary)return null;
 return <section className="stack stack--tight" role="group" aria-label="Next match">
  <div className="row row--between"><span className="eyebrow">NEXT MATCH</span><span className="label">{plan.context}</span></div>
  <p className="field-note">{plan.primary.detail}</p>
  <div className="row">
   <Btn variant="primary" onClick={()=>onAction(plan.primary)}>{plan.primary.label}</Btn>
   {plan.options.map((option:any)=><Btn key={option.id} onClick={()=>onAction(option)}>{option.label}</Btn>)}
   {plan.replay&&<Btn onClick={()=>onAction(plan.replay)}>{plan.replay.label}</Btn>}
  </div>
  {plan.queue?.active&&<p className="field-note" role="status">{plan.queue.label} · {plan.queue.detail}</p>}
  {plan.practice&&<p className="field-note">{plan.practice.detail} · <Btn size="sm" onClick={()=>onAction(plan.practice)}>{plan.practice.label}</Btn></p>}
  {plan.challenge&&<p className="field-note">CHALLENGE · {plan.challenge.label} · {plan.challenge.detail}</p>}
 </section>;
}

// WP2.1 — every rendered result action carries a stable id and is routed
// through this one dispatcher, so a label change can never silently reroute a
// control and the footer and the NextMatchPanel can share ids safely.
export const RESULT_ACTION_IDS=['next-mission','resume-checkpoint','retry-campaign','retry-horde','mission-select','return-lobby','ranked-again','practice','change-loadout','watch-replay','leave-server','next-arena','surprise-me','retry-operation','rematch'];

type ResultActionHandlers={[handler:string]:(...args:unknown[])=>unknown};
type ResultAction={id?:string;[field:string]:unknown};
type ResultFooterAction={kind:string;id?:string;label:string;variant?:'primary'|'danger';demoId?:string|null};

export function createResultActionDispatcher(handlers:ResultActionHandlers){
 return (entry:ResultAction|undefined|null)=>{
  if(!entry?.id)return;
  switch(entry.id){
   case 'next-mission':return handlers.startCampaignMission?.(entry.missionId);
   // Resume/retry carry the action's target mission so the page reads the
   // checkpoint banked for that mission (null when there is none).
   case 'resume-checkpoint':
   case 'retry-campaign':return handlers.startSinglePlayer?.('campaign',entry.missionId);
   case 'retry-horde':return handlers.startSinglePlayer?.('horde');
   case 'mission-select':return handlers.changeMode?.('selection');
   case 'return-lobby':return handlers.changeMode?.('lobby');
   case 'ranked-again':handlers.queueRanked?.();return handlers.changeMode?.('lobby');
   case 'practice':
    if(entry.requiresQueueLeave)handlers.cancelQueue?.();
    return handlers.quickStart?.(entry.modeId??'deathmatch',{botCount:Number(entry.botCount)||3,difficulty:entry.difficulty??'normal'});
   case 'change-loadout':return handlers.changeMode?.('selection');
   case 'watch-replay':return handlers.playDemo?.(entry.demoId);
   case 'leave-server':return handlers.disconnectNet?.();
   case 'next-arena':return handlers.nextArena?.();
   case 'surprise-me':return handlers.surpriseMe?.();
   case 'retry-operation':
   case 'rematch':
   default:return handlers.start?.();
  }
 };
}

// WP2.1 — the Results footer owns only the cluster actions the focused Next
// Match invitation does not: online session/lobby state, plus one fallback
// cluster when the page could not build a next-match plan at all. Replay,
// loadout and play-again live in the panel, never in both places.
export function resultFooterDescriptors({connected=false,isHost=false,plan=null,replayDemoId=null}:{connected?:boolean;isHost?:boolean;plan?:{primary?:unknown}|null;replayDemoId?:string|null}):ResultFooterAction[]{
 if(connected){
  const lobby:ResultFooterAction={kind:'action',id:'return-lobby',label:'RETURN TO LOBBY'};
  return isHost
   ?[{...lobby,variant:'primary'},{kind:'action',id:'leave-server',label:'LEAVE SERVER',variant:'danger'}]
   :[{kind:'status',label:'WAITING FOR HOST'},lobby,{kind:'action',id:'leave-server',label:'LEAVE SERVER',variant:'danger'}];
 }
 if(plan?.primary)return [];
 return [
  {kind:'action',id:'rematch',label:'PLAY AGAIN',variant:'primary'},
  {kind:'action',id:'next-arena',label:'NEXT ARENA'},
  {kind:'action',id:'surprise-me',label:'SURPRISE ME'},
  ...(replayDemoId?[{kind:'action',id:'watch-replay',label:'WATCH REPLAY',demoId:replayDemoId}]:[]),
 ];
}

export function ResultsModal({ui}:ScreenProps){
 const {hud,awards,scoreboard,resultTitle,resultDescription,start,nextArena,surpriseMe,playDemo,disconnectNet,changeMode,lastDemo,net,modalRef,mode,reward,matchSummary,campaign,challenges,weeklyChallenges,ranked,rankedQueued,startSinglePlayer,startCampaignMission,queueRanked,cancelQueue,quickStart,getMap,settings}=ui;
 const [tab,setTab]=useState('summary');
 // Destructive leave: a live or rated-unfinished match asks first; a finished
 // round and a casual lobby keep the immediate path.
 const ratedRoom=ranked?.queue==='ranked'||rankedQueued!=null;
 const needsLeaveConfirm=leaveNeedsConfirm({started:net?.started===true,roundOver:net?.roundOver===true,rated:ratedRoom});
 const [confirmLeave,setConfirmLeave]=useState(false);
 // The results panel becomes inert the moment the confirm layer opens, so the
 // exact opener must be captured before the commit (WP2.1 stacking contract).
 const [leaveOpener,setLeaveOpener]=useState<HTMLElement|null>(null);
 const requestLeave=()=>{if(needsLeaveConfirm){setLeaveOpener(typeof document!=='undefined'&&document.activeElement instanceof HTMLElement?document.activeElement:null);setConfirmLeave(true);}else disconnectNet?.();};
 const list=Array.isArray(hud?.actors)?hud.actors:[];
 // WP1.5 viewer model: only a seated player is a viewer. A spectator, or an
 // actorId that names no actor on the board, resolves to null — never to
 // actor 0 via `??0` or to `player` via `||player`.
 const spectating=hud?.spectate===true;
 const declaredId=spectating?null:hud?.actorId;
 const viewerId=declaredId??(hud?.net?null:0);
 const viewerActor=viewerId===null||viewerId===undefined?null:list.find((a:any)=>a&&a.id===viewerId)??null;
 const statItems=viewerActor?[
  {label:'KILLS',value:Number(viewerActor.frags)||0},
  {label:'DEATHS',value:Number(viewerActor.deaths)||0},
  ...(Number.isFinite(Number(viewerActor.shots))?[{label:'SHOTS',value:Number(viewerActor.shots)}]:[]),
  {label:'ROUND TIME',value:Math.round(Number(hud?.time)||0)}
 ]:null;
 const awardCount=Array.isArray(awards)?awards.length:0;
 const awardsNode=Array.isArray(awards)
  ?awards.map((a:any)=><div key={a.id} className={a.name===viewerActor?.name?'you':''}><small>{a.label}</small><strong>{a.name}</strong><em>{a.value}</em></div>)
  :awards;
 const connected=!!net?.connected,isHost=!!net?.isHost;
 // F08/F11 view model: a pure read of the frozen snapshot, the award payload
 // and saved progress. Recomputing on every render cannot grant or duplicate
 // anything because it only formats existing records.
 const learning=matchLearningSummary({
  hud,actor:viewerActor,viewer:viewerActor,mode:hud?.config?.mode,reward,campaign,
  challenges,weeklyChallenges,ranked,rankedQueued,net,
  lastDemo,
  resultSummary:hud&&resultDescription&&viewerActor?resultDescription(hud,viewerActor):null,
  mapNameFor:getMap,
 });
 // F11 actions only call page handlers; the plan never changes rules by
 // itself. A retry keeps the finished rules/map because the page still holds
 // them, a checkpoint resume reads the stored campaign checkpoint, and a
 // practice start leaves any rated queue first.
 const runNextAction=createResultActionDispatcher({start,nextArena,surpriseMe,playDemo,disconnectNet:requestLeave,changeMode,startSinglePlayer,startCampaignMission,queueRanked,cancelQueue,quickStart});
 const rewardStrip=viewerActor&&reward?<div className="reward-strip row" role="group" aria-label="Match rewards">
  <strong className="reward-xp">+{Math.max(0,Number(reward.gained)||0)} XP</strong>
  <Chip tone="accent">LEVEL {Number(reward.level)||1}</Chip>
  {Number(reward.prestige)>0&&<Chip tone="warn">PRESTIGE {Number(reward.prestige)}{reward.prestigeTier?` · ${String(reward.prestigeTier.name).toUpperCase()}`:''}</Chip>}
  <Meter ratio={Number(reward.progress)||0}/>
  <span className="field-note">{reward.prestigeMaxed?'MAX PRESTIGE':Number(reward.toNext)>0?`${Number(reward.toNext)} XP TO LEVEL ${(Number(reward.level)||1)+1}`:`${Number(reward.prestigeToNext)||0} XP TO PRESTIGE ${(Number(reward.prestige)||0)+1}`}</span>
  {Number(reward.achievementXp)>0&&<Chip tone="accent">ACHIEVEMENTS +{Number(reward.achievementXp)} XP</Chip>}
  {reward.nextUnlock?<Chip>NEXT UNLOCK · {reward.nextUnlock.name} · LV {reward.nextUnlock.level}</Chip>:<Chip tone="accent">ALL UNLOCKS CLAIMED</Chip>}
 </div>:null;
 // F11 owns the focused invitation; the footer only carries the cluster actions
 // the panel does not (see resultFooterDescriptors). Every action still routes
 // through the same stable-id dispatcher.
 const footerActions=resultFooterDescriptors({connected,isHost,plan:learning?.next,replayDemoId:lastDemo?.id??null});
 const footer=footerActions.length?<>
  {footerActions.map((action:ResultFooterAction)=>action.kind==='status'
   ?<Chip key={action.label}>{action.label}</Chip>
   :<Btn key={action.id} variant={action.variant} onClick={()=>runNextAction(action)}>{action.label}</Btn>)}
 </>:null;
 // WP1.5: a spectator has no seat, so the modal reports the neutral match
 // reason from the model instead of a seated player's badge/description.
 return <><Modal open={!!hud&&mode==='results'} covered={settings===true||confirmLeave} onClose={()=>changeMode('selection')} size="lg" eyebrow="MATCH COMPLETE" title={hud?resultTitle(hud,viewerActor):undefined} description={hud?(viewerActor?resultDescription(hud,viewerActor):learning?.contribution?.endReason):undefined} panelRef={modalRef} footer={footer}>
  <LearningSummaryCard learning={learning}/>
  <NextMatchPanel plan={learning.next} onAction={runNextAction}/>
  {rewardStrip}
  <Tabs value={tab} onChange={setTab} ariaLabel="Match results" tabs={[{value:'summary',label:'Summary'},{value:'scoreboard',label:'Scoreboard'},{value:'stats',label:'Your stats'},{value:'awards',label:`Awards${awardCount?` · ${awardCount}`:''}`}]}/>
  <div className="stack">
   {tab==='summary'&&viewerActor&&<MatchSummaryCard summary={matchSummary}/>}
   {tab==='scoreboard'&&scoreboard}
   {tab==='stats'&&(statItems?<div className="stack"><Stats items={statItems}/>{Array.isArray(reward?.achievements)&&reward.achievements.length>0&&<div className="stack stack--tight"><span className="label">NEW ACHIEVEMENTS</span><div className="achievement-strip" role="list">{reward.achievements.map((a:any)=><div key={a.id} className="achievement-row unlocked" role="listitem"><span className="achievement-icon" aria-hidden="true">★</span><span className="card-main"><span className="card-name">{a.name}<small>{a.description}</small></span></span><span className="label">+{a.xp} XP</span></div>)}</div></div>}<div className="stack stack--tight"><span className="label">MEDALS EARNED</span><MedalStrip awards={awards} player={viewerActor}/></div></div>:<div className="match-awards">{awardsNode}</div>)}
   {tab==='awards'&&<MedalStrip awards={awards} player={viewerActor}/>}
  </div>
 </Modal>
 <Modal open={confirmLeave} onClose={()=>setConfirmLeave(false)} size="sm" eyebrow="CONFIRM" title="Leave the server?" restoreFocus={leaveOpener} footer={<>
  <Btn onClick={()=>setConfirmLeave(false)}>STAY</Btn>
  <Btn variant="danger" onClick={()=>{setConfirmLeave(false);disconnectNet?.();}}>LEAVE MATCH</Btn>
 </>}>
  <p className="field-note">{net?.started===true&&net?.roundOver!==true?'The round is still running.':ratedRoom?'This rated match is not finished.':''} The server holds your seat briefly after a disconnect, so reconnecting can return you to it.</p>
 </Modal>
 </>;
}
