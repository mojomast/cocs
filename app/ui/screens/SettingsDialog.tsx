'use client';
import {useState} from 'react';
import {LockKeyhole,Shield,Swords} from 'lucide-react';
import type {ScreenProps} from '../contract';
import {Modal,Btn,Tabs,Panel,Chip,Empty} from '../primitives';
import {HELP_SECTIONS} from '../../../game/onboarding.mjs';
import {altSpecFor} from '../../../game/alt-fire.mjs';
import {formatNumber,formatWhole} from '../../../game/format-ui.mjs';
import {GraphicsLabPanel} from './GraphicsLabPanel';

type HelpSection={id:string;title:string;summary?:string;items?:readonly string[]};

export function HelpSections({sections=HELP_SECTIONS}:{sections?:readonly HelpSection[]}){
 if(!sections.length)return <p className="field-note">No help topics loaded.</p>;
 return <div className="help-sections">
  {sections.map(section=><Panel key={section.id} label={section.title} meta={section.summary}>
   <ul className="help-list">{section.items?.map((item:string,i:number)=><li key={i}>{item}</li>)}</ul>
  </Panel>)}
 </div>;
}

const levelOf=(item:any)=>Math.max(1,Math.round(Number(item?.level)||1));
const locked=(level:number,item:any)=>levelOf(item)>level;

// Read-only viewer over the same weapon/operator/attachment data the match uses.
// Unlock state mirrors the progression level gates so the menu cannot drift from
// the loadout screen.
export function ArsenalInspector({WEAPONS=[],CHARACTERS=[],ATTACHMENTS=[],ATTACHMENT_SLOTS=[],GEAR=[],GEAR_SLOTS=[],WEAPON_FINISHES=[],CROSSHAIR_STYLES=[],profile,weaponRangeLabel}:any){
 const [tab,setTab]=useState('weapons');
 const level=Number(profile?.level)||1;
 const count=(items:any[])=>items.filter(item=>!locked(level,item)).length;
 const inventory=[...WEAPONS,...CHARACTERS,...ATTACHMENTS,...GEAR,...WEAPON_FINISHES,...CROSSHAIR_STYLES];
 const total=inventory.length,claimed=count(inventory);
 const subtabs=[{value:'weapons',label:'Weapons'},{value:'operators',label:'Operators'},{value:'attachments',label:'Attachments'},{value:'cosmetics',label:'Cosmetics'}];
 return <div className="stack arsenal-inspector">
  <div className="row row--between arsenal-summary">
   <span className="label">OPERATOR LEVEL {level}</span>
   <span className="row" style={{gap:8}}><Chip tone="accent"><i/>{claimed} / {total} UNLOCKED</Chip><Chip>{CHARACTERS.length} OPERATORS · {WEAPONS.length} WEAPONS</Chip></span>
  </div>
  <Tabs value={tab} onChange={setTab} ariaLabel="Arsenal category" tabs={subtabs}/>
  {tab==='weapons'&&<div className="grid-cards">{WEAPONS.map((weapon:any,index:number)=>{const alt=altSpecFor(index);return <Panel key={weapon.name} label={`${index+1} / WEAPON`} meta={weapon.short||''}>
   <h3 style={{color:weapon.color}}>{weapon.name}</h3>
   <div className="row" style={{gap:6}}><Chip>{weaponRangeLabel?.(weapon)}</Chip><Chip>{Math.round(Number(weapon.damage)||0)} DMG</Chip><Chip>{Number(weapon.interval)>0?`${Math.round(60/Number(weapon.interval))} RPM`:'—'}</Chip>{alt&&<Chip tone="accent">ALT · {alt.label}</Chip>}</div>
   <p className="field-note">{weapon.description}</p>
   {alt&&<p className="field-note weapon-alt-note"><b>ALT FIRE</b> {alt.summary}</p>}
    <p className="field-note">{Number(weapon.ammo)>0?`${formatWhole(weapon.ammo)} / ${formatWhole(weapon.cap)} ROUNDS`:'UNLIMITED AMMO'}{weapon.splash?` · ${formatNumber(weapon.splash)} SPLASH`:''}</p>
  </Panel>;})}</div>}
  {tab==='operators'&&<div className="grid-cards">{CHARACTERS.map((operator:any)=><Panel key={operator.id} label="OPERATOR" meta={operator.tag}>
   <h3 style={{color:operator.color}}>{operator.name}</h3>
    <div className="row" style={{gap:6}}><Chip>{formatWhole(operator.stats.health)} HP</Chip><Chip>{formatWhole(operator.stats.armor)} ARM</Chip><Chip>{formatNumber(operator.stats.speed)} M/S</Chip></div>
   <p className="field-note">{operator.detail}</p>
  </Panel>)}</div>}
  {tab==='attachments'&&<div className="stack">{ATTACHMENT_SLOTS.map((slot:any)=>{const items=ATTACHMENTS.filter((item:any)=>item.slot===slot.id);if(!items.length)return null;return <div key={slot.id} className="stack stack--tight">
   <span className="label">{slot.name}</span>
   <div className="grid-cards">{items.map((item:any)=>{const isLocked=locked(level,item);return <Panel key={item.id} className={isLocked?'arsenal-locked':''} label={isLocked?`LV ${levelOf(item)}`:'AVAILABLE'} meta={item.weapons?.length?`${item.weapons.length} WEAPONS`:''}>
    <h3>{item.name}{isLocked&&<LockKeyhole size={14}/>}</h3>
    <p className="field-note">{item.description}</p>
   </Panel>;})}</div>
  </div>;})}</div>}
  {tab==='cosmetics'&&<div className="stack">
   <div className="stack stack--tight"><span className="label">WEAPON FINISHES</span>
    <div className="grid-cards">{WEAPON_FINISHES.length?WEAPON_FINISHES.map((item:any)=>{const isLocked=locked(level,item);return <Panel key={item.id} label={isLocked?`LV ${levelOf(item)}`:item.kind||'FINISH'} meta={isLocked?'LOCKED':'UNLOCKED'} className={isLocked?'arsenal-locked':''}><h3>{item.name}</h3><p className="field-note">{item.description}</p></Panel>;}) : <Empty title="No finishes loaded"/>}</div>
   </div>
   <div className="stack stack--tight"><span className="label">RETICLES</span>
    <div className="grid-cards">{CROSSHAIR_STYLES.length?CROSSHAIR_STYLES.map((item:any)=>{const isLocked=locked(level,item);return <Panel key={item.id} label={isLocked?`LV ${levelOf(item)}`:'CROSSHAIR'} meta={isLocked?'LOCKED':'UNLOCKED'} className={isLocked?'arsenal-locked':''}><h3>{item.name}</h3><p className="field-note">{item.description}</p></Panel>;}) : <Empty title="No reticles loaded"/>}</div>
   </div>
   <Panel label="GEAR" meta={`${count(GEAR)} / ${GEAR.length}`}>
    <div className="stack stack--tight">{GEAR_SLOTS.map((slot:any)=><div key={slot.id} className="row row--between"><span className="card-main"><span className="card-name">{slot.name}<small>{GEAR.filter((item:any)=>item.slot===slot.id).map((item:any)=>`${item.name}${locked(level,item)?` (LV ${levelOf(item)})`:''}`).join(' · ')}</small></span></span>{GEAR.filter((item:any)=>item.slot===slot.id).every((item:any)=>!locked(level,item))?<Chip tone="accent">READY</Chip>:<Chip tone="warn">LOCKED</Chip>}</div>)}</div>
   </Panel>
  </div>}
 </div>;
}

export function SettingsDialog({ui,opener=null}:ScreenProps&{opener?:HTMLElement|null}){
 const {settings,setSettings,prefs,study,WEAPONS=[],weaponRangeLabel,REPO_URL,helpSections,settingsTab='game',setSettingsTab,CHARACTERS=[],ATTACHMENTS=[],ATTACHMENT_SLOTS=[],GEAR=[],GEAR_SLOTS=[],WEAPON_FINISHES=[],CROSSHAIR_STYLES=[],profile,settingsRef}=ui;
 const tab=settingsTab||'game';
 // WP2.1: the exact opener is captured by the page before any lower dialog
 // becomes inert, and the Modal primitive returns focus to it on close.
  return <Modal open={settings} restoreFocus={opener} onClose={()=>setSettings(false)} size="xl" className={tab==='graphics-lab'?'modal--graphics-lab':''} eyebrow={tab==='graphics-lab'?'DEVELOPER / GRAPHICS PREVIEW':'GRAPHICS & SETTINGS'} title={tab==='graphics-lab'?'Find your flavor.':'Tune your arena'} description={tab==='graphics-lab'?'Live world preview · stackable shader experiments':'Changes apply immediately and are saved on this device.'} panelRef={settingsRef} footer={<Btn onClick={()=>setSettings(false)}>CLOSE</Btn>}>
  <div className="stack">
    <Tabs value={tab} onChange={(v:string)=>setSettingsTab?.(v)} ariaLabel="Settings sections" tabs={[{value:'game',label:'Game'},{value:'graphics-lab',label:'Graphics lab · Preview'},{value:'study',label:'Study'},{value:'help',label:'Help'},{value:'arsenal',label:'Arsenal'},{value:'about',label:'About'}]}/>
    {tab==='game'&&<Panel>{prefs}</Panel>}
    {tab==='graphics-lab'&&<GraphicsLabPanel lab={ui.graphicsLab}/>}
   {tab==='study'&&<StudyRecorderPanel study={study}/>}
   {tab==='help'&&<HelpSections sections={helpSections}/>}
   {tab==='arsenal'&&<ArsenalInspector WEAPONS={WEAPONS} CHARACTERS={CHARACTERS} ATTACHMENTS={ATTACHMENTS} ATTACHMENT_SLOTS={ATTACHMENT_SLOTS} GEAR={GEAR} GEAR_SLOTS={GEAR_SLOTS} WEAPON_FINISHES={WEAPON_FINISHES} CROSSHAIR_STYLES={CROSSHAIR_STYLES} profile={profile} weaponRangeLabel={weaponRangeLabel}/>}
   {tab==='about'&&<Panel label="SOURCE">
    <p>Source, issues and patches: <a href={REPO_URL} target="_blank" rel="noreferrer noopener">github.com/mojomast/tokenarena</a></p>
    <div className="row" style={{marginTop:10}}><Shield size={16}/><Swords size={16}/><span className="field-note">Built for the Colosseum Of Competitive Slop.</span></div>
   </Panel>}
  </div>
 </Modal>;
}

// WP3.2 — the optional local study recorder. One visible consent switch, the
// honest scope, and local-only download/delete. The panel never claims the log
// is anything but memory in this tab, and a second match is only counted, not
// described as voluntary.
type StudyLogView={enabled?:boolean;eventCount?:number;cap?:number;sessionId?:string|null;onToggle?:()=>void;onDownload?:()=>void;onDelete?:()=>void};
function StudyRecorderPanel({study}:{study?:StudyLogView}){
 const on=study?.enabled===true,count=Number(study?.eventCount)||0,cap=Number(study?.cap)||0;
 return <Panel label="OPTIONAL STUDY LOG" meta={on?`ON · ${count}/${cap} EVENTS`:'OFF'}>
  <div className="sound-setting"><label htmlFor="study-log-switch">Local study recorder</label><input id="study-log-switch" className="study-switch" type="checkbox" checked={on} onChange={()=>study?.onToggle?.()}/></div>
  <p className="field-note">{on?'Recording coarse journey events in this tab only.':'Off. Nothing is recorded until you switch this on.'}</p>
  <ul className="study-scope">
   <li><b>Collected</b> surface and stage changes, match intent, start and end, training step outcomes, order and spend outcomes, death and respawn, results actions, plus viewport, input and coarse accessibility buckets.</li>
   <li><b>Never collected</b> your name, player or progress id, IP address, chat, voice, exact keys, raw input, positions or anything you type.</li>
   <li><b>Where it lives</b> in this tab&apos;s memory, on this device. Nothing is sent anywhere, and closing the tab erases it.</li>
  </ul>
  <p className="field-note">A random session id ({study?.sessionId??'none'}) is created when you switch on and forgotten on switch-off. Downloading writes a local JSON file you can inspect; deleting removes the log immediately.</p>
  <div className="row study-actions"><Btn onClick={()=>study?.onDownload?.()} disabled={!on||count===0}>DOWNLOAD JSON</Btn><Btn variant="danger" onClick={()=>study?.onDelete?.()} disabled={!on}>DELETE LOG</Btn></div>
  <p className="field-note">Starting a second match is recorded as a fact only; it is not treated as voluntary without your stated reason.</p>
 </Panel>;
}
