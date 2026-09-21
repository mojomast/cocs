import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173',out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/mission-hud';
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const [width,height,touch] of [[1366,768,false],[390,844,true],[844,390,true]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({touch})=>{localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:false,touch}));localStorage.setItem('token-arena-campaign',JSON.stringify({completed:{'crown-duel':{wins:1,attempts:1}}}));},{touch});
  await page.goto(base);await page.waitForFunction(()=>window.tokenArenaSnapshot);
  for(let i=0;i<5&&await page.locator('.title-stage').count();i++){await page.getByRole('button',{name:'Enter the arena',exact:true}).click();await page.locator('.title-stage').waitFor({state:'hidden',timeout:2000}).catch(()=>{});}
  await page.getByRole('button',{name:/Single player.*Horde/}).click();
  await page.getByRole('button',{name:'SINGLE PLAYER HUB',exact:true}).click();
  const setup=page.getByRole('dialog',{name:'Single player',exact:true});await setup.getByRole('tab',{name:'Campaign',exact:true}).click();
  await setup.getByRole('button',{name:/^The Verdant Signal:/}).click();await setup.getByRole('button',{name:/^DEPLOY/}).click();
  await page.waitForFunction(()=>window.tokenArenaSnapshot()?.mapId==='verdant-reliquary');await page.locator('.sp-hud').waitFor();
  await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
  const layout=await page.evaluate(()=>{
   const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
   return {rail:rect('.sp-hud'),header:rect('.match-top'),footer:rect('.hud-bottom'),positions:[...document.querySelector('.sp-hud').children].map(el=>({position:getComputedStyle(el).position,transform:getComputedStyle(el).transform})),overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  await page.screenshot({path:`${out}/${width}x${height}.png`});
  assert.equal(layout.overflow,false);assert.ok(layout.rail.height>0);assert.ok(layout.rail.top>=layout.header.bottom);assert.ok(layout.rail.bottom<=layout.footer.top);assert.ok(layout.rail.right<=width*.46);
  assert.ok(layout.positions.every(p=>p.position==='static'&&p.transform==='none'));assert.deepEqual(errors,[]);results.push({width,height,touch,...layout,errors});await context.close();
 }
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
