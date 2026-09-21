// Rendering contract only. Do not derive availability from cumulative terminal
// counters: deployedTeam/hacks/uses survive long after an effect has ended.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = (value, fallback = 0) => finite(value) ? value : fallback;
const clamp = value => Math.max(0, Math.min(1, num(value)));
const team = value => value === 0 || value === 1 ? value : null;
const list = value => Array.isArray(value) ? value : value && typeof value === 'object'
  ? Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object').map(([id, entry]) => ({id, ...entry})) : [];

export const LATTICE_MACHINE_KINDS = Object.freeze(['front', 'economy', 'relay', 'array', 'hq', 'HACK', 'DEPLOY', 'VAULT', 'SABOTAGE']);
export const LATTICE_MACHINE_LABELS = Object.freeze({front: 'BASTION', economy: 'SIPHON', relay: 'RELAY', array: 'ARRAY', hq: 'COMMAND', HACK: 'HACK', DEPLOY: 'DEPLOY', VAULT: 'VAULT', SABOTAGE: 'LINK'});

export function latticeAssetSnapshot(match) {
  const input = match?.objectives ?? match?.objectiveState;
  const snapshot = match?.cocs ?? input?.cocs ?? input;
  if (!snapshot || !(input?.kind === 'cocs' || match?.cocs || snapshot.kind === 'cocs')) return null;
  return snapshot;
}

/** A public flat [] is authoritative, including when a legacy tree is stale. */
export function latticeAssetTerminals(snapshot) {
  if (Array.isArray(snapshot?.terminals)) return snapshot.terminals;
  return list(snapshot?.terminals?.terminals ?? snapshot?.terminalState?.terminals ?? snapshot?.director?.terminals);
}

export function latticeMachineState(entry, snapshot, node = entry) {
  const terminal = LATTICE_MACHINE_KINDS.includes(String(entry?.kind).toUpperCase());
  const kind = terminal ? String(entry.kind).toUpperCase() : String(entry?.archetype ?? 'front');
  const owner = team(terminal && Object.hasOwn(entry, 'owner') ? entry.owner : node?.owner);
  const tick = finite(snapshot?.tick) ? snapshot.tick : null;
  const current = effect => tick !== null && finite(effect?.until) && effect.until > tick;
  const raw = String(entry?.simState ?? entry?.state ?? '').toLowerCase();
  const nodeCut = !terminal && ((snapshot?.cuts ?? []).includes(node?.id)
    || latticeAssetTerminals(snapshot).some(t => t.nodeId === node?.id && (t.simState === 'cut' || t.state === 'cut')));
  const blocked = nodeCut || ['cut', 'locked', 'blocked'].includes(raw) || ['blocked', 'locked'].includes(entry?.state);
  const contested = entry?.contested === true || node?.contested === true || entry?.state === 'contested';
  const inputChannel = terminal ? entry?.channel : node?.primeChannel;
  const channel = inputChannel && num(inputChannel.total) > 0 ? inputChannel : null;
  const hacking = kind === 'HACK' && (current(node?.hack) || entry?.phase === 'boosted' && num(entry.effectRemainingSeconds) > 0);
  const deploying = kind === 'DEPLOY' && (typeof entry?.oracleActive === 'boolean' ? entry.oracleActive
    : node?.oracle?.active === true && team(node.oracle.team) !== null && node.oracle.team === owner);
  const prime = current(node?.prime);
  const ward = snapshot?.fieldSupport?.nodes?.[node?.id]?.ward;
  const support = current(ward) && team(ward.team) !== null && ward.team === owner;
  const complete = terminal && ['complete', 'done'].includes(String(entry?.state));
  const active = !blocked && !contested && (terminal ? Boolean(channel || hacking || deploying || complete || entry?.state === 'active') : node?.live === true || prime || Boolean(channel));
  const charge = channel ? clamp(1 - num(channel.remaining) / channel.total)
    : terminal ? (entry?.state === 'active' ? clamp(entry.progress) : 0)
      : Math.max(clamp(node?.progress?.[0]), clamp(node?.progress?.[1]));
  const captureTeam = !terminal && charge > 0 ? (num(node?.progress?.[0]) >= num(node?.progress?.[1]) ? 0 : 1) : null;
  const status = blocked ? 'blocked' : contested ? 'contested' : active ? 'active'
    : terminal ? entry?.phase === 'offline' ? 'offline' : 'ready' : owner !== null ? 'held' : 'offline';
  const bank = snapshot?.terminals?.vault?.byNode?.[entry?.nodeId];
  return {kind, owner, status, blocked, contested, active, charge, captureTeam, support, prime,
    // Availability is not an animation clock, and a ready fabrication bay must
    // never look as though it is printing an agent without an accepted channel.
    moving: active && (terminal ? Boolean(channel) : owner !== null),
    channeling: Boolean(channel), complete,
    shards: kind === 'DEPLOY' ? [entry?.shards?.[0] === 'ready', entry?.shards?.[1] === 'ready'] : [false, false],
    banked: kind === 'VAULT' ? [0, 1].map(team => Math.max(0, Math.floor(num(entry?.banked?.[team], num(bank?.[team]?.length))))) : [0, 0],
    oracle: deploying};
}

/** Positions/radii omitted by compact snapshots come from the authored node.
 * Authored terminals are NOT an entity source: PvP has no Operations terminals. */
export function latticeAssetRecords(match, arena = {}) {
  const snapshot = latticeAssetSnapshot(match);
  if (!snapshot) return [];
  const authored = new Map((arena.nodes ?? []).map(node => [String(node.id), node]));
  const nodes = list(snapshot.nodes);
  const byId = new Map(nodes.map(node => [String(node.id), node]));
  const records = [];
  const add = (entry, node, terminal) => {
    if (entry?.id == null) return;
    const mapNode = authored.get(String(node?.id));
    const x = num(entry.x, num(node?.x, num(mapNode?.x, NaN)));
    const z = num(entry.z, num(node?.z, num(mapNode?.z, NaN)));
    if (!finite(x) || !finite(z)) return;
    // Compact snapshots omit Y; querying the actual surface beats y=0 on Foundry.
    const y = num(entry.y, num(arena.terrain?.height?.(x, z), num(mapNode?.y)));
    const state = latticeMachineState(entry, snapshot, node);
    if (!LATTICE_MACHINE_KINDS.includes(state.kind)) return;
    records.push({key: `${terminal ? 'terminal' : 'node'}:${entry.id}`, id: String(entry.id),
      nodeId: String(node?.id ?? entry.nodeId ?? entry.id), terminal, x, y, z,
      radius: Math.max(.5, num(node?.r ?? node?.radius, num(mapNode?.r ?? mapNode?.radius, 6))),
      reach: terminal ? Math.max(.5, num(entry.reach, 6)) : null, state});
  };
  for (const node of nodes) add(node, node, false);
  for (const entry of latticeAssetTerminals(snapshot)) add(entry, byId.get(String(entry?.nodeId)), true);
  return records.sort((a, b) => a.key.localeCompare(b.key));
}

/** Cargo exists only while the current snapshot says a living actor carries it.
 * Each VAULT repeats the public cargo list; deduplicate before making a marker. */
export function latticeCargoRecords(match) {
  const snapshot = latticeAssetSnapshot(match);
  if (!snapshot) return [];
  const actors = new Map((match?.actors ?? []).map(actor => [String(actor.id), actor]));
  const cargo = latticeAssetTerminals(snapshot).flatMap(terminal => Array.isArray(terminal.cargo) ? terminal.cargo : []);
  if (!Array.isArray(snapshot.terminals)) cargo.push(...list(snapshot.terminals?.vault?.cargo));
  const seen = new Set(), out = [];
  for (const item of cargo) {
    const id = String(item.actor), actor = actors.get(id);
    if (seen.has(id) || !actor || !(actor.health > 0) || team(item.team) === null || actor.team !== item.team
      || !finite(actor.x) || !finite(actor.z)) continue;
    seen.add(id); out.push({id, team: item.team, source: item.source, x: actor.x, y: num(actor.y) + 2.2, z: actor.z});
  }
  return out;
}

/** Service reliefs sit centimetres proud of existing collision faces. Nothing
 * resembling new cover is put in a lane. If there is no suitable solid within
 * reach, the same silhouette is a visibly open wire projection above the floor.
 * `used` keeps co-located HACK/DEPLOY/LINK bays distinct without moving the real
 * interaction anchor. Deterministic under snapshot reordering. */
export function latticeMachinePlacement(record, arena = {}, used = []) {
  const limit = record.terminal ? record.reach - .15 : Math.max(2, record.radius - .5);
  const candidates = [];
  for (const [index, block] of (arena.blocks ?? []).entries()) {
    if (![block.x, block.z, block.w, block.d, block.h].every(finite)) continue;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const width = dx ? block.d : block.w;
      if (width < 1.1) continue;
      const slots = Math.min(17, Math.floor(width / .4));
      for (let slot = 0; slot < slots; slot++) {
        const along = (slot - (slots - 1) / 2) * .4;
        const x = block.x + dx * block.w / 2 + (dz ? along : 0);
        const z = block.z + dz * block.d / 2 + (dx ? along : 0);
        const distance = Math.hypot(x - record.x, z - record.z);
        if (distance > limit) continue;
        const ground = num(arena.terrain?.height?.(x + dx * .15, z + dz * .15), record.y);
        const height = block.h - ground;
        if (height < 1.2) continue;
        const scale = Math.min(.72, (height - .1) / 3.1);
        if (Math.abs(along) + 1.15 * scale > width / 2 - .025) continue;
        const y = ground + .05;
        if (used.some(p => !p.projected && Math.hypot(p.x - x, p.z - z) < 1.15 * (scale + p.scale) + .12)) continue;
        // Reject a buried/internal face, including adjacent authored blocks.
        if ((arena.blocks ?? []).some(other => other !== block && other.h > y + .5
          && Math.abs(x + dx * .12 - other.x) < other.w / 2 && Math.abs(z + dz * .12 - other.z) < other.d / 2)) continue;
        candidates.push({x: x + dx * .045, y, z: z + dz * .045, yaw: Math.atan2(dx, dz),
          scale, depth: .045, projected: false, distance, index, slot});
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.index - b.index || a.slot - b.slot || a.yaw - b.yaw);
  if (candidates.length) return candidates[0];
  const phase = ({HACK: -2.1, DEPLOY: 0, SABOTAGE: 2.1, VAULT: Math.PI})[record.state.kind] ?? Math.PI;
  const radius = record.terminal ? 1.65 : 0;
  const x = record.x + Math.sin(phase) * radius, z = record.z + Math.cos(phase) * radius;
  const ground = num(arena.terrain?.height?.(x, z), record.y);
  return {x, y: Math.max(record.y, ground) + 3.2, z, yaw: phase, scale: .6, depth: .6, projected: true};
}
