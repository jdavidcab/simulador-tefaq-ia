# Runner Lockstep (Modo Examen) — Design Spec

Slice 2 of the original Modo Examen decomposition (5 slices total). Slice 1
(sets generables) is complete and merged to `main` — this slice adds the
frontend screen that actually *takes* an already-generated set.

> Revised after a critical review round (see Open Decisions Log items 9-15).
> The review caught a real contract bug (pilote sets), a real autoplay
> hazard where a failed `play()` could silently be treated as a completed
> listen, and a real cross-phase drift gap. All three are addressed below.

## Purpose

Slice 1 can generate and persist full `SET_STANDARD_36` exam sets to disk,
but nothing in the frontend can play one back. This slice adds a lockstep
exam-taking screen: pick a ready set, listen through its audio items in
order, answer its questions under strict per-item timing, see a raw score.

## Scope

**In scope:**
- A new "Modo Examen" mode alongside the existing training mode.
- Picking a set from `GET /api/sets`, restricted to sets this runner can
  actually play (see Set Compatibility below).
- Preloading all audio files before the timed run starts, with an explicit
  playback-unlock step (see Autoplay below).
- A per-item lockstep state machine (`avant` → `audio` → `apres`) driven by
  drift-corrected timers, autoplay-only audio (no pause/repeat/speed
  control), no back-navigation, auto-advance on timeout.
- Short transition screens between the 7 sections.
- An explicit "Abandonar" exit with confirmation, guarded consistently
  everywhere an attempt can be interrupted (including the top-level mode
  switch), and a `beforeunload` warning while an attempt is in progress.
- A raw end-of-exam summary (correct/total, correct per section).
- `examTiming.js` (deadline/tick arithmetic) and `examMachine.js` (the
  transition logic itself) as pure, unit-tested modules.

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
  slice only *consumes* sets that already exist.
- **Sets generated with `pilotes: true`.** See Set Compatibility — the
  runner refuses these explicitly rather than mishandling them.
- `conversation_image` — not generable yet (slice 4), and not part of
  `SET_STANDARD_36`, so the runner never encounters it.

**No backend changes.** Every endpoint this slice needs already exists:
`GET /api/sets`, `GET /api/sets/:id`, `GET /api/sets/:id/audio/:archivo.wav`.
This is a consequence of the scope decisions above, not a constraint that
shaped them — dropping resume and scoring persistence means there is
nothing new to write to disk.

## Set Compatibility

`pipeline.createSet({ pilotes: true })` adds `CONFIG.piloteCount` (4) extra
single-question items, distributed across whichever `SINGLE_QUESTION_SECTIONS`
are in the composition (`planner.js`). A piloted `SET_STANDARD_36` set still
reports `format: 'SET_STANDARD_36'` and, once done, `statut: 'complet'` —
but carries 36 audio items / 40 questions, not 32/36. `GET /api/sets`'
summary objects include `total` (item count, from `contarItems`) but not the
`pilotes` flag itself, so list-level filtering can't fully distinguish them.

This runner is built against the 32-item/36-question contract throughout
(preload progress, section/item counts, summary layout) and does not
attempt to generalize to piloted sets in this slice — scoring extra pilote
items belongs with slice 3, where their role (do they count? are they
distinguishable to the test-taker?) actually gets decided.

Handling, without any backend change:
- `SetPicker` lists everything with `statut === 'complet'` (cheap, from the
  list endpoint already).
- On opening a specific set, `ExamMode` fetches `GET /api/sets/:id` and
  validates before proceeding to preload: `set.pilotes === false`, item
  count === 32, total question count === 36. A set that fails this check
  never reaches the preload/timer machinery — it shows an explicit "Este
  set no es compatible con este runner (fue generado con pilotos)" message
  and returns to the picker.

## Architecture

`frontend/src/App.jsx` today is a single monolithic component running the
training-mode state machine. This slice splits it into a thin mode shell
plus two independent modes:

- **`App.jsx`** — a shell: a mode switcher ("Entrenamiento" / "Modo Examen")
  at the top, rendering `<TrainingMode/>` or `<ExamMode/>`. The switcher is
  disabled (or routed through the same abandon-confirmation guard as the
  in-runner "Abandonar" button) whenever `ExamMode` reports an attempt is in
  progress — switching away must never silently discard a running exam.
- **`TrainingMode.jsx`** — today's `App.jsx` body, moved verbatim (renamed
  component, same state, same JSX). Pure extraction, no behavior change.
- **`exam/ExamMode.jsx`** — owns the top-level phase for the whole exam
  flow: `picker → loading → incompatible → unlock → preloading → running →
  summary`. This is also where set-detail fetch errors, compatibility
  failures, and the answers/results payload used by `ExamSummary` all live
  — a single owner for state that previously would have been split
  ambiguously across sibling components.
- **`exam/SetPicker.jsx`** — presentational: given the list of `complet`
  sets (fetched by `ExamMode`), lets the user pick one. Owns only its own
  list-fetch retry UI.
- **`exam/ExamRunner.jsx`** — the lockstep engine proper, mounted only once
  `ExamMode` has a validated, fully-preloaded, unlocked set. Drives the
  per-item state machine (via `examMachine.js`) and renders each phase.
  Calls `onComplete({ answers, correctBySection, correctTotal })` when the
  last item finishes; never talks to the backend beyond audio fetches
  already done during preload.
- **`exam/examTiming.js`** — pure module, no DOM: deadline/remaining-time
  arithmetic (see Timing Model). Unit-tested with `node --test`.
- **`exam/examMachine.js`** — pure module, no DOM: the item/section
  transition logic itself, as a reducer `(state, event) -> nextState` (see
  State Machine). Unit-tested with `node --test`. This is the piece that
  owns correctness under competing async signals (tick expiry, `ended`,
  watchdog, user clicks) — kept pure specifically so those interleavings
  are testable without a browser.
- **`exam/ExamSummary.jsx`** — final screen: correct/total, correct per
  section. Receives its data as props from `ExamMode`, not from `ExamRunner`
  directly.

Sections and items play in the order `set.sections[]` already provides,
which already matches real bloc order 2→3→4 (`SET_COMPOSITIONS.SET_STANDARD_36`
is `GENERABLE_SECTIONS` in that order).

**Audio URL construction:** `item.audio` is stored as `audio/{ref}.wav`
(`pipeline.js`), but the route `GET /api/sets/:id/audio/:archivo` matches
only a bare filename against `/^[\w-]+\.wav$/` — passing `item.audio`
directly would send an invalid path segment. The runner always builds the
request as `` `/api/sets/${setId}/audio/${item.ref}.wav` ``, never from
`item.audio` verbatim.

## Autoplay

Exam audio plays with sound and no visible player controls, which browsers
(Chrome, and especially Safari/WebKit) restrict without user interaction.
A single click at the start of a session is generally sufficient to
authorize subsequent programmatic `play()` calls for the rest of that
browsing session in Chrome, but this is not guaranteed everywhere, and a
silent failure here is worse than in training mode: it would let the
lockstep timer advance as if the candidate had heard audio they never did.

Design:
- After preload finishes, `ExamMode` shows an explicit "Audio listo —
  Comenzar examen" screen. Clicking it plays and immediately pauses a
  single, reused `<audio>` element — the standard unlock pattern — before
  entering `ExamRunner`.
- That same `<audio>` element (not a fresh one per item) is reused for
  every item's playback for the rest of the run, since the unlock is tied
  to the element, not just the click.
- The `audio` phase does not start its countdown or its watchdog until the
  `play()` promise resolves (or the `playing` event fires) — never on the
  optimistic assumption that a `play()` call succeeded.
- If `play()` rejects, the phase does not proceed as if playback happened.
  The run pauses on an explicit "No se pudo reproducir el audio" state with
  a retry action; nothing in this state silently advances the clock.

## Timing Model

Training mode's `App.jsx` ticks `timeLeft` down by 1 every `setInterval`
firing — each firing can itself be late (tab throttling, main-thread work),
and those delays accumulate over a session. Two separate guarantees matter
here, and they need separate mechanisms:

**1. No drift within a phase.** `examTiming.js` anchors each phase to an
absolute deadline and always re-derives remaining time from the clock, not
from the previous tick's value:

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

A late or skipped tick self-corrects on the next one instead of compounding
— this part was already correct in the original design.

**2. No drift *across* fixed-duration phase transitions.** This was the gap:
if the tick that detects `remaining <= 0` itself fires late (e.g. 200ms
after the true deadline, however that happens), and the next phase's
deadline is computed from `performance.now()` captured *inside that late
callback*, the 200ms slop is baked into the new deadline — and compounds
across every timer-driven transition in the run. Fixed-duration transitions
(`avant`'s end triggering the move into `audio`) instead compute the next
deadline as `previousDeadline + nextDurationMs`, never from the live clock
at the moment the transition code happens to run. This is ordinary
fixed-step scheduling, applied consistently.

**The `audio` phase is the deliberate exception to both rules.** It has no
scheduled deadline at all: it starts on the real `playing` event (see
Autoplay above) and ends on the real `ended` event (or the watchdog
fallback below) — its duration is however long the browser actually takes
to play the file, which is correct behavior, not drift. The `apres` phase
that follows anchors its own deadline from that real end timestamp, not
from `item.duree_audio_s`'s scheduled value. `duree_audio_s` is still used,
but only as the watchdog's fallback trigger, not as the source of truth
when `ended` fires normally.

**Idempotent transitions.** Because `ended`, the watchdog timeout, and the
regular tick can all fire close together, every transition in
`examMachine.js` carries a `{ sectionIndex, itemIndex, phase }` token
captured when that phase started. A callback whose token no longer matches
current state is a no-op — this is what makes "audio ended AND watchdog
fired for the same item" or "a stray tick after advancing" harmless instead
of a double-advance.

## State Machine

`examMachine.js` is a pure reducer: `(state, event) -> nextState`, with
events `START`, `TICK`, `AUDIO_PLAYING`, `AUDIO_ENDED`, `AUDIO_FAILED`,
`TIMER_EXPIRED`, `ANSWER_SELECTED`, `SECTION_CONTINUE`, `ABANDON`. All
audio/DOM/timer side effects live in `ExamRunner`, which dispatches events
into the machine and renders whatever state it returns — the machine itself
never touches `<audio>`, `setTimeout`, or `fetch`.

**Per item** (one audio + 1 or 2 questions, depending on `questionsPerAudio`):

```
avant (timing.avant sec, fixed-schedule)
  → audio (autoplay, unlocked; starts on AUDIO_PLAYING, ends on AUDIO_ENDED or watchdog)
    → apres (timing.apres sec, anchored to audio's real end)
      → next item
```

- **`avant`**: question(s) and options render immediately, no audio yet —
  reading time before the listen, matching the real format's `avant`.
- **`audio`**: see Autoplay and Timing Model above for exactly how this
  phase starts, ends, and what happens if it can't. Watchdog fallback: a
  `setTimeout(item.duree_audio_s)` *armed only after `AUDIO_PLAYING`*, not
  from when playback was requested — so a failed `play()` can never be
  mistaken for a completed listen.
- **`apres`**: countdown from `timing.apres`, anchored per Timing Model.
  Answer selection is allowed throughout `avant`/`audio`/`apres` (matching
  training mode's existing behavior, which already allows selecting during
  `scanning`/`reading`, not just `answering`) — there is no "continue"
  button; advance is timer-driven only, faithful to the real exam.
  Unanswered questions at timeout count as incorrect.
- **Interview/reportage** (`questionsPerAudio: 2`): both questions render
  together during `apres`, each with a `<select>` for its options (instead
  of the button-per-option style training mode and the rest of the exam
  sections use) so both fit on screen at once. Option text wraps inside the
  select rather than truncating.

**Between sections**: after the last item of a section, a short transition
screen — "Sección siguiente: {nombre} — {N} preguntas" — with a "Continuar"
button (`SECTION_CONTINUE` event), before the next section's first item
starts its `avant`.

**End of set**: `ExamRunner` calls `onComplete({ answers, correctBySection,
correctTotal })`; `ExamMode` holds that result and renders `ExamSummary`
from it. No persistence.

**Answers**: held in the machine's state,
`{ [sectionType]: { [ref]: { [questionIndex]: optionId } } }`. Never sent to
the backend, per the "no resume, no persistence" scope decision.

**Abandon**: an always-visible "Abandonar" button asks for confirmation,
dispatches `ABANDON`, and returns to `SetPicker` via `ExamMode` — nothing
was persisted, so there's nothing to clean up beyond revoking the preloaded
audio blob URLs (see Resource Management). The same guard covers the
top-level mode switch (see Architecture) and a `beforeunload` listener
attached whenever the phase is not `idle`/`summary`, warning against
accidental tab close/reload.

## Resource Management

A full set's audio is uncompressed 16-bit/24kHz mono WAV
(`wavDurationSeconds` in `audio/synth.js` confirms this format). Based on
each section's `minWords`/`maxWords` in `examFormat.js`, a full 32-item set
is roughly 20 minutes of spoken audio, which at ~2.8MB/minute for this WAV
format comes out to **roughly 50-60MB total** — solidly in "needs real
resource management," even if not the "100MB+" upper bound floated during
review.

- Preload fetches run with bounded concurrency (a handful at a time, not
  all 32 simultaneously).
- Each fetch checks `response.ok` before treating the body as audio, and is
  wrapped in an `AbortController` so in-flight downloads stop immediately
  on abandon or unmount.
- Every object URL created during preload is revoked exactly once, on every
  exit path: normal completion, abandon, retry-after-failure (revoke before
  re-fetching), and component unmount.
- Before "Comenzar examen" is enabled, each preloaded file is confirmed
  playable — not just "bytes arrived" — by waiting for `loadedmetadata` (or
  `canplay`) and checking `duration` is finite, not only that `fetch()`
  resolved with `response.ok`.

## Error Handling

- **`GET /api/sets` fails**: error + retry, owned by `SetPicker` (the only
  thing it fetches).
- **`GET /api/sets/:id` fails, or the set fails compatibility validation**:
  owned by `ExamMode`, since it's the one performing that fetch (see
  Architecture) — error + retry for a network/server failure; a distinct,
  non-retryable message for a compatibility failure (piloted set, wrong
  format).
- **Audio preload failure** (one or more files): failed items are marked in
  the preload progress UI; once the initial pass finishes, if any failed,
  offer "Reintentar fallidos" (retries only those, after revoking any
  partial URL for them) or "Volver a la lista". The timed run never starts
  with missing or unconfirmed-playable audio.
- **`play()` rejects, or `AUDIO_ENDED` never arrives**: covered by Autoplay
  and the watchdog described in the State Machine section — both funnel
  into an explicit non-silent failure state, never an unnoticed skip.

## Testing

No frontend test runner exists in this repo today. This slice adds one:
`frontend/package.json` gets a `test` script (`node --test src/exam/**/*.test.js`
or equivalent — pinned at plan time to the exact glob/location used) so it's
discoverable in CI, not left as "wherever seems right."

- **`examTiming.js`**: deadline computation, tick monotonicity, zero-clamp
  at expiry, and that a late tick doesn't compound error on the next one.
- **`examMachine.js`** (the higher-value target — this is the part that
  owns correctness under real concurrency, not just arithmetic):
  - Two competing events (e.g. `AUDIO_ENDED` and the watchdog `TIMER_EXPIRED`
    for the same item) never advance the machine twice.
  - An `ANSWER_SELECTED` registered in the same tick as the deadline is
    still counted.
  - Questions left unanswered at timeout are recorded as such, not dropped.
  - Both 1-question and 2-question (`questionsPerAudio: 2`) items transition
    correctly.
  - Last item of a section triggers the section-transition state; last item
    of the whole set triggers completion, not a section transition.
  - A stale event carrying an old `{sectionIndex, itemIndex, phase}` token
    (e.g., a late callback after `ABANDON`) is a no-op.
  - `AUDIO_FAILED` halts the machine in the non-silent failure state, never
    silently proceeding as `AUDIO_ENDED` would.

`ExamMode`/`ExamRunner`/`SetPicker`/`ExamSummary` themselves stay
browser-verified only, consistent with the rest of the frontend — the point
of extracting `examMachine.js` is precisely to pull the risky logic out of
that untested layer.

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
8. `examTiming.js` gets automated tests; the rest of the frontend does not
   — later widened by decision 15 below.
9. Piloted sets (`pilotes: true`) are explicitly rejected by this runner
   rather than mishandled — found during review by tracing `planner.js`'s
   pilote logic against the 32/36 assumption baked into the original spec.
10. Autoplay is explicitly unlocked via a single reused `<audio>` element
    behind a "Comenzar examen" click, and the `audio` phase's start (and
    its watchdog) are gated on confirmed playback, never on an optimistic
    `play()` call — found during review: the original watchdog design could
    have silently advanced the clock past a playback failure.
11. Phase-to-phase timing distinguishes two guarantees (no drift within a
    phase vs. no drift across fixed-duration transitions) and treats the
    `audio` phase as anchored to real playback events, not a schedule —
    found during review: the original single deadline model didn't prevent
    slop from accumulating across transitions.
12. Transitions carry a `{sectionIndex, itemIndex, phase}` token and are
    idempotent, to make competing async signals (tick/ended/watchdog) safe.
13. `ExamMode` (not `SetPicker` or `ExamRunner` individually) owns the
    top-level phase and the error handling for set-detail loading and
    compatibility validation, resolving an ownership gap between the
    original spec's Architecture and Error Handling sections.
14. The top-level training/exam mode switch is guarded the same way as the
    in-runner "Abandonar" button — it cannot silently discard a running
    attempt.
15. `examMachine.js` is extracted as a second pure, unit-tested module
    alongside `examTiming.js`, specifically because it's what owns
    correctness under concurrent async events — found during review as a
    higher-value test target than timing arithmetic alone.
