'use client';
import * as React from 'react';
import {trainingControls} from '../../../game/lattice-training.mjs';
import styles from './LatticeTrainingHud.module.css';

/** The control that must own focus the moment a lesson beat changes. */
export function trainingFocusTarget(training: any) {
  if (!training) return null;
  if (training.done) return 'keep';
  if (training.phase === 'complete') return 'continue';
  return null;
}

/** Only phase/title changes are live-announced; numeric progress updates quietly. */
export function LatticeTrainingHud({training, bindings, cursorKey, onContinue, onEnd}: any) {
  const clear = training.phase === 'complete', done = training.done;
  const continueRef = React.useRef<HTMLButtonElement | null>(null);
  const keepRef = React.useRef<HTMLButtonElement | null>(null);
  // The completion beat and the final KEEP PLAYING beat are paused, explicit
  // surfaces: focus lands on their primary action so a keyboard-only player can
  // continue or leave without ever falling back to document.body.
  const focusTarget = trainingFocusTarget(training);
  React.useEffect(() => {
    const element = focusTarget === 'continue' ? continueRef.current : focusTarget === 'keep' ? keepRef.current : null;
    if (!element) return;
    element.focus({preventScroll: true});
  }, [focusTarget, training.index, training.phase, training.done]);
  const number = (value: number) => String(Math.round(value * 10) / 10);
  const title = done ? training.skipped ? 'TUTORIAL ENDED' : 'TRAINING COMPLETE' : `${clear ? 'STEP CLEAR' : 'CURRENT LESSON'} · ${training.index + 1} / ${training.total}`;
  return <section className={styles.panel} data-training-phase={training.phase} aria-label={training.title}>
    <header className={styles.header}><span>{training.title}</span><span>{training.completed.length} / {training.total} complete</span></header>
    <p style={{margin:0,font:'700 10px/1.5 var(--font-mono,monospace)',letterSpacing:'.06em',color:'#adc6c6'}}>PRACTICE MATCH · NO XP / CHALLENGES / HISTORY</p>
    <div role="status" aria-live="polite" aria-atomic="true">
      <span className={styles.phase}>{title}</span>
      {!done && <h2>{training.step.title}</h2>}
      <p>{done
        ? `${training.skipped ? 'Tutorial ended.' : 'Training complete.'} This practice match awards no XP, challenges or match history. Choose your next step.`
        : clear ? training.step.success : training.step.detail}</p>
    </div>
    {!done && !clear && <>
      <div className={styles.goal}><b>GOAL PROGRESS</b><span>{number(training.goal.value)} / {number(training.goal.target)} {training.goal.label}</span></div>
      <progress className={styles.progress} value={training.goal.value} max={training.goal.target} aria-label={training.goal.label}/>
      <p className={styles.controls}>{trainingControls(training.step.id, bindings)}</p>
    </>}
    {!done && <div className={styles.next}><b>{training.next ? 'NEXT LESSON' : 'UP NEXT'}</b><span>{training.next ? `${training.index + 2} / ${training.total} · ${training.next.title}` : 'Finish training · Keep practising'}</span>{clear && <small>Ready when you are. The next lesson starts only when you continue.</small>}</div>}
    <footer className={styles.footer}>
      <small>{clear||done?'Match paused. Read at your pace, then continue.':`${cursorKey} frees the cursor · Escape pauses to read.`}</small>
      <div className={styles.actions} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')event.stopPropagation();}}>
        {clear && <button type="button" ref={continueRef} className={styles.primary} onClick={onContinue}>{training.next ? 'START NEXT LESSON' : 'FINISH TRAINING'}</button>}
        {done && <button type="button" className={styles.primary} onClick={()=>onEnd?.('recommended')}>RECOMMENDED MATCH</button>}
        {done
          ? <button type="button" ref={keepRef} onClick={()=>onEnd?.('practice')}>KEEP PLAYING</button>
          : <button type="button" onClick={onEnd}>END TUTORIAL</button>}
        {done && <button type="button" onClick={()=>onEnd?.('loadout')}>LOADOUT</button>}
      </div>
    </footer>
  </section>;
}
