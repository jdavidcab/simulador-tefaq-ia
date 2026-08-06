# Runner Lockstep (Modo Examen) — Design Spec

Slice 2 of the original Modo Examen decomposition (5 slices total). Slice 1
(sets generables) is complete and merged to `main` — this slice adds the
frontend screen that actually *takes* an already-generated set.

## Purpose

Slice 1 can generate and persist full `SET_STANDARD_36` exam sets to disk,
but nothing in the frontend can play one back. This slice adds a lockstep
exam-taking screen: pick a ready set, listen through its 32 audio items in
order, answer 36 questions under strict per-item timing, see a raw score.

## Scope

**In scope:**
- A new "Modo Examen" mode alongside the existing training mode.
- Picking a `statut: 'complet'` set from `GET /api/sets`.
- Preloading all 32 audio files before the timed run starts.
- A per-item lockstep state machine (`avant` → `audio` → `apres`) driven by
  drift-corrected timers, autoplay-only audio (no pause/repeat/speed
  control), no back-navigation, auto-advance on timeout.
- Short transition screens between the 7 sections.
- An explicit "Abandonar" exit with confirmation, and a `beforeunload`
  warning while an attempt is in progress.
- A raw end-of-exam summary (correct/total, correct per section).
- `examTiming.js` as pure, unit-tested deadline/tick logic.

**Explicitly out of scope (deferred to later slices):**
- **Resume after browser close/reload/crash.** This slice covers only a
  single continuous sitting. No attempt state is persisted anywhere — not
  to `localStorage`, not to the backend. Closing the tab loses the attempt,
  same as abandoning it.
- **Scoring/analytics** (estimated /699, per-question review, progress
  curves, history log — slice 3 "Resultados y bitácora"). The end screen
  shows only a raw correct/total count, nothing else.
- **Triggering set generation from the frontend.** Generating a new set is
  still a backend-only operation (`curl`/Postman), same as today. This
  slice only *consumes* sets that already have `statut: 'complet'`.
- `conversation_image` — not generable yet (slice 4), and not part of
  `SET_STANDARD_36`, so the runner never encounters it.

**No backend changes.** Every endpoint this slice needs already exists:
`GET /api/sets`, `GET /api/sets/:id`, `GET /api/sets/:id/audio/:archivo.wav`.
This is a consequence of the scope decisions above, not a constraint that
shaped them — dropping resume and scoring persistence means there is
nothing new to write to disk.

## Architecture

`frontend/src/App.jsx` today is a single monolithic component running the
training-mode state machine. This slice splits it into a thin mode shell
plus two independent modes:

- **`App.jsx`** — becomes a shell: a mode switcher ("Entrenamiento" / "Modo
  Examen") at the top, rendering `<TrainingMode/>` or `<ExamMode/>`. No
  behavioral change to training mode itself.
- **`TrainingMode.jsx`** — today's `App.jsx` body, moved verbatim (renamed
  component, same state, same JSX). This is a pure extraction — no changes
  to training-mode behavior.
- **`exam/SetPicker.jsx`** — lists sets from `GET /api/sets`, filters to
  `statut === 'complet'`, lets the user pick one and enter the runner.
- **`exam/ExamRunner.jsx`** — the lockstep engine. Given a `setId`: fetches
  `GET /api/sets/:id`, preloads all 32 audio blobs, then drives the
  section-by-section, item-by-item state machine in the order `set.sections[]`
  already provides (which already reflects real bloc order 2→3→4, since
  `SET_COMPOSITIONS.SET_STANDARD_36` is `GENERABLE_SECTIONS` in that order).
- **`exam/examTiming.js`** — pure module, no DOM. Computes and ticks
  deadlines (see Timing Model below). Unit-tested with `node --test`.
- **`exam/ExamSummary.jsx`** — final screen: correct/total, correct per
  section.

`ExamMode` composes `SetPicker` → `ExamRunner` → `ExamSummary` (or back to
`SetPicker` on abandon).

## Timing Model

Training mode's `App.jsx` ticks `timeLeft` down by 1 every `setInterval`
firing — each firing can itself be late (tab throttling, main-thread work),
and those delays accumulate over a session. Acceptable for one question;
not acceptable over a 40+ minute exam where drift compounds across 32 items.

`examTiming.js` instead anchors each phase to an absolute deadline:

```js
// startPhase: called once when a phase begins
function startPhase(durationSeconds, now = performance.now()) {
  return { deadline: now + durationSeconds * 1000 };
}

// tick: called on every timer firing, never accumulates
function remainingSeconds(phaseState, now = performance.now()) {
  return Math.max(0, Math.ceil((phaseState.deadline - now) / 1000));
}
```

Every tick re-derives remaining time from `performance.now()`, never from
the previous tick's value — a late or skipped tick self-corrects on the
next one instead of compounding. `ExamRunner` calls `remainingSeconds`
every ~250ms (for smooth display) and transitions phase when it hits 0.

Audio duration is already known exactly ahead of time (`item.duree_audio_s`,
persisted by the pipeline in slice 1) and the blob is fully preloaded before
the run starts, so the `audio` phase does not need the estimate-vs-real
reconciliation training mode does (`AUDIO_END_BUFFER_SECONDS`,
`getAudioRemainingTime`) — that hack exists there because training mode
starts playback before it knows the real duration. Here it's known upfront.

## State Machine

**Per item** (one audio + 1 or 2 questions, depending on `questionsPerAudio`):

```
avant (timing.avant sec) → audio (autoplay) → apres (timing.apres sec) → next item
```

- **`avant`**: question(s) and options render immediately, no audio yet —
  reading time before the listen, matching the real format's `avant`.
- **`audio`**: the already-preloaded blob autoplays with no controls (no
  pause/repeat/speed — unlike training mode). `onended` transitions to
  `apres`. Fallback: a `setTimeout(item.duree_audio_s)` also transitions to
  `apres`, in case `onended` never fires (corrupt/zero-length audio).
- **`apres`**: countdown from `timing.apres`. Answer selection is allowed
  throughout `avant`/`audio`/`apres` (matching training mode's existing
  behavior, which already allows selecting during `scanning`/`reading`, not
  just `answering`) — there is no "continue" button; advance is timer-driven
  only, faithful to the real exam. Unanswered questions at timeout count as
  incorrect.
- **Interview/reportage** (`questionsPerAudio: 2`): both questions render
  together during `apres`, each with a `<select>` for its options (instead
  of the button-per-option style training mode and the rest of the exam
  sections use) so both fit on screen at once. Option text wraps inside the
  select rather than truncating.

**Between sections**: after the last item of a section, a short transition
screen — "Sección siguiente: {nombre} — {N} preguntas" — with a "Continuar"
button, before the next section's first item starts its `avant`.

**End of set**: `ExamSummary.jsx` — correct/total and correct-per-section,
computed client-side from the in-memory answers object and the sets'
`correctId`s. No persistence.

**Answers**: held in one `ExamRunner` state object,
`{ [sectionType]: { [ref]: { [questionIndex]: optionId } } }`. Never sent to
the backend, per the "no resume, no persistence" scope decision.

**Abandon**: an always-visible "Abandonar" button asks for confirmation,
then discards the in-memory attempt and returns to `SetPicker` — nothing
was persisted, so there's nothing to clean up. A `beforeunload` listener is
attached whenever the phase is not `idle`/`summary`, warning against
accidental tab close/reload (defense against accidental loss, not resume).

## Error Handling

- **`GET /api/sets` or `GET /api/sets/:id` fails**: error message + retry
  button in `SetPicker`.
- **Audio preload failure** (one or more of the 32 files): failed items are
  marked in the preload progress UI; once the initial pass finishes, if any
  failed, offer "Reintentar fallidos" (retries only those) or "Volver a la
  lista". The timed run never starts with missing audio.
- **`onended` doesn't fire**: covered by the `duree_audio_s` timeout
  fallback described in the State Machine section above.

## Testing

No frontend test runner exists in this repo (confirmed in `CLAUDE.md`) —
`ExamRunner`/`SetPicker`/`ExamSummary` are verified manually in the browser,
same as all existing frontend code. `examTiming.js`, being pure logic with
no DOM dependency, gets `node --test` coverage (run from `backend/` or
wherever the repo's Node test setup already targets — exact location is a
plan-time detail) for: deadline computation, tick monotonicity, zero-clamp
at expiry, and that a late tick doesn't compound error on the next one.

## Open Decisions Log

Recorded here since they came from real trade-off discussions, not defaults:

1. Resume-after-reload is deferred, not implemented. Scope was explicitly
   narrowed to a single continuous sitting.
2. Sets are picked from an existing list, never generated from this screen.
3. Audio is autoplay-only in exam mode, no user controls — unlike training
   mode, which keeps play/repeat/speed controls.
4. Interview/reportage show both questions of an item at once, each with a
   `<select>` for options (long option text wraps, not truncates); all
   other sections keep training mode's button-per-option style.
5. End-of-exam screen shows a raw correct/total + per-section count only;
   full scoring is slice 3.
6. Abandon is allowed, with confirmation, at any point.
7. Section-transition screens are shown between sections, gated on a
   "Continuar" click.
8. `examTiming.js` gets automated tests; the rest of the frontend does not,
   consistent with the rest of the repo.
