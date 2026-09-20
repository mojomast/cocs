# First-time-player playtest worksheet (governed protocol)

This is the WP3.1 amendment of `reports/playtest-v8.4-template.md`; the path is
kept so existing links stay valid. The file name is not a build claim: record the
real release, commit and build ID in section S.

Use this worksheet with the protocol and targets in
[`docs/GAMEPLAY-UX-FUN-PLAN.md`](../docs/GAMEPLAY-UX-FUN-PLAN.md#first-time-player-session).
Do not fill missing observations from telemetry, bots, automated browser checks
or facilitator inference. This is human evidence for F09/F10, not a CI gate.

**How to use it.** Sections G and P are study-level: fill them once and reference
them from every session. Sections S, O, T, Q, R, X and A are filled for one
participant session; F logs that session's interventions and deviations; V is a
per-build technical record; D is completed after the cohort. Budget per
participant: consent and setup 5–10 minutes, play 45–60 minutes,
questions/rematch/manifest 15–20 minutes. Leave nothing blank — write `NONE` or
`NOT COLLECTED` with the reason.

## Evidence key (one tag per cell; never merge)

| Tag | Means | May support | May not support |
|---|---|---|---|
| **OBS** | Observed behavior: what the participant visibly did or clicked, with a clock time | Claims about behavior | Inferred motive, fun or comprehension |
| **QUOTE** | Participant statement, verbatim in quotes | Stated reason or opinion | A claim the participant did not make |
| **FAC** | Facilitator interpretation, explicitly tagged as such | A hypothesis to verify | Standalone evidence; never restated as the participant |
| **TEL** | Telemetry/artifact: event log, replay, screenshot, simulation tick, browser manifest | Timing, state and geometry corroboration | Human fun, comfort, comprehension or agency on its own |

Rules: split mixed claims into separate cells; a QUOTE keeps the participant's
words rather than a summary; FAC must name what it is inferring from; TEL must
give a file/offset locator (`A#`, video timestamp, event-log offset). Unlabeled
cells are invalid.

## G. Governance (complete once before the first session; re-confirm each session)

Fill every `[bracket]` before the first session. If a policy below is not
decided, sessions do not start.

### G1. Consent and recording script

Read aloud, answer questions, then confirm before any recording, note-taking or
app launch.

> "This session studies how easy COCS is to understand and control. It is
> voluntary. You may pause, skip a task or stop at any time, with no penalty. We
> are recording: [notes / audio / video / screen capture / the optional
> device-local study log]. We record it to [purpose]. It is kept until
> [delete-by date or retention period] and then deleted; only [who] can see it.
> Your name and contact details are [not collected / stored separately from your
> participant code]. If you withdraw, we delete [which artifacts] by
> [date/method]. Do you consent to take part, and to each recording you allow?"

| Item | Record? | What exactly | Why | Retained until | Who can see it | Withdrawal effect |
|---|---|---|---|---|---|---|
| Session notes | | | | | | |
| Audio | | | | | | |
| Video (face / no face) | | | | | | |
| Screen capture / replay | | | | | | |
| Device-local study log (WP3.2, opt-in) | | | | | | |
| Event-log checksum only | | | | | | |

A participant may refuse any recording and still take part if
`[researcher: state whether possible]`. Record every refusal.

| Participant code | Date/time | Consented to play | Recordings consented | Recordings refused | Consent record ID | Verified by |
|---|---|---|---|---|---|---|
| | | | | | | |

### G2. Voluntary participation and withdrawal

| Rule | Answer |
|---|---|
| Eligibility (age, health/medical exclusions; guardian consent for a minor) | `[researcher: define]` |
| How a participant withdraws (any time, any reason; say "stop" or tell the facilitator) | |
| Partial withdrawal: already-collected data kept? | `[researcher: yes/no]` |
| Full withdrawal: artifacts deleted within | `[researcher: N days]` |
| Who performs deletion and how it is confirmed | |
| Compensation (if any) and whether withdrawal affects it | |
| Incidental-findings or re-contact policy | |
| Withdrawal log location (kept outside this worksheet) | |

Do not describe unfinished sessions as data, and do not use inducements that
make stopping feel costly.

### G3. Data minimization rules

Collect only the artifact rows in G1 and A. Do not collect or record:

- names or contact details in notes or filenames — use the participant code;
- account IDs, player UUID/progress token, IP address, chat or voice content;
- exact keystrokes/raw input streams, passwords or unrelated tabs;
- precise world coordinates beyond what a listed metric needs;
- production analytics or silent instrumentation of any kind.

Incidental capture (for example a name visible in a recording) must be listed in
A as incidental and redacted or deleted on recognition.

### G4. Retention and deletion process

| Artifact class | Retention period | Delete by | Deletion method | Confirmed by |
|---|---|---|---|---|
| Raw recordings | `[researcher: N days]` | | | |
| Notes and transcripts | | | | |
| Code-to-name key (if any) | | | | |
| De-identified aggregate findings | | | | |
| Checksums and manifests | | | | |

Retention must not exceed `[researcher: max]`. Delete on schedule even if
analysis is unfinished, unless the participant is re-consented.

### G5. Participant codes

| Rule | Answer |
|---|---|
| Code format (random, e.g. `P-<4 random alphanumerics>`) | |
| Generated by / where | |
| Are names or contact details collected? | `No (preferred) / Yes` |
| If yes, separate storage outside the repository (locked file at `[path]`) | |
| Key destroyed when | |
| Codes are never reused across studies | `Confirmed` |

### G6. Adverse events and stop criteria

Stop immediately, pause the match and release the cursor when any of these
appear: the participant says stop or break; nausea, dizziness, headache, eye
strain, disorientation, sweating, shortness of breath or distress; or the
facilitator judges the participant is uncomfortable.

| Event | Immediate action | Record | Follow-up |
|---|---|---|---|
| Motion sickness or discomfort | Pause, offer a quiet break and water; do not resume while symptoms persist | OBS + QUOTE in F | Offer to end; seek medical advice if symptoms continue; report to `[contact]` |
| Pain, injury or equipment harm | Stop; first aid as needed | OBS in F | Report to `[contact]` |
| Distress or privacy incident | Stop; remind the participant of the withdrawal path | OBS + QUOTE in F | Follow G2/G4 |
| Technical failure that changes the scenario | Pause and note; restart the segment or exclude it | TEL + FAC in F | State the data effect |

No session resumes after a medical stop without the participant's clear,
unprompted request and a break of at least `[researcher: N minutes]`.

### G7. Accessibility accommodations

| Accommodation | Offered to all | Used by participant | Notes |
|---|---|---|---|
| Remapping plus a printed/on-screen remap card | ☐ | | |
| Captions, larger text, UI scale up to 1.4x | ☐ | | |
| Reduced motion, palette and color-vision settings | ☐ | | |
| Touch device session (required for at least one participant) | ☐ | | |
| Screen reader (NVDA + Chrome/Firefox, VoiceOver + Safari) | | | |
| Breaks, water, seating, extra time, no time pressure | ☐ | | |
| Quiet room / no face filming | | | |
| Facilitator reads questions aloud and writes answers verbatim | | | |

Accommodations are not protocol deviations. Record which were used so that
comparisons stay honest.

## S. Session and build identity (once per session)

| Field | Value |
|---|---|
| Release / codename (title footer) | |
| Commit SHA (full) | |
| Web build ID / server build ID (`/api/version`, game-server identity) | |
| Protocol version | |
| Deployment or local URL | |
| Fresh-profile method | |
| Browser / OS / hardware (CPU, GPU, RAM) | |
| Viewport / DPR / UI scale / graphics preset | |
| Input device and remapped controls | |
| Audio / captions / reduced motion / palette | |
| Date / session start–end / facilitator | |
| Scenario IDs / seeds / map / mode / difficulty / gear | |
| Build mismatches or incidents found | |

## P. Cohort and scenario assignment (study-level)

Record five participants unfamiliar with this build and two experienced
arena-shooter comparison players. At least one separate touch session and one
keyboard-remapped session are required. Assign cells before the first session;
do not re-deal cells to whoever is available.

### P1. Scenario-assignment matrix with denominators

`Planned n` is how many sessions were assigned to the cell; `Delivered n` is how
many contributed data; `Withdrawn` stays separately visible. Every rate in D
uses that cell's `Delivered n`. Never pool cells with different
map/mode/difficulty/gear/input/experience.

| Cell | Scenario (map / mode / difficulty / gear) | Input | Experience cohort | Planned n | Delivered n | Withdrawn n | Notes |
|---|---|---|---|---|---|---|---|
| C1 | Fresh profile → choose and launch a first match | Desktop | First-time | 5 | | | |
| C2 | Field Training (LATTICE course) | Desktop | First-time | 5 | | | |
| C3 | Operations Training, including SPEND and TERMINAL | Desktop | First-time | 5 | | | |
| C4 | One short FFA/team fight | Desktop | First-time | 5 | | | |
| C5 | One LATTICE/Operations session, including capture loss, death/respawn and intermission | Desktop | First-time | 5 | | | |
| C6 | Results → next action → voluntary rematch invitation (X) | Desktop | First-time | 5 | | | |
| C7 | Real touch-device session | Touch | First-time or comparison | ≥1 | | | |
| C8 | Remapped-keyboard session | Remapped keys | First-time or comparison | ≥1 | | | |
| C9 | Control/feel comparison on the same scenarios | Desktop | Experienced | 2 | | | |
| C10 | Demo/spectator comfort and target follow | Desktop | Any | 1–2 | | | |

If a participant does not reach a cell, record why in F (withdrew, training
stall, technical failure) — never silently shrink the denominator.

### P2. Participant roster

| Code | Experience cohort | Input | Accessibility settings used | Prior COCS experience | Sessions (cells) | Completed / withdrew | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## O. Raw task observations (per participant)

For every task record what was shown, the participant's first action, hesitation,
stall/recovery and prompts given (ideally none). Use the anchors in T1 and
simulator/video timestamps, not estimates. Add a row per attempt or incident.
Keep participant words (QUOTE) separate from observed actions (OBS).

| Player | Task | Start (anchor + clock) | First meaningful action (+clock) | Complete / skip (+clock) | Evidence tag | Stalls, errors and exact preceding actions |
|---|---|---|---|---|---|---|
| | Choose first match | | | | | |
| | Training: move/fire | | | | | |
| | Training: capture/supply | | | | | |
| | Training: command/traversal | | | | | |
| | Operations: spend/terminal | | | | | |
| | Normal FFA/team fight | | | | | |
| | LATTICE/Operations | | | | | |
| | Capture loss | | | | | |
| | Death/respawn | | | | | |
| | Intermission | | | | | |
| | Results and next action | | | | | |
| | Demo/spectator follow | | | | | |

## T. Timing anchors and scenario metrics (per participant)

### T1. Anchor definitions — name the clock (simulation tick or video time) for every value

| Measure | Start (t0) | Stop (t1) | Record alongside | Do not count |
|---|---|---|---|---|
| First contact | First frame of local control after deploy or respawn | First damage event involving the local player (dealt or received), or the first local shot aimed at a hostile, whichever comes first | Spawn, chosen route, first hostile sighting | Menus, pause or spectator time |
| Dead-to-meaningful-action | The local elimination event tick | First local authoritative action after that death: a hit registered, capture participation, accepted order, spend, device use or kill | Respawn-control tick, loadout time, whether t1 was taught | Countdown or menu browsing — record those separately as dead-to-control and control-to-action times |
| Stall | Last task-progress input, or the moment an instruction became actionable with no input; flag any gap of 30 s or more | First input that advances the task, a facilitator intervention (mark F), or task abandon | Last visible prompt, preceding action, whether the participant asked for help | Breaks and deliberate reading under 30 s that still advances the task |
| Duel TTK | First hostile damage event (or first shot fired) between the local player and one identified opponent in one engagement | The first of: death/incapacitation of either duelist, or disengagement (no damage and no line of sight between the pair for 3 s) | Weapons, range band at t0, HP/armor, third parties, who initiated | Unresolvable melees; third-party damage ends the duel and is noted |

If a measure cannot be isolated, say so; do not estimate from memory after the
session.

### T2. Scenario metrics

Report distributions by map, difficulty, gear/progression, input and player
experience; never collapse these into one average. Every value carries its
evidence tag.

| Player / scenario | First contact | Dead→action | First-3s repeat deaths | Duel TTK + weapon/range | Objective participation | Wave time | Spend | Comeback attempt | Tag |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## Q. Comprehension and result questions (per participant)

Ask without pointing at the HUD. Record answers verbatim (QUOTE) and do not
correct them:

1. How does this match end, and who is closest to winning?
2. What is one useful action you can take now?
3. What changed after your spend/order?
4. Why did the match end?
5. What did you personally contribute?
6. What would you choose next, if anything?

Then score the published binary targets (goal/HUD/spend/result comprehension,
task integrity, stalls, control continuity and clipping) in D, citing the raw
rows they come from.

## R. Participant ratings (per participant)

Ask each independently on a 1–5 scale and capture the explanation (QUOTE):

| Player | I knew what to do | My actions mattered | Controls behaved as expected | I want another match | Comments |
|---|---:|---:|---:|---:|---|
| | | | | | |

## V. Technical viewport/device gate (per build)

Record screenshots and observations at 1366×768, 1920×1080, 844×390 and
390×844, then repeat the most constrained state at UI scale 1.4. Include normal
combat, armed command, interaction prompt, HQ siege/wave status, spend window,
death summary and touch controls. Note overlap with the reticle or sticks and
whether command/spend controls require combat-view scrolling. Tag what was seen
as OBS and any inference as FAC; name each capture in A.

| Viewport / state | Artifact ID | Observation | Evidence tag | Clipping/overlap found |
|---|---|---|---|---|
| | | | | |

## F. Facilitator intervention and deviation log (per session)

Default is no intervention. Log every prompt, hint, recovery, technical action or
protocol change, including exact words. A silent observation needs no row.

| # | Time (clock) | Participant | Step/cell | Type (prompt/hint/recovery/technical/safety) | Exact words or action | Trigger | Protocol deviation? (Y/N) | Data effect (note/exclude/re-run) |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

End-of-session counts: interventions = __; protocol deviations = __.

## X. Voluntary rematch invitation (per participant, standardized)

Ask only after Q and R are complete and the participant has been told the session
is over, and only once. Read verbatim:

> "That is the end of the session. Playing another match is completely optional;
> stopping now has no penalty. Would you like to play one more match, or stop
> here?"

| Field | Value |
|---|---|
| Offer time | |
| Waiting period with no prompting (minimum 60 s) | __ s |
| Decision (stop / another match) | |
| Decision time / latency | |
| Stated reason (verbatim QUOTE) | |
| Second match actually started? (start time, same rules?) | |
| If no second match, was stopping confirmed as fine? | |

A second match is not "voluntary" without a stated reason. Do not offer twice,
and do not use session length alone as evidence of fun.

## A. Artifact manifest (per session)

Build identity is mandatory: an unlabeled artifact is not evidence.

| Artifact | Present | Locator / filename (code only) | Checksum / version | Consent | Delete by | Missing-data note |
|---|---|---|---|---|---|---|
| Release/codename, commit SHA, web/server build ID, protocol | | | | n/a | | |
| Session notes | | | | | | |
| Screenshots (list IDs) | | | | | | |
| Video / audio | | | | | | |
| Screen capture / replay | | | | | | |
| Event log (opt-in local study recorder, WP3.2) | | | sha256: | | | |
| Event-log schema version | | | | | | |
| Redactions applied | | | | | | |

Missing data: list every cell or task with no usable data and why (withdrew,
crash, recording refused, clock lost). A missing event log does not invalidate
tagged human observation, but it must be stated; missing video is not missing
observation if OBS rows carry a clock.

## D. Findings synthesis (after the cohort; never merge evidence types)

One row per falsifiable finding. Severity: **blocker** (prevents a required task
or causes harm), **major** (repeated failure/frustration or an incorrect
outcome), **minor** (local or cosmetic). Confidence basis: high = reproduced by
two or more participants, or one participant plus a deterministic replay;
medium = one participant plus consistent telemetry; low = a single observation
without reproduction. Exposed/affected always gives the cell denominator
(`x/n`), never a pooled total. Reproduction evidence names the artifact and
locator (A#, video timestamp, event-log offset, screenshot ID).

| ID | Finding (one claim) | Evidence tag | Severity | Confidence (basis) | Exposed/affected | Reproduction evidence | Owner | Disposition (fix now / watch / reject) |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

### Decision log

- Observed failure selected for iteration:
- Evidence linking the failure to reaction / aim / route / roster density /
  reward loop / feedback:
- One factor proposed for change:
- Counterplay or weapon/class niche that must remain:
- Focused mechanical regression checks:
- Baseline and post-change complete seed runs:
- Voluntary second-match starts and stated reasons (from X):
- Findings explicitly **not** supported by this sample:

No balance change should be approved from an unfilled worksheet, missing consent
or an automated-only technical gate. Human evidence selects one factor at a time;
automated checks remain regression evidence, not fun evidence.
