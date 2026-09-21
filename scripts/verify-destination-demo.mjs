import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {DESTINATION_MAPS} from '../game/destination-maps.mjs';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173',out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/destination-demo';
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true}),rows=[],errors=[];
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});
 await context.addInitScript(()=>{localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:true}));localStorage.removeItem('token-arena-demo-settings');});
 const page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>window.tokenArenaDemo?.()?.actualMap);
 for(let i=0;i<9;i++){
  if(i)await page.evaluate(()=>window.tokenArenaDebug.next());
  await page.waitForFunction(()=>window.tokenArenaDemo()?.performance?.frames>=5);
  await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
  const sample=await page.evaluate(()=>({demo:window.tokenArenaDemo(),perf:window.tokenArenaPerf(),snapshot:window.tokenArenaSnapshot().showcase}));
  assert.equal(sample.perf.render.fpsCap,30,'menu backdrops have an explicit presentation budget');
  assert.ok(sample.demo.performance.maxSteps<=2,'slow frames never run unbounded demo catch-up');
  assert.ok(sample.snapshot.actors.every(a=>Number.isFinite(a.x)&&Number.isFinite(a.z)));
  await page.screenshot({path:`${out}/${sample.demo.actualMap}.png`});
  rows.push({map:sample.demo.actualMap,mode:sample.demo.actualMode,performance:sample.demo.performance,render:sample.perf.render});
  await page.evaluate(()=>window.tokenArenaDebug.pauseRender(false));
 }
 assert.deepEqual(rows.map(r=>r.map).sort(),DESTINATION_MAPS.map(m=>m.id).sort(),'the first nine scenarios show every new map');
 // Use actual menu navigation to take camera ownership of the running reel.
 await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
 await page.getByRole('button',{name:'Enter the arena',exact:true}).click();
 await page.getByRole('button',{name:'Library',exact:true}).click();await page.locator('summary').filter({hasText:'Spectate & demo'}).click();await page.getByRole('button',{name:'BACK TO DEMO',exact:true}).click();
 await page.evaluate(()=>window.tokenArenaDebug.pauseRender(false));
 await page.waitForFunction(()=>window.tokenArenaPerf()?.render?.fpsCap===60);
 const active=await page.evaluate(()=>({demo:window.tokenArenaDemo(),render:window.tokenArenaPerf().render}));
 assert.equal(active.demo.state,'auto');await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
 await page.getByRole('button',{name:'FREE ROAM',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.tokenArenaDemo().cameraOwner),'free');
 await page.screenshot({path:`${out}/full-demo.png`});
 const hidden=await page.evaluate(async()=>{
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});window.tokenArenaDebug.pauseRender(false);
  const before=window.tokenArenaDemo();for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);
  const after=window.tokenArenaDemo();delete document.hidden;
  return {before:before.matchTime,after:after.matchTime,stepsBefore:before.performance.steps,stepsAfter:after.performance.steps};
 });
 assert.equal(hidden.after,hidden.before,'hidden demos do not simulate');assert.equal(hidden.stepsAfter,hidden.stepsBefore);assert.deepEqual(errors,[]);
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify({rows,active,hidden,errors,method:'Sequential headless WebGL; submission/CPU evidence, not hardware FPS.'},null,2));console.log(JSON.stringify({maps:rows.map(r=>r.map),errors,activeCap:active.render.fpsCap,hidden}));
}finally{await browser.close()}
