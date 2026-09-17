"""Bounded real-renderer ADS smoke; screenshots are evidence, not visual approval."""
import argparse,json,pathlib
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4319');p.add_argument('--out',required=True);a=p.parse_args()
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1280,'height':720},device_scale_factor=1,bypass_csp=True)
 # Freeze the loaded module graph during the bounded check: other workers
 # edit source concurrently; HMR teardown is not a gameplay failure.
 page.route_web_socket('**',lambda ws: None)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(a.url+'/review?map=colosseum&paused=1&reticle=1',wait_until='domcontentloaded',timeout=120000)
 page.wait_for_function('window.__cocsReview?.view.perf.frames>20',timeout=120000)
 rows=[]
 for weapon in range(10):
  page.get_by_label('Weapon',exact=True).select_option(str(weapon))
  page.evaluate('()=>{const r=window.__cocsReview;r.view.setFreeCam(false);r.setAim(false)}')
  page.wait_for_function('(w)=>window.__cocsReview.view.currentWeapon===w',arg=weapon,timeout=15000)
  page.wait_for_function('window.__cocsReview.view._adsController.state.progress<.01',timeout=15000)
  page.screenshot(path=str(out/f'weapon-{weapon}-hip.png'))
  page.evaluate('window.__cocsReview.setAim(true)')
  page.wait_for_function('window.__cocsReview.view._adsController.state.reticle.ready',timeout=15000)
  page.wait_for_function("document.querySelector('.aim-layer')?.classList.contains('is-ads')",timeout=15000)
  page.screenshot(path=str(out/f'weapon-{weapon}-ads.png'))
  state=page.evaluate('''()=>{const r=window.__cocsReview,s=r.view._adsController.state;return {weapon:r.match.actors[0].weapon,progress:s.progress,fov:s.fov,position:s.position.toArray(),runtimeErrors:r.metrics().runtimeErrors,viewport:r.view.perf.viewport}}''')
  assert all(isinstance(n,(int,float)) for n in state['position'])
  assert not state['runtimeErrors'],state
  assert state['viewport']['scale']==1,state
  rows.append(state)
  # A reversal must leave the ready state; reload must lower the pose even
  # while input remains held. Drive actual ArenaView frames, not helper calls.
  page.evaluate('window.__cocsReview.setAim(false)')
  page.wait_for_function('window.__cocsReview.view._adsController.state.progress<.5',timeout=15000)
  page.evaluate('window.__cocsReview.setAim(true)')
  page.wait_for_function('window.__cocsReview.view._adsController.state.reticle.ready',timeout=15000)
  page.evaluate('window.__cocsReview.match.actors[0].reloading=true')
  page.wait_for_function('window.__cocsReview.view._adsController.state.progress<.01',timeout=15000)
  page.evaluate('window.__cocsReview.match.actors[0].reloading=false')
  page.get_by_role('button',name='Reduced motion',exact=True).click()
  page.wait_for_function('window.__cocsReview.view._adsController.state.progress===1',timeout=15000)
  page.get_by_role('button',name='Reduced motion',exact=True).click()
 (out/'weapons-smoke.json').write_text(json.dumps({'measurement':'SwiftShader compatibility, not hardware FPS or visual approval','rows':rows,'pageErrors':errors},indent=2))
 assert not errors,errors
 # Regression: caught render exceptions must remain available to capture tools.
 page.evaluate('''()=>{const r=window.__cocsReview;const render=r.view.render;r.view.render=function(...args){this.render=render;throw new Error('review-capture-regression-sentinel')}}''')
 page.wait_for_function("window.__cocsReview.metrics().runtimeErrors.some(e=>e.includes('review-capture-regression-sentinel'))",timeout=15000)
 browser.close()
 print(f'{len(rows)} real-renderer weapon hip/ADS checks passed; 20 screenshots; scale 100%; caught-error reporting verified')
