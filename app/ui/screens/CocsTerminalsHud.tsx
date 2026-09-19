'use client';
// LATTICE STRIKE: OPERATIONS — O1c terminals + roles surface (design §12.3a:
// HACK / DEPLOY / VAULT). Renders the pure `cocsTerminalView` model. Each entry
// carries a shape glyph *and* a word; state and ownership are never carried by
// colour alone (§13.4). The extra role surface is whatever a wave exposes on
// `snapshot.roles`/`snapshot.command.roles` — this view stays dark until then.
import * as React from 'react';

const ownerWord = (terminal: any) => (terminal.mine ? 'YOURS' : terminal.enemy ? 'ENEMY' : terminal.owner === null || terminal.owner === undefined ? 'NEUTRAL' : `TEAM ${terminal.owner}`);

export function CocsTerminalsHud({terminals, reducedMotion}: any) {
  if (!terminals) return null;
  const list = Array.isArray(terminals.terminals) ? terminals.terminals : [];
  const roles = Array.isArray(terminals.roles) ? terminals.roles : [];
  if (!terminals.hasTerminals && !terminals.hasRoles) return null;
  return (
    <section className={`cocs-terminals${reducedMotion === true ? ' is-reduced' : ''}`} role="region" aria-label={`Terminals. ${terminals.hint}.`}>
      {terminals.hasTerminals && <>
        <p className="cocs-terminals__head"><span className="eyebrow">TERMINALS</span> <small>{terminals.hint}</small></p>
        <ul className="cocs-terminals__list">
          {list.map((terminal: any) => (
            <li key={terminal.id} className={`cocs-terminal is-${terminal.state}`} aria-label={`${terminal.label}, ${terminal.kind} terminal, ${terminal.stateLabel}, ${ownerWord(terminal)}${terminal.progressPercent > 0 ? `, ${terminal.progressPercent} percent` : ''}`}>
              <span className="cocs-terminal__kind" aria-hidden="true">{terminal.kindMark}</span>
              <span className="cocs-terminal__prompt">{terminal.prompt}</span>
              <span className="cocs-terminal__state"><i aria-hidden="true">{terminal.stateMark}</i> {terminal.stateLabel}</span>
              {terminal.progressPercent > 0 && <span className="cocs-terminal__bar" aria-hidden="true"><i style={{width: `${terminal.progressPercent}%`}}/></span>}
              <span className="cocs-terminal__owner">{ownerWord(terminal)}</span>
            </li>
          ))}
          {!list.length && <li className="cocs-terminals__empty">NO TERMINALS</li>}
        </ul>
      </>}
      {terminals.hasRoles && (
        <div className="cocs-roles" role="group" aria-label="Operator roles">
          <span className="eyebrow">ROLES</span>
          <ul>
            {roles.map((role: any) => (
              <li key={role.id}>
                <span aria-hidden="true">{role.mark}</span>
                <b>{role.label}</b>
                <small>{role.stateLabel}{role.cap > 0 ? ` ${role.count}/${role.cap}` : ''}</small>
                {role.detail && <em>{role.detail}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default CocsTerminalsHud;
