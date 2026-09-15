'use client';
import {useState} from 'react';
import {ArrowUpRight,ChevronDown,ChevronRight,Sparkles} from 'lucide-react';
import type {ScreenProps} from '../contract';
import {ActionRail,Btn,Chip,PageHead,Panel,Shell,TopBar} from '../primitives';

// In-game patch notes. Renders the digest from game/changelog.mjs newest-first,
// with the running release featured and older releases collapsed.
export function ChangelogScreen({ui}:ScreenProps){
 const releases=Array.isArray(ui.CHANGELOG)?ui.CHANGELOG:[];
 const latest=releases[0]||null;
 const [open,setOpen]=useState<string|null>(null);
 const version=ui.RELEASE_VERSION||'v0.0';
 const codename=ui.RELEASE_CODENAME||'';
 return <Shell className="shell--showcase" head={<TopBar sub="PATCH NOTES">{ui.headActions}</TopBar>} rail={
  <ActionRail summary={<span className="label">{version}{codename?` · ${codename}`:''} · {releases.length} RELEASES LISTED</span>}>
   {ui.FULL_CHANGELOG_URL&&<a className="btn btn-ghost btn-sm" href={ui.FULL_CHANGELOG_URL} target="_blank" rel="noreferrer noopener">FULL CHANGELOG<ArrowUpRight size={14}/></a>}
   <Btn variant="secondary" onClick={()=>ui.changeMode?.('selection')}>BACK TO LOADOUT</Btn>
  </ActionRail>
 }>
  <div className="stack">
   <PageHead eyebrow="WHAT CHANGED" title={<>Every token spent<span>.</span></>} lede="The running build is shown in the footer. Here is what each recent release added, newest first."/>
   {latest?<Panel accent label="LATEST RELEASE" meta={`${latest.version}${latest.codename?` · ${latest.codename}`:''}${latest.date?` · ${latest.date}`:''}`}>
    <div className="stack stack--tight">
     <div className="row row--between"><h2 className="panel-title">{latest.tag||latest.codename||latest.version}</h2><Chip tone="accent"><i/>{latest.version}</Chip></div>
     <ul className="changelog-list">{latest.highlights.map((line:string,i:number)=><li key={i}><Sparkles size={13}/><span>{line}</span></li>)}</ul>
    </div>
   </Panel>:<p className="field-note">No release notes loaded.</p>}
   <div className="stack stack--tight">
    {releases.slice(1).map(release=>{
     const expanded=open===release.version;
     return <Panel key={release.version} label={release.version} meta={`${release.codename?`${release.codename} · `:''}${release.date||''}`} actions={<Btn size="sm" variant="ghost" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:release.version)}>{expanded?'HIDE':'SHOW'}{expanded?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</Btn>}>
      <div className="stack stack--tight">
       <p className="field-note">{release.tag}</p>
       {expanded&&<ul className="changelog-list">{release.highlights.map((line:string,i:number)=><li key={i}><Sparkles size={13}/><span>{line}</span></li>)}</ul>}
      </div>
     </Panel>;
    })}
   </div>
  </div>
 </Shell>;
}
