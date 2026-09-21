'use client';
import * as React from 'react';
import styles from './SquadPanel.module.css';

type Squad = {id: string; name: string; team: number; leader: string; members: string[]};
type Operator = {id: string; name: string; health: number};
type Board = {capacity: number; squads: Squad[]; operators: Operator[]; order: {verb: string; nodeId: string} | null; route: string | null; policy: string | null};
export type SquadPanelProps = {
  /** The authoritative `hud.cocs` subtree, for local and network matches alike. */
  snapshot: any;
  /** The controlled actor; never the transport peer id or a spectate target. */
  player: {id: string | number; team: number; health?: number} | null;
  onCommand: (action: string, value?: string | number | null) => unknown;
  spectate?: boolean;
  disabled?: boolean;
  notice?: string | null;
};

const words = (value: string) => value.replaceAll('-', ' ').toUpperCase();

/** Membership and command ownership always come from the latest snapshot. */
export function SquadPanel({snapshot, player, onCommand, spectate = false, disabled = false, notice}: SquadPanelProps) {
  const [name, setName] = React.useState('');
  const nameId = React.useId();
  const board: Board | undefined = player && !spectate ? snapshot?.squadBoard?.[player.team] : undefined;
  if (!board || !player) return null;
  const id = String(player.id);
  const me = board.operators.find(operator => operator.id === id);
  const current = board.squads.find(squad => squad.members.includes(id));
  const command = snapshot.commander ?? snapshot.command;
  const seat = command?.seat?.[player.team] ?? null;
  const commander = seat !== null && String(seat) === id;
  const canAct = !disabled && !!me && me.health > 0;
  const nodeLabel = (nodeId: string) => snapshot.nodes?.find((node: any) => node.id === nodeId)?.label ?? nodeId;
  const seatName = board.operators.find(operator => operator.id === String(seat))?.name ?? `Operator ${seat}`;
  const lastResult = (snapshot.commandResults ?? []).findLast((result: any) => result.peerId === id);
  const submit = (action: string, value: string | number | null = null) => { if (canAct) onCommand(action, value); };
  return (
    <section className={styles.panel} aria-label="Player squads" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <header className={styles.heading}>
        <div><h3>SQUADS</h3><p>{current ? `${current.name} · ${current.leader === id ? 'Squad leader' : 'Member'}` : 'You are unassigned'}</p></div>
        <span>{board.capacity} seats / squad</span>
      </header>
      <p className={styles.help}>Player squads · AI reinforcements use separate THREADS. Orders below are team-wide.</p>
      {!canAct && <p className={styles.help}>{disabled ? 'Squad controls unavailable.' : me ? 'Controls unlock on respawn.' : 'No controlled operator seat.'}</p>}
      <div className={styles.orders}>
        <span><b>TEAM ORDER</b> {board.order ? `${board.order.verb} · ${nodeLabel(board.order.nodeId)}` : 'No active order'}</span>
        <span><b>TEAM ROUTE</b> {board.route ? nodeLabel(board.route) : 'Automatic objectives'}</span>
        <span><b>STANCE</b> {board.policy ?? 'Automatic'}</span>
      </div>
      <ul className={styles.squads}>
        {board.squads.map(squad => {
          const mine = squad.id === current?.id;
          const manage = commander || squad.leader === id;
          return <li key={squad.id} className={`${styles.squad} ${mine ? styles.mine : ''}`}>
            <div className={styles.squadHeading}>
              <b>{squad.name}{mine ? ' · YOUR SQUAD' : ''}</b><span>{squad.members.length}/{board.capacity}</span>
              {mine ? <button type="button" disabled={!canAct} onClick={() => submit('squad-leave')}>Leave</button>
                : <button type="button" disabled={!canAct || !!current || squad.members.length >= board.capacity} title={current ? 'Leave your current squad first' : undefined} onClick={() => submit('squad-join', squad.id)}>{squad.members.length >= board.capacity ? 'Full' : 'Join'}</button>}
            </div>
            <ul className={styles.roster} aria-label={`${squad.name} roster`}>
              {squad.members.map(memberId => {
                const member = board.operators.find(operator => operator.id === memberId);
                const roles = [squad.leader === memberId ? 'Leader' : 'Operator', String(seat) === memberId ? 'Commander' : null].filter(Boolean).join(' · ');
                return <li key={memberId}>
                  <div><b>{member?.name ?? `Operator ${memberId}`}{memberId === id ? ' (you)' : ''}</b><small>{roles} · {member ? member.health > 0 ? `${member.health} HP` : 'Down' : 'Unavailable'}</small></div>
                  {manage && memberId !== id && <div className={styles.memberActions}>
                    {squad.leader !== memberId && <button type="button" disabled={!canAct} aria-label={`Promote ${member?.name ?? memberId} to squad leader`} onClick={() => submit('squad-promote', memberId)}>Make leader</button>}
                    <button type="button" disabled={!canAct} aria-label={`Remove ${member?.name ?? memberId} from squad`} onClick={() => submit('squad-remove', memberId)}>Remove</button>
                  </div>}
                </li>;
              })}
            </ul>
          </li>;
        })}
      </ul>
      {!board.squads.length && <p className={styles.help}>No player squads yet. Create one to lead it.</p>}
      {!current && <form className={styles.create} onSubmit={event => {event.preventDefault(); submit('squad-create', name.trim());}}>
        <label htmlFor={nameId}>New squad name</label>
        <input id={nameId} value={name} maxLength={24} autoComplete="off" placeholder="e.g. Vanguard" disabled={!canAct} onChange={event => setName(event.target.value)}/>
        <button type="submit" disabled={!canAct || !name.trim()}>Create squad</button>
      </form>}
      {current?.leader === id && <p className={styles.help}>Leaving transfers leadership to the next member. An empty squad is disbanded.</p>}
      <div className={styles.command}>
        <div className={styles.squadHeading}><b>TEAM COMMAND</b><span>{seat === null ? 'Duty Chief' : commander ? 'You' : seatName}</span>
          {seat === null ? <button type="button" disabled={!canAct} onClick={() => submit('take')}>Take command</button>
            : commander ? <button type="button" disabled={!canAct} onClick={() => submit('release')}>Release command</button>
              : <button type="button" disabled={!canAct} onClick={() => submit('mutiny-vote')}>Vote mutiny</button>}
        </div>
        {commander && <div className={styles.commandControls}>
          <p className={styles.help}>You can manage every allied squad. Stance and route direct the team&apos;s AI.</p>
          <label>Team stance<select value={board.policy ?? ''} disabled={!canAct} onChange={event => submit('policy', event.target.value || null)}>
            <option value="">Automatic</option>{['ASSAULT', 'HOLD', 'FORTIFY'].map(policy => <option key={policy} value={policy}>{policy}</option>)}
          </select></label>
          <label>Team route<select value={board.route ?? ''} disabled={!canAct} onChange={event => submit('set-route', event.target.value || null)}>
            <option value="">Automatic objectives</option>{(snapshot.nodes ?? []).map((node: any) => <option key={node.id} value={node.id}>{node.label ?? node.id}</option>)}
          </select></label>
        </div>}
      </div>
      <p className={styles.status} role="status">{notice || (lastResult ? `${words(lastResult.action)} · ${lastResult.ok ? 'Confirmed' : `Refused: ${words(lastResult.reason ?? 'unavailable')}`}` : 'Membership updates after authority confirmation.')}</p>
    </section>
  );
}

export default SquadPanel;
