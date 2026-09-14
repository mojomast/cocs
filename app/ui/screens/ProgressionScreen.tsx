'use client';
import {useState} from 'react';
import type {ScreenProps} from '../contract';
import {ActionRail,Banner,Btn,Chip,Meter,PageHead,Panel,SelectCard,Shell,Stats,Tabs,TopBar} from '../primitives';

const resultTone=(result:string)=>result==='win'?'accent':result==='draw'?'warn':'danger';
const shortDate=(at:number)=>at?new Date(at).toISOString().slice(0,10):'—';

export function ProgressionScreen({ui}:ScreenProps){
 const {profile,UNLOCKS,UNLOCK_GROUPS,GEAR,GEAR_SLOTS,ATTACHMENTS,ATTACHMENT_SLOTS,WEAPON_FINISHES,CROSSHAIR_STYLES,levelFromXp,rankTitle,rankBlurb,unlockedItems,chooseGear,chooseAttachment,chooseFinish,chooseCrosshair,selected,changeMode,notice,headActions,previewRef,challenges=[],weeklyChallenges=[],history={entries:[]},historyTotals,historyLeaderboard=[],clearHistory,campaignMissions=[],campaignSummary,startCampaignMission,setSingleOpen,setSingleSub,GAME_MODES=[]}=ui;
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
 const renderChallenges=(list:any[],empty:string)=>list.length
  ?<div className="stack stack--tight">{list.map((c:any)=><div key={c.id} className="stack stack--tight challenge-row">
   <div className="row row--between"><span className="label">{c.label}</span><span className="label">{c.done?'CLAIMED':`${c.progress} / ${c.target}`}</span></div>
   <Meter ratio={c.target?Math.min(1,c.progress/c.target):0}/>
   <span className="field-note">+{c.reward} XP{c.mode?` · ${modeName(c.mode)}`:''}{c.team?' · TEAM MATCHES':''}</span>
  </div>)}</div>
  :<p className="field-note">{empty}</p>;
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
     <Panel label="DAILY CHALLENGES" meta={`${challenges.filter((c:any)=>c.done).length} / ${challenges.length} CLAIMED`}>
      {renderChallenges(challenges,'Daily challenges rotate each day. Finish matches to advance them and bank bonus XP.')}
     </Panel>
     <Panel label="WEEKLY CHALLENGES" meta={weeklyChallenges.length?`${weeklyChallenges.filter((c:any)=>c.done).length} / ${weeklyChallenges.length} CLAIMED`:'ROTATING'}>
      {renderChallenges(weeklyChallenges,'Weekly objectives rotate on Monday and pay out bigger bonus XP.')}
     </Panel>
     <Panel label="CAMPAIGN" meta={campaignSummary?`${campaignSummary.done} / ${campaignSummary.total} · ★ ${campaignSummary.stars} / ${campaignSummary.maxStars}`:''} actions={<Btn size="sm" variant="ghost" onClick={()=>{setSingleSub?.('campaign');setSingleOpen?.(true);}}>MISSION SELECT</Btn>}>
      {campaignMissions.length?<div className="stack stack--tight">{campaignMissions.map((m:any)=><div key={m.id} className="row row--between mode-row mission-row">
       <span className="card-main"><span className="card-name">{m.name}<small>{m.chapter} · {m.completed?`BEST ${m.bestTime!=null?`${Math.round(m.bestTime)}s`:'—'}${m.bestScore!=null?` · ${m.bestScore} K`:''}`:m.unlocked?m.brief:'LOCKED — clear the previous mission'}</small></span></span>
       <span className="row" style={{gap:8}}><span className="mission-stars" aria-label={`${m.stars} of 3 stars`}>{'★★★'.slice(0,m.stars)}{'☆☆☆'.slice(0,3-m.stars)}</span>{m.completed&&<Btn size="sm" variant="ghost" onClick={()=>startCampaignMission?.(m.id)}>REPLAY</Btn>}</span>
      </div>)}</div>:<p className="field-note">No campaign missions loaded.</p>}
     </Panel>
     <Panel label="MATCH HISTORY" meta={historyTotals?`${historyTotals.matches} LOGGED`:'LOCAL'} actions={history.entries?.length?<Btn size="sm" variant="ghost" onClick={()=>clearHistory?.()}>CLEAR</Btn>:undefined}>
      {history.entries?.length?<div className="history-list">{history.entries.slice(0,12).map((h:any)=><div key={h.id} className="history-row">
       <span className="card-main"><span className="card-name">{modeName(h.mode)}<small>{h.mapName||h.mapId||'ARENA'} · {shortDate(h.at)}</small></span></span>
       <span className="row history-row__stats"><Chip tone={resultTone(h.result)}>{String(h.result).toUpperCase()}</Chip><span className="label">K/D {h.kills}/{h.deaths}</span></span>
      </div>)}</div>:<p className="field-note">Finish a match to start logging your mode, arena, result and K/D on this device.</p>}
     </Panel>
     <Panel label="LOCAL LEADERBOARD" meta={historyTotals?`K/D ${Number(historyTotals.kd||0).toFixed(2)} · ${historyTotals.bestKills} BEST`:'PERSONAL BESTS'}>
      {historyLeaderboard.length?<div className="leaderboard">{historyLeaderboard.map((row:any)=><div key={row.mode} className="leaderboard-row">
       <span className="card-main"><span className="card-name">{modeName(row.mode)}<small>{row.matches} MATCH{row.matches===1?'':'ES'} · {row.wins}W/{row.losses}L{row.draws?`/${row.draws}D`:''}</small></span></span>
       <span className="row leaderboard-row__stats"><span className="label">BEST {row.bestKills} K</span><span className="label">K/D {Number(row.bestKd||0).toFixed(2)}</span></span>
      </div>)}</div>:<p className="field-note">Your per-mode personal bests appear here as you play. This leaderboard is stored locally.</p>}
     </Panel>
     </div>
    </div>
  </div>
 </Shell>;
}
