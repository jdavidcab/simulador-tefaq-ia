# Regla de reformulación en la generación (Fase 2, Parte A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce, programmatically, that the correct option of a generated exam question reformulates the audio (nominalization/synonym, never a literal quote) and that at least one distractor recycles literal audio words with an altered meaning — closing a real gap the spec's author found in their own exam performance.

**Architecture:** A new pure validation module (`backend/src/validation/reformulation.js`) reuses the existing `contentWords`/`scoreJustification` tokenizer utilities to score lexical overlap in both directions (correct-answer-vs-justification should be LOW, distractor-vs-transcript should be HIGH for at least one distractor). It plugs into the existing `validarPregunta()` step inside `backend/src/validation/index.js`, gated by `sectionType` so it only runs for the 6 sections with model-generated options. A thrown `Error` from this check falls into the *existing* same-provider retry loop in `itemGenerator.js` — no new retry/logging infrastructure needed. Prompt-side, `backend/src/prompt/common.js`'s shared `reglasComunes()`/`esquemaJson()` gain the instruction and the new `reformulationType` schema field, which every one of the 6 target sections inherits automatically since they all call through `common.js`.

**Tech Stack:** Node.js (`node --test`), no new dependencies.

## Global Constraints

- Applies only to `annonce_publique`, `repondeur`, `chronique`, `interview`, `reportage`, `divers`. Excludes `micro_trottoir` (fixed postures) and `conversation_image` (bespoke prompt, no `reglasComunes`/`esquemaJson`).
- Applies to **future generation only** — never touches or regenerates the existing set already on disk.
- Correct-answer overlap threshold: `config.reformulationOverlapThreshold`, default `0.6`, reject when overlap `>` threshold.
- Trap-distractor minimum shared content words: `config.reformulationMinTrapWords`, default `2`.
- No new retry-counting or aggregate logging — reuses the existing generic `config.validationRetries` loop and the existing `console.error` line in `itemGenerator.js`.
- Old sets (and any set generated before this change) simply lack the `reformulation` field — never treated as an error.

---

### Task 1: Reformulation config defaults

**Files:**
- Modify: `backend/src/examFormat.js`
- Test: `backend/test/examFormat.test.js`

**Interfaces:**
- Produces: `CONFIG.reformulationOverlapThreshold` (number, default `0.6`), `CONFIG.reformulationMinTrapWords` (number, default `2`) — consumed by Task 2's `checkReformulation(question, transcript, config)`.

- [ ] **Step 1: Write the failing assertions**

In `backend/test/examFormat.test.js`, inside the existing test `'CONFIG expone los parámetros calibrables con sus defaults'` (around line 86-92), add two lines after `assert.equal(CONFIG.piloteCount, 4);`:

```js
  assert.equal(CONFIG.reformulationOverlapThreshold, 0.6);
  assert.equal(CONFIG.reformulationMinTrapWords, 2);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/examFormat.test.js`
Expected: FAIL on the new assertions (`undefined` !== `0.6` / `2`).

- [ ] **Step 3: Add the config defaults**

In `backend/src/examFormat.js`, in the `CONFIG` object (lines 38-45), add two keys after `piloteCount: 4,`:

```js
export const CONFIG = {
  historyWindow: 3,               // sets hacia atrás que bloquean un tema
  justificationThreshold: 0.8,    // solapamiento mínimo de la cita
  justificationMinContentWords: 5,
  microTrottoirOptions: 3,        // 3 o 4
  validationRetries: 2,           // reintentos en el MISMO proveedor
  piloteCount: 4,
  reformulationOverlapThreshold: 0.6,  // por encima de esto, la opción correcta calca el audio
  reformulationMinTrapWords: 2,        // mínimo de palabras literales compartidas para contar como trampa
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/examFormat.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/examFormat.js backend/test/examFormat.test.js
git commit -m "feat: add reformulation overlap/trap config defaults"
```

---

### Task 2: `checkReformulation` — pure validation module

**Files:**
- Create: `backend/src/validation/reformulation.js`
- Test: `backend/test/reformulation.test.js`

**Interfaces:**
- Consumes: `contentWords(text)` from `backend/src/validation/frenchWords.js`; `scoreJustification(justification, transcript)` from `backend/src/validation/justification.js`; `config.reformulationOverlapThreshold`, `config.reformulationMinTrapWords` (Task 1).
- Produces: `checkReformulation(question, transcript, config)` — throws `Error` on any of the three violations described below, otherwise mutates `question.reformulation = { extrait_audio, option_correcte, type }` and returns `undefined`. Consumed by Task 3's `validarPregunta()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/reformulation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReformulation } from '../src/validation/reformulation.js';
import { CONFIG } from '../src/examFormat.js';

function preguntaBase(overrides = {}) {
  return {
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'On va fermer la piscine cet été' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
    correctId: 'A',
    justification: 'on va fermer la piscine cet été pour des travaux de rénovation majeurs',
    reformulationType: 'nominalisation',
    ...overrides,
  };
}

const TRANSCRIPT = 'Bonjour, on va fermer la piscine cet été pour des travaux de rénovation majeurs, merci de votre compréhension.';

test('acepta una opción correcta reformulada con trampa literal presente, y adjunta metadata', () => {
  const pregunta = preguntaBase();
  assert.doesNotThrow(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG));
  assert.deepEqual(pregunta.reformulation, {
    extrait_audio: pregunta.justification,
    option_correcte: 'Une fermeture temporaire du service',
    type: 'nominalisation',
  });
});

test('rechaza si la opción correcta calca literalmente el audio', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'on va fermer la piscine cet été' },
      { id: 'B', text: 'Une fermeture temporaire du service' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
  });
  assert.throws(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG), /solapa/);
});

test('rechaza si ningún distractor recicla palabras literales del audio', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'Un changement de programmation' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
  });
  assert.throws(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG), /trampa obligatoria ausente/);
});

test('rechaza reformulationType ausente o inválido', () => {
  const pregunta = preguntaBase({ reformulationType: 'paraphrase' });
  assert.throws(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG), /reformulationType/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/reformulation.test.js`
Expected: FAIL — `Cannot find module '../src/validation/reformulation.js'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `checkReformulation`**

Create `backend/src/validation/reformulation.js`:

```js
import { contentWords } from './frenchWords.js';
import { scoreJustification } from './justification.js';

const REFORMULATION_TYPES = ['nominalisation', 'synonyme', 'restructuration'];

// Aplica solo a las 6 secciones de opciones generadas por el modelo (no
// micro_trottoir, cuyas opciones son posturas fijas, ni conversation_image,
// que tiene su propio esquema de opciones-imagen).
export function checkReformulation(question, transcript, config) {
  const correctOption = question.options.find(option => option.id === question.correctId);

  const overlapScore = scoreJustification(correctOption.text, question.justification);
  if (overlapScore > config.reformulationOverlapThreshold) {
    throw new Error(
      `reformulation: la opción correcta solapa ${(overlapScore * 100).toFixed(0)}% con el audio `
      + `(máximo ${(config.reformulationOverlapThreshold * 100).toFixed(0)}%) -- no está reformulada`,
    );
  }

  const palabrasTranscript = new Set(contentWords(transcript));
  const hayTrampaLiteral = question.options
    .filter(option => option.id !== question.correctId)
    .some(option => contentWords(option.text)
      .filter(palabra => palabrasTranscript.has(palabra)).length >= config.reformulationMinTrapWords);
  if (!hayTrampaLiteral) {
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

  question.reformulation = {
    extrait_audio: question.justification,
    option_correcte: correctOption.text,
    type: question.reformulationType,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/reformulation.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/validation/reformulation.js backend/test/reformulation.test.js
git commit -m "feat: add checkReformulation lexical-overlap validation"
```

---

### Task 3: Wire `checkReformulation` into `validateItem`, fix downstream fixtures

**Files:**
- Modify: `backend/src/validation/index.js`
- Modify: `backend/test/validation.test.js`
- Modify: `backend/test/itemGenerator.test.js`

**Interfaces:**
- Consumes: `checkReformulation(question, transcript, config)` (Task 2).
- Produces: `validarPregunta(question, transcript, config, expectedOptions, sectionType)` gains a 5th parameter; `validateItem()`'s public signature is unchanged. After this task, every question object returned by `validateItem()`/`createItemGenerator().generateItem()` for the 6 target sections carries `question.reformulation` when validation succeeds.

This task also updates two shared test fixtures (`preguntaValida()` in `validation.test.js`, `itemJson()` + 4 inline fixtures in `itemGenerator.test.js`) that currently have no `reformulationType` field and no distractor sharing words with their (fake, `mot0 mot1 mot2...`) transcripts — once the check is wired in, they would otherwise start failing for reasons unrelated to what those tests actually verify.

- [ ] **Step 1: Write the failing tests in `validation.test.js`**

In `backend/test/validation.test.js`, replace the `preguntaValida` function (lines 10-23) with a version that adds a literal-trap distractor (using words at positions 20-21 of the transcript, which never overlap the `justification` fragment built from positions 0-9, so the two checks stay independent regardless of transcript length) and the `reformulationType` field:

```js
function preguntaValida(transcript) {
  return {
    prompt: 'Quel est le problème signalé ?',
    options: [
      { id: 'A', text: 'Une panne de chauffage' },
      { id: 'B', text: 'Une fuite d’eau' },
      { id: 'C', text: 'Un bruit de voisinage proche de mot20 et mot21' },
      { id: 'D', text: 'Une porte bloquée' },
    ],
    correctId: 'B',
    feedback: 'La locataire signale de l’eau au plafond.',
    justification: transcript.split(' ').slice(0, 10).join(' '),
    reformulationType: 'nominalisation',
  };
}
```

Then add three new tests after the `'rechaza justification que no está en el transcript'` test (after line 106):

```js
test('adjunta metadata de reformulación en secciones no excluidas', () => {
  const item = itemValido('annonce_publique', 45);
  const validado = validateItem(item, 'annonce_publique');
  assert.deepEqual(validado.questions[0].reformulation, {
    extrait_audio: validado.questions[0].justification,
    option_correcte: 'Une fuite d’eau',
    type: 'nominalisation',
  });
});

test('rechaza una pregunta sin reformulationType en secciones no excluidas', () => {
  const item = itemValido('annonce_publique', 45);
  delete item.questions[0].reformulationType;
  assert.throws(() => validateItem(item, 'annonce_publique'), /reformulationType/);
});

test('el chequeo de reformulación se salta para micro_trottoir', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const transcript = palabras(55);
  const item = {
    transcript,
    questions: [{
      prompt: 'Quelle est la position de la personne interviewée ?',
      options: posturas.map((text, i) => ({ id: 'ABCD'[i], text })),
      correctId: 'B',
      feedback: 'La persona expresa esta postura con matices.',
      justification: transcript.split(' ').slice(0, 10).join(' '),
      // deliberadamente sin reformulationType ni distractor-trampa: si el
      // guard de sectionType fallara, esto rechazaría el ítem.
    }],
  };
  assert.doesNotThrow(() => validateItem(item, 'micro_trottoir', { posture: posturas[1] }));
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd backend && node --test test/validation.test.js`
Expected: the 2 new positive/negative reformulation tests FAIL (`reformulation` is `undefined`; the "sin reformulationType" case does not throw yet). All pre-existing tests still PASS (the fixture change is inert until wiring happens).

- [ ] **Step 3: Wire the check into `validarPregunta`**

In `backend/src/validation/index.js`, add the import at the top:

```js
import { checkReformulation } from './reformulation.js';
```

Change `validarPregunta`'s signature and add the guarded call at the end of the function (after the existing `question.justificationScore = cita.score;` line):

```js
function validarPregunta(question, transcript, config, expectedOptions = 4, sectionType) {
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
    checkReformulation(question, transcript, config);
  }
}
```

And update the call site inside `validateItem` (currently `for (const question of item.questions) validarPregunta(question, item.transcript, config, expectedOptions);`):

```js
  for (const question of item.questions) validarPregunta(question, item.transcript, config, expectedOptions, sectionType);
```

- [ ] **Step 4: Run `validation.test.js` to verify it passes**

Run: `cd backend && node --test test/validation.test.js`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 5: Fix `itemGenerator.test.js` fixtures**

`itemGenerator.test.js` uses `BASE.sectionType = 'annonce_publique'` (a target, non-excluded section) for almost every test, via a shared `itemJson()` helper plus 4 inline duplicated fixtures with hardcoded `correctId` values of `'A'`, `'B'`, `'C'`, and `'D'` across different tests. Because `correctId` varies, put the literal-trap words in **two** option slots (B and D) so that whichever letter a given test marks as correct, at least one of the *other three* options still qualifies as the trap distractor; keep those words at transcript positions 20-23 so they never overlap the justification (positions 0-9), keeping the correct-answer check trivially satisfied regardless of which option ends up being correct.

Replace `itemJson()` (lines 6-23):

```js
function itemJson({ palabras = 45, correctId = 'B' } = {}) {
  const transcript = Array.from({ length: palabras }, (_, i) => `mot${i}`).join(' ');
  return JSON.stringify({
    transcript,
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId,
      feedback: 'El anuncio lo dice de forma parafraseada.',
      justification: transcript.split(' ').slice(0, 10).join(' '),
      reformulationType: 'nominalisation',
    }],
  });
}
```

Then apply the same `options` array (the 4 lines above) and add `reformulationType: 'nominalisation',` (right after each fixture's `justification` line) to the 4 inline fixtures that currently duplicate the old options array:
- The `conElisionFrancesa` fixture (around line 169-183, `correctId: 'B'`).
- The `conPreposicion` fixture (around line 223-237, `correctId: 'C'`).
- The `conMarcador` fixture (around line 247-261, `correctId: 'D'`).
- The `conDistractor` fixture (around line 275-292, `correctId: 'A'`).

For each of these 4, replace their `options: [...]` array with the same 4-line array shown above, and add `reformulationType: 'nominalisation',` after their `justification` line. Do not change `prompt`, `feedback`, or `justification` in these 4 — those are what each test actually asserts on.

- [ ] **Step 6: Run `itemGenerator.test.js` to verify it's back to green**

Run: `cd backend && node --test test/itemGenerator.test.js`
Expected: PASS (all pre-existing tests).

- [ ] **Step 7: Add end-to-end reformulation tests to `itemGenerator.test.js`**

Add these two tests at the end of the file:

```js
test('un fallo de reformulación (opción correcta calca el audio) reintenta el MISMO proveedor', async () => {
  const malo = JSON.stringify({
    transcript: Array.from({ length: 45 }, (_, i) => `mot${i}`).join(' '),
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'mot0 mot1 mot2 mot3 mot4 mot5' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId: 'A',
      feedback: 'x',
      justification: 'mot0 mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9',
      reformulationType: 'nominalisation',
    }],
  });
  const gemini = proveedorFake('gemini', [malo, itemJson()]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'gemini', 'un fallo de reformulación es de validación, no de cuota/red');
  assert.equal(item.tentativas, 2);
  assert.equal(deepseek.llamadas.length, 0);
});

test('adjunta metadata de reformulación al ítem generado, sobreviviendo el barajado de opciones', async () => {
  const gemini = proveedorFake('gemini', [itemJson({ correctId: 'A' })]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.equal(item.questions[0].reformulation.type, 'nominalisation');
  assert.equal(item.questions[0].reformulation.option_correcte, 'Une première option plausible');
});
```

- [ ] **Step 8: Run `itemGenerator.test.js` again to verify the new tests pass**

Run: `cd backend && node --test test/itemGenerator.test.js`
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 9: Commit**

```bash
git add backend/src/validation/index.js backend/test/validation.test.js backend/test/itemGenerator.test.js
git commit -m "feat: enforce reformulation check in validateItem, update fixtures"
```

---

### Task 4: Prompt changes — strengthen the rule, add the trap-distractor rule, add `reformulationType`

**Files:**
- Modify: `backend/src/prompt/common.js`
- Modify: `backend/src/prompt/sections/micro_trottoir.js`
- Modify: `backend/test/prompt.test.js`

**Interfaces:**
- Produces: `esquemaJson(questionsPerAudio, optionCount = 4, { includeReformulationType = true } = {})` gains a 3rd parameter.

- [ ] **Step 1: Write the failing tests**

In `backend/test/prompt.test.js`, add these two tests at the end of the file:

```js
test('las 6 secciones de opciones generadas piden reformulationType; micro_trottoir no', () => {
  for (const sectionType of ['annonce_publique', 'repondeur', 'chronique', 'interview', 'reportage', 'divers']) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.ok(prompt.includes('reformulationType'), `${sectionType} debería pedir reformulationType`);
  }
  const promptMicroTrottoir = buildSectionPrompt('micro_trottoir', {
    ...BASE, posture: MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions][0],
  });
  assert.ok(!promptMicroTrottoir.includes('reformulationType'), 'micro_trottoir no debería pedir reformulationType');
});

test('las 6 secciones de opciones generadas exigen nominalización y la trampa literal', () => {
  for (const sectionType of ['annonce_publique', 'repondeur', 'chronique', 'interview', 'reportage', 'divers']) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.match(prompt, /nominalisation/i, `${sectionType} debería mencionar nominalización`);
    assert.match(prompt, /trampa de reconocimiento superficial/i, `${sectionType} debería exigir la trampa literal`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/prompt.test.js`
Expected: FAIL — neither `reformulationType` nor `nominalisation`/`trampa de reconocimiento superficial` appear in any prompt yet.

- [ ] **Step 3: Update `reglasComunes` and `esquemaJson` in `common.js`**

In `backend/src/prompt/common.js`, replace the `reglasComunes` function entirely:

```js
export function reglasComunes({ minWords, maxWords, questionsPerAudio, verticalScan, opcionesFijas = false }) {
  const reglas = [
    opcionesFijas
      ? 'Las opciones son fijas y no las eliges tú (se listan arriba); no inventes ni modifiques su texto.'
      : 'Las 4 opciones de cada pregunta deben ser plausibles.',
    'El transcript debe usar parafraseo y NUNCA las mismas palabras exactas de la respuesta correcta.',
    `El transcript debe tener entre ${minWords} y ${maxWords} palabras.`,
    'Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown ni comillas triples.',
    `Genera exactamente ${questionsPerAudio} pregunta(s) sobre este mismo audio.`,
    'La respuesta correcta no debe quedar sesgada siempre en la misma letra.',
    'El feedback NO debe mencionar letras de opciones (A, B, C, D). Explica el contenido correcto, el parafraseo usado y por qué los distractores no encajan.',
  ];
  if (!opcionesFijas) {
    reglas.push(
      'Los distractores deben seguir este esquema: uno parcialmente verdadero con detalle incorrecto, uno plausible pero no mencionado, uno que confunda causa/consecuencia o recomendación/obligación, y uno con detalle cambiado (hora/lugar/monto/condición) cuando sea posible.',
      'Al menos un distractor debe ser una trampa de sinónimos/paráfrasis: reutiliza una idea del audio con palabras equivalentes, pero cambia el sentido final con un matiz o dato incorrecto.',
      'Además de esa trampa de sinónimos, al menos un distractor (distinto) debe ser una trampa de reconocimiento superficial: reutiliza palabras o expresiones LITERALES del audio pero con el sentido cambiado.',
      'La respuesta correcta debe ser una REFORMULACIÓN del audio, nunca una copia: usa sinónimos y, sobre todo, nominalización oral→escrito formal. Ejemplos: "on va fermer la piscine" → "fermeture de la piscine"; "il a refusé de signer" → "son refus de signer"; "les prix vont monter" → "une hausse des tarifs". Prohibido reutilizar literalmente los sintagmas clave del audio en la opción correcta.',
      'En el campo "reformulationType" de cada pregunta, indica qué transformación aplicaste a la respuesta correcta: "nominalisation" (verbo → sustantivo), "synonyme" (palabras equivalentes) o "restructuration" (reordenamiento sintáctico).',
    );
  }
  if (!opcionesFijas) {
    reglas.push(
      'Las 4 opciones deben parecer de la misma familia: longitud parecida, mismo registro, misma categoría y estructura gramatical comparable.',
      'La diferencia entre opciones debe estar en un detalle decisivo, no en que una sea mucho más específica o larga.',
    );
  }
  reglas.push(
    'En el feedback, menciona brevemente el par de sinónimos/paráfrasis que conecta el audio con la respuesta correcta.',
    'El campo "justification" de cada pregunta debe ser una CITA TEXTUAL del transcript (mínimo 8 palabras de contenido, copiada literalmente) que sostenga la respuesta correcta.',
    verticalScan
      ? 'Como entrenamiento de escaneo vertical, las 4 opciones deben compartir un inicio sintáctico natural de al menos 3 palabras y diferenciarse principalmente en la parte final. No fuerces frases artificiales; deben sonar naturales en francés.'
      : 'Las opciones pueden tener estructuras variadas y naturales; no necesitas forzar un prefijo común, pero deben mantener longitud, tono y categoría semántica similares.',
  );
  return `Reglas:\n${reglas.map((regla, i) => `${i + 1}. ${regla}`).join('\n')}`;
}
```

Note what changed vs. the original: the old unconditional line `'La respuesta correcta también debe estar parafraseada: no copies frases literales del transcript.'` is removed (it applied even to `micro_trottoir`, where it made no sense) and replaced by the new, stronger, example-driven instruction that now lives inside the `if (!opcionesFijas)` block alongside the new trap-distractor rule and the `reformulationType` instruction.

Replace `esquemaJson` entirely:

```js
export function esquemaJson(questionsPerAudio, optionCount = 4, { includeReformulationType = true } = {}) {
  const letras = ['A', 'B', 'C', 'D'].slice(0, optionCount);
  const opcionesEjemplo = letras.map(letra => `{ "id": "${letra}", "text": "..." }`).join(', ');
  const campoReformulacion = includeReformulationType
    ? ',\n      "reformulationType": "nominalisation|synonyme|restructuration"'
    : '';
  const pregunta = `{
      "prompt": "Pregunta en francés",
      "options": [${opcionesEjemplo}],
      "correctId": "A",
      "feedback": "Explicación breve en español.",
      "justification": "cita textual del transcript"${campoReformulacion}
    }`;
  return `Estructura JSON requerida:
{
  "transcript": "El texto simulado del audio en francés...",
  "questions": [${Array.from({ length: questionsPerAudio }, () => pregunta).join(',\n    ')}]
}`;
}
```

- [ ] **Step 4: Exclude `micro_trottoir` from the new schema field**

In `backend/src/prompt/sections/micro_trottoir.js`, change the last line:

```js
${esquemaJson(ctx.questionsPerAudio, posturas.length, { includeReformulationType: false })}`;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test test/prompt.test.js`
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add backend/src/prompt/common.js backend/src/prompt/sections/micro_trottoir.js backend/test/prompt.test.js
git commit -m "feat: strengthen reformulation prompt rule, add literal-trap rule and reformulationType field"
```

---

### Task 5: Full suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, all files including the new `test/reformulation.test.js` (182 pre-existing tests + the new/modified ones from Tasks 1-4).

- [ ] **Step 2: Manual generation smoke check (requires a configured provider key in `backend/.env`)**

Run: `cd backend && npm start`, then in another terminal trigger one real generation for a target section, e.g.:

```bash
curl -s -X POST 'http://localhost:3001/api/prefetch-question?difficulty=B2' | head -c 500
curl -s 'http://localhost:3001/api/generate-question?difficulty=B2'
```

Inspect the returned question's `options` by eye: confirm the correct option does not copy a key phrase from the `transcript` verbatim, and that a `reformulation` field is *not* exposed to the frontend response (it's internal to `set.json`/pipeline items — training mode's `aplanarItem` never forwards `questions`/`justification`, so this is expected, not a bug to chase). This is a spot-check, not a regression test — if the model still produces a bad item occasionally, the retry loop (Task 3) should have already caught and regenerated it before this response was returned.

If no provider key is configured, skip this step and note it explicitly when handing off — it cannot be verified without live API access.
