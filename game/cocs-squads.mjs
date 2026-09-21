// Player squads share the existing COCS command envelope. AI reinforcement
// THREADS are a separate resource; these four seats belong to human operators.
export const COCS_SQUAD_CAPACITY = 4;
export const COCS_SQUAD_ACTIONS = Object.freeze(['squad-create', 'squad-join', 'squad-leave', 'squad-promote', 'squad-remove']);
const human = actor => actor && actor.bot == null && actor.isNpc !== true && actor.spectate !== true;
const actorById = (match, id) => (match?.actors ?? []).find(actor => actor && String(actor.id) === String(id));
const squadOf = (state, id) => (state.squads?.list ?? []).find(squad => squad.members.includes(String(id)));
const seatOf = (state, team) => (state.coop ? state.coop.commandSeat : state.command?.seat)?.[team] ?? null;
const fail = reason => ({ok: false, reason});
const squadName = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

/** Read-only gate, used both before enqueueing online and at sim apply time. */
export function cocsCommandAuthority(match, state, record = {}) {
  if (state?.kind !== 'cocs') return fail('no-command');
  const actor = actorById(match, record.peerId);
  if (!human(actor)) return fail('unauthenticated');
  if (actor.team !== 0 && actor.team !== 1) return fail('wrong-team');
  if (actor.team !== record.team || (state.coop && actor.team !== 0)) return fail('wrong-team');
  if (!(actor.health > 0)) return fail('dead');
  if (record.actorId != null && String(record.actorId) !== String(actor.id)) return fail('wrong-actor');
  const id = String(actor.id), team = actor.team, action = String(record.action ?? '').toLowerCase();
  const seat = seatOf(state, team), commander = seat !== null && String(seat) === id;
  if (['release', 'policy', 'set-route'].includes(action) && !commander) return fail('not-commander');
  if (action === 'take' && seat !== null && !commander) return fail('seat-occupied');
  if (action === 'mutiny-vote' && (seat === null || commander)) return fail('no-mutiny');
  const own = squadOf(state, id);
  if (action === 'squad-create') {
    if (own) return fail('already-in-squad');
    const name = squadName(record.value);
    if (!name || name.length > 24 || /[\x00-\x1f\x7f]/.test(name)) return fail('squad-name');
  } else if (action === 'squad-join') {
    const target = (state.squads?.list ?? []).find(squad => squad.id === record.value);
    if (!target) return fail('unknown-squad');
    if (target.team !== team) return fail('wrong-team');
    if (own) return fail('already-in-squad');
    if (target.members.length >= COCS_SQUAD_CAPACITY) return fail('squad-full');
  } else if (action === 'squad-leave') {
    if (!own) return fail('not-in-squad');
  } else if (action === 'squad-promote' || action === 'squad-remove') {
    const target = squadOf(state, record.value);
    if (!target) return fail('not-in-squad');
    if (target.team !== team) return fail('wrong-team');
    if (!commander && target.leader !== id) return fail('not-leader');
    if (String(record.value) === id) return fail('use-leave');
  }
  return {ok: true, reason: null, actor};
}

/** Remove departed/bot-replaced seats; death alone never removes membership. */
export function reconcileCocsSquads(match, state) {
  if (state?.kind !== 'cocs') return;
  const seats = state.coop ? state.coop.commandSeat : state.command?.seat;
  for (const team of [0, 1]) {
    if (seats?.[team] == null) continue;
    const actor = actorById(match, seats[team]);
    if (!human(actor) || actor.team !== team) seats[team] = null;
  }
  if (!state?.squads) return;
  for (const squad of state.squads.list) {
    squad.members = squad.members.filter(id => {
      const actor = actorById(match, id);
      return human(actor) && actor.team === squad.team;
    });
    if (!squad.members.includes(squad.leader)) squad.leader = squad.members[0] ?? null;
  }
  state.squads.list = state.squads.list.filter(squad => squad.members.length > 0);
}

/** Apply only squad actions, after the shared identity/authority gate. */
export function cocsSquadAction(match, state, record) {
  reconcileCocsSquads(match, state);
  const gate = cocsCommandAuthority(match, state, record);
  if (!gate.ok) return gate;
  const action = String(record.action).toLowerCase(), id = String(gate.actor.id);
  state.squads ??= {nextId: 1, list: []};
  const squads = state.squads;
  let squad = squadOf(state, id);
  if (action === 'squad-create') {
    squad = {id: `squad-${record.team}-${squads.nextId++}`, team: record.team, name: squadName(record.value), leader: id, members: [id]};
    squads.list.push(squad);
  } else if (action === 'squad-join') {
    squad = squads.list.find(entry => entry.id === record.value);
    squad.members.push(id);
  } else if (action === 'squad-leave' || action === 'squad-remove') {
    const target = action === 'squad-leave' ? id : String(record.value);
    squad = squadOf(state, target);
    squad.members = squad.members.filter(member => member !== target);
    if (squad.leader === target) squad.leader = squad.members[0] ?? null;
    squads.list = squads.list.filter(entry => entry.members.length > 0);
  } else if (action === 'squad-promote') {
    squad = squadOf(state, record.value);
    squad.leader = String(record.value);
  } else return fail('unknown-action');
  match?.emit?.('cocs-squad', {team: record.team, action, peerId: id, squadId: squad.id});
  return {ok: true, reason: null, squadId: squad.id};
}

/** Frozen team maps, redacted by cocs-intel before going over the wire. */
export function cocsSquadSnapshot(match, state) {
  const result = {};
  for (const team of state.coop ? [0] : [0, 1]) {
    const command = state.coop ? {route: state.coop.commandRoute, policy: state.coop.commandPolicy} : state.command;
    const task = state.tasks?.[team];
    result[team] = {
      capacity: COCS_SQUAD_CAPACITY,
      squads: (state.squads?.list ?? []).filter(squad => squad.team === team).map(squad => ({...squad, members: [...squad.members]})),
      operators: (match?.actors ?? []).filter(actor => human(actor) && actor.team === team).map(actor => ({
        id: String(actor.id), name: actor.name ?? `Operator ${actor.id}`, health: Math.max(0, Math.round(actor.health ?? 0)),
      })),
      order: task && task.until >= state.tick ? {verb: task.verb, nodeId: task.nodeId} : null,
      route: command?.route?.[team] ?? null,
      policy: command?.policy?.[team] ?? null,
    };
  }
  return result;
}
