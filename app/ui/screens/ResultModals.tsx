'use client';
import {useState} from 'react';
import {Award,Crosshair,Flag,Shield,Skull,Target,Trophy,Zap} from 'lucide-react';
import {Modal,Panel,Btn,Stats,Tabs,Chip,Meter} from '../primitives';
import type {ScreenProps} from '../contract';

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
 const awardCount=Array.isArray(awards)?awards.length:0;
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
  <Tabs value={tab} onChange={setTab} ariaLabel="Match results" tabs={[{value:'scoreboard',label:'Scoreboard'},{value:'stats',label:'Your stats'},{value:'awards',label:`Awards${awardCount?` · ${awardCount}`:''}`}]}/>
  <div className="stack">
   {tab==='scoreboard'&&scoreboard}
   {tab==='stats'&&(statItems?<div className="stack"><Stats items={statItems}/><div className="stack stack--tight"><span className="label">MEDALS EARNED</span><MedalStrip awards={awards} player={player}/></div></div>:<div className="match-awards">{awardsNode}</div>)}
   {tab==='awards'&&<MedalStrip awards={awards} player={player}/>}
  </div>
 </Modal>;
}
