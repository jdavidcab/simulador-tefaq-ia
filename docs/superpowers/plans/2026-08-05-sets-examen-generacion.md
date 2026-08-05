# Generación y persistencia de sets de examen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Producir y persistir en disco sets completos de examen TEFAQ (36 preguntas / 32 audios) con planificación temática anti-repetición, generación reanudable y síntesis TTS a WAV.

**Architecture:** Tres anillos. El núcleo (`examFormat`, `topics/planner`, `prompt/`, `validation/`) son funciones puras sin disco, red ni reloj. El anillo de I/O (`sets/store`, `topics/history`, `audio/synth`, `providers/`) es lo único que toca el exterior. La orquestación (`itemGenerator`, `sets/pipeline`, `server`) los une. El disco es la única fuente de verdad del progreso: cada ítem se persiste en cuanto está listo, lo que convierte reanudar-tras-crash, pausar-por-cuota y seguir-mañana en la misma ruta de código.

**Tech Stack:** Node 22 ESM, Express 4, `@google/generative-ai`, `node:test` (runner nativo, sin dependencias nuevas).

**Spec:** `docs/superpowers/specs/2026-08-05-sets-examen-generacion-design.md`

## Global Constraints

- **Node 22, ESM.** `backend/package.json` ya tiene `"type": "module"`. Todos los imports son ESM con extensión explícita (`./foo.js`).
- **Cero dependencias nuevas.** Los tests usan `node:test` y `node:assert/strict`. No instalar jest, vitest, ni ninguna librería de aserciones.
- **`frontend/` no se toca en ninguna tarea.** Ni un archivo, ni una línea.
- **El contrato de `GET /api/generate-question` no cambia:** mismos query params, mismos códigos de error, misma forma de respuesta (`{prompt, options, transcript, correctId, feedback, provider, prefetched}`). La Task 12 incluye el test que lo garantiza.
- **`/api/tts`, el caché de audio en memoria y la cola de prefetch del modo entrenamiento se mantienen intactos.** El pipeline de sets no los usa.
- **`backend/data/` está en `.gitignore`.** Nunca commitear sets ni WAV generados.
- **Idioma:** código y comentarios en español (convención del repo); el contenido generado del examen va en francés; los textos de posturas de micro-trottoir van en francés exacto.
- **`conversation_image` se declara pero no se genera.** Existe en los presets y el campo `images: []` existe en el contrato; no hay constructor de prompt para él y `SET_STANDARD_36` no lo incluye.
- **Comandos de test:** desde `backend/`, `npm test` (que es `node --test`). Un test suelto: `node --test test/planner.test.js`.

---

## File Structure

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `backend/src/examFormat.js` | Datos puros: presets por sección, composiciones de set, configuración calibrable, aritmética de tolerancia y demanda |
| `backend/src/rng.js` | PRNG con semilla y muestreo sin reemplazo determinista |
| `backend/src/topics/catalog.js` | ~150 temas etiquetados por sección |
| `backend/src/topics/planner.js` | Plan temático del set (función pura) |
| `backend/src/topics/history.js` | Lector del historial sobre `data/sets/` |
| `backend/src/validation/frenchWords.js` | Stopwords francesas, normalización y extracción de palabras de contenido |
| `backend/src/validation/justification.js` | Puntuación y verificación de la cita |
| `backend/src/validation/index.js` | `validateItem` — reglas comunes y por sección |
| `backend/src/prompt/profiles.js` | `DIFFICULTY_PROFILES` (movido desde `prompt.js`) |
| `backend/src/prompt/common.js` | Fragmentos de prompt compartidos por todas las secciones |
| `backend/src/prompt/sections/*.js` | Un constructor por tipo de sección (7 archivos) |
| `backend/src/prompt/index.js` | `buildSectionPrompt` — despacho |
| `backend/src/itemGenerator.js` | Genera un ítem con la política de reintentos |
| `backend/src/sets/store.js` | I/O de `set.json` con escritura atómica |
| `backend/src/sets/pipeline.js` | Bucle de generación, estados, lock, ledger |
| `backend/src/audio/synth.js` | TTS a WAV en disco y duración medida |
| `backend/test/*.test.js` | Un archivo de test por módulo |

**Se modifican:**

- `backend/server.js` — rutas de sets, adaptador del modo entrenamiento, `pcmToWav` exportado.
- `backend/package.json` — script `test`.

**Se eliminan (Task 13):**

- `backend/src/prompt.js` — `TEFAQ_TOPICS` → `topics/catalog.js`, `DIFFICULTY_PROFILES` → `prompt/profiles.js`, `buildSystemPrompt` → `prompt/sections/`.
- `backend/src/questionGenerator.js` — validación → `validation/`, resto → `itemGenerator.js`.

`backend/src/tefaqPatterns.js` y `backend/src/providers/` se mantienen sin cambios.

---

### Task 1: Presets del formato de examen

**Files:**
- Create: `backend/src/examFormat.js`
- Create: `backend/test/examFormat.test.js`
- Modify: `backend/package.json` (añadir script `test`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `SECTION_PRESETS: Record<string, {bloc, questions, avant, apres, questionsPerAudio, minWords, maxWords, lectures}>`
  - `SET_COMPOSITIONS: Record<string, string[]>` — claves `SET_STANDARD_36`, `SET_STANDARD_40`
  - `GENERABLE_SECTIONS: string[]`, `SINGLE_QUESTION_SECTIONS: string[]`
  - `MICRO_TROTTOIR_POSTURES: {3: string[], 4: string[]}`
  - `CONFIG: {historyWindow, justificationThreshold, justificationMinContentWords, microTrottoirOptions, validationRetries, piloteCount}`
  - `wordTolerance(maxWords: number) -> number`
  - `itemsPerSection(sectionType: string) -> number`
  - `sectionDemand(compositionKey: string) -> Record<string, number>`
  - `totalQuestions(compositionKey: string) -> number`

- [ ] **Step 1: Añadir el script de test**

En `backend/package.json`, dentro de `"scripts"`:

```json
"test": "node --test"
```

- [ ] **Step 2: Escribir el test que falla**

Crear `backend/test/examFormat.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_PRESETS, SET_COMPOSITIONS, GENERABLE_SECTIONS, SINGLE_QUESTION_SECTIONS,
  MICRO_TROTTOIR_POSTURES, CONFIG, wordTolerance, itemsPerSection, sectionDemand, totalQuestions,
} from '../src/examFormat.js';

test('los 8 tipos de sección están declarados', () => {
  assert.deepEqual(Object.keys(SECTION_PRESETS).sort(), [
    'annonce_publique', 'chronique', 'conversation_image', 'divers',
    'interview', 'micro_trottoir', 'reportage', 'repondeur',
  ]);
});

test('los presets llevan los tiempos y rangos del livret oficial', () => {
  assert.deepEqual(SECTION_PRESETS.interview, {
    bloc: 3, questions: 6, avant: 20, apres: 30,
    questionsPerAudio: 2, minWords: 200, maxWords: 300, lectures: 1,
  });
  assert.deepEqual(SECTION_PRESETS.conversation_image, {
    bloc: 1, questions: 4, avant: 5, apres: 10,
    questionsPerAudio: 1, minWords: 40, maxWords: 70, lectures: 1,
  });
  assert.equal(SECTION_PRESETS.divers.questions, 10);
  assert.equal(SECTION_PRESETS.reportage.questionsPerAudio, 2);
});

test('SET_STANDARD_36 excluye conversation_image y suma 36 preguntas', () => {
  assert.ok(!SET_COMPOSITIONS.SET_STANDARD_36.includes('conversation_image'));
  assert.equal(SET_COMPOSITIONS.SET_STANDARD_36.length, 7);
  assert.equal(totalQuestions('SET_STANDARD_36'), 36);
});

test('SET_STANDARD_40 añade conversation_image al inicio', () => {
  assert.equal(SET_COMPOSITIONS.SET_STANDARD_40[0], 'conversation_image');
  assert.equal(totalQuestions('SET_STANDARD_40'), 40);
});

test('las secciones se ordenan por bloque', () => {
  const blocs = SET_COMPOSITIONS.SET_STANDARD_36.map(s => SECTION_PRESETS[s].bloc);
  assert.deepEqual(blocs, [...blocs].sort((a, b) => a - b));
});

test('itemsPerSection divide preguntas entre preguntas por audio', () => {
  assert.equal(itemsPerSection('interview'), 3);
  assert.equal(itemsPerSection('reportage'), 1);
  assert.equal(itemsPerSection('divers'), 10);
});

test('un set estándar son 32 ítems', () => {
  const total = Object.values(sectionDemand('SET_STANDARD_36')).reduce((a, b) => a + b, 0);
  assert.equal(total, 32);
});

test('la tolerancia de palabras es proporcional con suelo de 2', () => {
  assert.equal(wordTolerance(60), 3);
  assert.equal(wordTolerance(70), 4);
  assert.equal(wordTolerance(120), 6);
  assert.equal(wordTolerance(150), 8);
  assert.equal(wordTolerance(220), 11);
  assert.equal(wordTolerance(300), 15);
  assert.equal(wordTolerance(10), 2, 'suelo de 2 para transcripts muy cortos');
});

test('SINGLE_QUESTION_SECTIONS solo tiene secciones de una pregunta por audio', () => {
  for (const type of SINGLE_QUESTION_SECTIONS) {
    assert.equal(SECTION_PRESETS[type].questionsPerAudio, 1, type);
  }
  assert.ok(!SINGLE_QUESTION_SECTIONS.includes('interview'));
  assert.ok(!SINGLE_QUESTION_SECTIONS.includes('reportage'));
});

test('GENERABLE_SECTIONS excluye conversation_image', () => {
  assert.equal(GENERABLE_SECTIONS.length, 7);
  assert.ok(!GENERABLE_SECTIONS.includes('conversation_image'));
});

test('las posturas de micro-trottoir están en francés y la de 4 añade la abstención', () => {
  assert.deepEqual(MICRO_TROTTOIR_POSTURES[3], [
    'totalement pour', 'pour à certaines conditions', 'totalement contre',
  ]);
  assert.equal(MICRO_TROTTOIR_POSTURES[4].length, 4);
  assert.equal(MICRO_TROTTOIR_POSTURES[4][3], 'ne se prononce pas');
});

test('CONFIG expone los parámetros calibrables con sus defaults', () => {
  assert.equal(CONFIG.historyWindow, 3);
  assert.equal(CONFIG.justificationThreshold, 0.8);
  assert.equal(CONFIG.justificationMinContentWords, 5);
  assert.equal(CONFIG.microTrottoirOptions, 3);
  assert.equal(CONFIG.validationRetries, 2);
  assert.equal(CONFIG.piloteCount, 4);
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module '../src/examFormat.js'`

- [ ] **Step 4: Implementar `examFormat.js`**

Crear `backend/src/examFormat.js`:

```js
// Presets del formato TEFAQ. SOLO DATOS: aquí se calibra contra el examen real.
// Tiempos en segundos, del livret oficial 2024.
export const SECTION_PRESETS = {
  conversation_image: { bloc: 1, questions: 4,  avant: 5,  apres: 10, questionsPerAudio: 1, minWords: 40,  maxWords: 70,  lectures: 1 },
  annonce_publique:   { bloc: 2, questions: 4,  avant: 10, apres: 10, questionsPerAudio: 1, minWords: 30,  maxWords: 60,  lectures: 1 },
  repondeur:          { bloc: 2, questions: 6,  avant: 10, apres: 10, questionsPerAudio: 1, minWords: 30,  maxWords: 60,  lectures: 1 },
  micro_trottoir:     { bloc: 2, questions: 6,  avant: 5,  apres: 15, questionsPerAudio: 1, minWords: 40,  maxWords: 70,  lectures: 1 },
  chronique:          { bloc: 3, questions: 2,  avant: 10, apres: 15, questionsPerAudio: 1, minWords: 100, maxWords: 150, lectures: 1 },
  interview:          { bloc: 3, questions: 6,  avant: 20, apres: 30, questionsPerAudio: 2, minWords: 200, maxWords: 300, lectures: 1 },
  reportage:          { bloc: 3, questions: 2,  avant: 10, apres: 15, questionsPerAudio: 2, minWords: 150, maxWords: 220, lectures: 1 },
  divers:             { bloc: 4, questions: 10, avant: 10, apres: 15, questionsPerAudio: 1, minWords: 60,  maxWords: 120, lectures: 1 },
};

// conversation_image no tiene constructor de prompt todavía (slice 4).
export const GENERABLE_SECTIONS = [
  'annonce_publique', 'repondeur', 'micro_trottoir',
  'chronique', 'interview', 'reportage', 'divers',
];

export const SET_COMPOSITIONS = {
  SET_STANDARD_36: [...GENERABLE_SECTIONS],
  SET_STANDARD_40: ['conversation_image', ...GENERABLE_SECTIONS],
};

// Los ítems pilote deben aportar exactamente 1 pregunta cada uno para que
// 36 + 4 = 40. Un pilote de interview aportaría 2 y la cuenta saldría 38.
export const SINGLE_QUESTION_SECTIONS = GENERABLE_SECTIONS
  .filter(type => SECTION_PRESETS[type].questionsPerAudio === 1);

export const MICRO_TROTTOIR_POSTURES = {
  3: ['totalement pour', 'pour à certaines conditions', 'totalement contre'],
  4: ['totalement pour', 'pour à certaines conditions', 'totalement contre', 'ne se prononce pas'],
};

export const CONFIG = {
  historyWindow: 3,               // sets hacia atrás que bloquean un tema
  justificationThreshold: 0.8,    // solapamiento mínimo de la cita
  justificationMinContentWords: 5,
  microTrottoirOptions: 3,        // 3 o 4
  validationRetries: 2,           // reintentos en el MISMO proveedor
  piloteCount: 4,
};

// ±2 fijo sería absurdamente estrecho para una interview de 200-300 palabras.
export function wordTolerance(maxWords) {
  return Math.max(2, Math.round(maxWords * 0.05));
}

export function itemsPerSection(sectionType) {
  const preset = SECTION_PRESETS[sectionType];
  if (!preset) throw new Error(`Tipo de sección desconocido: ${sectionType}`);
  return preset.questions / preset.questionsPerAudio;
}

export function sectionDemand(compositionKey) {
  const sections = SET_COMPOSITIONS[compositionKey];
  if (!sections) throw new Error(`Composición desconocida: ${compositionKey}`);
  return Object.fromEntries(sections.map(type => [type, itemsPerSection(type)]));
}

export function totalQuestions(compositionKey) {
  const sections = SET_COMPOSITIONS[compositionKey];
  if (!sections) throw new Error(`Composición desconocida: ${compositionKey}`);
  return sections.reduce((sum, type) => sum + SECTION_PRESETS[type].questions, 0);
}
```

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

Run: `cd backend && npm test`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/examFormat.js backend/test/examFormat.test.js backend/package.json
git commit -m "feat(examen): presets del formato TEFAQ por sección"
```

---

### Task 2: PRNG con semilla

**Files:**
- Create: `backend/src/rng.js`
- Create: `backend/test/rng.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `createRng(seed: number) -> () => number` — flotante en [0,1)
  - `sampleWithoutReplacement(rng, array: T[], n: number) -> T[]` — lanza si `n > array.length`
  - `shuffleWithRng(rng, array: T[]) -> T[]` — devuelve copia

`Math.random` no acepta semilla, y sin determinismo el planificador no se puede testear por igualdad exacta.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/rng.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, sampleWithoutReplacement, shuffleWithRng } from '../src/rng.js';

test('la misma semilla produce la misma secuencia', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('semillas distintas producen secuencias distintas', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notDeepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('los valores caen en [0,1)', () => {
  const rng = createRng(999);
  for (let i = 0; i < 500; i += 1) {
    const value = rng();
    assert.ok(value >= 0 && value < 1, `fuera de rango: ${value}`);
  }
});

test('sampleWithoutReplacement devuelve n elementos distintos del origen', () => {
  const rng = createRng(42);
  const pool = ['a', 'b', 'c', 'd', 'e'];
  const picked = sampleWithoutReplacement(rng, pool, 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  for (const item of picked) assert.ok(pool.includes(item));
});

test('sampleWithoutReplacement no muta el array de origen', () => {
  const rng = createRng(7);
  const pool = ['a', 'b', 'c'];
  sampleWithoutReplacement(rng, pool, 2);
  assert.deepEqual(pool, ['a', 'b', 'c']);
});

test('sampleWithoutReplacement es determinista con la misma semilla', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
  const first = sampleWithoutReplacement(createRng(2024), pool, 4);
  const second = sampleWithoutReplacement(createRng(2024), pool, 4);
  assert.deepEqual(first, second);
});

test('sampleWithoutReplacement lanza si se piden más elementos de los que hay', () => {
  const rng = createRng(1);
  assert.throws(() => sampleWithoutReplacement(rng, ['a', 'b'], 3), /suficientes/);
});

test('shuffleWithRng devuelve una permutación sin mutar el origen', () => {
  const pool = ['a', 'b', 'c', 'd'];
  const shuffled = shuffleWithRng(createRng(5), pool);
  assert.deepEqual([...shuffled].sort(), [...pool].sort());
  assert.deepEqual(pool, ['a', 'b', 'c', 'd']);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/rng.test.js`
Expected: FAIL — `Cannot find module '../src/rng.js'`

- [ ] **Step 3: Implementar `rng.js`**

Crear `backend/src/rng.js`:

```js
// mulberry32: PRNG de 32 bits, rápido y con semilla. Suficiente para muestreo
// reproducible en tests; no es criptográfico y no pretende serlo.
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithRng(rng, array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sampleWithoutReplacement(rng, array, n) {
  if (n > array.length) {
    throw new Error(`No hay elementos suficientes: se piden ${n} de ${array.length}`);
  }
  return shuffleWithRng(rng, array).slice(0, n);
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/rng.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/rng.js backend/test/rng.test.js
git commit -m "feat(examen): PRNG con semilla para muestreo determinista"
```

---

### Task 3: Catálogo de temas etiquetado

**Files:**
- Create: `backend/src/topics/catalog.js`
- Create: `backend/test/catalog.test.js`

**Interfaces:**
- Consumes: `GENERABLE_SECTIONS`, `sectionDemand`, `CONFIG` de `examFormat.js`.
- Produces:
  - `TOPICS: Array<{id: string, text: string, sections: string[]}>`
  - `topicsForSection(sectionType: string, catalog?) -> Array<topic>`
  - `topicById(id: string, catalog?) -> topic | undefined`

**Nota sobre esta tarea:** es la única de contenido. No se listan aquí las ~150 entradas: el test de abajo **es** la especificación de aceptación y la verifica de forma mecánica. Se conservan las 59 entradas actuales de `TEFAQ_TOPICS` (copiar sus textos **literalmente** desde `backend/src/prompt.js:2-60`, asignándoles `id` `t-001`…`t-059` en su orden actual) y se redactan las nuevas a partir de `t-060` hasta cumplir los mínimos.

Criterios de etiquetado:

- `annonce_publique` — avisos en espacio público, transporte, instituciones, comercios.
- `repondeur` — mensajes de contestador: citas, trámites, servicios, escuela, clínica.
- `micro_trottoir` — temas **opinables** de calle: medidas municipales, hábitos, polémicas cotidianas.
- `chronique` / `interview` / `reportage` — debate y actualidad: política municipal/provincial, economía, salud pública, medio ambiente, inmigración, educación, tecnología y sociedad.
- `divers` — vida cotidiana en general; es el cajón más amplio y admite casi cualquier tema.

Un tema puede llevar varias etiquetas.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/catalog.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, topicsForSection, topicById } from '../src/topics/catalog.js';
import { GENERABLE_SECTIONS, sectionDemand, CONFIG } from '../src/examFormat.js';

test('el catálogo tiene al menos 150 temas', () => {
  assert.ok(TOPICS.length >= 150, `solo hay ${TOPICS.length}`);
});

test('cada tema tiene id único, texto no vacío y al menos una sección válida', () => {
  const ids = new Set();
  for (const topic of TOPICS) {
    assert.match(topic.id, /^t-\d{3,}$/, `id inválido: ${topic.id}`);
    assert.ok(!ids.has(topic.id), `id duplicado: ${topic.id}`);
    ids.add(topic.id);
    assert.ok(topic.text.trim().length > 0, `texto vacío en ${topic.id}`);
    assert.ok(topic.sections.length > 0, `sin secciones: ${topic.id}`);
    for (const section of topic.sections) {
      assert.ok(GENERABLE_SECTIONS.includes(section), `sección inválida ${section} en ${topic.id}`);
    }
  }
});

test('no hay textos de tema duplicados', () => {
  const textos = TOPICS.map(t => t.text.trim().toLowerCase());
  assert.equal(new Set(textos).size, textos.length);
});

test('cada sección tiene pool suficiente para una ventana N completa', () => {
  const demanda = sectionDemand('SET_STANDARD_36');
  for (const [section, demand] of Object.entries(demanda)) {
    const minimo = demand * (CONFIG.historyWindow + 1);
    const pool = topicsForSection(section).length;
    assert.ok(pool >= minimo, `${section}: pool ${pool} < mínimo ${minimo}`);
  }
});

test('el bloque 3 tiene al menos 40 temas de debate', () => {
  const bloque3 = new Set();
  for (const section of ['chronique', 'interview', 'reportage']) {
    for (const topic of topicsForSection(section)) bloque3.add(topic.id);
  }
  assert.ok(bloque3.size >= 40, `solo ${bloque3.size} temas de bloque 3`);
});

test('se conservan las 59 entradas originales con ids estables', () => {
  const originales = TOPICS.filter(t => Number(t.id.slice(2)) <= 59);
  assert.equal(originales.length, 59);
  assert.equal(topicById('t-001').id, 't-001');
});

test('topicsForSection filtra por etiqueta', () => {
  for (const topic of topicsForSection('chronique')) {
    assert.ok(topic.sections.includes('chronique'));
  }
});

test('topicById devuelve undefined para ids inexistentes', () => {
  assert.equal(topicById('t-999999'), undefined);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/catalog.test.js`
Expected: FAIL — `Cannot find module '../src/topics/catalog.js'`

- [ ] **Step 3: Implementar el catálogo**

Crear `backend/src/topics/catalog.js` con esta forma:

```js
// Temas del examen. El `id` es estable y viaja al plan y al historial;
// el `text` puede reescribirse sin invalidar historial.
// Un tema puede servir a varias secciones.
export const TOPICS = [
  { id: 't-001', text: 'Un problema de mantenimiento en un departamento o edificio en Quebec (ej. calefacción, plomería, ruido de vecinos).', sections: ['repondeur', 'divers'] },
  { id: 't-002', text: 'Un anuncio en el transporte público de Montreal (ej. metro, autobús, STM) sobre un retraso, desvío o normas de cortesía.', sections: ['annonce_publique', 'divers'] },
  { id: 't-005', text: 'Un fragmento de radio debatiendo un tema de actualidad (ej. uso de redes sociales, inflación en el supermercado, medio ambiente).', sections: ['chronique', 'interview', 'micro_trottoir'] },
  { id: 't-023', text: 'un boletín de radio sobre una nueva medida municipal de estacionamiento en Montreal', sections: ['chronique', 'reportage', 'micro_trottoir', 'divers'] },
  // … las 59 originales copiadas literalmente desde prompt.js con ids t-001..t-059,
  //    más las nuevas t-060… hasta cumplir los mínimos del test.
];

export function topicsForSection(sectionType, catalog = TOPICS) {
  return catalog.filter(topic => topic.sections.includes(sectionType));
}

export function topicById(id, catalog = TOPICS) {
  return catalog.find(topic => topic.id === id);
}
```

Completar hasta que el test pase. Mínimos por sección que el test exige (demanda × 4):
`annonce_publique` 16 · `repondeur` 24 · `micro_trottoir` 24 · `chronique` 8 · `interview` 12 · `reportage` 4 · `divers` 40, y ≥40 temas distintos etiquetados para el bloque 3.

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/catalog.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/topics/catalog.js backend/test/catalog.test.js
git commit -m "feat(examen): catálogo de temas etiquetado por sección"
```

---

### Task 4: Lector del historial de temas

**Files:**
- Create: `backend/src/topics/history.js`
- Create: `backend/test/history.test.js`

**Interfaces:**
- Consumes: nada del proyecto.
- Produces: `readRecentPlans(setsDir: string, window: number) -> Promise<Array<Array<{sectionType, topicId}>>>` — planes de los `window` sets más recientes por `genere_le`, descendente.

No hay archivo de historial propio: el historial ya está en el campo `plan` de los `set.json`. Una sola fuente de verdad, y borrar la carpeta de un set libera sus temas sin código de limpieza.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/history.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecentPlans } from '../src/topics/history.js';

async function crearSet(setsDir, id, genereLe, plan) {
  const dir = join(setsDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'set.json'), JSON.stringify({ id, genere_le: genereLe, plan }));
}

test('devuelve los planes de los N sets más recientes, del más nuevo al más viejo', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-a', '2026-01-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-001' }]);
  await crearSet(setsDir, 'set-b', '2026-03-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-002' }]);
  await crearSet(setsDir, 'set-c', '2026-02-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-003' }]);

  const planes = await readRecentPlans(setsDir, 2);
  assert.equal(planes.length, 2);
  assert.equal(planes[0][0].topicId, 't-002');
  assert.equal(planes[1][0].topicId, 't-003');
});

test('devuelve array vacío si el directorio no existe', async () => {
  assert.deepEqual(await readRecentPlans(join(tmpdir(), 'no-existe-jamas'), 3), []);
});

test('devuelve array vacío si no hay sets', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  assert.deepEqual(await readRecentPlans(setsDir, 3), []);
});

test('ignora carpetas sin set.json y sets con JSON corrupto', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await mkdir(join(setsDir, 'vacia'), { recursive: true });
  await mkdir(join(setsDir, 'rota'), { recursive: true });
  await writeFile(join(setsDir, 'rota', 'set.json'), '{ esto no es json');
  await crearSet(setsDir, 'set-ok', '2026-01-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-007' }]);

  const planes = await readRecentPlans(setsDir, 5);
  assert.equal(planes.length, 1);
  assert.equal(planes[0][0].topicId, 't-007');
});

test('un set sin campo plan aporta un plan vacío, no rompe', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-sin-plan', '2026-01-01T00:00:00Z', undefined);
  const planes = await readRecentPlans(setsDir, 3);
  assert.deepEqual(planes, [[]]);
});

test('window 0 devuelve array vacío', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-a', '2026-01-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-001' }]);
  assert.deepEqual(await readRecentPlans(setsDir, 0), []);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/history.test.js`
Expected: FAIL — `Cannot find module '../src/topics/history.js'`

- [ ] **Step 3: Implementar `history.js`**

Crear `backend/src/topics/history.js`:

```js
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// El historial se deriva de los set.json en disco: una sola fuente de verdad.
// Borrar la carpeta de un set libera sus temas sin código de limpieza.
export async function readRecentPlans(setsDir, window) {
  if (window <= 0) return [];

  let entries;
  try {
    entries = await readdir(setsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const sets = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await readFile(join(setsDir, entry.name, 'set.json'), 'utf8');
      const data = JSON.parse(raw);
      sets.push({ genere_le: data.genere_le ?? '', plan: data.plan ?? [] });
    } catch {
      // Carpeta sin set.json o JSON corrupto: no debe tumbar la planificación.
      continue;
    }
  }

  return sets
    .sort((a, b) => String(b.genere_le).localeCompare(String(a.genere_le)))
    .slice(0, window)
    .map(set => set.plan);
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/history.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/topics/history.js backend/test/history.test.js
git commit -m "feat(examen): historial de temas derivado de los sets en disco"
```

---

### Task 5: Planificador temático

**Files:**
- Create: `backend/src/topics/planner.js`
- Create: `backend/test/planner.test.js`

**Interfaces:**
- Consumes: `SET_COMPOSITIONS`, `SECTION_PRESETS`, `sectionDemand`, `SINGLE_QUESTION_SECTIONS`, `MICRO_TROTTOIR_POSTURES`, `CONFIG` de `examFormat.js`; `topicsForSection` de `topics/catalog.js`; `createRng`, `sampleWithoutReplacement`, `shuffleWithRng` de `rng.js`.
- Produces: `planTopics({catalog, compositionKey, recentPlans, seed, pilotes, config}) -> {plan, relaxations}` donde `plan: Array<{ref, sectionType, topicId, pilote, posture?}>` y `relaxations: Array<{sectionType, fenetre}>`.

`ref` es `s<indice de sección + 1>i<indice de ítem + 1>`, con las secciones en el orden de la composición.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/planner.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTopics } from '../src/topics/planner.js';
import { CONFIG, MICRO_TROTTOIR_POSTURES } from '../src/examFormat.js';

// Catálogo sintético: suficiente para SET_STANDARD_36 con holgura.
function catalogoAmplio() {
  const temas = [];
  const porSeccion = {
    annonce_publique: 30, repondeur: 30, micro_trottoir: 30,
    chronique: 30, interview: 30, reportage: 30, divers: 60,
  };
  let n = 1;
  for (const [seccion, cantidad] of Object.entries(porSeccion)) {
    for (let i = 0; i < cantidad; i += 1) {
      temas.push({ id: `t-${String(n).padStart(4, '0')}`, text: `tema ${n}`, sections: [seccion] });
      n += 1;
    }
  }
  return temas;
}

const OPCIONES_BASE = { compositionKey: 'SET_STANDARD_36', recentPlans: [], seed: 1234, pilotes: false, config: CONFIG };

test('el plan cubre los 32 ítems del set estándar', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  assert.equal(plan.length, 32);
});

test('ningún tema se repite dentro del set', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  const ids = plan.map(p => p.topicId);
  assert.equal(new Set(ids).size, ids.length);
});

test('los refs son posicionales y siguen el orden de la composición', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  assert.equal(plan[0].ref, 's1i1');
  assert.equal(plan[0].sectionType, 'annonce_publique');
  assert.equal(plan[3].ref, 's1i4');
  assert.equal(plan[4].ref, 's2i1');
  assert.equal(plan[4].sectionType, 'repondeur');
  assert.equal(plan.at(-1).sectionType, 'divers');
  assert.equal(plan.at(-1).ref, 's7i10');
});

test('cada tema asignado está etiquetado para su sección', () => {
  const catalog = catalogoAmplio();
  const { plan } = planTopics({ catalog, ...OPCIONES_BASE });
  for (const entrada of plan) {
    const tema = catalog.find(t => t.id === entrada.topicId);
    assert.ok(tema.sections.includes(entrada.sectionType), `${entrada.topicId} no sirve para ${entrada.sectionType}`);
  }
});

test('la misma semilla produce el mismo plan', () => {
  const catalog = catalogoAmplio();
  const a = planTopics({ catalog, ...OPCIONES_BASE });
  const b = planTopics({ catalog, ...OPCIONES_BASE });
  assert.deepEqual(a.plan, b.plan);
});

test('semillas distintas producen planes distintos', () => {
  const catalog = catalogoAmplio();
  const a = planTopics({ catalog, ...OPCIONES_BASE, seed: 1 });
  const b = planTopics({ catalog, ...OPCIONES_BASE, seed: 2 });
  assert.notDeepEqual(a.plan.map(p => p.topicId), b.plan.map(p => p.topicId));
});

test('excluye los temas usados en los sets recientes', () => {
  const catalog = catalogoAmplio();
  const primero = planTopics({ catalog, ...OPCIONES_BASE, seed: 10 });
  const usados = new Set(primero.plan.map(p => p.topicId));
  const segundo = planTopics({ catalog, ...OPCIONES_BASE, seed: 11, recentPlans: [primero.plan] });
  for (const entrada of segundo.plan) {
    assert.ok(!usados.has(entrada.topicId), `${entrada.topicId} repetido respecto al set anterior`);
  }
  assert.deepEqual(segundo.relaxations, []);
});

test('sirve primero a las secciones escasas: annonce no puede vaciar el pool de divers', () => {
  // divers (demanda 10) SOLO puede usar 10 temas compartidos.
  // annonce_publique (demanda 4) puede usar esos mismos 10 más 4 exclusivos.
  // El orden de composición pondría annonce primero, que robaría del pool
  // compartido y dejaría a divers sin temas suficientes. El orden por escasez
  // sirve divers primero (ratio 1.0 frente a 3.5) y ambas caben.
  const compartidos = Array.from({ length: 10 }, (_, i) => ({
    id: `t-comp${i}`, text: `compartido ${i}`, sections: ['annonce_publique', 'divers'],
  }));
  const exclusivosAnnonce = Array.from({ length: 4 }, (_, i) => ({
    id: `t-excl${i}`, text: `exclusivo ${i}`, sections: ['annonce_publique'],
  }));
  const resto = [];
  let n = 0;
  for (const [seccion, cantidad] of Object.entries({
    repondeur: 20, micro_trottoir: 20, chronique: 20, interview: 20, reportage: 20,
  })) {
    for (let i = 0; i < cantidad; i += 1) {
      resto.push({ id: `t-r${n}`, text: `resto ${n}`, sections: [seccion] });
      n += 1;
    }
  }

  const { plan } = planTopics({
    catalog: [...compartidos, ...exclusivosAnnonce, ...resto], ...OPCIONES_BASE,
  });

  const idsDivers = plan.filter(p => p.sectionType === 'divers').map(p => p.topicId).sort();
  const idsAnnonce = plan.filter(p => p.sectionType === 'annonce_publique').map(p => p.topicId).sort();

  assert.deepEqual(idsDivers, compartidos.map(t => t.id).sort(),
    'divers debe quedarse con todo el pool compartido');
  assert.deepEqual(idsAnnonce, exclusivosAnnonce.map(t => t.id).sort(),
    'annonce debe conformarse con sus exclusivos');
});

test('relaja la ventana solo en la sección afectada y lo registra', () => {
  // chronique tiene exactamente 3 temas y demanda 2. Si el set anterior usó 2
  // de ellos, con la ventana intacta solo queda 1 y hay que relajar.
  const chroniqueTemas = Array.from({ length: 3 }, (_, i) => ({
    id: `t-chr${i}`, text: `chronique ${i}`, sections: ['chronique'],
  }));
  const resto = [];
  let n = 0;
  for (const [seccion, cantidad] of Object.entries({
    annonce_publique: 20, repondeur: 20, micro_trottoir: 20,
    interview: 20, reportage: 20, divers: 40,
  })) {
    for (let i = 0; i < cantidad; i += 1) {
      resto.push({ id: `t-r${n}`, text: `resto ${n}`, sections: [seccion] });
      n += 1;
    }
  }
  const historial = [[
    { sectionType: 'chronique', topicId: 't-chr0' },
    { sectionType: 'chronique', topicId: 't-chr1' },
  ]];

  const { plan, relaxations } = planTopics({
    catalog: [...chroniqueTemas, ...resto], ...OPCIONES_BASE, recentPlans: historial,
  });

  assert.equal(plan.filter(p => p.sectionType === 'chronique').length, 2);
  const relajada = relaxations.find(r => r.sectionType === 'chronique');
  assert.ok(relajada, 'debería registrar la relajación de chronique');
  assert.ok(relajada.fenetre < CONFIG.historyWindow);
  assert.ok(!relaxations.some(r => r.sectionType === 'divers'), 'no debe relajar secciones sanas');
});

test('aborta si ni con ventana 0 hay temas suficientes', () => {
  const catalog = catalogoAmplio().filter(t => !t.sections.includes('interview'));
  assert.throws(
    () => planTopics({ catalog, ...OPCIONES_BASE }),
    /interview/,
  );
});

test('reparte las posturas de micro-trottoir entre las disponibles', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  const micro = plan.filter(p => p.sectionType === 'micro_trottoir');
  assert.equal(micro.length, 6);
  for (const entrada of micro) {
    assert.ok(MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions].includes(entrada.posture));
  }
  assert.ok(new Set(micro.map(p => p.posture)).size >= 2, 'las posturas no pueden ser todas la misma');
});

test('solo micro_trottoir lleva postura', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  for (const entrada of plan.filter(p => p.sectionType !== 'micro_trottoir')) {
    assert.equal(entrada.posture, undefined);
  }
});

test('con pilotes añade 4 ítems de una sola pregunta', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE, pilotes: true });
  const pilotes = plan.filter(p => p.pilote);
  assert.equal(pilotes.length, 4);
  assert.equal(plan.length, 36);
  for (const entrada of pilotes) {
    assert.ok(!['interview', 'reportage'].includes(entrada.sectionType), 'un pilote multi-pregunta rompería la cuenta de 40');
  }
  assert.equal(new Set(plan.map(p => p.topicId)).size, 36, 'los pilote consumen su propio tema');
});

test('sin pilotes ningún ítem va marcado', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  assert.ok(plan.every(p => p.pilote === false));
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/planner.test.js`
Expected: FAIL — `Cannot find module '../src/topics/planner.js'`

- [ ] **Step 3: Implementar `planner.js`**

Crear `backend/src/topics/planner.js`:

```js
import {
  SET_COMPOSITIONS, SINGLE_QUESTION_SECTIONS, MICRO_TROTTOIR_POSTURES,
  sectionDemand, CONFIG as DEFAULT_CONFIG,
} from '../examFormat.js';
import { topicsForSection } from './catalog.js';
import { createRng, sampleWithoutReplacement, shuffleWithRng } from '../rng.js';

// Temas usados por cada sección en los `window` planes más recientes.
function usadosPorSeccion(recentPlans, window) {
  const usados = new Map();
  for (const plan of recentPlans.slice(0, window)) {
    for (const entrada of plan) {
      if (!usados.has(entrada.sectionType)) usados.set(entrada.sectionType, new Set());
      usados.get(entrada.sectionType).add(entrada.topicId);
    }
  }
  return usados;
}

function disponibles(catalog, sectionType, recentPlans, window, yaAsignados) {
  const bloqueados = usadosPorSeccion(recentPlans, window).get(sectionType) ?? new Set();
  return topicsForSection(sectionType, catalog)
    .filter(topic => !bloqueados.has(topic.id) && !yaAsignados.has(topic.id));
}

export function planTopics({
  catalog, compositionKey, recentPlans = [], seed, pilotes = false, config = DEFAULT_CONFIG,
}) {
  const sections = SET_COMPOSITIONS[compositionKey];
  if (!sections) throw new Error(`Composición desconocida: ${compositionKey}`);

  const rng = createRng(seed);
  const demanda = { ...sectionDemand(compositionKey) };

  // Los pilote son ítems extra de UNA pregunta, repartidos entre las secciones
  // de una pregunta por audio presentes en la composición.
  const pilotesPorSeccion = {};
  if (pilotes) {
    const candidatas = sections.filter(type => SINGLE_QUESTION_SECTIONS.includes(type));
    const barajadas = shuffleWithRng(rng, candidatas);
    for (let i = 0; i < config.piloteCount; i += 1) {
      const type = barajadas[i % barajadas.length];
      pilotesPorSeccion[type] = (pilotesPorSeccion[type] ?? 0) + 1;
      demanda[type] += 1;
    }
  }

  // Asignar primero las secciones más escasas: si `divers` (que encaja con casi
  // todo) se sirviera primero, se comería los pocos temas de debate del bloque 3.
  const relaxations = [];
  const asignados = new Set();
  const porSeccion = {};

  const ordenPorEscasez = [...sections].sort((a, b) => {
    const holguraA = disponibles(catalog, a, recentPlans, config.historyWindow, asignados).length / demanda[a];
    const holguraB = disponibles(catalog, b, recentPlans, config.historyWindow, asignados).length / demanda[b];
    return holguraA - holguraB;
  });

  for (const sectionType of ordenPorEscasez) {
    let window = config.historyWindow;
    let pool = disponibles(catalog, sectionType, recentPlans, window, asignados);

    while (pool.length < demanda[sectionType] && window > 0) {
      window -= 1;
      pool = disponibles(catalog, sectionType, recentPlans, window, asignados);
    }
    if (window < config.historyWindow) relaxations.push({ sectionType, fenetre: window });

    if (pool.length < demanda[sectionType]) {
      throw new Error(
        `Temas insuficientes para "${sectionType}": ${pool.length} disponibles, ${demanda[sectionType]} necesarios. Amplía el catálogo.`,
      );
    }

    const elegidos = sampleWithoutReplacement(rng, pool, demanda[sectionType]);
    for (const topic of elegidos) asignados.add(topic.id);
    porSeccion[sectionType] = elegidos;
  }

  // Los refs se emiten en el orden de la composición, no en el de asignación.
  const posturas = MICRO_TROTTOIR_POSTURES[config.microTrottoirOptions];
  const plan = [];
  sections.forEach((sectionType, indiceSeccion) => {
    const temas = porSeccion[sectionType];
    const pilotesAqui = pilotesPorSeccion[sectionType] ?? 0;
    const primerPilote = temas.length - pilotesAqui;

    let posturasBarajadas = [];
    if (sectionType === 'micro_trottoir') {
      posturasBarajadas = temas.map((_, i) => posturas[i % posturas.length]);
      posturasBarajadas = shuffleWithRng(rng, posturasBarajadas);
    }

    temas.forEach((topic, indiceItem) => {
      const entrada = {
        ref: `s${indiceSeccion + 1}i${indiceItem + 1}`,
        sectionType,
        topicId: topic.id,
        pilote: indiceItem >= primerPilote,
      };
      if (sectionType === 'micro_trottoir') entrada.posture = posturasBarajadas[indiceItem];
      plan.push(entrada);
    });
  });

  return { plan, relaxations };
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/planner.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/topics/planner.js backend/test/planner.test.js
git commit -m "feat(examen): planificador temático con anti-repetición por sección"
```

---

### Task 6: Normalización de texto y verificación de la cita

**Files:**
- Create: `backend/src/validation/frenchWords.js`
- Create: `backend/src/validation/justification.js`
- Create: `backend/test/justification.test.js`

**Interfaces:**
- Consumes: `CONFIG` de `examFormat.js`.
- Produces:
  - `normalizeText(text: string) -> string` (frenchWords.js)
  - `contentWords(text: string) -> string[]` — normalizadas, sin stopwords, sin duplicados (frenchWords.js)
  - `scoreJustification(justification: string, transcript: string) -> number` (justification.js)
  - `checkJustification(justification, transcript, config) -> {ok: boolean, score: number, error?: string}` (justification.js)

La lista de stopwords se duplica desde `frontend/src/trainingScan.js` a propósito: backend y frontend son paquetes npm sin workspace, y los dos usos van a divergir — el frontend resalta palabras clave, el backend verifica citas.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/justification.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, contentWords } from '../src/validation/frenchWords.js';
import { scoreJustification, checkJustification } from '../src/validation/justification.js';
import { CONFIG } from '../src/examFormat.js';

test('normalizeText baja a minúsculas, quita diacríticos y puntuación, colapsa espacios', () => {
  assert.equal(normalizeText('  Le  MÉTRO, c’est « retardé »!  '), 'le metro c est retarde');
});

test('contentWords quita stopwords y duplicados', () => {
  const palabras = contentWords('Le métro de la ligne est retardé, le métro est retardé');
  assert.ok(palabras.includes('metro'));
  assert.ok(palabras.includes('retarde'));
  assert.ok(!palabras.includes('le'));
  assert.ok(!palabras.includes('de'));
  assert.equal(new Set(palabras).size, palabras.length);
});

test('una cita literal puntúa 1.0', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu’à midi.';
  assert.equal(scoreJustification('la ligne orange sera interrompue entre Berri et Jean-Talon', transcript), 1);
});

test('una cita con puntuación y acentos distintos sigue puntuando 1.0', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu’à midi.';
  assert.equal(scoreJustification('«La ligne orange sera interrompue, entre Berri et Jean-Talon»!', transcript), 1);
});

test('una paráfrasis con casi todas las palabras de contenido puntúa alto', () => {
  const transcript = 'Le service sera interrompu sur la ligne orange entre Berri et Jean-Talon jusqu’à midi.';
  const score = scoreJustification('service interrompu ligne orange Berri Jean-Talon midi', transcript);
  assert.ok(score >= 0.9, `score fue ${score}`);
});

test('una cita inventada puntúa bajo', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu’à midi.';
  const score = scoreJustification('les travaux de voirie commenceront lundi prochain dans le quartier', transcript);
  assert.ok(score < 0.5, `score fue ${score}`);
});

test('checkJustification acepta por encima del umbral', () => {
  const transcript = 'Le service sera interrompu sur la ligne orange entre Berri et Jean-Talon jusqu’à midi.';
  const resultado = checkJustification('le service sera interrompu sur la ligne orange', transcript, CONFIG);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.score, 1);
});

test('checkJustification rechaza por debajo del umbral', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu’à midi.';
  const resultado = checkJustification('les travaux de voirie commenceront lundi prochain dans le quartier', transcript, CONFIG);
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /justification/i);
});

test('rechaza citas demasiado cortas aunque coincidan', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu’à midi.';
  const resultado = checkJustification('la ligne orange', transcript, CONFIG);
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /5 palabras de contenido/);
});

test('rechaza una justificación vacía', () => {
  const resultado = checkJustification('   ', 'cualquier transcript', CONFIG);
  assert.equal(resultado.ok, false);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/justification.test.js`
Expected: FAIL — `Cannot find module '../src/validation/frenchWords.js'`

- [ ] **Step 3: Implementar los dos módulos**

Crear `backend/src/validation/frenchWords.js`:

```js
// Copia deliberada de la lista de frontend/src/trainingScan.js: son dos paquetes
// npm sin workspace, y los usos divergen (allí se resaltan palabras clave, aquí
// se verifican citas). Duplicar lógica sería deuda; duplicar una lista estática no.
const FRENCH_STOPWORDS = new Set([
  'a', 'alors', 'au', 'aucun', 'aussi', 'aux', 'avec', 'ce', 'ces', 'chez', 'comme', 'dans', 'de', 'des',
  'du', 'elle', 'en', 'entre', 'est', 'et', 'eux', 'il', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma',
  'mais', 'me', 'mes', 'moi', 'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas', 'pour',
  'qu', 'que', 'qui', 'sa', 'se', 'ses', 'son', 'sur', 'ta', 'te', 'tes', 'toi', 'ton', 'tu', 'un', 'une',
  'vos', 'votre', 'vous', 'y', 'd', 'l', 'c', 'n', 'j', 'm', 't', 's', 'quand', 'si', 'car', 'donc', 'or',
]);

export function normalizeText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function contentWords(text) {
  const normalizado = normalizeText(text);
  if (!normalizado) return [];
  const vistas = new Set();
  for (const token of normalizado.split(' ')) {
    if (!token || FRENCH_STOPWORDS.has(token)) continue;
    vistas.add(token);
  }
  return [...vistas];
}
```

Crear `backend/src/validation/justification.js`:

```js
import { normalizeText, contentWords } from './frenchWords.js';

// 1.0 si la cita aparece literalmente (tras normalizar); si no, fracción de sus
// palabras de contenido distintas que aparecen en el transcript.
export function scoreJustification(justification, transcript) {
  const citaNorm = normalizeText(justification);
  const transcriptNorm = normalizeText(transcript);
  if (!citaNorm) return 0;
  if (transcriptNorm.includes(citaNorm)) return 1;

  const palabrasCita = contentWords(justification);
  if (palabrasCita.length === 0) return 0;
  const palabrasTranscript = new Set(normalizeText(transcript).split(' '));
  const presentes = palabrasCita.filter(palabra => palabrasTranscript.has(palabra)).length;
  return presentes / palabrasCita.length;
}

export function checkJustification(justification, transcript, config) {
  const texto = String(justification ?? '').trim();
  if (!texto) {
    return { ok: false, score: 0, error: 'falta "justification"' };
  }

  const palabras = contentWords(texto);
  if (palabras.length < config.justificationMinContentWords) {
    // Sin esta guarda, una "cita" de tres palabras hace match trivial.
    return {
      ok: false,
      score: scoreJustification(texto, transcript),
      error: `"justification" necesita al menos ${config.justificationMinContentWords} palabras de contenido, tiene ${palabras.length}`,
    };
  }

  const score = scoreJustification(texto, transcript);
  if (score < config.justificationThreshold) {
    return {
      ok: false,
      score,
      error: `"justification" no aparece en el transcript (score ${score.toFixed(2)} < ${config.justificationThreshold})`,
    };
  }

  return { ok: true, score };
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/justification.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/validation/frenchWords.js backend/src/validation/justification.js backend/test/justification.test.js
git commit -m "feat(examen): verificación de la cita que sostiene la respuesta"
```

---

### Task 7: Validación de ítems

**Files:**
- Create: `backend/src/validation/index.js`
- Create: `backend/test/validation.test.js`

**Interfaces:**
- Consumes: `SECTION_PRESETS`, `wordTolerance`, `MICRO_TROTTOIR_POSTURES`, `CONFIG` de `examFormat.js`; `checkJustification` de `validation/justification.js`.
- Produces:
  - `countWords(text: string) -> number`
  - `validateItem(item, sectionType, opts?) -> item` — lanza `Error` al primer fallo; anota `justificationScore` en cada pregunta. `opts: {config?, posture?, minWords?, maxWords?}`.

El ítem que entra tiene forma `{transcript, questions: [{prompt, options, correctId, feedback, justification}]}`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/validation.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, countWords } from '../src/validation/index.js';
import { MICRO_TROTTOIR_POSTURES, CONFIG } from '../src/examFormat.js';

function palabras(n, base = 'mot') {
  return Array.from({ length: n }, (_, i) => `${base}${i}`).join(' ');
}

function preguntaValida(transcript) {
  return {
    prompt: 'Quel est le problème signalé ?',
    options: [
      { id: 'A', text: 'Une panne de chauffage' },
      { id: 'B', text: 'Une fuite d’eau' },
      { id: 'C', text: 'Un bruit de voisinage' },
      { id: 'D', text: 'Une porte bloquée' },
    ],
    correctId: 'B',
    feedback: 'La locataire signale de l’eau au plafond.',
    justification: transcript.split(' ').slice(0, 10).join(' '),
  };
}

function itemValido(sectionType, numPalabras) {
  const transcript = palabras(numPalabras);
  return { transcript, questions: [preguntaValida(transcript)] };
}

test('acepta un ítem correcto de annonce_publique', () => {
  const item = itemValido('annonce_publique', 45);
  assert.doesNotThrow(() => validateItem(item, 'annonce_publique'));
});

test('anota justificationScore en cada pregunta', () => {
  const item = itemValido('annonce_publique', 45);
  const validado = validateItem(item, 'annonce_publique');
  assert.equal(validado.questions[0].justificationScore, 1);
});

test('rechaza transcript vacío', () => {
  const item = itemValido('annonce_publique', 45);
  item.transcript = '   ';
  assert.throws(() => validateItem(item, 'annonce_publique'), /transcript/);
});

test('countWords ignora espacios múltiples', () => {
  assert.equal(countWords('  un   deux trois  '), 3);
});

function dialogoInterview(numPalabras) {
  const cuerpo = palabras(numPalabras).split(' ');
  const mitad = Math.floor(cuerpo.length / 2);
  return `Journaliste: ${cuerpo.slice(0, mitad).join(' ')} Invité(e): ${cuerpo.slice(mitad).join(' ')}`;
}

test('aplica tolerancia proporcional: interview admite ±15 sobre 200-300', () => {
  const transcript = dialogoInterview(311); // 313 palabras con las etiquetas: dentro de 185-315
  const dentro = { transcript, questions: [preguntaValida(transcript), preguntaValida(transcript)] };
  assert.doesNotThrow(() => validateItem(dentro, 'interview'));

  const largo = dialogoInterview(400);
  const fuera = { transcript: largo, questions: [preguntaValida(largo), preguntaValida(largo)] };
  assert.throws(() => validateItem(fuera, 'interview'), /fuera de rango/);
});

test('rechaza transcript fuera del rango tolerado', () => {
  const item = itemValido('annonce_publique', 100);
  assert.throws(() => validateItem(item, 'annonce_publique'), /fuera de rango/);
});

test('exige tantas preguntas como questionsPerAudio', () => {
  const item = itemValido('reportage', 180);
  assert.throws(() => validateItem(item, 'reportage'), /2 preguntas/);
});

test('rechaza si no hay exactamente 4 opciones', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].options.pop();
  assert.throws(() => validateItem(item, 'annonce_publique'), /4 elementos/);
});

test('rechaza correctId que no apunta a ninguna opción', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].correctId = 'Z';
  assert.throws(() => validateItem(item, 'annonce_publique'), /correctId/);
});

test('rechaza feedback vacío', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].feedback = '';
  assert.throws(() => validateItem(item, 'annonce_publique'), /feedback/);
});

test('rechaza justification que no está en el transcript', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].justification = 'ceci ne figure absolument nulle part dans le message';
  assert.throws(() => validateItem(item, 'annonce_publique'), /justification/);
});

test('micro_trottoir exige las posturas del preset en orden fijo', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const transcript = palabras(55);
  const item = {
    transcript,
    questions: [{
      ...preguntaValida(transcript),
      options: posturas.map((text, i) => ({ id: 'ABCD'[i], text })),
      correctId: 'B',
    }],
  };
  assert.doesNotThrow(() => validateItem(item, 'micro_trottoir', { posture: posturas[1] }));

  item.questions[0].options[0].text = 'plutôt favorable';
  assert.throws(() => validateItem(item, 'micro_trottoir', { posture: posturas[1] }), /posturas/);
});

test('micro_trottoir rechaza si la postura correcta no es la pedida', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const transcript = palabras(55);
  const item = {
    transcript,
    questions: [{
      ...preguntaValida(transcript),
      options: posturas.map((text, i) => ({ id: 'ABCD'[i], text })),
      correctId: 'A',
    }],
  };
  assert.throws(() => validateItem(item, 'micro_trottoir', { posture: posturas[2] }), /postura/);
});

test('interview exige diálogo con dos etiquetas alternadas', () => {
  const dialogado = dialogoInterview(240);
  const item = { transcript: dialogado, questions: [preguntaValida(dialogado), preguntaValida(dialogado)] };
  assert.doesNotThrow(() => validateItem(item, 'interview'));
});

test('interview rechaza un monólogo con una sola etiqueta', () => {
  const monologo = `Journaliste: ${palabras(250)}`;
  const item = { transcript: monologo, questions: [preguntaValida(monologo), preguntaValida(monologo)] };
  assert.throws(() => validateItem(item, 'interview'), /diálogo|alternancia/i);
});

test('minWords y maxWords se pueden sobreescribir (modo entrenamiento)', () => {
  const item = itemValido('divers', 35);
  assert.throws(() => validateItem(item, 'divers'), /fuera de rango/);
  assert.doesNotThrow(() => validateItem(item, 'divers', { minWords: 30, maxWords: 50 }));
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/validation.test.js`
Expected: FAIL — `Cannot find module '../src/validation/index.js'`

- [ ] **Step 3: Implementar `validation/index.js`**

Crear `backend/src/validation/index.js`:

```js
import {
  SECTION_PRESETS, MICRO_TROTTOIR_POSTURES, wordTolerance, CONFIG as DEFAULT_CONFIG,
} from '../examFormat.js';
import { checkJustification } from './justification.js';

export function countWords(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function validarPregunta(question, transcript, config) {
  if (!question || typeof question !== 'object') throw new Error('pregunta inválida');
  if (typeof question.prompt !== 'string' || !question.prompt.trim()) throw new Error('falta "prompt"');

  if (!Array.isArray(question.options) || question.options.length !== 4) {
    throw new Error('"options" debe ser un array de 4 elementos');
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
}

function validarMicroTrottoir(item, posture, config) {
  const esperadas = MICRO_TROTTOIR_POSTURES[config.microTrottoirOptions];
  const question = item.questions[0];
  const textos = question.options.map(option => option.text.trim());

  if (textos.length !== esperadas.length || textos.some((texto, i) => texto !== esperadas[i])) {
    throw new Error(`micro_trottoir: las opciones deben ser exactamente las posturas del preset, en orden: ${esperadas.join(' | ')}`);
  }
  if (posture) {
    const correcta = question.options.find(option => option.id === question.correctId).text.trim();
    if (correcta !== posture) {
      throw new Error(`micro_trottoir: la postura correcta es "${correcta}" pero se pidió "${posture}"`);
    }
  }
}

function validarInterview(item) {
  const etiquetas = [...item.transcript.matchAll(/(^|\s)([A-ZÀ-Ý][\wÀ-ÿ'()’ -]{2,20}):/g)]
    .map(match => match[2].trim());
  const distintas = new Set(etiquetas);
  if (distintas.size < 2) {
    throw new Error('interview: el transcript debe ser un diálogo con al menos dos hablantes etiquetados');
  }
  const alterna = etiquetas.some((etiqueta, i) => i > 0 && etiqueta !== etiquetas[i - 1]);
  if (!alterna) throw new Error('interview: el transcript no muestra alternancia entre hablantes');
}

export function validateItem(item, sectionType, opts = {}) {
  const config = opts.config ?? DEFAULT_CONFIG;
  const preset = SECTION_PRESETS[sectionType];
  if (!preset) throw new Error(`Tipo de sección desconocido: ${sectionType}`);

  if (!item || typeof item !== 'object') throw new Error('la respuesta no es un objeto JSON');
  if (typeof item.transcript !== 'string' || !item.transcript.trim()) throw new Error('falta "transcript"');

  const minWords = opts.minWords ?? preset.minWords;
  const maxWords = opts.maxWords ?? preset.maxWords;
  const tolerancia = wordTolerance(maxWords);
  const total = countWords(item.transcript.trim());
  if (total < minWords - tolerancia || total > maxWords + tolerancia) {
    throw new Error(`"transcript" fuera de rango: ${total} palabras (esperadas ${minWords}-${maxWords}, tolerancia ±${tolerancia})`);
  }

  if (!Array.isArray(item.questions) || item.questions.length !== preset.questionsPerAudio) {
    throw new Error(`"${sectionType}" requiere ${preset.questionsPerAudio} preguntas, llegaron ${item.questions?.length ?? 0}`);
  }
  for (const question of item.questions) validarPregunta(question, item.transcript, config);

  if (sectionType === 'micro_trottoir') validarMicroTrottoir(item, opts.posture, config);
  if (sectionType === 'interview') validarInterview(item);

  return item;
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/validation.test.js`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/validation/index.js backend/test/validation.test.js
git commit -m "feat(examen): validación de ítems por tipo de sección"
```

---

### Task 8: Constructores de prompt por sección

**Files:**
- Create: `backend/src/prompt/profiles.js`
- Create: `backend/src/prompt/common.js`
- Create: `backend/src/prompt/sections/annonce_publique.js`
- Create: `backend/src/prompt/sections/repondeur.js`
- Create: `backend/src/prompt/sections/micro_trottoir.js`
- Create: `backend/src/prompt/sections/chronique.js`
- Create: `backend/src/prompt/sections/interview.js`
- Create: `backend/src/prompt/sections/reportage.js`
- Create: `backend/src/prompt/sections/divers.js`
- Create: `backend/src/prompt/index.js`
- Create: `backend/test/prompt.test.js`

**Interfaces:**
- Consumes: `SECTION_PRESETS`, `MICRO_TROTTOIR_POSTURES`, `CONFIG` de `examFormat.js`; `pickTefaqPattern` de `tefaqPatterns.js`.
- Produces:
  - `DIFFICULTY_PROFILES`, `VALID_DIFFICULTIES` (profiles.js) — copiados literalmente desde `src/prompt.js`
  - `buildSectionPrompt(sectionType, {topic, difficulty, posture, pattern, minWords, maxWords, verticalScan}) -> string` (index.js)

`verticalScan`, `minWords` y `maxWords` son overrides que **solo usa el modo entrenamiento**; sin ellos el escaneo vertical del entrenamiento se pierde.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/prompt.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSectionPrompt } from '../src/prompt/index.js';
import { VALID_DIFFICULTIES, DIFFICULTY_PROFILES } from '../src/prompt/profiles.js';
import { SECTION_PRESETS, MICRO_TROTTOIR_POSTURES, CONFIG, GENERABLE_SECTIONS } from '../src/examFormat.js';

const BASE = { topic: 'una consulta pública sobre un proyecto de vivienda', difficulty: 'B2' };

test('los perfiles de dificultad sobreviven al refactor', () => {
  assert.deepEqual(VALID_DIFFICULTIES, ['B1', 'B2', 'C1']);
  assert.ok(DIFFICULTY_PROFILES.C1.synonymDistractors.length > 0);
});

test('hay constructor para las 7 secciones generables', () => {
  for (const sectionType of GENERABLE_SECTIONS) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.ok(prompt.length > 200, `${sectionType}: prompt sospechosamente corto`);
  }
});

test('conversation_image no tiene constructor todavía', () => {
  assert.throws(() => buildSectionPrompt('conversation_image', BASE), /conversation_image/);
});

test('el prompt lleva el tema y el rango de palabras del preset', () => {
  const prompt = buildSectionPrompt('chronique', BASE);
  assert.ok(prompt.includes(BASE.topic));
  assert.ok(prompt.includes(String(SECTION_PRESETS.chronique.minWords)));
  assert.ok(prompt.includes(String(SECTION_PRESETS.chronique.maxWords)));
});

test('todos los constructores exigen justification y el esquema questions', () => {
  for (const sectionType of GENERABLE_SECTIONS) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.ok(prompt.includes('justification'), `${sectionType} no pide justification`);
    assert.ok(prompt.includes('"questions"'), `${sectionType} no define el esquema questions`);
  }
});

test('interview y reportage piden 2 preguntas; el resto 1', () => {
  for (const sectionType of GENERABLE_SECTIONS) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    const esperadas = SECTION_PRESETS[sectionType].questionsPerAudio;
    assert.ok(prompt.includes(`${esperadas} pregunta`), `${sectionType} debería pedir ${esperadas} pregunta(s)`);
  }
});

test('interview pide diálogo etiquetado', () => {
  const prompt = buildSectionPrompt('interview', BASE);
  assert.ok(prompt.includes('Journaliste:'));
  assert.ok(prompt.includes('Invité'));
});

test('micro_trottoir inyecta la postura pedida y las opciones fijas', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const prompt = buildSectionPrompt('micro_trottoir', { ...BASE, posture: posturas[2] });
  assert.ok(prompt.includes(posturas[2]));
  for (const postura of posturas) assert.ok(prompt.includes(postura));
});

test('los bloques 3 y 4 exigen matices de B2 real', () => {
  for (const sectionType of ['chronique', 'interview', 'reportage', 'divers']) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.match(prompt, /implícit|matiz|causa/i, `${sectionType} no exige nivel B2 real`);
  }
});

test('minWords y maxWords se pueden sobreescribir (modo entrenamiento)', () => {
  const prompt = buildSectionPrompt('divers', { ...BASE, minWords: 30, maxWords: 50 });
  assert.ok(prompt.includes('30'));
  assert.ok(prompt.includes('50'));
  assert.ok(!prompt.includes('entre 60 y 120'));
});

test('verticalScan cambia la regla de escaneo vertical', () => {
  const con = buildSectionPrompt('divers', { ...BASE, verticalScan: true });
  const sin = buildSectionPrompt('divers', { ...BASE, verticalScan: false });
  assert.ok(con.includes('escaneo vertical'));
  assert.ok(!sin.includes('escaneo vertical'));
});

test('la dificultad cambia el perfil inyectado', () => {
  const b1 = buildSectionPrompt('divers', { ...BASE, difficulty: 'B1' });
  const c1 = buildSectionPrompt('divers', { ...BASE, difficulty: 'C1' });
  assert.ok(b1.includes(DIFFICULTY_PROFILES.B1.vocabulary));
  assert.ok(c1.includes(DIFFICULTY_PROFILES.C1.vocabulary));
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/prompt.test.js`
Expected: FAIL — `Cannot find module '../src/prompt/index.js'`

- [ ] **Step 3: Mover los perfiles**

Crear `backend/src/prompt/profiles.js` copiando **literalmente** `DIFFICULTY_PROFILES` y `VALID_DIFFICULTIES` desde `backend/src/prompt.js` (líneas 62-92). No modificar los textos.

- [ ] **Step 4: Implementar los fragmentos comunes**

Crear `backend/src/prompt/common.js`:

```js
import { DIFFICULTY_PROFILES } from './profiles.js';

export function bloquePerfil(difficulty) {
  const profile = DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES.B2;
  return `Perfil de dificultad ${profile.label}:
- Vocabulario: ${profile.vocabulary}.
- Complejidad del audio: ${profile.audioComplexity}.
- Sutileza de distractores: ${profile.distractors}.
- Distractores por sinónimos/paráfrasis: ${profile.synonymDistractors}.
- Similitud entre opciones: ${profile.optionSimilarity}.
- Feedback esperado: ${profile.feedback}.`;
}

export function bloquePatron(pattern) {
  return `Patrón TEFAQ de esta pregunta:
- Tipo de pregunta: ${pattern?.questionType ?? 'identificar el propósito principal del mensaje'}.
- Estructura del audio: ${pattern?.announcementStructure ?? 'mensaje breve de la vida cotidiana con contexto, motivo y acción esperada'}.
- Patrón principal de distractor: ${pattern?.distractorPattern ?? 'un distractor parcialmente verdadero, pero con un detalle clave incorrecto'}.
- Expresiones/vocabulario quebequense sugerido (usa solo si encaja naturalmente): ${(pattern?.quebecExpressions ?? []).join(', ') || 'dépanneur, courriel, fin de semaine'}.`;
}

export function reglasComunes({ minWords, maxWords, questionsPerAudio, verticalScan }) {
  return `Reglas:
1. Las 4 opciones de cada pregunta deben ser plausibles.
2. El transcript debe usar parafraseo y NUNCA las mismas palabras exactas de la respuesta correcta.
3. El transcript debe tener entre ${minWords} y ${maxWords} palabras.
4. Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown ni comillas triples.
5. Genera exactamente ${questionsPerAudio} pregunta(s) sobre este mismo audio.
6. La respuesta correcta no debe quedar sesgada siempre en la misma letra.
7. El feedback NO debe mencionar letras de opciones (A, B, C, D). Explica el contenido correcto, el parafraseo usado y por qué los distractores no encajan.
8. Los distractores deben seguir este esquema: uno parcialmente verdadero con detalle incorrecto, uno plausible pero no mencionado, uno que confunda causa/consecuencia o recomendación/obligación, y uno con detalle cambiado (hora/lugar/monto/condición) cuando sea posible.
9. Al menos un distractor debe ser una trampa de sinónimos/paráfrasis: reutiliza una idea del audio con palabras equivalentes, pero cambia el sentido final con un matiz o dato incorrecto.
10. La respuesta correcta también debe estar parafraseada: no copies frases literales del transcript.
11. Las 4 opciones deben parecer de la misma familia: longitud parecida, mismo registro, misma categoría y estructura gramatical comparable.
12. La diferencia entre opciones debe estar en un detalle decisivo, no en que una sea mucho más específica o larga.
13. En el feedback, menciona brevemente el par de sinónimos/paráfrasis que conecta el audio con la respuesta correcta.
14. El campo "justification" de cada pregunta debe ser una CITA TEXTUAL del transcript (mínimo 8 palabras, copiada literalmente) que sostenga la respuesta correcta.
${verticalScan
  ? '15. Como entrenamiento de escaneo vertical, las 4 opciones deben compartir un inicio sintáctico natural de al menos 3 palabras y diferenciarse principalmente en la parte final. No fuerces frases artificiales; deben sonar naturales en francés.'
  : '15. Las opciones pueden tener estructuras variadas y naturales; no necesitas forzar un prefijo común, pero deben mantener longitud, tono y categoría semántica similares.'}`;
}

export function esquemaJson(questionsPerAudio) {
  const pregunta = `{
      "prompt": "Pregunta en francés",
      "options": [{ "id": "A", "text": "..." }, { "id": "B", "text": "..." }, { "id": "C", "text": "..." }, { "id": "D", "text": "..." }],
      "correctId": "A",
      "feedback": "Explicación breve en español.",
      "justification": "cita textual del transcript"
    }`;
  return `Estructura JSON requerida:
{
  "transcript": "El texto simulado del audio en francés...",
  "questions": [${Array.from({ length: questionsPerAudio }, () => pregunta).join(',\n    ')}]
}`;
}

export function exigenciaB2() {
  return 'El audio debe exigir comprensión B2 real: opiniones matizadas, implícitos, relación causa/consecuencia y cambios de postura, no solo datos explícitos.';
}
```

- [ ] **Step 5: Implementar los siete constructores**

Cada archivo en `backend/src/prompt/sections/` exporta `build(ctx)` donde `ctx = {topic, difficulty, posture, pattern, minWords, maxWords, questionsPerAudio, verticalScan}`.

`annonce_publique.js`:

```js
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UNA annonce publique de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un anuncio difundido en un espacio público de Quebec (estación, comercio, institución, edificio): voz institucional, tono neutro, información práctica y una consecuencia o acción esperada para quien escucha.
Usa vocabulario y expresiones típicas quebequenses acordes al tema.

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
```

`repondeur.js` — idéntico salvo el párrafo de escenario:

```js
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN mensaje de contestador (répondeur) de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un mensaje dejado en el buzón de voz de la persona que escucha: quien llama se identifica, explica el motivo y pide una acción concreta o anuncia un cambio.
Usa vocabulario y expresiones típicas quebequenses acordes al tema.

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
```

`micro_trottoir.js`:

```js
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';
import { MICRO_TROTTOIR_POSTURES, CONFIG } from '../../examFormat.js';

export function build(ctx) {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN micro-trottoir de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Una persona entrevistada en la calle da su opinión sobre el tema. Su postura debe ser EXACTAMENTE: "${ctx.posture}", expresada de forma matizada y natural, sin anunciarla literalmente.

Las 4 opciones NO las eliges tú: son siempre estas posturas, en este orden exacto:
${posturas.map((postura, i) => `${'ABCD'[i]}) ${postura}`).join('\n')}
El campo "correctId" debe ser la letra de la postura "${ctx.posture}".

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
```

`chronique.js`:

```js
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UNA chronique radiofónica de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es una columna de opinión de un cronista de radio quebequense: presenta un tema de actualidad, toma posición con matices y anticipa una objeción.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
```

`interview.js`:

```js
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UNA entrevista radiofónica de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
El transcript debe ser un DIÁLOGO etiquetado, alternando turnos varias veces, con este formato exacto de etiquetas:
Journaliste: … / Invité(e): …
La persona invitada debe matizar, condicionar o rectificar al menos una vez.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}
16. Las ${ctx.questionsPerAudio} preguntas deben cubrir aspectos DISTINTOS de la entrevista; no pueden responderse con la misma frase.

${esquemaJson(ctx.questionsPerAudio)}`;
}
```

`reportage.js`:

```js
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN reportaje radiofónico de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un reportaje narrado por una sola voz periodística: contexto, hechos, una cifra o dato concreto, y la consecuencia o el siguiente paso.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}
16. Las ${ctx.questionsPerAudio} preguntas deben cubrir aspectos DISTINTOS del reportaje; no pueden responderse con la misma frase.

${esquemaJson(ctx.questionsPerAudio)}`;
}
```

`divers.js`:

```js
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN documento sonoro breve de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Puede ser una conversación, un aviso, un mensaje o una cápsula informativa de la vida cotidiana en Quebec.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
```

- [ ] **Step 6: Implementar el despacho**

Crear `backend/src/prompt/index.js`:

```js
import { SECTION_PRESETS } from '../examFormat.js';
import { pickTefaqPattern } from '../tefaqPatterns.js';
import { build as annonce_publique } from './sections/annonce_publique.js';
import { build as repondeur } from './sections/repondeur.js';
import { build as micro_trottoir } from './sections/micro_trottoir.js';
import { build as chronique } from './sections/chronique.js';
import { build as interview } from './sections/interview.js';
import { build as reportage } from './sections/reportage.js';
import { build as divers } from './sections/divers.js';

const CONSTRUCTORES = {
  annonce_publique, repondeur, micro_trottoir, chronique, interview, reportage, divers,
};

export function buildSectionPrompt(sectionType, opts = {}) {
  const build = CONSTRUCTORES[sectionType];
  if (!build) {
    throw new Error(`No hay constructor de prompt para "${sectionType}" (conversation_image llega en el slice 4)`);
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
  });
}
```

- [ ] **Step 7: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/prompt.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 8: Commit**

```bash
git add backend/src/prompt backend/test/prompt.test.js
git commit -m "feat(examen): constructores de prompt por tipo de sección"
```

---

### Task 9: Generador de ítems con política de reintentos

**Files:**
- Create: `backend/src/itemGenerator.js`
- Create: `backend/test/itemGenerator.test.js`

**Interfaces:**
- Consumes: `buildSectionPrompt` de `prompt/index.js`; `validateItem` de `validation/index.js`; `AUTO_CHAIN` de `providers/index.js`; `CONFIG` de `examFormat.js`.
- Produces:
  - `createItemGenerator(providers, config?) -> {generateItem(opts) -> Promise<item>}`
  - `opts: {sectionType, topic, difficulty, posture, minWords?, maxWords?, verticalScan?, selector?}`
  - Devuelve `{transcript, questions, provider, tentativas}`. Lanza `Error` con `.providersTried: Array<{provider, error}>` si se agota la cadena.
  - `esFalloDeCuotaORed(error) -> boolean` (exportada para tests)

Un fallo de validación reintenta el **mismo** proveedor hasta `config.validationRetries` veces; un 429/5xx/timeout avanza en la cadena de inmediato.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/itemGenerator.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createItemGenerator, esFalloDeCuotaORed } from '../src/itemGenerator.js';
import { CONFIG } from '../src/examFormat.js';

function itemJson({ palabras = 45, correctId = 'B' } = {}) {
  const transcript = Array.from({ length: palabras }, (_, i) => `mot${i}`).join(' ');
  return JSON.stringify({
    transcript,
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible' },
      ],
      correctId,
      feedback: 'El anuncio lo dice de forma parafraseada.',
      justification: transcript.split(' ').slice(0, 10).join(' '),
    }],
  });
}

function proveedorFake(name, respuestas) {
  const llamadas = [];
  return {
    name,
    llamadas,
    async generate(prompt) {
      llamadas.push(prompt);
      const siguiente = respuestas.shift();
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    },
  };
}

function errorHttp(status) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
}

const BASE = { sectionType: 'annonce_publique', topic: 'un aviso municipal', difficulty: 'B2' };

test('devuelve el ítem validado con el proveedor y el número de intentos', async () => {
  const gemini = proveedorFake('gemini', [itemJson()]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.equal(item.provider, 'gemini');
  assert.equal(item.tentativas, 1);
  assert.equal(item.questions.length, 1);
});

test('limpia las vallas de markdown alrededor del JSON', async () => {
  const gemini = proveedorFake('gemini', ['```json\n' + itemJson() + '\n```']);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.ok(item.transcript.length > 0);
});

test('un fallo de validación reintenta el MISMO proveedor', async () => {
  const gemini = proveedorFake('gemini', [itemJson({ palabras: 500 }), itemJson()]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'gemini', 'no debe bajar de modelo por ruido de muestreo');
  assert.equal(item.tentativas, 2);
  assert.equal(deepseek.llamadas.length, 0);
});

test('agotados los reintentos de validación, avanza en la cadena', async () => {
  const malo = itemJson({ palabras: 500 });
  const gemini = proveedorFake('gemini', [malo, malo, malo]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, CONFIG.validationRetries + 1);
  assert.equal(item.provider, 'deepseek');
});

test('un 429 avanza de proveedor sin reintentar', async () => {
  const gemini = proveedorFake('gemini', [errorHttp(429)]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, 1, 'reintentar el mismo modelo tras un 429 no sirve de nada');
  assert.equal(item.provider, 'deepseek');
});

test('un timeout también avanza sin reintentar', async () => {
  const gemini = proveedorFake('gemini', [new Error('gemini: timeout tras 120s')]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, 1);
  assert.equal(item.provider, 'deepseek');
});

test('esFalloDeCuotaORed distingue los dos tipos de fallo', () => {
  assert.equal(esFalloDeCuotaORed(errorHttp(429)), true);
  assert.equal(esFalloDeCuotaORed(errorHttp(503)), true);
  assert.equal(esFalloDeCuotaORed(new Error('timeout tras 120s')), true);
  assert.equal(esFalloDeCuotaORed(new Error('fetch failed')), true);
  assert.equal(esFalloDeCuotaORed(new Error('"transcript" fuera de rango: 500 palabras')), false);
  assert.equal(esFalloDeCuotaORed(errorHttp(400)), false);
});

test('si toda la cadena falla, lanza con el detalle de lo intentado', async () => {
  const malo = itemJson({ palabras: 500 });
  const gemini = proveedorFake('gemini', [malo, malo, malo]);
  const deepseek = proveedorFake('deepseek', [errorHttp(429)]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  await assert.rejects(
    () => generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] }),
    (error) => {
      assert.equal(error.providersTried.length, 2);
      assert.match(error.providersTried[0].error, /fuera de rango/);
      return true;
    },
  );
});

test('omite los proveedores no configurados', async () => {
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ deepseek }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'deepseek');
});

test('lanza si ningún proveedor de la cadena está configurado', async () => {
  const generador = createItemGenerator({}, CONFIG);
  await assert.rejects(
    () => generador.generateItem({ ...BASE, selector: ['gemini'] }),
    /configurado/,
  );
});

test('baraja las opciones y renumera correctId salvo en micro_trottoir', async () => {
  const gemini = proveedorFake('gemini', [itemJson()]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.deepEqual(item.questions[0].options.map(o => o.id), ['A', 'B', 'C', 'D']);
  assert.ok(['A', 'B', 'C', 'D'].includes(item.questions[0].correctId));
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/itemGenerator.test.js`
Expected: FAIL — `Cannot find module '../src/itemGenerator.js'`

- [ ] **Step 3: Implementar `itemGenerator.js`**

Crear `backend/src/itemGenerator.js`:

```js
import { buildSectionPrompt } from './prompt/index.js';
import { validateItem } from './validation/index.js';
import { AUTO_CHAIN } from './providers/index.js';
import { CONFIG as DEFAULT_CONFIG } from './examFormat.js';

function limpiarMarkdown(text) {
  let limpio = text.trim();
  if (limpio.startsWith('```')) limpio = limpio.replace(/```(?:json)?/g, '').trim();
  return limpio;
}

function barajar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Reordena las opciones y renumera A-D para que la correcta no se sesgue a una letra.
function aleatorizarOpciones(question) {
  const correctaOriginal = question.options.find(option => option.id === question.correctId);
  const barajadas = barajar(question.options).map((option, indice) => ({
    ...option,
    id: ['A', 'B', 'C', 'D'][indice],
  }));
  const nuevaCorrecta = barajadas.find(option => option.text === correctaOriginal.text);
  if (!nuevaCorrecta) throw new Error('No se pudo remapear la opción correcta tras mezclar');
  return { ...question, options: barajadas, correctId: nuevaCorrecta.id };
}

// Un 429 o un timeout no mejora reintentando el mismo modelo; un fallo de
// validación con temperature 1 casi siempre sí.
export function esFalloDeCuotaORed(error) {
  if (typeof error.status === 'number') return error.status === 429 || error.status >= 500;
  return /timeout|fetch failed|ECONNRESET|ENOTFOUND|network|socket/i.test(error.message);
}

export function createItemGenerator(providers, config = DEFAULT_CONFIG) {
  return {
    async generateItem(opts) {
      const { sectionType, topic, difficulty, posture } = opts;
      const cadena = opts.selector ?? AUTO_CHAIN;
      const disponibles = cadena.filter(key => providers[key]);

      if (disponibles.length === 0) {
        const error = new Error(`Ningún provider de la cadena [${cadena.join(' → ')}] está configurado`);
        error.providersTried = [];
        throw error;
      }

      const prompt = buildSectionPrompt(sectionType, {
        topic, difficulty, posture,
        minWords: opts.minWords, maxWords: opts.maxWords, verticalScan: opts.verticalScan,
      });

      const errores = [];
      let tentativas = 0;

      for (const key of disponibles) {
        const provider = providers[key];
        const maxIntentos = config.validationRetries + 1;

        for (let intento = 0; intento < maxIntentos; intento += 1) {
          tentativas += 1;
          try {
            const texto = await provider.generate(prompt);
            const bruto = JSON.parse(limpiarMarkdown(texto));
            const validado = validateItem(bruto, sectionType, {
              config, posture, minWords: opts.minWords, maxWords: opts.maxWords,
            });

            // Las opciones de micro_trottoir son fijas: barajarlas rompería el contrato.
            const questions = sectionType === 'micro_trottoir'
              ? validado.questions
              : validado.questions.map(aleatorizarOpciones);

            return { transcript: validado.transcript, questions, provider: provider.name, tentativas };
          } catch (error) {
            console.error(`[generador] ${provider.name} falló: ${error.message}`);
            errores.push({ provider: provider.name, error: error.message });
            if (esFalloDeCuotaORed(error)) break; // no insistir con este proveedor
          }
        }
      }

      const error = new Error('Todos los providers de la cadena fallaron');
      error.providersTried = errores;
      throw error;
    },
  };
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/itemGenerator.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/itemGenerator.js backend/test/itemGenerator.test.js
git commit -m "feat(examen): generador de ítems con reintentos por tipo de fallo"
```

---

### Task 10: Persistencia de sets

**Files:**
- Create: `backend/src/sets/store.js`
- Create: `backend/test/store.test.js`

**Interfaces:**
- Consumes: nada del proyecto.
- Produces:
  - `setDir(dataDir, setId) -> string`
  - `audioDir(dataDir, setId) -> string`
  - `writeSet(dataDir, set) -> Promise<void>` — atómica
  - `readSet(dataDir, setId) -> Promise<set>` — lanza si no existe o está corrupto
  - `listSets(dataDir) -> Promise<Array<{id, statut, format, genere_le, total, prets, echoues}>>`
  - `deleteSet(dataDir, setId) -> Promise<void>`
  - `nuevoSetId(fecha?: Date) -> string`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSet, readSet, listSets, deleteSet, setDir, audioDir, nuevoSetId } from '../src/sets/store.js';

function setDePrueba(id = 'set-test-1') {
  return {
    id, genere_le: '2026-08-05T10:00:00Z', statut: 'partial',
    format: 'SET_STANDARD_36', formatVersion: 1, difficulty: 'B2',
    pilotes: false, seed: 1, plan: [], relaxations: [],
    ledger: { texte: { appels: 0, echecs: 0 }, tts: { appels: 0, echecs: 0 }, images: { appels: 0, echecs: 0 } },
    sections: [{
      type: 'annonce_publique', timing: { avant: 10, apres: 10 }, lectures: 1,
      items: [
        { ref: 's1i1', etat: 'pret' },
        { ref: 's1i2', etat: 'en_attente' },
        { ref: 's1i3', etat: 'echoue' },
      ],
    }],
  };
}

test('escribe y relee un set', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  const set = setDePrueba();
  await writeSet(dataDir, set);
  assert.deepEqual(await readSet(dataDir, set.id), set);
});

test('crea el directorio de audio del set', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba());
  const contenido = await readdir(setDir(dataDir, 'set-test-1'));
  assert.ok(contenido.includes('audio'));
  assert.ok(audioDir(dataDir, 'set-test-1').endsWith(join('set-test-1', 'audio')));
});

test('la escritura es atómica: no deja temporales al terminar', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba());
  const contenido = await readdir(setDir(dataDir, 'set-test-1'));
  assert.ok(!contenido.some(nombre => nombre.includes('.tmp')), `quedaron temporales: ${contenido}`);
});

test('sobrescribir no corrompe: el JSON releído sigue siendo válido', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  const set = setDePrueba();
  await writeSet(dataDir, set);
  set.statut = 'complet';
  await writeSet(dataDir, set);
  const raw = await readFile(join(setDir(dataDir, set.id), 'set.json'), 'utf8');
  assert.equal(JSON.parse(raw).statut, 'complet');
});

test('readSet lanza si el set no existe', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await assert.rejects(() => readSet(dataDir, 'no-existe'), /no-existe/);
});

test('listSets resume el progreso de cada set', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba('set-a'));
  await writeSet(dataDir, { ...setDePrueba('set-b'), genere_le: '2026-08-06T10:00:00Z' });

  const lista = await listSets(dataDir);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].id, 'set-b', 'el más reciente primero');
  const a = lista.find(s => s.id === 'set-a');
  assert.equal(a.total, 3);
  assert.equal(a.prets, 1);
  assert.equal(a.echoues, 1);
  assert.equal(a.statut, 'partial');
});

test('listSets devuelve vacío si no hay directorio', async () => {
  assert.deepEqual(await listSets(join(tmpdir(), 'jamas-existio-esto')), []);
});

test('deleteSet borra la carpeta entera', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba());
  await deleteSet(dataDir, 'set-test-1');
  assert.deepEqual(await listSets(dataDir), []);
});

test('nuevoSetId incluye la fecha y un sufijo aleatorio', () => {
  const id = nuevoSetId(new Date('2026-08-05T10:00:00Z'));
  assert.match(id, /^set-2026-08-05-[a-z0-9]{4}$/);
  assert.notEqual(nuevoSetId(new Date('2026-08-05T10:00:00Z')), id);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/store.test.js`
Expected: FAIL — `Cannot find module '../src/sets/store.js'`

- [ ] **Step 3: Implementar `store.js`**

Crear `backend/src/sets/store.js`:

```js
import { mkdir, writeFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function setDir(dataDir, setId) {
  return join(dataDir, 'sets', setId);
}

export function audioDir(dataDir, setId) {
  return join(setDir(dataDir, setId), 'audio');
}

export function nuevoSetId(fecha = new Date()) {
  const dia = fecha.toISOString().slice(0, 10);
  const sufijo = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `set-${dia}-${sufijo}`;
}

// Escritura atómica: un crash a mitad de escritura no debe dejar un set.json
// truncado, porque eso no es perder un ítem sino el set entero.
export async function writeSet(dataDir, set) {
  const dir = setDir(dataDir, set.id);
  await mkdir(join(dir, 'audio'), { recursive: true });
  const destino = join(dir, 'set.json');
  const temporal = `${destino}.${process.pid}.tmp`;
  await writeFile(temporal, JSON.stringify(set, null, 2), 'utf8');
  await rename(temporal, destino);
}

export async function readSet(dataDir, setId) {
  try {
    return JSON.parse(await readFile(join(setDir(dataDir, setId), 'set.json'), 'utf8'));
  } catch (error) {
    const err = new Error(`No se pudo leer el set "${setId}": ${error.message}`);
    err.status = error.code === 'ENOENT' ? 404 : 422;
    throw err;
  }
}

function contarItems(set) {
  const items = (set.sections ?? []).flatMap(section => section.items ?? []);
  return {
    total: items.length,
    generes: items.filter(item => item.etat === 'genere').length,
    prets: items.filter(item => item.etat === 'pret').length,
    echoues: items.filter(item => item.etat === 'echoue').length,
  };
}

export async function listSets(dataDir) {
  let entries;
  try {
    entries = await readdir(join(dataDir, 'sets'), { withFileTypes: true });
  } catch {
    return [];
  }

  const resumenes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const set = await readSet(dataDir, entry.name);
      resumenes.push({
        id: set.id, statut: set.statut, format: set.format,
        genere_le: set.genere_le, difficulty: set.difficulty, ...contarItems(set),
      });
    } catch {
      continue;
    }
  }

  return resumenes.sort((a, b) => String(b.genere_le).localeCompare(String(a.genere_le)));
}

export async function deleteSet(dataDir, setId) {
  await rm(setDir(dataDir, setId), { recursive: true, force: true });
}

export { contarItems };
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/store.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sets/store.js backend/test/store.test.js
git commit -m "feat(examen): persistencia de sets con escritura atómica"
```

---

### Task 11: Síntesis de audio a disco

**Files:**
- Create: `backend/src/audio/synth.js`
- Create: `backend/test/synth.test.js`
- Modify: `backend/server.js` (extraer y exportar `pcmToWav`)

**Interfaces:**
- Consumes: nada del proyecto.
- Produces:
  - `pcmToWav(pcmBuffer, sampleRate?, channels?, bitsPerSample?) -> Buffer` (movido desde `server.js`)
  - `wavDurationSeconds(pcmByteLength, sampleRate?, channels?, bytesPerSample?) -> number`
  - `createSynth({apiKey, voices, fetchImpl?}) -> {synthToFile({text, outPath}) -> Promise<{duree_audio_s, voice}>}`

`ffmpeg` no está instalado y no hace falta: construimos el WAV nosotros con parámetros conocidos, así que la duración es aritmética exacta sobre el buffer PCM.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/synth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pcmToWav, wavDurationSeconds, createSynth } from '../src/audio/synth.js';

test('wavDurationSeconds calcula la duración desde el tamaño del PCM', () => {
  assert.equal(wavDurationSeconds(48000), 1);      // 24 kHz mono 16 bits = 48000 B/s
  assert.equal(wavDurationSeconds(24000), 0.5);
  assert.equal(wavDurationSeconds(0), 0);
});

test('pcmToWav antepone una cabecera RIFF de 44 bytes', () => {
  const pcm = Buffer.alloc(100, 1);
  const wav = pcmToWav(pcm);
  assert.equal(wav.length, 144);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000, 'sample rate');
  assert.equal(wav.readUInt32LE(40), 100, 'tamaño de datos');
});

test('escribe el WAV a disco y devuelve la duración medida', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));
  const outPath = join(dir, 's1i1.wav');
  const pcm = Buffer.alloc(96000, 7); // 2 segundos

  const fetchFake = async () => ({
    ok: true,
    json: async () => ({ steps: [{ content: [{ type: 'audio', data: pcm.toString('base64') }] }] }),
  });

  const synth = createSynth({ apiKey: 'fake', voices: ['Kore'], fetchImpl: fetchFake });
  const { duree_audio_s, voice } = await synth.synthToFile({ text: 'bonjour tout le monde', outPath });

  assert.equal(duree_audio_s, 2);
  assert.equal(voice, 'Kore');
  const escrito = await readFile(outPath);
  assert.equal(escrito.length, 96000 + 44);
});

test('elige la voz de forma estable a partir del texto', async () => {
  const pcm = Buffer.alloc(4800, 1);
  const fetchFake = async () => ({
    ok: true,
    json: async () => ({ steps: [{ content: [{ type: 'audio', data: pcm.toString('base64') }] }] }),
  });
  const synth = createSynth({ apiKey: 'fake', voices: ['Kore', 'Charon', 'Puck'], fetchImpl: fetchFake });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));

  const a = await synth.synthToFile({ text: 'même texte', outPath: join(dir, 'a.wav') });
  const b = await synth.synthToFile({ text: 'même texte', outPath: join(dir, 'b.wav') });
  assert.equal(a.voice, b.voice, 'el mismo texto debe dar siempre la misma voz');
});

test('propaga el status HTTP para que el generador sepa si es cuota', async () => {
  const fetchFake = async () => ({ ok: false, status: 429, text: async () => 'quota exceeded' });
  const synth = createSynth({ apiKey: 'fake', voices: ['Kore'], fetchImpl: fetchFake });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));

  await assert.rejects(
    () => synth.synthToFile({ text: 'bonjour', outPath: join(dir, 'x.wav') }),
    (error) => {
      assert.equal(error.status, 429);
      return true;
    },
  );
});

test('lanza si la respuesta no trae audio', async () => {
  const fetchFake = async () => ({ ok: true, json: async () => ({ steps: [{ content: [] }] }) });
  const synth = createSynth({ apiKey: 'fake', voices: ['Kore'], fetchImpl: fetchFake });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));
  await assert.rejects(() => synth.synthToFile({ text: 'bonjour', outPath: join(dir, 'x.wav') }), /audio/);
});

test('lanza si no hay API key configurada', async () => {
  const synth = createSynth({ apiKey: '', voices: ['Kore'] });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));
  await assert.rejects(
    () => synth.synthToFile({ text: 'bonjour', outPath: join(dir, 'x.wav') }),
    (error) => {
      assert.equal(error.status, 503);
      return true;
    },
  );
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/synth.test.js`
Expected: FAIL — `Cannot find module '../src/audio/synth.js'`

- [ ] **Step 3: Implementar `synth.js`**

Crear `backend/src/audio/synth.js`. `pcmToWav` y `getStableIndex` se **mueven** desde `server.js` (líneas 110-144) sin cambios de comportamiento:

```js
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

// El WAV lo construimos nosotros con parámetros conocidos, así que la duración
// es aritmética exacta. No hace falta ffmpeg ni leer el archivo de vuelta.
export function wavDurationSeconds(pcmByteLength, sampleRate = 24000, channels = 1, bytesPerSample = 2) {
  return pcmByteLength / (sampleRate * channels * bytesPerSample);
}

export function getStableIndex(text, max) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % max;
}

export function createSynth({ apiKey, voices, fetchImpl = fetch }) {
  const disponibles = voices?.length ? voices : ['Kore'];

  return {
    async synthToFile({ text, outPath }) {
      if (!apiKey) {
        const error = new Error('No hay API key configurada para Gemini TTS');
        error.status = 503;
        throw error;
      }

      const voice = disponibles[getStableIndex(text, disponibles.length)];
      const response = await fetchImpl(TTS_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TTS_MODEL,
          input: text,
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice }] },
        }),
      });

      if (!response.ok) {
        const cuerpo = await response.text().catch(() => '');
        const error = new Error(`${TTS_MODEL}: HTTP ${response.status} ${cuerpo.slice(0, 200)}`.trim());
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const base64 = data?.steps?.[0]?.content
        ?.find(content => content?.type === 'audio' || content?.mime_type?.startsWith('audio/'))?.data;
      if (!base64) throw new Error(`${TTS_MODEL}: respuesta sin datos de audio`);

      const pcm = Buffer.from(base64, 'base64');
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, pcmToWav(pcm));

      return { duree_audio_s: wavDurationSeconds(pcm.length), voice };
    },
  };
}
```

- [ ] **Step 4: Reapuntar `server.js` a la versión movida**

En `backend/server.js`: borrar las definiciones locales de `pcmToWav` (líneas 110-132) y `getStableIndex` (líneas 134-140), y añadir arriba:

```js
import { pcmToWav, getStableIndex } from './src/audio/synth.js';
```

El resto de `/api/tts` no cambia.

- [ ] **Step 5: Ejecutar los tests para verificar que pasan**

Run: `cd backend && npm test`
Expected: PASS — 7 tests nuevos y todo lo anterior en verde.

- [ ] **Step 6: Verificar a mano que el modo entrenamiento sigue sonando**

```bash
cd backend && npm start
```
En otra terminal:
```bash
curl -s -X POST http://localhost:3001/api/tts -H 'Content-Type: application/json' \
  -d '{"text":"Bonjour, ceci est un test audio."}' -o /tmp/test.wav && file /tmp/test.wav
```
Expected: `RIFF (little-endian) data, WAVE audio`. Parar el servidor.

- [ ] **Step 7: Commit**

```bash
git add backend/src/audio/synth.js backend/test/synth.test.js backend/server.js
git commit -m "feat(examen): síntesis TTS a disco con duración exacta"
```

---

### Task 12: Pipeline de generación de sets

**Files:**
- Create: `backend/src/sets/pipeline.js`
- Create: `backend/test/pipeline.test.js`

**Interfaces:**
- Consumes: `SET_COMPOSITIONS`, `SECTION_PRESETS`, `CONFIG` de `examFormat.js`; `planTopics` de `topics/planner.js`; `TOPICS`, `topicById` de `topics/catalog.js`; `readRecentPlans` de `topics/history.js`; `writeSet`, `readSet`, `audioDir`, `nuevoSetId` de `sets/store.js`.
- Produces:
  - `createPipeline({dataDir, generator, synth, catalog?, config?}) -> {createSet, run, isRunning, statusOf}`
  - `createSet({difficulty, format, pilotes, seed}) -> Promise<set>` — escribe el esqueleto completo y no genera nada
  - `run(setId, {maxItems}) -> Promise<set>` — trabaja los ítems pendientes
  - `isRunning(setId) -> boolean`
  - `statusOf(set) -> {total, generes, prets, echoues, statut}`

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/test/pipeline.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPipeline } from '../src/sets/pipeline.js';
import { readSet } from '../src/sets/store.js';

function catalogoAmplio() {
  const temas = [];
  const porSeccion = {
    annonce_publique: 30, repondeur: 30, micro_trottoir: 30,
    chronique: 30, interview: 30, reportage: 30, divers: 60,
  };
  let n = 1;
  for (const [seccion, cantidad] of Object.entries(porSeccion)) {
    for (let i = 0; i < cantidad; i += 1) {
      temas.push({ id: `t-${String(n).padStart(4, '0')}`, text: `tema ${n}`, sections: [seccion] });
      n += 1;
    }
  }
  return temas;
}

function generadorFake({ fallarEn = new Set(), contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async generateItem({ sectionType, topicId }) {
      contador.llamadas += 1;
      if (fallarEn.has(topicId)) {
        const error = new Error('fallo simulado de generación');
        error.providersTried = [{ provider: 'fake', error: 'fallo simulado' }];
        throw error;
      }
      return {
        transcript: `transcript de ${sectionType} sobre ${topicId}`,
        questions: [{
          prompt: 'p', options: [
            { id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' },
          ],
          correctId: 'A', feedback: 'f', justification: 'j', justificationScore: 1,
        }],
        provider: 'fake-provider', tentativas: 1,
      };
    },
  };
}

function synthFake({ fallarSiempre = false, contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async synthToFile({ outPath }) {
      contador.llamadas += 1;
      if (fallarSiempre) {
        const error = new Error('cuota TTS agotada');
        error.status = 429;
        throw error;
      }
      return { duree_audio_s: 42.5, voice: 'Kore', outPath };
    },
  };
}

async function nuevoPipeline(opts = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const generator = opts.generator ?? generadorFake();
  const synth = opts.synth ?? synthFake();
  const pipeline = createPipeline({ dataDir, generator, synth, catalog: catalogoAmplio() });
  return { dataDir, pipeline, generator, synth };
}

test('createSet escribe el esqueleto con los 32 ítems en espera y no genera nada', async () => {
  const { dataDir, pipeline, generator } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 1 });

  assert.equal(set.statut, 'partial');
  assert.equal(set.format, 'SET_STANDARD_36');
  assert.equal(set.plan.length, 32);
  assert.equal(generator.contador.llamadas, 0, 'createSet no debe generar contenido');

  const persistido = await readSet(dataDir, set.id);
  const items = persistido.sections.flatMap(s => s.items);
  assert.equal(items.length, 32);
  assert.ok(items.every(item => item.etat === 'en_attente'));
  assert.equal(persistido.sections[0].timing.avant, 10);
});

test('run completa el set y lo marca complet', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 2 });
  await pipeline.run(set.id);

  const final = await readSet(dataDir, set.id);
  assert.equal(final.statut, 'complet');
  const items = final.sections.flatMap(s => s.items);
  assert.ok(items.every(item => item.etat === 'pret'));
  assert.equal(items[0].duree_audio_s, 42.5);
  assert.match(items[0].audio, /^audio\/s1i1\.wav$/);
  assert.equal(items[0].provider, 'fake-provider');
  assert.deepEqual(items[0].images, []);
});

test('maxItems corta la tanda y el resto queda pendiente', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 3 });
  await pipeline.run(set.id, { maxItems: 5 });

  const parcial = await readSet(dataDir, set.id);
  const items = parcial.sections.flatMap(s => s.items);
  assert.equal(items.filter(i => i.etat === 'pret').length, 5);
  assert.equal(parcial.statut, 'partial');
});

test('reanudar no regenera lo ya listo', async () => {
  const { dataDir, pipeline, generator } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 4 });
  await pipeline.run(set.id, { maxItems: 10 });
  const llamadasTrasPrimera = generator.contador.llamadas;

  await pipeline.run(set.id);
  const final = await readSet(dataDir, set.id);
  assert.equal(final.statut, 'complet');
  assert.equal(generator.contador.llamadas, 32, 'cada ítem se genera exactamente una vez');
  assert.equal(llamadasTrasPrimera, 10);
});

test('el texto se persiste antes del audio: si el TTS falla no se pierde lo pagado', async () => {
  const { dataDir, pipeline } = await nuevoPipeline({ synth: synthFake({ fallarSiempre: true }) });
  const set = await pipeline.createSet({ seed: 5 });
  await pipeline.run(set.id, { maxItems: 3 });

  const parcial = await readSet(dataDir, set.id);
  const items = parcial.sections.flatMap(s => s.items);
  assert.equal(items[0].etat, 'genere', 'el texto validado debe sobrevivir al fallo de TTS');
  assert.ok(items[0].transcript.length > 0);
  assert.equal(parcial.statut, 'partial');
  assert.ok(parcial.ledger.tts.echecs > 0);
});

test('reanudar tras un fallo de TTS solo sintetiza, no regenera texto', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const generator = generadorFake();
  const roto = createPipeline({ dataDir, generator, synth: synthFake({ fallarSiempre: true }), catalog: catalogoAmplio() });
  const set = await roto.createSet({ seed: 6 });
  await roto.run(set.id, { maxItems: 2 });
  const llamadasTexto = generator.contador.llamadas;

  const sano = createPipeline({ dataDir, generator, synth: synthFake(), catalog: catalogoAmplio() });
  await sano.run(set.id, { maxItems: 2 });

  const final = await readSet(dataDir, set.id);
  const items = final.sections.flatMap(s => s.items);
  assert.equal(items[0].etat, 'pret');
  assert.equal(generator.contador.llamadas, llamadasTexto, 'no debe regenerar texto ya validado');
});

test('un ítem imposible se marca echoue y el bucle sigue', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const catalog = catalogoAmplio();
  const pipeline = createPipeline({ dataDir, generator: generadorFake(), synth: synthFake(), catalog });
  const set = await pipeline.createSet({ seed: 7 });

  const objetivo = set.plan[0].topicId;
  const conFallo = createPipeline({
    dataDir, catalog, synth: synthFake(),
    generator: generadorFake({ fallarEn: new Set([objetivo]) }),
  });
  await conFallo.run(set.id);

  const final = await readSet(dataDir, set.id);
  const items = final.sections.flatMap(s => s.items);
  assert.equal(items[0].etat, 'echoue');
  assert.ok(items[0].erreur.includes('fallo simulado'));
  assert.equal(items.filter(i => i.etat === 'pret').length, 31, 'los demás ítems deben completarse');
  assert.equal(final.statut, 'partial');
});

test('reanudar reintenta los echoue con el MISMO topicId', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const catalog = catalogoAmplio();
  const base = createPipeline({ dataDir, generator: generadorFake(), synth: synthFake(), catalog });
  const set = await base.createSet({ seed: 8 });
  const objetivo = set.plan[0].topicId;

  const conFallo = createPipeline({
    dataDir, catalog, synth: synthFake(), generator: generadorFake({ fallarEn: new Set([objetivo]) }),
  });
  await conFallo.run(set.id);
  await base.run(set.id);

  const final = await readSet(dataDir, set.id);
  assert.equal(final.statut, 'complet');
  assert.equal(final.plan[0].topicId, objetivo, 'un reintento no debe consumir un tema nuevo');
  assert.equal(final.sections[0].items[0].topicId, objetivo);
});

test('el ledger cuadra con las llamadas realizadas', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 9 });
  await pipeline.run(set.id);

  const final = await readSet(dataDir, set.id);
  assert.equal(final.ledger.texte.appels, 32);
  assert.equal(final.ledger.tts.appels, 32);
  assert.equal(final.ledger.images.appels, 0);
});

test('isRunning bloquea una segunda ejecución concurrente', async () => {
  const { pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 10 });

  const enCurso = pipeline.run(set.id);
  assert.equal(pipeline.isRunning(set.id), true);
  await assert.rejects(() => pipeline.run(set.id), /en curso/);
  await enCurso;
  assert.equal(pipeline.isRunning(set.id), false);
});

test('el plan y las relajaciones quedan persistidos en el set', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 11 });
  const persistido = await readSet(dataDir, set.id);
  assert.equal(persistido.plan.length, 32);
  assert.ok(Array.isArray(persistido.relaxations));
  assert.equal(persistido.seed, 11);
});

test('createSet rechaza formatos que este slice no genera', async () => {
  const { pipeline } = await nuevoPipeline();
  await assert.rejects(() => pipeline.createSet({ format: 'SET_STANDARD_40', seed: 1 }), /SET_STANDARD_36/);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/pipeline.test.js`
Expected: FAIL — `Cannot find module '../src/sets/pipeline.js'`

- [ ] **Step 3: Implementar `pipeline.js`**

Crear `backend/src/sets/pipeline.js`:

```js
import { join } from 'node:path';
import { SET_COMPOSITIONS, SECTION_PRESETS, CONFIG as DEFAULT_CONFIG } from '../examFormat.js';
import { planTopics } from '../topics/planner.js';
import { TOPICS, topicById } from '../topics/catalog.js';
import { readRecentPlans } from '../topics/history.js';
import { writeSet, readSet, audioDir, nuevoSetId, contarItems } from './store.js';

const FORMATO_SOPORTADO = 'SET_STANDARD_36';

export function statusOf(set) {
  const conteo = contarItems(set);
  return { ...conteo, statut: set.statut };
}

export function createPipeline({ dataDir, generator, synth, catalog = TOPICS, config = DEFAULT_CONFIG }) {
  // El lock vive en memoria a propósito: un .lock en disco sobreviviría a un
  // crash y obligaría a detectar y limpiar locks huérfanos.
  const enCurso = new Set();

  function itemsDe(set) {
    return set.sections.flatMap(section =>
      section.items.map(item => ({ item, sectionType: section.type })));
  }

  function recalcularStatut(set) {
    const { total, prets } = contarItems(set);
    set.statut = prets === total ? 'complet' : 'partial';
  }

  return {
    isRunning(setId) {
      return enCurso.has(setId);
    },

    statusOf,

    async createSet({ difficulty = 'B2', format = FORMATO_SOPORTADO, pilotes = false, seed } = {}) {
      if (format !== FORMATO_SOPORTADO) {
        const error = new Error(`Formato no soportado en este slice: "${format}". Solo ${FORMATO_SOPORTADO}.`);
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
              sujet: topicById(entrada.topicId, catalog)?.text ?? '',
              posture: entrada.posture,
              pilote: entrada.pilote,
              images: [],
            })),
          };
        }),
      };

      await writeSet(dataDir, set);
      return set;
    },

    async run(setId, { maxItems = Infinity } = {}) {
      if (enCurso.has(setId)) {
        const error = new Error(`El set "${setId}" ya está en curso`);
        error.status = 409;
        throw error;
      }
      enCurso.add(setId);

      try {
        const set = await readSet(dataDir, setId);
        let trabajados = 0;

        for (const { item, sectionType } of itemsDe(set)) {
          if (trabajados >= maxItems) break;
          if (item.etat === 'pret') continue;

          // Paso 1: texto. Un reintento reusa el mismo topicId del plan.
          if (item.etat === 'en_attente' || item.etat === 'echoue') {
            try {
              set.ledger.texte.appels += 1;
              const generado = await generator.generateItem({
                sectionType,
                topic: item.sujet,
                topicId: item.topicId,
                difficulty: set.difficulty,
                posture: item.posture,
              });
              item.transcript = generado.transcript;
              item.questions = generado.questions;
              item.provider = generado.provider;
              item.tentativas = generado.tentativas;
              item.etat = 'genere';
              delete item.erreur;
            } catch (error) {
              set.ledger.texte.echecs += 1;
              item.etat = 'echoue';
              item.erreur = error.message;
              await writeSet(dataDir, set);
              trabajados += 1;
              continue;
            }
            await writeSet(dataDir, set);
          }

          // Paso 2: audio. Separado del texto para que un fallo de cuota TTS
          // no haga perder el texto ya pagado.
          if (item.etat === 'genere') {
            try {
              set.ledger.tts.appels += 1;
              const relativo = join('audio', `${item.ref}.wav`);
              const { duree_audio_s } = await synth.synthToFile({
                text: item.transcript,
                outPath: join(audioDir(dataDir, set.id), `${item.ref}.wav`),
              });
              item.audio = relativo;
              item.duree_audio_s = duree_audio_s;
              item.etat = 'pret';
              await writeSet(dataDir, set);
            } catch (error) {
              set.ledger.tts.echecs += 1;
              item.erreur = error.message;
              await writeSet(dataDir, set);
              break; // cuota agotada: parada limpia, nada perdido
            }
          }

          trabajados += 1;
        }

        recalcularStatut(set);
        await writeSet(dataDir, set);
        return set;
      } finally {
        enCurso.delete(setId);
      }
    },
  };
}
```

- [ ] **Step 4: Ejecutar los tests para verificar que pasan**

Run: `cd backend && node --test test/pipeline.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sets/pipeline.js backend/test/pipeline.test.js
git commit -m "feat(examen): pipeline de generación reanudable con flush por ítem"
```

---

### Task 13: Endpoints de sets y adaptador del modo entrenamiento

**Files:**
- Modify: `backend/server.js`
- Create: `backend/test/adaptador.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `aplanarItem(item) -> {prompt, options, correctId, feedback, transcript}` — exportada desde `server.js` para poder testearla sin levantar el servidor.
  - Rutas: `POST /api/sets/generate`, `POST /api/sets/:id/resume`, `GET /api/sets`, `GET /api/sets/:id`, `GET /api/sets/:id/status`, `GET /api/sets/:id/audio/:ref.wav`, `DELETE /api/sets/:id`.

- [ ] **Step 1: Escribir el test del adaptador**

Crear `backend/test/adaptador.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplanarItem } from '../server.js';

test('aplana el ítem nuevo a la forma que espera el frontend de entrenamiento', () => {
  const item = {
    transcript: 'Le service sera interrompu jusqu’à midi.',
    provider: 'gemini-3.5-flash',
    tentativas: 1,
    questions: [{
      prompt: 'Quel est le message ?',
      options: [
        { id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' },
      ],
      correctId: 'C',
      feedback: 'La opción C es correcta.',
      justification: 'Le service sera interrompu',
      justificationScore: 1,
    }],
  };

  const plano = aplanarItem(item);
  assert.equal(plano.prompt, 'Quel est le message ?');
  assert.equal(plano.correctId, 'C');
  assert.equal(plano.feedback, 'La opción C es correcta.');
  assert.equal(plano.transcript, item.transcript);
  assert.equal(plano.options.length, 4);
  assert.deepEqual(plano.options.map(o => o.id), ['A', 'B', 'C', 'D']);
});

test('la forma aplanada no filtra campos internos del esquema de sets', () => {
  const plano = aplanarItem({
    transcript: 't', provider: 'p', tentativas: 3,
    questions: [{
      prompt: 'p', options: [{ id: 'A', text: 'a' }], correctId: 'A',
      feedback: 'f', justification: 'j', justificationScore: 0.9,
    }],
  });
  assert.equal(plano.questions, undefined, 'no debe exponer el array anidado');
  assert.equal(plano.justification, undefined, 'justification es interna del pipeline de sets');
  assert.equal(plano.justificationScore, undefined);
  assert.equal(plano.tentativas, undefined);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd backend && node --test test/adaptador.test.js`
Expected: FAIL — `aplanarItem is not a function`

- [ ] **Step 3: Evitar que importar `server.js` levante el servidor**

`test/adaptador.test.js` importa `server.js` para probar `aplanarItem`. Con el `app.listen()` incondicional actual, ese import abriría un puerto y dejaría la suite colgada. Al final de `backend/server.js`, sustituir:

```js
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`TEFAQ Agent running on port ${PORT}`);
});
```

por:

```js
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3001;

// Solo escucha si se ejecuta directamente (`node server.js`); importarlo desde
// un test no debe abrir un puerto.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`TEFAQ Agent running on port ${PORT}`);
  });
}

export { app };
```

- [ ] **Step 4: Añadir el adaptador y reapuntar `/api/generate-question`**

En `backend/server.js`, sustituir los imports de `questionGenerator.js` y `prompt.js` por:

```js
import { createItemGenerator } from './src/itemGenerator.js';
import { createSynth } from './src/audio/synth.js';
import { createPipeline } from './src/sets/pipeline.js';
import { listSets, readSet, deleteSet, audioDir } from './src/sets/store.js';
import { VALID_DIFFICULTIES } from './src/prompt/profiles.js';
import { join } from 'node:path';
```

Sustituir `const generator = createQuestionGenerator(providers);` por:

```js
const DATA_DIR = new URL('./data/', import.meta.url).pathname;
const generator = createItemGenerator(providers);
const synth = createSynth({ apiKey: TTS_API_KEY, voices: TTS_VOICES });
const pipeline = createPipeline({ dataDir: DATA_DIR, generator, synth });

// El modo entrenamiento sigue usando el formato de una sola pregunta corta.
const SECCION_ENTRENAMIENTO = 'divers';

// El frontend de entrenamiento espera la forma plana de siempre.
export function aplanarItem(item) {
  const question = item.questions[0];
  return {
    prompt: question.prompt,
    options: question.options,
    correctId: question.correctId,
    feedback: question.feedback,
    transcript: item.transcript,
  };
}
```

En la ruta `/api/generate-question` y en `generatePrefetchedQuestion`, sustituir las llamadas a `generator.generateQuestion(...)` por:

```js
const item = await generator.generateItem({
  sectionType: SECCION_ENTRENAMIENTO,
  topic: TOPICS[Math.floor(Math.random() * TOPICS.length)].text,
  difficulty: params.difficulty,
  minWords: params.minWords,
  maxWords: params.maxWords,
  verticalScan: params.verticalScan,
  selector: params.selector === 'auto' ? undefined : [params.selector],
});
const question = { ...aplanarItem(item), provider: item.provider };
```

Añadir el import `import { TOPICS } from './src/topics/catalog.js';`.

- [ ] **Step 5: Añadir las rutas de sets**

En `backend/server.js`, antes de `app.listen`:

```js
app.post('/api/sets/generate', async (req, res) => {
  try {
    const set = await pipeline.createSet({
      difficulty: req.body?.difficulty,
      format: req.body?.format,
      pilotes: Boolean(req.body?.pilotes),
      seed: req.body?.seed,
    });
    res.status(201).json({ id: set.id, total: set.plan.length, statut: set.statut });
    // Arranca en background: el disco ya tiene el esqueleto completo.
    pipeline.run(set.id, { maxItems: req.body?.maxItems }).catch(error => {
      console.error(`[pipeline] ${set.id} falló:`, error.message);
    });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.post('/api/sets/:id/resume', async (req, res) => {
  if (pipeline.isRunning(req.params.id)) {
    return res.status(409).json({ error: 'El set ya está en curso' });
  }
  try {
    const set = await readSet(DATA_DIR, req.params.id);
    res.json({ id: set.id, ...pipeline.statusOf(set) });
    pipeline.run(set.id, { maxItems: req.body?.maxItems }).catch(error => {
      console.error(`[pipeline] ${set.id} falló:`, error.message);
    });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/sets', async (_req, res) => {
  res.json(await listSets(DATA_DIR));
});

app.get('/api/sets/:id', async (req, res) => {
  try {
    res.json(await readSet(DATA_DIR, req.params.id));
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/sets/:id/status', async (req, res) => {
  try {
    const set = await readSet(DATA_DIR, req.params.id);
    res.json({ ...pipeline.statusOf(set), enCours: pipeline.isRunning(set.id) });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/sets/:id/audio/:archivo', (req, res) => {
  if (!/^[\w-]+\.wav$/.test(req.params.archivo)) {
    return res.status(400).json({ error: 'Nombre de audio inválido' });
  }
  res.sendFile(join(audioDir(DATA_DIR, req.params.id), req.params.archivo), error => {
    if (error) res.status(404).json({ error: 'Audio no encontrado' });
  });
});

app.delete('/api/sets/:id', async (req, res) => {
  if (pipeline.isRunning(req.params.id)) {
    return res.status(409).json({ error: 'No se puede borrar un set en curso' });
  }
  await deleteSet(DATA_DIR, req.params.id);
  res.status(204).end();
});
```

- [ ] **Step 6: Ejecutar toda la suite**

Run: `cd backend && npm test`
Expected: PASS — todos los grupos en verde.

- [ ] **Step 7: Verificar a mano que el modo entrenamiento no cambió**

```bash
cd backend && npm start
```
En otra terminal:
```bash
curl -s 'http://localhost:3001/api/generate-question?minWords=30&maxWords=50&difficulty=B2' | python3 -m json.tool | head -20
```
Expected: un objeto con `prompt`, `options` (4), `transcript`, `correctId`, `feedback`, `provider`, `prefetched` — sin campo `questions`.

Después arrancar el frontend (`cd frontend && npm run dev`), generar una pregunta y comprobar que el audio y el escaneo vertical siguen funcionando. Parar ambos.

- [ ] **Step 8: Commit**

```bash
git add backend/server.js backend/test/adaptador.test.js
git commit -m "feat(examen): endpoints de sets y adaptador del modo entrenamiento"
```

---

### Task 14: Limpieza y verificación con un set real

**Files:**
- Delete: `backend/src/prompt.js`
- Delete: `backend/src/questionGenerator.js`
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada nuevo.

- [ ] **Step 1: Comprobar que los archivos viejos ya no se importan**

Run: `cd backend && grep -rn "questionGenerator\|src/prompt\.js" --include=*.js . | grep -v node_modules`
Expected: sin resultados.

- [ ] **Step 2: Borrarlos y verificar que todo sigue verde**

```bash
cd backend && rm src/prompt.js src/questionGenerator.js && npm test
```
Expected: PASS, toda la suite.

- [ ] **Step 3: Generar el set de prueba de 2 secciones**

Añadir temporalmente a `backend/src/examFormat.js` la composición de prueba:

```js
SET_PRUEBA_2: ['annonce_publique', 'interview'],
```

y permitirla en `pipeline.js` cambiando la guarda:

```js
const FORMATOS_SOPORTADOS = ['SET_STANDARD_36', 'SET_PRUEBA_2'];
if (!FORMATOS_SOPORTADOS.includes(format)) {
```

Arrancar el backend y generar:

```bash
cd backend && npm start &
sleep 3
curl -s -X POST http://localhost:3001/api/sets/generate \
  -H 'Content-Type: application/json' \
  -d '{"format":"SET_PRUEBA_2","difficulty":"B2","seed":42}'
```

Esperar y consultar el progreso hasta `complet`:

```bash
curl -s http://localhost:3001/api/sets | python3 -m json.tool
```

- [ ] **Step 4: Revisar el resultado a mano**

```bash
cd backend && python3 -m json.tool data/sets/<id>/set.json | head -80 && ls -la data/sets/<id>/audio/
```

Comprobar:
- 7 ítems (4 annonce + 3 interview), todos `pret`.
- Los ítems de interview tienen 2 preguntas y transcript con `Journaliste:` / `Invité(e):`.
- `duree_audio_s` coherente con el tamaño del WAV.
- `justificationScore` presente en todas las preguntas.
- `ledger.texte.appels` y `ledger.tts.appels` cuadran con 7.
- Ningún tema repetido en `plan`.

Escuchar un par de WAV para confirmar que el audio es inteligible.

- [ ] **Step 5: Probar la reanudación en caliente**

```bash
curl -s -X POST http://localhost:3001/api/sets/generate \
  -H 'Content-Type: application/json' \
  -d '{"format":"SET_PRUEBA_2","seed":43,"maxItems":2}'
```
Matar el backend (`kill %1`), rearrancarlo, y reanudar:
```bash
curl -s -X POST http://localhost:3001/api/sets/<id>/resume -H 'Content-Type: application/json' -d '{}'
```
Expected: el set llega a `complet` sin regenerar los ítems que ya estaban `pret`.

- [ ] **Step 6: Actualizar la documentación**

En `CLAUDE.md`, sustituir la sección de arquitectura del backend para reflejar la estructura nueva (`examFormat.js`, `topics/`, `prompt/`, `validation/`, `sets/`, `audio/`), el pipeline de sets y el comando `npm test`. Eliminar las referencias a `prompt.js` y `questionGenerator.js`.

En `README.md`, añadir una sección «Modo Examen — generación de sets» documentando los endpoints nuevos, que los sets viven en `backend/data/sets/` y que se puede reanudar una generación interrumpida.

- [ ] **Step 7: Revertir la composición de prueba**

Quitar `SET_PRUEBA_2` de `examFormat.js` y devolver la guarda de `pipeline.js` a `FORMATO_SOPORTADO === 'SET_STANDARD_36'`. Volver a ejecutar `npm test`.

- [ ] **Step 8: Generar un set estándar completo**

```bash
cd backend && npm start &
sleep 3
curl -s -X POST http://localhost:3001/api/sets/generate -H 'Content-Type: application/json' -d '{"difficulty":"B2"}'
```
Vigilar `GET /api/sets/:id/status` hasta `complet`. Verificar: 32 ítems `pret`, 36 preguntas en total, sin temas repetidos, `relaxations` vacío.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(examen): eliminar módulos superados y actualizar documentación"
```

---

## Verificación final del slice

- [ ] `cd backend && npm test` — toda la suite en verde.
- [ ] El modo entrenamiento funciona en el navegador sin cambios observables (audio, escaneo vertical, dificultad, contador).
- [ ] Un set `SET_STANDARD_36` completo generado, con `ledger` coherente y sin temas repetidos.
- [ ] Interrumpir la generación a mitad y reanudarla produce un set `complet` sin regenerar nada ya listo.
- [ ] Un segundo set generado sobre el primero no repite ningún tema por sección.
