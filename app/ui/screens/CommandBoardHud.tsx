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
// focus-visible ring, shape + word cues and aria labels. The footer says how to
// get back to combat. Reduced-motion snaps instead of animating.
import * as React from 'react';
import {cocsBoardAnnouncement} from '../../../game/cocs-orders.mjs';

const SECTION_STATUS: Record<string, string[]> = {
  needs: ['blocked'],
  running: ['queued', 'running'],
  done: ['done'],
};

const pips = (count: any) => {
  const n = Math.max(0, Math.min(5, Math.round(Number(count) || 0)));
  return '●'.repeat(n) + '○'.repeat(5 - n);
};

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

export function CommandBoardHud({command, open, collapsed, pinned, activeId, reducedMotion, cursorKey = 'ALT', onSelect, onActivate, onClose, onTogglePin}: any) {
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
          aria-label={`Command board collapsed. ${summary.needsYou} blocked, ${summary.running} running. Press B to open, or activate to pin open.`}
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
      aria-label={`Command board. ${summary.needsYou} blocked, ${summary.running} running, ${summary.done} done. Mouse input is active; close the board to return to combat.`}
      aria-keyshortcuts="B Escape Enter ArrowUp ArrowDown Home End"
    >
      <header className="cocs-board__head">
        <span className="eyebrow">COMMAND · LATTICE</span>
        <span className="cocs-board__chip" role="status">{summary.chip}</span>
        <button type="button" className="cocs-board__pin" aria-label={pinned ? 'Unpin command board (closes with B or Escape)' : 'Pin the command board open'} aria-pressed={pinned === true} onClick={onTogglePin}>{pinned ? 'PINNED' : 'PIN'}</button>
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
      <p className="cocs-board__hint"><b>CLICK TO FIGHT</b> · <kbd>{cursorKey}</kbd> OR CLICK THE ARENA RETURNS TO COMBAT · <kbd>B</kbd> / <kbd>ESC</kbd> CLOSES</p>
    </section>
  );
}

export default CommandBoardHud;
