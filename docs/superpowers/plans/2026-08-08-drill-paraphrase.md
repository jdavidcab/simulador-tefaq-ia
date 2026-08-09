# Modo "Drill Paraphrase" (Fase 2, Parte B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third frontend mode, `drill/`, running 12-item bursts of very short (15-40 word) reformulation-drill listening items, with a stricter reformulation threshold and an optional type filter, built as a fully independent sibling to `exam/` — no shared React components, only imported pure logic.

**Architecture:** Backend gains a new `drill_paraphrase` section (its own preset, prompt constructor, and a per-section threshold override applied inside the existing `validarPregunta`/`checkReformulation` validation path) and a new `SET_DRILL_PARAPHRASE` set composition, generated through the existing generic pipeline with two additions: an optional type filter persisted on the set (so it survives a resume) and a `GET /api/sets` format filter so drill sets never leak into Modo Examen's picker. Frontend gains `frontend/src/drill/`, a new top-level directory mirroring `exam/`'s shape (mode → picker → runner → review) but implemented independently, importing only `exam/`'s pure, non-component modules (`examMachine.js`, `examTiming.js`, `reviewModel.js`, `highlightSegments.js`, `audioPreload.js`) — never its React components.

**Tech Stack:** Node.js (`node --test`) for backend and frontend pure-module tests; React for the new `drill/` components (browser-verified only, matching the project's existing convention for UI components).

## Global Constraints

- `drill_paraphrase` is **never** added to `GENERABLE_SECTIONS` — that constant is spread directly into `SET_STANDARD_36`/`SET_STANDARD_40` (`SET_STANDARD_36: [...GENERABLE_SECTIONS]`), and adding to it would change the real exam's question counts (36→48, 40→52). It gets its own entry in `prompt/index.js`'s `CONSTRUCTORES` dispatch object and its own `SET_COMPOSITIONS.SET_DRILL_PARAPHRASE` entry instead.
- Burst size is fixed at 12 items in this version — not user-configurable.
- `drill_paraphrase`'s reformulation-overlap threshold is `0.5` (`CONFIG.drillReformulationOverlapThreshold`), applied only to that section; all 6 existing sections keep `0.75` unchanged.
- `drill_paraphrase` draws topics from the same pool as `divers` via an alias inside `topicsForSection`, **without tagging any catalog topic with `'drill_paraphrase'`** — `catalog.test.js` already asserts every tag in every topic's `sections` array is a member of `GENERABLE_SECTIONS`, so tagging topics with a string that's deliberately excluded from `GENERABLE_SECTIONS` would break that existing test. Anti-repetition history stays independent per `sectionType` regardless (unchanged planner behavior) — sharing the pool is not the same as sharing the history.
- Zero modifications to any file under `frontend/src/exam/`. `drill/` only imports non-component functions from that directory.
- `checkReformulation`'s public contract changes from 3 to 4 parameters, the 4th being an options object: `checkReformulation(question, transcript, config, { expectedType } = {})`.
- The type-filter warning to document (not enforce further): the filter only checks the model's self-reported `reformulationType`, not a semantic verification. This must be stated near the filter control in `DrillPicker.jsx`.

---

### Task 1: Backend — `checkReformulation` gains `expectedType`, plus the drill config default

**Files:**
- Modify: `backend/src/validation/reformulation.js`
- Modify: `backend/src/examFormat.js`
- Modify: `backend/test/reformulation.test.js`
- Modify: `backend/test/examFormat.test.js`

**Interfaces:**
- Produces: `export const REFORMULATION_TYPES` (newly exported, was previously an unexported `const`) from `backend/src/validation/reformulation.js` — consumed by Task 6 (server-side whitelist validation).
- Produces: `checkReformulation(question, transcript, config, { expectedType } = {})` — new 4th parameter, backward compatible (omitting it is a no-op, identical to today's behavior). Consumed by Task 4.
- Produces: `CONFIG.drillReformulationOverlapThreshold` (`0.5`) in `backend/src/examFormat.js`. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

In `backend/test/examFormat.test.js`, add this line to the existing `'CONFIG expone los parámetros calibrables con sus defaults'` test, after the `reformulationMinTrapWords` assertion:

```js
  assert.equal(CONFIG.drillReformulationOverlapThreshold, 0.5);
```

In `backend/test/reformulation.test.js`, change the import line:

```js
import { checkReformulation, findLiteralTrapOptionIds, REFORMULATION_TYPES } from '../src/validation/reformulation.js';
```

Add these tests at the end of the file:

```js
test('REFORMULATION_TYPES está exportado con los 3 valores válidos', () => {
  assert.deepEqual(REFORMULATION_TYPES, ['nominalisation', 'synonyme', 'restructuration']);
});

test('checkReformulation acepta cuando expectedType coincide con reformulationType', () => {
  const pregunta = preguntaBase({ reformulationType: 'nominalisation' });
  assert.doesNotThrow(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG, { expectedType: 'nominalisation' }));
});

test('checkReformulation rechaza cuando expectedType no coincide con reformulationType', () => {
  const pregunta = preguntaBase({ reformulationType: 'nominalisation' });
  assert.throws(
    () => checkReformulation(pregunta, TRANSCRIPT, CONFIG, { expectedType: 'synonyme' }),
    /se pidió el tipo "synonyme" pero el modelo generó "nominalisation"/,
  );
});

test('checkReformulation es un no-op de tipo cuando no se pasa expectedType', () => {
  const pregunta = preguntaBase();
  assert.doesNotThrow(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG));
  assert.doesNotThrow(() => checkReformulation(preguntaBase(), TRANSCRIPT, CONFIG, {}));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/reformulation.test.js test/examFormat.test.js`
Expected: FAIL — `REFORMULATION_TYPES` isn't exported yet (import error), `CONFIG.drillReformulationOverlapThreshold` is `undefined`, `checkReformulation`'s 4th parameter doesn't exist yet so the mismatch case never throws.

- [ ] **Step 3: Add the config default**

In `backend/src/examFormat.js`, in the `CONFIG` object, add one line after `reformulationMinTrapWords: 2,`:

```js
  drillReformulationOverlapThreshold: 0.5,  // umbral más estricto, solo para drill_paraphrase
```

- [ ] **Step 4: Export `REFORMULATION_TYPES` and add `expectedType`**

In `backend/src/validation/reformulation.js`, change `const REFORMULATION_TYPES` to `export const REFORMULATION_TYPES`, and replace the `checkReformulation` function signature and its final section (from the `reformulationType` validity check onward) with:

```js
export function checkReformulation(question, transcript, config, { expectedType } = {}) {
  const correctOption = question.options.find(option => option.id === question.correctId);

  const overlapScore = scoreJustification(correctOption.text, question.justification);
  if (overlapScore > config.reformulationOverlapThreshold) {
    throw new Error(
      `reformulation: la opción correcta solapa ${(overlapScore * 100).toFixed(0)}% con el audio `
      + `(máximo ${(config.reformulationOverlapThreshold * 100).toFixed(0)}%) -- no está reformulada`,
    );
  }

  const trapIds = findLiteralTrapOptionIds(question, transcript, config);
  if (trapIds.length === 0) {
    throw new Error(
      `reformulation: ningún distractor recicla al menos ${config.reformulationMinTrapWords} `
      + 'palabras literales del audio (trampa obligatoria ausente)',
    );
  }

  if (!REFORMULATION_TYPES.includes(question.reformulationType)) {
    throw new Error(
      `reformulation: "reformulationType" debe ser uno de ${REFORMULATION_TYPES.join('|')}, `
      + `llegó "${question.reformulationType}"`,
    );
  }

  if (expectedType && question.reformulationType !== expectedType) {
    throw new Error(
      `reformulation: se pidió el tipo "${expectedType}" pero el modelo generó "${question.reformulationType}"`,
    );
  }

  for (const option of question.options) {
    if (trapIds.includes(option.id)) option.literalTrap = true;
  }

  question.reformulation = {
    extrait_audio: question.justification,
    option_correcte: correctOption.text,
    type: question.reformulationType,
  };
}
```

(Only the signature line and the two new blocks — `REFORMULATION_TYPES` export and the `expectedType` check — are new; everything else in the function is unchanged from what's already there.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test test/reformulation.test.js test/examFormat.test.js`
Expected: PASS (12 tests in `reformulation.test.js`: the original 8 plus 4 new; `examFormat.test.js` unchanged count, one assertion added to an existing test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/validation/reformulation.js backend/src/examFormat.js backend/test/reformulation.test.js backend/test/examFormat.test.js
git commit -m "feat: add checkReformulation expectedType option and drill threshold config"
```

---

### Task 2: Backend — `drill_paraphrase` section preset, composition, and topic pool alias

**Files:**
- Modify: `backend/src/examFormat.js`
- Modify: `backend/src/topics/catalog.js`
- Modify: `backend/test/examFormat.test.js`
- Modify: `backend/test/catalog.test.js`

**Interfaces:**
- Produces: `SECTION_PRESETS.drill_paraphrase` = `{ bloc: 0, questions: 12, avant: 5, apres: 10, questionsPerAudio: 1, minWords: 15, maxWords: 40, lectures: 1 }`.
- Produces: `SET_COMPOSITIONS.SET_DRILL_PARAPHRASE` = `['drill_paraphrase']`.
- Produces: `topicsForSection('drill_paraphrase', catalog)` returns the same topics as `topicsForSection('divers', catalog)` (alias, no catalog data change). Consumed by Task 5's pipeline tests.

- [ ] **Step 1: Write the failing tests**

In `backend/test/examFormat.test.js`, update the existing `'los 8 tipos de sección están declarados'` test (it will need a new name and a 9th key):

```js
test('los 9 tipos de sección están declarados', () => {
  assert.deepEqual(Object.keys(SECTION_PRESETS).sort(), [
    'annonce_publique', 'chronique', 'conversation_image', 'divers', 'drill_paraphrase',
    'interview', 'micro_trottoir', 'repondeur', 'reportage',
  ]);
});
```

Add these new tests at the end of the file:

```js
test('drill_paraphrase no se agrega a GENERABLE_SECTIONS ni cambia SET_STANDARD_36/40', () => {
  assert.ok(!GENERABLE_SECTIONS.includes('drill_paraphrase'));
  assert.equal(GENERABLE_SECTIONS.length, 7);
  assert.equal(totalQuestions('SET_STANDARD_36'), 36);
  assert.equal(totalQuestions('SET_STANDARD_40'), 40);
});

test('SET_DRILL_PARAPHRASE es una composición de un solo tipo con 12 preguntas', () => {
  assert.deepEqual(SET_COMPOSITIONS.SET_DRILL_PARAPHRASE, ['drill_paraphrase']);
  assert.equal(totalQuestions('SET_DRILL_PARAPHRASE'), 12);
  assert.deepEqual(sectionDemand('SET_DRILL_PARAPHRASE'), { drill_paraphrase: 12 });
});
```

In `backend/test/catalog.test.js`, add this test at the end:

```js
test('topicsForSection("drill_paraphrase") usa el mismo pool que divers, sin etiquetar temas nuevos', () => {
  const divers = topicsForSection('divers');
  const drill = topicsForSection('drill_paraphrase');
  assert.deepEqual(drill.map(t => t.id).sort(), divers.map(t => t.id).sort());
  assert.ok(drill.length >= 48, `pool de drill_paraphrase (${drill.length}) por debajo del mínimo 48 (demanda 12 x ventana+1)`);
  assert.ok(!TOPICS.some(t => t.sections.includes('drill_paraphrase')), 'ningún tema debe etiquetarse literalmente drill_paraphrase');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/examFormat.test.js test/catalog.test.js`
Expected: FAIL — `SECTION_PRESETS` still has 8 keys, `SET_COMPOSITIONS.SET_DRILL_PARAPHRASE` is `undefined`, `topicsForSection('drill_paraphrase')` returns `[]` (no alias yet).

- [ ] **Step 3: Add the preset and composition**

In `backend/src/examFormat.js`, add a new entry to `SECTION_PRESETS` (alphabetical position doesn't matter for the object itself, only the test's sorted assertion — insert it anywhere, e.g. right after `divers`):

```js
  drill_paraphrase:   { bloc: 0,  questions: 12, avant: 5,  apres: 10, questionsPerAudio: 1, minWords: 15, maxWords: 40, lectures: 1 },
```

Add a new key to `SET_COMPOSITIONS` (leave `GENERABLE_SECTIONS` completely untouched):

```js
export const SET_COMPOSITIONS = {
  SET_STANDARD_36: [...GENERABLE_SECTIONS],
  SET_STANDARD_40: ['conversation_image', ...GENERABLE_SECTIONS],
  SET_DRILL_PARAPHRASE: ['drill_paraphrase'],
};
```

- [ ] **Step 4: Add the topic pool alias**

In `backend/src/topics/catalog.js`, replace `topicsForSection`:

```js
export function topicsForSection(sectionType, catalog = TOPICS) {
  // drill_paraphrase no tiene temas propios etiquetados en el catálogo --
  // usa el mismo pool que divers (el más amplio) sin tocar los datos, para
  // no romper el test que exige que todo tag en topic.sections pertenezca
  // a GENERABLE_SECTIONS (drill_paraphrase se excluye de esa constante a
  // propósito, ver examFormat.js).
  const efectivo = sectionType === 'drill_paraphrase' ? 'divers' : sectionType;
  return catalog.filter(topic => topic.sections.includes(efectivo));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test test/examFormat.test.js test/catalog.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS. This confirms nothing else (other tests iterating `SECTION_PRESETS`/`GENERABLE_SECTIONS`) broke from the new preset entry.

- [ ] **Step 7: Commit**

```bash
git add backend/src/examFormat.js backend/src/topics/catalog.js backend/test/examFormat.test.js backend/test/catalog.test.js
git commit -m "feat: add drill_paraphrase section preset, composition, and topic pool alias"
```

---

### Task 3: Backend — `drill_paraphrase` prompt constructor

**Files:**
- Create: `backend/src/prompt/sections/drill_paraphrase.js`
- Modify: `backend/src/prompt/index.js`
- Modify: `backend/test/prompt.test.js`

**Interfaces:**
- Consumes: `bloquePerfil`, `bloquePatron`, `reglasComunes`, `esquemaJson` from `backend/src/prompt/common.js` (all unchanged, existing exports).
- Produces: `build(ctx)` in `drill_paraphrase.js`, registered in `prompt/index.js`'s `CONSTRUCTORES` under the key `'drill_paraphrase'`. Reads `ctx.expectedReformulationType` (a new optional field threaded by Task 4) to inject a forced-type instruction.

- [ ] **Step 1: Write the failing tests**

In `backend/test/prompt.test.js`, add these tests at the end of the file:

```js
test('drill_paraphrase fuerza 15-40 palabras sin importar lo que llegue en ctx', () => {
  const prompt = buildSectionPrompt('drill_paraphrase', { ...BASE, minWords: 999, maxWords: 999 });
  assert.ok(prompt.includes('entre 15 y 40 palabras'));
  assert.ok(!prompt.includes('999'));
});

test('drill_paraphrase sin filtro de tipo no menciona una transformación forzada', () => {
  const prompt = buildSectionPrompt('drill_paraphrase', BASE);
  assert.ok(!/específicamente/i.test(prompt));
});

test('drill_paraphrase con filtro de tipo inyecta la instrucción forzada correspondiente', () => {
  const conNominalizacion = buildSectionPrompt('drill_paraphrase', { ...BASE, expectedReformulationType: 'nominalisation' });
  assert.match(conNominalizacion, /específicamente una NOMINALIZACIÓN/);

  const conSinonimo = buildSectionPrompt('drill_paraphrase', { ...BASE, expectedReformulationType: 'synonyme' });
  assert.match(conSinonimo, /específicamente un SINÓNIMO/);

  const conRestructuracion = buildSectionPrompt('drill_paraphrase', { ...BASE, expectedReformulationType: 'restructuration' });
  assert.match(conRestructuracion, /específicamente una RESTRUCTURACIÓN/);
});

test('drill_paraphrase hereda la regla de reformulación y la trampa literal como las demás 6 secciones', () => {
  const prompt = buildSectionPrompt('drill_paraphrase', BASE);
  assert.match(prompt, /nominalisation/i);
  assert.match(prompt, /trampa de reconocimiento superficial/i);
  assert.ok(prompt.includes('reformulationType'));
  assert.ok(prompt.includes('justification'));
  assert.ok(prompt.includes('"questions"'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/prompt.test.js`
Expected: FAIL — `buildSectionPrompt('drill_paraphrase', ...)` throws `No hay constructor de prompt para "drill_paraphrase"` (no constructor registered yet).

- [ ] **Step 3: Create the prompt constructor**

Create `backend/src/prompt/sections/drill_paraphrase.js`:

```js
// backend/src/prompt/sections/drill_paraphrase.js
//
// Prompt dedicado para el modo Drill Paraphrase (Fase 2, Parte B): audios
// muy cortos (15-40 palabras) para repetición concentrada del salto
// oral->escrito. Fuerza el rango de palabras literalmente, sin usar
// ctx.minWords/ctx.maxWords -- mismo patrón defensivo que
// conversation_image.js fuerza difficulty:'B1' sin usar ctx.difficulty,
// aunque hoy ningún llamador real pasaría un rango distinto (el pipeline
// nunca sobreescribe minWords/maxWords para esta sección).
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';

const REFORMULATION_TYPE_INSTRUCTIONS = {
  nominalisation: 'La transformación de la respuesta correcta para este ítem debe ser específicamente una NOMINALIZACIÓN (verbo → sustantivo). No elijas otro tipo.',
  synonyme: 'La transformación de la respuesta correcta para este ítem debe ser específicamente un SINÓNIMO (palabras equivalentes). No elijas otro tipo.',
  restructuration: 'La transformación de la respuesta correcta para este ítem debe ser específicamente una RESTRUCTURACIÓN (reordenamiento sintáctico). No elijas otro tipo.',
};

export function build(ctx) {
  const instruccionTipo = REFORMULATION_TYPE_INSTRUCTIONS[ctx.expectedReformulationType] ?? '';
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN mensaje muy corto de comprensión oral para un ejercicio de práctica concentrada de reformulación.
El mensaje ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un mensaje breve de la vida cotidiana (aviso, contestador, anuncio) con UN único hecho claro que la respuesta correcta deberá reformular.

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes({ minWords: 15, maxWords: 40, questionsPerAudio: ctx.questionsPerAudio, verticalScan: ctx.verticalScan })}
${instruccionTipo ? `\n${instruccionTipo}\n` : ''}
${esquemaJson(ctx.questionsPerAudio)}`;
}
```

- [ ] **Step 4: Register the constructor**

In `backend/src/prompt/index.js`, add the import:

```js
import { build as drill_paraphrase } from './sections/drill_paraphrase.js';
```

Add it to `CONSTRUCTORES`:

```js
const CONSTRUCTORES = {
  conversation_image, annonce_publique, repondeur, micro_trottoir, chronique, interview, reportage, divers, drill_paraphrase,
};
```

`buildSectionPrompt` itself needs one more change: it must forward `expectedReformulationType` from `opts` into the object it builds for `build(...)`:

```js
export function buildSectionPrompt(sectionType, opts = {}) {
  const build = CONSTRUCTORES[sectionType];
  if (!build) {
    throw new Error(`No hay constructor de prompt para "${sectionType}"`);
  }

  const preset = SECTION_PRESETS[sectionType];
  return build({
    topic: opts.topic,
    difficulty: opts.difficulty ?? 'B2',
    posture: opts.posture,
    pattern: opts.pattern ?? pickTefaqPattern(),
    minWords: opts.minWords ?? preset.minWords,
    maxWords: opts.maxWords ?? preset.maxWords,
    questionsPerAudio: preset.questionsPerAudio,
    verticalScan: Boolean(opts.verticalScan),
    expectedReformulationType: opts.expectedReformulationType,
  });
}
```

(Only the added `expectedReformulationType: opts.expectedReformulationType,` line and the `drill_paraphrase` entries are new — everything else in this file is unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test test/prompt.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS. Confirms the `expectedReformulationType` addition to `buildSectionPrompt`'s output object doesn't break any existing section's prompt (it's simply `undefined` for all of them, same as before).

- [ ] **Step 7: Commit**

```bash
git add backend/src/prompt/sections/drill_paraphrase.js backend/src/prompt/index.js backend/test/prompt.test.js
git commit -m "feat: add drill_paraphrase prompt constructor with forced type filter support"
```

---

### Task 4: Backend — thread `expectedReformulationType` through validation and item generation

**Files:**
- Modify: `backend/src/validation/index.js`
- Modify: `backend/src/itemGenerator.js`
- Modify: `backend/test/validation.test.js`
- Modify: `backend/test/itemGenerator.test.js`

**Interfaces:**
- Consumes: `checkReformulation(question, transcript, config, { expectedType })` (Task 1), `CONFIG.drillReformulationOverlapThreshold` (Task 1), `buildSectionPrompt`'s `expectedReformulationType` passthrough (Task 3).
- Produces: `validateItem(item, sectionType, opts)` accepts a new optional `opts.expectedReformulationType`. `createItemGenerator(...).generateItem(opts)` accepts a new optional `opts.expectedReformulationType`, threading it to both `buildSectionPrompt` and `validateItem`. Consumed by Task 5 (`pipeline.js`'s `run()`).

- [ ] **Step 1: Write the failing tests**

In `backend/test/validation.test.js`, add these tests at the end of the file (uses the existing `palabras()` helper already defined near the top of the file):

```js
function preguntaDrillValida(transcript, overrides = {}) {
  return {
    prompt: 'Quel est le message ?',
    options: [
      { id: 'A', text: 'Fermeture temporaire du service' },
      { id: 'B', text: `On ferme le service ${transcript.split(' ')[0]} ${transcript.split(' ')[1]}` },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
    correctId: 'A',
    feedback: 'f',
    justification: transcript.split(' ').slice(0, 10).join(' '),
    reformulationType: 'nominalisation',
    ...overrides,
  };
}

test('drill_paraphrase usa el umbral 0.5, más estricto que las demás secciones (0.75)', () => {
  const transcript = palabras(25);
  const justification = transcript.split(' ').slice(0, 10).join(' '); // mot0..mot9
  // "mot0 mot2 mot4 mot50" comparte 3 de sus 4 palabras de contenido con la
  // justification (mot0, mot2, mot4 están en mot0..mot9; mot50 no) --
  // overlap exacto 0.75, y NO es substring literal de la justification (el
  // orden/huecos evitan el atajo de coincidencia exacta de scoreJustification).
  const preguntaConSolapamiento075 = {
    prompt: 'Quel est le message ?',
    options: [
      { id: 'A', text: 'mot0 mot2 mot4 mot50' },
      { id: 'B', text: 'On ferme le service mot20 mot21' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
    correctId: 'A',
    feedback: 'f',
    justification,
    reformulationType: 'nominalisation',
  };

  assert.throws(
    () => validateItem({ transcript, questions: [preguntaConSolapamiento075] }, 'drill_paraphrase', { minWords: 15, maxWords: 40 }),
    /solapa/,
  );
  assert.doesNotThrow(
    () => validateItem({ transcript, questions: [preguntaConSolapamiento075] }, 'annonce_publique', { minWords: 15, maxWords: 40 }),
  );
});

test('un solapamiento exactamente en el umbral de drill (0.5) se acepta, no se rechaza', () => {
  const transcript = palabras(25);
  const justification = transcript.split(' ').slice(0, 10).join(' '); // mot0..mot9
  // "mot0 mot50" comparte 1 de sus 2 palabras de contenido con la
  // justification -- overlap exacto 0.5. La condición de rechazo es
  // estrictamente `overlapScore > threshold`, así que 0.5 no debe rechazarse.
  const preguntaEnElUmbral = {
    prompt: 'Quel est le message ?',
    options: [
      { id: 'A', text: 'mot0 mot50' },
      { id: 'B', text: 'On ferme le service mot20 mot21' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
    correctId: 'A',
    feedback: 'f',
    justification,
    reformulationType: 'nominalisation',
  };
  assert.doesNotThrow(
    () => validateItem({ transcript, questions: [preguntaEnElUmbral] }, 'drill_paraphrase', { minWords: 15, maxWords: 40 }),
  );
});

test('validateItem pasa expectedReformulationType hasta checkReformulation', () => {
  const transcript = palabras(25);
  const item = { transcript, questions: [preguntaDrillValida(transcript)] };
  assert.doesNotThrow(() => validateItem(item, 'drill_paraphrase', {
    minWords: 15, maxWords: 40, expectedReformulationType: 'nominalisation',
  }));

  const itemMismatch = { transcript, questions: [preguntaDrillValida(transcript)] };
  assert.throws(
    () => validateItem(itemMismatch, 'drill_paraphrase', { minWords: 15, maxWords: 40, expectedReformulationType: 'synonyme' }),
    /se pidió el tipo "synonyme"/,
  );
});
```

In `backend/test/itemGenerator.test.js`, add this test at the end of the file:

```js
test('generateItem pasa expectedReformulationType al prompt y a la validación', async () => {
  const transcript = Array.from({ length: 25 }, (_, i) => `mot${i}`).join(' ');
  const itemJsonDrill = JSON.stringify({
    transcript,
    questions: [{
      prompt: 'Quel est le message ?',
      options: [
        { id: 'A', text: 'Une option plausible' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot10 et mot11' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible' },
      ],
      correctId: 'A',
      feedback: 'f',
      justification: transcript.split(' ').slice(0, 10).join(' '),
      reformulationType: 'synonyme',
    }],
  });
  const gemini = proveedorFake('gemini', [itemJsonDrill]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({
    sectionType: 'drill_paraphrase', topic: 'un aviso corto', difficulty: 'B2',
    expectedReformulationType: 'synonyme', selector: ['gemini'],
  });
  assert.equal(item.questions[0].reformulation.type, 'synonyme');
  assert.ok(gemini.llamadas[0].includes('específicamente un SINÓNIMO'), 'el prompt enviado debe incluir la instrucción forzada');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/validation.test.js test/itemGenerator.test.js`
Expected: FAIL — `validateItem`/`generateItem` don't accept `expectedReformulationType` yet, so the drill threshold never applies (the "más estricto" test doesn't see a rejection) and the mismatch case never throws.

- [ ] **Step 3: Thread `expectedReformulationType` through `validation/index.js`**

Replace `validarPregunta` and its call site in `backend/src/validation/index.js`:

```js
function validarPregunta(question, transcript, config, expectedOptions = 4, sectionType, expectedReformulationType) {
  if (!question || typeof question !== 'object') throw new Error('pregunta inválida');
  if (typeof question.prompt !== 'string' || !question.prompt.trim()) throw new Error('falta "prompt"');

  if (!Array.isArray(question.options) || question.options.length !== expectedOptions) {
    throw new Error(`"options" debe ser un array de ${expectedOptions} elementos`);
  }
  for (const option of question.options) {
    if (!option || typeof option.id !== 'string' || typeof option.text !== 'string' || !option.text.trim()) {
      throw new Error('opción inválida (cada una requiere "id" y "text")');
    }
  }

  if (!['A', 'B', 'C', 'D'].includes(question.correctId)) throw new Error('"correctId" debe ser A, B, C o D');
  if (!question.options.some(option => option.id === question.correctId)) {
    throw new Error('"correctId" no coincide con ninguna opción');
  }
  if (typeof question.feedback !== 'string' || !question.feedback.trim()) throw new Error('falta "feedback"');

  const cita = checkJustification(question.justification, transcript, config);
  if (!cita.ok) throw new Error(cita.error);
  question.justificationScore = cita.score;

  if (sectionType !== 'micro_trottoir' && sectionType !== 'conversation_image') {
    const configEfectivo = sectionType === 'drill_paraphrase'
      ? { ...config, reformulationOverlapThreshold: config.drillReformulationOverlapThreshold }
      : config;
    checkReformulation(question, transcript, configEfectivo, { expectedType: expectedReformulationType });
  }
}
```

And the call site inside `validateItem` (currently `for (const question of item.questions) validarPregunta(question, item.transcript, config, expectedOptions, sectionType);`):

```js
  for (const question of item.questions) {
    validarPregunta(question, item.transcript, config, expectedOptions, sectionType, opts.expectedReformulationType);
  }
```

- [ ] **Step 4: Thread `expectedReformulationType` through `itemGenerator.js`**

In `backend/src/itemGenerator.js`, inside `generateItem(opts)`, change the destructure and both downstream calls:

```js
    async generateItem(opts) {
      const { sectionType, topic, difficulty, posture, expectedReformulationType } = opts;
      const cadena = opts.selector ?? AUTO_CHAIN;
      const disponibles = cadena.filter(key => providers[key]);

      if (disponibles.length === 0) {
        const error = new Error(`Ningún provider de la cadena [${cadena.join(' → ')}] está configurado`);
        error.providersTried = [];
        throw error;
      }

      const prompt = buildSectionPrompt(sectionType, {
        topic, difficulty, posture, expectedReformulationType,
        minWords: opts.minWords, maxWords: opts.maxWords, verticalScan: opts.verticalScan,
      });
```

And the `validateItem` call further down:

```js
            const validado = validateItem(bruto, sectionType, {
              config, posture, expectedReformulationType, minWords: opts.minWords, maxWords: opts.maxWords,
            });
```

(Only `expectedReformulationType` is new in both call sites — everything else is unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test test/validation.test.js test/itemGenerator.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/validation/index.js backend/src/itemGenerator.js backend/test/validation.test.js backend/test/itemGenerator.test.js
git commit -m "feat: thread expectedReformulationType through validation and generateItem"
```

---

### Task 5: Backend — pipeline support for `SET_DRILL_PARAPHRASE`, persisted type filter

**Files:**
- Modify: `backend/src/sets/pipeline.js`
- Modify: `backend/test/pipeline.test.js`

**Interfaces:**
- Consumes: `SET_COMPOSITIONS.SET_DRILL_PARAPHRASE` (Task 2), `generator.generateItem({..., expectedReformulationType})` (Task 4).
- Produces: `createSet({..., typeFilter})` persists `set.drill = { expectedReformulationType: typeFilter ?? null }` whenever `format === 'SET_DRILL_PARAPHRASE'` (`undefined` for every other format). `run()` reads `set.drill?.expectedReformulationType` and passes it to every `generateItem` call regardless of section type (a no-op for non-drill sections, since only `drill_paraphrase`'s validation path acts on it). Consumed by Task 6 (the HTTP route).

- [ ] **Step 1: Write the failing tests**

In `backend/test/pipeline.test.js`, add these tests at the end of the file (reuses `nuevoPipeline()`/`catalogoAmplio()`, whose fake catalog already tags 60 topics `divers` — plenty for `drill_paraphrase`'s aliased pool of 12):

```js
test('createSet rechaza formato SET_DRILL_PARAPHRASE hasta agregarlo a FORMATOS_SOPORTADOS', async () => {
  const { pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 30, format: 'SET_DRILL_PARAPHRASE' });
  assert.equal(set.format, 'SET_DRILL_PARAPHRASE');
  assert.equal(set.plan.length, 12);
});

test('createSet rechaza pilotes:true con SET_DRILL_PARAPHRASE', async () => {
  const { pipeline } = await nuevoPipeline();
  await assert.rejects(
    () => pipeline.createSet({ seed: 31, format: 'SET_DRILL_PARAPHRASE', pilotes: true }),
    /pilot/i,
  );
});

test('createSet persiste el typeFilter en set.drill.expectedReformulationType', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 32, format: 'SET_DRILL_PARAPHRASE', typeFilter: 'nominalisation' });
  assert.deepEqual(set.drill, { expectedReformulationType: 'nominalisation' });

  const persistido = await readSet(dataDir, set.id);
  assert.deepEqual(persistido.drill, { expectedReformulationType: 'nominalisation' });
});

test('createSet sin typeFilter persiste set.drill con expectedReformulationType null', async () => {
  const { pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 33, format: 'SET_DRILL_PARAPHRASE' });
  assert.deepEqual(set.drill, { expectedReformulationType: null });
});

test('createSet con formatos que no son drill nunca trae set.drill', async () => {
  const { pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 34 });
  assert.equal(set.drill, undefined);
});

test('run pasa expectedReformulationType al generador para cada ítem de un set drill', async () => {
  const recibidos = [];
  const generatorQueRegistra = {
    async generateItem(opts) {
      recibidos.push(opts.expectedReformulationType);
      return generadorFake().generateItem(opts);
    },
  };
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-drill-'));
  const pipeline = createPipeline({ dataDir, generator: generatorQueRegistra, synth: synthFake(), catalog: catalogoAmplio() });
  const set = await pipeline.createSet({ seed: 35, format: 'SET_DRILL_PARAPHRASE', typeFilter: 'restructuration' });
  await pipeline.run(set.id);

  assert.equal(recibidos.length, 12);
  assert.ok(recibidos.every(t => t === 'restructuration'));
});

test('el typeFilter persistido sobrevive una reanudación en una instancia de pipeline distinta', async () => {
  const recibidosPrimeraCorrida = [];
  const generatorPrimeraCorrida = {
    async generateItem(opts) {
      recibidosPrimeraCorrida.push(opts.expectedReformulationType);
      return generadorFake().generateItem(opts);
    },
  };
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-drill-resume-'));
  const primerPipeline = createPipeline({
    dataDir, generator: generatorPrimeraCorrida, synth: synthFake(), catalog: catalogoAmplio(),
  });
  const set = await primerPipeline.createSet({ seed: 37, format: 'SET_DRILL_PARAPHRASE', typeFilter: 'synonyme' });
  await primerPipeline.run(set.id, { maxItems: 4 });
  assert.equal(recibidosPrimeraCorrida.length, 4);
  assert.ok(recibidosPrimeraCorrida.every(t => t === 'synonyme'));

  // Instancia de pipeline COMPLETAMENTE NUEVA (simula un proceso distinto
  // reanudando vía POST /api/sets/:id/resume) -- nunca recibe typeFilter en
  // su propia llamada a run(), así que si el filtro sobrevive, solo puede
  // ser porque lo leyó de set.drill.expectedReformulationType en disco.
  const recibidosSegundaCorrida = [];
  const generatorSegundaCorrida = {
    async generateItem(opts) {
      recibidosSegundaCorrida.push(opts.expectedReformulationType);
      return generadorFake().generateItem(opts);
    },
  };
  const segundoPipeline = createPipeline({
    dataDir, generator: generatorSegundaCorrida, synth: synthFake(), catalog: catalogoAmplio(),
  });
  await segundoPipeline.run(set.id);

  assert.equal(recibidosSegundaCorrida.length, 8, 'deben quedar 8 ítems por generar (12 - 4 de la primera corrida)');
  assert.ok(recibidosSegundaCorrida.every(t => t === 'synonyme'), 'el filtro debe leerse de set.drill persistido, no de la llamada actual');
});

test('run sigue funcionando sin expectedReformulationType para sets no-drill (no-op)', async () => {
  const recibidos = [];
  const generatorQueRegistra = {
    async generateItem(opts) {
      recibidos.push(opts.expectedReformulationType);
      return generadorFake().generateItem(opts);
    },
  };
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-drill-'));
  const pipeline = createPipeline({ dataDir, generator: generatorQueRegistra, synth: synthFake(), catalog: catalogoAmplio() });
  const set = await pipeline.createSet({ seed: 36 });
  await pipeline.run(set.id, { maxItems: 2 });

  assert.ok(recibidos.every(t => t === undefined));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/pipeline.test.js`
Expected: FAIL — `SET_DRILL_PARAPHRASE` isn't in `FORMATOS_SOPORTADOS` yet (`createSet` rejects with "Formato no soportado"), no pilotes guard exists for it, `set.drill` is never assigned, and `run()` never passes `expectedReformulationType`.

- [ ] **Step 3: Update `pipeline.js`**

In `backend/src/sets/pipeline.js`, update `FORMATOS_SOPORTADOS`:

```js
const FORMATOS_SOPORTADOS = ['SET_STANDARD_36', 'SET_STANDARD_40', 'SET_DRILL_PARAPHRASE'];
```

Add the pilotes guard right after the existing `SET_STANDARD_40` one, and update `createSet`'s destructure and the `set` object construction:

```js
    async createSet({ difficulty = 'B2', format = 'SET_STANDARD_36', pilotes = false, seed, typeFilter } = {}) {
      if (!FORMATOS_SOPORTADOS.includes(format)) {
        const error = new Error(`Formato no soportado: "${format}". Soportados: ${FORMATOS_SOPORTADOS.join(', ')}.`);
        error.status = 400;
        throw error;
      }
      if (format === 'SET_STANDARD_40' && pilotes) {
        const error = new Error('SET_STANDARD_40 ya trae las 40 preguntas reales; no admite "pilotes" (darían 44).');
        error.status = 400;
        throw error;
      }
      if (format === 'SET_DRILL_PARAPHRASE' && pilotes) {
        const error = new Error('SET_DRILL_PARAPHRASE no admite "pilotes" (el tamaño de la ráfaga es fijo).');
        error.status = 400;
        throw error;
      }

      const semilla = seed ?? Math.floor(Math.random() * 2 ** 31);
      const recentPlans = await readRecentPlans(join(dataDir, 'sets'), config.historyWindow);
      const { plan, relaxations } = planTopics({
        catalog, compositionKey: format, recentPlans, seed: semilla, pilotes, config,
      });

      const porSeccion = new Map();
      for (const entrada of plan) {
        if (!porSeccion.has(entrada.sectionType)) porSeccion.set(entrada.sectionType, []);
        porSeccion.get(entrada.sectionType).push(entrada);
      }

      const set = {
        id: nuevoSetId(),
        genere_le: new Date().toISOString(),
        statut: 'partial',
        format, formatVersion: 1, difficulty, pilotes, seed: semilla,
        plan, relaxations,
        ledger: {
          texte: { appels: 0, echecs: 0 },
          tts: { appels: 0, echecs: 0 },
          images: { appels: 0, echecs: 0 },
        },
        sections: SET_COMPOSITIONS[format].map(type => {
          const preset = SECTION_PRESETS[type];
          return {
            type,
            timing: { avant: preset.avant, apres: preset.apres },
            lectures: preset.lectures,
            items: (porSeccion.get(type) ?? []).map(entrada => ({
              ref: entrada.ref,
              etat: 'en_attente',
              topicId: entrada.topicId,
              sujet: type === 'conversation_image'
                ? categoryById(entrada.topicId)?.label ?? ''
                : topicById(entrada.topicId, catalog)?.text ?? '',
              posture: entrada.posture,
              pilote: entrada.pilote,
              images: [],
            })),
          };
        }),
      };

      if (format === 'SET_DRILL_PARAPHRASE') {
        set.drill = { expectedReformulationType: typeFilter ?? null };
      }

      await writeSet(dataDir, set);
      return set;
    },
```

In `run()`, add `expectedReformulationType: set.drill?.expectedReformulationType` to the `generator.generateItem(...)` call:

```js
              const generado = await generator.generateItem({
                sectionType,
                topic: item.sujet,
                topicId: item.topicId,
                difficulty: set.difficulty,
                posture: item.posture,
                expectedReformulationType: set.drill?.expectedReformulationType,
              });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/pipeline.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/sets/pipeline.js backend/test/pipeline.test.js
git commit -m "feat: support SET_DRILL_PARAPHRASE in pipeline, persist type filter for resume"
```

---

### Task 6: Backend — HTTP routes: `typeFilter` validation and `GET /api/sets` format filtering

**Files:**
- Modify: `backend/server.js`
- Modify: `backend/test/adaptador.test.js`

**Interfaces:**
- Consumes: `REFORMULATION_TYPES` (Task 1), `pipeline.createSet({..., typeFilter})` (Task 5).
- Produces: `POST /api/sets/generate` accepts `typeFilter` in the body, validated against `REFORMULATION_TYPES`, 400 on an invalid value. `GET /api/sets` accepts an optional `?format=` query param; without it, returns only `SET_STANDARD_36`/`SET_STANDARD_40` sets; with it, returns only sets matching that exact format. Consumed by Task 7 (`drill/generateDrillSet.js`) and Task 11 (`drill/DrillPicker.jsx`).

- [ ] **Step 1: Write the failing tests**

In `backend/test/adaptador.test.js`, add the import (find the existing imports at the top of the file and add this one):

```js
import { REFORMULATION_TYPES } from '../src/validation/reformulation.js';
```

Add these tests at the end of the file:

```js
test('POST /api/sets/generate rechaza un typeFilter inválido con 400', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'SET_DRILL_PARAPHRASE', typeFilter: 'no-existe' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, new RegExp(REFORMULATION_TYPES.join('|')));
  });
});

test('GET /api/sets sin ?format= excluye SET_DRILL_PARAPHRASE (solo formatos de examen)', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets`);
    const data = await res.json();
    assert.ok(data.every(set => set.format === 'SET_STANDARD_36' || set.format === 'SET_STANDARD_40'));
  });
});

test('GET /api/sets?format=SET_DRILL_PARAPHRASE excluye los formatos de examen', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets?format=SET_DRILL_PARAPHRASE`);
    const data = await res.json();
    assert.ok(data.every(set => set.format === 'SET_DRILL_PARAPHRASE'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/adaptador.test.js`
Expected: FAIL — `typeFilter` isn't validated yet (no 400), and `GET /api/sets` returns everything regardless of `?format=`.

- [ ] **Step 3: Update `server.js`**

Add the import at the top of `backend/server.js`, alongside the existing ones:

```js
import { REFORMULATION_TYPES } from './src/validation/reformulation.js';
```

In the `POST /api/sets/generate` handler, add the `typeFilter` validation right after the existing `difficulty` validation, and pass it to `createSet`:

```js
app.post('/api/sets/generate', async (req, res) => {
  const difficulty = req.body?.difficulty ? String(req.body.difficulty).toUpperCase() : undefined;
  if (difficulty && !VALID_DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ error: `Dificultad inválida: "${difficulty}". Válidas: ${VALID_DIFFICULTIES.join(', ')}` });
  }
  const typeFilter = req.body?.typeFilter;
  if (typeFilter && !REFORMULATION_TYPES.includes(typeFilter)) {
    return res.status(400).json({ error: `typeFilter inválido: "${typeFilter}". Válidos: ${REFORMULATION_TYPES.join(', ')}` });
  }
  try {
    const set = await pipeline.createSet({
      difficulty,
      format: req.body?.format,
      pilotes: Boolean(req.body?.pilotes),
      seed: req.body?.seed,
      typeFilter,
    });
```

(Everything after this in the handler — the `res.status(201)...` line and the background `pipeline.run(...)` call — is unchanged.)

Replace the `GET /api/sets` handler:

```js
const FORMATOS_EXAMEN = ['SET_STANDARD_36', 'SET_STANDARD_40'];

app.get('/api/sets', async (req, res) => {
  try {
    const sets = await listSets(DATA_DIR);
    const formato = req.query.format;
    const filtrados = formato
      ? sets.filter(set => set.format === formato)
      : sets.filter(set => FORMATOS_EXAMEN.includes(set.format));
    res.json(filtrados);
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/adaptador.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, all backend tests green — this is the last backend task.

- [ ] **Step 6: Commit**

```bash
git add backend/server.js backend/test/adaptador.test.js
git commit -m "feat: validate typeFilter and filter GET /api/sets by format"
```

---

### Task 7: Frontend — `drill/generateDrillSet.js`

**Files:**
- Create: `frontend/src/drill/generateDrillSet.js`
- Create: `frontend/src/drill/generateDrillSet.test.js`

**Interfaces:**
- Produces: `generateDrillSet({ typeFilter, fetchImpl, pollIntervalMs = 2000, timeoutMs = 120000, signal })` — returns a `Promise` resolving to the completed set's summary (`{ id, format, statut, ... }` as returned by `GET /api/sets/:id/status` merged with `id`) on success, rejecting with an `Error` in every other case listed below. Consumed by Task 11 (`DrillPicker.jsx`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/drill/generateDrillSet.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDrillSet } from './generateDrillSet.js';

function fakeFetch(responses) {
  let call = 0;
  return async (url, opts) => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: response.status < 400,
      status: response.status,
      json: async () => response.body,
    };
  };
}

test('resuelve con el set cuando el pipeline termina complet', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 0, prets: 12, echoues: 0, statut: 'complet', enCours: false } },
  ]);
  const set = await generateDrillSet({ fetchImpl, pollIntervalMs: 1 });
  assert.equal(set.id, 'set-2026-01-01-abcd');
  assert.equal(set.statut, 'complet');
});

test('sigue haciendo polling mientras statut es partial y enCours es true', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 3, prets: 3, echoues: 0, statut: 'partial', enCours: true } },
    { status: 200, body: { total: 12, generes: 8, prets: 8, echoues: 0, statut: 'partial', enCours: true } },
    { status: 200, body: { total: 12, generes: 12, prets: 12, echoues: 0, statut: 'complet', enCours: false } },
  ]);
  const set = await generateDrillSet({ fetchImpl, pollIntervalMs: 1 });
  assert.equal(set.statut, 'complet');
});

test('rechaza con un error "stalled" cuando el pipeline se detiene sin terminar', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 8, prets: 7, echoues: 1, statut: 'partial', enCours: false } },
  ]);
  await assert.rejects(
    () => generateDrillSet({ fetchImpl, pollIntervalMs: 1 }),
    (error) => {
      assert.equal(error.code, 'stalled');
      assert.equal(error.echoues, 1);
      return true;
    },
  );
});

test('rechaza con un error definitivo en un HTTP 4xx/5xx', async () => {
  const fetchImpl = fakeFetch([{ status: 400, body: { error: 'formato inválido' } }]);
  await assert.rejects(() => generateDrillSet({ fetchImpl, pollIntervalMs: 1 }), /formato inválido/);
});

test('rechaza con un error de timeout si no llega a un estado terminal a tiempo', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 1, prets: 1, echoues: 0, statut: 'partial', enCours: true } },
  ]);
  await assert.rejects(
    () => generateDrillSet({ fetchImpl, pollIntervalMs: 1, timeoutMs: 5 }),
    (error) => {
      assert.equal(error.code, 'timeout');
      return true;
    },
  );
});

test('se detiene sin resolver ni rechazar de forma observable si el signal se aborta', async () => {
  const controller = new AbortController();
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 1, prets: 1, echoues: 0, statut: 'partial', enCours: true } },
  ]);
  const promise = generateDrillSet({ fetchImpl, pollIntervalMs: 5, signal: controller.signal });
  controller.abort();
  await assert.rejects(
    () => promise,
    (error) => {
      assert.equal(error.name, 'AbortError');
      return true;
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/drill/generateDrillSet.test.js`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `generateDrillSet`**

Create `frontend/src/drill/generateDrillSet.js`:

```js
// Genera un nuevo set de drill y espera a que el pipeline lo termine.
// No es un componente React -- lógica pura de orquestación de red,
// inyectable (fetchImpl) para testear sin red real. `frontend/src/exam/`
// no tiene ningún equivalente: es la primera UI de generación bajo
// demanda del proyecto.
const API_BASE = 'http://localhost:3001';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateDrillSet({
  typeFilter, fetchImpl = fetch, pollIntervalMs = 2000, timeoutMs = 120000, signal,
} = {}) {
  const body = { format: 'SET_DRILL_PARAPHRASE' };
  if (typeFilter) body.typeFilter = typeFilter;

  const generateRes = await fetchImpl(`${API_BASE}/api/sets/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const generateData = await generateRes.json();
  if (!generateRes.ok) throw new Error(generateData.error || `HTTP ${generateRes.status}`);
  const setId = generateData.id;

  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() >= deadline) {
      const error = new Error(`Tiempo de espera agotado generando el drill "${setId}"`);
      error.code = 'timeout';
      error.setId = setId;
      throw error;
    }

    const statusRes = await fetchImpl(`${API_BASE}/api/sets/${setId}/status`, { signal });
    const statusData = await statusRes.json();
    if (!statusRes.ok) throw new Error(statusData.error || `HTTP ${statusRes.status}`);

    if (statusData.statut === 'complet') {
      return { id: setId, ...statusData };
    }
    if (statusData.statut === 'partial' && statusData.enCours === false) {
      const error = new Error(`El drill "${setId}" se detuvo sin terminar (${statusData.echoues} ítem(s) fallido(s))`);
      error.code = 'stalled';
      error.setId = setId;
      error.echoues = statusData.echoues;
      throw error;
    }

    await sleep(pollIntervalMs);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/drill/generateDrillSet.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, 81 tests (75 before this task, +6 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/drill/generateDrillSet.js frontend/src/drill/generateDrillSet.test.js
git commit -m "feat: add generateDrillSet with terminal-state polling and cancellation"
```

---

### Task 8: Frontend — `drill/drillSetCompatibility.js`

**Files:**
- Create: `frontend/src/drill/drillSetCompatibility.js`
- Create: `frontend/src/drill/drillSetCompatibility.test.js`

**Interfaces:**
- Produces: `checkDrillSetCompatibility(set)` → `{ ok: true } | { ok: false, reason: string }`. Consumed by Task 12 (`DrillMode.jsx`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/drill/drillSetCompatibility.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDrillSetCompatibility } from './drillSetCompatibility.js';

function fixtureSet(overrides = {}) {
  return {
    format: 'SET_DRILL_PARAPHRASE',
    pilotes: false,
    sections: [{ type: 'drill_paraphrase', items: Array.from({ length: 12 }, () => ({ questions: [{}] })) }],
    ...overrides,
  };
}

test('acepta un set de drill válido (12 ítems, 12 preguntas)', () => {
  assert.deepEqual(checkDrillSetCompatibility(fixtureSet()), { ok: true });
});

test('rechaza un formato que no sea SET_DRILL_PARAPHRASE', () => {
  const result = checkDrillSetCompatibility(fixtureSet({ format: 'SET_STANDARD_36' }));
  assert.equal(result.ok, false);
});

test('rechaza un set con pilotes', () => {
  const result = checkDrillSetCompatibility(fixtureSet({ pilotes: true }));
  assert.equal(result.ok, false);
});

test('rechaza si el conteo de ítems no es 12', () => {
  const set = fixtureSet();
  set.sections[0].items.pop();
  const result = checkDrillSetCompatibility(set);
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/drill/drillSetCompatibility.test.js`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `checkDrillSetCompatibility`**

Create `frontend/src/drill/drillSetCompatibility.js`:

```js
// Contrato propio de drill/, sin importar ni extender exam/setCompatibility.js
// -- esa función es de Modo Examen, y esta es deliberadamente su propia
// pieza independiente (mismo dato de fondo -- items/questions -- pero sin
// acoplar los dos contratos).
const CONTRATO = { items: 12, questions: 12 };

export function checkDrillSetCompatibility(set) {
  if (set.format !== 'SET_DRILL_PARAPHRASE') {
    return { ok: false, reason: `Formato no soportado por el drill: "${set.format}".` };
  }
  if (set.pilotes) {
    return { ok: false, reason: 'Este set no es compatible con el drill (fue generado con pilotos).' };
  }
  const items = set.sections.flatMap(section => section.items);
  if (items.length !== CONTRATO.items) {
    return { ok: false, reason: `Este set tiene ${items.length} ítems; el drill espera exactamente ${CONTRATO.items}.` };
  }
  const questionCount = items.reduce((total, item) => total + item.questions.length, 0);
  if (questionCount !== CONTRATO.questions) {
    return { ok: false, reason: `Este set tiene ${questionCount} preguntas; el drill espera exactamente ${CONTRATO.questions}.` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/drill/drillSetCompatibility.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, 85 tests (81 before this task, +4 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/drill/drillSetCompatibility.js frontend/src/drill/drillSetCompatibility.test.js
git commit -m "feat: add drillSetCompatibility, independent of exam/setCompatibility"
```

---

### Task 9: Frontend — `drill/DrillRunner.jsx`

**Files:**
- Create: `frontend/src/drill/DrillRunner.jsx`

**Interfaces:**
- Consumes: `createInitialState`, `reducer`, `currentToken`, `computeResults`, `countAnswered` from `frontend/src/exam/examMachine.js` (pure functions, imported directly — no component import); `startPhase`, `remainingSeconds`, `isExpired`, `chainDeadline` from `frontend/src/exam/examTiming.js`.
- Produces: `<DrillRunner set={setDetail} audioElRef={ref} audioUrls={map} onComplete={fn} onAbandon={fn} />`. `onComplete` receives `computeResults(set, state.answers)` exactly like `ExamRunner`'s does. Consumed by Task 12 (`DrillMode.jsx`).

This is a UI component with no unit test file, browser-verified only, matching this project's existing convention for `exam/ExamRunner.jsx`.

- [ ] **Step 1: Implement `DrillRunner.jsx`**

Create `frontend/src/drill/DrillRunner.jsx`:

```jsx
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, currentToken, computeResults, countAnswered } from '../exam/examMachine';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from '../exam/examTiming';

const TICK_MS = 250;
const WATCHDOG_GRACE_MS = 1000;

// La composición del drill es una sola "sección" (SET_DRILL_PARAPHRASE =
// ['drill_paraphrase']) -- createInitialState() de examMachine.js siempre
// arranca en phase:'section-intro', que para el drill no tiene sentido
// (pedido explícito: sin pantalla de instrucciones). Se evita sin tocar el
// reducer compartido ni simular una expiración de temporizador -- eso
// introduciría un render y callbacks asíncronos artificiales -- construyendo
// el estado inicial directamente en 'avant'.
function createDrillInitialState() {
  return { ...createInitialState(), phase: 'avant' };
}

const DrillRunner = ({ set, audioElRef, audioUrls, onComplete, onAbandon }) => {
  const [state, dispatch] = useReducer((s, e) => reducer(set, s, e), undefined, createDrillInitialState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const phaseTimingRef = useRef(null);
  const lastPhaseTimingRef = useRef(null);
  const watchdogRef = useRef(null);
  const firedRef = useRef(false);
  const [remaining, setRemaining] = useState(0);

  const section = set.sections[state.sectionIndex];
  const item = section?.items?.[state.itemIndex];
  const answeredCount = countAnswered(state.answers);
  const totalQuestions = set.sections.reduce((sum, s) => sum + s.items.reduce((n, i) => n + i.questions.length, 0), 0);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Mismo esquema de anclaje que ExamRunner.jsx: avant encadena desde el
  // deadline teórico de la fase anterior (nunca desde "ahora"), apres
  // arranca fresco desde el instante real en que terminó el audio.
  useEffect(() => {
    if (state.status !== 'running' || !section) return;
    if (state.phase === 'avant') {
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

  useEffect(() => {
    if (state.status !== 'running') return;
    if (state.phase !== 'avant' && state.phase !== 'apres') return;

    const interval = setInterval(() => {
      const timing = phaseTimingRef.current;
      if (!timing) return;
      setRemaining(remainingSeconds(timing));
      if (isExpired(timing)) {
        if (state.phase === 'apres') lastPhaseTimingRef.current = timing;
        dispatch({ type: 'TIMER_EXPIRED', token: currentToken(stateRef.current) });
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status]);

  useEffect(() => {
    if (state.phase !== 'audio-pending' || !item) return;
    const audioEl = audioElRef.current;
    const token = currentToken(state);
    const url = audioUrls.get(item.ref);
    if (!audioEl || !url) {
      dispatch({ type: 'AUDIO_FAILED', token });
      return;
    }
    audioEl.src = url;
    audioEl.play().then(
      () => dispatch({ type: 'AUDIO_PLAYING', token }),
      () => dispatch({ type: 'AUDIO_FAILED', token }),
    );
  }, [state.phase, state.sectionIndex, state.itemIndex, audioElRef, audioUrls, item]);

  // Watchdog reimplementado de forma independiente -- en ExamRunner.jsx este
  // mecanismo vive embebido en el componente, no en un módulo separado, así
  // que no hay nada que importar; es el costo concreto aceptado por la
  // independencia total pedida entre drill y Modo Examen.
  useEffect(() => {
    if (state.phase !== 'audio-playing' || !item) return;
    const token = currentToken(state);
    watchdogRef.current = setTimeout(() => {
      dispatch({ type: 'TIMER_EXPIRED', token });
    }, item.duree_audio_s * 1000 + WATCHDOG_GRACE_MS);
    return clearWatchdog;
  }, [state.phase, state.sectionIndex, state.itemIndex, item, clearWatchdog]);

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
    if (firedRef.current) return;
    if (state.status === 'complete') {
      firedRef.current = true;
      onComplete(computeResults(set, state.answers));
    } else if (state.status === 'abandoned') {
      firedRef.current = true;
      onAbandon();
    }
  }, [state.status, set, state.answers, onComplete, onAbandon]);

  const handleAnswer = (questionIndex, optionId) => {
    dispatch({ type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex, optionId });
  };

  const handleAbandon = () => {
    if (!window.confirm('¿Seguro que querés abandonar la ráfaga? Se perderá todo tu progreso.')) return;
    dispatch({ type: 'ABANDON' });
  };

  const handleRetryAudio = () => {
    dispatch({ type: 'RETRY_AUDIO', token: currentToken(state) });
  };

  if (state.status !== 'running') return null;

  let body;
  if (state.phase === 'audio-failed') {
    body = (
      <div className="space-y-4 text-center py-10">
        <p className="text-red-600">No se pudo reproducir el audio.</p>
        <button onClick={handleRetryAudio} className="bg-blue-600 text-white px-6 py-2 rounded">Reintentar</button>
      </div>
    );
  } else if (!item) {
    return null;
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    body = (
      <div className="space-y-6">
        {state.phase === 'audio-pending' && <p className="text-center text-blue-600 text-sm">Preparando audio...</p>}
        {(state.phase === 'avant' || state.phase === 'apres') && (
          <div className="text-center text-3xl font-mono text-red-600">
            00:{remaining.toString().padStart(2, '0')}
          </div>
        )}
        {questions.map((question, questionIndex) => (
          <div key={`${item.ref}-${questionIndex}`}>
            <h3 className="font-bold text-black mb-3">{question.prompt}</h3>
            <div className="space-y-1">
              {question.options.map(opt => {
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
                      className="h-6 w-6 shrink-0"
                    />
                    <span className="text-black">{opt.text}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">Drill Paraphrase</h2>
        <span className="text-sm text-gray-600">Ítem {state.itemIndex + 1}/{section.items.length} · {answeredCount}/{totalQuestions} respondidas</span>
      </div>
      {body}
      <div className="flex justify-end pt-4 border-t">
        <button onClick={handleAbandon} className="border border-red-600 text-red-600 px-5 py-2 rounded-full text-sm font-semibold hover:bg-red-50">
          Abandonar
        </button>
      </div>
    </div>
  );
};

export default DrillRunner;
```

- [ ] **Step 2: Run the full frontend suite (regression check only — this file has no new unit tests)**

Run: `cd frontend && npm test`
Expected: PASS, still 85 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/drill/DrillRunner.jsx
git commit -m "feat: add DrillRunner, independent lockstep runner for the drill mode"
```

---

### Task 10: Frontend — `drill/DrillPicker.jsx`

**Files:**
- Create: `frontend/src/drill/DrillPicker.jsx`

**Interfaces:**
- Consumes: `generateDrillSet` (Task 7).
- Produces: `<DrillPicker onSelect={fn} />`. Consumed by Task 12 (`DrillMode.jsx`).

- [ ] **Step 1: Implement `DrillPicker.jsx`**

Create `frontend/src/drill/DrillPicker.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { generateDrillSet } from './generateDrillSet';

const API_BASE = 'http://localhost:3001';

const TYPE_OPTIONS = [
  { value: '', label: 'Cualquiera' },
  { value: 'nominalisation', label: 'Nominalización' },
  { value: 'synonyme', label: 'Sinónimo' },
  { value: 'restructuration', label: 'Reestructuración' },
];

const DrillPicker = ({ onSelect }) => {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sets?format=SET_DRILL_PARAPHRASE`);
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

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      await generateDrillSet({ typeFilter: typeFilter || undefined });
      await loadSets();
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">Drill Paraphrase</h3>

      <div className="border rounded p-4 space-y-3 bg-gray-50">
        <p className="text-sm text-gray-700">
          Generar una ráfaga nueva de 12 ítems (~8-10 min). El filtro de tipo solo verifica que el modelo
          reportó esa transformación, no que sea semánticamente correcta — no es una garantía absoluta.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            disabled={generating}
            className="border rounded px-3 py-2"
          >
            {TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {generating ? 'Generando...' : 'Generar nuevo drill'}
          </button>
        </div>
        {generateError && <p className="text-red-600 text-sm">{generateError}</p>}
      </div>

      {loading && <div className="text-center py-6 text-blue-600">Cargando drills disponibles...</div>}

      {error && (
        <div className="space-y-3 text-center py-6">
          <p className="text-red-600">No se pudo cargar la lista de drills: {error}</p>
          <button onClick={loadSets} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar</button>
        </div>
      )}

      {!loading && !error && sets.length === 0 && (
        <p className="text-center py-6 text-gray-600">No hay drills listos todavía. Generá uno arriba.</p>
      )}

      {!loading && !error && sets.length > 0 && (
        <div className="space-y-3">
          {sets.map(set => (
            <div key={set.id} className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="font-semibold">{set.id}</p>
                <p className="text-sm text-gray-600">
                  {set.total} ítems · generado {new Date(set.genere_le).toLocaleString()}
                </p>
              </div>
              <button onClick={() => onSelect(set.id)} className="bg-blue-600 text-white px-4 py-2 rounded">
                Elegir
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DrillPicker;
```

- [ ] **Step 2: Run the full frontend suite (regression check only)**

Run: `cd frontend && npm test`
Expected: PASS, still 85 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/drill/DrillPicker.jsx
git commit -m "feat: add DrillPicker with on-demand generation, independent of exam/SetPicker"
```

---

### Task 11: Frontend — `drill/DrillMode.jsx`, and `App.jsx`'s third mode

**Files:**
- Create: `frontend/src/drill/DrillMode.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `checkDrillSetCompatibility` (Task 8), `<DrillRunner>` (Task 9), `<DrillPicker>` (Task 10), `preloadSetAudio`/`revokeAudioUrls` from `exam/audioPreload.js` (pure, non-component import — allowed).
- Produces: `<DrillMode onActiveChange={fn} />`. `App.jsx` gains a 3-way mode switch and a unified "any timed mode active" guard.

- [ ] **Step 1: Implement `DrillMode.jsx`**

Create `frontend/src/drill/DrillMode.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import DrillPicker from './DrillPicker';
import DrillRunner from './DrillRunner';
import DrillReview from './DrillReview';
import { checkDrillSetCompatibility } from './drillSetCompatibility';
import { preloadSetAudio, revokeAudioUrls } from '../exam/audioPreload';

const API_BASE = 'http://localhost:3001';
const ACTIVE_PHASES = new Set(['preloading', 'unlock', 'running']);
const GUARDED_PHASES = new Set(['preloading', 'unlock', 'running']);

const DrillMode = ({ onActiveChange }) => {
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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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

  useEffect(() => () => {
    preloadAbortRef.current?.abort();
    revokeAudioUrls(audioUrlsRef.current);
  }, []);

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

  const runPreload = useCallback(async (refs, id) => {
    const controller = new AbortController();
    preloadAbortRef.current = controller;
    setPhase('preloading');

    const audioResult = await preloadSetAudio({
      setId: id,
      refs,
      signal: controller.signal,
      onProgress: p => setPreloadProgress({ done: p.done, total: p.total }),
    });

    if (controller.signal.aborted || preloadAbortRef.current !== controller) {
      revokeAudioUrls(audioResult.urls);
      return;
    }
    revokeAudioUrls(audioUrlsRef.current);
    audioUrlsRef.current = new Map(audioResult.urls);

    if (audioResult.failedRefs.length > 0) {
      setFailedRefs(audioResult.failedRefs);
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
      if (!mountedRef.current) return;
      const data = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const compatibility = checkDrillSetCompatibility(data);
      if (!compatibility.ok) {
        setCompatError(compatibility.reason);
        setPhase('incompatible');
        return;
      }
      setSetDetail(data);
      const refs = data.sections.flatMap(section => section.items.map(item => item.ref));
      await runPreload(refs, chosenId);
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(error.message);
      setPhase('loading-error');
    }
  }, [runPreload]);

  const handleRetryFailed = useCallback(() => {
    const refs = setDetail.sections.flatMap(section => section.items.map(item => item.ref));
    runPreload(refs, setId);
  }, [runPreload, setDetail, setId]);

  const handleUnlock = useCallback(async () => {
    try {
      const audioEl = audioElRef.current;
      const firstRef = setDetail?.sections?.[0]?.items?.[0]?.ref;
      const firstUrl = firstRef ? audioUrlsRef.current.get(firstRef) : null;
      if (firstUrl) audioEl.src = firstUrl;
      audioEl.muted = true;
      try {
        await audioEl.play();
        audioEl.pause();
      } finally {
        audioEl.muted = false;
        audioEl.currentTime = 0;
      }
    } catch {
      // No es fatal: DrillRunner maneja AUDIO_FAILED con su propia UI de reintento.
    } finally {
      setPhase('running');
    }
  }, [setDetail]);

  const handleComplete = useCallback((finalResults) => {
    setResults(finalResults);
    setPhase('review');
  }, []);

  if (phase === 'picker') return <DrillPicker onSelect={handleSelect} />;

  if (phase === 'loading') {
    return <div className="text-center py-10 text-blue-600">Cargando drill...</div>;
  }

  if (phase === 'loading-error') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-red-600">No se pudo cargar el drill: {loadError}</p>
        <button onClick={() => handleSelect(setId)} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar</button>
        <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Volver a la lista</button>
      </div>
    );
  }

  if (phase === 'incompatible') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-amber-700">{compatError}</p>
        <button onClick={goToPicker} className="bg-blue-600 text-white px-4 py-2 rounded">Volver a la lista</button>
      </div>
    );
  }

  return (
    <div>
      <audio ref={audioElRef} style={{ display: 'none' }} />

      {phase === 'preloading' && (
        <div className="text-center py-10 space-y-2">
          <p className="text-blue-600">Preparando drill... {preloadProgress.done}/{preloadProgress.total}</p>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Cancelar / Volver a la lista</button>
        </div>
      )}

      {phase === 'preload-failed' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-red-600">No se pudieron descargar {failedRefs.length} audio(s).</p>
          <button onClick={handleRetryFailed} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar fallidos</button>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Volver a la lista</button>
        </div>
      )}

      {phase === 'unlock' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-green-700">Audio listo.</p>
          <button onClick={handleUnlock} className="bg-blue-600 text-white px-6 py-3 rounded text-lg">Comenzar drill</button>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Cancelar / Volver a la lista</button>
        </div>
      )}

      {phase === 'running' && setDetail && (
        <DrillRunner
          set={setDetail}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onComplete={handleComplete}
          onAbandon={goToPicker}
        />
      )}

      {phase === 'review' && setDetail && results && (
        <DrillReview
          set={setDetail}
          answers={results.answers}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onExit={goToPicker}
        />
      )}
    </div>
  );
};

export default DrillMode;
```

- [ ] **Step 2: Update `App.jsx`**

Replace `frontend/src/App.jsx` entirely:

```jsx
import React, { useState } from 'react';
import TrainingMode from './TrainingMode';
import ExamMode from './exam/ExamMode';
import DrillMode from './drill/DrillMode';

const App = () => {
  const [mode, setMode] = useState('training');
  const [examActive, setExamActive] = useState(false);
  const [drillActive, setDrillActive] = useState(false);
  const timedModeActive = examActive || drillActive;

  return (
    <div>
      <div className="max-w-2xl mx-auto mt-4 flex gap-2 px-6">
        <button
          onClick={() => setMode('training')}
          disabled={timedModeActive}
          className={`px-4 py-2 rounded ${mode === 'training' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Entrenamiento
        </button>
        <button
          onClick={() => setMode('exam')}
          disabled={timedModeActive && mode !== 'exam'}
          className={`px-4 py-2 rounded ${mode === 'exam' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Modo Examen
        </button>
        <button
          onClick={() => setMode('drill')}
          disabled={timedModeActive && mode !== 'drill'}
          className={`px-4 py-2 rounded ${mode === 'drill' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Drill Paraphrase
        </button>
      </div>
      {mode === 'training' && <TrainingMode />}
      {mode === 'exam' && <ExamMode onActiveChange={setExamActive} />}
      {mode === 'drill' && <DrillMode onActiveChange={setDrillActive} />}
    </div>
  );
};

export default App;
```

- [ ] **Step 3: Run the full frontend suite (regression check only)**

Run: `cd frontend && npm test`
Expected: PASS, still 85 tests (`App.jsx` has no unit tests, matching existing convention).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/drill/DrillMode.jsx frontend/src/App.jsx
git commit -m "feat: add DrillMode orchestrator and wire the third app mode"
```

---

### Task 12: Frontend — `drill/DrillReview.jsx`

**Files:**
- Create: `frontend/src/drill/DrillReview.jsx`

**Interfaces:**
- Consumes: `buildReviewModel` from `exam/reviewModel.js`, `buildHighlightSegments` from `exam/highlightSegments.js` (pure functions, imported directly).
- Produces: `<DrillReview set={setDetail} answers={answers} audioElRef={ref} audioUrls={map} onExit={fn} />`. Consumed by Task 11's `DrillMode.jsx` (already wired in that task).

- [ ] **Step 1: Implement `DrillReview.jsx`**

Create `frontend/src/drill/DrillReview.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { buildReviewModel } from '../exam/reviewModel';
import { buildHighlightSegments } from '../exam/highlightSegments';

const REFORMULATION_TYPE_LABELS = {
  nominalisation: 'Nominalización',
  synonyme: 'Sinónimo',
  restructuration: 'Reestructuración',
};

const TranscriptWithHighlight = ({ transcript, justification }) => {
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const found = segments.some(s => s.questionIndexes.length > 0);
  return (
    <div className="bg-purple-50 border border-purple-200 rounded p-4 text-sm space-y-2">
      <p>
        {segments.map((segment, i) => (
          segment.questionIndexes.length > 0
            ? <span key={i} className="bg-yellow-200 rounded px-0.5">{segment.text}</span>
            : <span key={i}>{segment.text}</span>
        ))}
      </p>
      {!found && (
        <p className="text-xs text-gray-500 italic">
          Evidencia generada — no localizada literalmente en el transcript: «{justification}»
        </p>
      )}
    </div>
  );
};

const DrillReview = ({ set, answers, audioElRef, audioUrls, onExit }) => {
  const [expandedRefs, setExpandedRefs] = useState(() => new Set());
  const [playback, setPlayback] = useState({ activeRef: null, status: 'idle', error: null });

  const model = buildReviewModel(set, answers);
  // El drill tiene una sola "sección" (SET_DRILL_PARAPHRASE = ['drill_paraphrase']),
  // así que se aplana a una lista plana de 12 ítems -- no hace falta agrupar
  // por sección como en ExamReview.jsx.
  const items = model.sections.flatMap((section, sectionIndex) =>
    section.items.map((item, itemIndex) => ({ item, setItem: set.sections[sectionIndex].items[itemIndex] })));
  const correctTotal = model.sections.reduce((sum, s) => sum + s.correctCount, 0);
  const questionTotal = model.sections.reduce((sum, s) => sum + s.questionCount, 0);

  const stopPlayback = () => {
    const audioEl = audioElRef.current;
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    }
  };

  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onPlaying = () => setPlayback(prev => (prev.activeRef ? { ...prev, status: 'playing', error: null } : prev));
    const onEnded = () => setPlayback(prev => (prev.activeRef ? { ...prev, status: 'idle' } : prev));
    const onError = () => setPlayback(prev => (prev.activeRef
      ? { ...prev, status: 'error', error: 'No se pudo reproducir el audio' }
      : prev));
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
    try {
      audioEl.src = url;
      audioEl.currentTime = 0;
    } catch {
      setPlayback(prev => (prev.activeRef === ref ? { activeRef: ref, status: 'error', error: 'No se pudo reproducir el audio' } : prev));
      return;
    }
    Promise.resolve(audioEl.play()).catch(() => {
      setPlayback(prev => (prev.activeRef === ref ? { activeRef: ref, status: 'error', error: 'No se pudo reproducir el audio' } : prev));
    });
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
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Revisión del drill</h2>
        <span className="font-semibold">{correctTotal}/{questionTotal} correctas</span>
      </div>

      <div className="space-y-2">
        {items.map(({ item, setItem }, itemIndex) => {
          const isExpanded = expandedRefs.has(item.ref);
          const isActive = playback.activeRef === item.ref;
          const buttonLabel = isActive && playback.status === 'playing' ? 'Reiniciar' : 'Reproducir';
          const question = item.questions[0];
          const setQuestion = setItem.questions[0];

          return (
            <div key={item.ref} className="border rounded">
              <button
                onClick={() => toggleExpanded(item.ref)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50"
              >
                <span>Ítem {itemIndex + 1}/{items.length}</span>
                <span className="font-semibold">{question.isCorrect ? 'Correcta' : 'Incorrecta'}</span>
              </button>
              {isExpanded && (
                <div className="p-4 border-t space-y-4">
                  <div className="flex items-center gap-3">
                    <button onClick={() => handlePlay(item.ref)} className="bg-blue-600 text-white px-4 py-2 rounded">
                      {buttonLabel}
                    </button>
                    {isActive && playback.status === 'error' && <span className="text-red-600 text-sm">{playback.error}</span>}
                  </div>

                  <TranscriptWithHighlight transcript={setItem.transcript} justification={setQuestion.justification} />

                  <div className="space-y-2 border-t pt-3">
                    <h4 className="font-semibold">{setQuestion.prompt}</h4>
                    {!question.answered && <p className="text-sm text-amber-700 font-semibold">Sin respuesta</p>}
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
                            {opt.text}
                            {stateLabel && <span className="ml-2 text-xs font-semibold">{stateLabel}</span>}
                          </div>
                        );
                      })}
                    </div>
                    {question.reformulation && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded p-3 text-sm space-y-1">
                        <p>
                          <span className="font-semibold">Lo que dice el audio:</span> «{question.reformulation.extrait_audio}»
                        </p>
                        <p>
                          <span className="font-semibold">
                            Respuesta correcta ({REFORMULATION_TYPE_LABELS[question.reformulation.type] ?? 'Reformulación'}):
                          </span> {question.reformulation.option_correcte}
                        </p>
                        {question.selectedLiteralTrap && (
                          <p className="text-amber-800 font-semibold">
                            Elegiste una opción que comparte palabras literales con el audio. Esto puede ser una trampa de
                            reconocimiento superficial — compara el sentido completo, no solo las palabras, con la respuesta correcta.
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-sm text-gray-700">{setQuestion.feedback}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={handleExit} className="w-full bg-gray-800 text-white py-2 rounded">
        Volver a la lista de drills
      </button>
    </div>
  );
};

export default DrillReview;
```

- [ ] **Step 2: Run the full frontend suite (regression check only)**

Run: `cd frontend && npm test`
Expected: PASS, still 85 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/drill/DrillReview.jsx
git commit -m "feat: add DrillReview with the reformulation bridge, independent of ExamReview"
```

---

### Task 13: Full suite verification and manual browser walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, all backend tests green (baseline 198 from the reformulation-review-bridge plan, plus this plan's additions across Tasks 1-6).

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, 85 tests (75 baseline + 6 from Task 7 + 4 from Task 8).

- [ ] **Step 3: Manual browser verification**

This cannot be automated in this environment (no browser-automation tool available, confirmed during the Parte C1 plan) — do it directly:

1. Start the backend: `cd backend && npm start`.
2. Start the frontend: `cd frontend && npm run dev`.
3. Open the app, click "Drill Paraphrase". Confirm the picker loads (empty state if no drill sets exist yet) and the other two mode buttons are enabled (nothing is active yet).
4. Click "Generar nuevo drill" (needs a configured provider key in `backend/.env`). Confirm the button shows a generating state and, once the poll completes, the new set appears in the list below without a page reload.
5. While generation is in progress, confirm the other two mode buttons are NOT disabled (generation itself isn't a "timed mode active" state — only picking a set and entering `preloading`/`unlock`/`running` is).
6. Select the generated drill. Confirm it goes straight from the "Comenzar drill" unlock screen into the first item with **no instructions screen** — audio starts playing after the 5s "avant" countdown, once only, then a 10s "apres" countdown, then auto-advances to the next item.
7. While a drill is running, confirm all three mode buttons (Entrenamiento, Modo Examen, Drill Paraphrase) are disabled except the active one.
8. Answer a few items (leave at least one unanswered on purpose) and let the ráfaga run to completion (12 items, ~8-10 min, or interrupt via "Abandonar" to test that path returns to the picker).
9. On completion, confirm it goes straight to the review screen (**no summary/score screen** in between). Confirm: the item you didn't answer shows "Sin respuesta", correct/incorrect items are labeled, and at least one item shows the indigo reformulation bridge with the audio fragment and correct answer — if you picked a wrong answer that happened to be the literal-trap distractor, confirm the amber warning line appears too.
10. Exit back to the picker and confirm the drill set you just completed still appears in the list (for re-review or re-attempt later).
11. Generate one more drill for each of the 3 type filters (`Nominalización`, `Sinónimo`, `Reestructuración`) and, in each one's review screen, eyeball at least one item's reformulation bridge to confirm the correct answer's transformation genuinely matches the requested type — not just that the label says so. This is the manual check the spec calls for explicitly: the filter only verifies the model's self-reported `reformulationType`, not a real semantic guarantee, so this is the only way to catch the model silently mislabeling a transformation.

If anything doesn't match, note it — do not consider this task done until confirmed by eye, or explicitly deferred with the user's agreement (same pattern used for the Parte C1 plan's equivalent step).
