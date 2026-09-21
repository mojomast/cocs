import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {DESTINATION_MAPS} from '../game/destination-maps.mjs';

// Run only against an already-running server. Maps are loaded sequentially in
// one renderer, which also exercises map-local cache disposal on replacement.
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173';
const out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/destination-views';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),rows=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/review?map=colosseum&paused=1&overview=1&reduced=1`);
 await page.waitForFunction(()=>window.__cocsReview?.view?.perf?.calls>0,{},{timeout:120000});
 for(const id of ['colosseum','lattice-slice',...DESTINATION_MAPS.map(m=>m.id),'colosseum']){
  await page.evaluate(id=>{const r=window.__cocsReview;r.load(id);r.overview();},id);
  await page.waitForFunction(id=>window.__cocsReview?.match?.arena?.id===id,id);
  // Two presented frames allow frustum/LOD and render statistics to settle.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const overview=await page.evaluate(()=>window.__cocsReview.metrics());
  await page.screenshot({path:`${out}/${id}-overview.png`});
  await page.evaluate(()=>{const r=window.__cocsReview,m=r.match.arena,p=m.objectiveZones?.[1]??{x:0,z:0};r.view.setFreeCam(true);Object.assign(r.view.freePose,{x:p.x+14,z:p.z+22,y:9,yaw:.5,pitch:-.18});});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:`${out}/${id}-field.png`});
  const field=await page.evaluate(()=>window.__cocsReview.metrics());
  assert.deepEqual(field.runtimeErrors,[],`${id} renderer errors`);
  assert.ok(field.perf.calls>0,`${id} draws a scene`);
  rows.push({id,overview:overview.perf,field:field.perf,renderer:field.renderer});
 }
 assert.deepEqual(errors,[]);
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify({method:'Sequential frozen-scene WebGL views; submission counts, not hardware FPS.',rows,errors},null,2));
 console.log(JSON.stringify(rows,null,2));
}finally{await browser.close();}
