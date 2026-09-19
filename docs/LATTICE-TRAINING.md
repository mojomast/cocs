# LATTICE FIELD TRAINING

A self-paced tutorial inside a local practice match. Quick Start offers Field
Training (`cocs`) and Operations Training (`cocs-coop`). Both use Lattice Foundry
(`lattice-slice`), easy difficulty, a 15-minute match, default weapon and movement
rules, and a small bot roster (3 / 1 configured bots respectively). Operations
also supplies its normal Director forces. Saved mutators, custom objectives,
weapons and difficulty do not leak into training; only the player name and chosen
operator/harness loadout carry over.

## Pacing and presentation

- **One visible lesson, one evidence window.** The HUD labels CURRENT LESSON,
  shows its number, goal instructions, numeric progress and progress bar, actual
  remapped controls, and a separate NEXT LESSON preview.
- **Explicit completion beat.** Completing a goal retains that lesson as STEP
  CLEAR with a short explanation of what was learned. It stays there until the
  player chooses START NEXT LESSON. There is no automatic countdown that can
  move past an unread instruction. The last lesson offers FINISH TRAINING,
  followed by a completion summary and KEEP PLAYING.
- **Fresh evidence.** Actions during previous lessons or completion screens do
  not pre-complete future lessons. Continue resets lesson counters, channel
  observations and hold timers. Replayed event IDs and events timestamped at or
  before the new lesson boundary are ignored. At most one lesson can complete
  per evaluation.
- **Cursor access and reading breaks.** Completing a lesson pauses the local
  simulation and releases the cursor automatically. START NEXT LESSON resumes
  the match; the final summary stays paused until KEEP PLAYING. During an active
  lesson the footer shows the remapped free-cursor key (Left Alt by default),
  and Escape opens the ordinary pause menu. Tutorial buttons do not reuse Enter
  globally, where it issues orders or confirms purchases.
- **Readable and accessible.** Current/clear announcements are polite live
  regions; continuously changing numeric progress is outside that region.
  Native progress and button semantics, visible keyboard focus, responsive
  scrolling, and animation-free styling support keyboard and reduced-motion use.

## Course and authoritative completion evidence

| Lesson | Goal | Evidence after lesson entry |
|---|---|---|
| MOVE OUT | Move 12 m from spawn | Living local actor's maximum distance from the starting point |
| LIVE FIRE | Fire five shots; hits optional | Five local `shot` events |
| TAKE YOUR FRONT | Capture your HQ-adjacent front, or defend it if already owned | `cocs-capture` includes the local player in participants at that front; alternatively three uninterrupted seconds alive inside its owned, uncontested capture ring |
| KEEP THE LINE | Maintain a supplied objective for three seconds | Owned graph path from an owned HQ to a front, relay or siphon; HQ/array-only links do not count |
| ISSUE AN ORDER | Issue an accepted order | Fresh `cocs-order` from the local issuer; rejected orders and explicit bot issuers do not count |
| RIDE THE ROUTE | Use a route at its anchor | Local `cocs-device-use`; cutting, locking and repairing do not count |
| SECURE A DEPOT | Secure a non-HQ depot apron | Fresh friendly depot capture with local living presence, or three seconds defending an already-owned, uncontested apron; entering the vehicle is optional |
| SPEND THE WINDOW | Buy one available support action | Fresh `coop-spend`; auto-spending is disabled for the practice match |
| USE A TERMINAL | Complete your own HACK, DEPLOY or SABOTAGE channel | Matching team completion event immediately following an observed local channel at that terminal; teammate channels and interrupted channels do not count |
| HOLD THE WAVE | Help clear the next Director wave | Fresh team `director-wave-cleared` observation |

Field Training order: move → fire → capture → connect → order → device → depot.
Operations order: move → fire → capture → connect → spend → order → terminal →
wave → device.

Capture and depot defence alternatives allow progress after a teammate captured
the objective before its lesson. Those alternatives still require new local
participation. Supply/wave are explicitly shared-world observations; firing,
movement, riding, orders, capture participation and terminal channels are local
practice. VAULT is not a required tutorial action because its instantaneous
team event does not carry local actor attribution.

## Exit, match limits and records

END TUTORIAL dismisses guidance at any point and leaves the practice match
running. KEEP PLAYING does the same after completion. The ordinary pause menu's
RETURN TO LOADOUT exits the match. Neither skipping nor dismissing the completion
card claims unearned lessons as completed.

Practice matches award **no XP, challenges, achievements or match-history entry**,
including when played to the end after dismissing the tutorial. The page keeps a
separate practice-match identity so removing the HUD cannot turn the session into
a recorded match. At a normal victory, defeat or timeout, practice returns to
selection with an explicit practice-ended/replay notice. Automatic finished-match
recording is also bypassed for this practice path.

The tutorial is not a protected staged scenario: dominance, the 15-minute limit,
Director progression and Operations HQ loss conditions still apply. A spend
lesson can require waiting for the next window. If the operation ends first,
restart training from Quick Start. A dedicated non-ending lesson arena or staged
Director remains a separate scenario-design task.

## Engine and UI integration

`game/lattice-training.mjs` owns the pure plan and state machine:

- `trainingConfig(mode, {playerName})` creates a clean normalized practice preset.
- `createTraining(mode, {start, time})` starts lesson zero; returns `null` outside
  the LATTICE modes.
- `evaluateTraining(training, {snapshot, events, playerId, lattice})` consumes
  authoritative updates and returns `{training, completedNow}`. It reads the
  actual **`Match.snapshot().cocs.nodes`** shape, objective-zone capture radii,
  traversal depots and terminal channel snapshots. Root-level synthetic `nodes`
  remain supported. Simulation time drives holds; paused time earns nothing.
- `continueTraining(training, {time})` acknowledges only a completed lesson and
  opens the next evidence window. Page integration clears buffered events at
  the same boundary.
- `trainingView(training)` exposes phase, current/next steps, current-goal
  progress, completed lessons and overall course progress.
- `trainingControls(stepId, bindings)` resolves controls from live bindings.
- `skipTraining(training)` is an honest, idempotent early end.

`app/ui/screens/LatticeTrainingHud.tsx` and its colocated CSS module render the
tutorial; `PlayingHud.tsx` only mounts it. Tutorial callbacks and practice-match
lifecycle handling live in narrow sections of `app/page.tsx`.

## Focused verification

Run `node --test game/lattice-training.test.mjs`. Coverage includes both complete
courses, acknowledgement boundaries, stale/duplicate events, local-vs-bot
attribution, hold interruption/pause, already-captured objectives, remapped copy,
clean practice presets, skip semantics, and a real Match regression that reaches
the live nested snapshot supply check after verifying movement and firing.
