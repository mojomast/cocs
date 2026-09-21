import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173';
const out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/field-interface';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const [width,height] of [[1366,768],[390,844],[844,390]]){
  console.log(`Field interface ${width}x${height}`);
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:false}));});
  await page.goto(base);await page.waitForFunction(()=>window.tokenArenaSnapshot);
  for(let i=0;i<5&&await page.locator('.title-stage').count();i++){
   await page.getByRole('button',{name:'Enter the arena',exact:true}).click();
   await page.locator('.title-stage').waitFor({state:'hidden',timeout:2000}).catch(()=>{});
  }
  await page.getByRole('button',{name:'MATCH SETUP',exact:true}).click();
  const setup=page.getByRole('dialog',{name:'Match setup',exact:true});
  await setup.getByRole('radio',{name:'Lattice Strike: Operations',exact:true}).click();
  await setup.getByRole('tab',{name:'New · Destinations',exact:true}).click();
  await setup.getByRole('button',{name:'Monsoon Foundry',exact:true}).click();
  await setup.getByRole('button',{name:/ENTER ARENA/}).click();
  await page.waitForFunction(()=>window.tokenArenaSnapshot()?.mapId==='monsoon-foundry'&&window.tokenArenaSnapshot()?.mode==='playing');
  await page.locator('.game-hud').waitFor();
  const render=on=>page.evaluate(on=>window.tokenArenaDebug.pauseRender(!on),on);
  await render(false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const overlap=await page.evaluate(()=>{
   const selectors=['.match-top','.objective-bar','.cocs-readout','.director-readout','.radar','.stat-card--vitals','.ammo-stack','[aria-label="Field tools"]','[aria-label="Ability, movement and grenade status"]','.cocs-spend-chip'];
   const visibleRect=el=>{
    if(!el.checkVisibility())return null;
    const r=el.getBoundingClientRect(),b={left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    for(let p=el.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){b.left=Math.max(b.left,r.left);b.right=Math.min(b.right,r.right);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){b.top=Math.max(b.top,r.top);b.bottom=Math.min(b.bottom,r.bottom);}}
    return b.right-b.left>1&&b.bottom-b.top>1?b:null;
   };
   const boxes=selectors.flatMap(selector=>{const el=document.querySelector(selector),box=el&&visibleRect(el);return box?[{selector,...box}]:[];}),hits=[];
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)hits.push([a.selector,b.selector]);}
   const clippedTools=[...document.querySelectorAll('[aria-label="Field tools"] button')].filter(el=>{const r=el.getBoundingClientRect(),v=visibleRect(el);return !v||v.right-v.left<r.width-1||v.bottom-v.top<r.height-1;}).map(el=>el.textContent);
   return {boxes,hits,clippedTools};
  });
  await fs.writeFile(`${out}/layout-${width}x${height}.json`,JSON.stringify(overlap,null,2));
  await page.screenshot({path:`${out}/hud-${width}x${height}.png`});
  assert.deepEqual(overlap.hits,[],`${width}x${height}: persistent HUD panels must not overlap`);
  assert.deepEqual(overlap.clippedTools,[],`${width}x${height}: map and squad launchers stay fully visible`);
  await page.keyboard.press('l');
  const squads=page.getByRole('dialog',{name:'Squad management',exact:true});await squads.waitFor();
  await squads.getByRole('textbox',{name:'New squad name'}).fill('Vanguard');
  await squads.getByRole('button',{name:'Create squad',exact:true}).click();
  await render(true);
  await page.waitForFunction(()=>window.tokenArenaSnapshot()?.cocs?.squadBoard?.[0]?.squads?.some(s=>s.name==='Vanguard'));
  await squads.getByRole('button',{name:'Leave',exact:true}).waitFor();
  await render(false);
  await squads.getByRole('button',{name:'Take command',exact:true}).click();
  await render(true);
  await page.waitForFunction(()=>String(window.tokenArenaSnapshot()?.cocs?.command?.seat?.[0]??window.tokenArenaSnapshot()?.cocs?.commander?.seat?.[0])==='0');
  await squads.getByRole('button',{name:'Release command',exact:true}).waitFor();
  await render(false);
  await page.screenshot({path:`${out}/squads-${width}x${height}.png`});
  await squads.getByRole('button',{name:'Leave',exact:true}).click();
  await render(true);
  await page.waitForFunction(()=>window.tokenArenaSnapshot()?.cocs?.squadBoard?.[0]?.squads?.length===0);
  await render(false);
  await page.keyboard.press('Escape');await squads.waitFor({state:'hidden'});
  await page.keyboard.press('j');
  const tactical=page.getByRole('dialog',{name:'Monsoon Foundry',exact:true});await tactical.waitFor();
  assert.equal(await page.evaluate(()=>window.tokenArenaSnapshot().input.fire),false);
  await tactical.getByRole('button',{name:'ROUTE',exact:true}).click();
  await tactical.getByRole('button').filter({hasText:'Order target'}).first().click();
  const issue=tactical.getByRole('button',{name:/^Issue /});await issue.click();
  await render(true);
  await page.waitForFunction(()=>Boolean(window.tokenArenaSnapshot()?.cocs?.command?.route?.[0]??window.tokenArenaSnapshot()?.cocs?.commander?.route?.[0]));
  await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
  await tactical.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.screenshot({path:`${out}/map-${width}x${height}.png`});
  for(let i=0;i<12;i++)await page.keyboard.press('Tab');
  assert.equal(await tactical.evaluate(el=>el.contains(document.activeElement)),true,'native map dialog contains keyboard focus');
  await page.keyboard.press('Escape');await tactical.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);results.push({width,height,map:'monsoon-foundry',squadCreateLeave:true,commanderMapOrder:true,errors});
  await context.close();
 }
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
