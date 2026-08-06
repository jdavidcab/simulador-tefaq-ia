# Exam Runner UX Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Modo Examen runner's visual UX closer to the official TEF-CO simulator: an auto-timed section-instructions screen, a non-interactive progress-tab strip, a non-scrubbable audio progress bar, and radio-button option styling.

**Architecture:** `examMachine.js` (pure reducer) gains a `section-intro` phase that replaces the existing manual-click `section-transition` phase, auto-advancing via the same `TIMER_EXPIRED` mechanism every other timed phase already uses. A new pure module, `examProgress.js`, derives the 32-tab progress strip's visual state from the reducer's state. `ExamRunner.jsx` wires both in, plus two purely presentational additions (audio progress bar, radio buttons) that don't touch the reducer at all.

**Tech Stack:** React 18, `node --test` (frontend test suite), Tailwind utility classes (no new dependencies).

## Global Constraints

- Sin navegación libre (atrás/adelante) ni corrección durante el examen — `ExamReview.jsx` sigue siendo el único lugar de corrección, sin cambios en este plan.
- `section-intro`: 15 segundos fijos, iguales para las 7 secciones (no hay dato nuevo por sección que calibrar).
- 32 pestañas de progreso (una por ítem de audio, no por pregunta — un ítem con 2 preguntas cuenta como 1) — puramente visuales, sin `onClick`, sin navegación.
- El texto de instrucciones de `section-intro` va en **francés** (excepción deliberada a la regla general "UI en español" de `CLAUDE.md`, porque imita contenido real del examen oficial); el resto del chrome de esa pantalla (botón "Abandonar", conteo de preguntas) sigue en español.
- Barra de progreso de audio: custom (no los controles nativos del navegador), sin scrubbing, usa `item.duree_audio_s` (ya persistido) como total.
- Radio buttons solo en las secciones que hoy renderizan botones de opción directos (`annonce_publique`, `repondeur`, `micro_trottoir`, `chronique`, `divers`); `interview`/`reportage` siguen usando `OptionSelect` sin cambios.
- No hay navegador de pruebas en este entorno — la verificación visual final es una comparación manual del usuario contra las capturas de referencia, y es un paso obligatorio del plan (Task 6), no opcional.

---

### Task 1: `examMachine.js` — reemplazar `section-transition` por `section-intro`

**Files:**
- Modify: `frontend/src/exam/examMachine.js`
- Test: `frontend/src/exam/examMachine.test.js` (reescritura extensa — casi todos los tests existentes arrancan de `createInitialState()` asumiendo `phase: 'avant'`, que deja de ser cierto)

**Interfaces:**
- Consumes: nada nuevo — sigue siendo `(set, state, event) -> nextState`.
- Produces: `createInitialState()` ahora arranca en `phase: 'section-intro'`. El evento `TIMER_EXPIRED` en fase `'section-intro'` transiciona a `'avant'` sin tocar `sectionIndex`/`itemIndex`. Al terminar el último ítem de una sección no final, la fase pasa directo a `'section-intro'` **con `sectionIndex` ya incrementado** (antes, el incremento ocurría en un evento `SECTION_CONTINUE` separado, que se elimina junto con `startNextSection`). Tareas 3 y 4 dependen de este contrato exacto.

- [ ] **Step 1: Reescribir `examMachine.js`**

Cambio 1 — `createInitialState`:

```js
export function createInitialState() {
  return {
    status: 'running', // 'running' | 'complete' | 'abandoned'
    sectionIndex: 0,
    itemIndex: 0,
    phase: 'section-intro', // 'section-intro' | 'avant' | 'audio-pending' | 'audio-playing' | 'audio-failed' | 'apres'
    answers: {},
  };
}
```

Cambio 2 — `advance` (el incremento de `sectionIndex` se mueve aquí, ya no depende de un evento separado):

```js
function advance(set, state) {
  const { sectionIndex, itemIndex } = state;
  if (!isLastItemInSection(set, sectionIndex, itemIndex)) {
    return { ...state, itemIndex: itemIndex + 1, phase: 'avant' };
  }
  if (!isLastSection(set, sectionIndex)) {
    return { ...state, sectionIndex: sectionIndex + 1, itemIndex: 0, phase: 'section-intro' };
  }
  return { ...state, status: 'complete' };
}
```

Cambio 3 — eliminar la función `startNextSection` por completo (ya no la usa nadie).

Cambio 4 — `TIMER_EXPIRED` gana una rama, y `SECTION_CONTINUE` se elimina:

```js
    case 'TIMER_EXPIRED': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase === 'section-intro') return { ...state, phase: 'avant' };
      if (state.phase === 'avant') return { ...state, phase: 'audio-pending' };
      if (state.phase === 'audio-playing') return { ...state, phase: 'apres' }; // watchdog
      if (state.phase === 'apres') return advance(set, state);
      return state;
    }
```

(Borrar por completo el `case 'SECTION_CONTINUE': { ... }` que existía antes.)

El resto del archivo (`ANSWER_SELECTED`, `AUDIO_PLAYING`, `AUDIO_ENDED`, `AUDIO_FAILED`, `RETRY_AUDIO`, `ABANDON`, `computeResults`, `currentToken`, `sameToken`, `sameItem`, `isLastItemInSection`, `isLastSection`) no cambia.

- [ ] **Step 2: Reemplazar el contenido completo de `examMachine.test.js`**

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

// El estado inicial arranca en 'section-intro'; todos los tests que asumen
// estar ya en 'avant' del primer ítem necesitan pasar por acá primero.
function skipIntro(set, state) {
  return dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
}

function runItemToApres(set, state) {
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // avant -> audio-pending
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_ENDED', token: currentToken(state) }); // -> apres
  return state;
}

test('el estado inicial arranca en section-intro de la primera sección', () => {
  const state = createInitialState();
  assert.equal(state.phase, 'section-intro');
  assert.equal(state.sectionIndex, 0);
  assert.equal(state.itemIndex, 0);
});

test('TIMER_EXPIRED en section-intro pasa a avant sin tocar sectionIndex/itemIndex', () => {
  const set = fixtureSet();
  const state = skipIntro(set, createInitialState());
  assert.equal(state.phase, 'avant');
  assert.equal(state.sectionIndex, 0);
  assert.equal(state.itemIndex, 0);
});

test('avant vence y pide reproducir audio', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  assert.equal(state.phase, 'audio-pending');
});

test('AUDIO_PLAYING solo aplica en audio-pending y con el token correcto', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  const staleToken = { sectionIndex: 0, itemIndex: 0, phase: 'avant' }; // token de la fase anterior
  const unchanged = dispatch(set, state, { type: 'AUDIO_PLAYING', token: staleToken });
  assert.equal(unchanged.phase, 'audio-pending', 'un token de una fase vieja no debe avanzar la máquina');
  const advanced = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  assert.equal(advanced.phase, 'audio-playing');
});

test('AUDIO_ENDED y un watchdog tardío compitiendo por el mismo ítem no avanzan dos veces', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
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
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // watchdog
  assert.equal(state.phase, 'apres');
});

test('ANSWER_SELECTED se acepta durante avant, audio-pending, audio-playing y apres', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A');

  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'B' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'B', 'debe poder cambiar la respuesta mientras el ítem sigue visible');

  // Continuar a audio-playing
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) }); // -> audio-playing
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'C' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'C', 'debe aceptar respuesta durante audio-playing');

  // Continuar a apres
  state = dispatch(set, state, { type: 'AUDIO_ENDED', token: currentToken(state) }); // -> apres
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A', 'debe aceptar respuesta durante apres');
});

test('ANSWER_SELECTED acepta token con phase desactualizado si el ítem coincide', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);

  // Estamos en phase: 'apres', pero enviamos un token con phase: 'avant' (desactualizado)
  // Si la verificación fuera sameToken en lugar de sameItem, esto fallaría.
  const stalePhaseToken = { sectionIndex: 0, itemIndex: 0, phase: 'avant' };
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: stalePhaseToken, questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A', 'debe aceptar respuesta incluso con token de phase desactualizado, siempre que el ítem coincida');
});

test('una respuesta registrada justo antes del vencimiento del deadline queda contada', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  const beforeExpiry = state;
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence, avanza
  assert.equal(beforeExpiry.answers.annonce_publique.s1i1[0], 'A');
  assert.equal(state.itemIndex, 1, 'debe avanzar al segundo ítem de la misma sección');
});

test('preguntas sin responder quedan registradas como ausentes, no se descartan', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence sin responder
  const results = computeResults(set, state.answers);
  assert.equal(results.correctBySection.annonce_publique, 0);
});

test('el último ítem de una sección dispara section-intro de la siguiente, con sectionIndex ya incrementado', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> item 2 de la sección
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // último ítem -> section-intro
  assert.equal(state.phase, 'section-intro');
  assert.equal(state.sectionIndex, 1, 'a diferencia de antes, ya cruzó a la siguiente sección en el mismo paso');
  assert.equal(state.itemIndex, 0);
});

test('TIMER_EXPIRED en section-intro de la siguiente sección pasa a avant de su primer ítem', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-intro (sección 1)
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> avant
  assert.equal(state.sectionIndex, 1);
  assert.equal(state.itemIndex, 0);
  assert.equal(state.phase, 'avant');
});

test('el último ítem del set (2 preguntas) pasa a status complete y computa el resultado', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-intro (sección 1)
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> avant, sección 1 (interview)

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
  let state = skipIntro(set, createInitialState());
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

- [ ] **Step 3: Correr los tests**

Run: `cd frontend && npm test -- --test-name-pattern examMachine`

O, si el runner no soporta filtrar por archivo así: `cd frontend && node --test src/exam/examMachine.test.js`

Expected: todos los tests de `examMachine.test.js` en verde (15 tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/exam/examMachine.js frontend/src/exam/examMachine.test.js
git commit -m "feat(exam): replace section-transition with auto-timed section-intro phase"
```

---

### Task 2: `examProgress.js` — módulo puro para el indicador de progreso

**Files:**
- Create: `frontend/src/exam/examProgress.js`
- Test: `frontend/src/exam/examProgress.test.js`

**Interfaces:**
- Consumes: un `set` con la misma forma que usa `examMachine.js` (`set.sections[].items[]`), y un `state` con `{ sectionIndex, itemIndex, phase }` (el mismo shape que produce `examMachine.js`, aunque esta función no importa nada de ese módulo — coincidencia de forma, no dependencia).
- Produces: `buildProgressTabs(set, state) -> Array<{ status: 'completed' | 'current' | 'pending' }>`, un elemento por cada ítem de audio del set (orden = orden del plan, igual que `set.sections.flatMap(s => s.items)`). Task 4 consume esta función directamente.

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressTabs } from './examProgress.js';

// Mismo fixture de 2 secciones (2 ítems + 1 ítem) que examMachine.test.js,
// para que los índices globales sean fáciles de verificar a mano.
function fixtureSet() {
  return {
    sections: [
      { type: 'annonce_publique', items: [{ ref: 's1i1' }, { ref: 's1i2' }] },
      { type: 'interview', items: [{ ref: 's2i1' }] },
    ],
  };
}

test('primer ítem del set en fase avant queda como current, el resto pending', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 0, phase: 'avant' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['current', 'pending', 'pending']);
});

test('segundo ítem de la sección: el primero queda completed', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 1, phase: 'apres' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['completed', 'current', 'pending']);
});

test('section-intro de la segunda sección: toda la sección anterior completed, nada current todavía', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'section-intro' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['completed', 'completed', 'pending']);
});

test('primer ítem de la segunda sección ya en avant: queda current', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'avant' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['completed', 'completed', 'current']);
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd frontend && node --test src/exam/examProgress.test.js`
Expected: FAIL — `Cannot find module './examProgress.js'` (el archivo todavía no existe).

- [ ] **Step 3: Implementar `examProgress.js`**

```js
// Deriva el estado visual (completado / actual / pendiente) de cada ítem de
// audio del set, para el indicador de progreso tipo "Écran N" del runner.
// Puro: no toca DOM ni reloj -- solo compara índices contra el estado del
// reducer (examMachine.js), sin importar nada de ahí.

export function buildProgressTabs(set, state) {
  const tabs = [];
  set.sections.forEach((section, sectionIndex) => {
    section.items.forEach((_item, itemIndex) => {
      tabs.push({ status: tabStatus(state, sectionIndex, itemIndex) });
    });
  });
  return tabs;
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
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/examProgress.js frontend/src/exam/examProgress.test.js
git commit -m "feat(exam): add examProgress.js, pure progress-tab state derivation"
```

---

### Task 3: `ExamRunner.jsx` — pantalla `section-intro` con timer automático

**Files:**
- Modify: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- Consumes: la fase `'section-intro'` y el contrato de `examMachine.js` de Task 1 (sectionIndex ya apunta a la sección que se introduce). `startPhase`/`remainingSeconds`/`isExpired`/`chainDeadline` de `examTiming.js` (sin cambios, mismo API que ya usa el resto del archivo).
- Produces: nada que otras tasks consuman directamente — Task 4 y 5 tocan otras partes de este mismo archivo, en paralelo estructural, no en cadena de datos.

- [ ] **Step 1: Agregar constante de duración y el texto de instrucciones**

Justo debajo de `const WATCHDOG_GRACE_MS = 1000;` (línea 6):

```js
const SECTION_INTRO_SECONDS = 15;
```

Justo debajo de la constante `SECTION_LABELS` existente (después de su línea de cierre `};`):

```js
const SECTION_INSTRUCTIONS = {
  annonce_publique: 'Vous allez entendre des annonces publiques. Écoutez chacune et répondez à la question.',
  repondeur: 'Vous allez entendre des messages de répondeur téléphonique. Écoutez chacun et répondez à la question.',
  micro_trottoir: 'Vous allez entendre un micro-trottoir : plusieurs personnes donnent leur opinion. Écoutez chacune et répondez à la question.',
  chronique: 'Vous allez entendre une chronique radiophonique. Écoutez-la attentivement et répondez aux questions.',
  interview: 'Vous allez entendre une interview. Écoutez-la attentivement et répondez aux questions.',
  reportage: 'Vous allez entendre un reportage. Écoutez-le attentivement et répondez aux questions.',
  divers: 'Vous allez entendre différents documents sonores. Écoutez chacun et répondez à la question.',
};
```

- [ ] **Step 2: Renombrar `lastApresPhaseTimingRef` a `lastPhaseTimingRef`**

Ahora encadena el deadline de `avant` desde DOS fuentes posibles (el `apres` del ítem anterior, o el `section-intro` si es el primer ítem de la sección), no solo desde `apres` — el nombre viejo ya no describe bien su rol. Cambiar la declaración:

```js
  const lastPhaseTimingRef = useRef(null);
```

(antes: `const lastApresPhaseTimingRef = useRef(null);`)

- [ ] **Step 3: Extender el efecto que ancla el deadline de fase**

Reemplazar el `useEffect` completo (el que hoy maneja `avant`/`apres`):

```js
  useEffect(() => {
    if (state.status !== 'running' || !section) return;
    if (state.phase === 'section-intro') {
      // Siempre arranca fresco: es un límite natural entre secciones, no se
      // encadena desde nada anterior.
      phaseTimingRef.current = startPhase(SECTION_INTRO_SECONDS);
      setRemaining(remainingSeconds(phaseTimingRef.current));
    } else if (state.phase === 'avant') {
      phaseTimingRef.current = lastPhaseTimingRef.current
        ? chainDeadline(lastPhaseTimingRef.current, section.timing.avant)
        : startPhase(section.timing.avant);
      lastPhaseTimingRef.current = null;
      setRemaining(remainingSeconds(phaseTimingRef.current));
    } else if (state.phase === 'apres') {
      phaseTimingRef.current = startPhase(section.timing.apres);
      setRemaining(remainingSeconds(phaseTimingRef.current));
    }
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status, section]);
```

- [ ] **Step 4: Extender el efecto del tick (intervalo de 250ms)**

Reemplazar el `useEffect` completo del intervalo:

```js
  useEffect(() => {
    if (state.status !== 'running') return;
    if (state.phase !== 'avant' && state.phase !== 'apres' && state.phase !== 'section-intro') return;

    const interval = setInterval(() => {
      const timing = phaseTimingRef.current;
      if (!timing) return;
      setRemaining(remainingSeconds(timing));
      if (isExpired(timing)) {
        if (state.phase === 'apres' || state.phase === 'section-intro') lastPhaseTimingRef.current = timing;
        dispatch({ type: 'TIMER_EXPIRED', token: currentToken(stateRef.current) });
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status]);
```

- [ ] **Step 5: Eliminar `handleSectionContinue`**

Borrar por completo esta función (ya no hace falta, `section-intro` avanza sola):

```js
  const handleSectionContinue = () => {
    lastApresPhaseTimingRef.current = null; // cruzar de sección siempre arranca fresco, no encadenado
    dispatch({ type: 'SECTION_CONTINUE' });
  };
```

- [ ] **Step 6: Reemplazar el bloque de render de `section-transition`**

```jsx
  if (state.phase === 'section-intro') {
    const introSection = set.sections[state.sectionIndex];
    const introQuestionCount = introSection.items.reduce((n, i) => n + i.questions.length, 0);
    return (
      <div className="space-y-4 text-center py-10">
        <h3 className="text-xl font-bold">{SECTION_LABELS[introSection.type]}</h3>
        <p className="text-gray-600">{introQuestionCount} preguntas</p>
        <p className="text-blue-800 font-semibold max-w-lg mx-auto px-4">{SECTION_INSTRUCTIONS[introSection.type]}</p>
        <p className="text-red-600 font-semibold max-w-lg mx-auto px-4">
          Vous avez {introSection.timing.avant} secondes avant et {introSection.timing.apres} secondes après chaque document sonore pour lire et répondre à la question.
        </p>
        <div className="text-center text-4xl font-mono text-red-600">
          00:{remaining.toString().padStart(2, '0')}
        </div>
        <button onClick={handleAbandon} className="block mx-auto text-sm text-gray-500 hover:underline">Abandonar</button>
      </div>
    );
  }
```

(reemplaza el bloque `if (state.phase === 'section-transition') { ... }` completo, incluido su botón "Continuar")

- [ ] **Step 7: Verificar que el build sigue sano**

Run: `cd frontend && npm run build`
Expected: build exitoso, sin errores de referencias rotas (`handleSectionContinue`, `lastApresPhaseTimingRef` no deben quedar referenciados en ningún lado).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): wire section-intro screen into ExamRunner with chained auto-timer"
```

---

### Task 4: `ExamRunner.jsx` — indicador de progreso tipo pestañas

**Files:**
- Modify: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- Consumes: `buildProgressTabs(set, state)` de `examProgress.js` (Task 2).
- Produces: nada que otras tasks consuman.

- [ ] **Step 1: Importar `buildProgressTabs`**

Agregar junto a los imports existentes, al tope del archivo:

```js
import { buildProgressTabs } from './examProgress';
```

- [ ] **Step 2: Agregar el componente `ProgressTabs`**

Después del componente `OptionSelect` existente, antes de `const ExamRunner = ...`:

```jsx
const ProgressTabs = ({ tabs }) => (
  <div className="flex gap-1" aria-hidden="true">
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

- [ ] **Step 3: Calcular `progressTabs` dentro de `ExamRunner`**

Justo después de la línea `const item = section?.items?.[state.itemIndex];`:

```js
  const progressTabs = buildProgressTabs(set, state);
```

- [ ] **Step 4: Renderizar la franja en las 3 pantallas**

En el bloque de `section-intro` (agregado en Task 3), justo dentro del `<div className="space-y-4 text-center py-10">` de apertura, antes del `<h3>`:

```jsx
        <ProgressTabs tabs={progressTabs} />
```

En el bloque de `audio-failed` (existente), dentro de su `<div className="space-y-4 text-center py-10">` de apertura, antes del `<p className="text-red-600">No se pudo reproducir el audio.</p>`:

```jsx
        <ProgressTabs tabs={progressTabs} />
```

En el bloque principal (el `return` final del componente, con la pregunta y las opciones), justo antes de la línea `<div className="flex items-center justify-between text-sm text-gray-500">`:

```jsx
      <ProgressTabs tabs={progressTabs} />
```

- [ ] **Step 5: Verificar el build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): add non-interactive progress-tab strip to ExamRunner"
```

---

### Task 5: `ExamRunner.jsx` — barra de audio y radio buttons

**Files:**
- Modify: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- Consumes: nada de las tasks anteriores más allá del archivo compartido.
- Produces: nada que otras tasks consuman.

- [ ] **Step 1: Agregar el helper `formatSeconds`**

Cerca del tope del archivo, junto a las otras constantes/helpers de módulo (después de `SECTION_INSTRUCTIONS`):

```js
function formatSeconds(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 2: Agregar el estado `audioCurrentTime`**

Junto a los otros `useState`/`useRef` al tope de `ExamRunner`, después de `const [remaining, setRemaining] = useState(0);`:

```js
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
```

- [ ] **Step 3: Resetear `audioCurrentTime` al arrancar cada ítem**

En el efecto que dispara `audioEl.play()` (el que entra a `audio-pending`), agregar una línea justo después de `audioEl.src = url;`:

```jsx
    audioEl.src = url;
    setAudioCurrentTime(0);
    audioEl.play().then(
```

(el resto de ese efecto no cambia)

- [ ] **Step 4: Escuchar `timeupdate` junto con `ended`**

Reemplazar el efecto persistente que escucha `ended` del `<audio>` compartido:

```jsx
  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onEnded = () => {
      if (stateRef.current.phase !== 'audio-playing') return;
      clearWatchdog();
      dispatch({ type: 'AUDIO_ENDED', token: currentToken(stateRef.current) });
    };
    const onTimeUpdate = () => setAudioCurrentTime(audioEl.currentTime);
    audioEl.addEventListener('ended', onEnded);
    audioEl.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      audioEl.removeEventListener('ended', onEnded);
      audioEl.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [audioElRef, clearWatchdog]);
```

- [ ] **Step 5: Renderizar la barra de audio**

Agregar justo después de las dos líneas existentes de estado ("Preparando audio..."/"Escuchando..."):

```jsx
      {(state.phase === 'audio-pending' || state.phase === 'audio-playing') && item && (
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
```

- [ ] **Step 6: Reemplazar las opciones por radio buttons**

Reemplazar la rama `question.options.map(...)` (la del `else` de `useSelect ? ... : ...`):

```jsx
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
                    <span>{opt.text}</span>
                  </label>
                );
              })
```

- [ ] **Step 7: Verificar el build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): add non-scrubbable audio progress bar and radio-button options"
```

---

### Task 6: Documentación y verificación final

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: el estado final de todas las tasks anteriores (es la última task).
- Produces: nada — es la task de cierre del plan.

- [ ] **Step 1: Actualizar la lista de módulos puros en la sección "Project"**

En `CLAUDE.md`, buscar esta oración (dentro del primer párrafo, sección "Project"):

```
covering the runner's pure modules (`examTiming.js`, `examMachine.js`, `setCompatibility.js`, `examScoring.js`, `reviewModel.js`, `highlightSegments.js`) — everything else in the frontend is still verified by running the app.
```

Reemplazarla por:

```
covering the runner's pure modules (`examTiming.js`, `examMachine.js`, `examProgress.js`, `setCompatibility.js`, `examScoring.js`, `reviewModel.js`, `highlightSegments.js`) — everything else in the frontend is still verified by running the app.
```

- [ ] **Step 2: Actualizar la sección "Frontend architecture"**

Buscar esta oración (dentro del párrafo largo que describe `exam/`):

```
`examMachine.js` is a pure reducer (`(set, state, event) -> nextState`) driving the per-item lockstep (`avant → audio-pending → audio-playing → apres`, plus `section-transition` between the 7 sections) — every async-originated event carries a `{sectionIndex, itemIndex, phase}` token so a stale callback (a late audio-end after a watchdog already fired, or vice versa) is a no-op instead of double-advancing.
```

Reemplazarla por:

```
`examMachine.js` is a pure reducer (`(set, state, event) -> nextState`) driving the per-item lockstep (`avant → audio-pending → audio-playing → apres`, plus a `section-intro` phase before each of the 7 sections — 15 fixed seconds of instructions/timing, auto-advancing via the same `TIMER_EXPIRED` mechanism as every other timed phase, no manual continue) — every async-originated event carries a `{sectionIndex, itemIndex, phase}` token so a stale callback (a late audio-end after a watchdog already fired, or vice versa) is a no-op instead of double-advancing. `examProgress.js` derives each of the 32 audio items' visual state (`completed`/`current`/`pending`) from `sectionIndex`/`itemIndex`/`phase` for the runner's non-interactive progress-tab strip. During `audio-pending`/`audio-playing` the shared `<audio>` element is no longer fully hidden — a custom, non-scrubbable progress bar (driven by the audio's own `timeupdate` event, not the reducer) shows elapsed/total time; the rest of the run it stays `display: none`.
```

En la misma sección, buscar:

```
All six pure modules are unit-tested; `ExamRunner.jsx`/`ExamMode.jsx`/`SetPicker.jsx`/`ExamSummary.jsx`/`ExamReview.jsx` are browser-verified only.
```

Reemplazarla por:

```
All seven pure modules are unit-tested; `ExamRunner.jsx`/`ExamMode.jsx`/`SetPicker.jsx`/`ExamSummary.jsx`/`ExamReview.jsx` are browser-verified only.
```

- [ ] **Step 3: Commit de la documentación**

```bash
git add CLAUDE.md
git commit -m "docs: document section-intro phase and examProgress.js"
```

- [ ] **Step 4: Correr la suite completa del frontend**

Run: `cd frontend && npm test`
Expected: todos los tests en verde (los de `examMachine.test.js` y `examProgress.test.js`, más los 5 módulos puros ya existentes sin cambios: `examTiming.js`, `setCompatibility.js`, `examScoring.js`, `reviewModel.js`, `highlightSegments.js`).

- [ ] **Step 5: Correr la suite completa del backend (por las dudas — este plan no toca backend, pero es la verificación de cierre estándar del proyecto)**

Run: `cd backend && npm test`
Expected: 157/157.

- [ ] **Step 6: Build de producción del frontend**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 7: Checklist de verificación manual (obligatorio, no delegable a un agente)**

Ningún agente en este entorno tiene navegador — este paso lo hace el usuario, comparando contra las capturas de referencia y/o `lefrancaisdesaffaires.fr/documents/Tutoriel-TEF-CO/story.html`:

- [ ] Al iniciar el examen (antes del primer ítem) aparece la pantalla de instrucciones de la primera sección, con cuenta regresiva de 15s visible, y avanza sola sin necesidad de hacer clic.
- [ ] El texto de instrucciones está en francés; el resto del chrome (botón Abandonar, "X preguntas") en español.
- [ ] La franja de 32 pestañas aparece en las 3 pantallas (intro de sección, ítem con pregunta, audio fallido) y no es clicable.
- [ ] Las pestañas se van coloreando de azul a medida que se completan ítems, y ningún clic sobre ellas hace nada.
- [ ] Al reproducirse el audio de un ítem aparece la barra de progreso (con `MM:SS / MM:SS`) y no se puede arrastrar/hacer clic para saltar posición.
- [ ] En las secciones que no son `interview`/`reportage`, las opciones se ven como radio buttons con la fila resaltada al seleccionar (no como botones con borde azul).
- [ ] Al terminar una sección, la siguiente pantalla de instrucciones aparece automáticamente (sin botón "Continuar" en ningún lado).
- [ ] El examen completo sigue llegando a Resumen → Revisión sin regresiones (repetir el smoke test general ya usado para `ExamReview.jsx`).

Este checklist es el gate real de aceptación visual del plan — el resto de las tasks solo garantizan que el código compila y que la lógica pura (reducer, progreso) es correcta.
