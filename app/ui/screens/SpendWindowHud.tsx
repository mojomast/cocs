'use client';
// LATTICE STRIKE: OPERATIONS — O1c between-wave spend window (COCS-OPERATIONS
// §5.2 / design §3.3). Renders the pure `cocsSpendView` model: the four FLUX
// sinks (FORTIFY / REPAIR / RESUPPLY / REINFORCE) with cost, effect and one
// disable reason, the per-player FLUX slice, the rotating EXECUTOR lease and its
// countdown, and THREADS.
//
// Pointer-lock UX: the window is an interactive surface, so the page releases
// the cursor while it is open (the `cursor-mode` machine). Inside the panel
// every sink is a real button (full mouse support, 44px targets, focus-visible),
// and the same actions have keyboard shortcuts: arrows to move, 1–4 to buy,
// Enter/Space to buy the selected sink, S or Escape to skip. A click queues
// `{tick, peerId, cardId, verb, target}` through the page's `{cocs:{spends}}`
// path, so it resolves on the same deterministic `(tick, peerId, cardId)` sort
// as an order — local co-op and network both ride the same call. Shape + word,
// no colour-only state, reduced-motion snap.
import * as React from 'react';

const whole = (value: any) => String(Math.round(Number.isFinite(Number(value)) ? Number(value) : 0));
const tenths = (value: any) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '0.0');

export function SpendWindowHud({spend, onSpend, onSkip, cursorKey = 'ALT', reducedMotion}: any) {
  const reduced = reducedMotion === true;
  const sinks: any[] = Array.isArray(spend?.sinks) ? spend.sinks : [];
  const [active, setActive] = React.useState(0);
  const [confirm, setConfirm] = React.useState<any>(null);
  const [announce, setAnnounce] = React.useState(true);
  // Node-targeted sinks (FORTIFY) let the player choose between held nodes; the
  // page resolved the legal options, so the select can never offer a bad id.
  const [targets, setTargets] = React.useState<Record<string, string>>({});
  // The window only publishes the remaining time, so the bar is proportioned
  // against the first value seen on open. The clock and the seconds text remain
  // the authoritative read; the bar is a second, shape-based cue.
  const totalRef = React.useRef(0);
  if (spend?.open && totalRef.current <= 0) totalRef.current = Math.max(1, Number(spend.secondsRemaining) || 1);

  const buy = (sink: any) => {
    if (!sink || !spend?.open) return;
    if (!sink.enabled) {
      setConfirm({ok: false, id: Date.now(), text: `${sink.label} UNAVAILABLE · ${sink.reason ?? 'LOCKED'}`});
      return;
    }
    const target = targets[sink.id] ?? sink.target;
    // The page pre-flights the local gates and returns {ok, reason}; a refusal
    // (slice, executor, flux) is shown where the click happened.
    const result = onSpend?.(sink.verb, target);
    if (result && result.ok === false) {
      setConfirm({ok: false, id: Date.now(), text: `${sink.label} REJECTED · ${result.reason ?? 'UNAVAILABLE'}`});
      return;
    }
    setConfirm({ok: true, id: Date.now(), text: `${sink.label} QUEUED · ${whole(sink.cost)} FLUX`});
  };

  // Latest-state keyboard handler; the document listener itself is stable so the
  // 12 Hz HUD re-render cannot churn subscriptions while the window is open.
  const handlerRef = React.useRef<(event: KeyboardEvent) => void>(() => {});
  React.useEffect(() => {
    handlerRef.current = (event: KeyboardEvent) => {
      if (!spend?.open) return;
      const code = event.code;
      if ((event.target as HTMLElement)?.tagName === 'SELECT' && (code === 'Enter' || code === 'Space' || code === 'ArrowDown' || code === 'ArrowUp')) return;
      const step = (delta: number) => {
        if (!sinks.length) return;
        setActive(index => Math.max(0, Math.min(sinks.length - 1, index + delta)));
      };
      if (code === 'ArrowDown' || code === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); step(1); return; }
      if (code === 'ArrowUp' || code === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); step(-1); return; }
      if (code === 'Enter' || code === 'Space') { event.preventDefault(); event.stopPropagation(); buy(sinks[active]); return; }
      if (/^Digit[1-4]$/.test(code)) { event.preventDefault(); event.stopPropagation(); buy(sinks[Number(code.slice(-1)) - 1]); return; }
      if (code === 'KeyS' || code === 'Escape') { event.preventDefault(); event.stopPropagation(); onSkip?.(); }
    };
  });
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => handlerRef.current(event);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  React.useEffect(() => {
    setAnnounce(true);
    const timer = setTimeout(() => setAnnounce(false), 3600);
    return () => clearTimeout(timer);
  }, [spend?.windows]);
  React.useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(null), 3200);
    return () => clearTimeout(timer);
  }, [confirm?.id]);

  if (!spend || !spend.open) return null;
  const allowance = spend.allowance ?? {remaining: 0, allowance: 0, perPlayer: 0};
  const threads = spend.threads ?? {used: 0, cap: 0, perPlayer: 0};
  const executor = spend.executor ?? {label: 'CHIEF', secondsRemaining: 0};
  const remaining = Math.max(0, Number(spend.secondsRemaining) || 0);
  const total = Math.max(1, totalRef.current);
  const ratio = Math.max(0, Math.min(1, remaining / total));
  return (
    <section
      className={`cocs-spend${reduced ? ' is-reduced' : ''}`}
      role="region"
      aria-label={`Intermission spend window, ${tenths(remaining)} seconds, ${whole(spend.budget)} flux available. Press 1 to 4 to buy, S to skip.`}
      aria-keyshortcuts="1 2 3 4 Enter S Escape"
    >
      <header className="cocs-spend__head">
        <span className="eyebrow">SPEND WINDOW</span>
        <strong className="cocs-spend__clock" aria-live="off">{tenths(remaining)}s</strong>
        <span className="cocs-spend__flux">FLUX <b>{whole(spend.budget)}</b></span>
      </header>
      <div className="cocs-spend__timer" role="progressbar" aria-label={`${tenths(remaining)} seconds left in the spend window`} aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(remaining)}>
        <i style={{width: `${Math.round(ratio * 100)}%`}} />
      </div>
      {announce && (
        <p className="cocs-spend__banner" role="status">
          <b>SPEND WINDOW OPEN</b>
          <span>{whole(spend.budget)} FLUX · {tenths(remaining)}s TO SPEND</span>
          <small>CLICK A SINK OR PRESS 1–4 · {cursorKey} FREES THE MOUSE · S SKIPS</small>
        </p>
      )}
      <div className="cocs-spend__meta">
        <span aria-label={`Your flux slice: ${whole(allowance.remaining)} of ${whole(allowance.allowance)} remaining`}>SLICE <b>{whole(allowance.remaining)}</b> LEFT</span>
        <span className={executor.you ? 'is-you' : ''} aria-label={`Executor lease ${executor.label}, ${tenths(executor.secondsRemaining)} seconds remaining${executor.you ? ', you hold it' : ''}`}>EXECUTOR <b>▸ {executor.label}</b>{executor.you ? ' (YOU)' : ''} · {tenths(executor.secondsRemaining)}s</span>
        <span aria-label={`Threads ${whole(threads.used)} of ${whole(threads.cap)}${threads.perPlayer > 0 ? `, ${whole(threads.perPlayer)} each` : ''}`}>THREADS <b>{whole(threads.used)}/{whole(threads.cap)}</b>{threads.perPlayer > 0 ? ` · ${whole(threads.perPlayer)} EACH` : ''}</span>
      </div>
      <ul className="cocs-spend__sinks" aria-label="Flux sinks">
        {sinks.map((sink: any, index: number) => {
          const options = Array.isArray(sink.targetOptions) ? sink.targetOptions : [];
          const chosen = targets[sink.id] ?? sink.target ?? null;
          const targetNote = sink.targetRequired && sink.targetLabel ? ` Target ${sink.targetLabel}.` : '';
          return (
          <li key={sink.id}>
            <div className={`cocs-sink${sink.enabled ? ' is-ready' : ' is-locked'}${active === index ? ' is-active' : ''}`}>
              <button
                type="button"
                className="cocs-sink__buy"
                disabled={!sink.enabled}
                aria-keyshortcuts={String(index + 1)}
                aria-label={`${index + 1}. ${sink.label}. ${sink.description} Cost ${whole(sink.cost)} flux.${targetNote}${sink.reason ? ` Unavailable: ${sink.reason}.` : ' Ready.'}`}
                title={sink.reason ? `${sink.label} unavailable: ${sink.reason}` : sink.description}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onClick={() => buy(sink)}
              >
                <span className="cocs-sink__label">
                  <span className="cocs-sink__key" aria-hidden="true">{index + 1}</span>
                  <b>{sink.label}</b>
                  <small>COST <b>{whole(sink.cost)}</b> FLUX</small>
                </span>
                <span className="cocs-sink__effect">{sink.description}</span>
                {sink.reason
                  ? <em className="cocs-sink__reason"><i aria-hidden="true">⚠</i> {sink.reason} · {sink.affordable === false ? 'NEED MORE FLUX' : 'UNAVAILABLE'}</em>
                  : <em className="cocs-sink__ready"><i aria-hidden="true">▶</i> READY · AFFORDABLE</em>}
              </button>
              {options.length > 1 && (
                <label className="cocs-sink__target">TARGET
                  <select
                    aria-label={`${sink.label} target node`}
                    value={chosen ?? ''}
                    disabled={!sink.enabled}
                    onClick={event => event.stopPropagation()}
                    onChange={event => setTargets(current => ({...current, [sink.id]: event.target.value}))}
                  >
                    {options.map((option: any) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              )}
              {options.length <= 1 && sink.targetRequired && chosen && <span className="cocs-sink__target-note">TARGET <b>{sink.targetLabel ?? chosen}</b></span>}
            </div>
          </li>
          );
        })}
        {!sinks.length && <li className="cocs-spend__empty">NO SINKS THIS WINDOW</li>}
      </ul>
      {confirm && <p className={`cocs-spend__confirm${confirm.ok ? ' is-ok' : ' is-failed'}`} role="status" aria-live="polite"><i aria-hidden="true">{confirm.ok ? '✓' : '✕'}</i> {confirm.text}</p>}
      {spend.log?.length > 0 && (
        <p className="cocs-spend__log" role="log" aria-label="Recent spends">
          {spend.log.slice(-3).map((entry: any, index: number) => (
            <span key={`${entry.cardId ?? index}-${index}`} className={entry.ok === false ? 'is-failed' : ''}>
              {entry.verb}{entry.ok === false ? ` ✕ ${entry.reason ?? 'FAILED'}` : ` ✓ ${whole(entry.cost)}F`}
            </span>
          ))}
        </p>
      )}
      <footer className="cocs-spend__footer">
        <span className="cocs-spend__help">ARROWS SELECT · ENTER BUY · 1–4 BUY</span>
        <button type="button" className="cocs-spend__skip" onClick={onSkip}>SKIP · RETURN TO COMBAT <kbd>S</kbd></button>
      </footer>
    </section>
  );
}

export default SpendWindowHud;
