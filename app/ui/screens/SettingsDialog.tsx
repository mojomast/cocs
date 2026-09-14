'use client';
import {useState} from 'react';
import type {ScreenProps} from '../contract';
import {Modal,Btn,Tabs,Panel,Chip} from '../primitives';
import {HELP_SECTIONS} from '../../../game/onboarding.mjs';

type HelpSection={id:string;title:string;summary?:string;items?:readonly string[]};

export function HelpSections({sections=HELP_SECTIONS}:{sections?:readonly HelpSection[]}){
 if(!sections.length)return <p className="field-note">No help topics loaded.</p>;
 return <div className="help-sections">
  {sections.map(section=><Panel key={section.id} label={section.title} meta={section.summary}>
   <ul className="help-list">{section.items?.map((item:string,i:number)=><li key={i}>{item}</li>)}</ul>
  </Panel>)}
 </div>;
}

export function SettingsDialog({ui}:ScreenProps){
 const {settings,setSettings,prefs,WEAPONS=[],weaponRangeLabel,REPO_URL,helpSections}=ui;
 const [tab,setTab]=useState('game');
 return <Modal open={settings} onClose={()=>setSettings(false)} size="xl" eyebrow="GRAPHICS & SETTINGS" title="Tune your arena" description="Changes apply immediately and are saved on this device." footer={<Btn onClick={()=>setSettings(false)}>CLOSE</Btn>}>
  <div className="stack">
   <Tabs value={tab} onChange={setTab} ariaLabel="Settings sections" tabs={[{value:'game',label:'Game'},{value:'help',label:'Help'},{value:'arsenal',label:'Arsenal'},{value:'about',label:'About'}]}/>
   {tab==='game'&&<Panel>{prefs}</Panel>}
   {tab==='help'&&<HelpSections sections={helpSections}/>}
   {tab==='arsenal'&&<div className="grid-cards">{WEAPONS.map((w:any,i:number)=><Panel key={w.name} label={`${i+1} / WEAPON`}>
    <h3 style={{color:w.color}}>{w.name}</h3>
    <p><Chip>{weaponRangeLabel(w)}</Chip></p>
    <p>{w.description}</p>
   </Panel>)}</div>}
   {tab==='about'&&<Panel label="SOURCE">
    <p>Source, issues and patches: <a href={REPO_URL} target="_blank" rel="noreferrer noopener">github.com/mojomast/tokenarena</a></p>
   </Panel>}
  </div>
 </Modal>;
}
