'use client';
import {useState} from 'react';
import {ArrowUpRight,Check,ChevronDown,ChevronRight,Crosshair,Flag,GraduationCap,Hexagon,LockKeyhole,Play,Rocket,Shield,Skull,Sparkles,Swords,Target,Film,Users,Zap} from 'lucide-react';
import type {ScreenProps} from '../contract';
import {ActionRail,Banner,Btn,Meter,PageHead,Panel,Segmented,SelectCard,Shell,Stats,TopBar} from '../primitives';
import {kitView,operatorCard,specSheet} from '../../../game/class-ui.mjs';
import {LatticeBriefing} from './LatticeGuide';
import {isLattice,latticePracticeDefaults} from '../../../game/lattice-guide.mjs';
import {latticeLoadoutRoles} from '../../../game/lattice-roles.mjs';
import {formatNumber,formatWhole} from '../../../game/format-ui.mjs';
import {DEFAULT_CONFIG,GAME_MODES,MUTATORS,matchPlan,normalizeConfig,quickStartRules} from '../../../game/config.mjs';
import {COCS_TIERS} from '../../../game/cocs-difficulty.mjs';
import {mapsForMode} from '../../../game/arenas.mjs';
import {getMap} from '../../../game/maps.mjs';
import {modeTargetText} from '../../../game/hud.mjs';
import {TRAINING_STEPS,TRAINING_TITLES,trainingConfig} from '../../../game/lattice-training.mjs';
import {DEFAULT_BINDINGS,bindingLabel} from '../../../game/keybinds.mjs';

const cap=(value:any)=>String(value??'').toUpperCase();
// F06 effective-rules preview: every chip is derived from the same plan the
// launch path uses, so map substitution, automatic fill, the clock and the
// inherited modifiers cannot disagree with the match that starts.
function planChips(plan:any,map:any,{reset=false}:any={}){
 const chips:any[]=[
  <span className="card-chip" key="map">{map?.id==null?'MAP · MISSION SELECT':map?.auto?`AUTO MAP · ${cap(map.name)} · SUBSTITUTED`:`MAP · ${cap(map?.name)}`}</span>,
  <span className="card-chip" key="roster">{cap(plan.rosterLabel)}</span>,
  <span className="card-chip" key="time">{plan.duration}</span>,
  ...(plan.mode.id==='puma-race'||plan.mode.id==='puma-soccer'?[]:[<span className="card-chip" key="ai">AI {cap(plan.difficulty.name)}</span>]),
  <span className="card-chip" key="rules">{reset?'RULES RESET · NO MODIFIERS':plan.modifiers.length?`INHERITS ${cap(plan.modifierLabel)}`:'NO SAVED MODIFIERS'}</span>,
 ];
 if(plan.coop)chips.push(<span className="card-chip card-chip--accent" key="tier">DIRECTOR {plan.tier.id} · {plan.tier.label}</span>);
 if(plan.coop)chips.push(<span className="card-chip" key="waves">{plan.waves.copy}</span>);
 return chips;
}

export function SelectionScreen({ui}:ScreenProps){
  const {entered,showcaseLive,character,chooseCharacter,CHARACTERS=[],selected,harness,setHarness,HARNESSES=[],power,powerIcon,config,start,startSpectate,quickStart,setSetupOpen,setSingleOpen,changeMode,connectNet,openBrowser,netConnected,profile,demos=[],previewRef,headActions,backToDemo,notice,challenges=[],presets=[],loadPreset,deletePreset,openSettings}=ui;
  const [previewTab,setPreviewTab]=useState('model');
  const [moreOpen,setMoreOpen]=useState(false);
  const [latticeIntro,setLatticeIntro]=useState<string|null>(null);
  const latticeRole=(latticeIntro||isLattice(config?.mode))?latticeLoadoutRoles(character,harness):null;
  const note=character==='claude'?'Enhanced health, armor and speed offset the Claude Code harness lock.':'Each operator trades durability for mobility. Pick the stats that fit your style.';
  // Class/spec identity comes from the kit data directly (never through the
  // page's loose `ui` bag): wing chip, role, signature and movement verb.
  const selectedCard=operatorCard(character);
  const wing=selectedCard?.wing??null;
  const spec=specSheet(harness);
  const kit=kitView(character,harness);
  const rider=kit?.rider??null;
  const powerKey=bindingLabel(ui.bindings?.power??DEFAULT_BINDINGS.power).toUpperCase();
  const previewIndex=String((CHARACTERS.indexOf(selected)>=0?CHARACTERS.indexOf(selected):0)+1).padStart(2,'0');
  // F06: every quick-start label comes from normalizeConfig + GAME_MODES
  // metadata (matchPlan) and the same mode defaults the page spreads, so a card
  // can never promise a different arena, roster, clock or modifier set.
  const mapChoice=(modeId:string)=>{
   const allowed=mapsForMode(modeId,{legacy:!!ui.legacyMaps});
   const current=allowed.find((entry:any)=>entry.id===ui.mapId);
   const pick=current??allowed[0];
   return {id:pick?.id??ui.mapId,name:pick?.name??getMap(ui.mapId)?.name??'AUTO',auto:!current&&!!pick};
  };
  const modeCard=(activity:any)=>({...activity,plan:matchPlan(quickStartRules(config,activity.id,latticePracticeDefaults(activity.id))),map:mapChoice(activity.id)});
  const modeCards=[
   {id:'deathmatch',icon:<Zap size={20}/>},
   {id:'teamdeathmatch',icon:<Users size={20}/>},
   {id:'ctf',icon:<Flag size={20}/>},
   {id:'koth',icon:<Target size={20}/>},
   {id:'rockets',icon:<Rocket size={20}/>},
   {id:'instagib',icon:<Crosshair size={20}/>},
   {id:'armsrace',icon:<Swords size={20}/>},
  ].map(modeCard);
  // Lattice presets reset saved rules: a custom mutator, rung or Director tier
  // must not silently ride into the recommended briefing.
  const latticeCards=[
   {id:'cocs',icon:<Hexagon size={20}/>},
   {id:'cocs-coop',icon:<Hexagon size={20}/>},
  ].map(activity=>{const rules=quickStartRules({},activity.id,latticePracticeDefaults(activity.id),{playerName:config?.playerName});return {...activity,rules,plan:matchPlan(rules),map:{id:'lattice-slice',name:getMap('lattice-slice').name,auto:false}};});
  const trainingCards=[
   {id:'field-training',training:'cocs',icon:<GraduationCap size={20}/>},
   {id:'operations-training',training:'cocs-coop',icon:<GraduationCap size={20}/>},
  ].map(activity=>({...activity,plan:matchPlan(trainingConfig(activity.training,{playerName:config?.playerName})??{}),map:{id:'lattice-slice',name:getMap('lattice-slice').name,auto:false}}));
  const singleCards=[
   {id:'horde',icon:<Skull size={20}/>},
   {id:'campaign',icon:<Play size={20}/>},
  ].map(activity=>({...activity,plan:matchPlan({...config,mode:activity.id,botCount:0,timeLimit:900}),map:activity.id==='campaign'?{id:null,name:'MISSION SELECT',auto:false}:mapChoice(activity.id)}));
  const spectateCard={id:'spectate',icon:<Film size={20}/>,plan:matchPlan(config),map:mapChoice(config?.mode??'deathmatch')};
  const beginnerRules=normalizeConfig({...DEFAULT_CONFIG,playerName:config?.playerName});
  const beginnerPlan=matchPlan(beginnerRules);
  const beginnerMap=mapChoice(beginnerPlan.mode.id);
  const beginnerMode=GAME_MODES.find(entry=>entry.id===beginnerPlan.mode.id);
  const railPlan=matchPlan(config);
  // Criterion 3: the fill rule for every auto-filling mode is the same plan
  // copy the setup screen and the launch path use, never a second hand-written
  // sentence that could drift.
  const autoFillNotes=[matchPlan({mode:'cocs-coop',botCount:config?.botCount??0}),matchPlan({mode:'puma-soccer'}),matchPlan({mode:'puma-race',botCount:config?.botCount??0})].map(plan=>plan.fill.note);
  const scrollSetupTop=()=>{const body=document.querySelector('.shell-body');if(body)body.scrollTo({top:0,behavior:'instant'});};
  const launchRules=(rules:any,map:any)=>{ui.setConfig?.(rules);ui.setMapId?.(map.id);ui.start?.({character,harness,mapId:map.id,config:rules});};
  const launchBeginner=()=>launchRules(beginnerRules,beginnerMap);
  const launchInstant=(card:any)=>{
   // Single-player and spectate own bespoke routing on the page; everything
   // else composes the shared quick-start rules and starts them.
   if(card.id==='spectate'||card.id==='horde'||card.id==='campaign'){ui.quickStart?.(card.id);return;}
   launchRules(quickStartRules(config,card.id,latticePracticeDefaults(card.id)),mapChoice(card.id));
  };
  const launchTraining=(card:any)=>ui.startTraining?.(card.training);
  const openLattice=(card:any)=>{ui.setConfig?.(card.rules);setLatticeIntro(card.id);scrollSetupTop();};
  const openCustom=()=>ui.setSetupOpen?.(true);
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
   <span className="chip">{ui.selectedMode?.name?.toUpperCase()} · {cap(railPlan.rosterLabel)}</span>
    {railPlan.coop&&railPlan.tier&&<span className="chip chip--accent">DIRECTOR {railPlan.tier.id} · {railPlan.tier.label}</span>}
   <span className="chip">{railPlan.modifierLabel}</span>
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
       <div className="grid-cards">{CHARACTERS.map((c:any,i:number)=>{const card=operatorCard(c.id);return <SelectCard key={c.id} selected={character===c.id} onClick={()=>chooseCharacter(c.id)} ariaLabel={`${c.name}: ${card?`${card.roleLabel} · ${card.signature.name}. `:''}${formatWhole(c.stats.health)} health, ${formatWhole(c.stats.armor)} armor, ${formatNumber(c.stats.speed)} meters per second`} icon={<Hexagon size={22} strokeWidth={1.4}/>} name={c.name} tag={c.tag} meta={character===c.id?<Check size={17}/>:String(i+1).padStart(2,'0')} stats={<>
        <span className="card-chip card-chip--stat">{formatWhole(c.stats.health)} HP · {formatWhole(c.stats.armor)} ARM · {formatNumber(c.stats.speed)} m/s</span>
       {card?.wing&&<span className="card-chip card-chip--wing" style={{color:card.wing.color}}>{card.wing.label}</span>}
       {card&&<span className="card-chip">{card.roleLabel}</span>}
       {card&&<span className="card-chip card-chip--verb" title={card.signature.line}>{card.signature.name}</span>}
      </>}/>;})}</div>
       <Stats items={[{label:'MAX HEALTH',value:formatWhole(selected?.stats?.health)},{label:'SPAWN ARMOR',value:formatWhole(selected?.stats?.armor)},{label:'MOVE SPEED',value:formatNumber((selected?.stats?.speed||0)*(config?.speed||1)),hint:'m/s'}]}/>
       <p className="field-note">{note}</p>
       {latticeRole&&<div className="lattice-loadout-role"><span className="eyebrow">LATTICE / {latticeRole.operator.role.toUpperCase()}</span><b>{latticeRole.operator.name}</b><p>{latticeRole.operator.description}</p></div>}
     </Panel>
     <Panel className="panel--dense panel--harness" label="02 / HARNESS" meta={spec?`${spec.kindLabel} ACTIVE`:'ACTIVE ABILITY'}>
      <div className="grid-cards">{HARNESSES.map((h:any)=>{const locked=character==='claude'&&h.id!=='claudecode';const hSpec=specSheet(h.id);return <SelectCard key={h.id} selected={harness===h.id} disabled={locked} onClick={()=>{setHarness(h.id);ui.setNotice?.('');}} ariaLabel={`${h.name}: ${h.power}${hSpec?` · ${hSpec.tradeoff.name} — ${hSpec.tradeoff.description}`:''}`} icon={powerIcon?powerIcon(h.id,20):<Shield size={20}/>} name={h.name} tag={h.power} meta={locked?<LockKeyhole size={15}/>:harness===h.id?<Check size={17}/>:h.key}/>;})}</div>
      <div className="panel-body--tight harness-detail">
        <p className="eyebrow"><i/>{power?.power} <span className="chip">{powerKey}</span></p>
       <p className="field-note">{power?.description}</p>
        <div className="row"><span className="chip">{power?.stat}</span><span className="chip">{formatNumber(power?.cooldown)}s COOLDOWN</span>{spec&&<span className="chip chip--accent">{spec.kindLabel}</span>}{spec?.hookLabel&&<span className="chip">{spec.hookLabel} HOOK</span>}</div>
       {spec&&<p className="field-note"><b>TRADEOFF · {spec.tradeoff.name} · {spec.passive.triggerLabel}</b> {spec.tradeoff.description}</p>}
        {rider&&<p className="field-note"><b>{wing?.label} RIDER</b> {rider.description}</p>}
        {latticeRole&&<div className="lattice-loadout-role"><span className="eyebrow">LATTICE / {latticeRole.harness.role.toUpperCase()}</span><b>{latticeRole.harness.name}</b><p>{latticeRole.harness.description}</p></div>}
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
      <Panel label="03 / QUICK START" meta="RECOMMENDED · TRAINING · CUSTOM">
        <p className="eyebrow">START HERE</p>
        <div className="grid-cards">
         <SelectCard onClick={launchBeginner} icon={<Play size={20}/>} name="RECOMMENDED FIRST MATCH" tag={beginnerMode?`${beginnerPlan.mode.name} · ${modeTargetText(beginnerMode,beginnerPlan.rules.fragLimit)}`:'Deathmatch'} stats={planChips(beginnerPlan,beginnerMap,{reset:true})} ariaLabel={`Recommended first match: ${beginnerPlan.mode.name}, clean beginner rules, ${cap(beginnerPlan.rosterLabel)}, ${beginnerPlan.duration}, map ${beginnerMap.name}`} meta={<Play size={15}/>}/>
         {trainingCards.map(card=><SelectCard key={card.id} onClick={()=>launchTraining(card)} icon={card.icon} name={TRAINING_TITLES[card.training as keyof typeof TRAINING_TITLES]} tag={`Guided first match · ${TRAINING_STEPS[card.training as keyof typeof TRAINING_STEPS].length} lessons`} stats={planChips(card.plan,card.map,{reset:true})} ariaLabel={`${TRAINING_TITLES[card.training as keyof typeof TRAINING_TITLES]}: guided tutorial, ${cap(card.plan.rosterLabel)}, ${card.plan.duration}`} meta={<Play size={15}/>}/>)}
         <SelectCard onClick={openCustom} icon={<Sparkles size={20}/>} name="CUSTOM RULES" tag="Every mode and rule stays reachable here" stats={[<span className="card-chip" key="modes">{GAME_MODES.length} MODES</span>,<span className="card-chip" key="mutators">{MUTATORS.length} MUTATORS</span>,<span className="card-chip" key="tiers">{COCS_TIERS.length} DIRECTOR TIERS</span>,<span className="card-chip" key="saves">SAVED RULES STAY SAVED</span>]} ariaLabel="Custom rules: open match setup for every mode, arena, mutator and Director tier" meta={<ChevronRight size={15}/>}/>
        </div>
        <p className="field-note">The recommended match and the training entries rebuild clean rules — a saved mutator or Director tier cannot leak into them. Every other card shows its effective rules before you click: inherited modifiers are named, and an unsupported arena is labelled as a substitution.</p>
        <p className="eyebrow">ALL QUICK STARTS / EFFECTIVE RULES SHOWN PER CARD</p>
        <div className="grid-cards">
         {modeCards.map(card=><SelectCard key={card.id} onClick={()=>launchInstant(card)} icon={card.icon} name={cap(card.plan.mode.name)} tag={card.plan.mode.description} stats={planChips(card.plan,card.map)} ariaLabel={`${card.plan.mode.name}: ${cap(card.plan.rosterLabel)}, ${card.plan.duration}, ${card.plan.fill.auto?card.plan.fill.note:card.plan.modifiers.length?`inherits ${card.plan.modifierLabel}`:'no saved modifiers'}`} meta={<Play size={15}/>}/>)}
         {latticeCards.map(card=><SelectCard key={card.id} onClick={()=>openLattice(card)} icon={card.icon} name={cap(card.plan.mode.name)} tag={`Briefing first · ${card.plan.mode.coop?'co-op against the Director':'team territory war'}`} stats={planChips(card.plan,card.map,{reset:true})} ariaLabel={`${card.plan.mode.name}: deployment briefing, ${cap(card.plan.rosterLabel)}, ${card.plan.duration}`} meta={<ChevronRight size={15}/>}/>)}
         {singleCards.map(card=><SelectCard key={card.id} onClick={()=>launchInstant(card)} icon={card.icon} name={cap(card.plan.mode.name)} tag={card.plan.mode.description} stats={planChips(card.plan,card.map)} ariaLabel={`${card.plan.mode.name}: solo start, ${card.plan.duration}`} meta={<Play size={15}/>}/>)}
         <SelectCard onClick={()=>launchInstant(spectateCard)} icon={spectateCard.icon} name={cap(spectateCard.plan.mode.name)} tag="Cinematic AI match on the current rules" stats={planChips(spectateCard.plan,spectateCard.map)} ariaLabel={`Spectate: cinematic AI match on ${spectateCard.plan.mode.name}`} meta={<Film size={15}/>}/>
        </div>
        <p className="field-note">Starts use <b>{selected?.name}</b> and the <b>{power?.name}</b> harness. Modes that auto-fill say so on the card: Operations crews your squad and its garrison from the bot seats, soccer always fills to 2 v 2, and a 0-rival race is a solo time trial. Full rules, arenas and the Help legend live under MATCH SETUP or Graphics &amp; settings → Help.</p>
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
