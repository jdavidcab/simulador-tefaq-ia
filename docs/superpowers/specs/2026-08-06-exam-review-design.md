# Revisión Post-Examen — Design Spec

Second increment of Fase C ("Resultados y bitácora") — the original spec's
Phase C, not the 5-slice roadmap's later "slice 4/5" (those are unrelated:
multimedia enrichment and training variants). The first increment was the
`/699` score estimate, already merged. This increment adds a detailed,
untimed, in-memory review screen: re-listen to any item's audio, see the
transcript with its justification highlighted, see the existing feedback —
everything the exam itself deliberately withholds (no replay, no going
back) becomes available once the attempt is over.

**Explicitly deferred to later increments of Fase C** (not part of this
spec): per-question analytics (time-to-first-selection, answer changes),
failure-cause tagging, persisted session history, export, and the
progress-over-time graph.

## Purpose

`ExamSummary.jsx` (slice 2 + the `/699` increment) shows a score and stops
there — there's no way to see which specific questions were missed, hear
the audio again, or understand why an answer was wrong beyond the raw
feedback text already computed during generation. This increment adds that
review, reachable from the summary screen, using only data that already
exists in `ExamMode`'s state (`results`, `setDetail`) plus the audio blobs
that are currently thrown away the moment the exam completes.

## Scope

**In scope:**
- A "Ver revisión detallada" button on `ExamSummary`, leading to a new
  `ExamReview.jsx` screen.
- A single scrollable list of the set's 32 audio items (not 36 flat
  questions — `interview`/`reportage` items keep their 2 questions grouped
  under one shared audio player, mirroring how the exam itself presents
  them), collapsed by default to a "Sección · X/Y correctas" header, each
  expandable to: a "Reproducir" button (untimed, replayable, no lockstep
  restriction), the transcript with each question's `justification`
  highlighted inline, the options with the correct one and the user's
  choice both marked, and the existing generated feedback.
- Free navigation: no timer, no auto-advance, expand/collapse anything in
  any order.
- Resolving the audio-retention conflict: audio blob URLs stay alive while
  the user is on `summary` or `review`, and are released only on the
  exam's actual exit points (leaving to the picker, abandoning, or
  unmount) — not the instant the exam completes.

**Out of scope (later Fase C increments):** per-question timing/change
analytics, failure-cause tagging, persisted session history, export, the
progress graph.

**Untouched:** `ExamRunner.jsx`, `examMachine.js`, `examTiming.js`,
`audioPreload.js`, `setCompatibility.js` — everything already reviewed and
tested in slice 2 stays exactly as it is. Only `ExamMode.jsx` (drop the
premature audio release, add a `review` phase) and `ExamSummary.jsx` (one
new button) are modified; everything else is new files.

## Audio Retention Change

Today, `ExamMode.handleComplete` calls `resetAudio()` (which revokes every
blob URL) the instant the exam finishes, before the summary even renders.
This increment removes that call:

```js
const handleComplete = useCallback((finalResults) => {
  setResults(finalResults);
  setPhase('summary');
}, []);
```

Audio now stays alive through `summary` and the new `review` phase.
Release still happens exactly once, at the same single place it already
does — `goToPicker` (unchanged, already called from every real exit:
`ExamSummary`'s existing exit button, `ExamRunner`'s `onAbandon`, and the
new `ExamReview` exit button below) — plus the existing unmount safety-net
effect, which already exists and needs no change. No new leak surface is
introduced: the only thing that changes is *when* the existing, correct
cleanup path fires, not whether it fires.

`review` is deliberately **not** added to `ACTIVE_PHASES` or
`GUARDED_PHASES` — consistent with `summary` already being excluded from
both (the attempt is already over; there's nothing in-progress to lose by
switching modes or closing the tab while reviewing, and nothing in this
increment persists anyway).

## `ExamMode` Flow Change

New phase added to the state machine: `summary ⇄ review`, plus `review`'s
own exit to `picker`:

```
... → running → summary → (review ⇄ summary) → picker (via goToPicker)
```

- `handleShowReview = () => setPhase('review')`
- `handleBackToSummary = () => setPhase('summary')`
- `ExamReview`'s "Volver a la lista" button calls the same `goToPicker` every other exit point already uses.

## `ExamReview.jsx`

Props: `{ set, answers, audioElRef, audioUrls, onBackToSummary, onExit }` —
exactly the pieces `ExamMode` already holds (`setDetail` as `set`,
`results.answers` as `answers`, the same `audioElRef`/`audioUrlsRef.current`
pair `ExamRunner` already consumes). No new data fetching, no new state
shape.

For each section → item: look up `answers[section.type]?.[item.ref]`
(shaped `{ [questionIndex]: optionId }`, from `examMachine.js`'s
`computeResults` — unchanged), compare each `questionIndex` against
`item.questions[questionIndex].correctId` to compute the collapsed header's
"X/Y correctas" and each option's correct/chosen marking.

Playback reuses the same shared `<audio>` element `ExamRunner` used during
the run (passed down via the same `audioElRef` prop) — by this point in
the session, real playback has already happened at least once, so there is
no autoplay-unlock concern to solve here (unlike `ExamMode.handleUnlock`).
"Reproducir" sets `audioElRef.current.src`, resets `currentTime = 0`, and
calls `.play()` — clicking it again (or on a different item) naturally
restarts/interrupts via normal `<audio>` element semantics, no extra
bookkeeping needed. A `playingRef`/small local state tracks which item is
currently playing, purely for disabling that item's own button while it
plays (cosmetic, not behavioral).

## Justification Highlighting

A new pure module, `frontend/src/exam/justificationHighlight.js`, handles
locating a `justification` string inside its `transcript` — this is
genuine logic worth testing in isolation, following the project's existing
pattern (`examTiming.js`, `examMachine.js`, `setCompatibility.js`,
`examScoring.js`).

The backend's own anti-hallucination check
(`validation/justification.js`, documented in `CLAUDE.md`) already scores
justifications by word-overlap, not exact match — a justification is not
guaranteed to appear as a literal substring of the transcript, especially
when the model paraphrased. This module must handle that gracefully:

```js
// Ubica una justification dentro de su transcript como subcadena
// case-insensitive. No garantiza encontrarla -- el backend puntúa
// justifications por solapamiento de palabras, no por match literal, así
// que una justification parafraseada legítimamente puede no aparecer
// tal cual en el texto.
export function findJustificationSpan(transcript, justification) {
  // -> { found: true, start, end } | { found: false }
}
```

`ExamReview` calls this once per question in an expanded item and renders
accordingly: when `found`, the transcript is split at `start`/`end` and the
matched span gets a distinct highlight per `questionIndex` (so a
2-question `interview` item can show both questions' justifications
highlighted differently within the same transcript render, without the two
spans needing to overlap — they never do in real data, since each
question's justification quotes a different part of the dialogue); when
not `found`, that question's justification is instead shown as a separate
quoted line beneath the transcript, undecorated, rather than silently
dropped or forced into an incorrect highlight.

## Testing

`justificationHighlight.test.js` (new), `node --test`, covering: an exact
substring match, a case-insensitive match (different casing between
transcript and justification), a justification that genuinely isn't a
substring (paraphrased case → `found: false`, not a crash), and a
multi-question item where two different justifications each locate
correctly within the same transcript without interfering with each other.

`ExamReview.jsx` and the `ExamMode.jsx`/`ExamSummary.jsx` changes remain
browser-verified only, consistent with every other UI component in this
project (no test runner exists for React components here).

## Open Decisions Log

1. Review is reached via a button from `ExamSummary`, not shown
   automatically and not a replacement for it — the user's explicit choice,
   keeping the already-shipped summary screen unchanged.
2. Untimed, free Next/Previous-style navigation was the user's second
   choice after an initial mix-up with the *exam's* timed, forward-only
   behavior — worth recording since it was a genuine, deliberate
   correction, not a first-pass assumption. The whole point of a review
   screen is contradicted by timing it the same way as the exam it's
   reviewing.
3. Grouped by audio item (32), not flat by question (36) — avoids
   duplicating the same audio player and transcript across two list
   entries for `interview`/`reportage`.
4. Audio release moves from "on completion" to "on the exam's actual exit
   points" — the same cleanup path (`goToPicker`, plus the existing
   unmount effect) already used by everything else, just triggered later.
5. Justifications that aren't found as an exact substring are shown
   separately rather than force-highlighted or dropped — matches the
   backend's own acknowledgment that justifications aren't always literal
   quotes.
