'use client';
import {useEffect,useRef} from 'react';
import {Modal,Btn,Segmented,Chip} from './primitives';
import {Switch} from '@/components/ui/switch';
import {Slider} from '@/components/ui/slider';
import {GAME_MODES,DIFFICULTIES} from '../../game/config.mjs';
import {MAPS} from '../../game/maps.mjs';
import {DEMO_SETTINGS_LIMITS,ROTATIONS,completeCatalog,demoModeEligible,validateDemoSettings} from '../../game/demo-playlist.mjs';
import {validateDemoSelection} from '../../game/demo-session.mjs';

// Compact Demo Options modal. It owns no state: page.tsx keeps the draft and
// the applied settings in game/demo-session.mjs state and validates again on
// Apply, so a stale/racy modal can never corrupt the running demo. The music,
// ambience, announcer and environment controls reuse the page's existing
// handlers instead of duplicating preferences.
export function DemoOptions({
 open,draft,draftSelection={mode:null,mapId:null},actual=null,legacy=false,dirty=false,error=null,onClose,onDraft,onSelection,onResetDefaults,onApply,onStart,
 music,onMusic,ambience,onAmbience,announcer,onAnnouncer,weather,onWeather,
}:{
 open:boolean;draft:any;draftSelection:any;actual?:any;legacy?:boolean;dirty?:boolean;error?:string|null;
 onClose:()=>void;onDraft:(patch:any)=>void;onSelection:(patch:any)=>void;onResetDefaults:()=>void;onApply:()=>void;onStart:()=>void;
 music:boolean;onMusic:(value:boolean)=>void;ambience:boolean;onAmbience:(value:boolean)=>void;announcer:boolean;onAnnouncer:(value:boolean)=>void;weather:string|null;onWeather:()=>void;
}){
 const panelRef=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  if(!open)return;
  const frame=requestAnimationFrame(()=>panelRef.current?.querySelector<HTMLElement>('button:not(:disabled), select, [data-slot="switch"], [role="slider"]')?.focus());
  return()=>cancelAnimationFrame(frame);
 },[open]);
 const modeOptions=GAME_MODES.filter((mode:any)=>demoModeEligible(mode.id));
 const catalog=completeCatalog({legacy});
 const allowedMaps=new Set<string>(catalog.filter((scenario:any)=>!draftSelection.mode||scenario.mode===draftSelection.mode).flatMap((scenario:any)=>scenario.maps));
 const mapOptions=MAPS.filter((map:any)=>allowedMaps.has(map.id));
 const settingsVerdict=validateDemoSettings(draft);
 const selectionVerdict=validateDemoSelection(draftSelection,{rotation:draft?.rotation,legacy});
 const problems=open?[...settingsVerdict.errors,...selectionVerdict.errors]:[];
 const requestedLabel=selectionLabel(draftSelection);
 const runningLabel=actual?`${actual.modeName||actual.mode||'DEMO'} · ${actual.mapName||actual.mapId||'ARENA'}`:'—';
 const canApply=problems.length===0;
 const numberOrNull=(value:string)=>value===''?null:Number(value);
 return <Modal open={open} onClose={onClose} size="lg" eyebrow="BACK TO DEMO" title="Demo options" description="Tune the attract reel. Apply keeps the current match running unless the mode or map changes; Start always launches the requested scenario." panelRef={panelRef} footer={<>
  <Btn variant="ghost" onClick={onResetDefaults} title="Restore the default rotation, duration and atmosphere">RESET DEFAULTS</Btn>
  <Btn variant="secondary" onClick={onClose}>CANCEL</Btn>
  <Btn variant="secondary" onClick={onApply} disabled={!canApply} title={canApply?'Apply settings; a changed mode/map rebuilds the scenario':'Fix the highlighted problems first'}>APPLY</Btn>
  <Btn variant="primary" onClick={onStart} disabled={!canApply} title={canApply?'Apply and start the requested scenario now':'Fix the highlighted problems first'}>START SCENARIO</Btn>
 </>}>
  <div className="config-grid">
   <div className="config-block">
    <h3>Rotation</h3>
    <Segmented value={draft?.rotation} onChange={(value:string)=>onDraft({rotation:value})} ariaLabel="Demo rotation" options={ROTATIONS.map((rotation:string)=>({value:rotation,label:rotation==='curated'?'Destinations':'Complete'}))}/>
    <div className="config-toggle"><label htmlFor="demo-auto-rotate">Auto-rotate scenarios</label><Switch id="demo-auto-rotate" checked={draft?.autoRotate!==false} onCheckedChange={(value:boolean)=>onDraft({autoRotate:value})}/></div>
    <p className="field-note">{draft?.rotation==='complete'?'Every demo-eligible mode/map pair, coverage-balanced.':'Tour all nine new destinations before revisiting a map, with infantry, objectives, LATTICE and vehicle sports.'}</p>
    <label className="config-field" htmlFor="demo-duration">Scenario duration <output>{Number(draft?.scenarioSeconds)||0}s</output>
     <Slider id="demo-duration" aria-label="Scenario duration in seconds" value={[Number(draft?.scenarioSeconds)||DEMO_SETTINGS_LIMITS.scenarioSeconds.min]} min={DEMO_SETTINGS_LIMITS.scenarioSeconds.min} max={DEMO_SETTINGS_LIMITS.scenarioSeconds.max} step={5} onValueChange={([value]:number[])=>onDraft({scenarioSeconds:value})}/>
    </label>
    <label className="config-field" htmlFor="demo-bots">Bots<select id="demo-bots" aria-label="Demo bot count" value={draft?.botCount===null||draft?.botCount===undefined?'':String(draft.botCount)} onChange={(e:any)=>onDraft({botCount:numberOrNull(e.target.value)})}>
     <option value="">AUTO (scenario default)</option>
     {Array.from({length:DEMO_SETTINGS_LIMITS.botCount.max+1},(_,count)=><option key={count} value={count}>{count}</option>)}
    </select></label>
    <label className="config-field" htmlFor="demo-difficulty">Bot difficulty<select id="demo-difficulty" aria-label="Demo bot difficulty" value={draft?.difficulty??''} onChange={(e:any)=>onDraft({difficulty:e.target.value||null})}>
     <option value="">AUTO (scenario default)</option>
     {DIFFICULTIES.map((difficulty:any)=><option key={difficulty.id} value={difficulty.id}>{difficulty.name}</option>)}
    </select></label>
   </div>
   <div className="config-block">
    <h3>Scenario selection</h3>
    <label className="config-field" htmlFor="demo-mode">Mode<select id="demo-mode" aria-label="Requested demo mode" value={draftSelection?.mode??''} onChange={(e:any)=>{const mode=e.target.value||null;const keepMap=mode&&draftSelection?.mapId&&catalog.some((scenario:any)=>scenario.mode===mode&&scenario.maps.includes(draftSelection.mapId));onSelection({mode,mapId:keepMap?draftSelection.mapId:null});}}>
     <option value="">AUTO (rotation)</option>
     {modeOptions.map((mode:any)=><option key={mode.id} value={mode.id}>{mode.name}</option>)}
    </select></label>
    <label className="config-field" htmlFor="demo-map">Map<select id="demo-map" aria-label="Requested demo map" value={draftSelection?.mapId??''} onChange={(e:any)=>onSelection({mapId:e.target.value||null})}>
     <option value="">AUTO (rotation)</option>
     {mapOptions.map((map:any)=><option key={map.id} value={map.id}>{map.name}</option>)}
    </select></label>
    <p className="field-note">A manual mode or map is held as a rotation pin; RESUME/RELEASE PIN on the dock hands the reel back to automatic coverage.</p>
    <div className="row row--between" style={{marginTop:12}}><span className="label">RUNNING</span><strong>{runningLabel}</strong></div>
    <div className="row row--between"><span className="label">REQUESTED</span><strong>{requestedLabel}</strong>{dirty?<Chip tone="warn">UNSAVED</Chip>:<Chip tone="accent">APPLIED</Chip>}</div>
    <div className="row row--between"><span className="label">HUD</span><span className="field-note">The demo HUD toggle lives on the dock (H).</span></div>
   </div>
   <div className="config-block">
    <h3>Atmosphere</h3>
    <div className="sound-setting"><label htmlFor="demo-music">Music</label><Switch id="demo-music" checked={music} onCheckedChange={onMusic}/></div>
    <div className="sound-setting"><label htmlFor="demo-ambience">Ambience</label><Switch id="demo-ambience" checked={ambience} onCheckedChange={onAmbience}/></div>
    <div className="sound-setting"><label htmlFor="demo-announcer">Announcer</label><Switch id="demo-announcer" checked={announcer} onCheckedChange={onAnnouncer}/></div>
    <div className="sound-setting"><label htmlFor="demo-weather">Environment</label><button type="button" id="demo-weather" className="demo-option" aria-pressed={weather!==null} onClick={onWeather}>{weather?String(weather).toUpperCase():'AUTO'}</button></div>
    <p className="field-note">Mix levels live in the main Graphics &amp; settings dialog; these mirror the dock shortcuts.</p>
   </div>
  </div>
  {problems.length>0?<ul role="alert" style={{margin:'14px 0 0',padding:'10px 14px',listStyle:'none',border:'1px solid #7a4a4a',background:'rgba(122,74,74,.12)',color:'#ffb4b4',font:'12px var(--font-mono)',letterSpacing:'.04em'}}>
   {problems.map((problem:any,index:number)=><li key={`${problem.field}-${index}`}>{problem.field.toUpperCase()}: {problem.message}</li>)}
  </ul>:error?<p role="alert" className="field-note" style={{marginTop:14,color:'#ffb4b4'}}>{error}</p>:null}
 </Modal>;
}

function selectionLabel(selection:any){
 if(!selection?.mode&&!selection?.mapId)return 'AUTO (rotation)';
 const mode=GAME_MODES.find((entry:any)=>entry.id===selection.mode);
 const map=MAPS.find((entry:any)=>entry.id===selection.mapId);
 return `${mode?.name??selection.mode??'AUTO'} · ${map?.name??selection.mapId??'AUTO'}`;
}
