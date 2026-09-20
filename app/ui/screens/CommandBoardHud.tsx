'use client';
// LATTICE STRIKE — O1c command board (design §5.1/§5.4/§5.8/§5.10).
//
// A ≤42%-viewport anchored panel, not a screen. On the page the `command`
// binding (default B) toggles it open and a longer hold peeks: opening the board
// is an interactive surface, so the cursor-mode machine releases pointer lock
// while it is open and returns to combat when it closes. It renders the pure
// `cocsBoardView` model — a 3-section exception list (NEEDS YOU / RUNNING /
// DONE) with at most 8 cards on the face, exactly one status chip and one
// blocker reason per card. Navigation is a keyboard listbox (arrows/Home/End/
// Enter — unchanged, driven by the page while the pointer is locked) and every
// row, action, pin, expand and close control is also a full mouse target with a
// focus-visible ring, shape + word cues and aria labels. The footer names the
// bound Command key, Escape and CLOSE as the only ways back to combat.
// Reduced-motion snaps instead of animating.
import * as React from 'react';
import {cocsBoardAnnouncement} from '../../../game/cocs-orders.mjs';
import {formatResource} from '../../../game/format-ui.mjs';
import {DEFAULT_BINDINGS,bindingLabel,bindingShortcut} from '../../../game/keybinds.mjs';

const whole = formatResource;

// ---------------------------------------------------------------------------
// WP1.3 personal REQ slice — truthful purchase surface.
//
// The board is the in-play host: it already owns a pointer-lock surface, so an
// explicit open never steals the cursor by surprise. `ReqStore` renders the
// real `reqPurchaseOptions` model (page-owned): name, cost, effect copy,
// affordability, the one disabled reason and the authoritative balance.
// Dispatch only QUEUES/REQUESTS; `reconcileReqBuys` is what turns authority's
// reply into CONFIRMED/REJECTED, never the click itself.
// ---------------------------------------------------------------------------
export const REQ_REASON_COPY: Record<string, string> = {
  'wrong-mode': 'WRONG MODE',
  'requires-depot': 'NO FRIENDLY DEPOT',
  vehicle: 'DEPOT PUMA ALREADY LIVE',
  'commander-only': 'COMMANDER ONLY',
  'one-active-buff': 'ANOTHER BUFF IS ACTIVE',
  'requires-relay': 'RELAY REQUIRED',
  'insufficient-req': 'NEED MORE REQ',
  'not-launched': 'NOT LAUNCHED',
  'unknown-item': 'UNKNOWN ITEM',
  eliminated: 'ELIMINATED',
  'no-match': 'NO MATCH',
  spectating: 'SPECTATING',
  queued: 'QUEUED · AWAITING AUTHORITY',
  'not-applied': 'NOT APPLIED',
};

/** One vocabulary for a single disabled/refused reason, in words. */
export function reqReasonCopy(reason: any) {
  const key = String(reason ?? '').trim().toLowerCase();
  if (!key) return 'UNAVAILABLE';
  return REQ_REASON_COPY[key] ?? key.replace(/-/g, ' ').toUpperCase();
}

// Ticks of authority silence before an unconfirmed dispatch is shown as a
// refusal instead of a pending row. Generous enough for network latency.
export const REQ_GRACE_TICKS = 90;

/**
 * Reconcile optimistic REQ dispatches against authority. Pure.
 *
 * A pending buy is CONFIRMED only when the authoritative record exists:
 * `buys` (co-op `buyLog`) entries, `cocs-buy` `events`, or a `spent` delta
 * walked in deterministic cardId order. A `refusalReason` (server reject) or a
 * grace-expired unconfirmed row is REFUSED with a named reason. Never confirms
 * from intent alone.
 *
 * @returns {{confirmed:any[],refused:any[],remaining:any[]}}
 */
export function reconcileReqBuys(pending: any[], input: any = {}) {
  const list = Array.isArray(pending) ? pending : [];
  const actorId = input.actorId;
  const tick = Number(input.tick) || 0;
  const graceTicks = Number.isFinite(Number(input.graceTicks)) ? Number(input.graceTicks) : REQ_GRACE_TICKS;
  const buys = Array.isArray(input.buys) ? input.buys : [];
  const events = Array.isArray(input.events) ? input.events : [];
  const reasonFor = typeof input.reasonFor === 'function' ? input.reasonFor : () => null;
  const confirmed: any[] = [], refused: any[] = [], unresolved: any[] = [];
  const claimedBuys = new Set<any>(), claimedEvents = new Set<any>();
  for (const buy of list) {
    if (!buy) continue;
    if (buy.refusalReason) { refused.push({...buy, reason: buy.refusalReason}); continue; }
    const itemId = String(buy.itemId ?? '');
    const logMatch = buys.find((entry: any) => entry && !claimedBuys.has(entry)
      && String(entry.itemId ?? '') === itemId
      && String(entry.actor ?? entry.actorId ?? '') === String(actorId)
      && Number(entry.tick ?? 0) >= Number(buy.tick ?? 0));
    const eventMatch = logMatch ? null : events.find((entry: any) => entry && !claimedEvents.has(entry)
      && String(entry.type) === 'cocs-buy'
      && String(entry.itemId ?? '') === itemId
      && String(entry.actor ?? entry.actorId ?? '') === String(actorId)
      && Number(entry.id ?? 0) > Number(buy.sinceEventId ?? 0));
    if (logMatch) { claimedBuys.add(logMatch); confirmed.push(buy); continue; }
    if (eventMatch) { claimedEvents.add(eventMatch); confirmed.push(buy); continue; }
    unresolved.push(buy);
  }
  // Fallback for paths without a per-item log (PvPvE): the authoritative
  // `reqSpent` delta only ever confirms REQ that was actually debited.
  const spent = Number(input.spent);
  const deltaConfirmed = new Set<any>();
  if (Number.isFinite(spent) && unresolved.length) {
    const floor = Math.min(...unresolved.map(buy => Number(buy.baselineSpent) || 0));
    let delta = Math.max(0, spent - floor);
    for (const buy of confirmed) if (Number(buy.baselineSpent) <= floor) delta = Math.max(0, delta - (Number(buy.cost) || 0));
    const walked = [...unresolved].sort((a, b) => String(a.cardId ?? '').localeCompare(String(b.cardId ?? '')));
    for (const buy of walked) {
      const cost = Math.max(0, Number(buy.cost) || 0);
      if (cost > 0 && delta + 1e-9 >= cost) { delta -= cost; deltaConfirmed.add(buy); confirmed.push(buy); }
    }
  }
  const remaining: any[] = [];
  for (const buy of unresolved) {
    if (deltaConfirmed.has(buy)) continue;
    if (tick > Number(buy.tick ?? 0) + graceTicks) refused.push({...buy, reason: reasonFor(buy) ?? 'not-applied'});
    else remaining.push(buy);
  }
  return {confirmed, refused, remaining};
}

const DEFAULT_COMMAND_KEY = bindingLabel(DEFAULT_BINDINGS.command).toUpperCase();
const DEFAULT_COMMAND_SHORTCUT = bindingShortcut(DEFAULT_BINDINGS.command);

const SECTION_STATUS: Record<string, string[]> = {
  needs: ['blocked'],
  running: ['queued', 'running'],
  done: ['done'],
};

const pips = (count: any) => {
  const n = Math.max(0, Math.min(5, Math.round(Number(count) || 0)));
  return '●'.repeat(n) + '○'.repeat(5 - n);
};

/**
 * Compact REQ purchase list. Real buttons (44px via the shared `.cocs-sink`
 * rules), never hover-only; every row states name, cost, effect, balance and
 * its single disabled reason, plus a shape + word for the pending state.
 */
export function ReqStore({req, onBuy, pending, reducedMotion, defaultOpen = false}: any) {
  const reduced = reducedMotion === true;
  const [open, setOpen] = React.useState(defaultOpen === true);
  const items: any[] = Array.isArray(req?.items) ? req.items : [];
  const pendingList: any[] = Array.isArray(pending) ? pending : [];
  if (!items.length) return null;
  const balance = whole(req?.balance ?? 0);
  return (
    <section className={`cocs-board__req${reduced ? ' is-reduced' : ''}`} aria-label={`Personal REQ store. ${balance} REQ available, ${items.length} items.`}>
      <button
        type="button"
        className="cocs-board__req-toggle"
        aria-expanded={open}
        aria-controls="cocs-req-store"
        style={{minHeight: 44}}
        onClick={() => setOpen(value => !value)}
      >
        <span aria-hidden="true">⇪</span> REQ STORE · <b>{balance}</b> REQ <small>{open ? 'HIDE' : `SHOW ${items.length} ITEMS`}</small>
      </button>
      {open && <div id="cocs-req-store" className="cocs-board__req-body">
        <p className="cocs-board__req-balance" role="status">AUTHORITATIVE BALANCE <b>{balance}</b> REQ · {req?.mode === 'cocs-coop' ? 'OPERATIONS' : 'PVPvE'}</p>
        <ul className="cocs-spend__sinks" aria-label="Personal REQ catalogue">
          {items.map((item: any) => {
            const outstanding = pendingList.find(entry => entry?.itemId === item.id);
            const pendingWord = outstanding ? (outstanding.status === 'requested' ? 'REQUESTED' : 'QUEUED') : null;
            const reason = pendingWord ? `${pendingWord} · AWAITING AUTHORITY` : item.disabledReason ? reqReasonCopy(item.disabledReason) : null;
            const disabled = item.enabled !== true || Boolean(pendingWord);
            const cost = Math.max(0, Number(item.cost) || 0);
            return (
              <li key={item.id}>
                <div className={`cocs-sink${disabled ? ' is-locked' : ' is-ready'}`}>
                  <button
                    type="button"
                    className="cocs-sink__buy"
                    disabled={disabled}
                    aria-label={`${item.name}. ${item.effectCopy ?? 'No effect copy.'} Cost ${whole(cost)} REQ. ${reason ? `Unavailable: ${reason}.` : 'Ready and affordable.'} Balance ${balance} REQ.`}
                    title={reason ? `${item.name} unavailable: ${reason}` : item.effectCopy}
                    onClick={() => onBuy?.(item.id, item.target === 'depot' ? {depotId: req?.depotId ?? null} : undefined)}
                  >
                    <span className="cocs-sink__label">
                      <b>{item.name}</b>
                      <small>COST <b>{whole(cost)}</b> REQ</small>
                    </span>
                    <span className="cocs-sink__effect">{item.effectCopy}</span>
                    {reason
                      ? <em className="cocs-sink__reason"><i aria-hidden="true">⚠</i> {reason}</em>
                      : <em className="cocs-sink__ready"><i aria-hidden="true">▶</i> READY · AFFORDABLE</em>}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>}
    </section>
  );
}

const SectionList = ({section, cards, activeId, expanded, onToggleExpand, onSelect, onActivate}: any) => {
  const shown = expanded ? cards : section.cards;
  return (
    <div className={`cocs-board__section cocs-board__section--${section.id}`} role="group" aria-label={`${section.label}, ${section.count} cards`}>
      <p className="cocs-board__section-head">
        <span>{section.label} <b>({section.count})</b></span>
        {section.expandable && <button type="button" className="cocs-board__expand" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${section.label}, ${section.count} cards`} onClick={() => onToggleExpand(section.id)}>{expanded ? 'COLLAPSE' : `+${section.count - section.cards.length} MORE`}</button>}
      </p>
      <ul className="cocs-board__cards">
        {shown.map((card: any) => <li key={card.id}>
          <div
            id={`cocs-card-${card.id}`}
            role="option"
            tabIndex={-1}
            aria-selected={activeId === card.id}
            aria-label={`${card.verb} ${card.targetLabel}, ${card.agentLabel}, ${card.statusLabel}${card.blockerLabel ? `, blocker ${card.blockerLabel}` : ''}, cost ${card.cost} flux`}
            className={`cocs-card cocs-card--${card.status}${activeId === card.id ? ' is-active' : ''}`}
            title="Click to select, double-click or press Enter for the card action"
            onClick={() => onSelect?.(card.id)}
            onDoubleClick={() => onActivate?.(card, 'check')}
          >
            <span className="cocs-card__verb"><i aria-hidden="true">{card.verbMark}</i> {card.verb}</span>
            <span className="cocs-card__target">{card.targetLabel}</span>
            <span className="cocs-card__agent">{card.agentLabel}</span>
            <span className="cocs-card__cost" aria-label={`Cost ${card.cost} flux`}><i aria-hidden="true">{pips(card.costPips)}</i>{card.cost > 0 && <small>{card.cost}F</small>}</span>
            <span className={`cocs-card__chip cocs-card__chip--${card.status}`}><i aria-hidden="true">{card.statusMark}</i> {card.statusLabel}</span>
            {card.blockerLabel && <span className="cocs-card__blocker"><i aria-hidden="true">⚠</i> {card.blockerLabel}</span>}
            {card.repeat > 0 && <span className="cocs-card__repeat">REPEAT ×{card.repeat}</span>}
            {card.confidence && <span className={`cocs-card__confidence is-${card.confidence}`}>CONF {String(card.confidence).toUpperCase()}</span>}
            {card.etaSeconds > 0 && <span className="cocs-card__eta">ETA {card.etaSeconds}s</span>}
            {(card.status === 'blocked' || card.action) && (
              <span className="cocs-card__actions">
                {card.action && <button type="button" className="cocs-card__act" aria-label={`${card.actionLabel ?? 'Act'} ${card.verb} ${card.targetLabel}`} onClick={(event: any) => { event.stopPropagation(); onActivate?.(card, card.action); }}>{card.actionLabel ?? 'ACT'}</button>}
                {card.status === 'blocked' && <button type="button" aria-label={`Retry ${card.verb} ${card.targetLabel}`} onClick={(event: any) => { event.stopPropagation(); onActivate?.(card, 'retry'); }}>RETRY</button>}
                {card.status === 'blocked' && <button type="button" aria-label={`Check ${card.verb} ${card.targetLabel}`} onClick={(event: any) => { event.stopPropagation(); onActivate?.(card, 'check'); }}>CHECK</button>}
              </span>
            )}
          </div>
        </li>)}
        {!shown.length && <li className="cocs-board__empty">NONE</li>}
      </ul>
    </div>
  );
};

export function CommandBoardHud({command, open, collapsed, pinned, activeId, reducedMotion, commandKey = DEFAULT_COMMAND_KEY, commandShortcut = DEFAULT_COMMAND_SHORTCUT, onSelect, onActivate, onClose, onTogglePin}: any) {
  const view = command?.boardView;
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const listRef = React.useRef<HTMLDivElement>(null);
  if (!view) return null;
  const summary = view.summary ?? {chip: '⚠ 0 blocked · ▶ 0', needsYou: 0, running: 0};
  const reduced = reducedMotion === true;
  if (!open || collapsed) {
    return (
      <>
        <button
          type="button"
          className={`cocs-board-chip${reduced ? ' is-reduced' : ''}`}
          aria-label={`Command board collapsed. ${summary.needsYou} blocked, ${summary.running} running. Press ${commandKey} to open, or activate to pin open.`}
          aria-keyshortcuts={commandShortcut}
          onClick={onTogglePin}
        >
          <span aria-hidden="true">⚠</span> {summary.chip}
        </button>
        <span className="visually-hidden" role="status" aria-live="polite">{cocsBoardAnnouncement(view)}</span>
      </>
    );
  }
  const active = activeId ?? view.listboxIds?.[0] ?? null;
  const widthPercent = Number.isFinite(Number(view.widthPercent)) ? Number(view.widthPercent) : 42;
  const toggleExpand = (id: string) => setExpanded(current => ({...current, [id]: !current[id]}));
  // Clicking a row hands keyboard focus back to the listbox so arrows continue
  // from the mouse selection without a second click.
  const selectCard = (id: any) => {
    onSelect?.(id);
    listRef.current?.focus({preventScroll: true});
  };
  return (
    <section
      className={`cocs-board${reduced ? ' is-reduced' : ''}`}
      style={{width: `${widthPercent}vw`, maxWidth: `${widthPercent}%`} as any}
      aria-label={`Command board. ${summary.needsYou} blocked, ${summary.running} running, ${summary.done} done. Mouse input is active. Press ${commandKey} or Escape, or use CLOSE, to return to combat.`}
      aria-keyshortcuts={`${commandShortcut} Escape Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight Home End`}
    >
      <header className="cocs-board__head">
        <span className="eyebrow">COMMAND · LATTICE</span>
        <span className="cocs-board__chip" role="group" aria-label={`Board status: ${summary.chip}`}>{summary.chip}</span>
        <button type="button" className="cocs-board__pin" aria-label={pinned ? `Unpin command board (closes with ${commandKey} or Escape)` : 'Pin the command board open'} aria-pressed={pinned === true} onClick={onTogglePin}>{pinned ? 'PINNED' : 'PIN'}</button>
        <button type="button" className="cocs-board__close" aria-label="Close command board and return to combat" onClick={onClose}>× CLOSE</button>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite">{cocsBoardAnnouncement(view)}</p>
      <div className="cocs-board__list" ref={listRef} role="listbox" aria-label="Command cards. Use arrow keys to move, Enter for a card action, Escape to close." tabIndex={0} aria-activedescendant={active ? `cocs-card-${active}` : undefined}>
        {view.sections.map((section: any) => (
          <SectionList
            key={section.id}
            section={section}
            cards={view.cards.filter((card: any) => (SECTION_STATUS[section.id] ?? []).includes(card.status))}
            activeId={active}
            expanded={expanded[section.id] === true}
            onToggleExpand={toggleExpand}
            onSelect={selectCard}
            onActivate={onActivate}
          />
        ))}
      </div>
      {command?.req && <ReqStore req={command.req} pending={command.reqPending} onBuy={command.onBuyReq} reducedMotion={reduced}/>}
      <p className="cocs-board__hint"><b>MOUSE ACTIVE</b> · COMMAND <kbd>{commandKey}</kbd> / <kbd>ESC</kbd> / <b>× CLOSE</b> RETURNS TO COMBAT</p>
    </section>
  );
}

export default CommandBoardHud;
