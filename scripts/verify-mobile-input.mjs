// Real CDP touch contacts (including simultaneous fingers), not mouse clicks
// or dispatchEvent substitutes for pointer capture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:4173',out=process.env.BROWSER_ARTIFACT_DIR||'artifacts/mobile-input';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const [width,height,leftHanded=false] of (process.env.MOBILE_INPUT_DESKTOP_ONLY==='1'?[]:[[390,844],[844,390],[390,844,true],[844,390,true]])){
  console.log(`Touch input ${width}x${height}`);
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(leftHanded=>{
   localStorage.setItem('token-arena-onboarded','1');localStorage.setItem('token-arena-settings',JSON.stringify({muted:true,showcase:false}));
   localStorage.setItem('token-arena-customization',JSON.stringify({display:{touchLeftHanded:leftHanded,touchScale:leftHanded?1.3:1,adsToggle:false,crouchToggle:false}}));
   window.lockRequests=0;
   // Mobile browsers either lack pointer lock or reject it. Report any attempt.
   Element.prototype.requestPointerLock=function(){window.lockRequests++;document.dispatchEvent(new Event('pointerlockerror'));return Promise.reject(new Error('Mobile pointer lock unavailable'));};
  },leftHanded);
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
  for(const action of ['ads','crouch']){
   const button=page.locator(`.touch-${action}`);
   await button.tap();assert.equal(await button.getAttribute('aria-pressed'),'true',`${action} stays toggled after release`);
   await button.tap();assert.equal(await button.getAttribute('aria-pressed'),'false',`${action} toggles off on the next tap`);
  }
  assert.equal(await page.locator('.touch-more-panel').count(),0);
  assert.equal(await page.locator('.touch-alt').count(),0,'secondary controls are absent at rest');
  const more=await point('.touch-more');contacts.set(20,more);await send('touchStart');
  await page.locator('.touch-more-panel').waitFor();
  const tiles=await page.locator('.touch-more-panel button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent,width:r.width,height:r.height,inView:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};}));
  assert.ok(tiles.every(t=>t.width>=44&&t.height>=44&&t.inView&&t.hit),JSON.stringify(tiles));
  await page.screenshot({path:`${out}/more-${width}x${height}${leftHanded?'-left-scaled':''}.png`});
  const alt=await point('.touch-alt');contacts.set(20,alt);await send('touchMove');assert.equal((await input()).touch.altFire,true,'slide-and-hold activates alt fire');
  contacts.set(20,more);await send('touchMove');assert.equal((await input()).touch.altFire,false,'sliding away releases the held action');
  contacts.clear();await send('touchEnd');assert.equal(await page.locator('.touch-more-panel').count(),0);
  contacts.set(22,more);await send('touchStart');await page.locator('.touch-alt').waitFor();
  const secondAlt=await point('.touch-alt');contacts.set(23,secondAlt);await send('touchStart');
  assert.equal((await input()).touch.altFire,true,'a second finger can hold a secondary action');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{id:22,...more}]});contacts.delete(22);
  assert.equal((await input()).touch.altFire,false,'closing MORE releases held secondary actions');
  contacts.clear();await send('touchCancel');assert.equal(await page.locator('.touch-more-panel').count(),0);
  // One-shot actions commit on release, rather than accidentally firing as the
  // thumb crosses their tile on its way to another selection.
  contacts.set(21,more);await send('touchStart');await page.locator('.touch-grenade').waitFor();
  contacts.set(21,await point('.touch-grenade'));await send('touchMove');
  contacts.clear();await send('touchEnd');await page.evaluate(()=>window.tokenArenaDebug.pauseRender(false));
  await page.waitForFunction(()=>window.tokenArenaSnapshot()?.actors[0]?.grenadeCooldown>0);
  await page.evaluate(()=>window.tokenArenaDebug.pauseRender(true));
  assert.equal(await page.locator('.touch-more-panel').count(),0);
  const move=await point('.touch-move-zone'),look=await point('.touch-look'),fire=await point('.touch-fire');
  const travel=leftHanded?1.3:1;
  contacts.set(1,move);await send('touchStart');
  assert.equal((await input()).touch.moveY,0,'a stationary thumb does not seed phantom forward movement');
  contacts.set(1,{x:move.x,y:move.y-45*travel});await send('touchMove');
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
  contacts.set(6,move);await send('touchStart');contacts.set(6,{x:move.x+35*travel,y:move.y});await send('touchMove');
  await page.evaluate(()=>{document.dispatchEvent(new Event('pointerlockerror'));document.dispatchEvent(new Event('pointerlockchange'));});
  assert.ok((await input()).touch.moveX>.3);assert.equal(await page.locator('.cursor-resume').count(),0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal((await input()).touch.moveX,0,'hidden tab clears the stick');
  contacts.clear();await send('touchCancel');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  // A lifecycle reset while contacts are held must free ownership for the next
  // gesture; losing only the runtime values leaves the old stick id wedged.
  contacts.set(4,move);await send('touchStart');contacts.set(4,{x:move.x,y:move.y-40*travel});await send('touchMove');
  contacts.set(9,await point('.touch-pause-btn'));await send('touchStart');
  await page.getByRole('button',{name:'RESUME MATCH',exact:true}).first().waitFor();
  contacts.clear();await send('touchEnd');
  await page.getByRole('button',{name:'RESUME MATCH',exact:true}).first().tap();
  await page.locator('.touch-move-zone').waitFor({timeout:10000}).catch(async error=>{
   await page.screenshot({path:`${out}/resume-failure-${width}x${height}.png`});
   console.log(JSON.stringify(await page.evaluate(()=>({mode:window.tokenArenaSnapshot().mode,trace:window.touchTrace.slice(-12),locked:document.pointerLockElement?.tagName,focus:document.activeElement?.outerHTML}))));throw error;
  });
  contacts.set(5,move);await send('touchStart');contacts.set(5,{x:move.x+40*travel,y:move.y});await send('touchMove');
  assert.ok((await input()).touch.moveX>.4,'a fresh stick works after pause/resume');
  contacts.clear();await send('touchEnd');
  contacts.set(7,move);await send('touchStart');assert.equal((await input()).touch.moveY,0);
  contacts.set(7,{x:move.x,y:move.y-40*travel});await send('touchMove');assert.ok((await input()).touch.moveY>.4);
  contacts.clear();await send('touchEnd');
  assert.equal((await input()).touch.moveX,0);assert.equal(await page.evaluate(()=>window.lockRequests),0);
  await page.screenshot({path:`${out}/${width}x${height}.png`});assert.deepEqual(errors,[]);
  results.push({width,height,leftHanded,toggles:true,holdMenu:true,menuTiles:tiles,multitouch:true,cancel:true,resume:true,fieldDialog:true,hiddenReset:true,lockRequests:0,errors});await context.close();
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
 // Headless Chromium may send an inverse cursor-warp delta immediately after
 // a locked CDP move. Observe the per-event response, not the cancelled net yaw.
 await page.evaluate(()=>{window.mouseTrace=[];window.addEventListener('mousemove',e=>{if(e.movementX)window.mouseTrace.push({dx:e.movementX,yaw:window.tokenArenaSnapshot().actors[0].yaw});});});
 const yaw=await page.evaluate(()=>window.tokenArenaSnapshot().actors[0].yaw);await page.mouse.move(120,80);await page.mouse.move(160,100);
 await page.waitForFunction(yaw=>window.mouseTrace.some(event=>event.yaw!==yaw),yaw,{timeout:5000});
 results.push({desktop:true,pointerLock:true,mouseChords:true,mouseLook:true});await context.close();
 await fs.writeFile(`${out}/manifest.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close()}
