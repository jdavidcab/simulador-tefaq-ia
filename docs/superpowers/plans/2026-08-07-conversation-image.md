# Sección `conversation_image` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la sección `conversation_image` (audio corto + 4 imágenes-opción) end-to-end — generación de contenido, generación de imágenes con checkpoint de reanudación, almacenamiento/servido, renderizado en el runner y en el repaso, y habilitación de `SET_STANDARD_40` — y completar el único set real existente a 40 preguntas.

**Architecture:** Backend: nuevo catálogo de 8 categorías+dimensiones con rotación dedicada (no el planner genérico de temas), nuevo constructor de prompt bespoke (no reutiliza `reglasComunes`/`opcionesFijas`, esta sección diverge demasiado), nuevo módulo de generación de imágenes (`gemini-3.1-flash-image` vía la misma API de Interactions que ya usa TTS), nuevo paso checkpointeado en `sets/pipeline.js`, nueva ruta de servido. Frontend: nueva variante de renderizado de opciones-imagen (reutiliza el layout ya aprobado en mockup), precarga de imágenes independiente de la de audio (sin blob URLs — las imágenes no necesitan gestión de memoria como el audio), generalización de `setCompatibility.js` a 36/40.

**Tech Stack:** Node.js/Express (backend), React 18 (frontend), Gemini API REST (`v1beta/interactions`, mismo endpoint que ya usa `audio/synth.js`), `node --test` en ambos lados.

## Global Constraints

- Contrato de opción: `{ id, text, imagePrompt }` — `text` sigue siendo obligatorio (lo exige `validation/index.js` y lo usa `itemGenerator.js` para remapear la opción correcta tras el barajado por contenido, no por id); `imagePrompt` es nuevo, solo para `conversation_image`, y el frontend nunca renderiza `text` para esta sección.
- Dificultad forzada a B1 para `conversation_image` siempre, ignorando la dificultad global del set — se resuelve LOCALMENTE en `prompt/sections/conversation_image.js`, sin tocar `itemGenerator.js`/`pipeline.js`/`prompt/index.js`.
- Transcript recalibrado a 40-55 palabras (no 40-70) para encajar en la ventana real de 10-20s de audio.
- Reanudación parcial de imágenes vía checkpoint en `item.images` (sin estado nuevo en `item.etat`, que se mantiene en `'genere'` durante todo el paso de imágenes, igual que ya hace audio).
- `pilotes: true` + `format: 'SET_STANDARD_40'` se rechaza en `createSet()` (daría 44 preguntas, rompiendo el invariante 36+4=40 de los pilotos).
- Resolución de imagen: la más barata del modelo (`512px`).
- 5 llamadas de imagen por ítem: 1 referencia de estilo neutral (descartada, nunca es una opción) + 4 opciones, todas usando la referencia para consistencia de estilo — nunca la opción correcta como referencia (evita que sea la única "distinta").
- Sin validación estructural profunda nueva en `checkSetCompatibility` (el resto del código tampoco la tiene para las demás secciones); el invariante de completitud lo garantiza el pipeline, no el consumidor.
- Sin decodificación/verificación de dimensiones de imagen más allá de "la respuesta trajo bytes"; sin escritura atómica con archivo temporal (el resto del pipeline tampoco la usa para audio).
- Categorías (8, fijas): `objets_produits`, `lieux_commerces`, `activites_loisirs`, `situations_domestiques`, `transports`, `repas_nourriture`, `meteo_vetements`, `personnes_interactions`.
- Dimensiones discriminantes (6, fijas): objeto principal, cantidad, acción en curso, lugar, momento del día, clima.

---

### Task 1: Catálogo de categorías e imágenes (`imageCategories.js`)

**Files:**
- Create: `backend/src/topics/imageCategories.js`
- Test: `backend/test/imageCategories.test.js`

**Interfaces:**
- Produces: `IMAGE_CATEGORIES` (array de `{id, label}`), `DISCRIMINATING_DIMENSIONS` (array de 6 strings), `categoryById(id)` (mirror de `topicById`), `pickCategories(rng, recentPlans, count)` — usados por Task 2 (planner) y Task 3 (prompt constructor).

- [ ] **Step 1: Escribir el catálogo y las funciones**

```js
// backend/src/topics/imageCategories.js
import { sampleWithoutReplacement } from '../rng.js';

// 8 categorías fijas para conversation_image (sección más fácil del examen,
// A2-B1). No son temas de texto libre como topics/catalog.js: son un enum
// cerrado sobre el que el planner sortea 4 por set. `label` es el texto
// completo que recibe el LLM como "tema" (mismo campo que usan las demás
// secciones vía ctx.topic), así que incluye tanto la categoría como ejemplos
// concretos -- no hace falta un campo separado.
export const IMAGE_CATEGORIES = [
  {
    id: 'objets_produits',
    label: 'Objetos y productos de la vida cotidiana en un contexto de compra, reparación o regalo: electrodomésticos, muebles, ropa, herramientas.',
  },
  {
    id: 'lieux_commerces',
    label: 'Lugares públicos y comercios cotidianos de Quebec: estación, aeropuerto, biblioteca, farmacia, café, tienda de abarrotes.',
  },
  {
    id: 'activites_loisirs',
    label: 'Personas realizando una actividad de ocio: deporte, jardinería, bricolaje, cocina.',
  },
  {
    id: 'situations_domestiques',
    label: 'Situaciones y problemas del hogar: fuga de agua, mudanza, limpieza, un aparato averiado.',
  },
  {
    id: 'transports',
    label: 'Medios de transporte y desplazamientos: metro, autobús, bicicleta, auto, a pie -- incluyendo retrasos o correspondencias.',
  },
  {
    id: 'repas_nourriture',
    label: 'Comida y contextos alimenticios: restaurante, mercado, preparación de un plato.',
  },
  {
    id: 'meteo_vetements',
    label: 'Condiciones climáticas y la ropa que corresponde a cada una.',
  },
  {
    id: 'personnes_interactions',
    label: 'Un grupo de personas interactuando: cuántas son, quién hace qué, una profesión visible en la escena.',
  },
];

export const DISCRIMINATING_DIMENSIONS = [
  'objeto principal', 'cantidad', 'acción en curso', 'lugar', 'momento del día', 'clima',
];

export function categoryById(id) {
  return IMAGE_CATEGORIES.find(cat => cat.id === id);
}

// Excluye las categorías usadas en el set inmediatamente anterior (no el
// historyWindow general de 3 -- con solo 8 categorías y 4 por set, excluir
// las últimas 4 siempre deja exactamente 4 disponibles, garantizando
// alternancia estricta sin necesitar el mecanismo de relajación 3->2->1->0
// que sí necesita el catálogo de 152 temas libres.
export function pickCategories(rng, recentPlans, count) {
  const previousIds = new Set(
    (recentPlans[0] ?? [])
      .filter(entry => entry.sectionType === 'conversation_image')
      .map(entry => entry.topicId),
  );
  const pool = IMAGE_CATEGORIES.filter(cat => !previousIds.has(cat.id));
  const disponibles = pool.length >= count ? pool : IMAGE_CATEGORIES;
  return sampleWithoutReplacement(rng, disponibles, count);
}
```

- [ ] **Step 2: Escribir los tests**

```js
// backend/test/imageCategories.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/rng.js';
import {
  IMAGE_CATEGORIES, DISCRIMINATING_DIMENSIONS, categoryById, pickCategories,
} from '../src/topics/imageCategories.js';

test('hay exactamente 8 categorías con id y label', () => {
  assert.equal(IMAGE_CATEGORIES.length, 8);
  for (const cat of IMAGE_CATEGORIES) {
    assert.equal(typeof cat.id, 'string');
    assert.ok(cat.label.length > 20);
  }
});

test('hay exactamente 6 dimensiones discriminantes', () => {
  assert.equal(DISCRIMINATING_DIMENSIONS.length, 6);
});

test('categoryById encuentra una categoría existente', () => {
  assert.equal(categoryById('objets_produits').id, 'objets_produits');
});

test('categoryById retorna undefined para un id inexistente', () => {
  assert.equal(categoryById('no-existe'), undefined);
});

test('pickCategories sin historial retorna `count` categorías distintas', () => {
  const rng = createRng(1);
  const elegidas = pickCategories(rng, [], 4);
  assert.equal(elegidas.length, 4);
  assert.equal(new Set(elegidas.map(c => c.id)).size, 4);
});

test('pickCategories excluye las 4 categorías del set inmediatamente anterior', () => {
  const rng = createRng(1);
  const anterior = [
    { sectionType: 'conversation_image', topicId: 'objets_produits' },
    { sectionType: 'conversation_image', topicId: 'lieux_commerces' },
    { sectionType: 'conversation_image', topicId: 'activites_loisirs' },
    { sectionType: 'conversation_image', topicId: 'situations_domestiques' },
    { sectionType: 'annonce_publique', topicId: 't-001' }, // de otra sección, no debe afectar
  ];
  const elegidas = pickCategories(rng, [anterior], 4);
  const idsElegidos = elegidas.map(c => c.id);
  assert.deepEqual(
    idsElegidos.sort(),
    ['meteo_vetements', 'personnes_interactions', 'repas_nourriture', 'transports'].sort(),
  );
});

test('pickCategories con más de un plan reciente solo mira el más reciente (recentPlans[0])', () => {
  const rng = createRng(1);
  const masReciente = [{ sectionType: 'conversation_image', topicId: 'transports' }];
  const viejo = [{ sectionType: 'conversation_image', topicId: 'objets_produits' }];
  const elegidas = pickCategories(rng, [masReciente, viejo], 8);
  assert.ok(!elegidas.some(c => c.id === 'transports'));
  assert.ok(elegidas.some(c => c.id === 'objets_produits'));
});
```

- [ ] **Step 3: Correr los tests**

Run: `cd backend && node --test test/imageCategories.test.js`
Expected: 7/7 PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/topics/imageCategories.js backend/test/imageCategories.test.js
git commit -m "feat(backend): add image category catalog for conversation_image"
```

---

### Task 2: Asignación de categorías en el planner

**Files:**
- Modify: `backend/src/topics/planner.js`
- Test: `backend/test/planner.test.js`

**Interfaces:**
- Consumes: `pickCategories(rng, recentPlans, count)` de Task 1.
- Produces: `planTopics()` ahora puede recibir `compositionKey: 'SET_STANDARD_40'` y asigna `conversation_image` correctamente. Sin cambios en la forma de un `plan entry` (`{ref, sectionType, topicId, pilote, posture?}`) — para `conversation_image`, `topicId` contiene un categoryId en vez de un id del catálogo de temas.

- [ ] **Step 1: Escribir el test que falla**

```js
// Agregar a backend/test/planner.test.js, junto a los tests existentes
import { IMAGE_CATEGORIES } from '../src/topics/imageCategories.js';

test('conversation_image recibe 4 categorías del catálogo de imágenes, no temas', () => {
  const { plan } = planTopics({
    catalog: catalogoAmplio(),
    compositionKey: 'SET_STANDARD_40',
    recentPlans: [],
    seed: 99,
    pilotes: false,
    config: CONFIG,
  });
  const entradasImagen = plan.filter(p => p.sectionType === 'conversation_image');
  assert.equal(entradasImagen.length, 4);
  const idsValidos = new Set(IMAGE_CATEGORIES.map(c => c.id));
  for (const entrada of entradasImagen) {
    assert.ok(idsValidos.has(entrada.topicId), `${entrada.topicId} no es una categoría de imagen válida`);
  }
  assert.equal(new Set(entradasImagen.map(e => e.topicId)).size, 4, 'las 4 categorías deben ser distintas');
});

test('SET_STANDARD_40 pone conversation_image primero, con refs s1i1..s1i4', () => {
  const { plan } = planTopics({
    catalog: catalogoAmplio(),
    compositionKey: 'SET_STANDARD_40',
    recentPlans: [],
    seed: 99,
    pilotes: false,
    config: CONFIG,
  });
  assert.equal(plan[0].sectionType, 'conversation_image');
  assert.equal(plan[0].ref, 's1i1');
  assert.equal(plan[3].ref, 's1i4');
  assert.equal(plan[4].sectionType, 'annonce_publique');
  assert.equal(plan[4].ref, 's2i1');
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && node --test test/planner.test.js`
Expected: FAIL — `planTopics` intenta usar `disponibles()`/`topicsForSection('conversation_image', ...)` para `conversation_image`, que retorna `[]` (ningún tema del catálogo de texto libre está etiquetado para esa sección), y lanza `Temas insuficientes para "conversation_image": 0 disponibles, 4 necesarios.`

- [ ] **Step 3: Modificar `planner.js`**

Agregar el import al inicio del archivo:

```js
import { pickCategories } from './imageCategories.js';
```

Modificar el bucle de asignación (el que empieza con `for (const sectionType of ordenPorEscasez) {`) para especial-casear `conversation_image` al inicio del cuerpo del loop, ANTES de la lógica existente de `window`/`disponibles`:

```js
  for (const sectionType of ordenPorEscasez) {
    if (sectionType === 'conversation_image') {
      const elegidas = pickCategories(rng, recentPlans, demanda[sectionType]);
      for (const categoria of elegidas) asignados.add(categoria.id);
      porSeccion[sectionType] = elegidas;
      continue;
    }

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
```

No hace falta tocar el segundo bucle (el que emite `plan` con los refs) — ya usa `topic.id` genéricamente, y tanto los objetos de tema como los de categoría tienen un campo `.id`, así que `entrada.topicId = topic.id` funciona sin cambios para ambos casos.

**Nota sobre `ordenPorEscasez`:** el cálculo de escasez (`disponibles(...).length / demanda[a]`) sigue llamando `disponibles()` para `conversation_image` (retorna `[]`, ratio 0) solo para decidir el ORDEN de asignación — no crashea, simplemente ordena `conversation_image` primero (más "escaso"), lo cual es inofensivo porque la rama especial de arriba nunca usa ese pool. No hace falta tocar `ordenPorEscasez`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && node --test test/planner.test.js`
Expected: todos los tests existentes siguen en PASS, más los 2 nuevos.

- [ ] **Step 5: Commit**

```bash
git add backend/src/topics/planner.js backend/test/planner.test.js
git commit -m "feat(backend): assign conversation_image categories via dedicated rotation"
```

---

### Task 3: Constructor de prompt, validación, y recalibración de palabras

**Files:**
- Create: `backend/src/prompt/sections/conversation_image.js`
- Modify: `backend/src/prompt/index.js`
- Modify: `backend/src/validation/index.js`
- Modify: `backend/src/examFormat.js:4` (rango de palabras)
- Test: `backend/test/prompt.test.js`
- Test: `backend/test/validation.test.js`

**Interfaces:**
- Consumes: `DISCRIMINATING_DIMENSIONS` de Task 1.
- Produces: `buildSectionPrompt('conversation_image', ctx)` funciona igual que las otras 7 secciones (mismo `buildSectionPrompt(sectionType, opts)` de `prompt/index.js`, sin cambios en su firma). `validateItem(item, 'conversation_image', opts)` exige `imagePrompt` no vacío en cada opción, además de las reglas ya genéricas (`text`, `correctId`, `feedback`, `justification`).

- [ ] **Step 1: Recalibrar el preset en `examFormat.js`**

En `backend/src/examFormat.js:4`, cambiar:

```js
  conversation_image: { bloc: 1, questions: 4,  avant: 5,  apres: 10, questionsPerAudio: 1, minWords: 40,  maxWords: 70,  lectures: 1 },
```

por:

```js
  conversation_image: { bloc: 1, questions: 4,  avant: 5,  apres: 10, questionsPerAudio: 1, minWords: 40,  maxWords: 55,  lectures: 1 },
```

(70 palabras a ~150 palabras/minuto de habla francesa conversacional ronda 28-30s, fuera de la ventana real de 10-20s de esta sección; 40-55 palabras encaja mejor.)

También actualizar el comentario de `GENERABLE_SECTIONS` (línea 14), que hoy dice "conversation_image no tiene constructor de prompt todavía (slice 4)" y ya no será cierto:

```js
// Las 7 secciones que comparten la ruta genérica de generación (texto ->
// audio). No incluye conversation_image: tiene su propio constructor de
// prompt y un paso extra de generación de imágenes (ver sets/pipeline.js).
// SET_STANDARD_40 la antepone aparte (no aquí) para no duplicarla.
export const GENERABLE_SECTIONS = [
  'annonce_publique', 'repondeur', 'micro_trottoir',
  'chronique', 'interview', 'reportage', 'divers',
];
```

- [ ] **Step 2: Escribir el constructor de prompt**

```js
// backend/src/prompt/sections/conversation_image.js
//
// A diferencia de las demás 7 secciones, esta NO reutiliza reglasComunes()/
// opcionesFijas: las opciones no son texto libre inventado (como el resto)
// ni texto fijo predefinido (como micro_trottoir) -- son descripciones de
// escena ancladas a una categoría+dimensión, pensadas para convertirse en
// una imagen, no para leerse. La dificultad se fuerza a B1 SIEMPRE, sin
// importar ctx.difficulty (esta sección es deliberadamente la más fácil del
// examen real, A2-B1, "sujet concret et familier").
import { bloquePerfil } from '../common.js';
import { DISCRIMINATING_DIMENSIONS } from '../../topics/imageCategories.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN diálogo corto de comprensión oral para la sección "conversation_image", la más fácil del examen (nivel A2-B1, sujet concret et familier).
El diálogo ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".

Dos personas conversan brevemente (10-20 segundos de habla real, ${ctx.minWords}-${ctx.maxWords} palabras) y el resultado debe dejar claro, sin ambigüedad, UN elemento concreto específico relacionado con el tema de arriba.

${bloquePerfil('B1')}

Elige 1 o 2 de estas dimensiones para variar entre las 4 opciones (no todas a la vez): ${DISCRIMINATING_DIMENSIONS.join(', ')}.

Reglas:
1. Las 4 opciones NO son texto para leer: cada una es una descripción de una escena-variante que luego se convierte en un boceto simple. Deben ser igual de plausibles entre sí hasta escuchar el audio -- ninguna debe ser absurda, de otra categoría, u obviamente descartable a simple vista.
2. Cada opción tiene dos campos: "text" (descripción breve en francés de la escena, 1 frase) e "imagePrompt" (versión más detallada en francés de esa misma escena, pensada para generar el boceto -- incluye el/los elemento(s) que varían según la(s) dimensión(es) elegida(s)).
3. Las 4 opciones deben variar ÚNICAMENTE en la(s) dimensión(es) elegida(s); todo lo demás (tipo de escena, nivel de detalle) debe ser comparable entre las 4.
4. El transcript debe usar parafraseo natural; el elemento discriminante debe quedar claro por el CONTENIDO del diálogo, no por una palabra aislada fácil de adivinar sin escuchar el resto.
5. El campo "justification" de cada pregunta debe ser una CITA TEXTUAL del transcript (mínimo 8 palabras de contenido, copiada literalmente) que sostenga la respuesta correcta.
6. El feedback NO debe mencionar letras de opciones (A, B, C, D). Explica qué detalle del diálogo confirma la escena correcta.
7. Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown ni comillas triples.

Estructura JSON requerida:
{
  "transcript": "El diálogo en francés...",
  "questions": [{
    "prompt": "Pregunta en francés (ej. Quelle image correspond à la conversation ?)",
    "options": [
      { "id": "A", "text": "Description brève en français", "imagePrompt": "Description détaillée en français pour le dessin" },
      { "id": "B", "text": "...", "imagePrompt": "..." },
      { "id": "C", "text": "...", "imagePrompt": "..." },
      { "id": "D", "text": "...", "imagePrompt": "..." }
    ],
    "correctId": "A",
    "feedback": "Explicación breve en español.",
    "justification": "cita textual del transcript"
  }]
}`;
}
```

- [ ] **Step 3: Escribir el test que falla, para `buildSectionPrompt`**

```js
// Agregar a backend/test/prompt.test.js
import { buildSectionPrompt } from '../src/prompt/index.js';

test('buildSectionPrompt genera un prompt para conversation_image', () => {
  const prompt = buildSectionPrompt('conversation_image', {
    topic: 'Comida y contextos alimenticios: restaurante, mercado, preparación de un plato.',
    minWords: 40,
    maxWords: 55,
  });
  assert.match(prompt, /conversation_image/);
  assert.match(prompt, /imagePrompt/);
  assert.match(prompt, /40-55 palabras/);
  assert.match(prompt, /objeto principal/); // una de las 6 dimensiones
  assert.doesNotMatch(prompt, /undefined/);
});
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `cd backend && node --test test/prompt.test.js`
Expected: FAIL — `buildSectionPrompt` lanza `No hay constructor de prompt para "conversation_image"`.

- [ ] **Step 5: Wire el constructor en `prompt/index.js`**

En `backend/src/prompt/index.js`, agregar el import junto a los demás:

```js
import { build as conversation_image } from './sections/conversation_image.js';
```

Y agregarlo al objeto `CONSTRUCTORES`:

```js
const CONSTRUCTORES = {
  conversation_image, annonce_publique, repondeur, micro_trottoir, chronique, interview, reportage, divers,
};
```

Actualizar el mensaje de error (ya no aplica a `conversation_image`):

```js
  if (!build) {
    throw new Error(`No hay constructor de prompt para "${sectionType}"`);
  }
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd backend && node --test test/prompt.test.js`
Expected: PASS.

- [ ] **Step 7: Validación — test que falla**

```js
// Agregar a backend/test/validation.test.js
import { validateItem } from '../src/validation/index.js';

function itemConversationImageValido(overrides = {}) {
  return {
    transcript: 'Bonjour, je cherche une baguette et un croissant pour ce matin, vous en avez encore ? Oui bien sûr, je vous les prépare tout de suite avec plaisir.',
    questions: [{
      prompt: 'Quelle image correspond à la conversation ?',
      options: [
        { id: 'A', text: 'Une baguette', imagePrompt: 'Un pain baguette sur un comptoir' },
        { id: 'B', text: 'Un croissant', imagePrompt: 'Un croissant sur une assiette' },
        { id: 'C', text: 'Une pizza', imagePrompt: 'Une pizza sur une table' },
        { id: 'D', text: 'Une salade', imagePrompt: 'Une salade dans un bol' },
      ],
      correctId: 'A',
      feedback: 'Se menciona explícitamente una baguette.',
      justification: 'je cherche une baguette et un croissant pour ce matin',
    }],
    ...overrides,
  };
}

test('valida un ítem correcto de conversation_image', () => {
  const item = itemConversationImageValido();
  assert.doesNotThrow(() => validateItem(item, 'conversation_image', { minWords: 5, maxWords: 100 }));
});

test('rechaza una opción de conversation_image sin imagePrompt', () => {
  const item = itemConversationImageValido();
  delete item.questions[0].options[0].imagePrompt;
  assert.throws(
    () => validateItem(item, 'conversation_image', { minWords: 5, maxWords: 100 }),
    /imagePrompt/,
  );
});

test('rechaza una opción de conversation_image con imagePrompt vacío', () => {
  const item = itemConversationImageValido();
  item.questions[0].options[1].imagePrompt = '   ';
  assert.throws(
    () => validateItem(item, 'conversation_image', { minWords: 5, maxWords: 100 }),
    /imagePrompt/,
  );
});
```

- [ ] **Step 8: Correr los tests y verificar que fallan**

Run: `cd backend && node --test test/validation.test.js`
Expected: el primer test (ítem válido) PASA ya (imagePrompt simplemente se ignora hoy); los 2 tests de rechazo FALLAN porque no hay ninguna validación que exija `imagePrompt`.

- [ ] **Step 9: Agregar `validarConversationImage` a `validation/index.js`**

Agregar la función, junto a `validarMicroTrottoir`/`validarInterview`:

```js
function validarConversationImage(item) {
  const question = item.questions[0];
  for (const option of question.options) {
    if (typeof option.imagePrompt !== 'string' || !option.imagePrompt.trim()) {
      throw new Error('conversation_image: cada opción requiere "imagePrompt" no vacío');
    }
  }
}
```

Y llamarla en `validateItem`, junto a las otras dos:

```js
  if (sectionType === 'micro_trottoir') validarMicroTrottoir(item, opts.posture, config);
  if (sectionType === 'interview') validarInterview(item);
  if (sectionType === 'conversation_image') validarConversationImage(item);
```

- [ ] **Step 10: Correr los tests y verificar que pasan**

Run: `cd backend && node --test test/validation.test.js test/prompt.test.js`
Expected: todo PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/examFormat.js backend/src/prompt/sections/conversation_image.js backend/src/prompt/index.js backend/src/validation/index.js backend/test/prompt.test.js backend/test/validation.test.js
git commit -m "feat(backend): add conversation_image prompt constructor and validation"
```

---

### Task 4: Módulo de generación de imágenes (`images/synth.js`)

**Files:**
- Create: `backend/src/images/synth.js`
- Test: `backend/test/imageSynth.test.js`

**Interfaces:**
- Produces: `createImageSynth({ apiKey, fetchImpl }) -> { synthImageToFile({prompt, referenceImageBase64, outPath}) -> {base64}, readReferenceIfExists(path) -> string|null }`. Usado por Task 5 (pipeline.js) y Task 6 (server.js).

- [ ] **Step 1: Escribir el módulo**

Mismo patrón que `audio/synth.js` (mismo endpoint `v1beta/interactions`, mismo manejo de `error.status` para que `esFalloDeCuotaORed` lo clasifique bien):

```js
// backend/src/images/synth.js
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const IMAGE_MODEL = 'gemini-3.1-flash-image';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export function createImageSynth({ apiKey, fetchImpl = fetch }) {
  return {
    async synthImageToFile({ prompt, referenceImageBase64, outPath }) {
      if (!apiKey) {
        const error = new Error('No hay API key configurada para Gemini Image');
        error.status = 503;
        throw error;
      }

      const input = [{ type: 'text', text: prompt }];
      if (referenceImageBase64) {
        input.push({ type: 'image', mime_type: 'image/png', data: referenceImageBase64 });
      }

      const response = await fetchImpl(INTERACTIONS_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          input,
          response_format: { type: 'image', mime_type: 'image/png', image_size: '512px' },
        }),
      });

      if (!response.ok) {
        const cuerpo = await response.text().catch(() => '');
        const error = new Error(`${IMAGE_MODEL}: HTTP ${response.status} ${cuerpo.slice(0, 200)}`.trim());
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const base64 = data?.steps?.[0]?.content
        ?.find(content => content?.type === 'image' || content?.mime_type?.startsWith('image/'))?.data;
      if (!base64) throw new Error(`${IMAGE_MODEL}: respuesta sin datos de imagen`);

      const buffer = Buffer.from(base64, 'base64');
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buffer);

      return { base64 };
    },

    // Checkpoint de reanudación para la imagen de referencia neutral: si el
    // archivo ya existe en disco (de una corrida anterior), se relee en vez
    // de regenerarla -- evita gastar una llamada pagada de más.
    async readReferenceIfExists(path) {
      try {
        const buffer = await readFile(path);
        return buffer.toString('base64');
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 2: Escribir los tests**

Mismo estilo que `backend/test/synth.test.js` (fetch mockeado, sin red real):

```js
// backend/test/imageSynth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageSynth } from '../src/images/synth.js';

function fetchFake({ status = 200, base64 = 'aGVsbG8=' } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => 'cuerpo de error simulado',
    json: async () => ({ steps: [{ content: [{ type: 'image', mime_type: 'image/png', data: base64 }] }] }),
  });
}

test('synthImageToFile escribe el archivo y retorna el base64', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'img-'));
  const synth = createImageSynth({ apiKey: 'fake-key', fetchImpl: fetchFake() });
  const outPath = join(dir, 'a.png');
  const result = await synth.synthImageToFile({ prompt: 'un croissant', outPath });
  assert.equal(result.base64, 'aGVsbG8=');
  const bytes = await readFile(outPath);
  assert.equal(bytes.toString('base64'), 'aGVsbG8=');
});

test('synthImageToFile lanza sin apiKey, con status 503', async () => {
  const synth = createImageSynth({ apiKey: undefined, fetchImpl: fetchFake() });
  await assert.rejects(
    () => synth.synthImageToFile({ prompt: 'x', outPath: '/tmp/x.png' }),
    error => error.status === 503,
  );
});

test('synthImageToFile propaga error.status en un HTTP fallido', async () => {
  const synth = createImageSynth({ apiKey: 'k', fetchImpl: fetchFake({ status: 429 }) });
  await assert.rejects(
    () => synth.synthImageToFile({ prompt: 'x', outPath: '/tmp/x.png' }),
    error => error.status === 429,
  );
});

test('readReferenceIfExists retorna null si el archivo no existe', async () => {
  const synth = createImageSynth({ apiKey: 'k' });
  const result = await synth.readReferenceIfExists('/no/existe/nunca.png');
  assert.equal(result, null);
});

test('readReferenceIfExists relee un archivo ya escrito', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'img-'));
  const synth = createImageSynth({ apiKey: 'k', fetchImpl: fetchFake() });
  const outPath = join(dir, 'ref.png');
  await synth.synthImageToFile({ prompt: 'estilo neutro', outPath });
  const base64 = await synth.readReferenceIfExists(outPath);
  assert.equal(base64, 'aGVsbG8=');
});
```

- [ ] **Step 3: Correr los tests**

Run: `cd backend && node --test test/imageSynth.test.js`
Expected: 5/5 PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/images/synth.js backend/test/imageSynth.test.js
git commit -m "feat(backend): add Gemini image generation module"
```

---

### Task 5: Paso de imágenes en `sets/pipeline.js`, con checkpoint de reanudación

**Files:**
- Modify: `backend/src/sets/store.js`
- Modify: `backend/src/sets/pipeline.js`
- Test: `backend/test/store.test.js`
- Test: `backend/test/pipeline.test.js`

**Interfaces:**
- Consumes: `createImageSynth` de Task 4, `categoryById` de Task 1.
- Produces: `createPipeline({dataDir, generator, synth, imageSynth, catalog, config})` — nuevo parámetro `imageSynth` (requerido para sets con `conversation_image`, no usado nunca por sets `SET_STANDARD_36`). `imagesDir(dataDir, setId)` en `store.js`, mismo patrón que `audioDir`. `createSet()` ahora acepta `format: 'SET_STANDARD_40'` y rechaza `pilotes:true` con ese formato.

- [ ] **Step 1: `imagesDir` en `store.js` — test que falla**

```js
// Agregar a backend/test/store.test.js
import { imagesDir } from '../src/sets/store.js';

test('imagesDir construye la ruta de imágenes del set', () => {
  assert.equal(imagesDir('/data', 'set-2026-01-01-abcd'), '/data/sets/set-2026-01-01-abcd/images');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && node --test test/store.test.js`
Expected: FAIL — `imagesDir` no existe.

- [ ] **Step 3: Agregar `imagesDir` y crear el directorio en `writeSet`**

En `backend/src/sets/store.js`, junto a `audioDir`:

```js
export function imagesDir(dataDir, setId) {
  return join(setDir(dataDir, setId), 'images');
}
```

Y en `writeSet`, donde hoy solo crea `audio/`:

```js
export async function writeSet(dataDir, set) {
  const dir = setDir(dataDir, set.id);
  await mkdir(join(dir, 'audio'), { recursive: true });
  await mkdir(join(dir, 'images'), { recursive: true });
  ...
```

(Crear `images/` siempre, aunque el set no tenga `conversation_image` — es barato y evita lógica condicional.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && node --test test/store.test.js`
Expected: PASS, y ningún test existente de `store.test.js` se rompe.

- [ ] **Step 5: Commit parcial**

```bash
git add backend/src/sets/store.js backend/test/store.test.js
git commit -m "feat(backend): add imagesDir and create images/ on every set"
```

- [ ] **Step 6: `pipeline.js` — tests que fallan**

Agregar a `backend/test/pipeline.test.js`, junto a los fakes existentes:

```js
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function catalogoConImagenes() {
  return catalogoAmplio(); // conversation_image no usa este catálogo -- ver imageCategories.js
}

function generadorFakeConversationImage({ contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async generateItem({ sectionType, topicId }) {
      contador.llamadas += 1;
      if (sectionType !== 'conversation_image') {
        return generadorFake().generateItem({ sectionType, topicId });
      }
      return {
        transcript: `dialogue court sur ${topicId}`,
        questions: [{
          prompt: 'p',
          options: [
            { id: 'A', text: 'a', imagePrompt: 'ip-a' },
            { id: 'B', text: 'b', imagePrompt: 'ip-b' },
            { id: 'C', text: 'c', imagePrompt: 'ip-c' },
            { id: 'D', text: 'd', imagePrompt: 'ip-d' },
          ],
          correctId: 'A', feedback: 'f', justification: 'j', justificationScore: 1,
        }],
        provider: 'fake-provider', tentativas: 1,
      };
    },
  };
}

function imageSynthFake({ fallarSiempre = false, fallaDeCuota = false, contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async synthImageToFile({ outPath }) {
      contador.llamadas += 1;
      if (fallarSiempre) {
        const error = new Error(fallaDeCuota ? 'cuota de imagen agotada' : 'imagen no generada');
        if (fallaDeCuota) error.status = 429;
        throw error;
      }
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, 'fake-image-bytes');
      return { base64: 'ZmFrZQ==' };
    },
    async readReferenceIfExists(path) {
      try {
        await readFile(path);
        return 'ZmFrZQ==';
      } catch {
        return null;
      }
    },
  };
}

async function nuevoPipelineConImagenes(opts = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-img-'));
  const generator = opts.generator ?? generadorFakeConversationImage();
  const synth = opts.synth ?? synthFake();
  const imageSynth = opts.imageSynth ?? imageSynthFake();
  const pipeline = createPipeline({ dataDir, generator, synth, imageSynth, catalog: catalogoConImagenes() });
  return { dataDir, pipeline, generator, synth, imageSynth };
}

test('createSet con SET_STANDARD_40 escribe 36 ítems, incluida conversation_image', async () => {
  const { pipeline } = await nuevoPipelineConImagenes();
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  assert.equal(set.format, 'SET_STANDARD_40');
  assert.equal(set.plan.length, 36);
  const convImg = set.plan.filter(p => p.sectionType === 'conversation_image');
  assert.equal(convImg.length, 4);
});

test('createSet rechaza pilotes:true con SET_STANDARD_40', async () => {
  const { pipeline } = await nuevoPipelineConImagenes();
  await assert.rejects(
    () => pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40', pilotes: true }),
    /pilot/i,
  );
});

test('run genera texto, audio y 4 imágenes para conversation_image, y marca pret', async () => {
  const { dataDir, pipeline, imageSynth } = await nuevoPipelineConImagenes();
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  await pipeline.run(set.id);

  const final = await readSet(dataDir, set.id);
  const itemsImagen = final.sections.find(s => s.type === 'conversation_image').items;
  assert.equal(itemsImagen.length, 4);
  for (const item of itemsImagen) {
    assert.equal(item.etat, 'pret');
    assert.equal(item.images.length, 4);
    assert.deepEqual(item.images.map(i => i.id).sort(), ['A', 'B', 'C', 'D']);
    assert.ok(item.images.every(i => i.path === `images/${item.ref}-${i.id}.png`));
  }
  // 4 ítems x (1 referencia + 4 opciones) = 20 llamadas de imagen
  assert.equal(imageSynth.contador.llamadas, 20);
  assert.equal(final.ledger.images.appels, 20);
});

test('reanudación tras fallo de una imagen NO regenera texto ni las imágenes ya listas', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-img-'));
  const generator = generadorFakeConversationImage();
  const synth = synthFake();

  let llamadas = 0;
  const imageSynthQueFallaUnaVez = {
    contador: { llamadas: 0 },
    async synthImageToFile({ outPath }) {
      llamadas += 1;
      this.contador.llamadas += 1;
      // Falla justo en la 3ra llamada de imagen del primer ítem (referencia +
      // A ok, B falla) -- fuerza una reanudación parcial.
      if (llamadas === 3) {
        const error = new Error('fallo puntual de imagen');
        throw error;
      }
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, 'fake-image-bytes');
      return { base64: 'ZmFrZQ==' };
    },
    async readReferenceIfExists(path) {
      try {
        await readFile(path);
        return 'ZmFrZQ==';
      } catch {
        return null;
      }
    },
  };

  const pipeline = createPipeline({
    dataDir, generator, synth, imageSynth: imageSynthQueFallaUnaVez, catalog: catalogoConImagenes(),
  });
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  await pipeline.run(set.id, { maxItems: 1 });

  let intermedio = await readSet(dataDir, set.id);
  const primerItem = intermedio.sections[0].items[0];
  assert.equal(primerItem.etat, 'genere', 'no debe pasar a echoue por un fallo de imagen');
  assert.equal(primerItem.images.length, 1, 'solo A quedó registrada antes del fallo');
  assert.ok(primerItem.transcript, 'el texto ya generado no se pierde');
  const llamadasGeneratorAntes = generator.contador.llamadas;

  await pipeline.run(set.id, { maxItems: 1 });

  const final = await readSet(dataDir, set.id);
  const itemFinal = final.sections[0].items[0];
  assert.equal(itemFinal.etat, 'pret');
  assert.equal(itemFinal.images.length, 4);
  assert.equal(generator.contador.llamadas, llamadasGeneratorAntes, 'no se volvió a llamar al generador de texto');
});

test('esFalloDeCuotaORed en el paso de imágenes detiene la tanda completa', async () => {
  const { pipeline, imageSynth: _unused } = await nuevoPipelineConImagenes({
    imageSynth: imageSynthFake({ fallarSiempre: true, fallaDeCuota: true }),
  });
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  const resultado = await pipeline.run(set.id);
  const itemsImagen = resultado.sections.find(s => s.type === 'conversation_image').items;
  assert.ok(itemsImagen.every(item => item.etat !== 'pret'));
});
```

- [ ] **Step 7: Correr los tests y verificar que fallan**

Run: `cd backend && node --test test/pipeline.test.js`
Expected: FAIL en los tests nuevos — `createSet` rechaza `SET_STANDARD_40` (`FORMATO_SOPORTADO` solo permite `SET_STANDARD_36`), y `createPipeline` no acepta `imageSynth`.

- [ ] **Step 8: Modificar `pipeline.js`**

Reemplazar la constante y el import de topics al inicio del archivo:

```js
import { SET_COMPOSITIONS, SECTION_PRESETS, CONFIG as DEFAULT_CONFIG } from '../examFormat.js';
import { planTopics } from '../topics/planner.js';
import { TOPICS, topicById } from '../topics/catalog.js';
import { categoryById } from '../topics/imageCategories.js';
import { readRecentPlans } from '../topics/history.js';
import { writeSet, readSet, audioDir, imagesDir, nuevoSetId, contarItems } from './store.js';
import { esFalloDeCuotaORed } from '../itemGenerator.js';

const FORMATOS_SOPORTADOS = ['SET_STANDARD_36', 'SET_STANDARD_40'];

const ESTILO_NEUTRO = 'Un boceto simple en blanco y negro, trazo limpio tipo dibujo lineal minimalista, fondo blanco, sin sombreado complejo, sin texto ni letras visibles en la imagen. Estilo de referencia neutro, sin ningún tema concreto todavía -- solo el trazo y el nivel de detalle que deben compartir las siguientes imágenes.';

function promptDeOpcion(imagePrompt) {
  return `${imagePrompt}\n\nEstilo: boceto simple en blanco y negro, trazo limpio tipo dibujo lineal minimalista, fondo blanco, sin sombreado complejo. IMPORTANTE: no incluyas ningún texto, letra ni etiqueta visible dentro del dibujo.`;
}
```

Cambiar la firma de `createPipeline`:

```js
export function createPipeline({ dataDir, generator, synth, imageSynth, catalog = TOPICS, config = DEFAULT_CONFIG }) {
```

Reemplazar el chequeo de formato dentro de `createSet`:

```js
    async createSet({ difficulty = 'B2', format = 'SET_STANDARD_36', pilotes = false, seed } = {}) {
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
```

Dentro de `createSet`, en el `.map` que construye los ítems de cada sección, cambiar la resolución de `sujet` para usar `categoryById` cuando la sección es `conversation_image`:

```js
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
```

Dentro de `run()`, en el Paso 2 (audio), cambiar la condición del `if` y la asignación de `etat`:

```js
          // Paso 2: audio. `&& !item.audio` es necesario porque
          // conversation_image mantiene etat 'genere' incluso después de que
          // el audio ya tenga éxito (esperando las imágenes) -- sin este
          // chequeo, una reanudación regeneraría el audio de nuevo aunque ya
          // esté listo. Para las demás 7 secciones esto es un no-op: su
          // etat pasa a 'pret' en el mismo instante en que item.audio se
          // asigna, así que nunca coexisten etat==='genere' && item.audio.
          if (item.etat === 'genere' && !item.audio) {
            try {
              set.ledger.tts.appels += 1;
              const relativo = `audio/${item.ref}.wav`;
              const { duree_audio_s } = await synth.synthToFile({
                text: item.transcript,
                outPath: join(audioDir(dataDir, set.id), `${item.ref}.wav`),
              });
              item.audio = relativo;
              item.duree_audio_s = duree_audio_s;
              if (sectionType !== 'conversation_image') {
                item.etat = 'pret';
              }
              delete item.erreur;
              await writeSet(dataDir, set);
            } catch (error) {
              set.ledger.tts.echecs += 1;
              item.erreur = error.message;
              await writeSet(dataDir, set);
              if (esFalloDeCuotaORed(error)) {
                trabajados += 1;
                break;
              }
            }
          }

          // Paso 3: imágenes (solo conversation_image) -- corre después del
          // audio, dentro del mismo etat 'genere'. Checkpoint en
          // item.images: cada reanudación solo genera los ids ausentes
          // (incluida la referencia neutral, vía readReferenceIfExists), sin
          // volver a tocar el texto ni las imágenes ya escritas. El ítem
          // pasa a 'pret' solo cuando las 4 imágenes de opción están.
          if (sectionType === 'conversation_image' && item.etat === 'genere' && item.audio) {
            try {
              const refPath = join(imagesDir(dataDir, set.id), `${item.ref}-ref.png`);
              let refBase64 = await imageSynth.readReferenceIfExists(refPath);
              if (!refBase64) {
                set.ledger.images.appels += 1;
                const generada = await imageSynth.synthImageToFile({ prompt: ESTILO_NEUTRO, outPath: refPath });
                refBase64 = generada.base64;
              }

              for (const option of item.questions[0].options) {
                if (item.images.some(img => img.id === option.id)) continue;
                set.ledger.images.appels += 1;
                const relativo = `images/${item.ref}-${option.id}.png`;
                await imageSynth.synthImageToFile({
                  prompt: promptDeOpcion(option.imagePrompt),
                  referenceImageBase64: refBase64,
                  outPath: join(imagesDir(dataDir, set.id), `${item.ref}-${option.id}.png`),
                });
                item.images.push({ id: option.id, path: relativo });
                await writeSet(dataDir, set);
              }

              if (item.images.length === 4) item.etat = 'pret';
              delete item.erreur;
              await writeSet(dataDir, set);
            } catch (error) {
              set.ledger.images.echecs += 1;
              item.erreur = error.message;
              await writeSet(dataDir, set);
              if (esFalloDeCuotaORed(error)) {
                trabajados += 1;
                break;
              }
            }
          }
```

- [ ] **Step 9: Correr los tests y verificar que pasan**

Run: `cd backend && node --test test/pipeline.test.js`
Expected: todos los tests existentes (32/36, SET_STANDARD_36) siguen en PASS sin cambios, más los 5 nuevos.

- [ ] **Step 10: Correr la suite completa del backend**

Run: `cd backend && npm test`
Expected: todos los tests pasan (157 + los agregados en Tasks 1-5).

- [ ] **Step 11: Commit**

```bash
git add backend/src/sets/pipeline.js backend/test/pipeline.test.js
git commit -m "feat(backend): generate conversation_image images with resumable checkpointing"
```

---

### Task 6: Ruta de servido de imágenes y wiring en `server.js`

**Files:**
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `createImageSynth` de Task 4, `imagesDir` de Task 5.
- Produces: `GET /api/sets/:id/images/:archivo`, usado por Task 8/9/10 del frontend.

- [ ] **Step 1: Wire `createImageSynth` y pasarlo a `createPipeline`**

En `backend/server.js`, agregar el import junto a los demás:

```js
import { createImageSynth } from './src/images/synth.js';
```

Y junto a donde se crea `synth`/`pipeline`:

```js
const synth = createSynth({ apiKey: TTS_API_KEY, voices: TTS_VOICES });
const imageSynth = createImageSynth({ apiKey: process.env.GEMINI_API_KEY });
const pipeline = createPipeline({ dataDir: DATA_DIR, generator, synth, imageSynth });
```

- [ ] **Step 2: Agregar la ruta de servido**

En `backend/server.js`, importar `imagesDir` junto a `audioDir`:

```js
import { listSets, readSet, deleteSet, audioDir, imagesDir } from './src/sets/store.js';
```

Y agregar la ruta, justo debajo de la de audio:

```js
app.get('/api/sets/:id/audio/:archivo', (req, res) => {
  if (!/^[\w-]+\.wav$/.test(req.params.archivo)) {
    return res.status(400).json({ error: 'Nombre de audio inválido' });
  }
  res.sendFile(join(audioDir(DATA_DIR, req.params.id), req.params.archivo), error => {
    if (error) res.status(404).json({ error: 'Audio no encontrado' });
  });
});

app.get('/api/sets/:id/images/:archivo', (req, res) => {
  if (!/^[\w-]+\.png$/.test(req.params.archivo)) {
    return res.status(400).json({ error: 'Nombre de imagen inválido' });
  }
  res.sendFile(join(imagesDir(DATA_DIR, req.params.id), req.params.archivo), error => {
    if (error) res.status(404).json({ error: 'Imagen no encontrada' });
  });
});
```

- [ ] **Step 3: Correr la suite completa del backend**

Run: `cd backend && npm test`
Expected: todo sigue en PASS (esta ruta no tiene test unitario dedicado — `server.js` no tiene tests unitarios en el proyecto hoy, se verifica arrancando el servidor y probando manualmente en el Task de verificación final).

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "feat(backend): serve conversation_image files and wire image synth"
```

---

### Task 7: `setCompatibility.js` acepta `SET_STANDARD_40`

**Files:**
- Modify: `frontend/src/exam/setCompatibility.js`
- Test: `frontend/src/exam/setCompatibility.test.js`

**Interfaces:**
- Produces: `checkSetCompatibility(set)` acepta tanto `SET_STANDARD_36` (32 ítems/36 preguntas) como `SET_STANDARD_40` (36 ítems/40 preguntas), sin cambiar la firma ni el shape de retorno `{ok, reason?}`.

- [ ] **Step 1: Modificar el test existente que hoy espera el rechazo de `SET_STANDARD_40`**

En `frontend/src/exam/setCompatibility.test.js`, el test `'rechaza un formato distinto de SET_STANDARD_36'` usa `validSet({ format: 'SET_STANDARD_40' })` — que hoy sigue teniendo 32 ítems/36 preguntas (la composición de `SET_STANDARD_36`), así que ya no es un buen caso de "formato distinto" una vez que `SET_STANDARD_40` es válido. Reemplazarlo por un formato genuinamente inválido, y agregar los tests nuevos para `SET_STANDARD_40`:

```js
test('rechaza un formato desconocido', () => {
  const result = checkSetCompatibility(validSet({ format: 'FORMATO_INVENTADO' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /Formato/);
});

const COMPOSITION_40 = [
  { type: 'conversation_image', items: 4, questionsPerItem: 1 },
  ...COMPOSITION,
];

function validSet40(overrides = {}) {
  const sections = COMPOSITION_40.map(({ type, items, questionsPerItem }) => ({
    type,
    items: Array.from({ length: items }, (_, i) => ({
      ref: `${type}-${i}`,
      questions: Array.from({ length: questionsPerItem }, () => ({ correctId: 'A' })),
    })),
  }));
  return { format: 'SET_STANDARD_40', pilotes: false, sections, ...overrides };
}

test('acepta un set 36/40 sin pilotos', () => {
  assert.deepEqual(checkSetCompatibility(validSet40()), { ok: true });
});

test('rechaza un SET_STANDARD_40 con menos de 36 ítems', () => {
  const set = validSet40();
  set.sections[0].items = set.sections[0].items.slice(0, 1);
  const result = checkSetCompatibility(set);
  assert.equal(result.ok, false);
  assert.match(result.reason, /36/);
});

test('rechaza un SET_STANDARD_40 con pilotos', () => {
  const result = checkSetCompatibility(validSet40({ pilotes: true }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /pilotos/);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd frontend && npm test`
Expected: FAIL — `checkSetCompatibility` rechaza cualquier cosa que no sea `SET_STANDARD_36`.

- [ ] **Step 3: Modificar `setCompatibility.js`**

Reemplazar el archivo completo:

```js
// Un set con pilotes:true agrega 4 ítems extra de una pregunta (ver
// backend/src/topics/planner.js) -- sigue reportando el mismo format y, al
// completarse, statut:'complet', pero trae ítems/preguntas de más. Este
// runner está construido contra un contrato fijo de ítems/preguntas por
// formato en todas partes (progreso de precarga, conteos de sección, layout
// del resumen) y rechaza explícitamente lo que no lo cumpla, en vez de
// generalizarlo a medias -- puntuar ítems piloto le corresponde a una fase
// futura.
const CONTRATOS = {
  SET_STANDARD_36: { items: 32, questions: 36 },
  SET_STANDARD_40: { items: 36, questions: 40 },
};

export function checkSetCompatibility(set) {
  const contrato = CONTRATOS[set.format];
  if (!contrato) {
    return { ok: false, reason: `Formato no soportado por este runner: "${set.format}".` };
  }
  if (set.pilotes) {
    return { ok: false, reason: 'Este set no es compatible con este runner (fue generado con pilotos).' };
  }
  const items = set.sections.flatMap(section => section.items);
  if (items.length !== contrato.items) {
    return { ok: false, reason: `Este set tiene ${items.length} ítems de audio; este runner espera exactamente ${contrato.items}.` };
  }
  const questionCount = items.reduce((total, item) => total + item.questions.length, 0);
  if (questionCount !== contrato.questions) {
    return { ok: false, reason: `Este set tiene ${questionCount} preguntas; este runner espera exactamente ${contrato.questions}.` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd frontend && npm test`
Expected: PASS, todo el resto de la suite frontend (61 tests previos + los nuevos) sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/setCompatibility.js frontend/src/exam/setCompatibility.test.js
git commit -m "feat(exam): accept SET_STANDARD_40 (36/40) in setCompatibility"
```

---

### Task 8: Renderizado de opciones-imagen en `ExamRunner.jsx`

**Files:**
- Modify: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- Consumes: `imageUrls` prop nueva (Map de `` `${ref}-${optionId}` `` -> URL), poblada por Task 9.
- Produces: nada consumido por otras tasks de este plan (Task 10 replica el patrón en `ExamReview.jsx` de forma independiente).

**Nota:** este archivo se verifica solo por navegador (convención ya establecida del proyecto para `ExamRunner.jsx`), no tiene test unitario.

- [ ] **Step 1: Agregar `conversation_image` a `SECTION_LABELS` y `SECTION_INSTRUCTIONS`**

En `frontend/src/exam/ExamRunner.jsx`, agregar la entrada a ambos objetos (líneas ~12-30):

```js
const SECTION_LABELS = {
  conversation_image: 'Conversation (image)',
  annonce_publique: 'Annonces publiques',
  repondeur: 'Répondeur',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Chronique',
  interview: 'Interview',
  reportage: 'Reportage',
  divers: 'Divers',
};

const SECTION_INSTRUCTIONS = {
  conversation_image: 'Vous allez entendre une courte conversation. Écoutez-la et choisissez l\'image qui lui correspond.',
  annonce_publique: 'Vous allez entendre des annonces publiques. Écoutez chacune et répondez à la question.',
  repondeur: 'Vous allez entendre des messages de répondeur téléphonique. Écoutez chacun et répondez à la question.',
  micro_trottoir: 'Vous allez entendre un micro-trottoir : plusieurs personnes donnent leur opinion. Écoutez chacune et répondez à la question.',
  chronique: 'Vous allez entendre une chronique radiophonique. Écoutez-la attentivement et répondez aux questions.',
  interview: 'Vous allez entendre une interview. Écoutez-la attentivement et répondez aux questions.',
  reportage: 'Vous allez entendre un reportage. Écoutez-le attentivement et répondez aux questions.',
  divers: 'Vous allez entendre différents documents sonores. Écoutez chacun et répondez à la question.',
};
```

- [ ] **Step 2: Agregar el prop `imageUrls`**

Cambiar la firma del componente (línea 146):

```js
const ExamRunner = ({ set, audioElRef, audioUrls, imageUrls, onComplete, onAbandon }) => {
```

- [ ] **Step 3: Reemplazar el bloque de renderizado de opciones**

El bloque actual (dentro de la celda derecha de la tabla, dentro de `questions.map`):

```jsx
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
```

Reemplazarlo por:

```jsx
                      {section.type === 'conversation_image' ? (
                        <div className="flex gap-2 flex-wrap">
                          {question.options.map(opt => {
                            const selected = itemAnswers[questionIndex] === opt.id;
                            const url = imageUrls.get(`${item.ref}-${opt.id}`);
                            return (
                              <label
                                key={opt.id}
                                className={`flex-1 min-w-[100px] flex flex-col items-center gap-2 p-3 rounded cursor-pointer ${selected ? 'bg-gray-200' : 'hover:bg-gray-50'}`}
                              >
                                {url
                                  ? <img src={url} alt={`Option ${opt.id}`} className="w-16 h-16 object-contain" />
                                  : <div className="w-16 h-16 bg-gray-100" />}
                                <input
                                  type="radio"
                                  name={`${item.ref}-q${questionIndex}`}
                                  checked={selected}
                                  onChange={() => handleAnswer(questionIndex, opt.id)}
                                  className="h-4 w-4 shrink-0"
                                />
                              </label>
                            );
                          })}
                        </div>
                      ) : useSelect ? (
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
```

(La fila de 4 imágenes usa `flex-wrap` con `min-w-[100px]` para colapsar naturalmente en pantallas angostas, sin necesitar breakpoints explícitos — la columna de audio ya reserva 300px fijos a la izquierda de esta celda.)

- [ ] **Step 4: Correr el build y los tests existentes**

Run: `cd frontend && npm run build && npm test`
Expected: build exitoso, 61+ tests en PASS (este cambio no toca ningún módulo puro testeado).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): render conversation_image options as images with radio below"
```

---

### Task 9: Precarga de imágenes (`imagePreload.js`) y wiring en `ExamMode.jsx`

**Files:**
- Create: `frontend/src/exam/imagePreload.js`
- Modify: `frontend/src/exam/ExamMode.jsx`

**Interfaces:**
- Produces: `preloadSetImages({setId, images, concurrency, signal, onProgress}) -> {urls: Map<key,url>, failedKeys: string[]}`. Consumido por `ExamMode.jsx`, que pasa el `imageUrls` Map resultante como prop a `ExamRunner` (Task 8).

**Nota:** a diferencia de `audioPreload.js`, las imágenes NO usan blob URLs ni `URL.revokeObjectURL` — son archivos pequeños (bocetos 512px) sin la necesidad de gestión de memoria que sí tiene el audio (WAV sin comprimir, ~50-60MB por set completo). El "url" que se cachea es directamente la URL del backend; el navegador cachea el fetch nativamente.

- [ ] **Step 1: Escribir `imagePreload.js`**

Mismo patrón de concurrencia/aborto que `audioPreload.js`, pero usando `Image()` en vez de `Audio()`/blob:

```js
// frontend/src/exam/imagePreload.js
// Precarga de imágenes para conversation_image. A diferencia de
// audioPreload.js, no usa blob URLs -- las imágenes son livianas (bocetos
// 512px) y no necesitan gestión de memoria explícita; "precargar" aquí
// significa solo confirmar que cada imagen decodifica antes de arrancar el
// intento, para que no aparezca un ícono roto a mitad del examen.

const API_BASE = 'http://localhost:3001';
const IMAGE_LOAD_TIMEOUT_MS = 15000;

function imageUrlFor(setId, path) {
  return `${API_BASE}/api/sets/${setId}/${path}`;
}

function confirmLoadable(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const img = new Image();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
    const onLoad = () => finish(resolve);
    const onError = () => finish(reject, new Error('Imagen no decodificable'));
    const timer = setTimeout(
      () => finish(reject, new Error('Tiempo de espera agotado al validar imagen')),
      IMAGE_LOAD_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', onAbort);
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    img.src = url;
  });
}

// `images`: array de { key, path } -- key es `${ref}-${optionId}`, path es
// item.images[i].path (relativo, ej. "images/s1i1-A.png").
export async function preloadSetImages({ setId, images, concurrency = 4, signal, onProgress }) {
  const urls = new Map();
  const failedKeys = [];
  let done = 0;
  let cursor = 0;

  const report = () => onProgress?.({ done, total: images.length, failedKeys: [...failedKeys] });

  async function worker() {
    while (cursor < images.length) {
      const image = images[cursor];
      cursor += 1;
      try {
        const url = imageUrlFor(setId, image.path);
        await confirmLoadable(url, signal);
        urls.set(image.key, url);
      } catch (error) {
        if (signal?.aborted) return;
        failedKeys.push(image.key);
      } finally {
        done += 1;
        report();
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, images.length || 1));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { urls, failedKeys };
}
```

- [ ] **Step 2: Wire en `ExamMode.jsx`**

Agregar el import junto a `preloadSetAudio`:

```js
import { preloadSetAudio, revokeAudioUrls } from './audioPreload';
import { preloadSetImages } from './imagePreload';
```

Agregar el ref, junto a `audioUrlsRef`:

```js
const imageUrlsRef = useRef(new Map());
```

Modificar `runPreload` para correr ambas precargas en paralelo y combinar el progreso:

```js
  const runPreload = useCallback(async (refs, imageEntries, id) => {
    const controller = new AbortController();
    preloadAbortRef.current = controller;
    setPhase('preloading');

    const progresoAudio = { done: 0, total: refs.length };
    const progresoImagenes = { done: 0, total: imageEntries.length };
    const reportarCombinado = () => setPreloadProgress({
      done: progresoAudio.done + progresoImagenes.done,
      total: progresoAudio.total + progresoImagenes.total,
    });

    const [audioResult, imageResult] = await Promise.all([
      preloadSetAudio({
        setId: id,
        refs,
        signal: controller.signal,
        onProgress: p => { progresoAudio.done = p.done; reportarCombinado(); },
      }),
      preloadSetImages({
        setId: id,
        images: imageEntries,
        signal: controller.signal,
        onProgress: p => { progresoImagenes.done = p.done; reportarCombinado(); },
      }),
    ]);

    if (controller.signal.aborted || preloadAbortRef.current !== controller) {
      revokeAudioUrls(audioResult.urls);
      return;
    }
    for (const [ref, url] of audioResult.urls) audioUrlsRef.current.set(ref, url);
    for (const [key, url] of imageResult.urls) imageUrlsRef.current.set(key, url);

    const failed = [...audioResult.failedRefs, ...imageResult.failedKeys];
    if (failed.length > 0) {
      setFailedRefs(failed);
      setPhase('preload-failed');
    } else {
      setFailedRefs([]);
      setPhase('unlock');
    }
  }, []);
```

Modificar `handleSelect` para construir `imageEntries` y pasarlo:

```js
      setSetDetail(data);
      const refs = data.sections.flatMap(section => section.items.map(item => item.ref));
      const imageEntries = data.sections
        .filter(section => section.type === 'conversation_image')
        .flatMap(section => section.items.flatMap(item =>
          (item.images ?? []).map(img => ({ key: `${item.ref}-${img.id}`, path: img.path }))));
      await runPreload(refs, imageEntries, chosenId);
```

Actualizar `handleRetryFailed` (reintenta con listas vacías del otro tipo, ya que `failedRefs` mezcla refs de audio y keys de imagen — simplificación aceptable: un reintento vuelve a intentar TODO, no solo lo fallido, igual que hoy hace con audio):

```js
  const handleRetryFailed = useCallback(() => {
    const refs = setDetail.sections.flatMap(section => section.items.map(item => item.ref));
    const imageEntries = setDetail.sections
      .filter(section => section.type === 'conversation_image')
      .flatMap(section => section.items.flatMap(item =>
        (item.images ?? []).map(img => ({ key: `${item.ref}-${img.id}`, path: img.path }))));
    runPreload(refs, imageEntries, setId);
  }, [runPreload, setDetail, setId]);
```

Hay un único sitio donde se renderiza `<ExamRunner>` (línea ~256-262; `<ExamReview>`, más abajo, es un componente distinto y no necesita este prop — Task 10 le da a las imágenes un tratamiento propio con URLs directas). Agregar el nuevo prop ahí:

```jsx
        <ExamRunner
          set={setDetail}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          imageUrls={imageUrlsRef.current}
          onComplete={handleComplete}
          onAbandon={goToPicker}
        />
```

- [ ] **Step 3: Correr el build y los tests**

Run: `cd frontend && npm run build && npm test`
Expected: build exitoso, todos los tests en PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/exam/imagePreload.js frontend/src/exam/ExamMode.jsx
git commit -m "feat(exam): preload conversation_image images alongside audio"
```

---

### Task 10: Renderizado de imágenes en `ExamReview.jsx`

**Files:**
- Modify: `frontend/src/exam/ExamReview.jsx`

**Interfaces:**
- No consume nada de otras tasks (usa URLs directas del backend, no `imageUrls` de Task 9 — la pantalla de repaso no está sujeta a temporizador, así que no necesita la precarga bloqueante que sí necesita el runner).

**Nota:** verificación solo por navegador, sin test unitario (mismo patrón que el resto de `ExamReview.jsx`).

- [ ] **Step 1: Agregar `API_BASE` y la entrada de `SECTION_LABELS`**

En `frontend/src/exam/ExamReview.jsx`, agregar al inicio del archivo:

```js
const API_BASE = 'http://localhost:3001';

const SECTION_LABELS = {
  conversation_image: 'Conversación (imagen)',
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};
```

- [ ] **Step 2: Reemplazar el bloque de renderizado de opciones**

`ExamReview` recibe `set` como prop, así que cada fila ya tiene `setItem = set.sections[sectionIndex].items[itemIndex]` y `set.id` disponibles. Reemplazar el bloque:

```jsx
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
                                  {stateLabel && (
                                    <span className="ml-2 text-xs font-semibold">{stateLabel}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
```

por:

```jsx
                          <div className={section.type === 'conversation_image' ? 'flex gap-2 flex-wrap' : 'space-y-1'}>
                            {setQuestion.options.map(opt => {
                              const isCorrectOpt = opt.id === question.correctId;
                              const isChosenOpt = opt.id === question.selectedId;
                              let stateLabel = null;
                              let className = section.type === 'conversation_image'
                                ? 'p-2 border rounded flex flex-col items-center gap-1 min-w-[90px]'
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
                                const imagen = setItem.images.find(img => img.id === opt.id);
                                return (
                                  <div key={opt.id} className={className}>
                                    {imagen && (
                                      <img
                                        src={`${API_BASE}/api/sets/${set.id}/${imagen.path}`}
                                        alt={`Option ${opt.id}`}
                                        className="w-16 h-16 object-contain"
                                      />
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
```

`section` ya está en scope en este punto del `.map` (es el parámetro del `model.sections.map((section, sectionIndex) => ...)` exterior).

- [ ] **Step 3: Correr el build y los tests**

Run: `cd frontend && npm run build && npm test`
Expected: build exitoso, todos los tests en PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/exam/ExamReview.jsx
git commit -m "feat(exam): render conversation_image images in the review screen"
```

---

### Task 11: Completar `set-2026-08-06-xwwe` con `conversation_image`

**Files:**
- Create: `backend/scripts/backfill-conversation-image.js`

**Interfaces:**
- Script puntual de una sola vez (no una funcionalidad reusable del producto — decisión ya tomada). No lo consume ninguna otra task.

- [ ] **Step 1: Escribir el script**

```js
// backend/scripts/backfill-conversation-image.js
//
// Script de UNA SOLA VEZ para agregar la sección conversation_image al set
// SET_STANDARD_36 ya existente set-2026-08-06-xwwe, sin regenerarlo. No es
// una funcionalidad reusable del producto -- se corre manualmente, una vez,
// con supervisión directa. Hace backup antes de mutar y verifica que los
// refs nuevos no colisionen con los 32 ítems ya existentes.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPipeline } from '../src/sets/pipeline.js';
import { createItemGenerator } from '../src/itemGenerator.js';
import { createProviders } from '../src/providers/index.js';
import { createSynth } from '../src/audio/synth.js';
import { createImageSynth } from '../src/images/synth.js';
import { SECTION_PRESETS } from '../src/examFormat.js';
import { IMAGE_CATEGORIES } from '../src/topics/imageCategories.js';
import dotenv from 'dotenv';

dotenv.config();

const SET_ID = 'set-2026-08-06-xwwe';
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const SET_JSON = join(DATA_DIR, 'sets', SET_ID, 'set.json');

async function main() {
  const raw = await readFile(SET_JSON, 'utf8');
  const set = JSON.parse(raw);

  if (set.format === 'SET_STANDARD_40') {
    console.log('El set ya es SET_STANDARD_40, nada que hacer.');
    return;
  }
  if (set.sections.some(s => s.type === 'conversation_image')) {
    throw new Error('El set ya tiene una sección conversation_image -- revisar manualmente antes de continuar.');
  }

  // Backup antes de mutar nada.
  await copyFile(SET_JSON, `${SET_JSON}.backup-${Date.now()}`);

  // Append puro: las 7 secciones existentes ya ocupan s1-s7 (ver el plan
  // original de este set), así que la nueva sección usa s8 -- NO se
  // re-deriva el plan bajo el orden canónico de SET_STANDARD_40 (que pondría
  // conversation_image primero como s1, colisionando con annonce_publique).
  const indiceSeccion = set.sections.length; // 7 -> nueva sección en índice 7 (s8)
  const refsExistentes = new Set(set.sections.flatMap(s => s.items.map(i => i.ref)));

  const categoriasElegidas = IMAGE_CATEGORIES.slice(0, 4); // determinista, no hace falta rotación para un backfill de una vez
  const preset = SECTION_PRESETS.conversation_image;
  const nuevosItems = categoriasElegidas.map((categoria, i) => {
    const ref = `s${indiceSeccion + 1}i${i + 1}`;
    if (refsExistentes.has(ref)) {
      throw new Error(`Colisión de ref detectada: "${ref}" ya existe en el set. Abortando sin escribir nada.`);
    }
    return {
      ref,
      etat: 'en_attente',
      topicId: categoria.id,
      sujet: categoria.label,
      posture: undefined,
      pilote: false,
      images: [],
    };
  });

  set.sections.push({
    type: 'conversation_image',
    timing: { avant: preset.avant, apres: preset.apres },
    lectures: preset.lectures,
    items: nuevosItems,
  });
  set.format = 'SET_STANDARD_40';
  set.plan.unshift(...nuevosItems.map(item => ({
    ref: item.ref, sectionType: 'conversation_image', topicId: item.topicId, pilote: false,
  })));
  if (!set.ledger.images) set.ledger.images = { appels: 0, echecs: 0 };
  set.statut = 'partial';

  await writeFile(SET_JSON, JSON.stringify(set, null, 2), 'utf8');
  console.log(`Sección conversation_image agregada (${nuevosItems.map(i => i.ref).join(', ')}). Corriendo el pipeline...`);

  const providers = createProviders();
  const generator = createItemGenerator(providers);
  const synth = createSynth({ apiKey: process.env.TTS_GEMINI_API_KEY || process.env.GEMINI_API_KEY, voices: ['Kore', 'Charon', 'Puck'] });
  const imageSynth = createImageSynth({ apiKey: process.env.GEMINI_API_KEY });
  const pipeline = createPipeline({ dataDir: DATA_DIR, generator, synth, imageSynth });

  const resultado = await pipeline.run(SET_ID);
  console.log(`Estado final: ${resultado.statut}`);
}

main().catch(error => {
  console.error('Backfill falló:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Correr el script (requiere `backend/.env` con `GEMINI_API_KEY`)**

Run: `cd backend && node scripts/backfill-conversation-image.js`
Expected: imprime los 4 refs nuevos (`s8i1`..`s8i4`), corre el pipeline, termina con `Estado final: complet`.

- [ ] **Step 3: Verificación manual — vara de calidad (obligatoria, no delegable)**

Abrir `backend/data/sets/set-2026-08-06-xwwe/set.json`, confirmar `format: "SET_STANDARD_40"` y 4 ítems `conversation_image` en `pret`. Para cada uno, abrir sus 4 imágenes (`backend/data/sets/set-2026-08-06-xwwe/images/s8i*-{A,B,C,D}.png`) y aplicar la vara de calidad: mirar las 4 sin escuchar el audio — si se puede descartar alguna a simple vista, el ítem está roto y hay que regenerarlo manualmente (borrar sus `images: []` y volver a correr el script, que por diseño solo regenera lo que falte).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/backfill-conversation-image.js
git commit -m "chore: add one-off backfill script for set-2026-08-06-xwwe"
```

(El propio `set.json`/`images/` mutados están en `backend/data/`, gitignored — no se commitean.)

---

### Task 12: Documentación (`CLAUDE.md`)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Actualizar la sección "Exam-set generation"**

Agregar un párrafo después de la descripción de `topics/planner.js`, documentando: `conversation_image` como 8va sección con su propio catálogo de categorías (`imageCategories.js`, rotación dedicada excluyendo el set inmediatamente anterior — no el `historyWindow` general), su constructor de prompt bespoke (no reutiliza `reglasComunes`/`opcionesFijas`, dificultad forzada a B1), el paso de generación de imágenes en el pipeline (5 llamadas por ítem: referencia neutral + 4 opciones, checkpoint en `item.images`, `item.etat` se mantiene en `'genere'` hasta que audio E imágenes estén listos), y que `SET_STANDARD_40` ya es generable.

- [ ] **Step 2: Actualizar la sección "Frontend architecture"**

Documentar: `ExamRunner.jsx`/`ExamReview.jsx` renderizan las opciones de `conversation_image` como imágenes (radio debajo, sin texto), `imagePreload.js` precarga imágenes sin blob URLs (a diferencia de `audioPreload.js`), `setCompatibility.js` ahora acepta dos contratos (32/36 y 36/40).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document conversation_image section and SET_STANDARD_40"
```

---

## Verificación manual final (obligatoria, no delegable)

- [ ] Generar un `SET_STANDARD_40` completo vía `POST /api/sets/generate` con `{"format": "SET_STANDARD_40"}` y aplicar la vara de calidad de 30 segundos por ítem de `conversation_image` antes de darlo por bueno.
- [ ] Correr ese set completo en el runner: confirmar que las 4 imágenes se ven, que la selección funciona, que no hay parpadeo/imagen rota durante `preloading`.
- [ ] Confirmar que el `/699` y las pestañas de progreso escalan correctamente a 40 preguntas / 36 ítems.
- [ ] Correr `set-2026-08-06-xwwe` (ya completado en Task 11) de principio a fin, y revisar el repaso post-examen (`ExamReview`) para las 4 preguntas de `conversation_image`.
