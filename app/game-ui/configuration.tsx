'use client';
import {useEffect,useState} from 'react';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {DEFAULT_CONFIG,DEFAULT_DISPLAY,GAME_MODES,DIFFICULTIES} from '../../game/config.mjs';
import {maxBotsFor} from '../../game/arenas.mjs';
import {objectiveCopy} from '../../game/hud.mjs';
import {WEAPONS} from '../../game/data.mjs';
import {QUICK_MATCH_PRESETS,presetConfig} from '../../game/replay.mjs';
import {DISPLAY_PRESETS,applyDisplayPreset,normalizeAccessibility,paletteOptions,teamColorsFor} from '../../game/presets.mjs';
import {DEFAULT_BINDINGS,KEYBIND_ACTIONS,KEYBIND_OPTIONS,rebindAction} from '../../game/keybinds.mjs';

const SCORE_RULES:any={
 laps:{label:'Lap limit',objective:'LAPS',min:1,max:10,step:1},
 goals:{label:'Goal limit',objective:'GOALS',min:1,max:15,step:1},
 frags:{label:'Frag limit',objective:'FRAGS',min:5,max:50,step:5},
 captures:{label:'Capture limit',objective:'FLAG CAPTURES',min:1,max:10,step:1},
 teamFrags:{label:'Team-frag limit',objective:'TEAM FRAGS',min:5,max:50,step:5},
 hillTime:{label:'Hill time target',objective:'HILL CONTROL',min:30,max:300,step:10},
 zoneTime:{label:'Zone time target',objective:'CONTROL ZONES',min:30,max:300,step:10},
 sectors:{label:'Sector count',objective:'SECTORS',min:1,max:9,step:1},
 payload:{label:'Checkpoint count',objective:'CHECKPOINTS',min:1,max:6,step:1},
 ladder:{label:'Weapons in the rack',objective:'WEAPON LADDER',min:10,max:10,step:1},
};
const scoreRule=(mode:any)=>SCORE_RULES[mode?.rules?.score]||SCORE_RULES.frags;
const LOCK_COPY:any={
 instagib:'Instagib locks the rail gun with unlimited ammo. No pickups, no powers, no mercy — one unprotected hit eliminates.',
 rockets:'Rocket Arena locks the rocket launcher with unlimited ammo. Health and armor stay active, so control the blast zone.',
 arsenal:'Full Arsenal unlocks every weapon with unlimited ammo from the first spawn. Pick the right gun for each fight.',
};

function Choice({label,value,options,onChange,disabled=false}:any){return <div className="config-field"><span>{label}</span><Select value={String(value)} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent className="arena-select">{options.map((o:any)=><SelectItem key={o[0]} value={String(o[0])}>{o[1]}</SelectItem>)}</SelectContent></Select></div>;}
function Range({label,value,min,max,step=1,onChange,suffix=''}:any){return <div className="config-field"><label>{label}<output>{value}{suffix}</output></label><Slider aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={([v])=>onChange(v)}/></div>;}
function Toggle({label,checked,onChange,disabled=false}:any){return <label className="config-toggle"><span>{label}</span><Switch aria-label={label} checked={checked} onCheckedChange={onChange} disabled={disabled}/></label>;}
const KEY_LABEL=(code:string)=>String(code||'?').replace(/^Key/,'').replace(/^Digit/,'').replace(/^Arrow/,'').replace('ShiftLeft','Shift').replace('ShiftRight','ShiftR').replace('ControlLeft','Ctrl').replace('ControlRight','CtrlR').replace('AltLeft','Alt').replace('AltRight','AltR');

// Full keyboard remapping. Each action is a button that arms a one-shot key
// capture; the next valid key is bound (occupied keys swap automatically via
// rebindAction). A select fallback stays available for keyboard-only users who
// prefer not to press the target key. Every control is focusable and labelled.
export function KeybindsConfiguration({bindings,onChange,conflicts=[]}:any){
 const [capturing,setCapturing]=useState<string|null>(null);
 useEffect(()=>{
  if(!capturing)return;
  const onKey=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();setCapturing(null);return;}
   if(e.repeat)return;
   e.preventDefault();
   const code=e.code;
   if(KEYBIND_OPTIONS.includes(code)){onChange(rebindAction(bindings,capturing,code));setCapturing(null);}
  };
  window.addEventListener('keydown',onKey,{capture:true});
  return()=>window.removeEventListener('keydown',onKey,{capture:true});
 },[capturing,bindings,onChange]);
 const patch=(action:string,code:string)=>onChange(rebindAction(bindings,action,code));
 return <div className="config-block keybinds-configuration"><h3>Controls</h3>
  <p className="config-note">Select an action, then press any key to bind it. Escape cancels; occupied keys swap automatically.</p>
  <div className="keybind-grid" role="group" aria-label="Keyboard bindings">
   {KEYBIND_ACTIONS.map(action=>{const code=bindings?.[action]??(DEFAULT_BINDINGS as any)[action];const armed=capturing===action;return <div key={action} className={`keybind-row${armed?' capturing':''}`}>
    <span style={{minWidth:0}}>{action}</span>
    <button type="button" className="keybind-key" aria-label={`Rebind ${action}, currently ${KEY_LABEL(code)}`} aria-pressed={armed} onClick={()=>setCapturing(armed?null:action)}>{armed?'PRESS A KEY…':KEY_LABEL(code)}</button>
    <select aria-label={`${action} key`} value={code} onChange={e=>patch(action,e.target.value)}>{KEYBIND_OPTIONS.map(option=><option key={option} value={option}>{KEY_LABEL(option)}</option>)}</select>
   </div>;})}
  </div>
  {conflicts.length?<p className="config-note" role="alert">Duplicate keys: {conflicts.join(', ')}</p>:<p className="config-note">One key per action; choosing an occupied key swaps the two actions.</p>}
  <button className="text-button" onClick={()=>{setCapturing(null);onChange({...DEFAULT_BINDINGS});}}>RESET KEYS</button>
 </div>;
}

// Accessibility panel: the richer colour-vision palettes plus a high-contrast
// UI switch. The page owns the accessibility state and passes it down; this
// component is a pure view of it.
export function AccessibilityConfiguration({accessibility,onChange}:any){
 const value=normalizeAccessibility(accessibility);
 const set=(patch:any)=>onChange(normalizeAccessibility({...value,...patch}));
 return <div className="config-block accessibility-configuration"><h3>Accessibility</h3>
  <div className="config-field"><span>Colour vision palette</span>
   <div className="palette-options" role="radiogroup" aria-label="Colour vision palette">
    {paletteOptions().map(option=>{const colors=teamColorsFor(option.id),active=value.palette===option.id;return <button key={option.id} type="button" role="radio" aria-checked={active} aria-label={`${option.name}: ${option.detail}`} className={`palette-option${active?' active':''}`} onClick={()=>set({palette:option.id})}>
     <span className="palette-swatches" aria-hidden="true"><i style={{background:colors[0]}}/><i style={{background:colors[1]}}/></span>
     <span className="palette-main"><strong>{option.name}</strong><small>{option.detail}</small></span>
    </button>;})}
   </div>
  </div>
  <Toggle label="High-contrast UI" checked={value.highContrast===true} onChange={(v:boolean)=>set({highContrast:v})}/>
  <p className="config-note">Palettes recolor team markers, the radar and score banners; the 3D arena swaps to its safe team colours. High contrast strengthens borders, text and focus rings across every menu.</p>
 </div>;
}

export function PresetsConfiguration({presets=[],onSave,onLoad,onDelete}:any){const [name,setName]=useState('');return <div className="config-block presets-configuration"><h3>Loadout presets</h3><div className="preset-save"><input aria-label="Preset name" placeholder="Preset name" maxLength={24} value={name} onChange={e=>setName(e.target.value)}/><button className="secondary-button" onClick={()=>{onSave?.(name);setName('');}}>SAVE CURRENT</button></div>{presets.length?<div className="preset-list">{presets.map((p:any)=><div key={p.id} className="preset-row" style={{flexWrap:'wrap'}}><span style={{minWidth:0}}>{p.name}<small>{p.character} / {p.harness}{p.mapId?` · ${p.mapId}`:''}</small></span><div className="preset-actions"><button className="text-button" aria-label={`Load preset ${p.name}`} onClick={()=>onLoad?.(p)}>LOAD</button><button className="text-button" aria-label={`Delete preset ${p.name}`} onClick={()=>onDelete?.(p.id)}>DELETE</button></div></div>)}</div>:<p className="config-note">Save your operator, harness, arena and rules for one-tap recall.</p>}</div>;}

export function MatchConfiguration({config,onChange,excludeModes=[]}:any){const patch=(key:string,value:any)=>onChange({...config,[key]:value});const mode=GAME_MODES.find(m=>m.id===config.mode)!;const rules:any=mode?.rules||{};const target=scoreRule(mode);const selectMode=(id:string)=>{const next:any=GAME_MODES.find(m=>m.id===id);onChange({...config,mode:id,...(id==='puma-race'&&config.mode!==id?{botCount:7}:{}),...(id==='puma-soccer'&&config.mode!==id?{botCount:3}:{}),...(next?.rules?.fragLimit!==undefined?{fragLimit:next.rules.fragLimit}: {})});};return <section id="match-setup" className="match-configuration">
 <div className="section-label"><span>03 / MATCH SETUP</span><button className="text-button" onClick={()=>onChange({...DEFAULT_CONFIG,playerName:config.playerName})}>RESET MATCH RULES</button></div>
 <div className="quick-presets" role="group" aria-label="Quick match presets"><span className="eyebrow">QUICK MATCH PRESETS</span><div>{QUICK_MATCH_PRESETS.map(p=><button key={p.id} onClick={()=>onChange(presetConfig(p.id,config))}><strong>{p.name}</strong><small>{p.detail}</small></button>)}</div><p>Fresh rules; keeps your callsign, operator and arena.</p></div>
       <RadioGroup className="mode-options mode-options--chips" aria-label="Game mode" value={config.mode} onValueChange={selectMode}>{GAME_MODES.filter((m:any)=>!excludeModes.includes(m.id)).map(m=>{const modeRules:any=m.rules||{},modeTarget=scoreRule(m);return <label className={`mode-option ${config.mode===m.id?'selected':''}`} key={m.id} htmlFor={`mode-${m.id}`}><div><strong>{m.name}</strong><small>{m.description}</small><em>{modeRules.team?'TEAM':'SOLO'} / {modeTarget.objective}</em></div><RadioGroupItem id={`mode-${m.id}`} value={m.id} aria-label={m.name}/></label>})}</RadioGroup>
 <div className="mode-detail" role="status"><span className="label">{rules.team?'TEAM':'SOLO'} · {target.objective} · {mode.name}</span><p>{mode.description}</p></div>
 {config.mode==='puma-race'?<div className="config-grid"><div className="config-block"><h3>Race rules</h3><Range label="Rival drivers" value={config.botCount} min={0} max={7} onChange={(v:number)=>patch('botCount',v)}/><Range label="Lap limit" value={config.fragLimit} min={1} max={10} onChange={(v:number)=>patch('fragLimit',v)}/><Range label="Time limit" value={config.timeLimit/60} min={1} max={15} suffix=" min" onChange={(v:number)=>patch('timeLimit',v*60)}/><label className="config-field">Your callsign<input aria-label="Your callsign" maxLength={20} value={config.playerName} onChange={e=>patch('playerName',e.target.value)}/></label></div><div className="config-block"><h3>Equal Puma chassis</h3><p>{objectiveCopy('laps')}</p><p>WASD throttle / steer. Space or crouch handbrake. Shift chassis boost. Fire or power uses your held item; interact resets to your checkpoint.</p><p>Choose 0 to 7 AI rival drivers; zero means no AI opponents. In online races, human drivers replace excess bots to keep the grid capped at 8 racers. Combat modifiers, weapons and harness powers are disabled.</p></div></div>:config.mode==='puma-soccer'?<div className="config-grid"><div className="config-block"><h3>Soccer rules</h3><p className="config-static">2 v 2 &mdash; four Pumas total. Empty seats are filled by bots.</p><Range label="Goal limit" value={config.fragLimit} min={1} max={15} onChange={(v:number)=>patch('fragLimit',v)}/><Range label="Time limit" value={config.timeLimit/60} min={1} max={15} suffix=" min" onChange={(v:number)=>patch('timeLimit',v*60)}/><label className="config-field">Your callsign<input aria-label="Your callsign" maxLength={20} value={config.playerName} onChange={e=>patch('playerName',e.target.value)}/></label></div><div className="config-block"><h3>Equal Puma chassis</h3><p>{objectiveCopy('goals')||'Smash the ball into the enemy goal. First team to the goal target wins; the clock decides a draw.'}</p><p>WASD throttle / steer. Space or crouch handbrake. Shift chassis boost. Interact resets to your kickoff spot. Boards ring the pitch so the ball stays in play.</p><p>Bots fill the empty seats, so it is always two against two. Combat modifiers, weapons and harness powers are disabled.</p></div></div>:<div className="config-grid">
  <div className="config-block"><h3>Opponents</h3><Range label="Bot count" value={config.botCount} min={0} max={maxBotsFor(config.mode)} onChange={(v:number)=>patch('botCount',v)}/><Choice label="Bot difficulty" value={config.difficulty} options={DIFFICULTIES.map(d=>[d.id,d.name])} onChange={(v:string)=>patch('difficulty',v)} disabled={config.botCount===0}/><p>{config.botCount===0?'Solo practice: explore and test weapons until the timer ends.':DIFFICULTIES.find(d=>d.id===config.difficulty)?.description} Bots use their operator's health, armor and speed, with the same match modifiers as players.</p><label className="config-field">Your callsign<input aria-label="Your callsign" maxLength={20} placeholder="Use operator name" value={config.playerName} onChange={e=>patch('playerName',e.target.value)}/></label></div>
   <div className="config-block"><h3>Match rules</h3><Range label={target.label} value={config.fragLimit} min={target.min} max={target.max} step={target.step} onChange={(v:number)=>patch('fragLimit',v)}/><Range label="Time limit" value={config.timeLimit/60} min={1} max={15} suffix=" min" onChange={(v:number)=>patch('timeLimit',v*60)}/><Range label="Respawn delay" value={config.respawn} min={1} max={5} suffix=" sec" onChange={(v:number)=>patch('respawn',v)}/><Choice label="Starting weapon" value={config.startingWeapon} options={WEAPONS.map((w,i)=>[i,w.name])} onChange={(v:string)=>patch('startingWeapon',Number(v))} disabled={config.mode!=='deathmatch'}/><p>{objectiveCopy(rules.score)||LOCK_COPY[config.mode]||(config.mode!=='deathmatch'?`${mode.name} controls spawn weapons and ammunition.`:'Your chosen weapon is restored on every spawn.')}</p></div>
 <div className="config-block"><h3>Modifiers</h3><div className="config-toggle-grid"><Choice label="Movement speed" value={config.speed} options={[[.75,'0.75× • tactical'],[1,'1× • classic'],[1.25,'1.25× • fast'],[1.5,'1.5× • turbo']]} onChange={(v:string)=>patch('speed',Number(v))}/><Choice label="Gravity" value={config.gravity} options={[[1,'Normal'],[.7,'Light • 70%'],[.4,'Moon • 40%']]} onChange={(v:string)=>patch('gravity',Number(v))}/><Choice label="Damage multiplier" value={config.damage} options={[[.5,'0.5×'],[1,'1×'],[1.5,'1.5×'],[2,'2×']]} onChange={(v:string)=>patch('damage',Number(v))} disabled={config.mode==='instagib'}/><Toggle label="Unlimited unlocked ammo" checked={config.unlimitedAmmo} onChange={(v:boolean)=>patch('unlimitedAmmo',v)}/><Toggle label="Half ability cooldowns" checked={config.fastPowers&&config.mode!=='instagib'} onChange={(v:boolean)=>patch('fastPowers',v)} disabled={config.mode==='instagib'}/><Toggle label="Life steal • heal 25% of damage" checked={config.lifeSteal} onChange={(v:boolean)=>patch('lifeSteal',v)}/><Toggle label="Sudden death on a tie at time" checked={config.suddenDeath===true} onChange={(v:boolean)=>patch('suddenDeath',v)}/><Toggle label="Random starting weapon" checked={config.randomLoadout===true} onChange={(v:boolean)=>patch('randomLoadout',v)}/><Toggle label="One-shot kills" checked={config.oneShot===true} onChange={(v:boolean)=>patch('oneShot',v)} disabled={config.mode==='instagib'}/><Toggle label="Bounty on sprees" checked={config.bounty===true} onChange={(v:boolean)=>patch('bounty',v)}/><Toggle label="Berserk • +20% damage at 3 streak" checked={config.berserk===true} onChange={(v:boolean)=>patch('berserk',v)}/></div></div>
 </div>}<p className="config-note">Saved on this device. Match rules apply when you enter the arena or start a new match.</p>
 </section>;}
export function DisplayConfiguration({display,onChange}:any){const patch=(key:string,value:any)=>onChange({...display,[key]:value});return <div className="config-block display-configuration"><h3>View & crosshair</h3>
  <div className="display-presets" role="group" aria-label="Display presets">{DISPLAY_PRESETS.map(preset=><button key={preset.id} type="button" onClick={()=>onChange(applyDisplayPreset(display,preset.id))}><strong>{preset.name}</strong><small>{preset.detail}</small></button>)}</div>
  <Range label="Resolution scale" value={Math.round((display.resolutionScale??1)*100)} min={50} max={150} step={10} suffix="%" onChange={(v:number)=>patch('resolutionScale',v/100)}/>
  <p className="config-note">Lower for better performance; raise for a sharper 3D image. Text and crosshair stay full-resolution. 100% uses the standard render resolution: up to 1.5× device density in WebGL, or 0.85× in CPU fallback.</p>
  <Toggle label="Post-processing effects (glow & vignette)" checked={display.postFx!==false} onChange={(v:boolean)=>patch('postFx',v)}/>
  <Range label="Glow strength" value={Math.round((display.bloom??.34)*100)} min={0} max={100} step={5} suffix="%" onChange={(v:number)=>patch('bloom',v/100)}/>
  <Range label="Brightness" value={Math.round((display.exposure??1.15)*100)} min={60} max={180} step={5} suffix="%" onChange={(v:number)=>patch('exposure',v/100)}/>
  <p className="config-note">Glow is independent of resolution scale. Turn post-processing off entirely, or drop glow strength to 0%, if the bloom is too strong.</p>
 <Choice label="Resolution cap" value={display.resolutionCap??'auto'} options={[['auto','Auto'],['1080p','1080p'],['1440p','1440p'],['native','Native']]} onChange={(v:string)=>patch('resolutionCap',v)}/><Choice label="Detail level" value={display.quality??'auto'} options={[['auto','Auto'],['low','Low'],['medium','Medium'],['high','High']]} onChange={(v:string)=>patch('quality',v)}/><Range label="Field of view" value={display.fov} min={65} max={110} suffix="°" onChange={(v:number)=>patch('fov',v)}/><Choice label="Crosshair shape" value={display.crosshair} options={['cross','dot','ring','chevron','split'].map(v=>[v,v[0].toUpperCase()+v.slice(1)])} onChange={(v:string)=>patch('crosshair',v)}/><p className="config-note">Team colours and high contrast moved to the Accessibility panel below.</p><Range label="Crosshair size" value={display.size} min={.6} max={1.8} step={.1} suffix="×" onChange={(v:number)=>patch('size',v)}/><div className="crosshair-editor"><label>Crosshair color<input type="color" aria-label="Crosshair color" value={display.color} onChange={e=>patch('color',e.target.value)}/></label><div className="crosshair-preview"><div className={`crosshair shape-${display.crosshair}`} style={{'--crosshair-color':display.color,'--crosshair-size':display.size} as any}><span/><span/><span/><span/></div></div></div><Toggle label="Show weapon model" checked={display.showWeapon} onChange={(v:boolean)=>patch('showWeapon',v)}/><Toggle label="Show FPS counter" checked={display.showFps} onChange={(v:boolean)=>patch('showFps',v)}/><Toggle label="Invert vertical look" checked={display.invertY===true} onChange={(v:boolean)=>patch('invertY',v)}/><Toggle label="Subtitles / audio captions" checked={display.captions===true} onChange={(v:boolean)=>patch('captions',v)}/><Toggle label="Show kill feed" checked={display.showKillFeed!==false} onChange={(v:boolean)=>patch('showKillFeed',v)}/><Toggle label="Show damage numbers" checked={display.showDamageNumbers!==false} onChange={(v:boolean)=>patch('showDamageNumbers',v)}/><Toggle label="Show radar" checked={display.showRadar!==false} onChange={(v:boolean)=>patch('showRadar',v)}/><Range label="ADS sensitivity" value={display.adsSensitivity??.85} min={.2} max={1.5} step={.05} suffix="×" onChange={(v:number)=>patch('adsSensitivity',v)}/><Range label="Touch sensitivity" value={display.touchSensitivity??1} min={.3} max={3} step={.1} suffix="×" onChange={(v:number)=>patch('touchSensitivity',v)}/><Choice label="Effects quality" value={display.effectsQuality??'auto'} options={[['auto','Auto'],['low','Low'],['medium','Medium'],['high','High']]} onChange={(v:string)=>patch('effectsQuality',v)}/><Range label="Camera shake" value={display.cameraShake??1} min={0} max={1.5} step={.1} suffix="×" onChange={(v:number)=>patch('cameraShake',v)}/><Range label="Weapon bob" value={display.weaponBob??1} min={0} max={1.5} step={.1} suffix="×" onChange={(v:number)=>patch('weaponBob',v)}/><Toggle label="Reduce motion" checked={display.reducedMotion===true} onChange={(v:boolean)=>patch('reducedMotion',v)}/><p className="config-note">While Reduce motion is on: ADS snaps in immediately, weapon kick and sway stay still, and character foot stride freezes. Camera shake and decorative motion stay off.</p><p className="config-note">Covers image quality (resolution scale, glow, brightness), readability (crosshair, team colours, kill feed, damage numbers, radar) and accessibility (subtitles, reduce motion, colourblind palette, touch sensitivity).</p><button className="text-button" onClick={()=>onChange({...DEFAULT_DISPLAY})}>RESET VIEW</button></div>;}
