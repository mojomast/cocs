'use client';
import {useState} from 'react';
import type {ScreenProps} from '../contract';
import {Modal,Btn,Tabs,Panel,Chip} from '../primitives';

export function SettingsDialog({ui}:ScreenProps){
 const {settings,setSettings,prefs,WEAPONS=[],weaponRangeLabel,REPO_URL}=ui;
 const [tab,setTab]=useState('game');
 return <Modal open={settings} onClose={()=>setSettings(false)} size="xl" eyebrow="GRAPHICS & SETTINGS" title="Tune your arena" description="Changes apply immediately and are saved on this device." footer={<Btn onClick={()=>setSettings(false)}>CLOSE</Btn>}>
  <div className="stack">
   <Tabs value={tab} onChange={setTab} ariaLabel="Settings sections" tabs={[{value:'game',label:'Game'},{value:'arsenal',label:'Arsenal'},{value:'about',label:'About'}]}/>
   {tab==='game'&&<Panel>{prefs}</Panel>}
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
