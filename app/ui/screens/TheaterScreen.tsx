'use client';
import {useRef,useState} from 'react';
import {Download,Film,Pause,Play,RotateCcw,Trash2,Upload} from 'lucide-react';
import type {ScreenProps} from '../contract';
import {ActionRail,Banner,Btn,Empty,PageHead,Panel,Shell,TopBar} from '../primitives';
import {filterDemos,sortDemos,demoModes,demoMaps} from '../../../game/demo-store.mjs';

const formatDate=(ts:any)=>new Date(ts||Date.now()).toLocaleString();
const titleCase=(value:any)=>String(value||'').replace(/[-_]+/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase());

function FilterRow({label,value,options,onChange}:any){
 return <label className="config-field" style={{minWidth:150}}><span>{label}</span><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map((option:any)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function PlaybackDock({info,paused,time,speed,rig,rigs,clock,onPlayPause,onRestart,onSeek,onSpeed,onRig,onNextSubject,onExit}:any){
 const highlights=Array.isArray(info?.highlights)?info.highlights:[];
 return <ActionRail><Panel className="btn-block" label="NOW PLAYING" title={<>{String(info?.modeName||info?.mode||'deathmatch').toUpperCase()} <span>/</span> {info?.mapName||info?.mapId} <span>/</span> {info?.player||'REPLAY'}</>} meta={`${clock(time)} / ${clock(info?.duration||0)}`} bodyClass="stack">
  <div className="row">
   <Btn variant="ghost" aria-label={paused?'Play':'Pause'} onClick={onPlayPause}>{paused?<Play size={18}/>:<Pause size={18}/>}</Btn>
   <Btn variant="ghost" aria-label="Restart demo" onClick={onRestart}><RotateCcw size={17}/></Btn>
   <span className="label">{clock(time)} / {clock(info?.duration||0)}</span>
   <input className="theater-scrub" type="range" min={0} max={Math.max(1,info?.duration||1)} step={.05} value={Math.min(time,info?.duration||0)} aria-label="Seek demo" onChange={e=>onSeek(Number(e.target.value))}/>
   <Btn size="sm" onClick={onSpeed}>{speed}×</Btn>
   <Btn variant="danger" size="sm" onClick={onExit}>EXIT</Btn>
  </div>
  {highlights.length>0&&<div className="row theater-highlights" role="group" aria-label="Theater highlights">
   <span className="label">HIGHLIGHTS</span>
   {highlights.map((h:any,i:number)=><Btn key={`${h.time}-${i}`} size="sm" variant="ghost" onClick={()=>onSeek(h.time)} title={h.label}>{clock(h.time)} · {h.label}</Btn>)}
  </div>}
  <div className="row">
   {rigs.map((name:string,i:number)=><Btn key={name} size="sm" variant={rig===name?'primary':'secondary'} onClick={()=>onRig(name)}><b>{i+1}</b>{name.toUpperCase()}</Btn>)}
   <Btn size="sm" onClick={onNextSubject}>NEXT SUBJECT</Btn>
  </div>
  <p className="field-note">SPACE play/pause · ←/→ seek · R restart · 1–7 camera · [ ] next subject · ESC exit · drag the timeline to scrub</p>
 </Panel></ActionRail>;
}

export function TheaterScreen({ui}:ScreenProps){
 const {demos=[],demoNotice,demoPlaying,demoPaused,demoTime,demoSpeed,demoRig,demoInfo,playDemo,stopDemo,removeDemo,refreshDemos,exportDemo,importDemo,setDemoPaused,setDemoTime,setDemoSpeed,setDemoRig,runtime,CAMERA_RIGS=[],getMap,clock,changeMode,headActions}=ui;
 const [modeFilter,setModeFilter]=useState('all');
 const [mapFilter,setMapFilter]=useState('all');
 const [order,setOrder]=useState('newest');
 const fileRef=useRef<HTMLInputElement>(null);
 const pickImport=()=>fileRef.current?.click();
 const onImport=(e:any)=>{const file=e.target.files?.[0];if(file)importDemo?.(file);e.target.value='';};
 const playPause=()=>{const d=runtime?.current?.demo;if(!d)return;d.paused=!d.paused;d.hudAt=-1;setDemoPaused(d.paused);};
 const restart=()=>{const d=runtime?.current?.demo;if(!d)return;d.time=0;d.lastT=0;d.hudAt=-1;const v=runtime?.current?.view;if(v)v.lastEvent=0;setDemoTime(0);};
 const seek=(t:number)=>{const d=runtime?.current?.demo;if(!d)return;d.time=t;d.lastT=t;d.hudAt=-1;const v=runtime?.current?.view;if(v)v.lastEvent=0;setDemoTime(t);};
 const cycleSpeed=()=>{const d=runtime?.current?.demo;if(!d)return;const order=[.5,1,2];d.speed=order[(order.indexOf(d.speed)+1)%order.length];setDemoSpeed(d.speed);};
 const pickRig=(name:string)=>{const d=runtime?.current?.demo;if(!d)return;d.director.setRig(name);d.director.cut();setDemoRig(name);};
 const nextSubject=()=>{const d=runtime?.current?.demo;if(!d)return;d.director.cycleTarget(d.state,1);d.director.cut();};
 if(demoPlaying)return <Shell bleed rail={<PlaybackDock info={demoInfo} paused={demoPaused} time={demoTime} speed={demoSpeed} rig={demoRig} rigs={CAMERA_RIGS} clock={clock} onPlayPause={playPause} onRestart={restart} onSeek={seek} onSpeed={cycleSpeed} onRig={pickRig} onNextSubject={nextSubject} onExit={()=>stopDemo()}/>}>
  <div className="sr-only" role="status">Now playing {String(demoInfo?.mapName||demoInfo?.mapId||'replay')}</div>
 </Shell>;
 const modes=demoModes(demos),maps=demoMaps(demos);
 const visible=sortDemos(filterDemos(demos,{mode:modeFilter,mapId:mapFilter}),order);
 return <Shell head={<TopBar sub="THEATER">{headActions}</TopBar>} rail={<ActionRail>
   <Btn onClick={()=>changeMode('selection')}>BACK</Btn>
   <Btn variant="primary" onClick={()=>refreshDemos()}>REFRESH</Btn>
  </ActionRail>}>
  <div className="stack">
   <PageHead eyebrow="RECORDED MATCHES" title={<>Watch the tape<span>.</span></>} lede="Every solo and network match you finish is recorded automatically. Filter the library, replay it with cinematic cameras, export a replay file or import one, and jump straight to the highlights."/>
   {demoNotice&&<Banner>{demoNotice}</Banner>}
   <div className="toolbar theater-transfer">
    <span className="toolbar-title">REPLAY FILES</span>
    <Btn size="sm" onClick={pickImport}><Upload size={14}/>IMPORT REPLAY</Btn>
    <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import replay file" onChange={onImport}/>
    <span className="field-note">Export downloads a .json replay; import adds one to this device.</span>
   </div>
   <Panel label="LIBRARY FILTERS" meta={`${visible.length} / ${demos.length} SHOWN`} bodyClass="row" className="theater-filters">
    <FilterRow label="Mode" value={modeFilter} onChange={setModeFilter} options={[{value:'all',label:'All modes'},...modes.map((mode:any)=>({value:mode,label:titleCase(mode)}))]}/>
    <FilterRow label="Map" value={mapFilter} onChange={setMapFilter} options={[{value:'all',label:'All maps'},...maps.map((map:any)=>({value:map,label:getMap(map)?.name||titleCase(map)}))]}/>
    <FilterRow label="Sort" value={order} onChange={setOrder} options={[{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'longest',label:'Longest first'},{value:'shortest',label:'Shortest first'}]}/>
   </Panel>
   {demos.length===0?<Empty title="No recordings yet">Finish a solo or network match to record one automatically.</Empty>:visible.length===0?<Empty title="No matching recordings">Try a different mode, map or sort order.</Empty>:<div className="grid-cards">
    {visible.map((d:any)=><Panel key={d.id} label={d.network?'NETWORK':'SOLO'} meta={`${Math.round(d.frames||0)} FRAMES`} bodyClass="stack">
     <div className="row">
      <span className="card-icon" style={{color:getMap(d.mapId)?.color||'#83f4d5'}}><Film size={18}/></span>
      <span className="card-main"><span className="card-name">{getMap(d.mapId)?.name||d.mapId}<small>{String(d.modeName||d.mode||'deathmatch').toUpperCase()}</small></span></span>
     </div>
     <p className="field-note">{clock(d.duration||0)} · {formatDate(d.createdAt)}{d.winner?` · WINNER ${d.winner}${d.score?` (${d.score})`:''}`:d.score?` · ${d.score}`:''}</p>
      <div className="row">
       <Btn variant="primary" size="sm" onClick={()=>playDemo(d.id)}>WATCH</Btn>
       <Btn size="sm" aria-label={`Export replay ${d.id}`} onClick={()=>exportDemo?.(d.id)}><Download size={15}/>EXPORT</Btn>
       <Btn variant="danger" size="sm" aria-label="Delete recording" onClick={()=>removeDemo(d.id)}><Trash2 size={15}/>DELETE</Btn>
      </div>
    </Panel>)}
   </div>}
  </div>
 </Shell>;
}
