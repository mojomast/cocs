'use client';
import {memo,useRef,useState} from 'react';
import {Btn,Segmented} from '../primitives';
import type {useGraphicsLab,GraphicsLabSettings} from '../useGraphicsLab';
import {GRAPHICS_EFFECTS,GRAPHICS_LAB_HOTKEY_LABEL,GRAPHICS_LAB_TARGETS,GRAPHICS_LAB_VERSION,GRAPHICS_PALETTES,GRAPHICS_RECIPES,defaultGraphicsLab,graphicsRecipe,normalizeGraphicsLab,randomGraphicsLab,serializeGraphicsLab} from '../../../game/graphics-lab.mjs';
import {mothAssetsStatus} from '../../../game/moth-assets.mjs';

type TargetId='world'|'weapon'|'bots';
type Stack=GraphicsLabSettings['targets']['weapon'];
type EffectSetting=GraphicsLabSettings['effects'][string];
const TARGETS=GRAPHICS_LAB_TARGETS as readonly TargetId[];
const TARGET_COPY:Record<TargetId,{label:string;master:string;note:string}>={
 world:{label:'WORLD',master:'',note:''},
 weapon:{label:'WEAPON',master:'Give the weapon its own stack',note:'Off, the first-person weapon stays crisp. On, this stack styles only the weapon.'},
 bots:{label:'BOTS',master:'Style bots separately',note:'Off, bots take the world stack. On, this stack styles them instead.'},
};
// One short line for the recipe card when a look ships per-target styling.
// Recipe targets are partial, so the master switch is what counts here; the
// effect entries may be the numeric shorthand.
const recipeStyleNote=(recipe:unknown)=>{
 const targets=(recipe as {targets?:Partial<Record<'weapon'|'bots',{enabled?:boolean}>>}).targets;
 if(!targets)return '';
 const enabled=(id:'weapon'|'bots')=>targets[id]?.enabled===true;
 const weapon=enabled('weapon'),bots=enabled('bots');
 if(weapon&&bots)return 'Includes weapon and bot styling.';
 if(weapon)return 'Includes a weapon stack.';
 if(bots)return 'Includes a bot stack.';
 return '';
};

function GraphicsLabPanelView({lab}:{lab?:ReturnType<typeof useGraphicsLab>}){
 const [recipeIndex,setRecipeIndex]=useState(0);
 const [message,setMessage]=useState('');
 const [importOpen,setImportOpen]=useState(false);
 const [importText,setImportText]=useState('');
 const [target,setTarget]=useState<TargetId>('world');
 const importRef=useRef<HTMLTextAreaElement>(null);
 if(!lab)return null;
 const {value:s,update,supported,storageNotice}=lab;
 // The selected stack: world keeps the top-level fields; weapon and bots use
 // their own master, mix, palette and effect table.
 const stack:Stack=target==='world'?{enabled:s.enabled,mix:s.mix,palette:s.palette,effects:s.effects}:s.targets[target];
 // The master status stays about the world stack; the count under 02 follows
 // whichever target is being edited.
 const worldLayers=GRAPHICS_EFFECTS.filter(e=>s.effects[e.id].enabled).length;
 const active=GRAPHICS_EFFECTS.filter(e=>stack.effects[e.id].enabled);
 const controlsDisabled=target!=='world'&&!stack.enabled;
 const patch=(p:Partial<GraphicsLabSettings>)=>update(v=>({...v,...p}));
 const patchTarget=(p:{enabled?:boolean;mix?:number;palette?:string})=>update(v=>{
  if(target==='weapon')return {...v,targets:{...v.targets,weapon:{...v.targets.weapon,...p}}};
  if(target==='bots')return {...v,targets:{...v.targets,bots:{...v.targets.bots,...p}}};
  return {...v,...p};
 });
 const effect=(id:string,p:Partial<EffectSetting>)=>update(v=>{
  if(target==='weapon'){
   const current=v.targets.weapon;
   return {...v,targets:{...v.targets,weapon:{...current,effects:{...current.effects,[id]:{...current.effects[id],...p}}}}};
  }
  if(target==='bots'){
   const current=v.targets.bots;
   return {...v,targets:{...v.targets,bots:{...current,effects:{...current.effects,[id]:{...current.effects[id],...p}}}}};
  }
  return {...v,effects:{...v.effects,[id]:{...v.effects[id],...p}}};
 });
 // Catalogue entries may offer baked-asset choices; these read them without
 // widening the generated settings type.
 const layerOptions=(e:unknown):readonly {id:string;label:string}[]=>((e as {options?:readonly {id:string;label:string}[]}).options??[]);
 const layerLabel=(e:unknown,fallback:string):string=>(e as {assetLabel?:string}).assetLabel??fallback;
 const settingOption=(setting:EffectSetting,options:readonly {id:string}[])=>{const chosen=(setting as {option?:string}).option;return options.some(o=>o.id===chosen)?chosen:options[0]?.id??'';};
 const setOption=(id:string,option:string)=>update(v=>{
  if(target==='weapon'){
   const current=v.targets.weapon;
   return {...v,targets:{...v.targets,weapon:{...current,effects:{...current.effects,[id]:{...current.effects[id],option} as EffectSetting}}}};
  }
  if(target==='bots'){
   const current=v.targets.bots;
   return {...v,targets:{...v.targets,bots:{...current,effects:{...current.effects,[id]:{...current.effects[id],option} as EffectSetting}}}};
  }
  return {...v,effects:{...v.effects,[id]:{...v.effects[id],option} as EffectSetting}};
 });
 const apply=(index:number)=>{const i=(index+GRAPHICS_RECIPES.length)%GRAPHICS_RECIPES.length;setRecipeIndex(i);update(graphicsRecipe(GRAPHICS_RECIPES[i].id));setMessage(`${GRAPHICS_RECIPES[i].name} loaded. Tweak or stack any effects below.`);};
 const randomize=()=>{setRecipeIndex(-1);update(randomGraphicsLab(Math.random));setMessage('Rolled a new mix. Press again to keep rolling, or tune the layers below.');};
 const copyRecipe=async()=>{
  const text=serializeGraphicsLab(s);
  try{await navigator.clipboard.writeText(text);setMessage('Recipe copied. Paste it into the chat when you want it decoded or tuned.');}
  catch{
   setImportText(text);setImportOpen(true);
   requestAnimationFrame(()=>{importRef.current?.focus();importRef.current?.select();});
   setMessage('Clipboard blocked here — the JSON is selected in the paste box; press Ctrl/Cmd+C.');
  }
 };
 const exportRecipe=()=>{
  const blob=new Blob([serializeGraphicsLab(s)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='cocs-graphics-recipe.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  setMessage('Recipe downloaded. Keep it to share your preferred look.');
 };
 const applyJson=()=>{
  if(!importText.trim()){setMessage('Paste a recipe JSON first.');return;}
  try{
   const parsed=JSON.parse(importText);
   if(parsed?.version!==GRAPHICS_LAB_VERSION)throw new Error('version');
   update(normalizeGraphicsLab(parsed));setRecipeIndex(-1);setMessage('Recipe applied from JSON.');
  }catch{setMessage('That is not a readable graphics-lab recipe.');}
 };
 const restoreDefault=()=>{update(defaultGraphicsLab());setRecipeIndex(-1);setTarget('world');setMessage('Default look restored: electric world with contrast and crosshatch, circuit weapon, ink bots.');};
 return <div className="graphics-lab" data-graphics-lab>
  <div className="graphics-lab__intro"><span className="graphics-lab__badge">DEVELOPER PREVIEW / 01</span><p>Art direction, live. Stack effects, find a flavor, then take it into the arena.</p></div>
  <div className="graphics-lab__master">
   <label><input type="checkbox" checked={s.enabled} disabled={supported===false} onChange={e=>patch({enabled:e.target.checked})}/> Enable graphics lab</label>
   <span>{supported===false?'WEBGL REQUIRED':!s.enabled?'ORIGINAL':s.bypass?'BYPASSED':`${worldLayers} LAYERS`}</span>
  </div>
  <p className="graphics-lab__hotkeys"><b>{GRAPHICS_LAB_HOTKEY_LABEL}</b> toggles the lab from anywhere · <b>Shift+{GRAPHICS_LAB_HOTKEY_LABEL}</b> opens this drawer</p>
  {supported===false&&<p className="field-note">The software fallback cannot run shader effects. Your recipe is kept for a WebGL session.</p>}
  {supported!==false&&!mothAssetsStatus().active&&<p className="field-note">No baked Moth assets in this session, so Moth grain, Signal glyphs, and Spectral coat stay off. Every other layer still works.</p>}
  {storageNotice&&<p className="field-note">{storageNotice}</p>}
  <div className="graphics-lab__compare">
   <Btn aria-pressed={s.bypass} onClick={()=>patch({bypass:!s.bypass})} disabled={!s.enabled}>{s.bypass?'SHOW MY MIX':'A/B · SHOW ORIGINAL'}</Btn>
   {target==='world'&&<label><input type="checkbox" checked={s.split} onChange={e=>patch({split:e.target.checked})}/> Split comparison</label>}
  </div>
  {target==='world'&&s.split&&<label className="graphics-lab__range">Original ← divider → styled <output>{Math.round(s.splitAt*100)}%</output><input aria-label="Comparison divider" type="range" min=".1" max=".9" step=".01" value={s.splitAt} onChange={e=>patch({splitAt:Number(e.target.value)})}/></label>}
  <div className="graphics-lab__actions graphics-lab__actions--lead">
   <Btn onClick={randomize} disabled={supported===false}>SURPRISE ME ↻</Btn>
   <Btn onClick={copyRecipe} disabled={supported===false}>COPY RECIPE</Btn>
  </div>
  <section className="graphics-lab__recipes" aria-label="Starting recipes">
   <div className="graphics-lab__section-title"><b>01 / STARTING RECIPES</b><span>{recipeIndex>=0?`${recipeIndex+1} / ${GRAPHICS_RECIPES.length}`:'CUSTOM MIX'}</span></div>
   <p className="field-note">Loading a recipe replaces the mix, including any weapon or bot stack it ships. Individual layer switches below are independent.</p>
   <div className="graphics-lab__recipe-grid">{GRAPHICS_RECIPES.map((p,i)=><button type="button" key={p.id} onClick={()=>apply(i)} className={`graphics-lab__recipe${recipeIndex===i?' is-selected':''}`}>
    <span className="graphics-lab__swatch" aria-hidden="true" style={{background:`linear-gradient(125deg,${GRAPHICS_PALETTES.find(c=>c.id===p.palette)!.colors.join(',')})`}}/><b>{p.name}</b>
   </button>)}</div>
   {recipeIndex>=0?<p className="field-note">{GRAPHICS_RECIPES[recipeIndex].description}{recipeStyleNote(GRAPHICS_RECIPES[recipeIndex])?` ${recipeStyleNote(GRAPHICS_RECIPES[recipeIndex])}`:''}</p>:<p className="field-note">A custom roll. Tune any layer below, copy the recipe, or roll again.</p>}
   <div className="graphics-lab__actions"><Btn onClick={()=>apply(recipeIndex-1)}>← PREVIOUS LOOK</Btn><Btn onClick={()=>apply(recipeIndex+1)}>NEXT LOOK →</Btn></div>
  </section>
  <div className="graphics-lab__section-title"><b>02 / STACK YOUR LAYERS</b><span>{active.length} / {GRAPHICS_EFFECTS.length}</span></div>
  <Segmented value={target} onChange={v=>setTarget(v as TargetId)} options={TARGETS.map(id=>({value:id,label:TARGET_COPY[id].label}))} ariaLabel="Styling target"/>
  {target!=='world'&&<section className="graphics-lab__target-master">
   <label><input type="checkbox" checked={stack.enabled} onChange={e=>patchTarget({enabled:e.target.checked})}/> {TARGET_COPY[target].master}</label>
   <p className="field-note">{TARGET_COPY[target].note}{!stack.enabled?' The controls below stay as they are; enable to apply them.':''}</p>
  </section>}
  <div className={`graphics-lab__stack${controlsDisabled?' is-dimmed':''}`}>
   <label className="graphics-lab__range">{target==='world'?'Overall mix':`${TARGET_COPY[target].label} mix`} <output>{Math.round(stack.mix*100)}%</output><input aria-label={target==='world'?'Overall mix':`${TARGET_COPY[target].label} mix`} type="range" min="0" max="1" step=".01" value={stack.mix} disabled={controlsDisabled} onChange={e=>patchTarget({mix:Number(e.target.value)})}/></label>
   <label className="graphics-lab__palette">Ink / midtone / paper palette<select disabled={controlsDisabled} value={stack.palette} onChange={e=>patchTarget({palette:e.target.value})}>{GRAPHICS_PALETTES.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <div className="graphics-lab__layers">{GRAPHICS_EFFECTS.map(e=>{
    const setting=stack.effects[e.id];
    const options=layerOptions(e);
    return <section className={`graphics-lab__layer${setting.enabled?' is-on':''}`} key={e.id}>
     <label className="graphics-lab__layer-switch"><input type="checkbox" checked={setting.enabled} disabled={controlsDisabled} onChange={ev=>effect(e.id,{enabled:ev.target.checked})}/><b>{e.name}</b><span>{setting.enabled?'ON':'OFF'}</span></label>
     <p>{e.description}</p>
     {options.length>0&&<label className="graphics-lab__option">{layerLabel(e,`${e.name} asset`)}<select aria-label={layerLabel(e,`${e.name} asset`)} disabled={controlsDisabled} value={settingOption(setting,options)} onChange={ev=>setOption(e.id,ev.target.value)}>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
     <label className="graphics-lab__range">{e.label}<output>{Number(setting.value.toFixed(3))}{e.unit}</output><input aria-label={`${e.name} ${e.label}`} type="range" min={e.min} max={e.max} step={e.step} value={setting.value} disabled={controlsDisabled||!setting.enabled} onChange={ev=>effect(e.id,{value:Number(ev.target.value)})}/></label>
     <small>{e.cost}</small>
    </section>;
   })}</div>
  </div>
  <details className="graphics-lab__import" open={importOpen} onToggle={e=>setImportOpen((e.target as HTMLDetailsElement).open)}>
   <summary>Paste a recipe JSON</summary>
   <p className="field-note">Paste a recipe I send back, then apply it to preview the exact mix.</p>
   <textarea ref={importRef} aria-label="Recipe JSON" value={importText} onChange={e=>setImportText(e.target.value)} rows={5} spellCheck={false}/>
   <Btn onClick={applyJson}>APPLY JSON</Btn>
  </details>
  <p className="field-note">The shipped default look is an electric world with contrast and crosshatch, a circuit weapon stack, and ink-styled bots. RESTORE DEFAULT LOOK brings it back; RESET ALL / OFF clears every layer and target.</p>
  <div className="graphics-lab__actions"><Btn onClick={exportRecipe}>EXPORT RECIPE</Btn><Btn onClick={restoreDefault}>RESTORE DEFAULT LOOK</Btn><Btn onClick={()=>{update(normalizeGraphicsLab());setRecipeIndex(-1);setTarget('world');setMessage('Reset to the original look. All preview layers are off.');}}>RESET ALL / OFF</Btn></div>
  <p role="status" className="field-note">{message}</p>
  <p className="field-note">Saved on this device. Effects style the 3D world; enable the WEAPON or BOTS stack to style those layers too. The HUD stays crisp. Static patterns respect reduced motion. One combined shader pass; glow, sharpen and contours add texture reads.</p>
 </div>;
}
// The page re-renders on HUD ticks while a match is playing; this drawer must
// only re-render when the lab state itself changes, or a long frame can queue
// updates during React's render (the "Maximum update depth" warning).
export const GraphicsLabPanel=memo(GraphicsLabPanelView,(a,b)=>a.lab?.value===b.lab?.value&&a.lab?.supported===b.lab?.supported&&a.lab?.storageNotice===b.lab?.storageNotice);
