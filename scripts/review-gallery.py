"""Index real saved evidence without declaring visual or performance approval."""
import html,json,pathlib
root=pathlib.Path(__file__).resolve().parents[2]/'cocs-evidence'
sections=[]
for folder,title in [('map-atlas','Map overviews'),('built-weapons','Built-preview weapons'),('built-characters','Built-preview character lifecycle')]:
 cards=[]
 for p in sorted((root/folder).glob('*.png')):
  rel=p.relative_to(root).as_posix();name=html.escape(p.stem)
  cards.append(f'<figure><a href="{rel}"><img loading="lazy" src="{rel}" alt="{name}"></a><figcaption>{name}</figcaption></figure>')
 sections.append(f'<h2>{title}</h2><div class="grid">'+''.join(cards)+'</div>')
clips=''.join(f'<p><a href="{p.relative_to(root).as_posix()}">{html.escape(p.name)}</a></p>' for p in sorted((root/'motion').glob('*.webm')))
page='''<!doctype html><meta charset="utf-8"><title>Phase 1 work-in-progress evidence</title><style>body{background:#10151d;color:#e7edf5;font:16px system-ui;margin:24px}a{color:#8cddff}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%}figcaption{padding:6px}p{max-width:1000px}</style><h1>Phase 1 work-in-progress evidence</h1><p>Not an approval gate. Captures use actual runtime at 1280×720, DPR 1, 100% render scale, pinned high quality. SwiftShader compatibility evidence only—not hardware performance or gameplay balance. Map overviews cannot establish ground-level visibility or traversal quality. Latest seven changed-map captures and weapon/character captures use the built preview; other atlas captures use the development preview.</p><p><a id="preview">Open isolated built review</a></p><script>document.querySelector('#preview').href=location.protocol+'//'+location.hostname+':4321/review?reticle=1';</script>'''+''.join(sections)+'<h2>Actual recorded ADS simulation sequences</h2>'+clips
(root/'index.html').write_text(page)
metrics=list((root/'map-atlas').glob('*-metrics.json'))
issues=[]
for p in metrics:
 d=json.loads(p.read_text())
 if d.get('errors') or d.get('runtimeErrors'):issues.append(p.name)
print(json.dumps({'map_images':len(list((root/'map-atlas').glob('*.png'))),'map_metrics':len(metrics),'error_bearing_maps':issues,'gallery':str(root/'index.html')}))
if issues:raise SystemExit(1)
