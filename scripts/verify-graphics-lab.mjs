#!/usr/bin/env node
// Requires the Vite preview/dev server. Exercises actual GPU output, then the
// real settings UI. No match/debug mutation or remote services are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173';
const out='artifacts/graphics-lab';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1366,height:768},hasTouch:true});
await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',e=>{if(e.type()==='error'&&!e.text().includes('favicon.svg'))errors.push(e.text());});
try{
 await page.addInitScript(()=>{localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({touch:true}));});
 await page.goto(base);
 await page.waitForFunction(()=>typeof window.tokenArenaSnapshot==='function');
 const gpu=await page.evaluate(async()=>{
  const T=await import('/node_modules/three/build/three.module.js');
  const {GraphicsLabPass}=await import('/game/graphics-lab-pass.mjs');
  const {normalizeGraphicsLab,GRAPHICS_EFFECTS,GRAPHICS_RECIPES,graphicsRecipe}=await import('/game/graphics-lab.mjs');
  const renderer=new T.WebGLRenderer();renderer.setSize(128,64);
  const target=new T.WebGLRenderTarget(128,64),data=new Uint8Array(128*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;data[i]=x*2;data[i+1]=y*4;data[i+2]=((x>>3)+(y>>3))%2?230:20;data[i+3]=255;}
  const texture=new T.DataTexture(data,128,64);texture.needsUpdate=true;
  const pass=new GraphicsLabPass();
  const render=s=>{pass.configure(s,128,64);pass.render(renderer,target,{texture});const pixels=new Uint8Array(data.length);renderer.readRenderTargetPixels(target,0,0,128,64,pixels);return pixels;};
  const neutral=normalizeGraphicsLab();neutral.enabled=true;
  const original=render(neutral),deltas={};
  const difference=(a,b)=>a.reduce((total,v,i)=>total+Math.abs(v-b[i]),0);
  for(const e of GRAPHICS_EFFECTS){const s=normalizeGraphicsLab(neutral);s.effects[e.id]={enabled:true,value:e.max};deltas[e.id]=difference(render(s),original);}
  for(const r of GRAPHICS_RECIPES)deltas[r.id]=difference(render(graphicsRecipe(r.id)),original);
  const all=normalizeGraphicsLab(neutral);for(const e of GRAPHICS_EFFECTS)all.effects[e.id]={...all.effects[e.id],enabled:true,value:e.value};
  deltas.all=difference(render(all),original);
  // Non-default options must reuse the one program too: the switch is a uniform
  // texture change, never a recompile. Pixels may not move when the optional
  // bake is absent, so only the program count is asserted from this render.
  const alternates=normalizeGraphicsLab(all);let optionSwitches=0;
  for(const e of GRAPHICS_EFFECTS){
   const alternate=e.options?.find(o=>o.id!==alternates.effects[e.id].option);
   if(alternate){alternates.effects[e.id]={enabled:true,value:e.max,option:alternate.id};optionSwitches++;}
  }
  render(alternates);
  const zero=render({...all,mix:0});
  const split=render({...all,split:true,splitAt:.5});
  let leftDifference=0;for(let y=0;y<64;y++)for(let x=0;x<62;x++)for(let c=0;c<3;c++){const i=(y*128+x)*4+c;leftDifference+=Math.abs(split[i]-original[i]);}
  const programCount=renderer.info.programs.length;
  pass.dispose();target.dispose();texture.dispose();renderer.dispose();
  return {deltas,zeroMixDifference:difference(zero,original),leftDifference,programCount,optionSwitches};
 });
 for(const [name,delta] of Object.entries(gpu.deltas))assert.ok(delta>100,`${name} changes rendered pixels`);
 // The app configured the baked Moth registry, so the three accents must bind
 // their textures and move pixels rather than silently no-op.
 for(const id of ['mothgrain','mothsignal','mothcoat'])assert.ok(gpu.deltas[id]>100,`${id} uses the baked Moth assets`);
 assert.ok(gpu.optionSwitches>=3,'the non-default option render actually swapped all three Moth accents');
 assert.equal(gpu.zeroMixDifference,0);assert.equal(gpu.leftDifference,0);assert.equal(gpu.programCount,1);
 await page.getByRole('button',{name:'Enter the arena',exact:true}).click();
 await page.getByRole('button',{name:'Graphics & settings',exact:true}).click();
 await page.getByRole('tab',{name:'Graphics lab · Preview',exact:true}).click();
 // Includes Moth Print, which stacks the three baked Moth accents.
 for(const name of ['Circuit Print','Neon Cathedral','Pocket Arena','Field Sketch','Ghost Signal','Ember Press','Blueprint','Thermal','Moth Print']){
  await page.getByRole('button',{name,exact:true}).click();
  await page.waitForTimeout(250);
  await page.screenshot({path:`${out}/${name.toLowerCase().replaceAll(' ','-')}.png`});
 }
 // Randomize: every roll is a valid, active, persisted mix.
 await page.getByRole('button',{name:/SURPRISE ME/}).click();
 await page.waitForTimeout(200);
 const rolled=await page.evaluate(()=>JSON.parse(localStorage.getItem('token-arena-graphics-lab-v1')));
 assert.equal(rolled.enabled,true,'roll enables the lab');
 assert.ok(Object.values(rolled.effects).filter(e=>e.enabled).length>=2,'roll stacks at least two layers');
 assert.match(await page.locator('[data-graphics-lab] [role="status"]').innerText(),/Rolled/);
 // Options: a Moth layer can swap its baked asset. The choice persists, and the
 // GPU block above already proved the switch reuses the one fused program.
 await page.getByLabel('Moth coat asset').selectOption('entanglement-void');
 await page.waitForTimeout(150);
 const chosen=await page.evaluate(()=>JSON.parse(localStorage.getItem('token-arena-graphics-lab-v1')).effects.mothcoat.option);
 assert.equal(chosen,'entanglement-void','the chosen Moth asset persists');
 // Copy recipe: the clipboard payload parses and matches the live state.
 await page.getByRole('button',{name:'COPY RECIPE',exact:true}).click();
 await page.waitForTimeout(150);
 const clip=await page.evaluate(()=>navigator.clipboard.readText());
 const copied=JSON.parse(clip);
 const live=await page.evaluate(()=>JSON.parse(localStorage.getItem('token-arena-graphics-lab-v1')));
 assert.equal(copied.version,1,'copied recipe carries the schema version');
 assert.deepEqual(copied.effects,live.effects,'copied recipe matches the live layers');
 assert.equal(copied.effects.mothcoat.option,'entanglement-void','copied recipe carries the chosen option');
 assert.equal(copied.bypass,false,'copied recipe omits transient bypass');
 // Paste a recipe back in and apply it.
 await page.getByText('Paste a recipe JSON').click();
 await page.getByLabel('Recipe JSON').fill(JSON.stringify({version:1,enabled:true,palette:'sodium',mix:.9,effects:{pixel:{enabled:true,value:8},temperature:{enabled:true,value:.6}}}));
 await page.getByRole('button',{name:'APPLY JSON',exact:true}).click();
 await page.waitForTimeout(200);
 const applied=await page.evaluate(()=>JSON.parse(localStorage.getItem('token-arena-graphics-lab-v1')));
 assert.equal(applied.palette,'sodium','applied recipe changes the palette');
 assert.equal(applied.effects.pixel.enabled,true,'applied recipe enables its layers');
 assert.equal(applied.effects.temperature.value,.6,'applied recipe keeps its exact values');
 // Hotkeys: ` toggles from anywhere; Shift+` opens this drawer.
 await page.evaluate(()=>document.activeElement?.blur?.());
 await page.keyboard.press('Backquote');
 await page.waitForTimeout(150);
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('token-arena-graphics-lab-v1')).enabled)),false,'` toggles the lab off');
 assert.equal(await page.locator('.graphics-hotkey-notice').count(),1,'the toggle announces itself');
 await page.keyboard.press('Backquote');
 await page.waitForTimeout(150);
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('token-arena-graphics-lab-v1')).enabled)),true,'` toggles it back on');
 await page.keyboard.press('Shift+Backquote');
 assert.equal(await page.locator('[data-graphics-lab]').count(),0,'Shift+` closes the drawer');
 await page.keyboard.press('Shift+Backquote');
 assert.equal(await page.locator('[data-graphics-lab]').count(),1,'Shift+` reopens on the lab tab');
 assert.equal(await page.getByRole('tab',{name:'Graphics lab · Preview',exact:true}).getAttribute('aria-selected'),'true');
 const cb=page.getByRole('checkbox',{name:'Crosshatch',exact:false});await cb.check();
 await page.getByRole('checkbox',{name:'Phosphor screen',exact:false}).check();
 assert.equal(await cb.isChecked(),true,'layer toggles stack');
 await page.getByRole('button',{name:'A/B · SHOW ORIGINAL',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'SHOW MY MIX',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'SHOW MY MIX',exact:true}).click();
 await page.getByRole('checkbox',{name:'Split comparison',exact:true}).check();
 for(const [width,height,scale] of [[1366,768,1],[1920,1080,1],[844,390,1],[390,844,1],[844,390,1.4]]){
  await page.setViewportSize({width,height});
  await page.locator('.arena-app').evaluate((el,s)=>el.style.setProperty('--ui-scale',String(s)),scale);
  await page.getByRole('button',{name:'RESET ALL / OFF',exact:true}).scrollIntoViewIfNeeded();
  const bounds=await page.evaluate(()=>{const d=document.querySelector('.modal--graphics-lab .modal-panel'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.bottom<=height+1&&!bounds.overflow,`drawer fits ${width}x${height}@${scale}`);
  await page.screenshot({path:`${out}/layout-${width}x${height}-${scale}.png`});
 }
 await page.getByRole('button',{name:'RESET ALL / OFF',exact:true}).click();
 assert.equal(await page.getByRole('checkbox',{name:'Enable graphics lab',exact:true}).isChecked(),false);
 await page.getByRole('button',{name:'Field Sketch',exact:true}).click();
 await page.reload();await page.waitForFunction(()=>typeof window.tokenArenaSnapshot==='function');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('token-arena-graphics-lab-v1')).effects.hatch.enabled),true);
 await page.setViewportSize({width:1366,height:768});
 await page.getByRole('button',{name:'Enter the arena',exact:true}).click();
 await page.getByRole('button',{name:/^Recommended first match:/}).click();
 await page.waitForFunction(()=>window.tokenArenaSnapshot()?.mode==='playing');
 // Use the real pause control; native Escape-to-unlock is browser chrome behavior
 // and is not emulated by Playwright's injected key events.
 await page.evaluate(()=>document.exitPointerLock());
 await page.getByRole('button',{name:'Pause',exact:true}).tap();
 await page.getByRole('button',{name:'OPEN GRAPHICS & SETTINGS',exact:true}).click();
 await page.getByRole('tab',{name:'Graphics lab · Preview',exact:true}).click();
 await page.getByRole('button',{name:'Circuit Print',exact:true}).click();
 await page.getByRole('checkbox',{name:'Split comparison',exact:true}).check();
 await page.screenshot({path:`${out}/paused-game-split.png`});
 assert.equal(await page.locator('[role="dialog"][aria-modal="true"]').count(),1);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('[data-graphics-lab]').count(),0);
 assert.equal(await page.evaluate(()=>window.tokenArenaSnapshot().mode),'paused');
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>window.tokenArenaSnapshot().mode==='playing');
 assert.deepEqual(errors,[]);
 await fs.writeFile(`${out}/verification.json`,JSON.stringify({ok:true,base,gpu,errors},null,2));
 console.log(JSON.stringify({ok:true,gpu,artifacts:out}));
}finally{await browser.close();}
