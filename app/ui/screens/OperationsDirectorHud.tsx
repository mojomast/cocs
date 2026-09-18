// LATTICE STRIKE: OPERATIONS — Operations Director readout.
//
// A small, isolated presentation component for `cocs-coop` (O1a). It renders the
// pure `cocsDirectorView` model from `game/cocs-orders.mjs`: the visible
// PRESSURE budget, the BUILD_UP/PEAK/RELAX pace, the current wave, the
// weakest-front retarget, the telegraph, the wave force count and the HQ siege
// meter. Deliberately separate from `CocsReadout` so device/depot UI can evolve
// without touching it. Shape+word, never colour alone (spec §12.9).
import * as React from 'react';

const pct = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
const whole = (value: number) => `${Math.round(Number.isFinite(value) ? value : 0)}`;
const tenths = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '0.0');
const PHASE_LABEL: Record<string, string> = {
  intermission: 'INTERMISSION',
  build_up: 'BUILD-UP',
  peak: 'PEAK',
  relax: 'RELAX',
};

export function OperationsDirectorHud({director}: {director: any}) {
  if (!director) return null;
  const phase = PHASE_LABEL[director.phase] ?? String(director.phase ?? '').toUpperCase();
  const siege = director.siege ?? {armed: false, percent: 1, health: 0, max: 0, attackers: 0, defenders: 0};
  const fronts = Array.isArray(director.fronts) ? director.fronts : [];
  const frontText = fronts.length ? fronts.map((front: any) => front.nodeId).join(' + ') : 'STAGING';
  const telegraph = director.telegraph ? `TELEGRAPH ${String(director.telegraph.kind).toUpperCase()} ${director.telegraph.nodeId ?? ''} ${tenths(director.telegraph.seconds)}s` : 'NO SPAWN SIGNAL';
  const boss = director.boss ? `BOSS ${String(director.boss.type).toUpperCase()} P${director.boss.phase}` : null;
  const executor = director.command?.executor;
  const tierCopy = director.tierCopy ?? null;
  const intermission = director.intermission ?? null;
  const sinks = Array.isArray(intermission?.sinks) ? intermission.sinks : [];
  const bonus = Array.isArray(director.bonus) ? director.bonus : [];
  const modifiers: string[] = Array.isArray(tierCopy?.modifiers) ? tierCopy.modifiers : [];
  return (
    <section className="director-readout" role="region" aria-label={`Operations Director. Wave ${director.wave} of ${director.waveCount}, ${phase}. Pressure ${whole(director.budget.current)} of ${director.budget.cap}. HQ ${whole(siege.health)} of ${whole(siege.max)}${siege.armed ? ', under siege' : ', safe'}.`}>
      <div className="director-readout__head">
        <span className="eyebrow">OPERATIONS DIRECTOR · {director.tier}</span>
        <span className="director-readout__wave">WAVE {director.wave}/{director.waveCount} · {director.waveLabel || '—'}</span>
      </div>
      <div className="director-readout__meter" aria-hidden="true">
        <i className={`director-readout__phase director-readout__phase--${director.phase}`} style={{width: pct(director.pressure)}}/>
      </div>
      <p className="director-readout__line"><span className="director-readout__phase-label">{phase}</span> · PRESSURE <b>{whole(director.budget.current)}</b>/{whole(director.budget.cap)} <small>+{tenths(director.budget.rate)}/s</small></p>
      <p className="director-readout__line">FRONT <b>{frontText}</b> · FORCE <b>{director.waves.forceAlive}</b>/{director.waves.forceTotal} · {director.secondsRemaining > 0 ? `${tenths(director.secondsRemaining)}s` : '—'}</p>
      <p className={`director-readout__telegraph${director.telegraph ? ' is-live' : ''}`}>{telegraph}{boss ? ` · ${boss}` : ''}</p>
      <div className={`director-readout__hq${siege.armed ? ' is-siege' : ''}`} role="group" aria-label={`Headquarters ${siege.hqId} ${whole(siege.health)} of ${whole(siege.max)}${siege.armed ? ' under siege' : ''}`}>
        <span className="eyebrow">{siege.armed ? 'HQ UNDER SIEGE' : 'HQ SECURE'}</span>
        <span className="director-readout__hq-track" aria-hidden="true"><i style={{width: pct(siege.percent)}}/></span>
        <span className="director-readout__hq-value">{whole(siege.health)}/{whole(siege.max)}</span>
        {siege.armed && <small>{siege.attackers} ATK · {siege.defenders} DEF</small>}
      </div>
      {(director.command || director.retarget) && <p className="director-readout__aux">
        {director.retarget ? `TARGET ${director.retarget.nodeId} · ` : ''}
        {executor !== undefined && executor !== null ? `EXECUTOR ${executor} · ` : ''}
        {director.command ? `THREADS ${director.command.threads.used}/${director.command.threads.cap} · SLICE ${director.command.slicePerPlayer}` : ''}
      </p>}
      {tierCopy && <p className="director-readout__copy" data-tier={director.tier}><b>{director.tier} · {tierCopy.label}</b> {tierCopy.copy} {modifiers.length > 0 && <small>{modifiers.join(' · ')}</small>}</p>}
      {bonus.length > 0 && <p className="director-readout__bonus" aria-live="polite">
        {bonus.map((entry: any) => `BONUS ${entry.label} ${whole(entry.progress)}/${whole(entry.target)}`).join(' · ')}
      </p>}
      {intermission && intermission.open && <div className="director-readout__spend" role="group" aria-label={`Intermission spend window. ${tenths(intermission.secondsRemaining)} seconds, ${whole(intermission.budget)} FLUX available.`}>
        <p className="director-readout__line">SPEND WINDOW <b>{tenths(intermission.secondsRemaining)}s</b> · FLUX <b>{whole(intermission.budget)}</b>{intermission.spent > 0 ? ` · SPENT ${whole(intermission.spent)}` : ''}</p>
        <ul className="director-readout__sinks">
          {sinks.map((sink: any) => <li key={sink.verb} className={sink.enabled ? 'is-ready' : 'is-locked'}>
            <b>{sink.label}</b> <small>{whole(sink.cost)} FLUX</small>{sink.enabled ? '' : sink.available ? ' · UNFUNDED' : ' · N/A'}
          </li>)}
        </ul>
      </div>}
    </section>
  );
}

export default OperationsDirectorHud;
