'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,BookOpen,Check,ChevronRight,Crosshair,Flag,GraduationCap,Hexagon,LockKeyhole,Play,Rocket,Shield,Skull,Sparkles,Swords,Target,Film,Users,Zap} from 'lucide-react';
import type {ScreenProps} from '../contract';
import {ActionRail,Banner,Btn,Meter,Panel,Segmented,SelectCard,Shell,Stats,TopBar} from '../primitives';
import styles from './SelectionScreen.module.css';
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
  const {entered,character,chooseCharacter,CHARACTERS=[],selected,harness,setHarness,HARNESSES=[],power,powerIcon,config,start,startSpectate,setSetupOpen,setSingleOpen,changeMode,connectNet,openBrowser,netConnected,profile,demos=[],previewRef,headActions,backToDemo,notice,challenges=[],presets=[],loadPreset,deletePreset,openSettings,nextUnlocks=[]}=ui;
  const [section,setSection]=useState('play');
  const [route,setRoute]=useState('home');
  const [previewTab,setPreviewTab]=useState('model');
  const [latticeIntro,setLatticeIntro]=useState<string|null>(null);
  const contentHeading=useRef<HTMLHeadingElement>(null);
  const focusContent=useRef(false);
  const unavailable=!ui.ready||!!ui.error;
  const navigate=(nextSection:string,nextRoute='home')=>{focusContent.current=true;setSection(nextSection);setRoute(nextRoute);setLatticeIntro(null);};
  useEffect(()=>{if(focusContent.current){focusContent.current=false;contentHeading.current?.focus({preventScroll:true});document.querySelector('.shell-body')?.scrollTo({top:0,behavior:'instant'});}},[section,route,latticeIntro]);
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
   // Commit the exact previewed rules and map together; reading page state in
   // the same event would launch the previous selection before React commits.
   const launchRules=(rules:any,map:any)=>{if(unavailable)return;ui.setConfig?.(rules);ui.setMapId?.(map.id);ui.start?.({character,harness,mapId:map.id,config:rules});};
  const launchBeginner=()=>launchRules(beginnerRules,beginnerMap);
  const launchInstant=(card:any)=>{
    // Single-player owns bespoke routing on the page; everything
   // else composes the shared quick-start rules and starts them.
    if(card.id==='horde'||card.id==='campaign'){ui.quickStart?.(card.id);return;}
   launchRules(quickStartRules(config,card.id,latticePracticeDefaults(card.id)),mapChoice(card.id));
  };
  const launchTraining=(card:any)=>ui.startTraining?.(card.training);
   const openLattice=(card:any)=>{focusContent.current=true;setLatticeIntro(card.id);};
   const openCustom=()=>ui.setSetupOpen?.(true);
   const activeLattice=latticeCards.find(card=>card.id===latticeIntro);
   const title=section==='loadout'?'Make it yours.':section==='library'?'The field library.':latticeIntro?(activeLattice?.plan.mode.name??'Deployment briefing'):route==='training'?'Learn by playing.':route==='arena'?'Find your arena.':route==='solo'?'Your next challenge.':'Your next great match.';
   const subtitle=section==='loadout'?'Choose your intelligence. Pair an operator with a harness that fits your playstyle.':section==='library'?'Your recordings, progress, and everything you need to know.':latticeIntro?'Know your objective. Review your crew. Deploy when you’re ready.':route==='training'?'Protected lessons and a clean first match. Build confidence at your own pace.':route==='arena'?'Classic combat. Each launch shows the exact rules, roster, and arena.':route==='solo'?'Survive the waves or take on a mission.':'A territory war, a quick skirmish, or a session with friends. Start here.';
   const rail=<ActionRail summary={<div className={styles.currentMatch}>
    <span className={styles.kicker}>CURRENT MATCH {netConnected?'· ONLINE':''}</span>
    <strong>{railPlan.mode.name} <span> / {mapChoice(config?.mode??'deathmatch').name}</span></strong>
    <details className={styles.railDetails}><summary>Review rules</summary><div className={styles.railRules}>{planChips(railPlan,mapChoice(config?.mode??'deathmatch'))}<p>Playing as {selected?.name} · {power?.name}</p></div></details>
   </div>}>
    <Btn variant="secondary" data-setup-trigger onClick={()=>setSetupOpen(true)}><span>MATCH SETUP</span><ChevronRight size={14}/></Btn>
    <Btn variant="primary" onClick={()=>start()} disabled={unavailable}>ENTER ARENA<ArrowUpRight size={20}/></Btn>
   </ActionRail>;
   return <Shell className={`shell--showcase ${styles.menu}${entered?'':' shell--awaiting'}`} head={<TopBar sub="MAIN MENU">{headActions}</TopBar>} rail={rail}>
    <div className={styles.navigation}>
     <nav aria-label="Main menu" className={styles.navLinks}>
      {[{id:'play',label:'Play',icon:<Play size={17}/>},{id:'loadout',label:'Loadout',icon:<Shield size={17}/>},{id:'library',label:'Library',icon:<BookOpen size={17}/>}].map(item=><button type="button" key={item.id} aria-current={section===item.id?'page':undefined} onClick={()=>navigate(item.id)}>{item.icon}{item.label}</button>)}
     </nav>
     <button type="button" className={styles.helpLink} onClick={()=>openSettings?.('help')}><BookOpen size={16}/>Help &amp; controls<ArrowUpRight size={14}/></button>
    </div>
    {notice&&<Banner>{notice}</Banner>}
    <div className={styles.workspace}>
     <div className={styles.content}>
      <header className={styles.pageHeading}>
       {section==='play'&&(route!=='home'||latticeIntro)&&<button type="button" className={styles.backLink} onClick={()=>navigate('play')}><ArrowLeft size={16}/>Back to Play</button>}
       <p className={styles.kicker}>{section==='play'?'PLAY / '+(latticeIntro?'BRIEFING':route==='home'?'DISCOVER':route.toUpperCase()):section.toUpperCase()}</p>
       <h1 ref={contentHeading} tabIndex={-1}>{title}</h1><p>{subtitle}</p>
      </header>
      {section==='play'&&route==='home'&&!latticeIntro&&<>
       <section className={styles.feature} aria-labelledby="lattice-feature-title">
        <div className={styles.latticeArt} aria-hidden="true"><i/><i/><i/><i/><i/><i/><span>LINK / PUSH / HOLD</span></div>
        <div className={styles.featureCopy}><p className={styles.kicker}><Hexagon size={14}/>FEATURED EXPERIENCE</p><h2 id="lattice-feature-title">LATTICE<span>Every link is a front line.</span></h2><p>Capture the network in Strike. Hold it together against the Director in Operations.</p>
         <div className={styles.featureActions}><Btn variant="primary" onClick={()=>openLattice(latticeCards[0])}>EXPLORE LATTICE STRIKE<ArrowUpRight size={17}/></Btn><Btn variant="ghost" onClick={()=>openLattice(latticeCards[1])}>OPERATIONS · CO-OP<ChevronRight size={16}/></Btn></div>
         <span className={styles.featureFootnote}>Briefing before deployment · Clean preset rules</span>
        </div>
       </section>
       <div className={styles.routeGrid}>
        <button type="button" className={styles.routeCard} onClick={openBrowser} disabled={unavailable}><Users size={22}/><span><strong>Online</strong><small>Browse servers. Find your people.</small></span><ArrowUpRight size={18}/></button>
        <button type="button" className={styles.routeCard} onClick={()=>navigate('play','training')}><GraduationCap size={22}/><span><strong>Training</strong><small>Your first match, at your pace.</small></span><ChevronRight size={18}/></button>
        <button type="button" className={styles.routeCard} data-setup-trigger onClick={openCustom}><Sparkles size={22}/><span><strong>Custom match</strong><small>Every mode. Your arena. Your rules.</small></span><ChevronRight size={18}/></button>
       </div>
       <section className={styles.moreWays} aria-labelledby="more-ways-title"><h2 id="more-ways-title">More ways to play</h2><div>
        <button type="button" onClick={()=>navigate('play','arena')}><Crosshair size={18}/><span>Arena quick starts<small>Deathmatch, teams &amp; more</small></span><ChevronRight size={16}/></button>
        <button type="button" onClick={()=>navigate('play','solo')}><Skull size={18}/><span>Single player<small>Horde &amp; campaign</small></span><ChevronRight size={16}/></button>
        <button type="button" onClick={()=>navigate('library')}><Film size={18}/><span>Watch &amp; discover<small>Spectate, replays &amp; guides</small></span><ChevronRight size={16}/></button>
       </div></section>
       {netConnected&&<Btn variant="ghost" onClick={connectNet} disabled={unavailable}><Users size={16}/>DISCONNECT FROM SERVER</Btn>}
      </>}
      {section==='play'&&activeLattice&&<section className={styles.briefing} aria-label="LATTICE deployment briefing">
       <LatticeBriefing mode={activeLattice.id} bindings={ui.bindings}/>
       <div className={styles.rulePreview} aria-label="Deployment rules">{planChips(activeLattice.plan,activeLattice.map,{reset:true})}</div>
       {latticeRole&&<div className={styles.roleSummary}><p><b>{latticeRole.operator.role} · {latticeRole.operator.name}</b>{latticeRole.operator.description}</p><p><b>{latticeRole.harness.role} · {latticeRole.harness.name}</b>{latticeRole.harness.description}</p></div>}
       <div className="row"><Btn variant="primary" disabled={unavailable} onClick={()=>launchRules(activeLattice.rules,activeLattice.map)}>DEPLOY {activeLattice.id==='cocs-coop'?'OPERATIONS':'LATTICE STRIKE'}<ArrowUpRight size={17}/></Btn><Btn variant="secondary" onClick={()=>navigate('play','training')}><GraduationCap size={17}/>TRAIN FIRST</Btn></div>
      </section>}
      {section==='play'&&route==='training'&&!latticeIntro&&<div className={styles.activityList}>
       <SelectCard disabled={unavailable} onClick={launchBeginner} icon={<Play size={20}/>} name="RECOMMENDED FIRST MATCH" tag={beginnerMode?`${beginnerPlan.mode.name} · ${modeTargetText(beginnerMode,beginnerPlan.rules.fragLimit)}`:'Deathmatch'} stats={planChips(beginnerPlan,beginnerMap,{reset:true})} ariaLabel={`Recommended first match: ${beginnerPlan.mode.name}, clean beginner rules, ${cap(beginnerPlan.rosterLabel)}, ${beginnerPlan.duration}, map ${beginnerMap.name}`} meta={<Play size={15}/>}/>
       {trainingCards.map(card=><SelectCard disabled={unavailable} key={card.id} onClick={()=>launchTraining(card)} icon={card.icon} name={TRAINING_TITLES[card.training as keyof typeof TRAINING_TITLES]} tag={`Guided first match · ${TRAINING_STEPS[card.training as keyof typeof TRAINING_STEPS].length} lessons · protected practice`} stats={[...planChips(card.plan,card.map,{reset:true}),<span className="card-chip card-chip--accent" key="practice">PRACTICE · NO XP / CHALLENGES / HISTORY</span>]} ariaLabel={`${TRAINING_TITLES[card.training as keyof typeof TRAINING_TITLES]}: guided practice match, ${cap(card.plan.rosterLabel)}, ${card.plan.duration}, no XP, challenges or match history`} meta={<Play size={15}/>}/>)}
       <p className="field-note">These entries rebuild clean rules. Guided training protects you and your HQ while a lesson is active, and awards no XP, challenges, or match history.</p>
      </div>}
      {section==='play'&&route==='arena'&&!latticeIntro&&<div className={styles.activityList}>
       {modeCards.map(card=><SelectCard disabled={unavailable} key={card.id} onClick={()=>launchInstant(card)} icon={card.icon} name={cap(card.plan.mode.name)} tag={card.plan.mode.description} stats={planChips(card.plan,card.map)} ariaLabel={`${card.plan.mode.name}: ${cap(card.plan.rosterLabel)}, ${card.plan.duration}, ${card.plan.fill.auto?card.plan.fill.note:card.plan.modifiers.length?`inherits ${card.plan.modifierLabel}`:'no saved modifiers'}`} meta={<Play size={15}/>}/>)}
       <div className={styles.customNote}><span><b>Looking for another mode?</b>{GAME_MODES.length} modes · {MUTATORS.length} mutators · {COCS_TIERS.length} Director tiers. Custom match includes vehicle modes and every advanced rule.</span><Btn data-setup-trigger onClick={openCustom}>CUSTOM RULES<ChevronRight size={16}/></Btn></div>
      </div>}
      {section==='play'&&route==='solo'&&!latticeIntro&&<div className={styles.activityList}>
       {singleCards.map(card=><SelectCard disabled={unavailable} key={card.id} onClick={()=>launchInstant(card)} icon={card.icon} name={cap(card.plan.mode.name)} tag={card.plan.mode.description} stats={planChips(card.plan,card.map)} ariaLabel={`${card.plan.mode.name}: solo start, ${card.plan.duration}`} meta={<Play size={15}/>}/>)}
       <Btn onClick={()=>setSingleOpen(true)} disabled={unavailable}>SINGLE PLAYER HUB<ChevronRight size={16}/></Btn>
      </div>}
      {section==='loadout'&&<div className="stack">
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
      <Panel label="LOADOUT PRESETS" meta={`${presets.length} SAVED`} actions={<Btn size="sm" variant="ghost" onClick={()=>setSetupOpen(true)}>MANAGE</Btn>}>
      {presets.length?<div className="row" role="group" aria-label="Saved loadout presets">{presets.map((p:any)=><span key={p.id} className="chip preset-chip" title={`${p.character} / ${p.harness}${p.mapId?` · ${p.mapId}`:''}`}>
       <button type="button" className="text-button" aria-label={`Load preset ${p.name}`} onClick={()=>loadPreset?.(p)}>{p.name}</button>
       <button type="button" className="text-button" aria-label={`Delete preset ${p.name}`} onClick={()=>deletePreset?.(p.id)}>×</button>
       </span>)}</div>:<p className="field-note">No presets yet. Save your full loadout — operator, harness, arena, rules, gear, mods, finish and reticle — from MATCH SETUP.</p>}
      </Panel>
      <Btn onClick={()=>openSettings?.('arsenal')}><Shield size={16}/>ARSENAL · WEAPONS &amp; GEAR<ArrowUpRight size={16}/></Btn>
     </div>}
     {section==='library'&&<div className="stack">
      <div className={styles.libraryGrid}>
       <button type="button" className={styles.routeCard} onClick={()=>{changeMode('theater');ui.refreshDemos?.();}} disabled={unavailable}><Film size={22}/><span><strong>Theater</strong><small>{demos.length?`${demos.length} saved recordings`:'Replays, highlights & bookmarks'}</small></span><ArrowUpRight size={18}/></button>
       <button type="button" className={styles.routeCard} onClick={()=>openSettings?.('help')}><BookOpen size={22}/><span><strong>Field guide</strong><small>Controls, objectives &amp; mode rules</small></span><ArrowUpRight size={18}/></button>
       <button type="button" className={styles.routeCard} onClick={()=>changeMode('progression')} disabled={unavailable}><Sparkles size={22}/><span><strong>Progression</strong><small>Rank {profile?.level??1} · Unlocks &amp; match history</small></span><ArrowUpRight size={18}/></button>
       <button type="button" className={styles.routeCard} onClick={()=>openSettings?.('arsenal')}><Shield size={22}/><span><strong>Arsenal</strong><small>Compare weapons &amp; build your kit</small></span><ArrowUpRight size={18}/></button>
      </div>
      <details className={styles.disclosure}><summary>Spectate &amp; demo<Film size={17}/></summary><div className={styles.activityList}>
       <SelectCard disabled={unavailable} onClick={startSpectate} icon={spectateCard.icon} name="SPECTATE CURRENT MATCH" tag="Cinematic AI match on the current rules" stats={planChips(spectateCard.plan,spectateCard.map)} ariaLabel={`Spectate: cinematic AI match on ${spectateCard.plan.mode.name}`} meta={<Film size={15}/>}/>
       <Btn variant="ghost" onClick={backToDemo} disabled={unavailable}>BACK TO DEMO<ArrowUpRight size={16}/></Btn>
      </div></details>
      <details className={styles.disclosure}><summary>Next unlocks &amp; daily challenges<span>{challenges.filter((c:any)=>c.done).length} / {challenges.length} complete</span></summary><div className="stack">
      <Panel label="NEXT UNLOCKS" meta={nextUnlocks.length?`${nextUnlocks.length} UPCOMING`:'ALL CLAIMED'} actions={<Btn size="sm" variant="ghost" onClick={()=>changeMode('progression')}>TRACK</Btn>}>
      {nextUnlocks.length?<ul className="next-unlock-list">{nextUnlocks.map((item:any)=><li key={item.id} className="next-unlock-row">
       <span className="chip chip--accent">LV {item.level}</span>
       <span className="card-main"><span className="card-name">{item.name}<small>{String(item.kind||'').toUpperCase()}{item.description?` · ${item.description}`:''}</small></span></span>
      </li>)}</ul>:<p className="field-note">Every unlock is claimed. Prestige ranks keep earning XP.</p>}
     </Panel>
     <Panel label="DAILY CHALLENGES" meta={challenges.length?`${challenges.filter((c:any)=>c.done).length} / ${challenges.length} COMPLETE`:'ROTATING'} actions={<Btn size="sm" variant="ghost" onClick={()=>changeMode('progression')}>TRACK</Btn>}>
      {challenges.length?<div className="stack stack--tight">{challenges.map((c:any)=><div key={c.id} className="stack stack--tight challenge-row">
       <div className="row row--between"><span className="label">{c.label}</span><span className="label">{c.done?'CLAIMED':`${c.progress} / ${c.target} · +${c.reward} XP`}</span></div>
       <Meter ratio={c.target?Math.min(1,c.progress/c.target):0}/>
      </div>)}</div>:<p className="field-note">Daily objectives load with the arena. Finish matches to earn bonus XP.</p>}
     </Panel>
      </div></details>
      <div className="row"><Btn variant="ghost" onClick={()=>changeMode('changelog')} disabled={unavailable}>PATCH NOTES<ArrowUpRight size={16}/></Btn><Btn variant="ghost" onClick={()=>openSettings?.('game')}>GRAPHICS &amp; SETTINGS<ArrowUpRight size={16}/></Btn></div>
     </div>}
     </div>
     <aside className={styles.loadoutAside} aria-label="Current loadout">
      <div className={styles.asideHeading}><span className={styles.kicker}>YOUR OPERATOR</span><span className={styles.kicker}>{previewIndex} / {String(CHARACTERS.length).padStart(2,'0')}</span></div>
      {/* Keep this host mounted across every menu route: the renderer measures it each frame. */}
      <div ref={previewRef} className={`preview-stage ${styles.preview}`} aria-label={`${selected?.name} animated 3D model and kit preview`}>
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
         <div className="row row--between"><p className="field-note preview-kit-combo">{kit?.combo}</p>{openSettings&&<Btn size="sm" variant="ghost" onClick={()=>openSettings('arsenal')}><Shield size={14}/>OPEN ARSENAL</Btn>}</div>
        </div>}
      </div>
      <div className={styles.loadoutIdentity}>
       <div>{wing&&<span className="chip chip--wing" style={{color:wing.color,borderColor:`${wing.color}80`}}>{wing.label}</span>}<span>{selectedCard?.roleLabel}</span></div>
       <p><Shield size={16}/><strong>{power?.name}</strong><span>{power?.power}</span></p>
       {latticeRole&&<p className={styles.asideRole}>{latticeRole.operator.role} / {latticeRole.harness.role}</p>}
       <Btn variant="secondary" onClick={()=>section==='loadout'?openSettings?.('arsenal'):navigate('loadout')}>{section==='loadout'?'OPEN ARSENAL':'EDIT LOADOUT'}<ChevronRight size={16}/></Btn>
      </div>
      <p className={styles.asideNote}>Your operator and harness travel with you into every match.</p>
     </aside>
    </div>
  </Shell>;
}
