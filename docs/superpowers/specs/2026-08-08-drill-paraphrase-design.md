# Fase 2, Parte B — Modo "Drill Paraphrase" — Design Spec

## Contexto

TEFAQ simulator. Tercera y última pieza de la Fase 2 (tras [[Parte A]], `docs/superpowers/specs/2026-08-08-reformulation-rule-design.md`, y [[Parte C1]], `docs/superpowers/specs/2026-08-08-reformulation-review-bridge-design.md`, ambas ya en producción). Objetivo del pedido original: "repetición concentrada del salto oral→escrito, sin la fatiga de un examen completo" — ráfagas cortas de ítems muy breves, con la regla de reformulación aplicada de forma más estricta, sin feedback entre ítems, todo el feedback al final en la vista de revisión (que ya existe gracias a C1).

**Restricción de diseño explícita del usuario, no negociable:** este nuevo módulo debe ser **totalmente independiente** de Modo Examen. Puede reutilizar lógica, pero no debe existir relación alguna a nivel de UI/componentes. "Modo Examen es la simulación REAL del examen, este nuevo módulo es más para realizar prácticas y fortalecer otros aspectos." Esto es una extensión explícita del patrón ya documentado en CLAUDE.md para entrenamiento-vs-examen ("no shared state, no shared audio-control UI"), ahora aplicado también entre drill-vs-examen.

## Alcance

Nuevo modo `Drill` (junto a Entrenamiento y Examen): ráfagas de **12 ítems** de 15-40 palabras (1-2 frases), 1 pregunta/4 opciones cada uno, ritmo lockstep 5s antes / audio (una sola escucha) / 10s después / avance automático, sin pantalla de instrucciones por sección, sin pantalla de resumen — de `running` se pasa directo a la revisión. Reutiliza, como **funciones puras importadas únicamente**, la máquina de estados (`exam/examMachine.js`), el manejo de tiempos (`exam/examTiming.js`), el modelo de revisión (`exam/reviewModel.js`) y el resaltado de justificaciones (`exam/highlightSegments.js`) — nunca los componentes React de `exam/` (`ExamRunner.jsx`, `ExamReview.jsx`, `ExamMode.jsx`, `SetPicker.jsx`, `ExamSummary.jsx`), que quedan completamente intocados por este trabajo.

El backend de generación de contenido (`pipeline.js`, `examFormat.js`, `prompt/`, `validation/`) **sí se extiende directamente** — es infraestructura genérica ya compartida por las 8 secciones existentes, no es "código de Modo Examen"; no aplica la restricción de independencia.

Tamaño de ráfaga fijo en esta versión (12 ítems, ~8-10 min) — "configurable" queda para una iteración futura si hace falta, para no generalizar `SET_COMPOSITIONS` a composiciones calculadas dinámicamente sin necesidad real todavía.

## 1. Backend — nueva sección `drill_paraphrase`

**Preset nuevo** en `SECTION_PRESETS` (`backend/src/examFormat.js`):

```js
drill_paraphrase: { bloc: 0, questions: 12, avant: 5, apres: 10, questionsPerAudio: 1, minWords: 15, maxWords: 40, lectures: 1 },
```

`bloc: 0` marca explícitamente que no pertenece a ninguno de los 4 blocs reales del examen (es un valor nominal, sin efecto funcional ya que el drill nunca comparte pantalla con secciones de otros blocs). Se agrega `'drill_paraphrase'` a `GENERABLE_SECTIONS` (usa la ruta genérica texto→audio existente, no un caso especial como `conversation_image`).

**Composición nueva:** `SET_COMPOSITIONS.SET_DRILL_PARAPHRASE = ['drill_paraphrase']` — un único elemento, no 12 repetidos: `sectionDemand()` construye un mapa por `Object.fromEntries` keyado por tipo de sección, así que tipos repetidos colapsarían a una sola entrada. Con `questions: 12` y `questionsPerAudio: 1` en el preset, `itemsPerSection('drill_paraphrase')` ya da 12 — el array de composición de un solo elemento produce exactamente una "sección" con 12 ítems, que es la forma correcta.

**Constructor de prompt dedicado**, `backend/src/prompt/sections/drill_paraphrase.js`: escenario propio y breve (mensajes/anuncios cotidianos muy cortos), fuerza `minWords: 15, maxWords: 40` sin importar lo que llegue en `ctx` (mismo patrón que `conversation_image` fuerza `difficulty: 'B1'`). Usa `reglasComunes`/`esquemaJson` de `common.js` igual que las 6 secciones no-`opcionesFijas`, heredando automáticamente la regla de reformulación reforzada de la Parte A (nominalización, trampa literal, campo `reformulationType`).

**Umbral más estricto, solo para esta sección.** `CONFIG.reformulationOverlapThreshold` sigue en `0.75` para las 6 secciones existentes; `drill_paraphrase` usa `0.5`. Mecanismo: `validarPregunta` (`backend/src/validation/index.js`), que ya recibe `sectionType`, arma un config efectivo antes de llamar a `checkReformulation` — sin tocar `checkReformulation` en sí:

```js
const configEfectivo = sectionType === 'drill_paraphrase'
  ? { ...config, reformulationOverlapThreshold: config.drillReformulationOverlapThreshold }
  : config;
checkReformulation(question, transcript, configEfectivo);
```

`CONFIG.drillReformulationOverlapThreshold = 0.5` nuevo, junto a los demás valores de calibración en `examFormat.js`.

**Filtro opcional por tipo de transformación.** Si se pide una ráfaga centrada en `nominalisation` (o `synonyme`/`restructuration`), el parámetro llega hasta `buildSectionPrompt`/el constructor de `drill_paraphrase`, que inyecta una instrucción explícita exigiendo esa transformación específica (mismo patrón que `micro_trottoir` fuerza una postura exacta) en vez de dejarlo a elección libre del modelo — evita desperdiciar llamadas regenerando hasta que el modelo elija el tipo pedido por azar. Igual que `validarMicroTrottoir` verifica que la postura generada coincide con la pedida, `checkReformulation` gana un 5º parámetro opcional `expectedType`: si se pasó y `question.reformulationType !== expectedType`, rechaza y regenera. Sin filtro (`expectedType` ausente), el comportamiento es exactamente el actual.

**Temas.** Se etiqueta con `drill_paraphrase` un subconjunto de los temas ya existentes en `topics/catalog.js` que hoy sirven a `divers` (el pool más amplio, ~60 temas) — sin catálogo nuevo. `planner.js`/`history.js` no necesitan cambios: ya operan genéricamente por tipo de sección, y una demanda de una sola sección no rompe la lógica "escasez primero" (una lista de un elemento se ordena trivialmente). La ventana anti-repetición compartida entre drills y exámenes reales que usen los mismos temas es el comportamiento correcto, no un efecto secundario a evitar.

**Pipeline.** `sets/pipeline.js` agrega `'SET_DRILL_PARAPHRASE'` a `FORMATOS_SOPORTADOS` (una línea). El guard específico de pilotos de `SET_STANDARD_40` no aplica (drill nunca usa pilotos). `createSet()`/`run()` ya son genéricos sobre la forma de la composición, sin cambios adicionales.

## 2. Frontend — módulo `drill/` totalmente independiente

Nuevo directorio hermano `frontend/src/drill/`, sin ninguna modificación a `frontend/src/exam/`:

- **`drill/DrillMode.jsx`** — orquestador propio con su propia máquina de fases: `picker → loading → preloading → unlock → running → review`. Sin pantalla de resumen (pasa directo de `running` a `review`, coherente con que el pedido original nunca menciona un puntaje para el drill). Sin relación de código con `ExamMode.jsx`.
- **`drill/DrillPicker.jsx`** — lista únicamente sets de formato `SET_DRILL_PARAPHRASE` (vía `GET /api/sets`, filtrado por `format`). Incluye el botón **"Generar nuevo drill"** — primera UI de generación bajo demanda en el proyecto — con un selector opcional de tipo (cualquiera/nominalisation/synonyme/restructuration) que dispara `POST /api/sets/generate` con el `format` y el filtro, y luego espera a que el set quede `complet`.
- **`drill/generateDrillSet.js`** — única pieza de lógica pura genuinamente nueva de esta fase: `generateDrillSet({ typeFilter, fetchImpl, pollIntervalMs })` hace el POST inicial y luego hace polling de `GET /api/sets/:id/status` hasta `complet` o error, devolviendo una promesa. Inyectable (`fetchImpl`) para ser testeable sin red real. Gana su propio `drill/generateDrillSet.test.js`.
- **`drill/drillSetCompatibility.js`** — pequeño chequeo propio (no importa ni extiende `exam/setCompatibility.js`, que es de Modo Examen): confirma `set.format === 'SET_DRILL_PARAPHRASE'` y el conteo de ítems/preguntas (12/12). Contrato propio, sin acoplar el de Modo Examen al de drill.
- **`drill/DrillRunner.jsx`** — runner propio, deliberadamente más simple que `ExamRunner.jsx`: nunca hay `conversation_image` (sin manejo de imágenes/zoom), nunca hay pantalla de instrucciones por sección (nunca existió esa noción acá, no hace falta "saltarla"), un progreso simple (ítem N/12, sin pestañas por sección ya que solo hay una). Importa como funciones puras el reducer de `exam/examMachine.js` y las utilidades de `exam/examTiming.js` — exactamente lo que pide el texto original ("reutiliza la máquina de estados... no dupliques la lógica de timers"). Cero import de componentes de `exam/`.
- **`drill/DrillReview.jsx`** — vista de revisión propia, con layout plano (12 ítems, sin agrupar por secciones ya que solo hay una). Importa como funciones puras `buildReviewModel` (`exam/reviewModel.js`) y `buildHighlightSegments` (`exam/highlightSegments.js`) — hereda gratis el puente de reformulación de la Parte C1 (el modelo ya decide `reformulation`/`selectedLiteralTrap` por pregunta, sin lógica adicional que escribir). Cero import de `ExamReview.jsx`.
- **`App.jsx`** gana un tercer modo (`'training' | 'exam' | 'drill'`) con su propia rama `<DrillMode/>`, estructuralmente paralela a `'exam'` pero sin árbol de componentes compartido.

## Testing

- Backend: `examFormat.test.js` gana casos para `SET_DRILL_PARAPHRASE` (composición de un solo tipo, `sectionDemand`/`totalQuestions` dan 12). `prompt.test.js` gana casos para el constructor `drill_paraphrase` (fuerza 15-40 palabras pase lo que pase en `ctx`, inyecta la instrucción de tipo cuando se pide un filtro). `reformulation.test.js`/`validation/index.test.js` ganan casos para el umbral 0.5 aplicado solo a `drill_paraphrase` (y 0.75 sin cambios para las demás secciones) y para `checkReformulation`'s nuevo `expectedType` (acepta cuando coincide, rechaza cuando no, no-op cuando no se pasa). `pipeline.test.js` confirma que `SET_DRILL_PARAPHRASE` es aceptado end-to-end por `createSet()`.
- Frontend: `drill/` reutiliza toda la lógica pura ya testeada en `exam/` — nada que re-testear ahí. `drill/generateDrillSet.test.js` cubre el polling (éxito, timeout/error, cancelación). `drill/drillSetCompatibility.js` gana su propio test siguiendo el patrón de `exam/setCompatibility.test.js`. Los componentes (`DrillMode`/`DrillPicker`/`DrillRunner`/`DrillReview`) son, como sus análogos en `exam/`, verificados solo por navegador — con la misma limitación ya documentada de esta sesión (sin herramienta de automatización de navegador disponible, requiere click-through manual antes de dar la fase por cerrada).
