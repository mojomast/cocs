'use client';
import {useState} from 'react';
import {Award,Crosshair,Flag,Shield,Skull,Target,Trophy,Zap} from 'lucide-react';
import {Modal,Panel,Btn,Stats,Tabs,Chip,Meter} from '../primitives';
import type {ScreenProps} from '../contract';
import {LatticeBriefing} from './LatticeGuide';

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
 const {mode,resume,changeMode,pauseQuick,openSettings,display,toggleCaptions,toggleReducedMotion,modalRef}=ui;
 const captionsOn=display?.captions===true;
 const motionReduced=display?.reducedMotion===true;
 // I6 / I13 — quick settings + one-tap captions / reduced-motion pills instead
 // of embedding the whole settings form; the full form opens in SettingsDialog.
 const footer=<>
  <button type="button" className="chip pause-toggle" aria-pressed={captionsOn} onClick={toggleCaptions} title="Toggle subtitles / audio captions">CC · {captionsOn?'ON':'OFF'}</button>
  <button type="button" className="chip pause-toggle" aria-pressed={motionReduced} onClick={toggleReducedMotion} title="Toggle reduced motion">MOTION · {motionReduced?'REDUCED':'FULL'}</button>
  <Btn variant="primary" className="modal-foot-primary" onClick={resume}>RESUME MATCH</Btn>
 </>;
 return <Modal open={mode==='paused'} onClose={resume} size="lg" eyebrow="PAUSED" title="Take a breath." panelRef={modalRef} footer={footer}>
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
     <Btn onClick={()=>openSettings?.('game')}>OPEN GRAPHICS &amp; SETTINGS</Btn>
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
 return <section className="match-summary" role="group" aria-label="Match summary">
  <div className="match-summary-head">
   <span className={`match-summary-result result-${summary.result||'none'}`}>{resultLabel}</span>
   <span className="match-summary-context">{[summary.modeName,summary.mapName].filter(Boolean).join(' · ').toUpperCase()}</span>
  </div>
  <Stats items={[
   {label:'KILLS',value:summary.kills},
   {label:'DEATHS',value:summary.deaths},
   {label:'K/D',value:Number(summary.kd||0).toFixed(2)},
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
 </section>;
}

export function ResultsModal({ui}:ScreenProps){
 const {hud,awards,scoreboard,resultTitle,resultDescription,start,nextArena,surpriseMe,playDemo,disconnectNet,changeMode,lastDemo,net,modalRef,player,mode,reward,matchSummary}=ui;
 const [tab,setTab]=useState('summary');
 const list=Array.isArray(hud?.actors)?hud.actors:[];
 const localActor=list.find((a:any)=>a&&a.id===(hud?.actorId??0))||player;
 const statItems=localActor?[
  {label:'KILLS',value:Number(localActor.frags)||0},
  {label:'DEATHS',value:Number(localActor.deaths)||0},
  ...(Number.isFinite(Number(localActor.shots))?[{label:'SHOTS',value:Number(localActor.shots)}]:[]),
  {label:'ROUND TIME',value:Math.round(Number(hud?.time)||0)}
 ]:null;
 const awardCount=Array.isArray(awards)?awards.length:0;
 const awardsNode=Array.isArray(awards)
  ?awards.map((a:any)=><div key={a.id} className={a.name===player?.name?'you':''}><small>{a.label}</small><strong>{a.name}</strong><em>{a.value}</em></div>)
  :awards;
 const connected=!!net?.connected,isHost=!!net?.isHost;
 const rewardStrip=reward?<div className="reward-strip row" role="group" aria-label="Match rewards">
  <strong className="reward-xp">+{Math.max(0,Number(reward.gained)||0)} XP</strong>
  <Chip tone="accent">LEVEL {Number(reward.level)||1}</Chip>
  {Number(reward.prestige)>0&&<Chip tone="warn">PRESTIGE {Number(reward.prestige)}{reward.prestigeTier?` · ${String(reward.prestigeTier.name).toUpperCase()}`:''}</Chip>}
  <Meter ratio={Number(reward.progress)||0}/>
  <span className="field-note">{reward.prestigeMaxed?'MAX PRESTIGE':Number(reward.toNext)>0?`${Number(reward.toNext)} XP TO LEVEL ${(Number(reward.level)||1)+1}`:`${Number(reward.prestigeToNext)||0} XP TO PRESTIGE ${(Number(reward.prestige)||0)+1}`}</span>
  {Number(reward.achievementXp)>0&&<Chip tone="accent">ACHIEVEMENTS +{Number(reward.achievementXp)} XP</Chip>}
  {reward.nextUnlock?<Chip>NEXT UNLOCK · {reward.nextUnlock.name} · LV {reward.nextUnlock.level}</Chip>:<Chip tone="accent">ALL UNLOCKS CLAIMED</Chip>}
 </div>:null;
 const footer=<>
  {connected?<>
   {isHost&&<Btn variant="primary" onClick={()=>changeMode('lobby')}>RETURN TO LOBBY</Btn>}
   {!isHost&&<Chip>WAITING FOR HOST</Chip>}
   {!isHost&&<Btn onClick={()=>changeMode('lobby')}>RETURN TO LOBBY</Btn>}
  </>:<>
   <Btn variant="primary" onClick={()=>start()}>PLAY AGAIN</Btn>
   <Btn onClick={nextArena}>NEXT ARENA</Btn>
  </>}
  {surpriseMe&&<Btn onClick={surpriseMe}>SURPRISE ME</Btn>}
  {lastDemo&&playDemo&&<Btn onClick={()=>playDemo(lastDemo.id)}>WATCH REPLAY</Btn>}
  <Btn onClick={()=>connected?disconnectNet():changeMode('selection')}>CHANGE LOADOUT</Btn>
  {connected&&<Btn variant="danger" onClick={disconnectNet}>LEAVE SERVER</Btn>}
 </>;
 return <Modal open={!!hud&&mode==='results'} onClose={()=>changeMode('selection')} size="lg" eyebrow="MATCH COMPLETE" title={hud?resultTitle(hud,player):undefined} description={hud?resultDescription(hud,player):undefined} panelRef={modalRef} footer={footer}>
  {rewardStrip}
  <Tabs value={tab} onChange={setTab} ariaLabel="Match results" tabs={[{value:'summary',label:'Summary'},{value:'scoreboard',label:'Scoreboard'},{value:'stats',label:'Your stats'},{value:'awards',label:`Awards${awardCount?` · ${awardCount}`:''}`}]}/>
  <div className="stack">
   {tab==='summary'&&<MatchSummaryCard summary={matchSummary}/>}
   {tab==='scoreboard'&&scoreboard}
   {tab==='stats'&&(statItems?<div className="stack"><Stats items={statItems}/>{Array.isArray(reward?.achievements)&&reward.achievements.length>0&&<div className="stack stack--tight"><span className="label">NEW ACHIEVEMENTS</span><div className="achievement-strip" role="list">{reward.achievements.map((a:any)=><div key={a.id} className="achievement-row unlocked" role="listitem"><span className="achievement-icon" aria-hidden="true">★</span><span className="card-main"><span className="card-name">{a.name}<small>{a.description}</small></span></span><span className="label">+{a.xp} XP</span></div>)}</div></div>}<div className="stack stack--tight"><span className="label">MEDALS EARNED</span><MedalStrip awards={awards} player={player}/></div></div>:<div className="match-awards">{awardsNode}</div>)}
   {tab==='awards'&&<MedalStrip awards={awards} player={player}/>}
  </div>
 </Modal>;
}
