# v8.4 FIELDCRAFT first-time-player playtest worksheet

Use this worksheet with the protocol and targets in
[`docs/GAMEPLAY-UX-FUN-PLAN.md`](../docs/GAMEPLAY-UX-FUN-PLAN.md#first-time-player-session).
Do not fill missing observations from telemetry, bots, automated browser checks or
facilitator inference. This is human evidence for F09/F10, not a CI gate.

## Build and session

- Commit:
- Date / facilitator:
- Deployment or local URL:
- Browser / OS / hardware:
- Viewport / UI scale / graphics preset:
- Input device and remapped controls:
- Audio / captions / reduced motion / palette:
- Fresh-profile method:

## Cohort

Record five participants unfamiliar with this build and two experienced
arena-shooter comparison players. At least one separate touch session and one
keyboard-remapped session are required.

| ID | Experience cohort | Input | Accessibility settings | Prior COCS experience |
|---|---|---|---|---|
| N1 | First-time | | | None |
| N2 | First-time | | | None |
| N3 | First-time | | | None |
| N4 | First-time | | | None |
| N5 | First-time | | | None |
| E1 | Experienced comparison | | | |
| E2 | Experienced comparison | | | |

## Raw task observations

For every task, record what was shown, the participant's first action, hesitation,
stall/recovery, prompts given by the facilitator (ideally none) and the resulting
effective rules. Use simulation/video timestamps rather than estimates.

| Player | Task | Start | First meaningful action | Complete / skip | Stalls, errors and exact preceding actions |
|---|---|---:|---:|---:|---|
| | Choose first match | | | | |
| | Training: move/fire | | | | |
| | Training: capture/supply | | | | |
| | Training: command/traversal | | | | |
| | Operations: spend/terminal | | | | |
| | Normal FFA/team fight | | | | |
| | LATTICE/Operations | | | | |
| | Capture loss | | | | |
| | Death/respawn | | | | |
| | Intermission | | | | |
| | Results and next action | | | | |
| | Demo/spectator follow | | | | |

## Scenario metrics

Report distributions by map, difficulty, gear/progression, input and player
experience; never collapse these into one average.

| Player / scenario | First contact | Dead-to-action | First-3s repeat deaths | Duel TTK + weapon/range | Objective participation | Wave time | Spend | Comeback attempt |
|---|---:|---:|---:|---|---|---:|---|---|
| | | | | | | | | |

## Comprehension and result questions

Ask without pointing at the HUD:

1. How does this match end, and who is closest to winning?
2. What is one useful action you can take now?
3. What changed after your spend/order?
4. Why did the match end?
5. What did you personally contribute?
6. What would you choose next, if anything?

Record answers verbatim. Then score the published binary targets (goal/HUD/spend/
result comprehension, task integrity, stalls, control continuity and clipping).

## Participant ratings

Ask each independently on a 1–5 scale and capture the explanation:

| Player | I knew what to do | My actions mattered | Controls behaved as expected | I want another match | Comments |
|---|---:|---:|---:|---:|---|
| | | | | | |

## Technical viewport/device gate

Record screenshots and observations at 1366×768, 1920×1080, 844×390 and
390×844, then repeat the most constrained state at UI scale 1.4. Include normal
combat, armed command, interaction prompt, HQ siege/wave status, spend window,
death summary and touch controls. Note any overlap with the reticle or sticks and
whether command/spend controls require combat-view scrolling.

## Decision log

- Observed failure selected for iteration:
- Evidence linking the failure to reaction / aim / route / roster density /
  reward loop / feedback:
- One factor proposed for change:
- Counterplay or weapon/class niche that must remain:
- Focused mechanical regression checks:
- Baseline and post-change complete seed runs:
- Voluntary second-match starts and stated reasons:
- Findings explicitly **not** supported by this sample:

No balance change should be approved from an unfilled worksheet or automated-only
technical gate.
