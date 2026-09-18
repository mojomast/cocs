'use client';
// LATTICE STRIKE: OPERATIONS — O1c between-wave spend window (COCS-OPERATIONS
// §5.2 / design §3.3). Renders the pure `cocsSpendView` model: the four FLUX
// sinks (FORTIFY / REPAIR / RESUPPLY / REINFORCE) with cost, effect and one
// disable reason, the per-player FLUX slice, the rotating EXECUTOR lease and its
// countdown, and THREADS. A click queues `{tick, peerId, cardId, verb, target}`
// through the page's `{cocs:{spends}}` path, so it resolves on the same
// deterministic `(tick, peerId, cardId)` sort as an order. Shape + word, no
// colour-only state, reduced-motion snap.
import * as React from 'react';

const whole = (value: any) => String(Math.round(Number.isFinite(Number(value)) ? Number(value) : 0));
const tenths = (value: any) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '0.0');

export function SpendWindowHud({spend, onSpend, reducedMotion}: any) {
  if (!spend || !spend.open) return null;
  const reduced = reducedMotion === true;
  const allowance = spend.allowance ?? {remaining: 0, allowance: 0, perPlayer: 0};
  const threads = spend.threads ?? {used: 0, cap: 0, perPlayer: 0};
  const executor = spend.executor ?? {label: 'CHIEF', secondsRemaining: 0};
  return (
    <section
      className={`cocs-spend${reduced ? ' is-reduced' : ''}`}
      role="region"
      aria-label={`Intermission spend window, ${tenths(spend.secondsRemaining)} seconds, ${whole(spend.budget)} flux available.`}
    >
      <header className="cocs-spend__head">
        <span className="eyebrow">SPEND WINDOW</span>
        <strong className="cocs-spend__clock">{tenths(spend.secondsRemaining)}s</strong>
        <span className="cocs-spend__flux">FLUX <b>{whole(spend.budget)}</b></span>
      </header>
      <div className="cocs-spend__meta">
        <span aria-label={`Your flux slice: ${whole(allowance.remaining)} of ${whole(allowance.allowance)} remaining`}>SLICE <b>{whole(allowance.remaining)}</b> LEFT</span>
        <span className={executor.you ? 'is-you' : ''} aria-label={`Executor lease ${executor.label}, ${tenths(executor.secondsRemaining)} seconds remaining${executor.you ? ', you hold it' : ''}`}>EXECUTOR <b>▸ {executor.label}</b>{executor.you ? ' (YOU)' : ''} · {tenths(executor.secondsRemaining)}s</span>
        <span aria-label={`Threads ${whole(threads.used)} of ${whole(threads.cap)}${threads.perPlayer > 0 ? `, ${whole(threads.perPlayer)} each` : ''}`}>THREADS <b>{whole(threads.used)}/{whole(threads.cap)}</b>{threads.perPlayer > 0 ? ` · ${whole(threads.perPlayer)} EACH` : ''}</span>
      </div>
      <ul className="cocs-spend__sinks">
        {spend.sinks.map((sink: any) => (
          <li key={sink.id}>
            <button
              type="button"
              className={`cocs-sink${sink.enabled ? ' is-ready' : ' is-locked'}`}
              disabled={!sink.enabled}
              title={sink.reason ? `${sink.label} unavailable: ${sink.reason}` : sink.description}
              aria-label={`${sink.label}. ${sink.description} Cost ${whole(sink.cost)} flux.${sink.reason ? ` Unavailable: ${sink.reason}.` : ' Ready.'}`}
              onClick={() => onSpend?.(sink.verb, sink.target)}
            >
              <span className="cocs-sink__label"><b>{sink.label}</b> <small>{whole(sink.cost)} FLUX</small></span>
              <span className="cocs-sink__effect">{sink.description}</span>
              {sink.reason
                ? <em className="cocs-sink__reason"><i aria-hidden="true">⚠</i> {sink.reason}</em>
                : <em className="cocs-sink__ready"><i aria-hidden="true">▶</i> READY</em>}
            </button>
          </li>
        ))}
        {!spend.sinks.length && <li className="cocs-spend__empty">NO SINKS THIS WINDOW</li>}
      </ul>
      {spend.log?.length > 0 && (
        <p className="cocs-spend__log" role="log" aria-label="Recent spends">
          {spend.log.slice(-3).map((entry: any, index: number) => (
            <span key={`${entry.cardId ?? index}-${index}`} className={entry.ok === false ? 'is-failed' : ''}>
              {entry.verb}{entry.ok === false ? ` ✕ ${entry.reason ?? 'FAILED'}` : ` ✓ ${whole(entry.cost)}F`}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export default SpendWindowHud;
