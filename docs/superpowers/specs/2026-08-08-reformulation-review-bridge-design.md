# Fase 2, Parte C1 — Puente de reformulación en la revisión — Design Spec

## Contexto

TEFAQ simulator. Continuación de la Fase 2 tras [[Parte A]] (`docs/superpowers/specs/2026-08-08-reformulation-rule-design.md`), ya implementada y en producción: cada pregunta generada en las 6 secciones de opciones no fijas (`annonce_publique`, `repondeur`, `chronique`, `interview`, `reportage`, `divers`) trae ahora `question.reformulation = { extrait_audio, option_correcte, type }`, describiendo cómo la respuesta correcta reformula el audio en vez de copiarlo.

La Parte C del pedido original tenía tres piezas independientes (puente de reformulación en revisión, cosecha de vocabulario, nueva estadística de historial). Al explorar el código se confirmó que las otras dos requieren subsistemas nuevos que hoy no existen en absoluto: no hay ninguna capa de persistencia en el frontend (`localStorage`/`sessionStorage`: cero usos en todo `frontend/src`), ni ningún backend de almacenamiento más allá de los sets generados, ni existe hoy ninguna "curva de progreso" o historial cruzado entre sesiones a la que agregarle una estadística nueva. Por eso esta fase se decompone: este documento cubre únicamente **C1, el puente de reformulación**, que es autocontenido y no requiere inventar persistencia nueva. La cosecha de vocabulario y la estadística de historial serán specs separados y posteriores.

## Alcance

Extiende `frontend/src/exam/ExamReview.jsx` (pantalla de repaso post-examen sin límite de tiempo, usada hoy para el examen completo y reutilizable a futuro por el drill de la Parte B) para mostrar, en cada **pregunta fallada** de una sección que tenga metadata `reformulation`, un bloque comparativo: el fragmento literal del audio, la respuesta correcta con su tipo de transformación en español, y — si la opción elegida fue precisamente la trampa de reciclaje literal — una advertencia explícita.

**Excluido de este alcance** (degradan con elegancia, sin romper nada, ver sección de compatibilidad):
- `micro_trottoir` y `conversation_image`: nunca tienen `reformulation` (excluidos también en la Parte A).
- Sets generados antes de la Parte A: no tienen el campo `reformulation` en absoluto.
- Preguntas correctas: el puente solo aplica a preguntas falladas (incluye "sin respuesta", que ya cuenta como fallada en `reviewModel.js`).

## 1. Extensión del backend: `trap_option_ids`

`checkReformulation` (`backend/src/validation/reformulation.js`) ya calcula, para decidir aprobar/rechazar el ítem, qué opciones (además de la correcta) comparten suficientes palabras de contenido literal con el transcript completo — hoy ese cálculo se colapsa en un booleano (`hayTrampaLiteral`) usado solo para el pass/fail, sin registrar cuáles opciones calificaron.

Cambio: en vez de `.some(...)`, calcular la lista completa de ids que califican (normalmente será 1, pero puede haber más de un distractor con suficiente reciclaje literal — capturarlos todos es más preciso que quedarse solo con "el primero encontrado"). El umbral de rechazo no cambia: sigue siendo "rechaza si la lista queda vacía" (`trapOptionIds.length === 0`), exactamente la misma condición que hoy expresa `!hayTrampaLiteral`.

Al pasar la validación, la metadata que ya se adjunta gana un campo:

```js
question.reformulation = {
  extrait_audio: question.justification,
  option_correcte: correctOption.text,
  type: question.reformulationType,
  trap_option_ids: trapOptionIds, // ej. ["C"] — nuevo
};
```

Esto no cambia ningún umbral, no re-abre ninguna decisión de calibración de la Parte A, y no afecta a ningún set ya generado (los que ya existen simplemente no tienen `trap_option_ids`, ver compatibilidad).

## 2. Renderizado en `ExamReview.jsx`

Dentro del bloque por pregunta ya existente (`ExamReview.jsx`, dentro del `.map` de `item.questions`, después de la lista de opciones y antes del párrafo de `feedback`, hoy alrededor de la línea 265), se agrega un bloque condicionado a `!question.isCorrect && setQuestion.reformulation`:

- **"Lo que dice el audio:"** — cita textual de `setQuestion.reformulation.extrait_audio`.
- **"Respuesta correcta ({tipo en español}):"** — `setQuestion.reformulation.option_correcte`, con el tipo traducido vía una constante nueva `REFORMULATION_TYPE_LABELS` (`nominalisation` → "Nominalización", `synonyme` → "Sinónimo", `restructuration` → "Reestructuración"), siguiendo el mismo patrón ya usado por `SECTION_LABELS` en el mismo archivo.
- Si `setQuestion.reformulation.trap_option_ids` (tratado como `[]` si viene ausente — ver compatibilidad) incluye `question.selectedId`: una línea de advertencia explícita, ej. *"Elegiste una opción que reutilizaba palabras literales del audio, pero con un sentido distinto."*

Todo el texto del puente es en español, coherente con el resto de `ExamReview.jsx` (a diferencia de `ExamRunner.jsx`, cuyo chrome es en francés durante el examen cronometrado) — el fragmento de audio y el texto de la opción correcta se muestran tal cual (en francés, porque son contenido real del examen), pero las etiquetas y explicaciones que los rodean son en español.

Esta lógica queda como JSX inline dentro de `ExamReview.jsx`, sin extraer un módulo puro nuevo ni tocar `reviewModel.js`: el chequeo (`!isCorrect`, presencia de `reformulation`, pertenencia a `trap_option_ids`) es una comparación trivial sobre datos que el componente ya tiene disponibles (`question` del modelo de repaso, `setQuestion` del set crudo), y sigue el mismo patrón ya usado en el archivo para el etiquetado de corrección de las opciones (líneas 217-232, también JSX inline). `ExamReview.jsx` sigue siendo, como el resto de los componentes de UI del runner, verificado solo por navegador — no gana un archivo de test nuevo por este cambio.

## 3. Compatibilidad hacia atrás

Tres casos, todos degradando sin romper nada (ninguno lanza error ni muestra un puente vacío o roto):

1. **Sets de antes de la Parte A**: sin campo `reformulation` en absoluto → el bloque completo no se renderiza (la condición `setQuestion.reformulation` ya lo excluye).
2. **`micro_trottoir` / `conversation_image`**: nunca tienen `reformulation` → mismo caso que (1).
3. **Sets generados en la ventana entre el despliegue de la Parte A y el de este cambio** (si alguno llegó a generarse): tendrían `reformulation.{extrait_audio, option_correcte, type}` pero no `trap_option_ids` — se trata como `[]`, así que el puente muestra la comparación de audio/respuesta correcta con normalidad, simplemente nunca dispara la advertencia de trampa (no hay forma de saber retroactivamente qué opción habría calificado sin volver a validar el ítem, y no es necesario: perder la advertencia en ese puñado de ítems intermedios es aceptable, perder el resto del puente no lo sería).

## Testing

- Backend: `backend/test/reformulation.test.js` gana casos para `trap_option_ids` — que capture exactamente los ids que califican (incluyendo el caso de más de un distractor calificando a la vez), que quede vacío cuando ninguno califica (mismo caso que ya dispara el rechazo existente, verificar que el rechazo sigue ocurriendo antes de que el array importe), y que el resto de `reformulation` (`extrait_audio`, `option_correcte`, `type`) no cambie de forma.
- Frontend: sin test unitario nuevo, verificación solo por navegador (correr un examen real hasta review, fallar deliberadamente una pregunta de una sección con `reformulation` para confirmar que el puente aparece con el texto correcto, incluyendo el caso donde la opción elegida es la trampa) — coherente con que `ExamReview.jsx` ya es browser-only hoy.
