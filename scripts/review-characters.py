"""Bounded real ArenaView lifecycle smoke. Not human visual sign-off."""
import argparse,json,pathlib
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4319');p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1280,'height':720},device_scale_factor=1,bypass_csp=True)
 page.route_web_socket('**',lambda ws:None)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(a.url+'/review?map=colosseum&paused=1',wait_until='domcontentloaded',timeout=120000)
 page.wait_for_function('window.__cocsReview?.view.perf.frames>20',timeout=120000)
 page.evaluate('''async()=>{const r=window.__cocsReview,{floorAt,obstructed,visible}=r.spatial;const arena=r.match.arena;const n=r.match.nav.find(n=>{const c={x:n.x,y:n.y+1.5,z:n.z-2.8};return floorAt(c.x,c.z,arena)!==null&&!obstructed(n.x,n.y,n.z,1.1,arena)&&!obstructed(c.x,c.y,c.z,.3,arena)&&visible(c,{x:n.x,y:n.y+1,z:n.z},arena)});if(!n)throw new Error('No unobstructed character review angle');window.__characterShot=()=>{const a=r.match.actors[1];Object.assign(a,{x:n.x,y:n.y,z:n.z,yaw:Math.PI,bodyYaw:Math.PI,pitch:0,protection:0,active:0,temporaryShield:0,juggernautShield:0,slow:0,weapon:0,vx:0,vy:0,vz:0});r.view.setFreeCam(true);Object.assign(r.view.freePose,{x:n.x,y:n.y+1.5,z:n.z-2.8,yaw:Math.PI,pitch:-.1});r.view.resetPresentation();};window.__characterShot();}''')
 rows=[]
 for reduced in [False,True]:
  page.evaluate('(v)=>{const r=window.__cocsReview;r.view.setDisplay({...r.view.display,reducedMotion:v})}',reduced)
  page.screenshot(path=str(out/f'alive-reduced-{reduced}.png'))
  page.evaluate('''()=>{const r=window.__cocsReview,a=r.match.actors[1];a.health=0;a.dead=30;a.deaths++;}''')
  page.wait_for_function('''()=>{const r=window.__cocsReview,m=r.view.actorModels.get(r.match.actors[1].id);return ['dying','settled'].includes(r.view.characterLifecycle?.state(m))}''',timeout=15000)
  page.evaluate('window.__cocsReview.match.time+=2')
  page.wait_for_function('''()=>{const r=window.__cocsReview,m=r.view.actorModels.get(r.match.actors[1].id);return r.view.characterLifecycle.state(m)==='settled'}''',timeout=15000)
  page.screenshot(path=str(out/f'settled-reduced-{reduced}.png'))
  corpse=page.evaluate('''()=>{const r=window.__cocsReview,m=r.view.actorModels.get(r.match.actors[1].id);return {position:m.position.toArray(),rotation:m.rotation.toArray(),visible:m.visible}}''')
  page.evaluate('''()=>{const r=window.__cocsReview;r.match.spawn(r.match.actors[1]);window.__characterShot();}''')
  page.wait_for_function('''()=>{const r=window.__cocsReview,m=r.view.actorModels.get(r.match.actors[1].id);return r.view.characterLifecycle.state(m)==='alive'&&m.visible}''',timeout=15000)
  state=page.evaluate('''()=>{const r=window.__cocsReview,m=r.view.actorModels.get(r.match.actors[1].id);return {position:m.position.toArray(),rotation:m.rotation.toArray(),errors:r.metrics().runtimeErrors,viewport:r.view.perf.viewport}}''')
  assert not state['errors'],state
  assert abs(state['rotation'][0])<1e-6 and abs(state['rotation'][2])<1e-6,state
  assert state['viewport']['scale']==1
  rows.append({'reduced':reduced,'corpse':corpse,'respawn':state})
  page.screenshot(path=str(out/f'respawn-reduced-{reduced}.png'))
 browser.close()
 assert not errors,errors
 (out/'lifecycle.json').write_text(json.dumps({'measurement':'SwiftShader compatibility only','rows':rows,'pageErrors':errors},indent=2))
 print('Real-renderer death/settled/respawn checks passed in normal and reduced motion; six screenshots; 100% scale')
