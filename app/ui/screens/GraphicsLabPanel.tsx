'use client';
import {useState} from 'react';
import {Btn} from '../primitives';
import type {useGraphicsLab,GraphicsLabSettings} from '../useGraphicsLab';
import {GRAPHICS_EFFECTS,GRAPHICS_PALETTES,GRAPHICS_RECIPES,graphicsRecipe,normalizeGraphicsLab,serializeGraphicsLab} from '../../../game/graphics-lab.mjs';

export function GraphicsLabPanel({lab}:{lab?:ReturnType<typeof useGraphicsLab>}){
 const [recipeIndex,setRecipeIndex]=useState(0);
 const [message,setMessage]=useState('');
 if(!lab)return null;
 const {value:s,update,supported,storageNotice}=lab;
 const active=GRAPHICS_EFFECTS.filter(e=>s.effects[e.id].enabled);
  const patch=(p:Partial<GraphicsLabSettings>)=>update(v=>({...v,...p}));
  const effect=(id:string,p:Partial<GraphicsLabSettings['effects'][string]>)=>update(v=>({...v,effects:{...v.effects,[id]:{...v.effects[id],...p}}}));
 const apply=(index:number)=>{const i=(index+GRAPHICS_RECIPES.length)%GRAPHICS_RECIPES.length;setRecipeIndex(i);update(graphicsRecipe(GRAPHICS_RECIPES[i].id));setMessage(`${GRAPHICS_RECIPES[i].name} loaded. Tweak or stack any effects below.`);};
 const exportRecipe=()=>{
  const blob=new Blob([serializeGraphicsLab(s)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='cocs-graphics-recipe.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  setMessage('Recipe downloaded. Keep it to share your preferred look.');
 };
 return <div className="graphics-lab" data-graphics-lab>
  <div className="graphics-lab__intro"><span className="graphics-lab__badge">DEVELOPER PREVIEW / 01</span><p>Art direction, live. Stack effects, find a flavor, then take it into the arena.</p></div>
  <div className="graphics-lab__master">
   <label><input type="checkbox" checked={s.enabled} disabled={supported===false} onChange={e=>patch({enabled:e.target.checked})}/> Enable graphics lab</label>
   <span>{supported===false?'WEBGL REQUIRED':!s.enabled?'ORIGINAL':s.bypass?'BYPASSED':`${active.length} LAYERS`}</span>
  </div>
  {supported===false&&<p className="field-note">The software fallback cannot run shader effects. Your recipe is kept for a WebGL session.</p>}
  {storageNotice&&<p className="field-note">{storageNotice}</p>}
  <div className="graphics-lab__compare">
   <Btn aria-pressed={s.bypass} onClick={()=>patch({bypass:!s.bypass})} disabled={!s.enabled}>{s.bypass?'SHOW MY MIX':'A/B · SHOW ORIGINAL'}</Btn>
   <label><input type="checkbox" checked={s.split} onChange={e=>patch({split:e.target.checked})}/> Split comparison</label>
  </div>
  {s.split&&<label className="graphics-lab__range">Original ← divider → styled <output>{Math.round(s.splitAt*100)}%</output><input aria-label="Comparison divider" type="range" min=".1" max=".9" step=".01" value={s.splitAt} onChange={e=>patch({splitAt:Number(e.target.value)})}/></label>}
  <label className="graphics-lab__range">Overall mix <output>{Math.round(s.mix*100)}%</output><input aria-label="Overall mix" type="range" min="0" max="1" step=".01" value={s.mix} onChange={e=>patch({mix:Number(e.target.value)})}/></label>
  <section className="graphics-lab__recipes" aria-label="Starting recipes">
   <div className="graphics-lab__section-title"><b>01 / STARTING RECIPES</b><span>{recipeIndex+1} / {GRAPHICS_RECIPES.length}</span></div>
   <p className="field-note">Loading a recipe replaces the mix. Individual layer switches below are independent.</p>
   <div className="graphics-lab__recipe-grid">{GRAPHICS_RECIPES.map((p,i)=><button type="button" key={p.id} onClick={()=>apply(i)} className={`graphics-lab__recipe${recipeIndex===i?' is-selected':''}`}>
    <span className="graphics-lab__swatch" aria-hidden="true" style={{background:`linear-gradient(125deg,${GRAPHICS_PALETTES.find(c=>c.id===p.palette)!.colors.join(',')})`}}/><b>{p.name}</b>
   </button>)}</div>
   <p className="field-note">{GRAPHICS_RECIPES[recipeIndex].description}</p>
   <div className="graphics-lab__actions"><Btn onClick={()=>apply(recipeIndex-1)}>← PREVIOUS LOOK</Btn><Btn onClick={()=>apply(recipeIndex+1)}>NEXT LOOK →</Btn></div>
  </section>
  <label className="graphics-lab__palette">Ink / midtone / paper palette<select value={s.palette} onChange={e=>patch({palette:e.target.value})}>{GRAPHICS_PALETTES.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <div className="graphics-lab__section-title"><b>02 / STACK YOUR LAYERS</b><span>{active.length} / {GRAPHICS_EFFECTS.length}</span></div>
  <div className="graphics-lab__layers">{GRAPHICS_EFFECTS.map(e=>{
   const setting=s.effects[e.id];
   return <section className={`graphics-lab__layer${setting.enabled?' is-on':''}`} key={e.id}>
    <label className="graphics-lab__layer-switch"><input type="checkbox" checked={setting.enabled} onChange={ev=>effect(e.id,{enabled:ev.target.checked})}/><b>{e.name}</b><span>{setting.enabled?'ON':'OFF'}</span></label>
    <p>{e.description}</p>
    <label className="graphics-lab__range">{e.label}<output>{Number(setting.value.toFixed(3))}{e.unit}</output><input aria-label={`${e.name} ${e.label}`} type="range" min={e.min} max={e.max} step={e.step} value={setting.value} disabled={!setting.enabled} onChange={ev=>effect(e.id,{value:Number(ev.target.value)})}/></label>
    <small>{e.cost}</small>
   </section>;
  })}</div>
  <div className="graphics-lab__actions"><Btn onClick={exportRecipe}>EXPORT RECIPE</Btn><Btn onClick={()=>{update(normalizeGraphicsLab());setMessage('Reset to the original look. All preview layers are off.');}}>RESET ALL / OFF</Btn></div>
  <p role="status" className="field-note">{message}</p>
  <p className="field-note">Saved on this device. Effects style the 3D world and menu showcase; the HUD and first-person weapon stay crisp. Static patterns respect reduced motion. One combined shader pass; glow and contours add texture reads.</p>
 </div>;
}
