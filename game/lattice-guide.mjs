// Read-only coaching: advice and the topology diagram come from the same map
// and authoritative snapshot as the match. This never issues orders or spends.
import {DEFAULT_BINDINGS} from './keybinds.mjs';

export const isLattice = mode => mode === 'cocs' || mode === 'cocs-coop';
export function latticeKeys(bindings = {}) {
  const label = action => String(bindings[action] ?? DEFAULT_BINDINGS[action])
    .replace(/^Key/, '').replace(/^Digit/, '').replace(/Left$|Right$/, '').toUpperCase();
  return Object.fromEntries(['interact', 'mobility', 'power', 'command', 'commandScan', 'commandGo', 'commandAttack'].map(action => [action, label(action)]));
}

export function latticeBriefing(mode, bindings = {}) {
  if (!isLattice(mode)) return null;
  const keys = latticeKeys(bindings), coop = mode === 'cocs-coop';
  return {
    title: coop ? 'OPERATIONS / FIELD GUIDE' : 'LATTICE STRIKE / FIELD GUIDE',
    objective: coop
      ? 'Clear five Director waves before time runs out. Keep your HQ alive and your supply line connected.'
      : 'Capture connected ground and hold a majority to win by dominance. At the time limit, objective score decides the match.',
    steps: [
      {title: '01 / TAKE YOUR FRONT', detail: 'Follow the link from your HQ to the front gate. Stand inside its capture ring and clear enemies. Capture is automatic; no interaction key is needed.'},
      {title: '02 / BUILD A SUPPLY LINE', detail: 'Only nodes adjacent to one your team owns can be taken. Push the relay or a side siphon, then defend the link home. Connected nodes earn team FLUX; a cut-off node stops paying.'},
      {title: '03 / SUPPORT THE PUSH', detail: `${keys.commandScan} SCAN, ${keys.commandGo} GO/HOLD or ${keys.commandAttack} ATTACK → number key for a target → ENTER to issue. SCAN spends team FLUX. Hold ${keys.command} for the command board; release to return to the fight.`},
      {title: '04 / USE THE ROUTES', detail: `At a device anchor, press ${keys.interact} when the prompt says RIDE. Away from the anchor the same key can CUT/LOCK the route; on a broken route it REPAIRS. Depots capture by standing nearby; ${keys.interact} enters the loaner vehicle.`},
      ...(coop ? [{title: '05 / SURVIVE THE DIRECTOR', detail: `Between waves, spend FLUX on fortify, repair, resupply or reinforce. At a terminal, ${keys.interact} starts the displayed HACK, DEPLOY or VAULT action. Watch the HQ alarm and fall back before a siege breaks through.`}] : []),
    ],
    movement: `Every loadout has a ground route. ${keys.mobility} uses your operator’s mobility verb; grapple users aim at a higher solid surface and hold the key to reel upward, then release. ${keys.power} activates your harness ability.`,
    legend: [
      {mark: '⌂', name: 'HQ', detail: 'Home, supply origin and Operations siege target.'},
      {mark: '▲', name: 'FRONT', detail: 'Your first capture and the link into the battlefield.'},
      {mark: '⬢', name: 'RELAY', detail: 'Central junction: short rotations, exposed approaches.'},
      {mark: '◆', name: 'SIPHON', detail: 'Side objective: income and an alternative front.'},
      {mark: '⇢', name: 'ROUTE', detail: 'Device anchor; read RIDE / CUT / REPAIR before pressing.'},
      {mark: '▣', name: 'DEPOT', detail: 'Hold the apron to capture, then collect a loaner.'},
    ],
  };
}

const fallbackLabels = {'hq-0': 'WEST HQ', 'hq-1': 'EAST HQ', 'front-0': 'WEST FRONT', 'front-1': 'EAST FRONT', 'relay-0': 'FOUNDRY RELAY', 'econ-n': 'NORTH SIPHON', 'econ-s': 'SOUTH SIPHON'};
export function latticeNodeLabel(node, map) {
  const authored = map?.nodes?.find(entry => entry.id === node?.id);
  return authored?.label ?? node?.label ?? fallbackLabels[node?.id] ?? String(node?.id ?? 'NODE').toUpperCase();
}

export function latticeCoach(hud, player, map) {
  if (!isLattice(hud?.config?.mode) || !hud?.cocs || !map?.nodes || !player) return null;
  const team = player.team;
  if (team !== 0 && team !== 1) return null;
  const raw = new Map((hud.cocs.nodes ?? []).map(node => [node.id, node]));
  const links = map.lattice ?? [];
  const nodes = map.nodes.map(authored => {
    const state = raw.get(authored.id) ?? {};
    const adjacent = links.some(([a, b]) => a === authored.id && raw.get(b)?.owner === team || b === authored.id && raw.get(a)?.owner === team);
    const mine = state.owner === team, capturable = !['hq', 'array'].includes(authored.archetype);
    return {...authored, ...state, label: latticeNodeLabel(authored, map), mine,
      legal: capturable && state.live === true && (mine || adjacent),
      distance: Math.hypot(player.x - authored.x, player.z - authored.z),
      mark: {hq: '⌂', front: '▲', relay: '⬢', economy: '◆'}[authored.archetype] ?? '●',
      status: state.contested ? 'CONTESTED' : mine ? 'YOURS' : state.owner === 0 || state.owner === 1 ? 'ENEMY' : 'NEUTRAL'};
  });
  const eligible = nodes.filter(node => node.legal);
  const nearest = list => [...list].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
  const underfoot = nearest(eligible.filter(node => node.distance <= node.r));
  const threatened = nearest(eligible.filter(node => node.mine && node.contested));
  const target = underfoot && (!underfoot.mine || underfoot.contested) ? underfoot : threatened ?? nearest(eligible.filter(node => !node.mine)) ?? nearest(eligible);
  let title = 'KEEP YOUR SUPPLY LINE CONNECTED', detail = 'Follow the links from your HQ to a live front. Ground ramps are available to every operator.';
  if (target) {
    const inside = target.distance <= target.r;
    title = `${target.contested ? 'CLEAR' : target.mine ? 'DEFEND' : inside ? 'CAPTURE' : 'ADVANCE TO'} ${target.label}`;
    detail = target.contested ? 'Both teams are on the point. Clear the enemies so capture can resume.'
      : inside && !target.mine ? 'Stay inside the ring. Capture is automatic — keep the approach covered.'
        : `${Math.round(target.distance)} m away · ${target.mine ? 'Hold this link so the forward nodes keep earning FLUX.' : 'Reach the capture ring via a ground route or a traversal shortcut.'}`;
  }
  if (player.health <= 0) { title = 'REGROUP ON RESPAWN'; detail = 'Protect the route from HQ to your front; a different operator or harness can fill a missing team role.'; }
  return {title, detail, targetId: target?.id ?? null, nodes, links, player: {x: player.x, z: player.z}, bounds: map.bounds};
}

// A single keyboard router shared by local and online play. Returning null
// leaves chat, weapon selection and the ordinary pause handler in control.
export function latticeOrderKey({mode = '', spectate = false, code = '', action = '', armed = false, repeat = false} = {}) {
  if (!isLattice(mode) || spectate || repeat) return null;
  const verb = {commandScan: 'SCAN', commandGo: 'GO', commandAttack: 'ATTACK'}[action];
  if (verb) return {type: 'arm', verb};
  if (armed && /^Digit[1-9]$/.test(code)) return {type: 'pick', index: Number(code.slice(-1))};
  if (armed && code === 'Enter') return {type: 'issue'};
  if (armed && code === 'Escape') return {type: 'cancel'};
  return null;
}
