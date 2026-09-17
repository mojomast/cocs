import argparse, json, os, pathlib
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4318');p.add_argument('--out',required=True);p.add_argument('--maps',default='colosseum,convoy-line,moth-backrooms');a=p.parse_args()
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1280,'height':720},device_scale_factor=1,bypass_csp=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 for map_id in a.maps.split(','):
  errors.clear()
  page.goto(a.url+'/review?map='+map_id+'&seed=42&overview=1&paused=1',wait_until='domcontentloaded',timeout=120000)
  page.wait_for_function('window.__cocsReview && window.__cocsReview.view.perf.frames > 140',timeout=180000)
  page.evaluate('window.__cocsReview.pause(true)')
  data=page.evaluate('window.__cocsReview.metrics()');data['measurement']='Chromium SwiftShader, compatibility only; not hardware FPS';data['errors']=errors[:]
  data['gl']=page.evaluate('''()=>{const gl=window.__cocsReview.view.renderer.getContext?.();if(!gl)return null;const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?{vendor:gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}:{renderer:gl.getParameter(gl.RENDERER)}}''')
  (out/(map_id+'-metrics.json')).write_text(json.dumps(data,indent=2))
  page.screenshot(path=str(out/(map_id+'-overview.png')))
  print(map_id,json.dumps(data),flush=True)
  if errors or data.get('runtimeErrors'):
   raise RuntimeError('Review capture contains runtime errors; see saved metrics')
 browser.close()
