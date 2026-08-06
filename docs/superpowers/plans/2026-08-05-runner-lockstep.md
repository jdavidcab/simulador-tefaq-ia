# Runner Lockstep (Modo Examen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a frontend "Modo Examen" screen that takes an already-generated `SET_STANDARD_36` set through a lockstep exam experience (autoplay audio, strict per-item timing, no pause/back-navigation) and shows a raw score at the end.

**Architecture:** `App.jsx` becomes a thin mode shell over the existing `TrainingMode.jsx` (extracted verbatim) and a new `exam/` module. Two pure, unit-tested modules — `examTiming.js` (deadline arithmetic) and `examMachine.js` (the item/section transition reducer) — carry all of the risky logic; every other new piece (`ExamMode`, `ExamRunner`, `SetPicker`, `ExamSummary`, `audioPreload`) is a thin, browser-verified consumer of them. No backend changes.

**Tech Stack:** React 18 (existing), Node 22's built-in `node --test` for the two pure modules (new to the frontend), Tailwind utility classes (existing convention).

**Design spec:** `docs/superpowers/specs/2026-08-05-runner-lockstep-design.md` — read it once before starting; this plan implements it exactly, including the post-review revisions (pilote-set rejection, autoplay unlock, cross-phase timing chaining, `examMachine.js` extraction).

## Global Constraints

- No backend changes. Only these existing endpoints are used: `GET /api/sets`, `GET /api/sets/:id`, `GET /api/sets/:id/audio/:archivo.wav`. Backend base URL is hardcoded as `http://localhost:3001`, matching the rest of the frontend.
- This slice covers a single continuous sitting only — no resume, no attempt persistence anywhere (not `localStorage`, not the backend). Abandoning or closing the tab loses the attempt.
- The runner only accepts sets where `pilotes === false`, `format === 'SET_STANDARD_36'`, exactly 32 audio items, and exactly 36 total questions. Anything else is rejected with an explicit message before preload starts.
- Audio in exam mode is autoplay-only: no pause/repeat/speed controls (unlike `TrainingMode`). Playback is gated on a single "Comenzar examen" click that unlocks one persistent `<audio>` element, reused for every item.
- The `audio` phase's start/end are driven by real playback events (`play()` resolving, `ended`), never assumed — a failed `play()` must never let the countdown proceed as if the candidate heard the audio.
- No "continue" button inside an item: advance is timer-driven only. Unanswered questions at timeout count as incorrect.
- `interview`/`reportage` items show both of their questions at once during `apres`, each with a select-style dropdown for options whose open list wraps long option text instead of truncating (native `<option>` elements don't reliably wrap across browsers, so this is a custom listbox, not a literal `<select>` — see Task 8). All other sections keep `TrainingMode`'s button-per-option style.
- Short transition screens appear between the 7 sections, gated on a "Continuar" click.
- Abandon is allowed anywhere, with confirmation. The top-level training/exam mode switch is guarded the same way — it's disabled while an exam attempt is active.
- The end-of-exam screen shows only a raw correct/total and correct-per-section count — no `/699` estimate, no per-question analysis (that's a later slice).
- `examTiming.js` and `examMachine.js` are pure (no DOM, no fetch, no timers) and unit-tested with `node --test`. Every other new component is browser-verified only, consistent with the rest of the frontend (no test runner exists for React components in this repo).
- Audio request URLs are always built as `` `http://localhost:3001/api/sets/${setId}/audio/${item.ref}.wav` `` — never from `item.audio` verbatim (it's stored as `audio/{ref}.wav`, which doesn't match the route's bare-filename pattern).

---

### Task 1: Extract `TrainingMode.jsx` from `App.jsx`

Pure mechanical extraction — no behavior change. This unblocks every later task, which needs `App.jsx` free to become the mode shell.

**Files:**
- Create: `frontend/src/TrainingMode.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Produces: `TrainingMode` — default-exported React component, zero props, identical behavior to today's `App`.

- [ ] **Step 1: Copy the file**

```bash
cp frontend/src/App.jsx frontend/src/TrainingMode.jsx
```

- [ ] **Step 2: Rename the component in the copy**

In `frontend/src/TrainingMode.jsx`, make exactly these two changes (everything else stays byte-for-byte identical — same imports, same state, same JSX, same phase machine):
- Line 12: `const App = () => {` → `const TrainingMode = () => {`
- Line 823: `export default App;` → `export default TrainingMode;`

- [ ] **Step 3: Replace `App.jsx` with a passthrough shell**

Replace the entire contents of `frontend/src/App.jsx` with:

```jsx
import React from 'react';
import TrainingMode from './TrainingMode';

const App = () => <TrainingMode />;

export default App;
```

(The mode switcher and `ExamMode` integration land in Task 10, once `ExamMode` exists. This task only proves the extraction is behavior-preserving.)

- [ ] **Step 4: Manual verification**

```bash
cd frontend && npm run dev
```

Open the printed URL. Confirm the app looks and behaves exactly as before: configure a question, generate one, go through scanning → reading → answering → feedback, restart, try "Solo lectura rápida". No console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/TrainingMode.jsx
git commit -m "refactor(frontend): extract TrainingMode from App.jsx"
```

---

### Task 2: `examTiming.js` — deadline/tick arithmetic

The first of the two pure modules. Establishes the frontend's first automated test and the `npm test` entry point later tasks' tests reuse.

**Files:**
- Create: `frontend/src/exam/examTiming.js`
- Create: `frontend/src/exam/examTiming.test.js`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces:
  - `startPhase(durationSeconds, now = performance.now()) -> { deadline: number }`
  - `remainingSeconds(phaseState, now = performance.now()) -> number` (integer, `Math.ceil`, clamped to `>= 0`)
  - `isExpired(phaseState, now = performance.now()) -> boolean`
  - `chainDeadline(previousPhaseState, nextDurationSeconds) -> { deadline: number }` — computes `previousPhaseState.deadline + nextDurationSeconds * 1000`, ignoring the live clock entirely. This is what prevents a late tick from leaking scheduling slop into the next phase.

- [ ] **Step 1: Add the frontend test script**

In `frontend/package.json`, add a `"test"` entry to `"scripts"`:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "node --test src/exam"
},
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/exam/examTiming.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from './examTiming.js';

test('startPhase computes a deadline duration seconds ahead of now', () => {
  const phase = startPhase(10, 1000);
  assert.equal(phase.deadline, 11000);
});

test('remainingSeconds rounds up remaining time', () => {
  const phase = startPhase(10, 0);
  assert.equal(remainingSeconds(phase, 0), 10);
  assert.equal(remainingSeconds(phase, 500), 10); // quedan 9.5s -> ceil -> 10
  assert.equal(remainingSeconds(phase, 1000), 9);
});

test('remainingSeconds nunca es negativo', () => {
  const phase = startPhase(5, 0);
  assert.equal(remainingSeconds(phase, 10000), 0);
});

test('isExpired es false antes del deadline y true en/después de él', () => {
  const phase = startPhase(5, 0);
  assert.equal(isExpired(phase, 4999), false);
  assert.equal(isExpired(phase, 5000), true);
  assert.equal(isExpired(phase, 6000), true);
});

test('chainDeadline extiende el deadline anterior, ignorando el reloj vivo', () => {
  const phase1 = startPhase(10, 0); // deadline = 10000
  const phase2 = chainDeadline(phase1, 20);
  assert.equal(phase2.deadline, 30000);
});

test('un tick tardío detectando el vencimiento no filtra slop a la fase encadenada', () => {
  const phase1 = startPhase(10, 0); // deadline = 10000
  // El tick que detecta el vencimiento llega 250ms tarde (jank del hilo
  // principal) -- no debe filtrarse a la fase siguiente.
  const lateNow = 10250;
  assert.equal(isExpired(phase1, lateNow), true);
  const phase2 = chainDeadline(phase1, 5); // encadena desde el deadline TEÓRICO, no desde lateNow
  assert.equal(phase2.deadline, 15000);
  assert.equal(remainingSeconds(phase2, 15000), 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd frontend && npm test
```

Expected: FAIL — `examTiming.js` doesn't exist yet.

- [ ] **Step 4: Implement `examTiming.js`**

Create `frontend/src/exam/examTiming.js`:

```js
// Aritmética de deadlines para el Runner de examen. Cada fase se ancla a un
// deadline absoluto y siempre recalcula el tiempo restante desde el reloj,
// nunca desde el valor del tick anterior -- un tick tardío o saltado se
// autocorrige en el siguiente en vez de acumular error. chainDeadline es la
// pieza que evita que ESE error se filtre entre fases: calcula el próximo
// deadline sumando al anterior, no capturando el reloj vivo en el momento
// (posiblemente tardío) en que corre el callback de transición.

export function startPhase(durationSeconds, now = performance.now()) {
  return { deadline: now + durationSeconds * 1000 };
}

export function remainingSeconds(phaseState, now = performance.now()) {
  return Math.max(0, Math.ceil((phaseState.deadline - now) / 1000));
}

export function isExpired(phaseState, now = performance.now()) {
  return now >= phaseState.deadline;
}

export function chainDeadline(previousPhaseState, nextDurationSeconds) {
  return { deadline: previousPhaseState.deadline + nextDurationSeconds * 1000 };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npm test
```

Expected: PASS, 6/6.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/src/exam/examTiming.js frontend/src/exam/examTiming.test.js
git commit -m "feat(exam): add examTiming.js, pure deadline arithmetic"
```

---

### Task 3: `examMachine.js` — the lockstep reducer

The highest-value test target in this slice: the pure reducer that owns correctness under competing async signals (tick expiry, real audio end, watchdog fallback, section-continue, abandon). All DOM/timer/fetch side effects stay in `ExamRunner` (Task 8) — this module never touches any of them.

**Files:**
- Create: `frontend/src/exam/examMachine.js`
- Create: `frontend/src/exam/examMachine.test.js`

**Interfaces:**
- Consumes: a `set` object shaped like the real backend set (`set.sections[i].type`, `.items[j].ref`, `.items[j].questions[k].correctId`) — passed as the reducer's first argument, never stored in state.
- Produces:
  - `createInitialState() -> MachineState` where `MachineState = { status: 'running'|'complete'|'abandoned', sectionIndex: number, itemIndex: number, phase: 'avant'|'audio-pending'|'audio-playing'|'audio-failed'|'apres'|'section-transition', answers: { [sectionType]: { [ref]: { [questionIndex]: optionId } } } }`
  - `currentToken(state) -> { sectionIndex, itemIndex, phase }`
  - `reducer(set, state, event) -> MachineState` — event types: `ANSWER_SELECTED` (`{ type, token, questionIndex, optionId }`), `TIMER_EXPIRED` (`{ type, token }`), `AUDIO_PLAYING` (`{ type, token }`), `AUDIO_ENDED` (`{ type, token }`), `AUDIO_FAILED` (`{ type, token }`), `RETRY_AUDIO` (`{ type, token }`), `SECTION_CONTINUE` (`{ type }`), `ABANDON` (`{ type }`). Events carrying a `token` are dropped as no-ops if it doesn't match `currentToken(state)` (or, for `ANSWER_SELECTED`, if `sectionIndex`/`itemIndex` don't match — its `phase` is allowed to differ, since answering is valid across `avant`/`audio-pending`/`audio-playing`/`apres`).
  - `computeResults(set, answers) -> { answers, correctBySection: { [sectionType]: number }, correctTotal: number }`
- Read by Task 8 (`ExamRunner.jsx`), which is the only place that dispatches events into this reducer.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/exam/examMachine.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reducer, currentToken, computeResults } from './examMachine.js';

// Set mínimo con dos secciones: la primera de 1-pregunta-por-audio (2 ítems,
// para cubrir el avance dentro de la sección), la segunda de 2 preguntas por
// audio (1 ítem, para cubrir interview/reportage y el fin del set).
function fixtureSet() {
  return {
    sections: [
      {
        type: 'annonce_publique',
        items: [
          { ref: 's1i1', questions: [{ correctId: 'A' }] },
          { ref: 's1i2', questions: [{ correctId: 'B' }] },
        ],
      },
      {
        type: 'interview',
        items: [
          { ref: 's2i1', questions: [{ correctId: 'A' }, { correctId: 'C' }] },
        ],
      },
    ],
  };
}

function dispatch(set, state, event) {
  return reducer(set, state, event);
}

function runItemToApres(set, state) {
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // avant -> audio-pending
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_ENDED', token: currentToken(state) }); // -> apres
  return state;
}

test('avant vence y pide reproducir audio', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  assert.equal(state.phase, 'audio-pending');
});

test('AUDIO_PLAYING solo aplica en audio-pending y con el token correcto', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  const staleToken = { sectionIndex: 0, itemIndex: 0, phase: 'avant' }; // token de la fase anterior
  const unchanged = dispatch(set, state, { type: 'AUDIO_PLAYING', token: staleToken });
  assert.equal(unchanged.phase, 'audio-pending', 'un token de una fase vieja no debe avanzar la máquina');
  const advanced = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  assert.equal(advanced.phase, 'audio-playing');
});

test('AUDIO_ENDED y un watchdog tardío compitiendo por el mismo ítem no avanzan dos veces', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  const tokenDuringAudio = currentToken(state);

  const afterEnded = dispatch(set, state, { type: 'AUDIO_ENDED', token: tokenDuringAudio });
  assert.equal(afterEnded.phase, 'apres');

  // El watchdog, armado antes de AUDIO_ENDED, dispara tarde con el MISMO
  // token capturado en audio-playing -- ya no coincide con el estado actual.
  const afterStaleWatchdog = dispatch(set, afterEnded, { type: 'TIMER_EXPIRED', token: tokenDuringAudio });
  assert.equal(afterStaleWatchdog, afterEnded, 'debe ser un no-op exacto, no una fase que coincide por casualidad');
});

test('el watchdog SÍ avanza a apres cuando AUDIO_ENDED nunca llega', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // watchdog
  assert.equal(state.phase, 'apres');
});

test('ANSWER_SELECTED se acepta durante avant, audio-pending, audio-playing y apres', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A');

  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'B' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'B', 'debe poder cambiar la respuesta mientras el ítem sigue visible');
});

test('una respuesta registrada justo antes del vencimiento del deadline queda contada', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  const beforeExpiry = state;
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence, avanza
  assert.equal(beforeExpiry.answers.annonce_publique.s1i1[0], 'A');
  assert.equal(state.itemIndex, 1, 'debe avanzar al segundo ítem de la misma sección');
});

test('preguntas sin responder quedan registradas como ausentes, no se descartan', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence sin responder
  const results = computeResults(set, state.answers);
  assert.equal(results.correctBySection.annonce_publique, 0);
});

test('el último ítem de una sección dispara section-transition, no el siguiente ítem', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> item 2 de la sección
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // último ítem -> section-transition
  assert.equal(state.phase, 'section-transition');
  assert.equal(state.sectionIndex, 0, 'todavía no cruzó a la siguiente sección hasta el clic de Continuar');
});

test('SECTION_CONTINUE cruza a la siguiente sección desde su primer ítem', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-transition
  state = dispatch(set, state, { type: 'SECTION_CONTINUE' });
  assert.equal(state.sectionIndex, 1);
  assert.equal(state.itemIndex, 0);
  assert.equal(state.phase, 'avant');
});

test('el último ítem del set (2 preguntas) pasa a status complete y computa el resultado', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-transition
  state = dispatch(set, state, { type: 'SECTION_CONTINUE' }); // sección 1 (interview)

  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 1, optionId: 'C' });
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // último ítem del set

  assert.equal(state.status, 'complete');
  const results = computeResults(set, state.answers);
  assert.equal(results.correctBySection.interview, 2);
  assert.equal(results.correctTotal, 2);
});

test('AUDIO_FAILED detiene la máquina explícitamente, nunca se confunde con AUDIO_ENDED', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'AUDIO_FAILED', token: currentToken(state) });
  assert.equal(state.phase, 'audio-failed');
  state = dispatch(set, state, { type: 'RETRY_AUDIO', token: currentToken(state) });
  assert.equal(state.phase, 'audio-pending');
});

test('ABANDON detiene la máquina desde cualquier fase; eventos posteriores son no-op', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'ABANDON' });
  assert.equal(state.status, 'abandoned');
  const after = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  assert.equal(after, state, 'nada debe mover un estado ya abandonado');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test
```

Expected: FAIL — `examMachine.js` doesn't exist yet.

- [ ] **Step 3: Implement `examMachine.js`**

Create `frontend/src/exam/examMachine.js`:

```js
// Máquina de estados pura del Runner de examen: (set, state, event) -> nextState.
// No toca DOM, timers ni fetch -- eso vive en ExamRunner.jsx. Los eventos que
// pueden llegar de un callback asíncrono tardío (TIMER_EXPIRED, AUDIO_PLAYING,
// AUDIO_ENDED, AUDIO_FAILED, RETRY_AUDIO) llevan un token {sectionIndex,
// itemIndex, phase} que se compara contra el estado actual: si no coincide,
// el evento es un no-op. Así, un watchdog y un 'ended' real compitiendo por
// el mismo ítem nunca avanzan la máquina dos veces.

export function createInitialState() {
  return {
    status: 'running', // 'running' | 'complete' | 'abandoned'
    sectionIndex: 0,
    itemIndex: 0,
    phase: 'avant', // 'avant' | 'audio-pending' | 'audio-playing' | 'audio-failed' | 'apres' | 'section-transition'
    answers: {},
  };
}

export function currentToken(state) {
  return { sectionIndex: state.sectionIndex, itemIndex: state.itemIndex, phase: state.phase };
}

function sameToken(a, b) {
  return a.sectionIndex === b.sectionIndex && a.itemIndex === b.itemIndex && a.phase === b.phase;
}

function sameItem(a, b) {
  return a.sectionIndex === b.sectionIndex && a.itemIndex === b.itemIndex;
}

function isLastItemInSection(set, sectionIndex, itemIndex) {
  return itemIndex === set.sections[sectionIndex].items.length - 1;
}

function isLastSection(set, sectionIndex) {
  return sectionIndex === set.sections.length - 1;
}

// Al vencer 'apres': siguiente ítem de la misma sección, pantalla de
// transición si era el último ítem de la sección, o fin del set si además
// era la última sección.
function advance(set, state) {
  const { sectionIndex, itemIndex } = state;
  if (!isLastItemInSection(set, sectionIndex, itemIndex)) {
    return { ...state, itemIndex: itemIndex + 1, phase: 'avant' };
  }
  if (!isLastSection(set, sectionIndex)) {
    return { ...state, phase: 'section-transition' };
  }
  return { ...state, status: 'complete' };
}

function startNextSection(state) {
  return { ...state, sectionIndex: state.sectionIndex + 1, itemIndex: 0, phase: 'avant' };
}

const ANSWERABLE_PHASES = new Set(['avant', 'audio-pending', 'audio-playing', 'apres']);

export function reducer(set, state, event) {
  if (event.type === 'ABANDON') {
    return state.status === 'running' ? { ...state, status: 'abandoned' } : state;
  }
  if (state.status !== 'running') return state;

  switch (event.type) {
    case 'ANSWER_SELECTED': {
      if (!sameItem(event.token, currentToken(state))) return state;
      if (!ANSWERABLE_PHASES.has(state.phase)) return state;
      const sectionType = set.sections[state.sectionIndex].type;
      const ref = set.sections[state.sectionIndex].items[state.itemIndex].ref;
      return {
        ...state,
        answers: {
          ...state.answers,
          [sectionType]: {
            ...state.answers[sectionType],
            [ref]: {
              ...(state.answers[sectionType]?.[ref]),
              [event.questionIndex]: event.optionId,
            },
          },
        },
      };
    }

    case 'TIMER_EXPIRED': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase === 'avant') return { ...state, phase: 'audio-pending' };
      if (state.phase === 'audio-playing') return { ...state, phase: 'apres' }; // watchdog
      if (state.phase === 'apres') return advance(set, state);
      return state;
    }

    case 'AUDIO_PLAYING': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase !== 'audio-pending') return state;
      return { ...state, phase: 'audio-playing' };
    }

    case 'AUDIO_ENDED': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase !== 'audio-playing') return state;
      return { ...state, phase: 'apres' };
    }

    case 'AUDIO_FAILED': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase !== 'audio-pending' && state.phase !== 'audio-playing') return state;
      return { ...state, phase: 'audio-failed' };
    }

    case 'RETRY_AUDIO': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase !== 'audio-failed') return state;
      return { ...state, phase: 'audio-pending' };
    }

    case 'SECTION_CONTINUE': {
      if (state.phase !== 'section-transition') return state;
      return startNextSection(state);
    }

    default:
      return state;
  }
}

export function computeResults(set, answers) {
  let correctTotal = 0;
  const correctBySection = {};
  for (const section of set.sections) {
    let correct = 0;
    for (const item of section.items) {
      const itemAnswers = answers[section.type]?.[item.ref] ?? {};
      item.questions.forEach((question, questionIndex) => {
        if (itemAnswers[questionIndex] === question.correctId) correct += 1;
      });
    }
    correctBySection[section.type] = correct;
    correctTotal += correct;
  }
  return { answers, correctBySection, correctTotal };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test
```

Expected: PASS, all `examTiming.test.js` and `examMachine.test.js` tests green (18 total).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/examMachine.js frontend/src/exam/examMachine.test.js
git commit -m "feat(exam): add examMachine.js, the lockstep transition reducer"
```

---

### Task 4: `audioPreload.js` — bulk audio fetch with bounded concurrency

Not pure (uses `fetch`, `Audio`, `URL.createObjectURL`) — browser-verified only, per the Global Constraints. Verified against one of the two real local sets already on disk from an earlier slice (`backend/data/sets/set-2026-08-05-2gpz` or `-vqxe`, both `statut: 'complet'`, 7 real items each) — no API cost, real served audio.

**Files:**
- Create: `frontend/src/exam/audioPreload.js`

**Interfaces:**
- Produces:
  - `preloadSetAudio({ setId, refs, concurrency = 4, signal, onProgress }) -> Promise<{ urls: Map<string, string>, failedRefs: string[] }>` — `refs` is an array of item `ref`s (e.g. `['s1i1', 's1i2', ...]`); `onProgress` is called as `({ done, total, failedRefs })` after every attempt (success or failure); `urls` maps `ref -> blob: URL`; a `ref` that failed at any stage (network, non-2xx, undecodable) appears in `failedRefs` and never gets a URL.
  - `revokeAudioUrls(urls: Map<string, string>) -> void` — revokes every blob URL in the map.
- Read by Task 9 (`ExamMode.jsx`), which owns the retry-on-failure flow (calling `preloadSetAudio` again with only the failed `refs`, merging the returned `urls` into what it already has).

- [ ] **Step 1: Implement `audioPreload.js`**

Create `frontend/src/exam/audioPreload.js`:

```js
// Precarga de audio para el Runner de examen. No es lógica pura (usa fetch,
// Audio, URL.createObjectURL) -- se verifica manualmente en el navegador,
// como el resto del frontend. Concurrencia acotada + AbortController +
// verificación real de reproducibilidad (no solo "llegaron bytes") porque un
// set completo son ~50-60MB de WAV sin comprimir.

const API_BASE = 'http://localhost:3001';
const AUDIO_LOAD_TIMEOUT_MS = 30000;

function audioUrlFor(setId, ref) {
  return `${API_BASE}/api/sets/${setId}/audio/${ref}.wav`;
}

async function fetchAudioBlob(setId, ref, signal) {
  const response = await fetch(audioUrlFor(setId, ref), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar ${ref}.wav`);
  return response.blob();
}

// Confirma que el blob es audio reproducible de verdad, no solo que
// llegaron bytes -- espera loadedmetadata con una duración finita.
function confirmPlayable(blobUrl) {
  return new Promise((resolve, reject) => {
    const probe = new Audio();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeEventListener('loadedmetadata', onLoaded);
      probe.removeEventListener('error', onError);
      fn(value);
    };
    const onLoaded = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) finish(resolve);
      else finish(reject, new Error('Duración de audio no válida'));
    };
    const onError = () => finish(reject, new Error('Audio no decodificable'));
    const timer = setTimeout(
      () => finish(reject, new Error('Tiempo de espera agotado al validar audio')),
      AUDIO_LOAD_TIMEOUT_MS,
    );
    probe.addEventListener('loadedmetadata', onLoaded);
    probe.addEventListener('error', onError);
    probe.src = blobUrl;
  });
}

export async function preloadSetAudio({ setId, refs, concurrency = 4, signal, onProgress }) {
  const urls = new Map();
  const failedRefs = [];
  let done = 0;
  let cursor = 0;

  const report = () => onProgress?.({ done, total: refs.length, failedRefs: [...failedRefs] });

  async function worker() {
    while (cursor < refs.length) {
      const ref = refs[cursor];
      cursor += 1;
      let blobUrl = null;
      try {
        const blob = await fetchAudioBlob(setId, ref, signal);
        blobUrl = URL.createObjectURL(blob);
        await confirmPlayable(blobUrl);
        urls.set(ref, blobUrl);
      } catch (error) {
        if (signal?.aborted) return;
        if (blobUrl) URL.revokeObjectURL(blobUrl); // no dejar colgado un blob que falló recién creado
        failedRefs.push(ref);
      } finally {
        done += 1;
        report();
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, refs.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { urls, failedRefs };
}

export function revokeAudioUrls(urls) {
  for (const url of urls.values()) URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Manual verification with a real local set**

Confirm a real generated set exists:

```bash
ls backend/data/sets/
```

You should see at least one directory (e.g. `set-2026-08-05-2gpz`) with `statut: complet` in its `set.json`. If none exists, generate one per the README (`POST /api/sets/generate`) — this costs real API quota, so prefer reusing an existing one.

Create a temporary scratch harness (deleted before committing — not part of this task's deliverable):

`frontend/src/exam/__harness__.jsx`:
```jsx
import React, { useState } from 'react';
import { preloadSetAudio, revokeAudioUrls } from './audioPreload';

const SET_ID = 'set-2026-08-05-2gpz'; // reemplaza por un id real de backend/data/sets/

export default function Harness() {
  const [log, setLog] = useState('');
  const [urls, setUrls] = useState(null);

  const run = async () => {
    setLog('cargando set...\n');
    const res = await fetch(`http://localhost:3001/api/sets/${SET_ID}`);
    const set = await res.json();
    const refs = set.sections.flatMap(s => s.items.map(i => i.ref));
    const result = await preloadSetAudio({
      setId: SET_ID,
      refs,
      onProgress: p => setLog(prev => prev + JSON.stringify(p) + '\n'),
    });
    setUrls(result.urls);
    setLog(prev => prev + `listo: ${result.urls.size} ok, ${result.failedRefs.length} fallidos\n`);
  };

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
      <button onClick={run}>Precargar</button>
      <button onClick={() => urls && revokeAudioUrls(urls)}>Revocar URLs</button>
      <pre>{log}</pre>
    </div>
  );
}
```

Temporarily edit `frontend/src/main.jsx` to render it instead of `App`:
```jsx
import Harness from './exam/__harness__.jsx';
// ...
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><Harness /></React.StrictMode>,
);
```

Run both servers (`cd backend && npm start` in one terminal, `cd frontend && npm run dev` in another), open the frontend URL, click "Precargar". Confirm: progress lines log up to `done === total` with `failedRefs: []`; the final line reports all items succeeded. In the browser console, sanity-check a real URL plays: `new Audio(document.querySelector('button')).play()` isn't needed — instead grab a URL from React DevTools or add a temporary `console.log([...urls.values()])` in the harness and paste one into `new Audio('blob:...').play()` in the console; confirm audible playback of real generated French audio.

Also verify the failure path: temporarily stop the backend mid-run (or use a bogus `SET_ID`) and confirm `failedRefs` gets populated instead of the promise hanging or throwing uncaught.

Revert `frontend/src/main.jsx` to its original contents and delete `frontend/src/exam/__harness__.jsx` once verified.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/exam/audioPreload.js
git commit -m "feat(exam): add audioPreload.js, bounded-concurrency audio fetch"
```

---

### Task 5: `setCompatibility.js` — the 32/36 contract gate

Pure and small — the check that rejects sets generated with `pilotes: true` (which carry 36 items/40 questions, not 32/36) before they ever reach preload.

**Files:**
- Create: `frontend/src/exam/setCompatibility.js`
- Create: `frontend/src/exam/setCompatibility.test.js`

**Interfaces:**
- Produces: `checkSetCompatibility(set) -> { ok: true } | { ok: false, reason: string }` where `reason` is a user-facing Spanish message.
- Read by Task 9 (`ExamMode.jsx`), called immediately after `GET /api/sets/:id` resolves, before any preload starts.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/exam/setCompatibility.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSetCompatibility } from './setCompatibility.js';

// Espeja la composición real de SET_STANDARD_36 (backend/src/examFormat.js):
// 32 ítems de audio, 36 preguntas en total.
const COMPOSITION = [
  { type: 'annonce_publique', items: 4, questionsPerItem: 1 },
  { type: 'repondeur', items: 6, questionsPerItem: 1 },
  { type: 'micro_trottoir', items: 6, questionsPerItem: 1 },
  { type: 'chronique', items: 2, questionsPerItem: 1 },
  { type: 'interview', items: 3, questionsPerItem: 2 },
  { type: 'reportage', items: 1, questionsPerItem: 2 },
  { type: 'divers', items: 10, questionsPerItem: 1 },
];

function validSet(overrides = {}) {
  const sections = COMPOSITION.map(({ type, items, questionsPerItem }) => ({
    type,
    items: Array.from({ length: items }, (_, i) => ({
      ref: `${type}-${i}`,
      questions: Array.from({ length: questionsPerItem }, () => ({ correctId: 'A' })),
    })),
  }));
  return { format: 'SET_STANDARD_36', pilotes: false, sections, ...overrides };
}

test('acepta un set 32/36 sin pilotos', () => {
  assert.deepEqual(checkSetCompatibility(validSet()), { ok: true });
});

test('rechaza un set con pilotos', () => {
  const result = checkSetCompatibility(validSet({ pilotes: true }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /pilotos/);
});

test('rechaza un formato distinto de SET_STANDARD_36', () => {
  const result = checkSetCompatibility(validSet({ format: 'SET_STANDARD_40' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /Formato/);
});

test('rechaza un set con menos de 32 ítems', () => {
  const set = validSet();
  set.sections[0].items = set.sections[0].items.slice(0, 1);
  const result = checkSetCompatibility(set);
  assert.equal(result.ok, false);
  assert.match(result.reason, /32/);
});

test('rechaza un set cuyo total de preguntas no da 36 aunque los ítems den 32', () => {
  const set = validSet();
  set.sections[4].items[0].questions.push({ correctId: 'B' }); // interview con 3 preguntas en vez de 2
  const result = checkSetCompatibility(set);
  assert.equal(result.ok, false);
  assert.match(result.reason, /preguntas/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test
```

Expected: FAIL — `setCompatibility.js` doesn't exist yet.

- [ ] **Step 3: Implement `setCompatibility.js`**

Create `frontend/src/exam/setCompatibility.js`:

```js
// Un set con pilotes:true agrega 4 ítems extra de una pregunta (ver
// backend/src/topics/planner.js) -- sigue reportando format:'SET_STANDARD_36'
// y, al completarse, statut:'complet', pero trae 36 ítems / 40 preguntas en
// vez de 32/36. Este runner está construido contra el contrato 32/36 en todas
// partes (progreso de precarga, conteos de sección, layout del resumen) y
// rechaza explícitamente lo que no lo cumpla, en vez de generalizarlo a
// medias -- puntuar ítems piloto le corresponde a una fase futura.
export function checkSetCompatibility(set) {
  if (set.format !== 'SET_STANDARD_36') {
    return { ok: false, reason: `Formato no soportado por este runner: "${set.format}".` };
  }
  if (set.pilotes) {
    return { ok: false, reason: 'Este set no es compatible con este runner (fue generado con pilotos).' };
  }
  const items = set.sections.flatMap(section => section.items);
  if (items.length !== 32) {
    return { ok: false, reason: `Este set tiene ${items.length} ítems de audio; este runner espera exactamente 32.` };
  }
  const questionCount = items.reduce((total, item) => total + item.questions.length, 0);
  if (questionCount !== 36) {
    return { ok: false, reason: `Este set tiene ${questionCount} preguntas; este runner espera exactamente 36.` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test
```

Expected: PASS, all tests across the three `.test.js` files green (23 total).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/setCompatibility.js frontend/src/exam/setCompatibility.test.js
git commit -m "feat(exam): add setCompatibility.js, the pilote-set rejection gate"
```

---

### Task 6: `SetPicker.jsx`

**Files:**
- Create: `frontend/src/exam/SetPicker.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SetPicker` — default-exported component, props `{ onSelect(setId: string): void }`. Fetches `GET /api/sets` itself (the only thing it fetches), filters to `statut === 'complet'`, renders its own loading/error/retry/empty states.
- Read by Task 9 (`ExamMode.jsx`), rendered during the `'picker'` phase.

- [ ] **Step 1: Implement `SetPicker.jsx`**

Create `frontend/src/exam/SetPicker.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';

const API_BASE = 'http://localhost:3001';

const SetPicker = ({ onSelect }) => {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sets`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSets(data.filter(set => set.statut === 'complet'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSets(); }, [loadSets]);

  if (loading) {
    return <div className="text-center py-10 text-blue-600">Cargando sets disponibles...</div>;
  }

  if (error) {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-red-600">No se pudo cargar la lista de sets: {error}</p>
        <button onClick={loadSets} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar</button>
      </div>
    );
  }

  if (sets.length === 0) {
    return (
      <p className="text-center py-10 text-gray-600">
        No hay sets listos todavía. Genera uno desde el backend (POST /api/sets/generate).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">Elige un set para el examen</h3>
      {sets.map(set => (
        <div key={set.id} className="flex items-center justify-between border rounded p-3">
          <div>
            <p className="font-semibold">{set.id}</p>
            <p className="text-sm text-gray-600">
              {set.difficulty ?? 'B2'} · {set.total} ítems · generado {new Date(set.genere_le).toLocaleString()}
            </p>
          </div>
          <button onClick={() => onSelect(set.id)} className="bg-blue-600 text-white px-4 py-2 rounded">
            Elegir
          </button>
        </div>
      ))}
    </div>
  );
};

export default SetPicker;
```

- [ ] **Step 2: Manual verification**

Using the same scratch-harness pattern as Task 4 (`frontend/src/exam/__harness__.jsx`, temporarily mounted from `main.jsx`, reverted after): render `<SetPicker onSelect={id => console.log('selected', id)} />` with both servers running. Confirm the real local sets appear (id, difficulty, item count, generation date). Click one, confirm the id logs to the console. Stop the backend and reload to confirm the error + "Reintentar" path; restart the backend and click "Reintentar" to confirm recovery.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/exam/SetPicker.jsx
git commit -m "feat(exam): add SetPicker.jsx"
```

---

### Task 7: `ExamSummary.jsx`

**Files:**
- Create: `frontend/src/exam/ExamSummary.jsx`

**Interfaces:**
- Consumes: the `correctBySection`/`correctTotal` shape produced by `computeResults` (Task 3).
- Produces: `ExamSummary` — default-exported component, props `{ correctTotal: number, totalQuestions: number, correctBySection: {[type]: number}, totalsBySection: {[type]: number}, onExit(): void }`.
- Read by Task 9 (`ExamMode.jsx`), rendered during the `'summary'` phase.

- [ ] **Step 1: Implement `ExamSummary.jsx`**

Create `frontend/src/exam/ExamSummary.jsx`:

```jsx
import React from 'react';

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const ExamSummary = ({ correctTotal, totalQuestions, correctBySection, totalsBySection, onExit }) => (
  <div className="space-y-4">
    <h2 className="text-2xl font-bold text-gray-800">Examen completado</h2>
    <div className="p-4 rounded bg-blue-50 border border-blue-200 text-center">
      <p className="text-3xl font-bold text-blue-800">{correctTotal} / {totalQuestions}</p>
      <p className="text-sm text-blue-700">respuestas correctas</p>
    </div>
    <div className="space-y-2">
      {Object.keys(SECTION_LABELS).map(sectionType => (
        totalsBySection[sectionType] != null && (
          <div key={sectionType} className="flex items-center justify-between border rounded p-3">
            <span>{SECTION_LABELS[sectionType]}</span>
            <span className="font-semibold">{correctBySection[sectionType] ?? 0} / {totalsBySection[sectionType]}</span>
          </div>
        )
      ))}
    </div>
    <button onClick={onExit} className="w-full bg-blue-600 text-white py-2 rounded">
      Volver a la lista de sets
    </button>
  </div>
);

export default ExamSummary;
```

- [ ] **Step 2: Manual verification**

Using the scratch-harness pattern, render with fabricated props, e.g.:
```jsx
<ExamSummary
  correctTotal={20} totalQuestions={36}
  correctBySection={{ annonce_publique: 3, interview: 4 }}
  totalsBySection={{ annonce_publique: 4, repondeur: 6, micro_trottoir: 6, chronique: 2, interview: 6, reportage: 2, divers: 10 }}
  onExit={() => console.log('exit')}
/>
```
Confirm all 7 section rows render with correct/total, the top number matches `correctTotal`/`totalQuestions`, and clicking the exit button logs.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/exam/ExamSummary.jsx
git commit -m "feat(exam): add ExamSummary.jsx"
```

---

### Task 8: `ExamRunner.jsx` — the lockstep engine

The largest task: wires `examMachine`/`examTiming` to real DOM (a shared `<audio>` element, `setInterval` ticks, `setTimeout` watchdog) and renders each phase. This is where the deadline-chaining rule from `examTiming.js` gets applied at the one call site where it matters (advancing from one item's `apres` directly into the next item's `avant`, within the same section).

**Files:**
- Create: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- Consumes: `createInitialState`, `reducer`, `currentToken`, `computeResults` from `examMachine.js` (Task 3); `startPhase`, `remainingSeconds`, `isExpired`, `chainDeadline` from `examTiming.js` (Task 2).
- Produces: `ExamRunner` — default-exported component, props `{ set, audioElRef: React.RefObject<HTMLAudioElement>, audioUrls: Map<string,string>, onComplete(results): void, onAbandon(): void }`. `audioElRef` must point to a `<audio>` element already mounted and unlocked by the caller (Task 9) — `ExamRunner` never creates its own `<audio>` element, so the same one is reused for every item.
- Read by Task 9 (`ExamMode.jsx`), mounted only during the `'running'` phase.

Note on `interview`/`reportage` option rendering: native `<select>`/`<option>` elements don't reliably wrap long option text across browsers (some truncate or force horizontal scroll in the open list), which would violate the requirement that every answer stay fully readable. `ExamRunner` renders a small custom listbox (`OptionSelect`, defined in this same file) for those two sections instead — visually a closed button that expands into a list of full-width, wrapping options, matching the intended "compact until opened" UX without the native element's wrapping limitation.

- [ ] **Step 1: Implement `ExamRunner.jsx`**

Create `frontend/src/exam/ExamRunner.jsx`:

```jsx
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, currentToken, computeResults } from './examMachine';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from './examTiming';

const TICK_MS = 250;
const WATCHDOG_GRACE_MS = 1000;

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const SELECT_SECTIONS = new Set(['interview', 'reportage']);

// Listbox propio en vez de <select> nativo: el texto de las opciones largas
// no envuelve de forma confiable dentro de un <option> en todos los
// navegadores, y necesitamos que las 2 preguntas de interview/reportage
// quepan visibles a la vez sin truncar ninguna respuesta.
const OptionSelect = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const selected = options.find(opt => opt.id === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full text-left border rounded px-3 py-2 bg-white"
      >
        {selected
          ? <span><span className="font-bold mr-2">{selected.id})</span>{selected.text}</span>
          : 'Elige una respuesta'}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full border rounded bg-white shadow-lg max-h-64 overflow-y-auto">
          {options.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className="block w-full text-left p-3 hover:bg-blue-50 whitespace-normal"
            >
              <span className="font-bold mr-2">{opt.id})</span>{opt.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ExamRunner = ({ set, audioElRef, audioUrls, onComplete, onAbandon }) => {
  const [state, dispatch] = useReducer((s, e) => reducer(set, s, e), undefined, createInitialState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const phaseTimingRef = useRef(null);
  const lastApresPhaseTimingRef = useRef(null);
  const watchdogRef = useRef(null);
  const [remaining, setRemaining] = useState(0);

  const section = set.sections[state.sectionIndex];
  const item = section?.items?.[state.itemIndex];

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Arranca/reancla el deadline de avant o apres al entrar a esa fase. Para
  // avant, si viene de un apres de la MISMA sección (avance normal
  // ítem-a-ítem), encadena desde el deadline teórico de ese apres en vez de
  // "ahora" -- así el tick que detectó el vencimiento (hasta TICK_MS tarde)
  // no filtra slop al ítem siguiente. Tras una transición de sección
  // (clic en Continuar) o en el primer ítem, arranca fresco desde "ahora".
  useEffect(() => {
    if (state.status !== 'running' || !section) return;
    if (state.phase === 'avant') {
      phaseTimingRef.current = lastApresPhaseTimingRef.current
        ? chainDeadline(lastApresPhaseTimingRef.current, section.timing.avant)
        : startPhase(section.timing.avant);
      lastApresPhaseTimingRef.current = null;
      setRemaining(remainingSeconds(phaseTimingRef.current));
    } else if (state.phase === 'apres') {
      // La fase apres arranca del instante REAL en que terminó el audio
      // (AUDIO_ENDED o el watchdog), no de una duración programada.
      phaseTimingRef.current = startPhase(section.timing.apres);
      setRemaining(remainingSeconds(phaseTimingRef.current));
    }
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status, section]);

  // Tick de las fases con reloj (avant / apres): nunca acumula drift dentro
  // de la fase, porque remainingSeconds siempre recalcula desde el deadline.
  useEffect(() => {
    if (state.status !== 'running') return;
    if (state.phase !== 'avant' && state.phase !== 'apres') return;

    const interval = setInterval(() => {
      const timing = phaseTimingRef.current;
      if (!timing) return;
      setRemaining(remainingSeconds(timing));
      if (isExpired(timing)) {
        if (state.phase === 'apres') lastApresPhaseTimingRef.current = timing;
        dispatch({ type: 'TIMER_EXPIRED', token: currentToken(stateRef.current) });
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status]);

  // Arranca la reproducción al entrar a audio-pending. Nunca asume que
  // play() tuvo éxito: solo dispara AUDIO_PLAYING cuando la promesa resuelve.
  useEffect(() => {
    if (state.phase !== 'audio-pending' || !item) return;
    const audioEl = audioElRef.current;
    const token = currentToken(state);
    audioEl.src = audioUrls.get(item.ref);
    audioEl.play().then(
      () => dispatch({ type: 'AUDIO_PLAYING', token }),
      () => dispatch({ type: 'AUDIO_FAILED', token }),
    );
  }, [state.phase, state.sectionIndex, state.itemIndex, audioElRef, audioUrls, item]);

  // Arma el watchdog solo tras confirmar reproducción real.
  useEffect(() => {
    if (state.phase !== 'audio-playing' || !item) return;
    const token = currentToken(state);
    watchdogRef.current = setTimeout(() => {
      dispatch({ type: 'TIMER_EXPIRED', token });
    }, item.duree_audio_s * 1000 + WATCHDOG_GRACE_MS);
    return clearWatchdog;
  }, [state.phase, state.sectionIndex, state.itemIndex, item, clearWatchdog]);

  // Escucha 'ended' del elemento de audio compartido durante toda la corrida.
  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onEnded = () => {
      if (stateRef.current.phase !== 'audio-playing') return;
      clearWatchdog();
      dispatch({ type: 'AUDIO_ENDED', token: currentToken(stateRef.current) });
    };
    audioEl.addEventListener('ended', onEnded);
    return () => audioEl.removeEventListener('ended', onEnded);
  }, [audioElRef, clearWatchdog]);

  useEffect(() => {
    if (state.status === 'complete') onComplete(computeResults(set, state.answers));
    if (state.status === 'abandoned') onAbandon();
  }, [state.status, set, state.answers, onComplete, onAbandon]);

  const handleAnswer = (questionIndex, optionId) => {
    dispatch({ type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex, optionId });
  };

  const handleAbandon = () => {
    if (!window.confirm('¿Seguro que quieres abandonar el examen? Se perderá todo el progreso.')) return;
    dispatch({ type: 'ABANDON' });
  };

  const handleSectionContinue = () => {
    lastApresPhaseTimingRef.current = null; // cruzar de sección siempre arranca fresco, no encadenado
    dispatch({ type: 'SECTION_CONTINUE' });
  };

  const handleRetryAudio = () => {
    dispatch({ type: 'RETRY_AUDIO', token: currentToken(state) });
  };

  if (state.status !== 'running') return null;

  if (state.phase === 'section-transition') {
    const nextSection = set.sections[state.sectionIndex + 1];
    return (
      <div className="space-y-4 text-center py-10">
        <h3 className="text-xl font-bold">Sección siguiente: {SECTION_LABELS[nextSection.type]}</h3>
        <p className="text-gray-600">{nextSection.items.length} ítems</p>
        <button onClick={handleSectionContinue} className="bg-blue-600 text-white px-6 py-2 rounded">
          Continuar
        </button>
      </div>
    );
  }

  if (state.phase === 'audio-failed') {
    return (
      <div className="space-y-4 text-center py-10">
        <p className="text-red-600">No se pudo reproducir el audio.</p>
        <button onClick={handleRetryAudio} className="bg-blue-600 text-white px-6 py-2 rounded">Reintentar</button>
        <button onClick={handleAbandon} className="block mx-auto text-sm text-gray-500 hover:underline">Abandonar</button>
      </div>
    );
  }

  if (!item) return null;

  const questions = item.questions;
  const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
  const useSelect = SELECT_SECTIONS.has(section.type);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{SECTION_LABELS[section.type]} · ítem {state.itemIndex + 1}/{section.items.length}</span>
        <button onClick={handleAbandon} className="text-red-600 hover:underline">Abandonar</button>
      </div>

      <div className="text-center text-4xl font-mono text-red-600">
        00:{remaining.toString().padStart(2, '0')}
      </div>

      {state.phase === 'audio-pending' && <p className="text-center text-blue-600">Preparando audio...</p>}
      {state.phase === 'audio-playing' && <p className="text-center text-blue-600">Escuchando...</p>}

      <div className="space-y-6">
        {questions.map((question, questionIndex) => (
          <div key={questionIndex} className="border rounded p-4 space-y-2">
            <h3 className="font-bold">{question.prompt}</h3>
            {useSelect ? (
              <OptionSelect
                options={question.options}
                value={itemAnswers[questionIndex]}
                onChange={optionId => handleAnswer(questionIndex, optionId)}
              />
            ) : (
              question.options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleAnswer(questionIndex, opt.id)}
                  className={`w-full text-left p-3 border rounded hover:bg-blue-100 ${itemAnswers[questionIndex] === opt.id ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200' : ''}`}
                >
                  <span className="font-bold mr-2">{opt.id})</span>{opt.text}
                </button>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExamRunner;
```

- [ ] **Step 2: Manual verification with a real local set**

Using the scratch-harness pattern from Task 4, create a temporary `frontend/src/exam/__harness__.jsx` that fetches a real local set, calls `preloadSetAudio`, unlocks a persistent `<audio>` element with a button click, then mounts `ExamRunner`:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { preloadSetAudio } from './audioPreload';
import ExamRunner from './ExamRunner';

const SET_ID = 'set-2026-08-05-2gpz'; // reemplaza por un id real de backend/data/sets/

export default function Harness() {
  const audioElRef = useRef(null);
  const [set, setSet] = useState(null);
  const [audioUrls, setAudioUrls] = useState(null);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`http://localhost:3001/api/sets/${SET_ID}`);
      const data = await res.json();
      setSet(data);
      const refs = data.sections.flatMap(s => s.items.map(i => i.ref));
      const { urls } = await preloadSetAudio({ setId: SET_ID, refs });
      setAudioUrls(urls);
    })();
  }, []);

  const unlock = async () => {
    const el = audioElRef.current;
    el.muted = true;
    await el.play();
    el.pause();
    el.muted = false;
    setUnlocked(true);
  };

  return (
    <div style={{ maxWidth: 600, margin: '40px auto' }}>
      <audio ref={audioElRef} />
      {!unlocked && audioUrls && <button onClick={unlock}>Comenzar (desbloquear audio)</button>}
      {unlocked && set && audioUrls && (
        <ExamRunner
          set={set}
          audioElRef={audioElRef}
          audioUrls={audioUrls}
          onComplete={r => console.log('COMPLETE', r)}
          onAbandon={() => console.log('ABANDONED')}
        />
      )}
    </div>
  );
}
```

Mount it from `main.jsx` as in Task 4. With both servers running, click "Comenzar", then verify against the real 7-item set:
- `avant` shows the question(s) and options, counts down, then audio autoplays with no visible controls.
- The countdown display stays smooth across the `avant → audio → apres` transitions (no visible jump backward or a long freeze).
- Selecting/changing an answer works during any phase before the item ends.
- If the set includes an `interview` or `reportage` item, both its questions render together with the custom dropdown, and long option text is fully readable when the dropdown is open.
- Letting `apres` expire without answering advances to the next item; letting it expire after answering keeps the answer (confirmed later via the logged `onComplete` payload if you run through the whole 7-item set).
- The last item logs `onComplete` with a `results` object containing `correctTotal`, `correctBySection` (all sections that appeared), and `answers`.
- Clicking "Abandonar" asks for confirmation and, on confirming, logs `ABANDONED`.
- In DevTools → Network, throttle to "Offline" right as an item enters `audio-pending` (or temporarily rename the served file) to force a `play()`/decoding failure, and confirm the "No se pudo reproducir el audio" state appears with a working "Reintentar" — never a countdown that silently continues.

Revert `main.jsx` and delete `__harness__.jsx` once verified.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): add ExamRunner.jsx, the lockstep engine"
```

---

### Task 9: `ExamMode.jsx` — top-level orchestration

Owns the phase that spans everything from picking a set to seeing the summary: fetching set detail, the compatibility gate, preload with retry, the autoplay-unlock step, and composing `SetPicker`/`ExamRunner`/`ExamSummary`. Also the sole owner of the persistent `<audio>` element `ExamRunner` reuses for every item.

**Files:**
- Create: `frontend/src/exam/ExamMode.jsx`

**Interfaces:**
- Consumes: `SetPicker` (Task 6), `ExamRunner` (Task 8), `ExamSummary` (Task 7), `checkSetCompatibility` (Task 5), `preloadSetAudio`/`revokeAudioUrls` (Task 4).
- Produces: `ExamMode` — default-exported component, props `{ onActiveChange(isActive: boolean): void }`. Calls `onActiveChange(true)` while the phase is `'preloading'`, `'unlock'`, or `'running'` (an attempt worth guarding against silent loss), `false` otherwise.
- Read by Task 10 (`App.jsx`).

- [ ] **Step 1: Implement `ExamMode.jsx`**

Create `frontend/src/exam/ExamMode.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import SetPicker from './SetPicker';
import ExamRunner from './ExamRunner';
import ExamSummary from './ExamSummary';
import { checkSetCompatibility } from './setCompatibility';
import { preloadSetAudio, revokeAudioUrls } from './audioPreload';

const API_BASE = 'http://localhost:3001';
const ACTIVE_PHASES = new Set(['preloading', 'unlock', 'running']);
const GUARDED_PHASES = new Set(['preloading', 'unlock', 'running', 'summary']);

const ExamMode = ({ onActiveChange }) => {
  const [phase, setPhase] = useState('picker');
  const [setId, setSetId] = useState(null);
  const [setDetail, setSetDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [compatError, setCompatError] = useState(null);
  const [preloadProgress, setPreloadProgress] = useState({ done: 0, total: 0 });
  const [failedRefs, setFailedRefs] = useState([]);
  const [results, setResults] = useState(null);

  const audioElRef = useRef(null);
  const audioUrlsRef = useRef(new Map());
  const preloadAbortRef = useRef(null);

  useEffect(() => {
    onActiveChange?.(ACTIVE_PHASES.has(phase));
  }, [phase, onActiveChange]);

  useEffect(() => {
    if (!GUARDED_PHASES.has(phase)) return undefined;
    const handler = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  const resetAudio = useCallback(() => {
    revokeAudioUrls(audioUrlsRef.current);
    audioUrlsRef.current = new Map();
    setFailedRefs([]);
    setPreloadProgress({ done: 0, total: 0 });
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
      audioElRef.current.load();
    }
  }, []);

  const goToPicker = useCallback(() => {
    preloadAbortRef.current?.abort();
    resetAudio();
    setSetId(null);
    setSetDetail(null);
    setLoadError(null);
    setCompatError(null);
    setResults(null);
    setPhase('picker');
  }, [resetAudio]);

  // Recibe `id` como parámetro en vez de leer el estado `setId` por clausura:
  // handleSelect llama a esto en el mismo tick que setSetId(chosenId), antes
  // de que React re-renderice, así que un runPreload cerrado sobre el estado
  // vería todavía el setId ANTERIOR (null en la primera selección).
  const runPreload = useCallback(async (refs, id) => {
    preloadAbortRef.current = new AbortController();
    setPhase('preloading');
    const { urls, failedRefs: failed } = await preloadSetAudio({
      setId: id,
      refs,
      signal: preloadAbortRef.current.signal,
      onProgress: setPreloadProgress,
    });
    for (const [ref, url] of urls) audioUrlsRef.current.set(ref, url);
    if (failed.length > 0) {
      setFailedRefs(failed);
      setPhase('preload-failed');
    } else {
      setFailedRefs([]);
      setPhase('unlock');
    }
  }, []);

  const handleSelect = useCallback(async (chosenId) => {
    setSetId(chosenId);
    setPhase('loading');
    try {
      const res = await fetch(`${API_BASE}/api/sets/${chosenId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const compatibility = checkSetCompatibility(data);
      if (!compatibility.ok) {
        setCompatError(compatibility.reason);
        setPhase('incompatible');
        return;
      }
      setSetDetail(data);
      const refs = data.sections.flatMap(section => section.items.map(item => item.ref));
      await runPreload(refs, chosenId);
    } catch (error) {
      setLoadError(error.message);
      setPhase('loading-error');
    }
  }, [runPreload]);

  const handleRetryFailed = useCallback(() => {
    runPreload(failedRefs, setId);
  }, [runPreload, failedRefs, setId]);

  const handleUnlock = useCallback(async () => {
    const audioEl = audioElRef.current;
    audioEl.muted = true;
    try {
      await audioEl.play();
      audioEl.pause();
    } finally {
      audioEl.muted = false;
      audioEl.currentTime = 0;
    }
    setPhase('running');
  }, []);

  const handleComplete = useCallback((finalResults) => {
    setResults(finalResults);
    setPhase('summary');
  }, []);

  const totalsBySection = setDetail
    ? Object.fromEntries(
        setDetail.sections.map(s => [s.type, s.items.reduce((n, i) => n + i.questions.length, 0)]),
      )
    : {};

  if (phase === 'picker') return <SetPicker onSelect={handleSelect} />;

  if (phase === 'loading') {
    return <div className="text-center py-10 text-blue-600">Cargando set...</div>;
  }

  if (phase === 'loading-error') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-red-600">No se pudo cargar el set: {loadError}</p>
        <button onClick={() => handleSelect(setId)} className="bg-blue-600 text-white px-4 py-2 rounded">
          Reintentar
        </button>
        <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">
          Volver a la lista
        </button>
      </div>
    );
  }

  if (phase === 'incompatible') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-amber-700">{compatError}</p>
        <button onClick={goToPicker} className="bg-blue-600 text-white px-4 py-2 rounded">
          Volver a la lista
        </button>
      </div>
    );
  }

  return (
    <div>
      <audio ref={audioElRef} style={{ display: 'none' }} />

      {phase === 'preloading' && (
        <div className="text-center py-10 space-y-2">
          <p className="text-blue-600">Preparando examen... {preloadProgress.done}/{preloadProgress.total}</p>
        </div>
      )}

      {phase === 'preload-failed' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-red-600">No se pudieron descargar {failedRefs.length} audio(s).</p>
          <button onClick={handleRetryFailed} className="bg-blue-600 text-white px-4 py-2 rounded">
            Reintentar fallidos
          </button>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">
            Volver a la lista
          </button>
        </div>
      )}

      {phase === 'unlock' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-green-700">Audio listo.</p>
          <button onClick={handleUnlock} className="bg-blue-600 text-white px-6 py-3 rounded text-lg">
            Comenzar examen
          </button>
        </div>
      )}

      {phase === 'running' && setDetail && (
        <ExamRunner
          set={setDetail}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onComplete={handleComplete}
          onAbandon={goToPicker}
        />
      )}

      {phase === 'summary' && results && (
        <ExamSummary
          correctTotal={results.correctTotal}
          totalQuestions={Object.values(totalsBySection).reduce((a, b) => a + b, 0)}
          correctBySection={results.correctBySection}
          totalsBySection={totalsBySection}
          onExit={goToPicker}
        />
      )}
    </div>
  );
};

export default ExamMode;
```

- [ ] **Step 2: Manual verification**

Using the scratch-harness pattern, temporarily mount `<ExamMode onActiveChange={active => console.log('active:', active)} />` from `main.jsx`. With both servers running:

- Confirm the picker lists the real local sets, and selecting one of the existing 7-item sets (`pilotes: false` but only 7 items, not 32) correctly lands on the `'incompatible'` phase with a message mentioning "32" — this is the real rejection path, verified against real data without needing a full 36-question generation.
- Confirm `console.log('active:', ...)` never fires `true` while stuck on `'incompatible'`/`'loading-error'`/`'picker'`.
- To verify the accept path end-to-end (preload → unlock → running → summary) against a real, fully compatible 32-item/36-question set, you need one generated with `pilotes` left at its default (`false`) and no reduced item count — i.e. a real `POST /api/sets/generate` run through to completion. **This costs real API quota; confirm with the user before running it**, the same way the small 7-item test set was generated in the previous slice. If generating one isn't practical right now, this task's coverage of the accept path rests on: `ExamRunner` already having been verified end-to-end in Task 8 (it doesn't know or care about item counts — the 32/36 check lives only in `setCompatibility.js`, which has its own full test coverage from Task 5) plus a code read-through of `ExamMode`'s `'preloading'` → `'unlock'` → `'running'` → `'summary'` wiring.
- If a full set is generated: run the whole flow, confirm the preload progress counter reaches the total, "Comenzar examen" appears, clicking it plays the first item's audio, the run proceeds through all 7 sections with transition screens in between, and the summary shows correct totals matching what you actually answered.

Revert `main.jsx` once verified.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/exam/ExamMode.jsx
git commit -m "feat(exam): add ExamMode.jsx, top-level exam flow orchestration"
```

---

### Task 10: Wire `App.jsx` — mode switcher with abandon guard

**Files:**
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `TrainingMode` (Task 1), `ExamMode` (Task 9).

- [ ] **Step 1: Replace `App.jsx`**

Replace the entire contents of `frontend/src/App.jsx` with:

```jsx
import React, { useState } from 'react';
import TrainingMode from './TrainingMode';
import ExamMode from './exam/ExamMode';

const App = () => {
  const [mode, setMode] = useState('training');
  const [examActive, setExamActive] = useState(false);

  return (
    <div>
      <div className="max-w-2xl mx-auto mt-4 flex gap-2 px-6">
        <button
          onClick={() => setMode('training')}
          disabled={examActive}
          className={`px-4 py-2 rounded ${mode === 'training' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Entrenamiento
        </button>
        <button
          onClick={() => setMode('exam')}
          disabled={examActive && mode !== 'exam'}
          className={`px-4 py-2 rounded ${mode === 'exam' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Modo Examen
        </button>
      </div>
      {mode === 'training' ? <TrainingMode /> : <ExamMode onActiveChange={setExamActive} />}
    </div>
  );
};

export default App;
```

Both buttons disable while `examActive` is true and the user isn't already looking at exam mode — the only way to leave a running attempt is "Abandonar" inside `ExamMode`, which sets `examActive` back to `false` via `onActiveChange` and re-enables the switch.

- [ ] **Step 2: Manual verification**

```bash
cd backend && npm start   # terminal 1
cd frontend && npm run dev   # terminal 2
```

Open the frontend URL. Confirm:
- Both mode buttons are visible and clickable at rest; "Entrenamiento" is active by default and training mode works exactly as before.
- Clicking "Modo Examen" shows the picker.
- Select one of the real 7-item sets; once it reaches a phase in `{'preloading','unlock','running'}` (or immediately, if it lands on `'incompatible'` — in which case skip ahead and confirm the switch is NOT disabled there, since `'incompatible'` isn't a guarded phase), confirm the "Entrenamiento" button becomes disabled if you reach `'preloading'`/`'unlock'`/`'running'` (use a compatible-but-artificially-truncated local check, or reason through the code, if no full 36-question set is available — see Task 9's note on generating one).
- From `'incompatible'`, click "Volver a la lista" and confirm both buttons are enabled again and "Entrenamiento" switches cleanly.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): wire ExamMode into App.jsx with a guarded mode switch"
```

---

### Task 11: Documentation and final verification pass

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update `CLAUDE.md`'s Project paragraph**

Find this exact text in the "Project" section:

```
TEFAQ (French listening exam for Quebec) simulator. An Express backend generates exam content with LLMs and synthesizes audio; a React/Vite frontend runs the timed training simulation. Two modes share the same generation core: a single-question **training mode** (unchanged, served by the frontend) and a **Modo Examen** pipeline that generates and persists full 36-question exam sets to disk (backend-only so far — no frontend runner yet). No linter or type checking exists; the backend has a `node --test` suite (149 tests) but the frontend has none — verify frontend changes by running the app.
```

Replace it with:

```
TEFAQ (French listening exam for Quebec) simulator. An Express backend generates exam content with LLMs and synthesizes audio; a React/Vite frontend runs the timed training simulation. Two modes share the same generation core: a single-question **training mode** (`TrainingMode.jsx`, unchanged behavior) and a **Modo Examen** pipeline that generates and persists full 36-question exam sets to disk, played back by a lockstep frontend runner (`frontend/src/exam/`) that consumes already-generated sets — it does not trigger generation itself. No linter or type checking exists; the backend has a `node --test` suite (149 tests), and the frontend now has one too (`frontend/src/exam/*.test.js`, run via `cd frontend && npm test`) covering the runner's two pure modules (`examTiming.js`, `examMachine.js`) — everything else in the frontend is still verified by running the app.
```

- [ ] **Step 2: Add a Frontend architecture paragraph for `exam/`**

Find this exact text at the start of the "Frontend architecture" section:

```
`src/App.jsx` is the entire UI: one component driving a `phase` state machine — `idle → loading → (scanPractice | scanning → reading → answering | feedback)`. `scanPractice` is the "solo lectura rápida" mode: it skips audio and scoring entirely and can hand off into `reading` via `continueScanPracticeToFull`.
```

Replace it with:

```
`src/App.jsx` is now a thin shell: a mode switcher between `TrainingMode.jsx` (training) and `exam/ExamMode.jsx` (Modo Examen), disabled while an exam attempt is active so it can't be discarded silently. `TrainingMode.jsx` is the entire training UI: one component driving a `phase` state machine — `idle → loading → (scanPractice | scanning → reading → answering | feedback)`. `scanPractice` is the "solo lectura rápida" mode: it skips audio and scoring entirely and can hand off into `reading` via `continueScanPracticeToFull`.

`exam/` holds the Modo Examen runner, kept deliberately separate from training mode (no shared state, no shared audio-control UI — exam audio is autoplay-only). `ExamMode.jsx` owns the top-level flow (`picker → loading → incompatible → preloading → preload-failed → unlock → running → summary`) and the persistent `<audio>` element reused for every item's playback. `examMachine.js` is a pure reducer (`(set, state, event) -> nextState`) driving the per-item lockstep (`avant → audio-pending → audio-playing → apres`, plus `section-transition` between the 7 sections) — every async-originated event carries a `{sectionIndex, itemIndex, phase}` token so a stale callback (a late audio-end after a watchdog already fired, or vice versa) is a no-op instead of double-advancing. `examTiming.js` anchors phase countdowns to absolute deadlines rather than decrementing a counter, and chains a new item's deadline from the previous phase's deadline (not the live clock) so per-transition scheduling slop can't compound over a 40-minute run. Both are unit-tested; `ExamRunner.jsx`/`ExamMode.jsx`/`SetPicker.jsx`/`ExamSummary.jsx` are browser-verified only. `setCompatibility.js` rejects sets generated with `pilotes: true` (36 items/40 questions, not this runner's 32/36 contract) before preload starts.
```

- [ ] **Step 3: Update `README.md`'s Modo Examen section**

Find this exact text:

```
Además del modo entrenamiento (una pregunta a la vez), el backend puede generar y persistir **sets de examen completos** — 36 preguntas repartidas en las 7 secciones oficiales generables (annonce_publique, répondeur, micro-trottoir, chronique, interview, reportage, divers; conversation_image queda pendiente para una fase futura). Es un proceso de disco, sin frontend propio todavía — se opera vía HTTP.
```

Replace it with:

```
Además del modo entrenamiento (una pregunta a la vez), el backend puede generar y persistir **sets de examen completos** — 36 preguntas repartidas en las 7 secciones oficiales generables (annonce_publique, répondeur, micro-trottoir, chronique, interview, reportage, divers; conversation_image queda pendiente para una fase futura). La generación sigue siendo un proceso de disco que se dispara vía HTTP; para *tomar* un set ya generado, el frontend tiene un modo aparte (ver abajo).
```

Then, immediately after the existing bullet list and before the "El plan temático..." paragraph in that same section, add:

```
### Tomar un set generado (frontend)

Desde la pantalla inicial del frontend, el switch superior cambia a **Modo Examen**: lista los sets con `statut: 'complet'`, valida que sean compatibles con el runner (formato `SET_STANDARD_36`, sin pilotos, 32 ítems / 36 preguntas — un set generado con `pilotes: true` se rechaza explícitamente, con un mensaje claro, antes de precargar nada), precarga los 32 audios, y corre el examen en lockstep: lectura antes de cada audio, reproducción automática sin controles (ni pausa, ni repetir, ni velocidad), tiempo para responder, sin pausa ni retroceso entre preguntas, con una pantalla corta entre las 7 secciones. Al terminar muestra un resumen crudo (aciertos por sección y total) — el puntaje estimado /699 y el análisis detallado quedan para una fase futura. No hay reanudación: cerrar la pestaña o pulsar "Abandonar" descarta el intento completo, sin guardar nada.
```

- [ ] **Step 4: Full manual verification pass**

```bash
cd backend && npm test    # confirm the backend suite is still green, unaffected by this slice
cd frontend && npm test   # confirm examTiming.test.js / examMachine.test.js / setCompatibility.test.js all pass
```

With both servers running, walk through the whole app once more end-to-end:
- Training mode: unchanged, works as it always has (this was verified in Task 1, but re-confirm now that `App.jsx` also carries the mode switch).
- Modo Examen: picker → select an incompatible 7-item local set → confirm the rejection message and "Volver a la lista" → confirm no leftover disabled buttons or console errors after returning.
- If a full 36-question set was generated during Task 9's verification (or is generated now, with the user's confirmation given the API cost), run one complete attempt from picker through summary, confirming the raw score shown matches what was actually answered.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document the Modo Examen frontend runner"
```
