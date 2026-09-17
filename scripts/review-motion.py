"""Record actual simulation/rendered ADS transitions, not synthesized frames."""
import argparse,json,pathlib
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4319');p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 context=browser.new_context(viewport={'width':1280,'height':720},device_scale_factor=1,bypass_csp=True,record_video_dir=str(out/'raw'),record_video_size={'width':1280,'height':720})
 page=context.new_page();page.route_web_socket('**',lambda ws:None)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(a.url+'/review?map=colosseum&paused=1&reticle=1',wait_until='domcontentloaded',timeout=120000)
 page.wait_for_function('window.__cocsReview?.view.perf.frames>20',timeout=120000)
 rows=[]
 for weapon in [0,1,2,3,9]:
  page.get_by_label('Weapon',exact=True).select_option(str(weapon))
  start=page.evaluate('''()=>{const r=window.__cocsReview;r.pause(false);r.sequence();return r.match.time}''')
  page.wait_for_function('(t)=>window.__cocsReview.match.time>t+4.2',arg=start,timeout=45000)
  page.evaluate('window.__cocsReview.pause(true)')
  state=page.evaluate('window.__cocsReview.metrics()')
  assert not state['runtimeErrors'],state
  assert state['perf']['viewport']['scale']==1
  rows.append({'weapon':weapon,'metrics':state})
 video=page.video
 context.close();video.save_as(str(out/'ads-transitions.webm'));browser.close()
 assert not errors,errors
 (out/'motion.json').write_text(json.dumps({'measurement':'Recorded SwiftShader real-time compatibility demonstration; not hardware performance','rows':rows,'pageErrors':errors},indent=2))
 print('Recorded five actual 4.2-second simulation ADS sequences; no runtime errors; 100% scale')
