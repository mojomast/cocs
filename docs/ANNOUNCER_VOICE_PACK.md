# OmniVoice Studio announcer pack

This PR supplies real generated speech assets, not a live TTS dependency. It does
not replace or change `SynthAudio.announcerCue()` playback yet. The existing
procedural motifs remain unchanged. This makes auditioning and merging the pack
independent of audio-engine integration.

## Coverage

Each existing `ANNOUNCE_CUES` key in `game/feedback.mjs` has three takes of the
same phrase, generated independently with seeds **42, 137, 526**:

| Cue | Phrase |
| --- | --- |
| capture | Flag captured! |
| flag-pickup | Flag taken! |
| flag-return | Flag returned! |
| goal | Goal! |
| killstreak | Kill streak! |
| spree | Killing spree! |
| multikill | Multi kill! |
| victory | Victory! |
| defeat | Defeat. |
| score | Score! |
| boss | Boss incoming! |
| objective | Objective updated. |

Generic streak/score cues deliberately match the current audio API, which receives
only a cue kind, not a double/triple-kill count or scoring team. Campaign dialogue,
individual HUD milestone labels and arbitrary mission announcement text are not
covered by this pack.

## Audition

Serve `public` as a static directory and open `/audio/announcer/index.html`, or
open that route on the running game. Each take has an independent audio control;
starting another pauses the previous take. No autoplay or external service is
required. The WAVs can also be auditioned directly.

## Recipe and provenance

Generated with OmniVoice Studio through its private experiment-bench API.
Instruction: `male, middle-aged, low pitch, american accent`; language `en`;
16 sampling steps, speed 1, guidance 2, raw effect preset. No reference recording,
voice cloning, impersonation target or private input was used. Different seeds
can change vocal identity as well as delivery; these are not a locked speaker
profile. Audition for consistency before shipping.

`public/audio/announcer/manifest.json` contains per-file text, cue, seed, recipe,
Studio take ID, SHA-256, sample rate, duration, peak and RMS. The WAV files are
unmodified Studio output. No endpoint addresses, passwords or tokens are stored
in the pack. Generator provenance is not a legal determination about the model
or its output; review applicable OmniVoice model terms before release.

Regenerate with Python 3 (standard library only):

```sh
OMNIVOICE_BENCH_URL=https://YOUR-PRIVATE-BENCH python3 scripts/generate-announcer.py
node --test game/announcer-clips.test.mjs
```

The generator serializes requests, waits for real completion and resumes existing
manifest entries. It never alters/deletes other Studio takes. Authentication is
obtained from the private bench page in memory, not passed on the command line.
Do not expose the bench publicly. Delete a specific output AND its manifest entry
to regenerate it. Exact output reproducibility across model/hardware versions is
not guaranteed by a seed.

## Integration helper

`createAnnouncerSelector(clips, random)` in `game/announcer-clips.mjs` returns a
per-instance selector. Calling it with a cue returns clip metadata and a same-origin
asset URL; unknown cues return null. It excludes the previous file for that cue,
so repeats rotate among distinct seeded takes without immediately repeating.
Inject an RNG when deterministic selection is needed.

A future playback integration should retain announcer/mute preferences, effects
volume, event deduplication, lifecycle cleanup and a bounded speech queue. It
should avoid late playback after a match transition and fall back to existing
motifs if fetching/decoding fails. This PR does not imply those behaviors were
implemented or tested.

## Validation scope

Asset tests require all 36 files, three distinct SHA-256 values per cue, valid WAV
headers, matching manifest hashes, non-silent measured audio and plausible short
clip durations. Selector tests cover no immediate repetition, per-cue state,
unknown cues, single-take fallback and unsafe filenames. These checks do not
prove pronunciation, perceived voice quality, or exact spoken transcription;
human listening review remains necessary.
