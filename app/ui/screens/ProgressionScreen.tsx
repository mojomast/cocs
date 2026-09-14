'use client';
import {useState} from 'react';
import type {ScreenProps} from '../contract';
import {ActionRail,Banner,Btn,Chip,Meter,PageHead,Panel,SelectCard,Shell,Stats,Tabs,TopBar} from '../primitives';

export function ProgressionScreen({ui}:ScreenProps){
 const {profile,UNLOCKS,UNLOCK_GROUPS,GEAR,GEAR_SLOTS,ATTACHMENTS,ATTACHMENT_SLOTS,WEAPON_FINISHES,CROSSHAIR_STYLES,levelFromXp,rankTitle,rankBlurb,unlockedItems,chooseGear,chooseAttachment,chooseFinish,chooseCrosshair,selected,changeMode,notice,headActions,previewRef,challenges=[],GAME_MODES=[]}=ui;
 const [tab,setTab]=useState('gear');
 const level=levelFromXp(profile.xp);
 const modeName=(id:string)=>GAME_MODES.find((m:any)=>m.id===id)?.name||String(id||'unknown').replace(/[-_]+/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase());
 const modeRows=Object.entries(profile.byMode||{}).map(([id,stats]:any)=>[id,stats]).sort((a:any,b:any)=>(b[1].matches||0)-(a[1].matches||0));
 const renderItems=(items:any[],isSelected:(item:any)=>boolean,isLocked:(item:any)=>boolean,onPick:(item:any)=>void)=>(
  <div className="grid-cards">{items.map((item:any)=>{
   const locked=isLocked(item);
   return <SelectCard key={item.id} name={item.name} tag={item.description} selected={isSelected(item)} disabled={locked} meta={locked?`LV ${item.level??1}`:undefined} onClick={()=>onPick(item)} ariaLabel={item.name}/>;
  })}</div>
 );
 const rail=<ActionRail summary={<span className="label">LEVEL {profile.level} · {profile.xp} XP</span>}><Btn variant="secondary" onClick={()=>changeMode('selection')}>BACK TO LOADOUT</Btn></ActionRail>;
 return <Shell className="shell--showcase" head={<TopBar sub="PROGRESSION">{headActions}</TopBar>} rail={rail}>
  <div className="stack">
   <PageHead eyebrow="OPERATOR RECORD" title="Rank up."/>
   {notice&&<Banner>{notice}</Banner>}
    <div className="layout progression-grid layout--sticky">
     <div className="stack">
     <Panel label="RANK" meta={`LEVEL ${profile.level} / 60`}>
     <div className="stack">
      <div className="row row--between"><h2 className="panel-title">{rankTitle(profile.level)}</h2>{selected&&<Chip tone="accent"><i/>{selected.name}</Chip>}</div>
      <div className="row row--between"><span className="label">{profile.xp} XP</span><span className="label">{level.toNext} XP TO LEVEL {profile.level+1}</span></div>
      <Meter ratio={level.progress}/>
      <p className="field-note">{rankBlurb(profile.level)}</p>
      <Stats items={[{label:'MATCHES',value:profile.matches},{label:'WINS',value:profile.wins},{label:'KILLS',value:profile.kills}]}/>
     </div>
     </Panel>
     <div ref={previewRef} className="preview-stage" aria-label={`${selected?.name??'Operator'} animated 3D model`}>
      <span className="preview-corner">OPERATOR PREVIEW</span>
      <div className="preview-caption"><p className="eyebrow" style={{color:selected?.color}}>{selected?.tag}</p><h2 className="h-page">{selected?.name}</h2></div>
     </div>
     </div>
     <Panel label="GEAR LOADOUT" meta="COMBINED ARMS">
     <div className="stack">
      <Tabs value={tab} onChange={setTab} ariaLabel="Loadout category" tabs={[{value:'gear',label:'Gear'},{value:'mods',label:'Weapon mods'},{value:'skins',label:'Skins'},{value:'reticles',label:'Reticles'},{value:'modes',label:'Modes'}]}/>
      {tab==='gear'&&GEAR_SLOTS.map((slot:any)=><div key={slot.id} className="stack stack--tight">
       <span className="label">{slot.name}</span>
       {renderItems(GEAR.filter((item:any)=>item.slot===slot.id),item=>profile.gear[slot.id]===item.id,item=>profile.level<item.level,item=>chooseGear(slot.id,item.id))}
      </div>)}
      {tab==='mods'&&ATTACHMENT_SLOTS.map((slot:any)=><div key={slot.id} className="stack stack--tight">
       <span className="label">{slot.name}</span>
       {renderItems(ATTACHMENTS.filter((item:any)=>item.slot===slot.id),item=>(profile.attachments||{})[slot.id]===item.id,item=>profile.level<item.level,item=>chooseAttachment(slot.id,item.id))}
      </div>)}
      {tab==='skins'&&<div className="stack stack--tight">
       <span className="label">WEAPON FINISHES</span>
       {renderItems(WEAPON_FINISHES,item=>profile.finish===item.id,item=>profile.level<item.level,item=>chooseFinish(item.id))}
      </div>}
      {tab==='reticles'&&<div className="stack stack--tight">
       <span className="label">RETICLES</span>
       {renderItems(CROSSHAIR_STYLES,item=>profile.crosshair===item.id,item=>profile.level<(item.level||1),item=>chooseCrosshair(item.id))}
      </div>}
      {tab==='modes'&&<div className="stack stack--tight">
       <span className="label">CAREER BY MODE</span>
       {modeRows.length?modeRows.map(([id,stats]:any)=><div key={id} className="row row--between mode-row">
        <span className="card-main"><span className="card-name">{modeName(id)}<small>{stats.matches} MATCH{stats.matches===1?'':'ES'} · BEST {stats.best} KILLS</small></span></span>
        <span className="label">{stats.wins} W · {stats.kills} K · {stats.matches?Math.round(stats.wins/stats.matches*100):0}%</span>
       </div>):<p className="field-note">Finish a match to start recording per-mode matches, wins, kills and your best single-match kill count.</p>}
      </div>}
     </div>
     </Panel>
     <div className="stack">
      <Panel label="UNLOCK TRACK" meta={`${unlockedItems(profile.level).length} / ${UNLOCKS.length} CLAIMED`}>
     <div className="stack">
      {UNLOCK_GROUPS.map((group:any)=>{
       const items=UNLOCKS.filter((item:any)=>item.kind===group.kind);
       const got=items.filter((item:any)=>profile.level>=item.level).length;
       return <div key={group.kind} className="stack stack--tight">
        <div className="row row--between"><span className="label">{group.label}</span><span className="label">{got}/{items.length}</span></div>
        <Meter ratio={items.length?got/items.length:0}/>
        <div className="stack stack--tight">{items.map((item:any)=>{const unlocked=profile.level>=item.level;return <div key={item.id} className="row row--between"><span className="card-main"><span className="card-name">{item.name}<small>{item.description}</small></span></span><span className="label">{unlocked?'CLAIMED':`LV ${item.level}`}</span></div>;})}</div>
       </div>;
       })}
      </div>
     </Panel>
     <Panel label="CHALLENGE TRACK" meta={`${challenges.filter((c:any)=>c.done).length} / ${challenges.length} CLAIMED`}>
      <div className="stack">
       {challenges.length?challenges.map((c:any)=><div key={c.id} className="stack stack--tight challenge-row">
        <div className="row row--between"><span className="label">{c.label}</span><span className="label">{c.done?'CLAIMED':`${c.progress} / ${c.target}`}</span></div>
        <Meter ratio={c.target?Math.min(1,c.progress/c.target):0}/>
        <span className="field-note">+{c.reward} XP{c.mode?` · ${modeName(c.mode)}`:''}{c.team?' · TEAM MATCHES':''}</span>
       </div>):<p className="field-note">Daily challenges rotate each day. Finish matches to advance them and bank bonus XP.</p>}
      </div>
      </Panel>
     </div>
    </div>
   </div>
  </Shell>;
}
