'use client';
import type {ScreenProps} from '../contract';
import {MatchConfiguration,PresetsConfiguration} from '../../game-ui/configuration';
import {Modal,Btn,Segmented,SelectCard,Panel} from '../primitives';

export function SetupModal({ui}:ScreenProps){
 const {setupOpen,closeSetup,config,setConfig,mapId,setMapId,selectableMaps=[],start,presets=[],savePreset,loadPreset,deletePreset,selectedMap,ready,error,MapPlan,mapViewBox,modalRef}=ui;
 return <Modal open={!!setupOpen} keepMounted onClose={closeSetup} size="xl" eyebrow="SOLO MATCH" title="Match setup" panelRef={modalRef} footer={<>
  <Btn variant="primary" size="lg" className="modal-foot-primary" onClick={()=>{closeSetup();start();}} disabled={!ready||!!error}>ENTER ARENA <small>START WITH THIS SETUP</small></Btn>
 </>}>
  <div className="layout layout--lead">
   <div className="stack">
    <div className="section-label"><span>ARENA</span><span>{selectedMap?.tag}</span></div>
    <div className="grid-cards">{selectableMaps.map((map:any)=><SelectCard key={map.id} selected={mapId===map.id} onClick={()=>setMapId(map.id)} icon={MapPlan?<MapPlan map={map} viewBox={mapViewBox?.(map)}/>:undefined} name={map.name} tag={map.description} ariaLabel={map.name}/>)}</div>
   </div>
   <div className="stack">
    <MatchConfiguration config={config} excludeModes={['horde','campaign']} onChange={setConfig}/>
    <PresetsConfiguration presets={presets} onSave={savePreset} onLoad={loadPreset} onDelete={deletePreset}/>
   </div>
  </div>
 </Modal>;
}

export function SinglePlayerModal({ui}:ScreenProps){
 const {singleOpen,setSingleOpen,singleSub,setSingleSub,singleMission,setSingleMission,config,setConfig,mapId,setMapId,selectedMap,startSinglePlayer,mapsForMode,missionFor,isMissionUnlocked,CAMPAIGN_MISSIONS=[],getMap,legacyMaps,campaign={},DIFFICULTIES=[],ready,error,singleRef}=ui;
 const campaignName=(sub:string)=>sub==='campaign'&&missionFor?`${missionFor(singleMission)?.name?.toUpperCase()} · ${getMap?.(missionFor(singleMission)?.mapId)?.name?.toUpperCase()}`:`HORDE · ${(selectedMap?.name||'').toUpperCase()}`;
 return <Modal open={!!singleOpen} onClose={()=>setSingleOpen(false)} size="lg" eyebrow="SOLO OPERATION" title="Single player" panelRef={singleRef} footer={<>
  <Btn variant="primary" size="lg" className="modal-foot-primary" onClick={()=>startSinglePlayer()} disabled={!ready||!!error}>DEPLOY <small>{campaignName(singleSub)}</small></Btn>
 </>}>
  <div className="config-block"><h3>Mode</h3>
   <Segmented value={singleSub} onChange={(v:any)=>setSingleSub(v)} ariaLabel="Single-player mode" options={[{value:'horde',label:'Horde'},{value:'campaign',label:'Campaign'}]}/>
  </div>
  {singleSub==='horde'?<div className="config-block"><h3>Horde arena</h3><p>Waves deploy around you; you keep three lives for the whole run. Tune the arena and difficulty, then hold out.</p>
   <label className="config-field">Bot difficulty<select aria-label="Bot difficulty" value={config?.difficulty} onChange={e=>setConfig({...config,difficulty:e.target.value})}>{DIFFICULTIES.map((d:any)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
   <div className="section-label"><span>ARENA</span><span>{selectedMap?.tag}</span></div>
   <div className="grid-cards">{mapsForMode('horde',{legacy:legacyMaps}).map((map:any)=><SelectCard key={map.id} selected={mapId===map.id} onClick={()=>setMapId(map.id)} name={map.name} tag={map.description} ariaLabel={map.name}/>)}</div>
  </div>:<div className="config-block"><h3>Campaign mission</h3>
   <div className="grid-cards">{CAMPAIGN_MISSIONS.map((mission:any,i:number)=>{const unlocked=i===0||isMissionUnlocked(campaign,mission.id),done=Boolean(campaign.completed?.[mission.id]);return <SelectCard key={mission.id} selected={singleMission===mission.id} disabled={!unlocked} onClick={unlocked?()=>setSingleMission(mission.id):undefined} name={`${mission.name}${done?' ✓':''}`} meta={mission.chapter} tag={unlocked?mission.brief:'Complete the previous mission to unlock.'} ariaLabel={mission.name}/>;})}</div>
   {(()=>{const mission=missionFor(singleMission);return <Panel label={`${mission.chapter} / ${mission.tag}`}>
    {mission.intro&&<ul className="mission-story">{mission.intro.lines.map((line:string,j:number)=><li key={j}><b>{mission.intro.speaker}</b>{line}</li>)}</ul>}
    <ol className="mission-objectives">{mission.steps.map((step:any)=><li key={step.id}>{step.text}</li>)}</ol>
   </Panel>;})()}
  </div>}
 </Modal>;
}

export function OnboardingModal({ui}:ScreenProps){
 const {onboarding,setOnboarding,finishOnboarding,ONBOARDING_STEPS=[]}=ui;
 if(onboarding===null||onboarding===undefined)return null;
 const step=ONBOARDING_STEPS[onboarding];
 return <Modal open size="sm" onClose={finishOnboarding} eyebrow={`WELCOME · ${onboarding+1}/${ONBOARDING_STEPS.length}`} title={step?.title} footer={<>
  {onboarding>0&&<Btn variant="secondary" onClick={()=>setOnboarding(onboarding-1)}>BACK</Btn>}
  <Btn variant="primary" className="modal-foot-primary" onClick={()=>onboarding+1>=ONBOARDING_STEPS.length?finishOnboarding():setOnboarding(onboarding+1)}>{onboarding+1>=ONBOARDING_STEPS.length?'GOT IT':'NEXT'}</Btn>
  <Btn variant="ghost" onClick={finishOnboarding}>SKIP</Btn>
 </>}>
  <p>{step?.detail}</p>
 </Modal>;
}
