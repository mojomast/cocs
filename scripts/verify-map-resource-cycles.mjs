import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173',browser=await chromium.launch({headless:true}),rows=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/review?map=colosseum&paused=1&overview=1&reduced=1`);
 await page.waitForFunction(()=>window.__cocsReview?.view?.perf?.calls>0,{},{timeout:120000});
 for(let cycle=0;cycle<4;cycle++)for(const id of ['aurora-stadium','colosseum']){
  await page.evaluate(id=>{const r=window.__cocsReview;r.load(id);r.overview();},id);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const metrics=await page.evaluate(()=>window.__cocsReview.metrics());assert.deepEqual(metrics.runtimeErrors,[]);
  rows.push({cycle,id,geometries:metrics.perf.geometries,textures:metrics.perf.textures,calls:metrics.perf.calls,triangles:metrics.perf.triangles});
 }
 const returns=rows.filter(r=>r.id==='colosseum'),a=returns.at(-2),b=returns.at(-1);
 await fs.mkdir('artifacts/destination-views',{recursive:true});await fs.writeFile('artifacts/destination-views/resource-cycles.json',JSON.stringify({rows,errors},null,2));console.log(JSON.stringify(rows,null,2));
 for(const key of ['geometries','textures','calls','triangles'])assert.equal(b[key],a[key],`${key} remains stable after warm-up`);
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
