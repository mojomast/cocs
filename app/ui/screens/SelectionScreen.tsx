'use client';
import {useState} from 'react';
import {ArrowUpRight,Check,ChevronDown,ChevronRight,Crosshair,Flag,Hexagon,LockKeyhole,Play,Rocket,Shield,Skull,Sparkles,Swords,Target,Film,Users,Zap} from 'lucide-react';
import type {ScreenProps} from '../contract';
import {ActionRail,Banner,Btn,Meter,PageHead,Panel,Segmented,SelectCard,Shell,Stats,TopBar} from '../primitives';
import {kitView,operatorCard,specSheet} from '../../../game/class-ui.mjs';
import {LatticeBriefing} from './LatticeGuide';
import {isLattice} from '../../../game/lattice-guide.mjs';

export function SelectionScreen({ui}:ScreenProps){
  const {entered,showcaseLive,character,chooseCharacter,CHARACTERS=[],selected,harness,setHarness,HARNESSES=[],power,powerIcon,config,start,startSpectate,quickStart,setSetupOpen,setSingleOpen,changeMode,connectNet,openBrowser,netConnected,profile,demos=[],previewRef,headActions,backToDemo,notice,challenges=[],presets=[],loadPreset,deletePreset,openSettings}=ui;
  const [previewTab,setPreviewTab]=useState('model');
  const [moreOpen,setMoreOpen]=useState(false);
  const [latticeIntro,setLatticeIntro]=useState<string|null>(null);
  const note=character==='claude'?'Enhanced health, armor and speed offset the Claude Code harness lock.':'Each operator trades durability for mobility. Pick the stats that fit your style.';
  // Class/spec identity comes from the kit data directly (never through the
  // page's loose `ui` bag): wing chip, role, signature and movement verb.
  const selectedCard=operatorCard(character);
  const wing=selectedCard?.wing??null;
  const spec=specSheet(harness);
  const kit=kitView(character,harness);
  const rider=kit?.rider??null;
  const previewIndex=String((CHARACTERS.indexOf(selected)>=0?CHARACTERS.indexOf(selected):0)+1).padStart(2,'0');
  const activities=[
   {id:'deathmatch',name:'Quick Match',tag:'Free-for-all · first to the frag limit',icon:<Zap size={20}/>},
   {id:'teamdeathmatch',name:'Team Deathmatch',tag:'Shared score · friendly fire off',icon:<Users size={20}/>},
   {id:'ctf',name:'Capture the Flag',tag:'Steal the enemy flag and run it home',icon:<Flag size={20}/>},
   {id:'koth',name:'King of the Hill',tag:'Hold the hill and freeze their clock',icon:<Target size={20}/>},
   {id:'rockets',name:'Rocket Arena',tag:'Unlimited rockets for everyone',icon:<Rocket size={20}/>},
   {id:'instagib',name:'Instagib',tag:'Rail only · one unprotected hit kills',icon:<Crosshair size={20}/>},
   {id:'armsrace',name:'Arms Race',tag:'Every kill promotes you up the rack',icon:<Swords size={20}/>},
    {id:'cocs',name:'Lattice Strike',tag:'Team territory war · briefing & deployment',icon:<Hexagon size={20}/>},
    {id:'cocs-coop',name:'Lattice Strike: Operations',tag:'Co-op · defend your HQ against five Director waves',icon:<Hexagon size={20}/>},
   {id:'horde',name:'Horde',tag:'Solo survival against escalating waves',icon:<Skull size={20}/>},
   {id:'campaign',name:'Campaign',tag:'Scripted solo missions with objectives',icon:<Play size={20}/>},
   {id:'spectate',name:'Spectate',tag:'Watch a cinematic AI match',icon:<Film size={20}/>},
  ];
  // Secondary rail actions collapse behind MORE ▾ on phones (audit C5);
  // MATCH SETUP and ENTER ARENA stay reachable at every size.
  const railSecondary=netConnected
   ? <Btn size="sm" variant="ghost" onClick={connectNet} disabled={!ui.ready||!!ui.error}><Users size={14}/>DISCONNECT</Btn>
   : <Btn size="sm" variant="ghost" onClick={openBrowser} disabled={!ui.ready||!!ui.error}><Users size={14}/>ONLINE</Btn>;
  const rail=<ActionRail summary={<>
   <span className="chip chip--accent"><i/>{selected?.name}</span>
   {wing&&<span className="chip chip--wing" style={{color:wing.color,borderColor:`${wing.color}80`}}><i/>{wing.label}</span>}
   <span className="chip">{power?.name}</span>
   <span className="chip">{ui.selectedMap?.name}</span>
   <span className="chip">{ui.selectedMode?.name?.toUpperCase()} · {config?.botCount} BOTS</span>
   {ui.nextUnlock&&<span className="chip">NEXT UNLOCK · {ui.nextUnlock.name} · LV {ui.nextUnlock.level}</span>}
   {netConnected&&<span className="chip chip--accent"><i/>ONLINE</span>}
  </>}>
   <div className={`rail-more${moreOpen?' is-open':''}`}>
    <Btn size="sm" variant="ghost" className="rail-more__toggle" aria-expanded={moreOpen} onClick={()=>setMoreOpen(v=>!v)}>MORE<ChevronDown size={14}/></Btn>
    <div className="rail-more__body">
     <Btn size="sm" variant="ghost" onClick={()=>changeMode('progression')} disabled={!ui.ready||!!ui.error}><Sparkles size={14}/>RANK · LV {profile?.level}</Btn>
     <Btn size="sm" variant="ghost" onClick={()=>changeMode('changelog')} disabled={!ui.ready||!!ui.error}><Sparkles size={14}/>PATCH NOTES</Btn>
     <Btn size="sm" variant="ghost" onClick={backToDemo} disabled={!ui.ready||!!ui.error}><Film size={14}/>BACK TO DEMO</Btn>
     <Btn size="sm" variant="ghost" onClick={()=>openSettings?.('arsenal')} disabled={!ui.ready||!!ui.error}><Shield size={14}/>ARSENAL</Btn>
     <Btn size="sm" variant="ghost" onClick={()=>{changeMode('theater');ui.refreshDemos?.();}} disabled={!ui.ready||!!ui.error}><Film size={14}/>THEATER{demos.length?` ${demos.length}`:''}</Btn>
     <Btn size="sm" variant="ghost" onClick={startSpectate} disabled={!ui.ready||!!ui.error}><Crosshair size={14}/>SPECTATE</Btn>
     <Btn size="sm" variant="ghost" onClick={()=>setSingleOpen(true)} disabled={!ui.ready||!!ui.error}><Play size={14}/>SINGLE PLAYER</Btn>
     {railSecondary}
    </div>
   </div>
   <Btn variant="secondary" data-setup-trigger onClick={()=>setSetupOpen(true)}><span>MATCH SETUP</span><ChevronRight size={14}/></Btn>
   <Btn variant="primary" onClick={()=>start()} disabled={!ui.ready||!!ui.error}>ENTER ARENA <small>{ui.selectedMode?.name?.toUpperCase()} · {ui.selectedMap?.name?.toUpperCase()}</small><ArrowUpRight size={20}/></Btn>
  </ActionRail>;
  return <Shell className={`shell--showcase${entered?'':' shell--awaiting'}`} head={<TopBar sub="CUSTOM MATCH">{headActions}</TopBar>} rail={rail}>
  <div className="stack">
   <PageHead eyebrow="COLOSSEUM SETUP" title={<>Choose your intelligence<span>.</span></>} lede="Pick an operator, strap on a harness, then tune the rules. Nine rival models are already talking trash — only one leaves with bragging rights."/>
    {notice&&<Banner>{notice}</Banner>}
    {(latticeIntro||isLattice(config?.mode))&&<Panel label="LATTICE / DEPLOYMENT BRIEFING" meta="NEW HERE? START WITH YOUR FRONT GATE">
     <LatticeBriefing mode={latticeIntro??config.mode} bindings={ui.bindings}/>
     {latticeIntro&&<div className="row"><Btn variant="primary" onClick={()=>{quickStart?.(latticeIntro);setLatticeIntro(null);}}>DEPLOY {latticeIntro==='cocs-coop'?'OPERATIONS':'LATTICE STRIKE'}</Btn><Btn variant="ghost" onClick={()=>setLatticeIntro(null)}>BACK TO LOADOUT</Btn></div>}
    </Panel>}
   <div className="layout layout--lead">
    <div className="stack">
     <Panel className="panel--dense panel--operator" label="01 / OPERATOR" meta={`${CHARACTERS.length} AVAILABLE`} actions={<Btn size="sm" variant="ghost" onClick={ui.shuffle} title="Random compatible operator, harness and arena"><span className="shuffle-long">SHUFFLE LOADOUT / MAP</span><span className="shuffle-short" aria-hidden="true">SHUFFLE</span></Btn>}>
      <div className="grid-cards">{CHARACTERS.map((c:any,i:number)=>{const card=operatorCard(c.id);return <SelectCard key={c.id} selected={character===c.id} onClick={()=>chooseCharacter(c.id)} ariaLabel={`${c.name}: ${card?`${card.roleLabel} · ${card.signature.name}. `:''}${c.stats.health} health, ${c.stats.armor} armor, ${c.stats.speed} meters per second`} icon={<Hexagon size={22} strokeWidth={1.4}/>} name={c.name} tag={c.tag} meta={character===c.id?<Check size={17}/>:String(i+1).padStart(2,'0')} stats={<>
       <span className="card-chip card-chip--stat">{c.stats.health} HP · {c.stats.armor} ARM · {c.stats.speed} m/s</span>
       {card?.wing&&<span className="card-chip card-chip--wing" style={{color:card.wing.color}}>{card.wing.label}</span>}
       {card&&<span className="card-chip">{card.roleLabel}</span>}
       {card&&<span className="card-chip card-chip--verb" title={card.signature.line}>{card.signature.name}</span>}
      </>}/>;})}</div>
      <Stats items={[{label:'MAX HEALTH',value:selected?.stats?.health},{label:'SPAWN ARMOR',value:selected?.stats?.armor},{label:'MOVE SPEED',value:Number(((selected?.stats?.speed||0)*(config?.speed||1)).toFixed(2)),hint:'m/s'}]}/>
      <p className="field-note">{note}</p>
     </Panel>
     <Panel className="panel--dense panel--harness" label="02 / HARNESS" meta={spec?`${spec.kindLabel} ACTIVE`:'ACTIVE ABILITY'}>
      <div className="grid-cards">{HARNESSES.map((h:any)=>{const locked=character==='claude'&&h.id!=='claudecode';const hSpec=specSheet(h.id);return <SelectCard key={h.id} selected={harness===h.id} disabled={locked} onClick={()=>{setHarness(h.id);ui.setNotice?.('');}} ariaLabel={`${h.name}: ${h.power}${hSpec?` · ${hSpec.tradeoff.name} — ${hSpec.tradeoff.description}`:''}`} icon={powerIcon?powerIcon(h.id,20):<Shield size={20}/>} name={h.name} tag={h.power} meta={locked?<LockKeyhole size={15}/>:harness===h.id?<Check size={17}/>:h.key}/>;})}</div>
      <div className="panel-body--tight harness-detail">
       <p className="eyebrow"><i/>{power?.power} <span className="chip">Q</span></p>
       <p className="field-note">{power?.description}</p>
       <div className="row"><span className="chip">{power?.stat}</span><span className="chip">{power?.cooldown}s COOLDOWN</span>{spec&&<span className="chip chip--accent">{spec.kindLabel}</span>}{spec?.hookLabel&&<span className="chip">{spec.hookLabel} HOOK</span>}</div>
       {spec&&<p className="field-note"><b>TRADEOFF · {spec.tradeoff.name} · {spec.passive.triggerLabel}</b> {spec.tradeoff.description}</p>}
       {rider&&<p className="field-note"><b>{wing?.label} RIDER</b> {rider.description}</p>}
      </div>
     </Panel>
    </div>
    <div className="stack stack--sticky">
     <div ref={previewRef} className="preview-stage" aria-label={`${selected?.name} animated 3D model and kit preview`}>
      <span className="preview-corner">LIVE {previewTab==='model'?'MODEL':'KIT'} / {previewIndex}</span>
      <div className="preview-tabs"><Segmented value={previewTab} onChange={setPreviewTab} options={[{value:'model',label:'MODEL'},{value:'kit',label:'KIT'}]} ariaLabel="Preview panel"/></div>
      {previewTab==='model'
       ?<div className="preview-caption"><p className="eyebrow" style={{color:selected?.color}}>{selected?.tag}</p><h2 className="h-page">{selected?.name}</h2><p className="lede" style={{fontSize:14}}>{selected?.detail}</p></div>
       :<div className="preview-caption preview-caption--kit" role="tabpanel" aria-label="Kit preview">
        <div className="row row--between">
         {kit?.wing&&<span className="chip chip--wing" style={{color:kit.wing.color,borderColor:`${kit.wing.color}80`}}><i/>{kit.wing.label}</span>}
         {kit?.roleLabel&&<span className="label">{kit.roleLabel}</span>}
        </div>
        {kit?.signature&&<p className="field-note"><b className="preview-kit-verb">{kit.signature.name.toUpperCase()}</b> {kit.signature.line}</p>}
        {kit?.movement&&<p className="field-note"><b className="preview-kit-verb">{kit.movement.name.toUpperCase()}</b>{kit.movement.inputLabel?` · ${kit.movement.inputLabel}`:''}{kit.movement.budgetLine?` · ${kit.movement.budgetLine}`:''}</p>}
        {kit?.rider&&<p className="field-note"><b className="preview-kit-verb">{kit.wing?.label} RIDER</b> {kit.rider.description}</p>}
        {kit?.tradeoff&&<p className="field-note"><b className="preview-kit-verb">TRADEOFF</b> {kit.tradeoff.name} — {kit.tradeoff.description}</p>}
        <div className="row row--between">
         <p className="field-note preview-kit-combo">{kit?.combo}</p>
         {openSettings&&<Btn size="sm" variant="ghost" onClick={()=>openSettings('arsenal')}><Shield size={14}/>OPEN ARSENAL</Btn>}
        </div>
       </div>}
     </div>
     <Panel label="03 / QUICK START" meta="LAUNCHES INSTANTLY">
        <div className="grid-cards">{activities.map((a)=><SelectCard key={a.id} onClick={()=>{if(isLattice(a.id)){setLatticeIntro(a.id);document.querySelector('.shell')?.scrollTo({top:0,behavior:'instant'});}else quickStart?.(a.id);}} ariaLabel={`${a.name}: ${a.tag}`} icon={a.icon} name={a.name} tag={a.tag} meta={<Play size={15}/>}/>)}</div>
       <p className="field-note">Starts now with <b>{selected?.name}</b>, the <b>{power?.name}</b> harness and your current rules on a {ui.selectedMode?.name} arena. Fine-tune everything under MATCH SETUP, or pick a specific arena there. New objective modes — Juggernaut, Team Elimination, VIP Escort, Payload and Assault — live there too; the full legend is under Graphics &amp; settings → Help.</p>
     </Panel>
     <Panel label="LOADOUT PRESETS" meta={`${presets.length} SAVED`} actions={<Btn size="sm" variant="ghost" onClick={()=>setSetupOpen(true)}>MANAGE</Btn>}>
      {presets.length?<div className="row" role="group" aria-label="Saved loadout presets">{presets.map((p:any)=><span key={p.id} className="chip preset-chip" title={`${p.character} / ${p.harness}${p.mapId?` · ${p.mapId}`:''}`}>
       <button type="button" className="text-button" aria-label={`Load preset ${p.name}`} onClick={()=>loadPreset?.(p)}>{p.name}</button>
       <button type="button" className="text-button" aria-label={`Delete preset ${p.name}`} onClick={()=>deletePreset?.(p.id)}>×</button>
      </span>)}</div>:<p className="field-note">No presets yet. Save your full loadout — operator, harness, arena, rules, gear, mods, finish and reticle — from MATCH SETUP.</p>}
     </Panel>
     <Panel label="DAILY CHALLENGES" meta={challenges.length?`${challenges.filter((c:any)=>c.done).length} / ${challenges.length} COMPLETE`:'ROTATING'} actions={<Btn size="sm" variant="ghost" onClick={()=>changeMode('progression')}>TRACK</Btn>}>
      {challenges.length?<div className="stack stack--tight">{challenges.map((c:any)=><div key={c.id} className="stack stack--tight challenge-row">
       <div className="row row--between"><span className="label">{c.label}</span><span className="label">{c.done?'CLAIMED':`${c.progress} / ${c.target} · +${c.reward} XP`}</span></div>
       <Meter ratio={c.target?Math.min(1,c.progress/c.target):0}/>
      </div>)}</div>:<p className="field-note">Daily objectives load with the arena. Finish matches to earn bonus XP.</p>}
     </Panel>
    </div>
   </div>
  </div>
 </Shell>;
}
