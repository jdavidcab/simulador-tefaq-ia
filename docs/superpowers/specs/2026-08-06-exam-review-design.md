# Revisión Post-Examen — Design Spec

Second increment of Fase C ("Resultados y bitácora") — the original spec's
Phase C, not the 5-slice roadmap's later "slice 4/5" (those are unrelated:
multimedia enrichment and training variants). The first increment was the
`/699` score estimate, already merged. This increment adds a detailed,
untimed, in-memory review screen: re-listen to any item's audio, see the
transcript with its justification highlighted, see the existing feedback —
everything the exam itself deliberately withholds (no replay, no going
back) becomes available once the attempt is over.

> Revised after a critical review round (see Open Decisions Log items 6-14).
> The review caught two real playback bugs (a Reproducir/Reiniciar
> contradiction, and audio that kept playing after leaving the review
> screen), a false assumption about justifications never overlapping
> (verified false against the actual backend), a genuine self-contradiction
> in this document, and several under-specified pieces (answer-state
> markers, header hierarchy, highlight-matching robustness). All are
> addressed below.

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
- A two-level accordion: each section shows its own correct/total, and
  within it each of the set's 32 audio items shows its own correct/total
  (`interview`/`reportage` items keep their 2 questions grouped under one
  shared audio player and one item-level count, mirroring how the exam
  itself presents them — see Review Model below). Expanding an item shows:
  a playback control (untimed, replayable, no lockstep restriction), the
  transcript with each question's `justification` highlighted inline
  (or, when a justification can't be located verbatim, shown separately
  and clearly labeled as such — see Justification Highlighting), the
  options with every answer-state explicitly marked (see Answer States),
  and the existing generated feedback.
- Free navigation: no timer, no auto-advance, expand/collapse anything in
  any order.
- Resolving the audio-retention conflict: audio blob URLs stay alive while
  the user is on `summary` or `review`, and are released only on the
  exam's actual exit points (leaving to the picker, abandoning, or
  unmount) — not the instant the exam completes. Playback itself is
  explicitly stopped on every path that leaves `review` (see Playback
  State).
- Updating `README.md` and `CLAUDE.md` to document the new `summary ⇄
  review` flow, the extended audio-retention window, and the new pure
  modules — the same documentation step the runner-lockstep increment
  included and this one had originally omitted.

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

Audio now stays alive through `summary` and the new `review` phase. To be
precise about the cost, not just the mechanism: this genuinely extends how
long a full set's audio (~50-60MB of uncompressed WAV, per the
runner-lockstep spec's own estimate) stays resident — for as long as the
user lingers on `summary` or `review`, not just for the run itself. That
extension is intentional and the point of this increment, but it is a real
cost, not a non-event. What does *not* change: release still happens
exactly once, at the same single place it already does — `goToPicker`
(already called from every real exit: `ExamSummary`'s existing exit
button, `ExamRunner`'s `onAbandon`, and the new `ExamReview` exit button)
— plus the existing unmount safety-net effect. No code path is added where
a blob URL could end up neither revoked nor reachable; the retention
window is just longer, and every exit path must actually be exercised
(not just reasoned about) before this ships — see Testing.

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
shape beyond what's described below.

Per-item/per-section correctness is computed by a new pure module (see
Review Model), not inline in the component — the same separation
`examMachine.js`'s `computeResults` already established for `ExamRunner`.

### Playback State

The shared `<audio>` element is owned by `ExamMode`, not `ExamReview` —
playback must be handled with the same rigor `ExamRunner.jsx` already
applies to that element, not as an afterthought. `ExamReview` holds one
piece of local state:

```js
const [playback, setPlayback] = useState({ activeRef: null, status: 'idle', error: null });
// status: 'idle' | 'playing' | 'error'
```

- Clicking an item's playback button: sets `audioElRef.current.src` to
  `audioUrls.get(item.ref)` (if missing, go straight to `status: 'error'`
  without touching the element — a missing URL here means preload/compat
  guarantees were violated, and the UI should say so rather than let the
  browser produce a confusing native error), resets `currentTime = 0`,
  calls `.play()`. On the returned promise rejecting, set `status: 'error'`
  for that `activeRef`. The button is **never disabled** — its label
  reflects `playback.status` for the currently-`activeRef`'d item
  ("Reproducir" when idle/error/not-active, "Reiniciar" while that same
  item is `'playing'`) — clicking it always attempts to (re)start from 0,
  resolving the original contradiction between "clicking again restarts
  it" and "the button is disabled while playing".
- The element's real `playing`, `ended`, and `error` events (attached once,
  for the component's lifetime, matching `ExamRunner`'s own mount-once /
  cleanup-on-unmount pattern for the same element) drive `status`
  transitions: `playing` → `'playing'`; `ended` → `'idle'` (so the label
  reverts to "Reproducir" once playback genuinely finishes, not left
  claiming "Reiniciar" forever); `error` → `'error'`.
- Switching to a different item mid-playback is normal `<audio>` element
  behavior (reassigning `.src` and calling `.play()` again interrupts
  whatever was playing) — `activeRef` updates to the new item so the
  *previous* item's button correctly reverts to "Reproducir" instead of
  being left in a stale "playing" state.
- `stopPlayback()` — pauses, clears `.src`, `.load()` — **never revokes
  any object URL** (that stays `goToPicker`'s job exclusively). Called
  explicitly before `onBackToSummary()`/`onExit()` fire, and also wired
  into `ExamReview`'s own unmount cleanup effect as defense in depth, so
  any path that dismisses `ExamReview` (including the whole `ExamMode`
  unmounting, e.g. switching to Entrenamiento mid-review) stops playback
  first, rather than relying solely on the implicit "removed `<audio>`
  elements stop playing" browser behavior.
- Collapsing an expanded item does **not** stop its playback — a
  deliberate choice, not an oversight: the collapsed row still shows the
  "reproduciendo" state, so nothing is playing invisibly, just out of the
  expanded detail view.
- Event listeners are removed in the same effect's cleanup that attaches
  them — no listener survives past `ExamReview` unmounting.

## Review Model

A new pure module, `frontend/src/exam/reviewModel.js`:

```js
// Por cada ítem de audio, calcula el estado de cada una de sus preguntas
// y el conteo correcto/total a nivel ítem y a nivel sección. No toca DOM,
// no depende de React -- mismo principio que computeResults en
// examMachine.js, separado de cómo ExamReview lo renderiza.
export function buildReviewModel(set, answers) {
  // -> {
  //   sections: [{
  //     type, correctCount, questionCount,
  //     items: [{
  //       ref, correctCount, questionCount,
  //       questions: [{
  //         questionIndex, selectedId, correctId,
  //         answered: boolean, isCorrect: boolean,
  //       }],
  //     }],
  //   }],
  // }
}
```

`answered` is `false` when `answers[section.type]?.[item.ref]?.[questionIndex]`
is `undefined` (the exam timed out before the candidate picked anything) —
distinct from `isCorrect: false`, since the UI must show "Sin respuesta"
rather than implying a wrong answer was chosen.

`ExamReview` renders the two-level accordion directly from this: section
header — "{label} — {correctCount}/{questionCount} correctas"; item
header, nested — "Audio {n}/{sectionItemCount} — {correctCount}/{questionCount}
correctas". Unambiguous at both levels, unlike the single flat "X/Y" the
original draft of this spec had.

## Answer States

For each question's options, every option renders in exactly one of these
states, each with its own text label (never color alone):

| State | Condition | Label |
|---|---|---|
| Correct, chosen | `option.id === correctId && option.id === selectedId` | "Tu respuesta — correcta" |
| Correct, not chosen | `option.id === correctId && option.id !== selectedId` | "Respuesta correcta" |
| Incorrect, chosen | `option.id === selectedId && option.id !== correctId` | "Tu respuesta — incorrecta" |
| Neither | everything else | (no label) |

When `answered === false` for a question, no option is marked as "tu
respuesta" at all — instead the question shows an explicit "Sin respuesta"
notice above its options, and only the correct option gets its "Respuesta
correcta" label.

## Justification Highlighting

A new pure module, `frontend/src/exam/highlightSegments.js`. Two real gaps
in the original draft, both confirmed against the actual backend code
rather than assumed:

**Justifications for the two questions of one item are not guaranteed not
to overlap.** `prompt/sections/interview.js` instructs the model that its
two questions must "cubrir aspectos DISTINTOS" — but
`validation/justification.js`'s `checkJustification` only scores each
justification against the transcript independently; it never compares the
two justifications of the same item against each other. A prompt
instruction is not a validation guarantee (the same category of gap this
project has hit before). The module must handle overlapping, adjacent, or
identical spans by construction, not assume they can't happen.

**Simple case-insensitive substring matching will under-match.** The
backend's own matching (`validation/frenchWords.js`'s `normalizeText`,
used by `checkJustification`) strips diacritics, lowercases, and collapses
all punctuation/whitespace to single spaces before comparing — far more
aggressive than case-insensitivity. Generated French text uses apostrophes
constantly (`l'`, `qu'`, `c'est`, `d'un`), and a straight vs. typographic
apostrophe mismatch between the transcript and the justification is a
routine occurrence, not a rare edge case — a naive case-insensitive-only
match would produce frequent, avoidable "not found" fallbacks and largely
defeat the feature. This module normalizes the same way the backend does,
but must keep a position map back to the *original* transcript string,
since normalization changes string length (stripped/collapsed characters)
— matching on normalized text and then slicing the original string at the
same indices would be wrong.

```js
// Ubica cada justification dentro de su transcript, normalizando igual que
// el backend (validation/frenchWords.js: diacríticos fuera, minúsculas,
// puntuación/espacios colapsados) pero devolviendo offsets sobre el
// transcript ORIGINAL -- la normalización cambia el largo del string, así
// que machear en el texto normalizado y cortar el original en los mismos
// índices sería incorrecto. Solo el primer match de cada justification
// cuenta (si la misma frase aparece más de una vez, se resalta la
// primera aparición, no todas). Construye los segmentos del transcript
// COMPLETO de una sola vez -- no un span aislado por llamada -- para que
// dos justifications que se solapan, son adyacentes, o apuntan al mismo
// fragmento queden resueltas por construcción: cada segmento lleva la
// lista de qué preguntas lo justifican, no una sola.
export function buildHighlightSegments(transcript, questionJustifications) {
  // questionJustifications: [{ questionIndex, justification }]
  // -> [{ text, questionIndexes: number[] }]  // covers the whole transcript;
  //    questionIndexes is [] for unhighlighted text, and can have length > 1
  //    where two justifications' spans overlap
}
```

`ExamReview` renders the transcript once per item as the concatenation of
these segments, styling each by whether/how many `questionIndexes` it
carries. A justification whose normalized form isn't found anywhere in the
normalized transcript is not force-highlighted or silently dropped —
`ExamReview` shows it separately, explicitly labeled ("Evidencia generada
— no localizada literalmente en el transcript"), not styled as a
blockquote/citation, since presenting an unlocated paraphrase as if it
were a verbatim quote would be misleading.

## Testing

`reviewModel.test.js` (new), `node --test`, covering: a correct answer, an
incorrect answer, and an unanswered question (`answered: false`, distinct
from `isCorrect: false`); a single-question item; a two-question item;
correct item-level and section-level counts.

`highlightSegments.test.js` (new), `node --test`, covering: an exact
substring match; a match that differs only by accent/apostrophe-style/
punctuation/whitespace (confirms normalized matching, not just
case-insensitive); a justification genuinely absent from the transcript
(paraphrased case, no crash, correctly excluded from the segment list); a
phrase appearing multiple times in the transcript (only the first
occurrence is highlighted); two justifications on the same item whose
spans overlap, are adjacent, or are identical (each resulting segment
carries the correct combined `questionIndexes`); and that concatenating
every returned segment's `text` reconstructs the original transcript
exactly (no characters gained or lost by the normalization/offset
mapping).

`ExamReview.jsx` and the `ExamMode.jsx`/`ExamSummary.jsx` changes remain
browser-verified only, consistent with every other UI component in this
project (no test runner exists for React components here). Manual
verification must specifically walk: play item A, switch to item B mid-
playback (A's button reverts to "Reproducir"), restart A after it ended
naturally, force a `play()` rejection and confirm the error state (not a
silent hang), leave `review` for `summary` while audio is playing (it
stops), return to `review`, exit to the picker, and switch to
Entrenamiento mid-review — each of these is a distinct exit path for
`stopPlayback()`/audio retention and needs to actually be exercised, not
just reasoned about.

## Open Decisions Log

1. Review is reached via a button from `ExamSummary`, not shown
   automatically and not a replacement for it — the user's explicit choice,
   keeping the already-shipped summary screen unchanged.
2. Untimed, free accordion navigation (expand/collapse anything, any
   order) — the user's explicit correction after an initial mix-up with
   the *exam's* timed, forward-only behavior. The whole point of a review
   screen is contradicted by timing it the same way as the exam it's
   reviewing.
3. Grouped by audio item (32), not flat by question (36) — avoids
   duplicating the same audio player and transcript across two list
   entries for `interview`/`reportage`.
4. Audio release moves from "on completion" to "on the exam's actual exit
   points" — the same cleanup path (`goToPicker`, plus the existing
   unmount effect) already used by everything else, just triggered later.
   The extension is stated plainly as a real, longer retention window
   (~50-60MB for the duration of summary+review), not glossed over.
5. Justifications that aren't found as an exact (normalized) match are
   shown separately, explicitly labeled as not verbatim, rather than
   force-highlighted, silently dropped, or presented as a blockquote —
   matches the backend's own acknowledgment that justifications aren't
   always literal quotes, without implying they're literal when they
   aren't.
6. The playback button is never disabled; instead its label changes
   between "Reproducir"/"Reiniciar" based on real playback state — found
   during review: the original draft both disabled the button while
   playing and claimed clicking it again would restart playback, which
   are mutually exclusive.
7. `stopPlayback()` is owned by `ExamReview` and fires on its own unmount
   cleanup (covering every path that dismisses it) rather than requiring
   `ExamMode` to orchestrate it — found during review: audio kept playing
   silently after "Volver al resumen" in the original draft, since nothing
   stopped the shared element that `ExamMode`, not `ExamReview`, owns.
8. Justification overlap between a 2-question item's two justifications is
   handled by construction (`buildHighlightSegments` returns segments
   tagged with all applicable `questionIndexes`) rather than assumed
   impossible — found during review: the prompt asks the model for
   distinct aspects per question, but `validation/justification.js` never
   validates that the two justifications don't overlap, so nothing
   actually guarantees it.
9. Justification matching normalizes the same way the backend already
   does (diacritics, punctuation, whitespace) rather than staying
   case-insensitive-only, with a position map back to the original
   transcript — found during review: French apostrophe-style mismatches
   between transcript and justification are common, not rare, so the
   conservative match would have under-highlighted routinely rather than
   only in genuine edge cases.
10. Header hierarchy is two-level (section total, then per-item total
    nested inside) rather than one ambiguous "X/Y correctas" — found
    during review: the flat version didn't specify whether X/Y was
    item-scoped or section-scoped.
11. `reviewModel.js` is extracted as its own pure, tested module (like
    `examMachine.js`'s `computeResults`) rather than computed inline in
    `ExamReview.jsx` — found during review as a real testing gap: the
    correctness/counting logic is exactly the kind of thing this
    project's architecture keeps separate from rendering and tests
    directly.
12. Answer-state markers are fully enumerated (correct-chosen,
    correct-not-chosen, incorrect-chosen, neither, unanswered) with text
    labels, not left as a vague "correct one and the user's choice are
    marked" relying on color alone.
13. This increment's scope includes updating `README.md`/`CLAUDE.md` —
    an omission in the original draft, inconsistent with the
    runner-lockstep increment's own precedent.
14. This document's own Open Decisions Log previously described
    "Next/Previous-style navigation" while the Scope section correctly
    described an accordion — a transcription error introduced while
    writing this document, not a real design ambiguity. Corrected; see
    item 2 above for what was actually decided.
