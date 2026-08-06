# Paridad visual del Runner de Modo Examen — Design Spec

## Contexto

Tras la primera prueba manual completa del pipeline de Modo Examen (generación → examen → resumen → revisión), no se encontraron errores funcionales, pero sí una brecha de fidelidad visual/UX frente al simulador oficial TEF-CO (`lefrancaisdesaffaires.fr/documents/Tutoriel-TEF-CO/story.html`), evaluado contra capturas de referencia del usuario. Este spec cubre exclusivamente el **runner del examen** (`frontend/src/exam/ExamRunner.jsx` + `examMachine.js`), no toca generación de contenido ni la pantalla de revisión post-examen (`ExamReview.jsx`), que ya está implementada y aprobada.

**Restricción explícita e innegociable:** el examen real no tiene navegación libre (atrás/adelante) ni corrección durante el examen. Cualquier elemento del simulador oficial que dependa de eso (pestañas clicables, botones de navegación) se adapta a una versión no interactiva o se descarta. La corrección sigue existiendo únicamente en `ExamReview.jsx`, al final, sin cambios.

## Alcance

1. Pantalla de instrucciones + tiempos, automática, al inicio de cada una de las 7 secciones (incluida la primera, que hoy no tiene ninguna pantalla previa).
2. Indicador de progreso tipo pestañas, uno por ítem de audio (32 en total), puramente visual.
3. Barra de progreso de audio visible, sin scrubbing.
4. Opciones de respuesta como radio buttons reales + fila resaltada, en las secciones que no usan el dropdown `OptionSelect`.

Fuera de alcance: generación de contenido, `ExamReview.jsx`, `ExamSummary.jsx`, cualquier forma de navegación libre o corrección en vivo.

## 1. Pantalla de instrucciones de sección

### Reemplaza la fase `section-transition` por `section-intro`

Cambio de comportamiento: hoy `section-transition` es una pantalla de cortesía con clic manual ("Continuar"), sin temporizador, y no existe antes de la primera sección. Pasa a ser `section-intro`: automática (15 segundos fijos, iguales para las 7 secciones), y se agrega también antes de la sección 1.

**Mecánica en `examMachine.js` (reescribe, no agrega, el manejo de transición de sección):**

- `createInitialState()` arranca en `{ sectionIndex: 0, itemIndex: 0, phase: 'section-intro' }` (antes arrancaba en `'avant'`).
- `advance(set, state)`, en la rama "último ítem de la sección, no es la última sección", pasa a devolver `{ ...state, sectionIndex: sectionIndex + 1, itemIndex: 0, phase: 'section-intro' }` — el incremento de `sectionIndex` ocurre en el mismo paso que entrar a `section-intro` (antes, el incremento ocurría solo al hacer clic en "Continuar", vía `startNextSection`). Con este cambio, `state.sectionIndex` en fase `section-intro` **ya apunta a la sección que se está introduciendo** (no a la anterior +1 como hoy).
- El caso `TIMER_EXPIRED` gana una rama: `if (state.phase === 'section-intro') return { ...state, phase: 'avant' };`.
- Se eliminan de `examMachine.js`: la función `startNextSection`, el evento `SECTION_CONTINUE` y toda referencia a `'section-transition'`.
- `ANSWERABLE_PHASES` no cambia (sigue sin incluir la fase de intro, no se puede responder ahí).

**Mecánica en `ExamRunner.jsx`:**

- El efecto que ancla el deadline de `avant` (hoy solo encadena desde `lastApresPhaseTimingRef`) se generaliza para también encadenar desde el deadline de `section-intro` cuando la fase anterior fue esa: el mismo patrón zero-gap que ya existe entre `apres` → `avant` de ítems consecutivos aplica ahora también entre `section-intro` → `avant` del primer ítem de la sección. `section-intro` en sí arranca siempre fresco (`startPhase(15)`), nunca encadenado — es un límite natural entre secciones.
- Nuevo bloque de render para `phase === 'section-intro'` (reemplaza al bloque actual de `'section-transition'`): usa `set.sections[state.sectionIndex]` directamente (ya no `+1`, por el cambio de mecánica arriba). Muestra:
  - Nombre de la sección + cantidad de preguntas (lo que ya existe hoy, sin cambios).
  - Texto de instrucciones (nuevo, ver tabla abajo).
  - Línea de tiempos: `Vous avez {avant} secondes avant et {apres} secondes après chaque document sonore pour lire et répondre à la question.` usando `section.timing.avant`/`.apres` (dato ya persistido en el set, sin cambios de backend).
  - Cuenta regresiva visible de los 15 segundos (mismo estilo mono/rojo que ya usan `avant`/`apres`).
  - Botón "Abandonar" (se mantiene). El botón "Continuar" se elimina — ya no hace falta, la fase avanza sola.

**Idioma del texto de instrucciones — excepción deliberada a la regla general:** el texto de instrucciones (`Vous allez entendre...` y la línea de tiempos) va en **francés**, no en español, a propósito: imita el texto real del examen oficial (ver capturas de referencia, íntegramente en francés incluyendo metatexto como "Le jour du test..."). El resto del chrome de la pantalla (botón "Abandonar", conteo "X preguntas") se mantiene en español, sin cambios — la regla general de CLAUDE.md ("UI text... en español; contenido de examen generado... en francés") se extiende aquí a este texto instruccional porque es, en espíritu, contenido del examen (imitación fiel del original), no chrome de la aplicación.

**Copy de instrucciones por sección** (constante nueva, p. ej. `SECTION_INSTRUCTIONS` en `ExamRunner.jsx`, una entrada por cada una de las 7 `GENERABLE_SECTIONS`):

| Sección | Texto |
|---|---|
| `annonce_publique` | Vous allez entendre des annonces publiques. Écoutez chacune et répondez à la question. |
| `repondeur` | Vous allez entendre des messages de répondeur téléphonique. Écoutez chacun et répondez à la question. |
| `micro_trottoir` | Vous allez entendre un micro-trottoir : plusieurs personnes donnent leur opinion. Écoutez chacune et répondez à la question. |
| `chronique` | Vous allez entendre une chronique radiophonique. Écoutez-la attentivement et répondez aux questions. |
| `interview` | Vous allez entendre une interview. Écoutez-la attentivement et répondez aux questions. |
| `reportage` | Vous allez entendre un reportage. Écoutez-le attentivement et répondez aux questions. |
| `divers` | Vous allez entendre différents documents sonores. Écoutez chacun et répondez à la question. |

## 2. Indicador de progreso tipo pestañas

32 marcadores no interactivos (uno por ítem de audio — un ítem con 2 preguntas, como en `interview`/`reportage`, sigue contando como 1 marcador, igual que en el oficial: la captura de referencia "Écran 19" muestra 2 preguntas bajo un solo ítem de audio). Reemplaza el texto plano `"Sección · ítem X/Y"` actual, que se conserva como texto complementario junto a la franja (no se pierde esa información, solo se agrega la franja visual encima).

**Nuevo módulo puro, testeado:** `frontend/src/exam/examProgress.js`, con una función `buildProgressTabs(set, state) -> Array<{ status: 'completed' | 'current' | 'pending' }>` (32 entradas, orden = orden del plan). `status` se deriva de comparar cada ítem contra `state.sectionIndex`/`state.itemIndex`: anteriores → `'completed'`, el actual → `'current'`, posteriores → `'pending'`. Sigue el mismo patrón de módulo puro + test unitario que `examTiming.js`/`setCompatibility.js`/etc. — nada de DOM, nada de reloj.

`ExamRunner.jsx` renderiza `buildProgressTabs(set, state)` como una franja de 32 segmentos (azul lleno / resaltado / gris), sin `onClick`, sin `<button>` — un `<div>`/`<span>` por segmento, ya que no son interactivos.

## 3. Barra de progreso de audio (sin scrubbing)

El `<audio>` compartido (`audioElRef`, hoy `display: none` durante todo el examen) deja de estar oculto específicamente durante las fases `audio-pending`/`audio-playing` — el resto del tiempo (`avant`/`apres`/`section-intro`) se mantiene oculto, sin cambios en su rol dentro del reducer.

Barra **custom**, no los controles nativos del navegador (que sí permiten arrastrar): un contenedor con dos `<div>` (fondo + relleno proporcional), sin listeners de click/drag, más texto `MM:SS / MM:SS`.

- Total: `item.duree_audio_s` (ya persistido por ítem en el set, no hace falta esperar metadata del audio).
- Transcurrido: se agrega un listener `timeupdate` al `<audio>` compartido, junto al `ended` que ya existe en el efecto persistente de `ExamRunner.jsx` (mismo `useEffect`, mismo ciclo de vida) — actualiza un nuevo `currentTimeState` local vía `setState`, sin interacción con el reducer (es puramente de presentación, no afecta la máquina de estados).
- Antes de que arranque la reproducción real (`audio-pending`), la barra se muestra en `00:00 / MM:SS` (relleno 0%).

## 4. Opciones como radio buttons + fila resaltada

Solo afecta las secciones que hoy renderizan botones de opción directos: `annonce_publique`, `repondeur`, `micro_trottoir`, `chronique`, `divers` (todas menos `interview`/`reportage`, que ya usan `OptionSelect` — un dropdown, que coincide con el estilo del oficial para esas secciones según la captura de referencia "Écran 19", así que `OptionSelect` no se toca).

Cambio puramente visual dentro del bloque `question.options.map(...)` de `ExamRunner.jsx`:
- Cada opción pasa a ser una fila con un `<input type="radio" name={...} checked={...} onChange={...}>` real (agrupado por pregunta vía `name`) en vez de un `<button>` con `ring-2`.
- La fila seleccionada usa fondo gris/sombreado (`bg-gray-100` o similar), imitando la captura "Écran 16" del oficial, en vez del `bg-blue-50 ring-2 ring-blue-200` actual.
- El manejador `handleAnswer` no cambia de firma ni de comportamiento — solo cambia qué elemento dispara el evento (`onChange` del radio en vez de `onClick` del botón).

## Testing

- `examMachine.js`: los tests existentes que cubren `SECTION_CONTINUE`/`section-transition`/`startNextSection` se reescriben para `section-intro` + `TIMER_EXPIRED`. Nuevo caso: el estado inicial (`createInitialState()`) arranca en `section-intro`, no en `avant`. Nuevo caso: `advance()` en el último ítem de una sección no final incrementa `sectionIndex` en el mismo paso (no en un evento separado).
- `examProgress.js` (nuevo): función pura, tests directos sobre `buildProgressTabs` — completados antes del ítem actual, `current` en la posición exacta, `pending` después, con secciones de distinto tamaño (para probar que el índice global 1-32 se calcula bien a través de los límites de sección).
- `examTiming.js`: sin cambios de código, pero se agrega cobertura de uso para `section-intro` si el nuevo encadenamiento zero-gap introduce algún caso no cubierto por los tests genéricos existentes de `chainDeadline`.
- Barra de audio, pestañas visuales y radio buttons: sin test automatizado (son presentación pura) — verificación por code review + build, igual que el resto de `ExamRunner.jsx` hoy. Sin navegador de pruebas en este entorno; se recomienda una pasada manual del usuario antes de mergear, como ya se hizo para `ExamReview.jsx`.

## Documentación

`CLAUDE.md` (sección "Frontend architecture") se actualiza para reflejar: la fase `section-intro` (y la eliminación de `section-transition`), el nuevo módulo puro `examProgress.js` en la lista de módulos testeados, y la barra de audio visible durante `audio-pending`/`audio-playing`.
