#!/usr/bin/env node
// Requires the Vite preview/dev server. Exercises actual GPU output, then the
// real settings UI. No match/debug mutation or remote services are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173';
const out='artifacts/graphics-lab';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:768},hasTouch:true});
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
  const all=normalizeGraphicsLab(neutral);for(const e of GRAPHICS_EFFECTS)all.effects[e.id]={enabled:true,value:e.value};
  deltas.all=difference(render(all),original);
  const zero=render({...all,mix:0});
  const split=render({...all,split:true,splitAt:.5});
  let leftDifference=0;for(let y=0;y<64;y++)for(let x=0;x<62;x++)for(let c=0;c<3;c++){const i=(y*128+x)*4+c;leftDifference+=Math.abs(split[i]-original[i]);}
  const programCount=renderer.info.programs.length;
  pass.dispose();target.dispose();texture.dispose();renderer.dispose();
  return {deltas,zeroMixDifference:difference(zero,original),leftDifference,programCount};
 });
 for(const [name,delta] of Object.entries(gpu.deltas))assert.ok(delta>100,`${name} changes rendered pixels`);
 assert.equal(gpu.zeroMixDifference,0);assert.equal(gpu.leftDifference,0);assert.equal(gpu.programCount,1);
 await page.getByRole('button',{name:'Enter the arena',exact:true}).click();
 await page.getByRole('button',{name:'Graphics & settings',exact:true}).click();
 await page.getByRole('tab',{name:'Graphics lab · Preview',exact:true}).click();
 for(const name of ['Circuit Print','Neon Cathedral','Pocket Arena','Field Sketch','Ghost Signal','Ember Press']){
  await page.getByRole('button',{name,exact:true}).click();
  await page.waitForTimeout(250);
  await page.screenshot({path:`${out}/${name.toLowerCase().replaceAll(' ','-')}.png`});
 }
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
