# Revisión Post-Examen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an untimed, in-memory post-exam review screen — re-listen to any item's audio, see the transcript with its justification highlighted, see per-question correctness and feedback — reachable from `ExamSummary`.

**Architecture:** Two new pure, unit-tested modules (`reviewModel.js` for correctness/counting, `highlightSegments.js` for locating justifications in transcripts) feed a new presentational component (`ExamReview.jsx`). `ExamMode.jsx` gains a `review` phase and stops releasing audio the instant the exam completes; `ExamSummary.jsx` gains one button.

**Tech Stack:** React 18 (existing), Node 22's built-in `node --test` (existing pattern from `examTiming.js`/`examMachine.js`/`setCompatibility.js`/`examScoring.js`).

**Design spec:** `docs/superpowers/specs/2026-08-06-exam-review-design.md` — read it once before starting; this plan implements it exactly, including the post-review revisions (playback state machine, `stopPlayback()` ownership, overlap-safe justification segments, normalized matching with a position map, two-level header hierarchy, explicit answer states).

## Global Constraints

- No backend changes. `ExamReview` receives everything it needs as props from `ExamMode` — no new fetches.
- `reviewModel.js` and `highlightSegments.js` are pure (no DOM, no side effects) and unit-tested with `node --test`. `ExamReview.jsx` and the `ExamMode.jsx`/`ExamSummary.jsx` changes stay browser-verified only, consistent with every other UI component in this project.
- `ExamRunner.jsx`, `examMachine.js`, `examTiming.js`, `audioPreload.js`, `setCompatibility.js` are **not modified** by this plan.
- Audio blob URLs stay alive through `summary` and `review`; release happens only via `goToPicker` (unchanged) and the existing unmount safety-net effect (unchanged). `review` is **not** added to `ACTIVE_PHASES` or `GUARDED_PHASES`.
- Playback: the shared `<audio>` element (owned by `ExamMode`, passed down via `audioElRef`) is controlled with a real state machine (`{ activeRef, status: 'idle'|'playing'|'error', error }`), driven by the element's actual `playing`/`ended`/`error` events plus `play()`'s rejection — never a bare boolean or an assumption that `play()` always succeeds. The playback button is never disabled; its label reflects real state ("Reproducir" / "Reiniciar").
- `stopPlayback()` (pause, clear `src`, `.load()` — **never** revokes object URLs) is owned by `ExamReview` and runs on its own unmount cleanup, plus explicitly before calling `onBackToSummary`/`onExit`.
- Justification matching normalizes the same way the backend does (`validation/frenchWords.js`'s `normalizeText`: diacritics stripped, punctuation/whitespace collapsed, lowercased) — not just case-insensitive — with a position map back to the original transcript string. Only the first occurrence of each justification is matched. Overlapping/adjacent/identical justification spans are resolved by construction (`buildHighlightSegments` returns whole-transcript segments each carrying a `questionIndexes: number[]` array), never assumed impossible.
- A justification that isn't found (even after normalization) is shown separately, explicitly labeled as not verbatim — never force-highlighted, dropped, or styled as a blockquote.
- Every option renders one of exactly these labeled states: "Tu respuesta — correcta", "Respuesta correcta", "Tu respuesta — incorrecta", or no label (neither correct nor chosen) — plus an explicit "Sin respuesta" notice on the question when unanswered. Never color alone.
- Header hierarchy is two levels: section ("{label} — {correctCount}/{questionCount} correctas") containing items ("Audio {n}/{total} — {correctCount}/{questionCount} correctas") — never one ambiguous flat count.
- Grouped by audio item (32), not flat by question (36) — `interview`/`reportage` items keep their 2 questions under one shared player/transcript.

---

### Task 1: `reviewModel.js` — per-question/item/section correctness

**Files:**
- Create: `frontend/src/exam/reviewModel.js`
- Create: `frontend/src/exam/reviewModel.test.js`

**Interfaces:**
- Produces: `buildReviewModel(set, answers) -> { sections: [{ type, correctCount, questionCount, items: [{ ref, correctCount, questionCount, questions: [{ questionIndex, selectedId, correctId, answered, isCorrect }] }] }] }`. `set` is the real backend set shape (`set.sections[].type`, `.items[].ref`, `.items[].questions[].correctId`); `answers` is `results.answers` from `examMachine.js`'s `computeResults` (`{ [sectionType]: { [ref]: { [questionIndex]: optionId } } }`).
- Read by Task 3 (`ExamReview.jsx`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/exam/reviewModel.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewModel } from './reviewModel.js';

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

test('pregunta correcta: answered true, isCorrect true', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'A' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.answered, true);
  assert.equal(q.isCorrect, true);
  assert.equal(q.selectedId, 'A');
  assert.equal(q.correctId, 'A');
});

test('pregunta incorrecta: answered true, isCorrect false', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.answered, true);
  assert.equal(q.isCorrect, false);
});

test('pregunta sin responder: answered false, isCorrect false, distinto de una respuesta incorrecta', () => {
  const set = fixtureSet();
  const model = buildReviewModel(set, {});
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.answered, false);
  assert.equal(q.isCorrect, false);
  assert.equal(q.selectedId, null);
});

test('ítem de una pregunta: correctCount/questionCount del ítem', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'A' }, s1i2: { 0: 'X' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].correctCount, 1);
  assert.equal(model.sections[0].items[0].questionCount, 1);
  assert.equal(model.sections[0].items[1].correctCount, 0);
});

test('ítem de dos preguntas (interview): correctCount cuenta ambas preguntas', () => {
  const set = fixtureSet();
  const answers = { interview: { s2i1: { 0: 'A', 1: 'X' } } };
  const model = buildReviewModel(set, answers);
  const item = model.sections[1].items[0];
  assert.equal(item.questionCount, 2);
  assert.equal(item.correctCount, 1);
});

test('conteo a nivel sección suma los ítems', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'A' }, s1i2: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].correctCount, 2);
  assert.equal(model.sections[0].questionCount, 2);
});

test('sección sin ninguna respuesta: correctCount 0, questionCount igual a las preguntas reales', () => {
  const set = fixtureSet();
  const model = buildReviewModel(set, {});
  assert.equal(model.sections[1].correctCount, 0);
  assert.equal(model.sections[1].questionCount, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test
```

Expected: FAIL — `reviewModel.js` doesn't exist yet.

- [ ] **Step 3: Implement `reviewModel.js`**

Create `frontend/src/exam/reviewModel.js`:

```js
// Por cada ítem de audio, calcula el estado de cada una de sus preguntas
// y el conteo correcto/total a nivel ítem y a nivel sección. No toca DOM,
// no depende de React -- mismo principio que computeResults en
// examMachine.js, separado de cómo ExamReview lo renderiza.
export function buildReviewModel(set, answers) {
  const sections = set.sections.map(section => {
    const items = section.items.map(item => {
      const itemAnswers = answers[section.type]?.[item.ref] ?? {};
      const questions = item.questions.map((question, questionIndex) => {
        const selectedId = itemAnswers[questionIndex];
        const answered = selectedId !== undefined;
        const isCorrect = answered && selectedId === question.correctId;
        return {
          questionIndex,
          selectedId: selectedId ?? null,
          correctId: question.correctId,
          answered,
          isCorrect,
        };
      });
      const correctCount = questions.filter(q => q.isCorrect).length;
      return { ref: item.ref, correctCount, questionCount: questions.length, questions };
    });
    const correctCount = items.reduce((sum, item) => sum + item.correctCount, 0);
    const questionCount = items.reduce((sum, item) => sum + item.questionCount, 0);
    return { type: section.type, correctCount, questionCount, items };
  });
  return { sections };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test
```

Expected: PASS — all tests across `examTiming.test.js`, `examMachine.test.js`, `setCompatibility.test.js`, `examScoring.test.js`, and the new `reviewModel.test.js` green (7 new, 40 total).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/reviewModel.js frontend/src/exam/reviewModel.test.js
git commit -m "feat(exam): add reviewModel.js, per-question/item/section correctness"
```

---

### Task 2: `highlightSegments.js` — locating justifications in transcripts

**Files:**
- Create: `frontend/src/exam/highlightSegments.js`
- Create: `frontend/src/exam/highlightSegments.test.js`

**Interfaces:**
- Produces: `buildHighlightSegments(transcript, questionJustifications) -> [{ text: string, questionIndexes: number[] }]` where `questionJustifications` is `[{ questionIndex, justification }]`. The returned array's `text` fields, concatenated in order, exactly reconstruct `transcript`. `questionIndexes` is `[]` for unhighlighted text and can contain more than one index where two justifications' spans overlap or are identical.
- Read by Task 3 (`ExamReview.jsx`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/exam/highlightSegments.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHighlightSegments } from './highlightSegments.js';

test('match exacto de subcadena', () => {
  const transcript = 'Bonjour, ceci est un test important pour vous.';
  const justification = 'un test important';
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const highlighted = segments.filter(s => s.questionIndexes.includes(0)).map(s => s.text).join('');
  assert.equal(highlighted, 'un test important');
});

test('match que difiere solo en acento, apóstrofe, puntuación y mayúsculas', () => {
  const transcript = 'L’invité a dit : « C’est vraiment très important. »';
  const justification = "c'est vraiment tres important";
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const highlighted = segments.filter(s => s.questionIndexes.includes(0)).map(s => s.text).join('');
  assert.equal(highlighted, 'C’est vraiment très important');
});

test('justification ausente del transcript (parafraseada) no rompe y queda excluida', () => {
  const transcript = 'Le train part à treize heures pour Montréal.';
  const justification = 'une phrase qui n\'apparaît nulle part dans le texte';
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].questionIndexes, []);
  assert.equal(segments[0].text, transcript);
});

test('frase repetida: solo se resalta la primera aparición', () => {
  const transcript = 'Le chat est noir. Le chat est petit.';
  const justification = 'le chat';
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const highlightedSegments = segments.filter(s => s.questionIndexes.includes(0));
  assert.equal(highlightedSegments.length, 1);
  assert.equal(transcript.indexOf(highlightedSegments[0].text), 0);
});

test('dos justifications que se solapan: el segmento compartido lleva ambos questionIndexes', () => {
  const transcript = 'Le grand chat noir dort tranquillement sur le tapis.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: 'grand chat noir' },
    { questionIndex: 1, justification: 'chat noir dort' },
  ]);
  const overlapping = segments.find(s => s.questionIndexes.includes(0) && s.questionIndexes.includes(1));
  assert.ok(overlapping, 'debe existir un segmento con ambos questionIndexes');
  assert.equal(overlapping.text, 'chat noir');
});

test('dos justifications adyacentes: no se fusionan de forma incorrecta', () => {
  const transcript = 'Premiere partie. Deuxieme partie.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: 'Premiere partie' },
    { questionIndex: 1, justification: 'Deuxieme partie' },
  ]);
  const seg0 = segments.find(s => s.questionIndexes.length === 1 && s.questionIndexes[0] === 0);
  const seg1 = segments.find(s => s.questionIndexes.length === 1 && s.questionIndexes[0] === 1);
  assert.equal(seg0.text, 'Premiere partie');
  assert.equal(seg1.text, 'Deuxieme partie');
});

test('dos justifications idénticas: el mismo segmento lleva ambos questionIndexes', () => {
  const transcript = 'Le prix a beaucoup augmenté cette année.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: 'beaucoup augmenté' },
    { questionIndex: 1, justification: 'beaucoup augmenté' },
  ]);
  const shared = segments.find(s => s.text === 'beaucoup augmenté');
  assert.deepEqual([...shared.questionIndexes].sort(), [0, 1]);
});

test('concatenar todos los segmentos reconstruye el transcript exacto', () => {
  const transcript = 'L’invité a dit : « C’est vraiment très important. » Merci beaucoup.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: "c'est vraiment tres important" },
    { questionIndex: 1, justification: 'merci beaucoup' },
  ]);
  assert.equal(segments.map(s => s.text).join(''), transcript);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test
```

Expected: FAIL — `highlightSegments.js` doesn't exist yet.

- [ ] **Step 3: Implement `highlightSegments.js`**

Create `frontend/src/exam/highlightSegments.js`:

```js
// Ubica cada justification dentro de su transcript, normalizando igual que
// el backend (validation/frenchWords.js: diacríticos fuera, minúsculas,
// puntuación/espacios colapsados) pero devolviendo offsets sobre el
// transcript ORIGINAL -- la normalización cambia el largo del string, así
// que machear en el texto normalizado y cortar el original en los mismos
// índices sería incorrecto. Solo el primer match de cada justification
// cuenta. Construye los segmentos del transcript COMPLETO de una sola vez
// para que justifications solapadas, adyacentes o idénticas queden
// resueltas por construcción: cada segmento lleva la lista de qué
// preguntas lo justifican, no una sola.
//
// Duplicado deliberado de la normalización del backend (mismo patrón que
// frontend/src/trainingScan.js vs backend/src/validation/frenchWords.js):
// son dos paquetes npm sin workspace compartido.

function normalizeWithMap(text) {
  const original = String(text);
  let normalized = '';
  const map = [];
  let inSpaceRun = true; // evita un espacio inicial si el texto empieza con puntuación

  for (let i = 0; i < original.length; i += 1) {
    const decomposed = original[i].normalize('NFD').replace(/\p{Diacritic}/gu, '');
    for (const dch of decomposed) {
      if (/[\p{L}\p{N}]/u.test(dch)) {
        normalized += dch.toLowerCase();
        map.push(i);
        inSpaceRun = false;
      } else if (!inSpaceRun) {
        normalized += ' ';
        map.push(i);
        inSpaceRun = true;
      }
    }
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }

  return { normalized, map };
}

function findFirstMatch(transcript, justification) {
  const { normalized: normTranscript, map } = normalizeWithMap(transcript);
  const { normalized: normJustification } = normalizeWithMap(justification);
  if (!normJustification) return null;

  const idx = normTranscript.indexOf(normJustification);
  if (idx === -1) return null;

  const start = map[idx];
  const end = map[idx + normJustification.length - 1] + 1;
  return { start, end };
}

export function buildHighlightSegments(transcript, questionJustifications) {
  const spans = [];
  for (const { questionIndex, justification } of questionJustifications) {
    const match = findFirstMatch(transcript, justification);
    if (match) spans.push({ ...match, questionIndex });
  }

  if (spans.length === 0) {
    return [{ text: transcript, questionIndexes: [] }];
  }

  const boundaries = new Set([0, transcript.length]);
  for (const span of spans) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  const segments = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];
    if (start === end) continue;
    const questionIndexes = spans
      .filter(span => span.start <= start && span.end >= end)
      .map(span => span.questionIndex);
    segments.push({ text: transcript.slice(start, end), questionIndexes });
  }
  return segments;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test
```

Expected: PASS — 8 new tests, 48 total across all frontend test files.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/highlightSegments.js frontend/src/exam/highlightSegments.test.js
git commit -m "feat(exam): add highlightSegments.js, overlap-safe justification highlighting"
```

---

### Task 3: `ExamReview.jsx`

**Files:**
- Create: `frontend/src/exam/ExamReview.jsx`

**Interfaces:**
- Consumes: `buildReviewModel` from `reviewModel.js` (Task 1), `buildHighlightSegments` from `highlightSegments.js` (Task 2).
- Produces: `ExamReview` — default-exported component, props `{ set, answers, audioElRef, audioUrls, onBackToSummary, onExit }`.
- Read by Task 4 (`ExamMode.jsx`).

- [ ] **Step 1: Implement `ExamReview.jsx`**

Create `frontend/src/exam/ExamReview.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { buildReviewModel } from './reviewModel';
import { buildHighlightSegments } from './highlightSegments';

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const HIGHLIGHT_COLORS = ['bg-yellow-200', 'bg-sky-200', 'bg-pink-200'];

const TranscriptWithHighlights = ({ transcript, questions }) => {
  const questionJustifications = questions.map((q, questionIndex) => ({
    questionIndex,
    justification: q.justification,
  }));
  const segments = buildHighlightSegments(transcript, questionJustifications);
  const foundIndexes = new Set(segments.flatMap(s => s.questionIndexes));

  return (
    <div className="bg-purple-50 border border-purple-200 rounded p-4 text-sm space-y-2">
      <p>
        {segments.map((segment, i) => {
          if (segment.questionIndexes.length === 0) return <span key={i}>{segment.text}</span>;
          const colorClass = HIGHLIGHT_COLORS[segment.questionIndexes[0] % HIGHLIGHT_COLORS.length];
          return (
            <span key={i} className={`${colorClass} rounded px-0.5`}>
              {segment.text}
            </span>
          );
        })}
      </p>
      {questions.map((q, questionIndex) => (
        !foundIndexes.has(questionIndex) && (
          <p key={questionIndex} className="text-xs text-gray-500 italic">
            Evidencia generada — no localizada literalmente en el transcript: «{q.justification}»
          </p>
        )
      ))}
    </div>
  );
};

const ExamReview = ({ set, answers, audioElRef, audioUrls, onBackToSummary, onExit }) => {
  const [expandedRefs, setExpandedRefs] = useState(() => new Set());
  const [playback, setPlayback] = useState({ activeRef: null, status: 'idle', error: null });

  const model = buildReviewModel(set, answers);

  const stopPlayback = () => {
    const audioEl = audioElRef.current;
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    }
  };

  // Escucha los eventos reales del elemento compartido durante toda la vida
  // de ExamReview -- nunca asume que play() tuvo éxito ni que el estado
  // sigue siendo válido sin confirmación del propio elemento.
  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onPlaying = () => setPlayback(prev => ({ ...prev, status: 'playing', error: null }));
    const onEnded = () => setPlayback(prev => ({ ...prev, status: 'idle' }));
    const onError = () => setPlayback(prev => ({ ...prev, status: 'error' }));
    audioEl.addEventListener('playing', onPlaying);
    audioEl.addEventListener('ended', onEnded);
    audioEl.addEventListener('error', onError);
    return () => {
      audioEl.removeEventListener('playing', onPlaying);
      audioEl.removeEventListener('ended', onEnded);
      audioEl.removeEventListener('error', onError);
      stopPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioElRef]);

  const handlePlay = (ref) => {
    const audioEl = audioElRef.current;
    const url = audioUrls.get(ref);
    if (!audioEl || !url) {
      setPlayback({ activeRef: ref, status: 'error', error: 'Audio no disponible' });
      return;
    }
    setPlayback({ activeRef: ref, status: 'idle', error: null });
    audioEl.src = url;
    audioEl.currentTime = 0;
    Promise.resolve(audioEl.play()).catch(() => {
      setPlayback({ activeRef: ref, status: 'error', error: 'No se pudo reproducir el audio' });
    });
  };

  const handleBack = () => {
    stopPlayback();
    onBackToSummary();
  };

  const handleExit = () => {
    stopPlayback();
    onExit();
  };

  const toggleExpanded = (ref) => {
    setExpandedRefs(prev => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Revisión detallada</h2>
        <button onClick={handleBack} className="text-blue-600 hover:underline text-sm">
          Volver al resumen
        </button>
      </div>

      {model.sections.map((section, sectionIndex) => (
        <div key={section.type} className="space-y-2">
          <h3 className="font-bold text-lg">
            {SECTION_LABELS[section.type]} — {section.correctCount}/{section.questionCount} correctas
          </h3>
          {section.items.map((item, itemIndex) => {
            const setItem = set.sections[sectionIndex].items[itemIndex];
            const isExpanded = expandedRefs.has(item.ref);
            const isActive = playback.activeRef === item.ref;
            const buttonLabel = isActive && playback.status === 'playing' ? 'Reiniciar' : 'Reproducir';

            return (
              <div key={item.ref} className="border rounded">
                <button
                  onClick={() => toggleExpanded(item.ref)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50"
                >
                  <span>Audio {itemIndex + 1}/{section.items.length}</span>
                  <span className="font-semibold">{item.correctCount}/{item.questionCount} correctas</span>
                </button>
                {isExpanded && (
                  <div className="p-4 border-t space-y-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handlePlay(item.ref)}
                        className="bg-blue-600 text-white px-4 py-2 rounded"
                      >
                        {buttonLabel}
                      </button>
                      {isActive && playback.status === 'error' && (
                        <span className="text-red-600 text-sm">{playback.error}</span>
                      )}
                    </div>

                    <TranscriptWithHighlights transcript={setItem.transcript} questions={setItem.questions} />

                    {item.questions.map((question, questionIndex) => {
                      const setQuestion = setItem.questions[questionIndex];
                      return (
                        <div key={questionIndex} className="space-y-2 border-t pt-3">
                          <h4 className="font-semibold">{setQuestion.prompt}</h4>
                          {!question.answered && (
                            <p className="text-sm text-amber-700 font-semibold">Sin respuesta</p>
                          )}
                          <div className="space-y-1">
                            {setQuestion.options.map(opt => {
                              const isCorrectOpt = opt.id === question.correctId;
                              const isChosenOpt = opt.id === question.selectedId;
                              let stateLabel = null;
                              let className = 'p-2 border rounded';
                              if (isCorrectOpt && isChosenOpt) {
                                stateLabel = 'Tu respuesta — correcta';
                                className += ' border-green-400 bg-green-50';
                              } else if (isCorrectOpt) {
                                stateLabel = 'Respuesta correcta';
                                className += ' border-green-400 bg-green-50';
                              } else if (isChosenOpt) {
                                stateLabel = 'Tu respuesta — incorrecta';
                                className += ' border-red-400 bg-red-50';
                              }
                              return (
                                <div key={opt.id} className={className}>
                                  <span className="font-bold mr-2">{opt.id})</span>
                                  {opt.text}
                                  {stateLabel && (
                                    <span className="ml-2 text-xs font-semibold">{stateLabel}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-sm text-gray-700">{setQuestion.feedback}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <button onClick={handleExit} className="w-full bg-gray-800 text-white py-2 rounded">
        Volver a la lista de sets
      </button>
    </div>
  );
};

export default ExamReview;
```

- [ ] **Step 2: Verification**

```bash
cd frontend && npm run build
```

Expected: succeeds — nothing imports `ExamReview` yet (that's Task 4), so this only confirms the file compiles in isolation. Temporarily add `frontend/src/exam/__buildcheck__.jsx` that imports `ExamReview` (and nothing else), point `main.jsx` at it, re-run `npm run build`, confirm it still succeeds, then revert both files (delete `__buildcheck__.jsx`, restore `main.jsx`) — same pattern used to verify `ExamRunner.jsx` in slice 2 before anything imported it yet.

Since no real browser is available in this environment, also do a careful code-review pass against the Global Constraints above: confirm the playback button is never `disabled`; confirm `stopPlayback()` never touches `audioUrls`/never calls `revokeAudioUrls`; confirm the `playing`/`ended`/`error` listeners are added and removed in the same effect; confirm every option in the answer-state block renders one of the four defined labels (or none) and that an unanswered question shows "Sin respuesta" instead of marking any option as "tu respuesta".

- [ ] **Step 3: Commit**

```bash
git add frontend/src/exam/ExamReview.jsx
git commit -m "feat(exam): add ExamReview.jsx, the post-exam review screen"
```

---

### Task 4: Wire `ExamMode.jsx` and `ExamSummary.jsx`

**Files:**
- Modify: `frontend/src/exam/ExamMode.jsx`
- Modify: `frontend/src/exam/ExamSummary.jsx`

**Interfaces:**
- Consumes: `ExamReview` (Task 3).
- `ExamSummary` gains one new required prop: `onShowReview: () => void`.

- [ ] **Step 1: Import `ExamReview` in `ExamMode.jsx`**

In `frontend/src/exam/ExamMode.jsx`, change:

```js
import SetPicker from './SetPicker';
import ExamRunner from './ExamRunner';
import ExamSummary from './ExamSummary';
```

to:

```js
import SetPicker from './SetPicker';
import ExamRunner from './ExamRunner';
import ExamReview from './ExamReview';
import ExamSummary from './ExamSummary';
```

- [ ] **Step 2: Stop releasing audio the instant the exam completes**

In `frontend/src/exam/ExamMode.jsx`, change:

```js
  const handleComplete = useCallback((finalResults) => {
    resetAudio();
    setResults(finalResults);
    setPhase('summary');
  }, [resetAudio]);
```

to:

```js
  const handleComplete = useCallback((finalResults) => {
    setResults(finalResults);
    setPhase('summary');
  }, []);

  const handleShowReview = useCallback(() => setPhase('review'), []);
  const handleBackToSummary = useCallback(() => setPhase('summary'), []);
```

- [ ] **Step 3: Pass the new handler to `ExamSummary` and add the `review` render branch**

In `frontend/src/exam/ExamMode.jsx`, change:

```js
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
```

to:

```js
      {phase === 'summary' && results && (
        <ExamSummary
          correctTotal={results.correctTotal}
          totalQuestions={Object.values(totalsBySection).reduce((a, b) => a + b, 0)}
          correctBySection={results.correctBySection}
          totalsBySection={totalsBySection}
          onExit={goToPicker}
          onShowReview={handleShowReview}
        />
      )}

      {phase === 'review' && setDetail && results && (
        <ExamReview
          set={setDetail}
          answers={results.answers}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onBackToSummary={handleBackToSummary}
          onExit={goToPicker}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 4: Add the "Ver revisión detallada" button to `ExamSummary.jsx`**

Replace the entire contents of `frontend/src/exam/ExamSummary.jsx` with:

```jsx
import React from 'react';
import { estimateScore699 } from './examScoring';

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const ExamSummary = ({ correctTotal, totalQuestions, correctBySection, totalsBySection, onExit, onShowReview }) => {
  const { estimated699, isB2, thresholdCount } = estimateScore699(correctTotal, totalQuestions);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">Examen completado</h2>
      <div className="p-4 rounded bg-blue-50 border border-blue-200 text-center">
        <p className="text-3xl font-bold text-blue-800">{correctTotal} / {totalQuestions}</p>
        <p className="text-sm text-blue-700">respuestas correctas</p>
      </div>

      <div className={`p-4 rounded border text-center space-y-1 ${isB2 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <p className={`text-xl font-bold ${isB2 ? 'text-green-800' : 'text-amber-800'}`}>
          ≈ {estimated699} / 699
        </p>
        <p className="text-xs text-gray-500">
          Estimación lineal no oficial — la escala real del TEFAQ usa un escalamiento psicométrico no público.
        </p>
        <p className={`text-sm font-semibold ${isB2 ? 'text-green-700' : 'text-amber-700'}`}>
          {isB2 ? 'Nivel B2 alcanzado' : 'Todavía no alcanza B2'}
        </p>
        <p className="text-xs text-gray-600">
          Necesitás ~{thresholdCount}/{totalQuestions} aciertos para B2.
        </p>
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

      <button onClick={onShowReview} className="w-full border border-blue-600 text-blue-700 py-2 rounded hover:bg-blue-50">
        Ver revisión detallada
      </button>
      <button onClick={onExit} className="w-full bg-blue-600 text-white py-2 rounded">
        Volver a la lista de sets
      </button>
    </div>
  );
};

export default ExamSummary;
```

- [ ] **Step 5: Verification**

```bash
cd backend && npm test    # should remain 157/157, unaffected
cd frontend && npm test   # should remain 48/48, unaffected (this task touches no test files)
cd frontend && npm run build
```

Expected: all pass, build succeeds — this is the first build where `ExamReview.jsx` is actually imported and reachable, so it's a stronger signal than Task 3's isolated `__buildcheck__` pass.

Code-review the wiring: confirm `handleComplete` no longer calls `resetAudio()`; confirm `goToPicker` (unchanged) is still what both `ExamSummary`'s and `ExamReview`'s exit buttons call; confirm the `review` phase is absent from `ACTIVE_PHASES`/`GUARDED_PHASES` (it should be — this task doesn't touch those constants, only verify they weren't accidentally affected).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/exam/ExamMode.jsx frontend/src/exam/ExamSummary.jsx
git commit -m "feat(exam): wire ExamReview into ExamMode, extend audio retention through review"
```

---

### Task 5: Documentation and final verification pass

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update `CLAUDE.md`'s Project paragraph**

Find this exact text in the "Project" section:

```
TEFAQ (French listening exam for Quebec) simulator. An Express backend generates exam content with LLMs and synthesizes audio; a React/Vite frontend runs the timed training simulation. Two modes share the same generation core: a single-question **training mode** (`TrainingMode.jsx`, unchanged behavior) and a **Modo Examen** pipeline that generates and persists full 36-question exam sets to disk, played back by a lockstep frontend runner (`frontend/src/exam/`) that consumes already-generated sets — it does not trigger generation itself. No linter or type checking exists; the backend has a `node --test` suite (157 tests), and the frontend now has one too (`frontend/src/exam/*.test.js`, run via `cd frontend && npm test`) covering the runner's two pure modules (`examTiming.js`, `examMachine.js`) — everything else in the frontend is still verified by running the app.
```

Replace it with:

```
TEFAQ (French listening exam for Quebec) simulator. An Express backend generates exam content with LLMs and synthesizes audio; a React/Vite frontend runs the timed training simulation. Two modes share the same generation core: a single-question **training mode** (`TrainingMode.jsx`, unchanged behavior) and a **Modo Examen** pipeline that generates and persists full 36-question exam sets to disk, played back by a lockstep frontend runner (`frontend/src/exam/`) that consumes already-generated sets — it does not trigger generation itself. No linter or type checking exists; the backend has a `node --test` suite (157 tests), and the frontend now has one too (`frontend/src/exam/*.test.js`, run via `cd frontend && npm test`) covering the runner's pure modules (`examTiming.js`, `examMachine.js`, `setCompatibility.js`, `examScoring.js`, `reviewModel.js`, `highlightSegments.js`) — everything else in the frontend is still verified by running the app.
```

- [ ] **Step 2: Update `CLAUDE.md`'s `ExamMode` architecture paragraph**

Find this exact text (part of the "Frontend architecture" section):

```
`exam/` holds the Modo Examen runner, kept deliberately separate from training mode (no shared state, no shared audio-control UI — exam audio is autoplay-only). `ExamMode.jsx` owns the top-level flow (`picker → loading → (loading-error | incompatible) → preloading → preload-failed → unlock → running → summary`) and the persistent `<audio>` element reused for every item's playback. `examMachine.js` is a pure reducer (`(set, state, event) -> nextState`) driving the per-item lockstep (`avant → audio-pending → audio-playing → apres`, plus `section-transition` between the 7 sections) — every async-originated event carries a `{sectionIndex, itemIndex, phase}` token so a stale callback (a late audio-end after a watchdog already fired, or vice versa) is a no-op instead of double-advancing. `examTiming.js` anchors phase countdowns to absolute deadlines rather than decrementing a counter, and chains a new item's deadline from the previous phase's deadline (not the live clock) so per-transition scheduling slop can't compound over a 40-minute run. Both are unit-tested; `ExamRunner.jsx`/`ExamMode.jsx`/`SetPicker.jsx`/`ExamSummary.jsx` are browser-verified only. `setCompatibility.js` rejects sets generated with `pilotes: true` (36 items/40 questions, not this runner's 32/36 contract) before preload starts.
```

Replace it with:

```
`exam/` holds the Modo Examen runner, kept deliberately separate from training mode (no shared state, no shared audio-control UI — exam audio is autoplay-only). `ExamMode.jsx` owns the top-level flow (`picker → loading → (loading-error | incompatible) → preloading → preload-failed → unlock → running → (summary ⇄ review)`) and the persistent `<audio>` element reused for every item's playback during the run, and again for on-demand playback in `review`. `examMachine.js` is a pure reducer (`(set, state, event) -> nextState`) driving the per-item lockstep (`avant → audio-pending → audio-playing → apres`, plus `section-transition` between the 7 sections) — every async-originated event carries a `{sectionIndex, itemIndex, phase}` token so a stale callback (a late audio-end after a watchdog already fired, or vice versa) is a no-op instead of double-advancing. `examTiming.js` anchors phase countdowns to absolute deadlines rather than decrementing a counter, and chains a new item's deadline from the previous phase's deadline (not the live clock) so per-transition scheduling slop can't compound over a 40-minute run. `setCompatibility.js` rejects sets generated with `pilotes: true` (36 items/40 questions, not this runner's 32/36 contract) before preload starts. `examScoring.js` computes the non-official `/699` estimate shown on `ExamSummary`. `reviewModel.js` computes per-question/item/section correctness for `ExamReview` (the untimed post-exam review screen — re-listen to any item, transcript with justifications highlighted, full feedback); `highlightSegments.js` locates justifications inside their transcript, normalizing the same way `backend/src/validation/frenchWords.js` does (not just case-insensitively) and resolving overlapping justifications by construction rather than assuming they can't happen. Audio blob URLs are kept alive through `summary` and `review` (not revoked the instant the exam completes, as earlier) — release still happens exactly once, via the same `goToPicker`/unmount cleanup every exit path already used. All six pure modules are unit-tested; `ExamRunner.jsx`/`ExamMode.jsx`/`SetPicker.jsx`/`ExamSummary.jsx`/`ExamReview.jsx` are browser-verified only.
```

- [ ] **Step 3: Update `README.md`'s Modo Examen frontend section**

Find this exact text:

```
Desde la pantalla inicial del frontend, el switch superior cambia a **Modo Examen**: lista los sets con `statut: 'complet'`, valida que sean compatibles con el runner (formato `SET_STANDARD_36`, sin pilotos, 32 ítems / 36 preguntas — un set generado con `pilotes: true` se rechaza explícitamente, con un mensaje claro, antes de precargar nada), precarga los 32 audios, y corre el examen en lockstep: lectura antes de cada audio, reproducción automática sin controles (ni pausa, ni repetir, ni velocidad), tiempo para responder, sin pausa ni retroceso entre preguntas, con una pantalla corta entre las 7 secciones. Al terminar muestra un resumen crudo (aciertos por sección y total) — el puntaje estimado /699 y el análisis detallado quedan para una fase futura. No hay reanudación: cerrar la pestaña o pulsar "Abandonar" descarta el intento completo, sin guardar nada.
```

Replace it with:

```
Desde la pantalla inicial del frontend, el switch superior cambia a **Modo Examen**: lista los sets con `statut: 'complet'`, valida que sean compatibles con el runner (formato `SET_STANDARD_36`, sin pilotos, 32 ítems / 36 preguntas — un set generado con `pilotes: true` se rechaza explícitamente, con un mensaje claro, antes de precargar nada), precarga los 32 audios, y corre el examen en lockstep: lectura antes de cada audio, reproducción automática sin controles (ni pausa, ni repetir, ni velocidad), tiempo para responder, sin pausa ni retroceso entre preguntas, con una pantalla corta entre las 7 secciones. Al terminar muestra un resumen con el puntaje bruto y una estimación no oficial /699 (con el umbral B2 marcado), y un botón para abrir una **revisión detallada**: reescuchar el audio de cualquier ítem (aquí sin restricción de una sola escucha), ver el transcript con la justificación de cada pregunta resaltada, y el feedback completo. No hay analítica por pregunta, etiquetado de causa de fallo, ni bitácora persistida todavía — quedan para incrementos futuros. No hay reanudación: cerrar la pestaña o pulsar "Abandonar" descarta el intento completo, sin guardar nada.
```

- [ ] **Step 4: Full manual verification pass**

```bash
cd backend && npm test    # confirm still 157/157
cd frontend && npm test   # confirm all 48 tests pass
cd frontend && npm run build
```

If a real browser is available in this environment (check before assuming it isn't — this plan's earlier tasks assumed it wasn't, following this project's established precedent, but confirm rather than skip this step by default): with both servers running (`cd backend && npm start`, `cd frontend && npm run dev`), take a real `SET_STANDARD_36` set through to completion and confirm: "Ver revisión detallada" appears on the summary screen and opens the review; each section/item header shows the right counts; expanding an item plays real audio, and clicking it again while playing restarts it (not disabled); switching to a different item while one plays correctly reverts the first item's button to "Reproducir"; the transcript shows highlighted justification(s) for `interview`/`reportage` items with two questions; an unanswered question (if any) shows "Sin respuesta" and no option marked as chosen; "Volver al resumen" stops any playing audio and returns to the score screen; returning to "Ver revisión detallada" still works; "Volver a la lista de sets" and switching to Entrenamiento mid-review both work without leaving audio playing.

If no real browser is available, state that plainly rather than claiming this was verified — same standard this project has held throughout.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document the post-exam review screen"
```
