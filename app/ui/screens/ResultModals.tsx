'use client';
import {useState} from 'react';
import {Modal,Panel,Btn,Stats,Tabs,Chip,Meter} from '../primitives';
import type {ScreenProps} from '../contract';

export function PauseModal({ui}:ScreenProps){
 const {mode,resume,changeMode,prefs,modalRef}=ui;
 return <Modal open={mode==='paused'} onClose={resume} size="lg" eyebrow="PAUSED" title="Take a breath." panelRef={modalRef} footer={<Btn variant="primary" onClick={resume}>RESUME MATCH</Btn>}>
  <div className="layout layout--2">
   <Panel label="MATCH">
    <div className="stack">
     <Btn variant="primary" onClick={resume}>RESUME MATCH</Btn>
     <Btn onClick={()=>changeMode('selection')}>RETURN TO LOADOUT</Btn>
     <p className="field-note">The arena will wait for you. Jump pads and boost launchers can extend your launch.</p>
    </div>
   </Panel>
   <Panel label="SETTINGS">{prefs}</Panel>
  </div>
 </Modal>;
}

export function ResultsModal({ui}:ScreenProps){
 const {hud,awards,scoreboard,resultTitle,resultDescription,start,nextArena,surpriseMe,playDemo,disconnectNet,changeMode,lastDemo,net,modalRef,player,mode,reward}=ui;
 const [tab,setTab]=useState('scoreboard');
 const list=Array.isArray(hud?.actors)?hud.actors:[];
 const localActor=list.find((a:any)=>a&&a.id===(hud?.actorId??0))||player;
 const statItems=localActor?[
  {label:'KILLS',value:Number(localActor.frags)||0},
  {label:'DEATHS',value:Number(localActor.deaths)||0},
  ...(Number.isFinite(Number(localActor.shots))?[{label:'SHOTS',value:Number(localActor.shots)}]:[]),
  {label:'ROUND TIME',value:Math.round(Number(hud?.time)||0)}
 ]:null;
 const awardsNode=Array.isArray(awards)
  ?awards.map((a:any)=><div key={a.id} className={a.name===player?.name?'you':''}><small>{a.label}</small><strong>{a.name}</strong><em>{a.value}</em></div>)
  :awards;
 const connected=!!net?.connected,isHost=!!net?.isHost;
 const rewardStrip=reward?<div className="reward-strip row" role="group" aria-label="Match rewards">
  <strong className="reward-xp">+{Math.max(0,Number(reward.gained)||0)} XP</strong>
  <Chip tone="accent">LEVEL {Number(reward.level)||1}</Chip>
  <Meter ratio={Number(reward.progress)||0}/>
  <span className="field-note">{Number(reward.toNext)>0?`${Number(reward.toNext)} XP TO LEVEL ${(Number(reward.level)||1)+1}`:'MAX LEVEL'}</span>
  {reward.nextUnlock?<Chip>NEXT UNLOCK · {reward.nextUnlock.name} · LV {reward.nextUnlock.level}</Chip>:<Chip tone="accent">ALL UNLOCKS CLAIMED</Chip>}
 </div>:null;
 const footer=<>
  {connected&&!isHost?<Chip>WAITING FOR HOST</Chip>:<Btn variant="primary" onClick={()=>start()}>PLAY AGAIN</Btn>}
  <Btn onClick={nextArena}>NEXT ARENA</Btn>
  {surpriseMe&&<Btn onClick={surpriseMe}>SURPRISE ME</Btn>}
  {lastDemo&&playDemo&&<Btn onClick={()=>playDemo(lastDemo.id)}>WATCH REPLAY</Btn>}
  <Btn onClick={()=>changeMode('selection')}>CHANGE LOADOUT</Btn>
  {connected&&<Btn variant="danger" onClick={disconnectNet}>LEAVE SERVER</Btn>}
 </>;
 return <Modal open={!!hud&&mode==='results'} onClose={()=>changeMode('selection')} size="lg" eyebrow="MATCH COMPLETE" title={hud?resultTitle(hud,player):undefined} description={hud?resultDescription(hud,player):undefined} panelRef={modalRef} footer={footer}>
  {rewardStrip}
  <Tabs value={tab} onChange={setTab} ariaLabel="Match results" tabs={[{value:'scoreboard',label:'Scoreboard'},{value:'stats',label:'Your stats'},{value:'awards',label:'Awards'}]}/>
  <div className="stack">
   {tab==='scoreboard'&&scoreboard}
   {tab==='stats'&&(statItems?<Stats items={statItems}/>:<div className="match-awards">{awardsNode}</div>)}
   {tab==='awards'&&<div className="match-awards">{awardsNode}</div>}
  </div>
 </Modal>;
}
