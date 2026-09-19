'use client';
// LATTICE STRIKE — O1c command board (design §5.1/§5.4/§5.8/§5.10).
//
// A ≤42%-viewport anchored peek panel, not a screen: hold the `command` binding
// to open it, release to fight. It renders the pure `cocsBoardView` model — a
// 3-section exception list (NEEDS YOU / RUNNING / DONE) with at most 8 cards on
// the face, exactly one status chip and one blocker reason per card. Navigation
// is a keyboard listbox (pointer-locked players get arrows/Home/End/Enter) and
// the "Needs you" sentence is an aria-live region. Every glyph is paired with a
// word, and reduced-motion snaps instead of animating.
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
        {section.expandable && <button type="button" className="cocs-board__expand" aria-expanded={expanded} onClick={() => onToggleExpand(section.id)}>{expanded ? 'COLLAPSE' : `+${section.count - section.cards.length} MORE`}</button>}
      </p>
      <ul className="cocs-board__cards">
        {shown.map((card: any) => <li key={card.id}>
          <div
            id={`cocs-card-${card.id}`}
            role="option"
            aria-selected={activeId === card.id}
            aria-label={`${card.verb} ${card.targetLabel}, ${card.agentLabel}, ${card.statusLabel}${card.blockerLabel ? `, blocker ${card.blockerLabel}` : ''}, cost ${card.cost} flux`}
            className={`cocs-card cocs-card--${card.status}${activeId === card.id ? ' is-active' : ''}`}
            onClick={() => onSelect?.(card.id)}
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
            {card.status === 'blocked' && (
              <span className="cocs-card__actions">
                <button type="button" onClick={(event: any) => { event.stopPropagation(); onActivate?.(card, 'retry'); }}>RETRY</button>
                <button type="button" onClick={(event: any) => { event.stopPropagation(); onActivate?.(card, 'check'); }}>CHECK</button>
              </span>
            )}
          </div>
        </li>)}
        {!shown.length && <li className="cocs-board__empty">NONE</li>}
      </ul>
    </div>
  );
};

export function CommandBoardHud({command, open, collapsed, pinned, activeId, reducedMotion, onSelect, onActivate, onClose, onTogglePin}: any) {
  const view = command?.boardView;
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  if (!view) return null;
  const summary = view.summary ?? {chip: '⚠ 0 blocked · ▶ 0', needsYou: 0, running: 0};
  const reduced = reducedMotion === true;
  if (!open || collapsed) {
    return (
      <>
        <button
          type="button"
          className={`cocs-board-chip${reduced ? ' is-reduced' : ''}`}
          aria-label={`Command board collapsed. ${summary.needsYou} blocked, ${summary.running} running. Hold the command key to open, or activate to pin.`}
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
  return (
    <section
      className={`cocs-board${reduced ? ' is-reduced' : ''}`}
      style={{width: `${widthPercent}vw`, maxWidth: `${widthPercent}%`} as any}
      aria-label={`Command board. ${summary.needsYou} blocked, ${summary.running} running, ${summary.done} done.`}
    >
      <header className="cocs-board__head">
        <span className="eyebrow">COMMAND · LATTICE</span>
        <span className="cocs-board__chip" role="status">{summary.chip}</span>
        <button type="button" className="cocs-board__pin" aria-pressed={pinned === true} onClick={onTogglePin}>{pinned ? 'PINNED' : 'PIN'}</button>
        <button type="button" className="cocs-board__close" aria-label="Close command board" onClick={onClose}>×</button>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite">{cocsBoardAnnouncement(view)}</p>
      <div className="cocs-board__list" role="listbox" aria-label="Command cards. Use arrow keys to move, Enter for a card action, Escape to close." tabIndex={0} aria-activedescendant={active ? `cocs-card-${active}` : undefined}>
        {view.sections.map((section: any) => (
          <SectionList
            key={section.id}
            section={section}
            cards={view.cards.filter((card: any) => (SECTION_STATUS[section.id] ?? []).includes(card.status))}
            activeId={active}
            expanded={expanded[section.id] === true}
            onToggleExpand={toggleExpand}
            onSelect={onSelect}
            onActivate={onActivate}
          />
        ))}
      </div>
    </section>
  );
}

export default CommandBoardHud;
