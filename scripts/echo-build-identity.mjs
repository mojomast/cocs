#!/usr/bin/env node
import {buildIdentity} from '../game/build-identity.mjs';

// Print the current process build identity as JSON, or one field for shell use:
//   node scripts/echo-build-identity.mjs
//   node scripts/echo-build-identity.mjs buildId
//   node scripts/echo-build-identity.mjs --service=token-arena-game-server release
const args = process.argv.slice(2);
let service;
let field = null;
for (const arg of args) {
 if (arg.startsWith('--service=')) { service = arg.slice('--service='.length); continue; }
 if (arg.startsWith('--')) { console.error(`Unknown option: ${arg}`); process.exit(64); }
 if (field) { console.error(`Unexpected argument: ${arg}`); process.exit(64); }
 field = arg;
}
const identity = buildIdentity(process.env, service);
if (field) {
 if (!Object.hasOwn(identity, field)) {
  console.error(`Unknown identity field: ${field} (expected one of ${Object.keys(identity).join(', ')})`);
  process.exit(64);
 }
 console.log(String(identity[field]));
} else {
 console.log(JSON.stringify(identity));
}
