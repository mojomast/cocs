'use client';
import {Film,Pause,Play,RotateCcw,Trash2} from 'lucide-react';
import type {ScreenProps} from '../contract';
import {ActionRail,Banner,Btn,Empty,PageHead,Panel,Shell,TopBar} from '../primitives';

const formatDate=(ts:any)=>new Date(ts||Date.now()).toLocaleString();

function PlaybackDock({info,paused,time,speed,rig,rigs,clock,onPlayPause,onRestart,onSeek,onSpeed,onRig,onNextSubject,onExit}:any){
 return <ActionRail><Panel className="btn-block" label="NOW PLAYING" title={<>{String(info?.modeName||info?.mode||'deathmatch').toUpperCase()} <span>/</span> {info?.mapName||info?.mapId} <span>/</span> {info?.player||'REPLAY'}</>} meta={`${clock(time)} / ${clock(info?.duration||0)}`} bodyClass="stack">
  <div className="row">
   <Btn variant="ghost" aria-label={paused?'Play':'Pause'} onClick={onPlayPause}>{paused?<Play size={18}/>:<Pause size={18}/>}</Btn>
   <Btn variant="ghost" aria-label="Restart demo" onClick={onRestart}><RotateCcw size={17}/></Btn>
   <span className="label">{clock(time)} / {clock(info?.duration||0)}</span>
   <input className="theater-scrub" type="range" min={0} max={Math.max(1,info?.duration||1)} step={.05} value={Math.min(time,info?.duration||0)} aria-label="Seek demo" onChange={e=>onSeek(Number(e.target.value))}/>
   <Btn size="sm" onClick={onSpeed}>{speed}×</Btn>
   <Btn variant="danger" size="sm" onClick={onExit}>EXIT</Btn>
  </div>
  <div className="row">
   {rigs.map((name:string,i:number)=><Btn key={name} size="sm" variant={rig===name?'primary':'secondary'} onClick={()=>onRig(name)}><b>{i+1}</b>{name.toUpperCase()}</Btn>)}
   <Btn size="sm" onClick={onNextSubject}>NEXT SUBJECT</Btn>
  </div>
  <p className="field-note">SPACE play/pause · ←/→ seek · R restart · 1–7 camera · [ ] next subject · ESC exit · drag the timeline to scrub</p>
 </Panel></ActionRail>;
}

export function TheaterScreen({ui}:ScreenProps){
 const {demos=[],demoNotice,demoPlaying,demoPaused,demoTime,demoSpeed,demoRig,demoInfo,playDemo,stopDemo,removeDemo,refreshDemos,setDemoPaused,setDemoTime,setDemoSpeed,setDemoRig,runtime,CAMERA_RIGS=[],getMap,clock,changeMode,headActions}=ui;
 const playPause=()=>{const d=runtime?.current?.demo;if(!d)return;d.paused=!d.paused;d.hudAt=-1;setDemoPaused(d.paused);};
 const restart=()=>{const d=runtime?.current?.demo;if(!d)return;d.time=0;d.lastT=0;d.hudAt=-1;const v=runtime?.current?.view;if(v)v.lastEvent=0;setDemoTime(0);};
 const seek=(t:number)=>{const d=runtime?.current?.demo;if(!d)return;d.time=t;d.lastT=t;d.hudAt=-1;const v=runtime?.current?.view;if(v)v.lastEvent=0;setDemoTime(t);};
 const cycleSpeed=()=>{const d=runtime?.current?.demo;if(!d)return;const order=[.5,1,2];d.speed=order[(order.indexOf(d.speed)+1)%order.length];setDemoSpeed(d.speed);};
 const pickRig=(name:string)=>{const d=runtime?.current?.demo;if(!d)return;d.director.setRig(name);d.director.cut();setDemoRig(name);};
 const nextSubject=()=>{const d=runtime?.current?.demo;if(!d)return;d.director.cycleTarget(d.state,1);d.director.cut();};
 if(demoPlaying)return <Shell bleed rail={<PlaybackDock info={demoInfo} paused={demoPaused} time={demoTime} speed={demoSpeed} rig={demoRig} rigs={CAMERA_RIGS} clock={clock} onPlayPause={playPause} onRestart={restart} onSeek={seek} onSpeed={cycleSpeed} onRig={pickRig} onNextSubject={nextSubject} onExit={()=>stopDemo()}/>}>
  <div className="sr-only" role="status">Now playing {String(demoInfo?.mapName||demoInfo?.mapId||'replay')}</div>
 </Shell>;
 return <Shell head={<TopBar sub="THEATER">{headActions}</TopBar>} rail={<ActionRail>
   <Btn onClick={()=>changeMode('selection')}>BACK</Btn>
   <Btn variant="primary" onClick={()=>refreshDemos()}>REFRESH</Btn>
  </ActionRail>}>
  <div className="stack">
   <PageHead eyebrow="RECORDED MATCHES" title={<>Watch the tape<span>.</span></>} lede="Every solo and network match you finish is recorded automatically. Replay it with cinematic cameras."/>
   {demoNotice&&<Banner>{demoNotice}</Banner>}
   {demos.length===0?<Empty title="No recordings yet">Finish a solo or network match to record one automatically.</Empty>:<div className="grid-cards">
    {demos.map((d:any)=><Panel key={d.id} label={d.network?'NETWORK':'SOLO'} meta={`${Math.round(d.frames||0)} FRAMES`} bodyClass="stack">
     <div className="row">
      <span className="card-icon" style={{color:getMap(d.mapId)?.color||'#83f4d5'}}><Film size={18}/></span>
      <span className="card-main"><span className="card-name">{getMap(d.mapId)?.name||d.mapId}<small>{String(d.modeName||d.mode||'deathmatch').toUpperCase()}</small></span></span>
     </div>
     <p className="field-note">{clock(d.duration||0)} · {formatDate(d.createdAt)}</p>
     <div className="row">
      <Btn variant="primary" size="sm" onClick={()=>playDemo(d.id)}>WATCH</Btn>
      <Btn variant="danger" size="sm" aria-label="Delete recording" onClick={()=>removeDemo(d.id)}><Trash2 size={15}/>DELETE</Btn>
     </div>
    </Panel>)}
   </div>}
  </div>
 </Shell>;
}
