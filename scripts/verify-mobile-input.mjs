// Real CDP touch contacts (including simultaneous fingers), not mouse clicks
// or dispatchEvent substitutes for pointer capture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173',out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/mobile-input';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const [width,height] of [[390,844],[844,390]]){
  console.log(`Touch input ${width}x${height}`);
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
   localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:false}));
   window.lockRequests=0;
   // Mobile browsers either lack pointer lock or reject it. Report any attempt.
   Element.prototype.requestPointerLock=function(){window.lockRequests++;document.dispatchEvent(new Event('pointerlockerror'));return Promise.reject(new Error('Mobile pointer lock unavailable'));};
  });
  await page.goto(base);await page.waitForFunction(()=>window.tokenArenaSnapshot);
  await page.getByRole('button',{name:'Enter the arena',exact:true}).tap();
  await page.getByRole('button',{name:'MATCH SETUP',exact:true}).tap();
  const setup=page.getByRole('dialog',{name:'Match setup',exact:true});
  await setup.getByRole('radio',{name:'Deathmatch',exact:true}).tap();
  await setup.getByRole('button',{name:/ENTER ARENA/}).tap();
  await page.waitForFunction(()=>window.tokenArenaSnapshot()?.mode==='playing');
  await page.locator('.touch-move-zone').waitFor();
  await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
  const requests=await page.evaluate(()=>window.lockRequests);
  assert.equal(requests,0,'touch launch must not request mouse pointer lock');
  await page.getByRole('button',{name:/TACTICAL MAP/}).tap();
  await page.getByRole('button',{name:'Close tactical map',exact:true}).waitFor({timeout:10000});
  await page.getByRole('button',{name:'Close tactical map',exact:true}).tap();
  await page.evaluate(()=>{window.touchTrace=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','click'])window.addEventListener(type,e=>window.touchTrace.push({type,id:e.pointerId,primary:e.isPrimary,target:e.target.className,tag:e.target.tagName,text:e.target.textContent?.slice(0,40)}),true);});
  const cdp=await context.newCDPSession(page),contacts=new Map();
  const send=(type)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[...contacts].map(([id,p])=>({id,...p,radiusX:3,radiusY:3,force:1}))});
  const point=async selector=>page.locator(selector).evaluate(el=>{
   const r=el.getBoundingClientRect();
   for(const fy of [.6,.8,.4,.9,.2])for(const fx of [.5,.3,.7,.15,.85]){
    const x=Math.round(r.left+r.width*fx),y=Math.round(r.top+r.height*fy),hit=document.elementFromPoint(x,y);
    if(hit&&(hit===el||el.contains(hit)))return {x,y};
   }
   throw Error(`No reachable touch point: ${el.className}`);
  });
  const input=()=>page.evaluate(()=>window.tokenArenaSnapshot().input);
  const move=await point('.touch-move-zone'),look=await point('.touch-look'),fire=await point('.touch-fire');
  contacts.set(1,move);await send('touchStart');
  assert.equal((await input()).touch.moveY,0,'a stationary thumb does not seed phantom forward movement');
  contacts.set(1,{x:move.x,y:move.y-45});await send('touchMove');
  assert.ok((await input()).touch.moveY>.5,'left thumb moves');
  const yaw=await page.evaluate(()=>window.tokenArenaSnapshot().actors[0].yaw);
  contacts.set(2,look);await send('touchStart');contacts.set(2,{x:look.x+35,y:look.y+10});await send('touchMove');
  assert.notEqual(await page.evaluate(()=>window.tokenArenaSnapshot().actors[0].yaw),yaw,`right thumb aims while moving: ${JSON.stringify(await page.evaluate(()=>window.touchTrace))}`);
  contacts.set(3,fire);await send('touchStart');
  assert.equal((await input()).touch.fire,true,'third contact fires while moving and aiming');
  assert.ok((await input()).touch.moveY>.5);
  // CDP touchEnd lists the contacts being lifted, not the remaining contacts.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{id:3,...fire}]});contacts.delete(3);
  assert.equal((await input()).touch.fire,false,JSON.stringify(await page.evaluate(()=>window.touchTrace)));
  assert.ok((await input()).touch.moveY>.5,'releasing fire preserves movement');
  contacts.clear();await send('touchCancel');assert.equal((await input()).touch.moveY,0);
  assert.equal((await input()).fire,false,'touch events never seed mouse firing');
  assert.equal(await page.locator('.cursor-resume').count(),0,'no desktop capture overlay on touch');
  await page.getByRole('button',{name:/TACTICAL MAP/}).tap();
  await page.getByRole('button',{name:'Close tactical map',exact:true}).waitFor({timeout:10000});
  assert.equal(await page.locator('.touch-layer--suspended').count(),1);
  await page.getByRole('button',{name:'Close tactical map',exact:true}).tap();
  assert.equal(await page.locator('.touch-layer--suspended').count(),0);
  // A delayed error from an obsolete desktop lock attempt cannot steal either
  // stick while touch owns input.
  contacts.set(6,move);await send('touchStart');contacts.set(6,{x:move.x+35,y:move.y});await send('touchMove');
  await page.evaluate(()=>{document.dispatchEvent(new Event('pointerlockerror'));document.dispatchEvent(new Event('pointerlockchange'));});
  assert.ok((await input()).touch.moveX>.3);assert.equal(await page.locator('.cursor-resume').count(),0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal((await input()).touch.moveX,0,'hidden tab clears the stick');
  contacts.clear();await send('touchCancel');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  // A lifecycle reset while contacts are held must free ownership for the next
  // gesture; losing only the runtime values leaves the old stick id wedged.
  contacts.set(4,move);await send('touchStart');contacts.set(4,{x:move.x,y:move.y-40});await send('touchMove');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.getByRole('button',{name:'RESUME MATCH',exact:true}).first().waitFor();
  contacts.clear();await send('touchEnd');
  await page.getByRole('button',{name:'RESUME MATCH',exact:true}).first().tap();
  await page.locator('.touch-move-zone').waitFor();
  contacts.set(5,move);await send('touchStart');contacts.set(5,{x:move.x+40,y:move.y});await send('touchMove');
  assert.ok((await input()).touch.moveX>.4,'a fresh stick works after pause/resume');
  contacts.clear();await send('touchEnd');
  contacts.set(7,move);await send('touchStart');assert.equal((await input()).touch.moveY,0);
  contacts.set(7,{x:move.x,y:move.y-40});await send('touchMove');assert.ok((await input()).touch.moveY>.4);
  contacts.clear();await send('touchEnd');
  assert.equal((await input()).touch.moveX,0);assert.equal(await page.evaluate(()=>window.lockRequests),0);
  await page.screenshot({path:`${out}/${width}x${height}.png`});assert.deepEqual(errors,[]);
  results.push({width,height,multitouch:true,cancel:true,resume:true,fieldDialog:true,hiddenReset:true,lockRequests:0,errors});await context.close();
 }
 // Desktop mouse chords must still work, including releasing FIRE while ADS
 // remains held. Pointer lock supplies mousemove deltas on desktop browsers.
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();
 page.setDefaultTimeout(90000);
 await context.addInitScript(()=>{localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:false,touch:false}));});
 await page.goto(base);await page.waitForFunction(()=>window.tokenArenaSnapshot);
 await page.getByRole('button',{name:'Enter the arena',exact:true}).click();
 await page.getByRole('button',{name:'MATCH SETUP',exact:true}).click();
 const setup=page.getByRole('dialog',{name:'Match setup',exact:true});
 await setup.getByRole('radio',{name:'Deathmatch',exact:true}).click();await setup.getByRole('button',{name:/ENTER ARENA/}).click();
 await page.waitForFunction(()=>window.tokenArenaSnapshot()?.mode==='playing'&&window.tokenArenaSnapshot()?.pointerLocked);
 await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
 await page.mouse.down({button:'left'});await page.mouse.down({button:'right'});
 assert.equal(await page.evaluate(()=>window.tokenArenaSnapshot().input.fire),true);assert.equal(await page.evaluate(()=>window.tokenArenaSnapshot().input.ads),true);
 await page.mouse.up({button:'left'});
 assert.equal(await page.evaluate(()=>window.tokenArenaSnapshot().input.fire),false);assert.equal(await page.evaluate(()=>window.tokenArenaSnapshot().input.ads),true);
 await page.mouse.up({button:'right'});assert.equal(await page.evaluate(()=>window.tokenArenaSnapshot().input.ads),false);
 const yaw=await page.evaluate(()=>window.tokenArenaSnapshot().actors[0].yaw);await page.mouse.move(120,80);
 assert.notEqual(await page.evaluate(()=>window.tokenArenaSnapshot().actors[0].yaw),yaw);
 results.push({desktop:true,pointerLock:true,mouseChords:true,mouseLook:true});await context.close();
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close()}
