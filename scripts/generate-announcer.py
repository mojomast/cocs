#!/usr/bin/env python3
"""Generate real announcer assets through the authenticated OmniVoice Studio bench.
Set OMNIVOICE_BENCH_URL to your private bench origin. No credentials are saved.
Resumes completed manifest entries; never modifies existing Studio takes.
"""
import array, hashlib, io, json, math, os, pathlib, re, sys, time, urllib.request, wave
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/audio/announcer'
PHRASES = {'capture':'Flag captured!', 'flag-pickup':'Flag taken!', 'flag-return':'Flag returned!', 'goal':'Goal!', 'killstreak':'Kill streak!', 'spree':'Killing spree!', 'multikill':'Multi kill!', 'victory':'Victory!', 'defeat':'Defeat.', 'score':'Score!', 'boss':'Boss incoming!', 'objective':'Objective updated.'}
SEEDS = [42, 137, 526]
def main():
    base = os.environ['OMNIVOICE_BENCH_URL'].rstrip('/')
    html = urllib.request.urlopen(base+'/', timeout=30).read().decode()
    token = re.search(r'name="bench-token" content="([^"]+)"', html)[1]
    def request(path, data=None):
        headers={'X-Bench-Token':token}
        if data is not None: headers['Content-Type']='application/json'
        req=urllib.request.Request(base+path, headers=headers, data=None if data is None else json.dumps(data).encode())
        return urllib.request.urlopen(req, timeout=60).read()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path=OUT/'manifest.json'
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'generator':'OmniVoice Studio', 'schemaVersion':1, 'clips':[]}
    for cue, text in PHRASES.items():
        for seed in SEEDS:
            name=f'{cue}-{seed}.wav'
            if any(c['file']==name for c in manifest['clips']) and (OUT/name).exists(): continue
            recipe={'label':f'COCS announcer / {cue} / seed {seed}', 'text':text, 'instruct':'male, middle-aged, low pitch, american accent', 'language':'en', 'seed':seed, 'num_step':16, 'speed':1, 'guidance_scale':2, 'effect_preset':'raw'}
            take=json.loads(request('/api/takes',recipe)); ident=take['id']
            print('QUEUED',name,ident,flush=True)
            deadline=time.monotonic()+1800
            while time.monotonic()<deadline:
                state=json.loads(request('/api/state'))
                take=next(t for t in state['takes'] if t['id']==ident)
                if take['status'] in ('done','error','interrupted'): break
                time.sleep(3)
            if take['status']!='done': raise RuntimeError(f'{name}: {take}')
            raw=request('/api/audio/'+ident)
            with wave.open(io.BytesIO(raw),'rb') as wav:
                assert wav.getsampwidth()==2 and wav.getnchannels()==1
                rate=wav.getframerate(); samples=array.array('h',wav.readframes(wav.getnframes()))
                if sys.byteorder!='little': samples.byteswap()
            duration=len(samples)/rate
            peak=max(abs(s) for s in samples)/32768
            rms=math.sqrt(sum(s*s for s in samples)/len(samples))/32768
            assert .15<duration<12 and peak>.01 and rms>.001, (name,duration,peak,rms)
            (OUT/name).write_bytes(raw)
            manifest['clips'].append({'cue':cue,'text':text,'seed':seed,'file':name,'sha256':hashlib.sha256(raw).hexdigest(),'duration':round(duration,4),'sampleRate':rate,'peak':round(peak,6),'rms':round(rms,6),'studioTakeId':ident,'recipe':recipe})
            manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
            print('SAVED',name,'seconds',round(duration,2),'rms',round(rms,4),flush=True)
if __name__=='__main__': main()
