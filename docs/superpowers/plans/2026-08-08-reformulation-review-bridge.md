# Puente de reformulación en la revisión (Fase 2, Parte C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For each failed question in `ExamReview.jsx` (in a section with reformulation metadata from Parte A), show a side-by-side comparison of the literal audio fragment, the correct answer's transformation type, and — if the user picked the option that recycled literal audio words — an explicit warning.

**Architecture:** `backend/src/validation/reformulation.js` gains a pure, exported `findLiteralTrapOptionIds` function (extracted from inline logic) and marks qualifying option objects with `literalTrap: true` directly — this survives `itemGenerator.js`'s option-shuffle for free, unlike a letter-keyed id list would. `frontend/src/exam/reviewModel.js`'s pure, already-tested `buildReviewModel` gains two new per-question fields (`reformulation`, `selectedLiteralTrap`) that fully encode "should the bridge show, and was the trap picked" — `ExamReview.jsx` just renders what the model gives it, no re-deriving conditions in JSX.

**Tech Stack:** Node.js (`node --test`) for backend and frontend pure-module tests; React for `ExamReview.jsx` (browser-verified only, matching existing convention).

## Global Constraints

- Applies only to questions whose section is one of the 6 Parte A target sections (`annonce_publique`, `repondeur`, `chronique`, `interview`, `reportage`, `divers`) — never `micro_trottoir`/`conversation_image`, and never sets generated before Parte A. This is enforced entirely by data absence (no `reformulation` field), not by any new section-type check.
- The bridge shows only for failed questions: `reviewModel.js`'s `reformulation` field must be `null` whenever `isCorrect` is `true`, regardless of how valid the raw metadata is. This is a hard requirement, not a UI-layer nicety — the model is the single source of truth.
- No new field is added to `question.reformulation` (`extrait_audio`/`option_correcte`/`type` only, exactly as Parte A shipped it). The "which option is the trap" signal lives on the option object (`option.literalTrap: true`), never as an id list.
- No threshold/calibration values change (`config.reformulationOverlapThreshold` stays 0.75, `config.reformulationMinTrapWords` stays 2) — this plan only exposes an already-computed intermediate result, it doesn't touch pass/fail behavior.
- Warning copy must not claim a confirmed difference in meaning — the check only measures lexical overlap. Exact required copy: "Elegiste una opción que comparte palabras literales con el audio. Esto puede ser una trampa de reconocimiento superficial — compara el sentido completo, no solo las palabras, con la respuesta correcta."
- Type labels in the bridge are Spanish-only: `nominalisation` → "Nominalización", `synonyme` → "Sinónimo", `restructuration` → "Reestructuración", with a `?? 'Reformulación'` fallback.

---

### Task 1: Backend — mark literal-trap options, verify survival through shuffle

**Files:**
- Modify: `backend/src/validation/reformulation.js`
- Modify: `backend/test/reformulation.test.js`
- Modify: `backend/test/itemGenerator.test.js`

**Interfaces:**
- Produces: `findLiteralTrapOptionIds(question, transcript, config)` — pure function, returns `string[]` of option ids (excluding `question.correctId`) whose `contentWords(option.text)` share `>= config.reformulationMinTrapWords` entries with `contentWords(transcript)`. Exported from `backend/src/validation/reformulation.js`.
- Produces: `checkReformulation(question, transcript, config)` — same public contract as today (throws on the 3 existing conditions, attaches `question.reformulation = { extrait_audio, option_correcte, type }` unchanged in shape), plus a new side effect: every option whose id is in `findLiteralTrapOptionIds(...)`'s result gets `option.literalTrap = true` set directly on the option object in `question.options`. Options that don't qualify are left with no `literalTrap` property (not `false`).

- [ ] **Step 1: Write the failing tests for `findLiteralTrapOptionIds`**

In `backend/test/reformulation.test.js`, add the import and three new tests. Current imports at the top are:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReformulation } from '../src/validation/reformulation.js';
import { CONFIG } from '../src/examFormat.js';
```

Change the second import line to:

```js
import { checkReformulation, findLiteralTrapOptionIds } from '../src/validation/reformulation.js';
```

Add these tests after the existing 4 (after the `'rechaza reformulationType ausente o inválido'` test, at the end of the file):

```js
test('findLiteralTrapOptionIds devuelve los ids de las opciones que reciclan suficientes palabras literales', () => {
  const pregunta = preguntaBase();
  assert.deepEqual(findLiteralTrapOptionIds(pregunta, TRANSCRIPT, CONFIG), ['B']);
});

test('findLiteralTrapOptionIds devuelve un array vacío cuando ningún distractor califica', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'Un changement de programmation' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
  });
  assert.deepEqual(findLiteralTrapOptionIds(pregunta, TRANSCRIPT, CONFIG), []);
});

test('findLiteralTrapOptionIds devuelve varios ids cuando más de un distractor califica', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'On va fermer la piscine cet été' },
      { id: 'C', text: 'Des travaux de rénovation prévus cet été' },
      { id: 'D', text: 'Encore une autre option' },
    ],
  });
  assert.deepEqual(findLiteralTrapOptionIds(pregunta, TRANSCRIPT, CONFIG).sort(), ['B', 'C']);
});

test('checkReformulation marca con literalTrap las opciones calificantes y deja las demás sin la propiedad', () => {
  const pregunta = preguntaBase();
  checkReformulation(pregunta, TRANSCRIPT, CONFIG);
  const porId = Object.fromEntries(pregunta.options.map(o => [o.id, o]));
  assert.equal(porId.B.literalTrap, true);
  assert.equal(porId.A.literalTrap, undefined);
  assert.equal(porId.C.literalTrap, undefined);
  assert.equal(porId.D.literalTrap, undefined);
  assert.deepEqual(Object.keys(pregunta.reformulation).sort(), ['extrait_audio', 'option_correcte', 'type']);
});
```

- [ ] **Step 2: Write the failing post-shuffle integration test**

The bug this task exists to prevent: `itemGenerator.js`'s `aleatorizarOpciones` shuffles `question.options` and relabels them A-D, remapping `correctId` by matching option *text* — a letter-keyed id list computed before the shuffle would silently point at the wrong option afterward. `option.literalTrap` avoids this because `aleatorizarOpciones` copies each option with `{ ...option, id: newLetter }`, so any extra property (like `literalTrap`) rides along automatically. This step proves it, written before the fix exists so it genuinely fails first.

In `backend/test/itemGenerator.test.js`, add this test after the existing `'adjunta metadata de reformulación al ítem generado, sobreviviendo el barajado de opciones'` test (it reuses the existing `itemJson()` helper, whose default fixture already has two literal-trap-qualifying distractors at options B and D — see that fixture's definition earlier in the same file):

```js
test('las marcas de trampa literal (literalTrap) sobreviven al barajado de opciones, identificadas por texto', async () => {
  const gemini = proveedorFake('gemini', [itemJson({ correctId: 'A' })]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });

  const opciones = item.questions[0].options;
  const correcta = opciones.find(o => o.id === item.questions[0].correctId);
  const trampaB = opciones.find(o => o.text === 'Une deuxième option plausible, proche de mot20 et mot21');
  const trampaD = opciones.find(o => o.text === 'Une quatrième option plausible, proche de mot22 et mot23');
  const otra = opciones.find(o => o.text === 'Une troisième option plausible');

  assert.equal(correcta.text, 'Une première option plausible');
  assert.ok(!correcta.literalTrap, 'la opción correcta nunca debe quedar marcada como trampa literal');
  assert.equal(trampaB.literalTrap, true, 'la trampa original (mot20/mot21) debe seguir marcada tras el barajado, identificada por texto ya que su id cambió');
  assert.equal(trampaD.literalTrap, true, 'el caso de dos distractores calificando a la vez debe sobrevivir el barajado con ambas marcas intactas');
  assert.ok(!otra.literalTrap, 'una opción que nunca compartió palabras literales no debe quedar marcada');
});
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `cd backend && node --test test/reformulation.test.js test/itemGenerator.test.js`
Expected: FAIL in `reformulation.test.js` — `findLiteralTrapOptionIds` is not exported yet (import error / undefined function). FAIL in `itemGenerator.test.js`'s new test — `option.literalTrap` is `undefined` everywhere (property doesn't exist yet), so the `assert.equal(trampaB.literalTrap, true, ...)` assertions fail.

- [ ] **Step 4: Extract `findLiteralTrapOptionIds` and mark qualifying options**

Replace `backend/src/validation/reformulation.js` entirely with:

```js
import { contentWords } from './frenchWords.js';
import { scoreJustification } from './justification.js';

const REFORMULATION_TYPES = ['nominalisation', 'synonyme', 'restructuration'];

// Aplica solo a las 6 secciones de opciones generadas por el modelo (no
// micro_trottoir, cuyas opciones son posturas fijas, ni conversation_image,
// que tiene su propio esquema de opciones-imagen).
//
// Limitaciones conocidas del check de solapamiento:
// - No hay stemming/lematización: el conteo es por token exacto (contentWords),
//   así que "fermer" -> "fermeture" ya cuenta como palabras distintas (bien,
//   premia la reformulación), pero por el mismo motivo el check no distingue
//   "reformuló de verdad" de "le quitó a propósito el sustantivo-tema
//   inevitable para bajar el score" -- es una métrica aproximada, no un
//   análisis semántico, y una futura recalibración debería tenerlo presente.
// - El check de la trampa literal se vuelve más débil cuanto más largo es el
//   transcript: contra un transcript de 200-300 palabras (interview,
//   reportage) casi cualquier distractor razonable comparte por casualidad
//   reformulationMinTrapWords palabras de contenido con el audio, así que ahí
//   la garantía de "al menos una trampa literal" queda delegada en la
//   instrucción del prompt, no realmente forzada por este check. Esto es el
//   comportamiento esperado según el diseño, no un bug.
export function findLiteralTrapOptionIds(question, transcript, config) {
  const palabrasTranscript = new Set(contentWords(transcript));
  return question.options
    .filter(option => option.id !== question.correctId)
    .filter(option => contentWords(option.text)
      .filter(palabra => palabrasTranscript.has(palabra)).length >= config.reformulationMinTrapWords)
    .map(option => option.id);
}

export function checkReformulation(question, transcript, config) {
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

- [ ] **Step 5: Run both test files to verify they pass**

Run: `cd backend && node --test test/reformulation.test.js test/itemGenerator.test.js`
Expected: PASS in both — `reformulation.test.js` has 8 tests (the original 4 plus the 4 new ones), `itemGenerator.test.js`'s new test now passes. If the integration test still fails here, the marking logic has a bug (most likely: marking happening after the `{ extrait_audio, option_correcte, type }` object is built instead of before, or the `trapIds.includes(option.id)` check reversed) — do not proceed to Step 6 until it passes.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, 198 tests (193 before this task, +4 in `reformulation.test.js`, +1 in `itemGenerator.test.js`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/validation/reformulation.js backend/test/reformulation.test.js backend/test/itemGenerator.test.js
git commit -m "feat: mark literal-trap distractor options, survive option shuffle"
```

---

### Task 2: Frontend — `reviewModel.js` gains `reformulation`/`selectedLiteralTrap`

**Files:**
- Modify: `frontend/src/exam/reviewModel.js`
- Modify: `frontend/src/exam/reviewModel.test.js`

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task works against `question.reformulation` and `question.options[].literalTrap` in the `set` object structure, which is what Task 1 produces on the backend — but this task's tests build their own fixtures, they don't call any backend code).
- Produces: `buildReviewModel(set, answers)`'s per-question objects gain two fields: `reformulation: null | { extrait_audio: string, option_correcte: string, type: string }` and `selectedLiteralTrap: boolean`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/exam/reviewModel.test.js`, add a new fixture helper and 8 new tests. Add this helper after the existing `fixtureSet()` function:

```js
function fixtureSetReformulacion(questionOverrides = {}) {
  return {
    sections: [
      {
        type: 'annonce_publique',
        items: [
          {
            ref: 's1i1',
            questions: [{
              correctId: 'A',
              options: [
                { id: 'A', text: 'Fermeture de la piscine' },
                { id: 'B', text: 'Une option quelconque', literalTrap: true },
                { id: 'C', text: 'Une autre option' },
              ],
              reformulation: {
                extrait_audio: 'on va fermer la piscine cet été',
                option_correcte: 'Fermeture de la piscine',
                type: 'nominalisation',
              },
              ...questionOverrides,
            }],
          },
        ],
      },
    ],
  };
}
```

Add these tests at the end of the file:

```js
test('pregunta fallada con reformulation completa: el modelo expone el bloque', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.deepEqual(q.reformulation, {
    extrait_audio: 'on va fermer la piscine cet été',
    option_correcte: 'Fermeture de la piscine',
    type: 'nominalisation',
  });
});

test('pregunta correcta: reformulation queda null aunque la metadata cruda sea válida', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'A' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].reformulation, null);
});

test('sin responder: reformulation presente (cuenta como fallada), selectedLiteralTrap false', () => {
  const set = fixtureSetReformulacion();
  const model = buildReviewModel(set, {});
  const q = model.sections[0].items[0].questions[0];
  assert.deepEqual(q.reformulation, {
    extrait_audio: 'on va fermer la piscine cet été',
    option_correcte: 'Fermeture de la piscine',
    type: 'nominalisation',
  });
  assert.equal(q.selectedLiteralTrap, false);
});

test('set sin metadata de reformulación (sections/items sin options ni reformulation): reformulation null', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.reformulation, null);
  assert.equal(q.selectedLiteralTrap, false);
});

test('reformulation con type inválido: se trata como ausente', () => {
  const set = fixtureSetReformulacion({
    reformulation: { extrait_audio: 'texto', option_correcte: 'Fermeture de la piscine', type: 'paraphrase' },
  });
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].reformulation, null);
});

test('reformulation con extrait_audio vacío: se trata como ausente', () => {
  const set = fixtureSetReformulacion({
    reformulation: { extrait_audio: '', option_correcte: 'Fermeture de la piscine', type: 'nominalisation' },
  });
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].reformulation, null);
});

test('opción incorrecta elegida que NO es la trampa: selectedLiteralTrap false', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].selectedLiteralTrap, false);
});

test('opción incorrecta elegida que SÍ es la trampa: selectedLiteralTrap true', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].selectedLiteralTrap, true);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd frontend && npm test`
Expected: the 8 new tests FAIL (`reformulation`/`selectedLiteralTrap` are `undefined`, not matching the asserted values). The existing tests (using the original `fixtureSet()`, whose questions have no `options` field at all) must still PASS — this is the key regression risk: if the implementation calls `question.options.find(...)` unconditionally, those existing tests will throw a `TypeError` instead of failing an assertion. Confirm the failure mode is assertion mismatches, not thrown errors, before moving on — a thrown error there is a signal to guard `Array.isArray(question.options)` in Step 3.

- [ ] **Step 3: Implement the two new fields**

Replace `frontend/src/exam/reviewModel.js` entirely with:

```js
// Por cada ítem de audio, calcula el estado de cada una de sus preguntas
// y el conteo correcto/total a nivel ítem y a nivel sección. No toca DOM,
// no depende de React -- mismo principio que computeResults en
// examMachine.js, separado de cómo ExamReview lo renderiza.

const REFORMULATION_TYPES = ['nominalisation', 'synonyme', 'restructuration'];

// Única fuente de verdad de "¿corresponde mostrar el puente de
// reformulación en esta pregunta?" -- exige pregunta fallada (isCorrect
// false, lo que incluye "sin responder") Y metadata bien formada. Cualquier
// otra combinación (pregunta correcta, campo ausente, string vacío, tipo
// desconocido) se trata como "no hay puente que mostrar", nunca como un
// bloque a medio llenar. En la práctica `type` siempre es válido cuando
// `reformulation` existe (la Parte A ya lo valida antes de adjuntarlo),
// pero este chequeo no confía en esa garantía externa -- la revalida.
function buildReformulationInfo(question, isCorrect) {
  if (isCorrect) return null;
  const r = question.reformulation;
  if (!r) return null;
  if (typeof r.extrait_audio !== 'string' || !r.extrait_audio.trim()) return null;
  if (typeof r.option_correcte !== 'string' || !r.option_correcte.trim()) return null;
  if (!REFORMULATION_TYPES.includes(r.type)) return null;
  return { extrait_audio: r.extrait_audio, option_correcte: r.option_correcte, type: r.type };
}

export function buildReviewModel(set, answers) {
  const sections = set.sections.map(section => {
    const items = section.items.map(item => {
      const itemAnswers = answers[section.type]?.[item.ref] ?? {};
      const questions = item.questions.map((question, questionIndex) => {
        const selectedId = itemAnswers[questionIndex];
        // `null` significa "el tiempo se agotó sin respuesta" (ver
        // lockInUnanswered en examMachine.js) -- se muestra igual que
        // `undefined` ("nunca se visitó"), ninguno de los dos es una
        // selección real.
        const answered = selectedId !== undefined && selectedId !== null;
        const isCorrect = answered && selectedId === question.correctId;
        // Sets de antes de la Parte C1 (o de antes de la Parte A) nunca
        // traen `options` con la forma esperada -- no asumir su presencia.
        const selectedOption = answered && Array.isArray(question.options)
          ? question.options.find(option => option.id === selectedId)
          : undefined;
        return {
          questionIndex,
          selectedId: selectedId ?? null,
          correctId: question.correctId,
          answered,
          isCorrect,
          reformulation: buildReformulationInfo(question, isCorrect),
          selectedLiteralTrap: Boolean(selectedOption?.literalTrap),
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS, 75 tests (67 before this task, +8 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/reviewModel.js frontend/src/exam/reviewModel.test.js
git commit -m "feat: reviewModel exposes reformulation bridge data per question"
```

---

### Task 3: Frontend — render the bridge in `ExamReview.jsx`

**Files:**
- Modify: `frontend/src/exam/ExamReview.jsx`

**Interfaces:**
- Consumes: `question.reformulation` (`null | { extrait_audio, option_correcte, type }`) and `question.selectedLiteralTrap` (`boolean`) from Task 2's `buildReviewModel` output — `question` here is the per-question object already destructured in the existing `item.questions.map((question, questionIndex) => ...)` loop (`ExamReview.jsx`, currently around line 207).

- [ ] **Step 1: Add the type-label constant**

In `frontend/src/exam/ExamReview.jsx`, add a new constant right after the existing `SECTION_LABELS` constant (currently lines 8-17):

```js
const REFORMULATION_TYPE_LABELS = {
  nominalisation: 'Nominalización',
  synonyme: 'Sinónimo',
  restructuration: 'Reestructuración',
};
```

- [ ] **Step 2: Render the bridge block**

Inside the per-question `.map` (currently around lines 207-268), the existing structure is:

```jsx
<div className={section.type === 'conversation_image' ? 'flex gap-2 flex-wrap' : 'space-y-1'}>
  {setQuestion.options.map(opt => {
    const isCorrectOpt = opt.id === question.correctId;
    const isChosenOpt = opt.id === question.selectedId;
    let stateLabel = null;
    let className = section.type === 'conversation_image'
      ? 'p-2 border rounded flex flex-col items-center gap-1 min-w-[320px]'
      : 'p-2 border rounded';
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
    if (section.type === 'conversation_image') {
      const imagen = (setItem.images ?? []).find(img => img.id === opt.id);
      const imgUrl = imagen ? `${API_BASE}/api/sets/${set.id}/${imagen.path}` : null;
      return (
        <div key={opt.id} className={className}>
          {imgUrl && (
            <div className="relative">
              <img
                src={imgUrl}
                alt={`Option ${opt.id}`}
                className="w-72 h-40 object-contain"
              />
              <ZoomButton
                onClick={() => setZoomedImage({ src: imgUrl, alt: `Option ${opt.id}` })}
                label={`Ampliar imagen, opción ${opt.id}`}
              />
            </div>
          )}
          {stateLabel && <span className="text-xs font-semibold text-center">{stateLabel}</span>}
        </div>
      );
    }
    return (
      <div key={opt.id} className={className}>
        {opt.text}
        {stateLabel && (
          <span className="ml-2 text-xs font-semibold">{stateLabel}</span>
        )}
      </div>
    );
  })}
</div>
<p className="text-sm text-gray-700">{setQuestion.feedback}</p>
```

Do not change any line inside that block — it's shown in full only so the insertion point is unambiguous. Between the closing `</div>` of the options list and the `<p>{setQuestion.feedback}</p>` line, insert this new block (indentation is illustrative, match the surrounding JSX):

```jsx
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
```

The `<p className="text-sm text-gray-700">{setQuestion.feedback}</p>` line that already follows the options `</div>` stays exactly where it is, right after this new block. Do not change anything inside the options-mapping block shown above — that logic (correctness labels, `conversation_image` image rendering) is unrelated to this task.

- [ ] **Step 3: Run the frontend unit suite (regression check only — this file has no new unit tests)**

Run: `cd frontend && npm test`
Expected: PASS, still 75 tests (this task adds no test files; `ExamReview.jsx` is browser-verified only, matching the existing convention for this component).

- [ ] **Step 4: Manual browser verification**

This step cannot be automated — do it directly:

1. Start the backend: `cd backend && npm start` (needs a configured provider key to generate new content, or an existing generated set with `reformulation` metadata already on disk from Parte A).
2. Start the frontend: `cd frontend && npm run dev`.
3. Run a Modo Examen attempt through to completion using a set that has items from one of the 6 target sections (`annonce_publique`, `repondeur`, `chronique`, `interview`, `reportage`, `divers`), deliberately answering at least one such question incorrectly — once by picking a random wrong answer, once by picking specifically the option that recycles literal audio words if you can identify it from the transcript.
4. Open the review screen and confirm:
   - Failed questions in the 6 target sections show the indigo bridge block with the audio fragment, the correct answer, and its Spanish-labeled type.
   - Correct questions show no bridge block at all.
   - The question where you picked the literal-trap distractor shows the additional amber warning line; the question where you picked an unrelated wrong answer does not.
   - `micro_trottoir`/`conversation_image` questions (if the set has any) never show a bridge, correct or not.
5. If any generated set predates Parte A (no `reformulation` field anywhere), confirm its failed questions render exactly as before this change — no error, no empty block.

If anything doesn't match, note it — do not consider this task done until confirmed by eye.

---

### Task 4: Full suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, 198 tests.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, 75 tests.

- [ ] **Step 3: Confirm Task 3's manual browser verification was completed**

This is a checkpoint, not a new check: confirm the person or agent executing this plan actually completed Task 3 Step 4 (manual browser verification) and it passed. If it was skipped (e.g. no provider key available and no pre-existing generated set with `reformulation` metadata to test against), say so explicitly rather than marking this task done — this is the only step in the whole plan that verifies the feature actually works end-to-end in the browser, not just that the pure-logic layers are internally consistent.
