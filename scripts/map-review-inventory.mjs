import {MAPS} from '../game/maps.mjs';
import {NEXTGEN_MAPS} from '../game/nextgen-maps.mjs';
import {arenaMeta} from '../game/arenas.mjs';
import {CAMPAIGN_MISSIONS} from '../game/campaign-data.mjs';
import {writeFileSync,existsSync} from 'node:fs';
const classic=new Set(['exchange','crosswire','foundry','launchpad','citadel']);
const special=new Set(['puma-circuit','puma-pitch']);
const causeways=new Set(['sunken-hill','atrium','slagworks','forge','dune-ravine','ember-caldera']);
const status=m=>{
 if(classic.has(m.id))return 'Individual geometry/reward review: [classic handoff](phase1-classic-handoff.md); five focused checks passed; visual/play review pending';
 if(special.has(m.id))return 'Marker/navigation + browser smoke verified; Circuit also has gate/furniture checks; driving/play review pending';
 if(NEXTGEN_MAPS.includes(m))return `Individual geometric review: [nextgen handoff](phase1-nextgen-handoff.md)${causeways.has(m.id)?'; superseded deck defects: [causeway correction](phase1-bridge-handoff.md)':''}${['frost-gate','catacombs'].includes(m.id)?'; portal correction integrated and production regression checked (see phase1-portal-handoff.md)':''}; visual review pending`;
 return 'Individual geometric review: [legacy handoff](phase1-legacy-handoff.md); lead verified 19 focused checks; visual/play review pending';
};
const rows=MAPS.map(m=>`| ${m.id} | ${m.name} | ${(arenaMeta(m).play||[]).join(', ')} | ${CAMPAIGN_MISSIONS.filter(c=>c.mapId===m.id).map(c=>c.id).join(', ')||'none'} | ${status(m)} | ${existsSync(`docs/evidence/phase1/maps/${m.id}-overview.png`)?'Atlas captured; not visually approved':'Atlas pending'} |`);
writeFileSync('docs/PHASE1-MAP-COVERAGE.md',`# Phase 1 map coverage ledger\n\nBaseline e79fcc048d7d97e7418d2e6fdbdd304b69362fa0. Registry/mode/campaign inventory, including legacy selections. No map is counted visually approved. Shared fixes alone are not individual review. Numeric baseline: ../cocs-evidence/baseline/map-audit.json.\n\n| ID | Identity | Modes | Missions | Review status | Capture status |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## Evidence and limits\nIndividual findings, authored route intent, edits/no-change rationale, reward diagnostics and remaining issues are in the linked handoffs. Causeways are ground-supported cut/fill ramps, not stacked bridges or underpasses. Campaign IDs are preserved; defenders were predeployed, changing reinforcement pacing. See phase1-campaign-handoff.md and phase1-remaining-campaign-handoff.md.\n\nAtlas: docs/evidence/phase1/maps/. Captures use real Match/ArenaView, seed 42, 1280x720 DPR1, 100% scale, high quality pinned, paused overview. Chromium SwiftShader captures are compatibility evidence, not hardware FPS, human combat balance or aesthetic approval. An overview cannot prove interior traversal.\n\n## Outstanding\nGround-level visual/play checks, close character inspection and hardware performance validation remain. The user authorized committing/pushing this checkpoint, then live deployment and phase 2 by the next agent. See PHASE2-HANDOFF.md. Authorization does not convert unverified quality or balance claims into completed checks.\n`);
