# Exam Runner Visual Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Modo Examen runner's visual design close to the official TEF-CO simulator: real header branding, a global answered-count indicator, a new per-section numbered tab strip alongside the existing unlabeled progress bar, a redesigned audio-bar, a 2-column item layout, and full French chrome text during the exam.

**Architecture:** Two small pure-function additions (`countAnswered` in `examMachine.js`, `buildSectionTabs` in `examProgress.js`) feed a restructured `ExamRunner.jsx` render: a shared header/counter/tabs/footer wrapper around the three existing phase bodies (`section-intro`, `audio-failed`, main item), plus a redesigned 2-column layout and audio bar for the main item screen. No reducer (`examMachine.js`'s state machine) or timing (`examTiming.js`) logic changes — this is presentation only, on top of the runner shipped in PR #4.

**Tech Stack:** React 18, `node --test` (frontend test suite), Tailwind utility classes (no new dependencies).

## Global Constraints

- Sin navegación libre (atrás/adelante) ni corrección durante el examen — sin cambios de este plan.
- La franja de pestañas por sección (nueva) y la franja global de 32 ítems (existente) NUNCA son clicables.
- Branding real: `frontend/src/assets/le-francais-des-affaires-logo.png` y `frontend/src/assets/cci-paris-logo.jpg` ya están en el repo — si un import de estos archivos falla, la tarea debe fallar visiblemente (build roto), no hacer fallback silencioso a texto.
- Todo el texto del runner, desde que arranca el examen (`state.status === 'running'`), va en **francés** — incluye `SECTION_LABELS`, textos de estado de audio, error, y el botón "Abandonner". Esto NO aplica a `SetPicker`/`ExamSummary`/`ExamReview` (fuera de alcance de este plan).
- El contador de preguntas contestadas cuenta preguntas (no ítems) recorriendo `state.answers`, no reutiliza `computeResults` (esa función mide corrección, no si fue respondida).
- La franja de pestañas por sección usa numeración GLOBAL (no reinicia en 1 por sección), filtrada a los ítems de la sección actual únicamente.

---

### Task 1: `examMachine.js` — `countAnswered`

**Files:**
- Modify: `frontend/src/exam/examMachine.js`
- Test: `frontend/src/exam/examMachine.test.js`

**Interfaces:**
- Produces: `countAnswered(answers) -> number`, donde `answers` es la misma estructura que ya puebla `ANSWER_SELECTED` (`{ [sectionType]: { [itemRef]: { [questionIndex]: optionId } } }`). Cuenta el total de entradas `questionIndex -> optionId` en todo el árbol. Task 3 la consume.

- [ ] **Step 1: Agregar `countAnswered` a `examMachine.js`**

Al final del archivo, después de `computeResults`:

```js
export function countAnswered(answers) {
  let count = 0;
  for (const itemsByRef of Object.values(answers)) {
    for (const questionsByIndex of Object.values(itemsByRef)) {
      count += Object.keys(questionsByIndex).length;
    }
  }
  return count;
}
```

- [ ] **Step 2: Agregar los tests**

En `examMachine.test.js`, agregar al final del archivo (después del último `test(...)`), actualizando el import de la primera línea para incluir `countAnswered`:

```js
import { createInitialState, reducer, currentToken, computeResults, countAnswered } from './examMachine.js';
```

```js
test('countAnswered cuenta preguntas respondidas, no ítems', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  assert.equal(countAnswered(state.answers), 0);

  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(countAnswered(state.answers), 1);

  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> item 2, sin responder
  assert.equal(countAnswered(state.answers), 1, 'avanzar de ítem sin responder no suma');

  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'B' });
  assert.equal(countAnswered(state.answers), 2, 'segundo ítem respondido suma, sin pisar el primero');
});

test('countAnswered cuenta cada pregunta de un ítem multi-pregunta por separado', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-intro (sección 1)
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> avant, interview

  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(countAnswered(state.answers), 1);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 1, optionId: 'C' });
  assert.equal(countAnswered(state.answers), 2, 'las 2 preguntas del mismo ítem cuentan por separado');
});
```

- [ ] **Step 3: Correr los tests**

Run: `cd frontend && node --test src/exam/examMachine.test.js`
Expected: PASS, 17 tests (15 existentes + 2 nuevos).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/exam/examMachine.js frontend/src/exam/examMachine.test.js
git commit -m "feat(exam): add countAnswered, pure answered-question counter"
```

---

### Task 2: `examProgress.js` — `buildSectionTabs`

**Files:**
- Modify: `frontend/src/exam/examProgress.js`
- Test: `frontend/src/exam/examProgress.test.js`

**Interfaces:**
- Produces: `buildSectionTabs(set, state) -> { globalIndex: number, sectionTabs: Array<{ globalNumber: number, status: 'completed'|'current'|'pending' }> }`. `globalIndex` es la posición global 1-N del ítem actual (para el caption "Écran N"). `sectionTabs` son SOLO los ítems de `state.sectionIndex`, con numeración global (no reinicia en 1). Task 4 (vía Task 3's wrapper) la consume.
- `buildProgressTabs` (ya existente) no cambia de firma ni de comportamiento — sigue devolviendo los 32 tabs sin número, para la franja inferior.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `examProgress.test.js` (mismo fixture ya definido en el archivo):

```js
test('buildSectionTabs: primer ítem de la primera sección, numeración global arranca en 1', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 0, phase: 'avant' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 1);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 1, status: 'current' },
    { globalNumber: 2, status: 'pending' },
  ]);
});

test('buildSectionTabs: segundo ítem de la primera sección', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 1, phase: 'apres' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 2);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 1, status: 'completed' },
    { globalNumber: 2, status: 'current' },
  ]);
});

test('buildSectionTabs: section-intro de la segunda sección, numeración global NO reinicia en 1', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'section-intro' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 3);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 3, status: 'pending' },
  ]);
});

test('buildSectionTabs: primer ítem de la segunda sección ya en avant', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'avant' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 3);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 3, status: 'current' },
  ]);
});
```

Actualizar el import de la primera línea del archivo para incluir `buildSectionTabs`:

```js
import { buildProgressTabs, buildSectionTabs } from './examProgress.js';
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd frontend && node --test src/exam/examProgress.test.js`
Expected: FAIL — `buildSectionTabs is not a function` (todavía no existe).

- [ ] **Step 3: Implementar `buildSectionTabs`, factorizando el helper de status compartido**

Reemplazar el contenido completo de `examProgress.js`:

```js
// Deriva el estado visual (completado / actual / pendiente) de cada ítem de
// audio del set, para los dos indicadores de progreso del runner: la franja
// global de 32 ítems (buildProgressTabs) y la franja de pestañas filtrada a
// la sección actual, con numeración global (buildSectionTabs). Puro: no toca
// DOM ni reloj -- solo compara índices contra el estado del reducer
// (examMachine.js), sin importar nada de ahí.

export function buildProgressTabs(set, state) {
  const tabs = [];
  set.sections.forEach((section, sectionIndex) => {
    section.items.forEach((_item, itemIndex) => {
      tabs.push({ status: tabStatus(state, sectionIndex, itemIndex) });
    });
  });
  return tabs;
}

export function buildSectionTabs(set, state) {
  let globalNumber = 0;
  let globalIndex = null;
  const sectionTabs = [];
  set.sections.forEach((section, sectionIndex) => {
    section.items.forEach((_item, itemIndex) => {
      globalNumber += 1;
      if (sectionIndex === state.sectionIndex && itemIndex === state.itemIndex) {
        globalIndex = globalNumber;
      }
      if (sectionIndex === state.sectionIndex) {
        sectionTabs.push({ globalNumber, status: tabStatus(state, sectionIndex, itemIndex) });
      }
    });
  });
  return { globalIndex, sectionTabs };
}

function tabStatus(state, sectionIndex, itemIndex) {
  if (sectionIndex < state.sectionIndex) return 'completed';
  if (sectionIndex > state.sectionIndex) return 'pending';
  // misma sección que el estado actual
  if (state.phase === 'section-intro') return 'pending'; // ningún ítem arrancó todavía
  if (itemIndex < state.itemIndex) return 'completed';
  if (itemIndex === state.itemIndex) return 'current';
  return 'pending';
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd frontend && node --test src/exam/examProgress.test.js`
Expected: PASS, 8 tests (4 existentes de `buildProgressTabs` + 4 nuevos de `buildSectionTabs`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/examProgress.js frontend/src/exam/examProgress.test.js
git commit -m "feat(exam): add buildSectionTabs, per-section globally-numbered tab derivation"
```

---

### Task 3: `ExamRunner.jsx` — header, contador, pestañas por sección, footer

**Files:**
- Modify: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- Consumes: `countAnswered` de `examMachine.js` (Task 1), `buildSectionTabs` de `examProgress.js` (Task 2).
- Produces: la estructura de wrapper (`Header`, `AnsweredCounter`, `SectionTabs`, caption "Écran N", `Footer`) que Task 4 reutiliza sin modificarla — Task 4 solo cambia el contenido de `body` en la rama del ítem principal.

- [ ] **Step 1: Actualizar imports**

Reemplazar las primeras 4 líneas del archivo:

```js
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, currentToken, computeResults, countAnswered } from './examMachine';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from './examTiming';
import { buildProgressTabs, buildSectionTabs } from './examProgress';
import lfaLogo from '../assets/le-francais-des-affaires-logo.png';
import cciLogo from '../assets/cci-paris-logo.jpg';
```

- [ ] **Step 2: Traducir `SECTION_LABELS` al francés**

Reemplazar:

```js
const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};
```

con:

```js
const SECTION_LABELS = {
  annonce_publique: 'Annonces publiques',
  repondeur: 'Répondeur',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Chronique',
  interview: 'Interview',
  reportage: 'Reportage',
  divers: 'Divers',
};
```

- [ ] **Step 3: Revertir `ProgressTabs` a bloques de color sin número**

Los números se mudan a la nueva franja por sección (Step 4) — la franja inferior global vuelve a ser solo color. Reemplazar:

```jsx
const ProgressTabs = ({ tabs }) => (
  <div className="flex gap-0.5" aria-hidden="true">
    {tabs.map((tab, i) => (
      <div
        key={i}
        className={`flex-1 h-5 rounded-sm flex items-center justify-center text-[9px] leading-none font-semibold ${
          tab.status === 'completed' ? 'bg-blue-600 text-white'
            : tab.status === 'current' ? 'bg-blue-400 text-white'
              : 'bg-gray-200 text-gray-500'
        }`}
      >
        {i + 1}
      </div>
    ))}
  </div>
);
```

con:

```jsx
const ProgressTabs = ({ tabs }) => (
  <div className="flex gap-0.5" aria-hidden="true">
    {tabs.map((tab, i) => (
      <div
        key={i}
        className={`h-2 flex-1 rounded-sm ${
          tab.status === 'completed' ? 'bg-blue-600'
            : tab.status === 'current' ? 'bg-blue-400'
              : 'bg-gray-200'
        }`}
      />
    ))}
  </div>
);
```

- [ ] **Step 4: Agregar los 4 componentes nuevos**

Justo después del bloque de `ProgressTabs` (antes de `const ExamRunner = ...`):

```jsx
const Header = () => (
  <div className="flex items-center justify-between px-8 py-5 border-b-[3px] border-red-600">
    <div className="flex items-center gap-3">
      <img src={lfaLogo} alt="Le Français des Affaires" className="h-10" />
      <img src={cciLogo} alt="CCI Paris Île-de-France Education" className="h-10" />
    </div>
    <div className="text-right leading-tight">
      <div className="font-bold text-blue-900 text-sm">Candidat(e)</div>
      <div className="text-blue-900 text-xs">Simulateur TEFAQ</div>
    </div>
  </div>
);

const AnsweredCounter = ({ answered, total }) => (
  <div className="flex justify-end items-center gap-2.5 px-8 pt-2">
    <span className="text-sm text-gray-700">{answered}/{total}</span>
    <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div className="h-full bg-gray-400" style={{ width: `${total > 0 ? (answered / total) * 100 : 0}%` }} />
    </div>
  </div>
);

const SectionTabs = ({ tabs }) => (
  <div className="flex border-b border-gray-200 mt-3.5" aria-hidden="true">
    {tabs.map(tab => (
      <div
        key={tab.globalNumber}
        className={`px-5 py-3 text-sm font-semibold ${tab.status === 'current' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}
      >
        Écran {tab.globalNumber}
      </div>
    ))}
  </div>
);

const Footer = ({ tabs, onAbandon }) => (
  <div className="px-8 py-4 border-t border-gray-100">
    <div className="mb-4">
      <ProgressTabs tabs={tabs} />
    </div>
    <div className="flex justify-end">
      <button onClick={onAbandon} className="border border-red-600 text-red-600 px-5 py-2 rounded-full text-sm font-semibold hover:bg-red-50">
        Abandonner
      </button>
    </div>
  </div>
);
```

- [ ] **Step 5: Calcular las variables nuevas dentro de `ExamRunner`**

Justo después de la línea `const progressTabs = buildProgressTabs(set, state);`, agregar:

```js
  const sectionTabs = buildSectionTabs(set, state);
  const answeredCount = countAnswered(state.answers);
  const totalQuestions = set.sections.reduce((sum, s) => sum + s.items.reduce((n, i) => n + i.questions.length, 0), 0);
```

- [ ] **Step 6: Restructurar el render final**

Reemplazar TODO el bloque desde `if (state.status !== 'running') return null;` (línea 248 antes de este plan) hasta el `};` de cierre del componente (línea 353), es decir todo lo que sigue después de `handleRetryAudio`, por:

```jsx
  if (state.status !== 'running') return null;

  let body;
  if (state.phase === 'section-intro') {
    const introQuestionCount = section.items.reduce((n, i) => n + i.questions.length, 0);
    const introHasMultipleQuestions = section.items[0]?.questions.length > 1;
    body = (
      <div className="space-y-4 text-center py-10">
        <h3 className="text-xl font-bold">{SECTION_LABELS[section.type]}</h3>
        <p className="text-gray-600">{introQuestionCount} questions</p>
        <p className="text-blue-800 font-semibold max-w-lg mx-auto px-4">{SECTION_INSTRUCTIONS[section.type]}</p>
        <p className="text-red-600 font-semibold max-w-lg mx-auto px-4">
          Vous avez {section.timing.avant} secondes avant et {section.timing.apres} secondes après chaque document sonore pour lire et répondre {introHasMultipleQuestions ? 'aux questions' : 'à la question'}.
        </p>
        <div className="text-center text-4xl font-mono text-red-600">
          00:{remaining.toString().padStart(2, '0')}
        </div>
      </div>
    );
  } else if (state.phase === 'audio-failed') {
    body = (
      <div className="space-y-4 text-center py-10">
        <p className="text-red-600">Impossible de lire l'audio.</p>
        <button onClick={handleRetryAudio} className="bg-blue-600 text-white px-6 py-2 rounded">Réessayer</button>
      </div>
    );
  } else if (!item) {
    return null;
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    const useSelect = SELECT_SECTIONS.has(section.type);
    body = (
      <div className="space-y-4">
        {(state.phase === 'avant' || state.phase === 'apres') && (
          <div className="text-center text-4xl font-mono text-red-600">
            00:{remaining.toString().padStart(2, '0')}
          </div>
        )}

        {state.phase === 'audio-pending' && <p className="text-center text-blue-600">Préparation de l'audio...</p>}
        {state.phase === 'audio-playing' && <p className="text-center text-blue-600">Écoute en cours...</p>}

        {(state.phase === 'audio-pending' || state.phase === 'audio-playing') && (
          <div className="max-w-md mx-auto space-y-1">
            <div className="h-2 bg-gray-300 rounded overflow-hidden">
              <div
                className="h-full bg-gray-600"
                style={{ width: `${item.duree_audio_s > 0 ? Math.min(100, (audioCurrentTime / item.duree_audio_s) * 100) : 0}%` }}
              />
            </div>
            <p className="text-center text-xs text-gray-500">
              {formatSeconds(audioCurrentTime)} / {formatSeconds(item.duree_audio_s)}
            </p>
          </div>
        )}

        <div className="space-y-6">
          {questions.map((question, questionIndex) => (
            <div key={`${item.ref}-${questionIndex}`} className="border rounded p-4 space-y-2">
              <h3 className="font-bold">{question.prompt}</h3>
              {useSelect ? (
                <OptionSelect
                  options={question.options}
                  value={itemAnswers[questionIndex]}
                  onChange={optionId => handleAnswer(questionIndex, optionId)}
                />
              ) : (
                question.options.map(opt => {
                  const selected = itemAnswers[questionIndex] === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-center gap-3 w-full text-left p-3 rounded cursor-pointer ${selected ? 'bg-gray-200' : 'hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name={`${item.ref}-q${questionIndex}`}
                        checked={selected}
                        onChange={() => handleAnswer(questionIndex, opt.id)}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="text-black">{opt.text}</span>
                    </label>
                  );
                })
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header />
      <AnsweredCounter answered={answeredCount} total={totalQuestions} />
      <SectionTabs tabs={sectionTabs.sectionTabs} />
      <p className="mx-10 mt-4 text-xs tracking-wider uppercase text-gray-400 font-semibold">Écran {sectionTabs.globalIndex}</p>
      <div className="mx-10 mt-2 mb-4 border-b border-gray-100" />
      <div className="px-10 pb-2">{body}</div>
      <Footer tabs={progressTabs} onAbandon={handleAbandon} />
    </div>
  );
};

export default ExamRunner;
```

Nota: este Step elimina el viejo texto `"{SECTION_LABELS[section.type]} · ítem {state.itemIndex + 1}/{section.items.length}"` y el botón "Abandonar" que vivían dentro del bloque del ítem principal — ambos quedan reemplazados por la nueva franja de pestañas + caption (arriba) y el `Footer` (abajo), compartidos por las 3 fases.

- [ ] **Step 7: Verificar el build**

Run: `cd frontend && npm run build`
Expected: build exitoso — si los imports de los logos fallan (archivo no encontrado), el build falla aquí con un error claro de módulo no resuelto; no debe "arreglarse" con un fallback a texto, sino confirmar que `frontend/src/assets/le-francais-des-affaires-logo.png` y `frontend/src/assets/cci-paris-logo.jpg` existen.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): add header, answered counter, per-section tab strip and footer to ExamRunner"
```

---

### Task 4: `ExamRunner.jsx` — layout de 2 columnas y barra de audio rediseñada

**Files:**
- Modify: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- Consumes: la estructura de wrapper de Task 3 (no la modifica) — solo reemplaza el contenido de la rama `else` (ítem principal) dentro de la asignación de `body`.
- Produces: nada que otras tasks consuman.

- [ ] **Step 1: Reemplazar el cuerpo del ítem principal por el layout de 2 columnas**

Task 3 dejó este bloque exacto (la rama `else` que maneja el ítem principal). Reemplazarlo por completo:

```jsx
  } else if (!item) {
    return null;
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    const useSelect = SELECT_SECTIONS.has(section.type);
    body = (
      <div className="space-y-4">
        {(state.phase === 'avant' || state.phase === 'apres') && (
          <div className="text-center text-4xl font-mono text-red-600">
            00:{remaining.toString().padStart(2, '0')}
          </div>
        )}

        {state.phase === 'audio-pending' && <p className="text-center text-blue-600">Préparation de l'audio...</p>}
        {state.phase === 'audio-playing' && <p className="text-center text-blue-600">Écoute en cours...</p>}

        {(state.phase === 'audio-pending' || state.phase === 'audio-playing') && (
          <div className="max-w-md mx-auto space-y-1">
            <div className="h-2 bg-gray-300 rounded overflow-hidden">
              <div
                className="h-full bg-gray-600"
                style={{ width: `${item.duree_audio_s > 0 ? Math.min(100, (audioCurrentTime / item.duree_audio_s) * 100) : 0}%` }}
              />
            </div>
            <p className="text-center text-xs text-gray-500">
              {formatSeconds(audioCurrentTime)} / {formatSeconds(item.duree_audio_s)}
            </p>
          </div>
        )}

        <div className="space-y-6">
          {questions.map((question, questionIndex) => (
            <div key={`${item.ref}-${questionIndex}`} className="border rounded p-4 space-y-2">
              <h3 className="font-bold">{question.prompt}</h3>
              {useSelect ? (
                <OptionSelect
                  options={question.options}
                  value={itemAnswers[questionIndex]}
                  onChange={optionId => handleAnswer(questionIndex, optionId)}
                />
              ) : (
                question.options.map(opt => {
                  const selected = itemAnswers[questionIndex] === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-center gap-3 w-full text-left p-3 rounded cursor-pointer ${selected ? 'bg-gray-200' : 'hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name={`${item.ref}-q${questionIndex}`}
                        checked={selected}
                        onChange={() => handleAnswer(questionIndex, opt.id)}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="text-black">{opt.text}</span>
                    </label>
                  );
                })
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
```

Nuevo contenido:

```jsx
  } else if (!item) {
    return null;
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    const useSelect = SELECT_SECTIONS.has(section.type);
    body = (
      <div className="space-y-4">
        {(state.phase === 'avant' || state.phase === 'apres') && (
          <div className="text-center text-4xl font-mono text-red-600">
            00:{remaining.toString().padStart(2, '0')}
          </div>
        )}

        <table className="w-full border-collapse table-fixed">
          <tbody>
            <tr>
              <td className="w-[300px] align-top py-2 pr-6">
                {state.phase === 'audio-pending' && <p className="text-center text-blue-600 mb-2 text-sm">Préparation de l'audio...</p>}
                {state.phase === 'audio-playing' && <p className="text-center text-blue-600 mb-2 text-sm">Écoute en cours...</p>}
                {(state.phase === 'audio-pending' || state.phase === 'audio-playing') && (
                  <div className="relative h-[22px] bg-gray-400 rounded overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-gray-500"
                      style={{ width: `${item.duree_audio_s > 0 ? Math.min(100, (audioCurrentTime / item.duree_audio_s) * 100) : 0}%` }}
                    />
                    <div className="absolute inset-y-0 left-0 w-5 bg-gray-700 flex items-center justify-center text-white text-[9px]">
                      &#9654;
                    </div>
                    <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-mono text-gray-50">
                      {formatSeconds(audioCurrentTime)} / {formatSeconds(item.duree_audio_s)}
                    </span>
                  </div>
                )}
              </td>
              <td className="align-top py-2">
                <div className="space-y-6">
                  {questions.map((question, questionIndex) => (
                    <div key={`${item.ref}-${questionIndex}`}>
                      <h3 className="font-bold text-black mb-3">{question.prompt}</h3>
                      {useSelect ? (
                        <OptionSelect
                          options={question.options}
                          value={itemAnswers[questionIndex]}
                          onChange={optionId => handleAnswer(questionIndex, optionId)}
                        />
                      ) : (
                        question.options.map(opt => {
                          const selected = itemAnswers[questionIndex] === opt.id;
                          return (
                            <label
                              key={opt.id}
                              className={`flex items-center gap-3 w-full text-left p-3 rounded cursor-pointer ${selected ? 'bg-gray-200' : 'hover:bg-gray-50'}`}
                            >
                              <input
                                type="radio"
                                name={`${item.ref}-q${questionIndex}`}
                                checked={selected}
                                onChange={() => handleAnswer(questionIndex, opt.id)}
                                className="h-4 w-4 shrink-0"
                              />
                              <span className="text-black">{opt.text}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
```

Nota de diseño (no hay referencia oficial para esto, es una decisión propia): la cuenta regresiva de `avant`/`apres` no tiene equivalente en el simulador oficial (esa demo no está cronometrada) — se mantiene arriba de la tabla, a todo el ancho, igual que ya estaba antes de este layout de 2 columnas.

- [ ] **Step 2: Verificar el build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): redesign item screen as 2-column layout with overlay audio bar"
```

---

### Task 5: Documentación y verificación final

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: el estado final de todas las tasks anteriores (es la última task).

- [ ] **Step 1: Actualizar la descripción de `examProgress.js` en "Frontend architecture"**

Buscar esta oración en `CLAUDE.md`:

```
`examProgress.js` derives each of the 32 audio items' visual state (`completed`/`current`/`pending`) from `sectionIndex`/`itemIndex`/`phase` for the runner's non-interactive progress-tab strip.
```

Reemplazarla por:

```
`examProgress.js` derives each of the 32 audio items' visual state (`completed`/`current`/`pending`) from `sectionIndex`/`itemIndex`/`phase` for two non-interactive progress indicators: `buildProgressTabs` for the unlabeled 32-item strip at the bottom of the screen, and `buildSectionTabs` for the globally-numbered "Écran N" tab strip filtered to the current section, at the top.
```

- [ ] **Step 2: Documentar la extensión del francés a todo el chrome del runner**

En el mismo párrafo largo de `exam/` (después de la oración editada en el Step 1), buscar:

```
During `audio-pending`/`audio-playing` the runner renders a custom, non-scrubbable progress bar (driven by the shared `<audio>` element's own `timeupdate` event, not the reducer) showing elapsed/total time against `item.duree_audio_s`; the `<audio>` element itself stays `display: none` for the entire run.
```

Reemplazarla por:

```
During `audio-pending`/`audio-playing` the runner renders a custom, non-scrubbable progress bar (driven by the shared `<audio>` element's own `timeupdate` event, not the reducer) showing elapsed/total time against `item.duree_audio_s`, overlaid inside the bar itself; the `<audio>` element itself stays `display: none` for the entire run. `countAnswered` (`examMachine.js`) counts answered questions (not items) directly off `state.answers` for the header's running counter. All runner chrome text is French once `state.status === 'running'` (section titles, status/error strings, the "Abandonner" button) — a deliberate, full extension of the section-intro-only French exception from the previous slice; `SetPicker`/`ExamSummary`/`ExamReview` are unaffected.
```

- [ ] **Step 3: Actualizar la lista de módulos puros en la sección "Project"**

Buscar (sin cambios de contenido, solo confirmar que sigue diciendo "seven" — `countAnswered` se agrega a `examMachine.js`, que ya estaba en la lista, así que no hace falta editar el conteo de módulos):

```
covering the runner's pure modules (`examTiming.js`, `examMachine.js`, `examProgress.js`, `setCompatibility.js`, `examScoring.js`, `reviewModel.js`, `highlightSegments.js`)
```

Si esta línea ya dice exactamente esto (sin cambios pendientes de planes anteriores), no hacer nada en este Step — es solo una verificación, `countAnswered` y `buildSectionTabs` son funciones nuevas dentro de módulos que ya estaban en la lista.

- [ ] **Step 4: Commit de la documentación**

```bash
git add CLAUDE.md
git commit -m "docs: document buildSectionTabs, countAnswered, and the full French chrome extension"
```

- [ ] **Step 5: Correr la suite completa del frontend**

Run: `cd frontend && npm test`
Expected: todos los tests en verde (17 de `examMachine.test.js`, 8 de `examProgress.test.js`, más los módulos puros sin cambios).

- [ ] **Step 6: Correr la suite completa del backend**

Run: `cd backend && npm test`
Expected: 157/157.

- [ ] **Step 7: Build de producción del frontend**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 8: Checklist de verificación manual (obligatorio, no delegable a un agente)**

Ningún agente en este entorno tiene navegador — este paso lo hace el usuario, comparando contra las capturas de referencia y/o `lefrancaisdesaffaires.fr/documents/Tutoriel-TEF-CO/story.html`:

- [ ] El header muestra los logos reales (Le Français des Affaires + CCI Paris) y el texto "Candidat(e) / Simulateur TEFAQ" a la derecha, en las 3 pantallas del runner.
- [ ] El contador "X/36" + barra fina aparece arriba a la derecha, debajo del header, y sube a medida que se responden preguntas (no ítems).
- [ ] La franja de pestañas por sección muestra solo los ítems de la sección actual, con números GLOBALES (no reinicia en 1 en la segunda sección en adelante), y no es clicable.
- [ ] El caption "ÉCRAN N" aparece arriba del contenido, coincide con el número global del ítem actual.
- [ ] La franja inferior de 32 segmentos sigue ahí, ahora sin números.
- [ ] La pantalla de instrucciones de sección: título de sección en francés, "X questions" en vez de "X preguntas".
- [ ] La pantalla del ítem: barra de audio con ícono y tiempo superpuestos DENTRO de la barra (no al costado/debajo), sin caja roja de nota, layout de 2 columnas (audio a la izquierda, pregunta/opciones a la derecha), texto de opciones en negro, filas alineadas.
- [ ] El botón "Abandonner" (en francés) aparece al pie, alineado a la derecha, en las 3 pantallas — no hay botones de navegación reales.
- [ ] Corrida completa del examen sin regresiones: llega a Resumen → Revisión con normalidad.

Este checklist es el gate real de aceptación visual del plan.
