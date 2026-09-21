import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173',out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/demo-toolbar';
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const [width,height] of [[1366,768],[390,844],[844,390]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:false}));});
  await page.goto(base);await page.waitForFunction(()=>window.tokenArenaDebug,{},{timeout:120000});
  for(let i=0;i<5&&await page.locator('.title-stage').count();i++){await page.getByRole('button',{name:'Enter the arena',exact:true}).click();await page.locator('.title-stage').waitFor({state:'hidden',timeout:2000}).catch(()=>{});}
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.locator('summary').filter({hasText:'Spectate & demo'}).click();
  await page.getByRole('button',{name:'BACK TO DEMO',exact:true}).click();
  const toolbar=page.getByRole('group',{name:'Back to demo controls',exact:true});await toolbar.waitFor();
  await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
  for(const free of [false,true]){
   if(free)await toolbar.getByRole('button',{name:'FREE ROAM',exact:true}).click();
   const layout=await toolbar.evaluate(root=>{
    const buttons=[...root.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent||el.getAttribute('aria-label'),center:r.top+r.height/2,height:r.height};});
    const items=[...root.querySelectorAll('button,.demo-controls__label')].map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),overlaps=[];
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([a.label,b.label]);}
    return {buttons,overlaps,items,rows:[...root.querySelectorAll(':scope > .demo-controls__row,:scope > .demo-options')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}),scrollWidth:root.scrollWidth,width:root.clientWidth};
   });
   const centers=layout.buttons.map(b=>b.center);assert.ok(Math.max(...centers)-Math.min(...centers)<=2,'every control stays on the same row');
   assert.ok(layout.buttons.every(b=>b.height>=44),'touch targets remain usable');
   assert.deepEqual(layout.overlaps,[],'labels and controls occupy separate columns');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.screenshot({path:`${out}/${width}x${height}-${free?'free':'auto'}.png`});results.push({width,height,free,...layout});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
