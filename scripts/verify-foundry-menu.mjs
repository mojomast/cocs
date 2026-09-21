import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173';
const out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/foundry-menu';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const [width,height] of [[1366,768],[390,844],[844,390]]){
  console.log(`Checking menu ${width}x${height}`);
  const context=await browser.newContext({viewport:{width,height}});
  context.setDefaultTimeout(30000);
  await context.addInitScript(()=>{localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:false}));});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(()=>typeof window.tokenArenaSnapshot==='function');
  // Runtime initialization can precede hydration of the SSR title button.
  for(let attempt=0;attempt<5&&await page.locator('.title-stage').count();attempt++){
   await page.getByRole('button',{name:'Enter the arena',exact:true}).click();
   await page.locator('.title-stage').waitFor({state:'hidden',timeout:2000}).catch(()=>{});
  }
  await page.locator('.title-stage').waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Your next great match.',exact:true}).waitFor();
  const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}x${height} must not overflow`);
  await fits();
  await page.screenshot({path:`${out}/play-${width}x${height}.png`});
  await page.getByRole('button',{name:'MATCH SETUP',exact:true}).click();
  await page.getByRole('dialog',{name:'Match setup',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/^Online Browse servers/}).click();
  await page.locator('.arena-app.mode-browse').waitFor();
  await page.getByRole('button',{name:'BACK',exact:true}).click();
  await page.getByRole('button',{name:'Loadout',exact:true}).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Make it yours.');
  await page.getByRole('button',{name:/^Claude:/}).click();
  await page.getByRole('button',{name:/^ChatGPT:/}).click();
  await fits();
  await page.screenshot({path:`${out}/loadout-${width}x${height}.png`});
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.locator('summary').filter({hasText:'Spectate & demo'}).click();
  await page.getByRole('button',{name:/^Spectate: cinematic/}).waitFor({state:'visible'});
  await fits();
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.getByRole('button',{name:/^Training Your first match/}).click();
  await page.getByRole('button',{name:/^Recommended first match:/}).waitFor();
  await page.getByRole('button',{name:'Back to Play',exact:true}).click();
  await page.getByRole('button',{name:'OPERATIONS · CO-OP',exact:true}).click();
  await page.getByRole('button',{name:'DEPLOY OPERATIONS',exact:true}).waitFor();
  await fits();
  await page.screenshot({path:`${out}/briefing-${width}x${height}.png`});
  await page.getByRole('button',{name:'DEPLOY OPERATIONS',exact:true}).click();
  await page.waitForFunction(()=>window.tokenArenaSnapshot()?.mode==='playing');
  const match=await page.evaluate(()=>{const s=window.tokenArenaSnapshot();return {mode:s.config?.mode,map:s.mapId,renderer:s.renderer};});
  assert.equal(match.mode,'cocs-coop','briefing launch payload reaches the parent');
  assert.deepEqual(errors,[]);
  results.push({width,height,match,errors});
  await context.close();
 }
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
