// Preserve original PNGs; captions live in the index and machine-readable manifest.
import {MAPS} from '../game/maps.mjs';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const source=resolve(process.argv[2]||'../cocs-evidence/map-atlas');
const out=resolve('docs/evidence/phase1/maps');mkdirSync(out,{recursive:true});
const built=new Set(['exchange','crosswire','foundry','launchpad','citadel','frost-gate','catacombs']);
const entries=[];
for(const map of MAPS){
 const image=`${map.id}-overview.png`,metrics=`${map.id}-metrics.json`;
 const bytes=readFileSync(join(source,image)),data=JSON.parse(readFileSync(join(source,metrics),'utf8'));
 if(data.map!==map.id||data.errors?.length||data.runtimeErrors?.length)throw Error(`Invalid evidence: ${map.id}`);
 if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==1280||bytes.readUInt32BE(20)!==720)throw Error(`Unexpected PNG dimensions: ${image}`);
 if(data.perf.viewport.scale!==1||data.perf.qualityAuto!==false)throw Error(`Uncontrolled quality: ${map.id}`);
 copyFileSync(join(source,image),join(out,image));copyFileSync(join(source,metrics),join(out,metrics));
 entries.push({id:map.id,name:map.name,label:`${map.name} (${map.id}) — phase 1 overview`,image,metrics,width:1280,height:720,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceFileModifiedAt:statSync(join(source,image)).mtime.toISOString(),preview:built.has(map.id)?'built preview':'development preview',captureSeed:data.seed,authoredSeed:data.authoredSeed,reviewStatus:'Captured; not ground-level visual or balance approval'});
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({baseline:'e79fcc048d7d97e7418d2e6fdbdd304b69362fa0',captureRevision:'Uncommitted phase 1 workspace; do not attribute capture to baseline commit',notes:'Original screenshots retained without pixel overlays. sourceFileModifiedAt is source file metadata, not independently verified capture time. SwiftShader compatibility only; zero embedded frame timings are invalid. Labels and IDs come from actual MAPS registry.',maps:entries},null,2)+'\n');
writeFileSync(join(out,'README.md'),'# Phase 1 map screenshot atlas\n\n41 original, labeled map overviews. Each caption includes the display name and stable map ID. PNGs are unmodified; manifest.json records dimensions, hashes, source metadata and preview provenance. Companion metrics include renderer/settings and error records.\n\nThese are actual Match/ArenaView captures at 1280×720, DPR 1, 100% render scale, high quality pinned, seed 42, paused overview. Seven maps were refreshed from the built preview; others use the development preview, as recorded in the manifest. Software rendering is not hardware performance evidence. Overviews do not prove interior traversal, visual acceptance or combat balance. Captures predate the containing commit. No phase 2 material/audio/HUD work is shown.\n\n'+entries.map(e=>`## ${e.name} — ${e.id}\n\n![${e.label}](${e.image})\n\n[Original PNG](${e.image}) · [Metrics](${e.metrics}) · ${e.preview}\n`).join('\n'));
console.log(`Archived and verified ${entries.length} labeled map PNGs with metrics and SHA-256 manifest.`);
