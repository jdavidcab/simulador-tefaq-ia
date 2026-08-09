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

## 1. Extensión del backend: marcar la opción, no una lista de ids

**Restricción crítica descubierta en revisión de diseño:** `checkReformulation` corre dentro de `validateItem`, y `validateItem` se ejecuta **antes** de `aleatorizarOpciones` en `itemGenerator.js`'s `generateItem()`. `aleatorizarOpciones` baraja `question.options` y renumera A-D, remapeando `correctId` buscando el texto de la opción original — pero cualquier estructura que identifique una opción **por su letra original** (p. ej. un array `trap_option_ids: ["C"]` guardado antes del barajado) quedaría con letras obsoletas después: la letra "C" pre-barajado ya no corresponde a la misma opción una vez reordenada. Esto habría hecho que la advertencia de la sección 2 no apareciera cuando correspondía, apareciera para la opción equivocada, o variara de forma efectivamente aleatoria entre generaciones — un bug real, no hipotético.

Los campos existentes de `reformulation` (`extrait_audio`, `option_correcte`, `type`) no tienen este problema porque son texto/transcript, nunca letras — por eso sobreviven el barajado sin ajuste (ya probado en `itemGenerator.test.js`). Un identificador basado en letra necesita el tratamiento contrario.

**Solución: marcar la opción misma, no una lista aparte.** `aleatorizarOpciones` ya copia cada opción con `{ ...option, id: nuevaLetra }` — cualquier propiedad adicional que ya traiga la opción viaja automáticamente con ella, sin importar que la letra cambie. Entonces:

1. Nueva función pura exportada, `findLiteralTrapOptionIds(question, transcript, config)` en `backend/src/validation/reformulation.js` — extrae el cálculo que hoy vive inline como `hayTrampaLiteral`, sin cambiar el umbral (`config.reformulationMinTrapWords`) ni la condición de rechazo (rechaza cuando el array resultante queda vacío). Devuelve el array completo de ids que califican (normalmente 1, pero puede haber más de un distractor con suficiente reciclaje literal).
2. `checkReformulation` llama a esta función; si el array queda vacío, rechaza exactamente como hoy. Si no, antes de adjuntar `question.reformulation`, marca cada opción calificante en `question.options` con `literalTrap: true` (las que no califican quedan sin la propiedad — ausente, no `false`, mismo principio de "ausencia = no aplica" que ya usa el resto del diseño).
3. `question.reformulation` **no gana ningún campo nuevo** — se queda exactamente como en la Parte A (`extrait_audio`, `option_correcte`, `type`). La marca vive en la opción, no en la metadata de reformulación.

```js
export function findLiteralTrapOptionIds(question, transcript, config) {
  const palabrasTranscript = new Set(contentWords(transcript));
  return question.options
    .filter(option => option.id !== question.correctId)
    .filter(option => contentWords(option.text)
      .filter(palabra => palabrasTranscript.has(palabra)).length >= config.reformulationMinTrapWords)
    .map(option => option.id);
}
```

Dentro de `checkReformulation`, tras las comprobaciones existentes y antes de asignar `question.reformulation`:

```js
const trapIds = findLiteralTrapOptionIds(question, transcript, config);
if (trapIds.length === 0) throw new Error(/* mismo mensaje que hoy */);
// ...chequeo de reformulationType sin cambios...
for (const option of question.options) {
  if (trapIds.includes(option.id)) option.literalTrap = true;
}
```

Esto no cambia ningún umbral de calibración de la Parte A, no reabre ninguna decisión ya tomada ahí, y no afecta a ningún set ya generado (los que ya existen simplemente no tienen `literalTrap` en ninguna opción, ver compatibilidad).

## 2. Decisión en `reviewModel.js`, renderizado en `ExamReview.jsx`

**Cambio de enfoque respecto al borrador anterior:** originalmente esta lógica iba como JSX inline en `ExamReview.jsx`, sin tocar `reviewModel.js`, con el razonamiento de que era "una comparación trivial". Revisión de diseño correcta: `reviewModel.js` existe precisamente porque este proyecto separa deliberadamente las decisiones de corrección/estado (puras, testeadas) del renderizado (JSX, solo verificado por navegador) — es la arquitectura ya documentada para toda la pantalla de repaso. Además, una vez que se agregan las guardas defensivas de la sección de compatibilidad (abajo), la lógica deja de ser un one-liner: vale la pena que viva en la capa que ya se testea unitariamente, no en el componente.

`buildReviewModel(set, answers)` ya recibe el `set` completo (con `question.reformulation` y `question.options[].literalTrap` disponibles) y ya construye el objeto por pregunta `{ questionIndex, selectedId, correctId, answered, isCorrect }`. Ese objeto gana dos campos:

```js
{
  // ...campos existentes sin cambios...
  reformulation: null | { extrait_audio: string, option_correcte: string, type: string },
  selectedLiteralTrap: boolean,
}
```

Reglas de construcción (todas puras, todas testeables sin DOM):
- `reformulation` es `null` salvo que `question.reformulation` exista Y `extrait_audio`/`option_correcte` sean strings no vacíos Y `type` sea uno de los 3 valores válidos (`nominalisation`/`synonyme`/`restructuration`) — cualquier otra combinación (campo ausente, string vacío, tipo desconocido) se trata como "no hay puente que mostrar", nunca como un bloque a medio llenar. En la práctica `type` siempre es válido cuando `reformulation` existe (la Parte A ya lo valida antes de adjuntar el campo), pero el modelo no confía en esa garantía externa — la revalida.
- `selectedLiteralTrap` es `true` solo si la pregunta fue respondida (`answered`) Y la opción con `id === selectedId` tiene `literalTrap === true`. Sin respuesta → siempre `false` (no hay opción elegida que pueda ser la trampa).

`ExamReview.jsx` consume esto de forma trivial: dentro del bloque por pregunta ya existente (después de la lista de opciones, antes del párrafo de `feedback`, hoy alrededor de la línea 265), un bloque condicionado a `!question.isCorrect && question.reformulation`:

- **"Lo que dice el audio:"** — cita textual de `question.reformulation.extrait_audio`.
- **"Respuesta correcta ({tipo en español}):"** — `question.reformulation.option_correcte`, con el tipo traducido vía una constante nueva `REFORMULATION_TYPE_LABELS` (`nominalisation` → "Nominalización", `synonyme` → "Sinónimo", `restructuration` → "Reestructuración", con fallback `?? 'Reformulación'` por si acaso), siguiendo el mismo patrón ya usado por `SECTION_LABELS` en el mismo archivo — la traducción de la etiqueta es presentación, se queda en el componente, igual que `SECTION_LABELS` hoy.
- Si `question.selectedLiteralTrap`: una línea de advertencia.

**Redacción de la advertencia — corregida para no afirmar más de lo que el algoritmo valida.** El chequeo de `literalTrap` solo mide solapamiento léxico (≥2 palabras de contenido compartidas con el transcript completo, ver `reformulation.js`), no una diferencia de sentido confirmada — el propio código ya documenta que en transcripts largos casi cualquier distractor puede superar el umbral por coincidencia. El borrador anterior decía *"...pero con un sentido distinto"*, afirmando algo que no se validó. Redacción corregida:

> "Elegiste una opción que comparte palabras literales con el audio. Esto puede ser una trampa de reconocimiento superficial — compara el sentido completo, no solo las palabras, con la respuesta correcta."

Todo el texto del puente es en español, coherente con el resto de `ExamReview.jsx` (a diferencia de `ExamRunner.jsx`, cuyo chrome es en francés durante el examen cronometrado) — el fragmento de audio y el texto de la opción correcta se muestran tal cual (en francés, porque son contenido real del examen), pero las etiquetas y explicaciones que los rodean son en español.

`ExamReview.jsx` sigue sin ganar un archivo de test nuevo (sigue siendo, como el resto de los componentes de UI del runner, verificado solo por navegador) — pero ahora la parte que sí importa verificar sin navegador (qué se decide mostrar, no cómo se pinta) vive en `reviewModel.js` y se testea ahí.

## 3. Compatibilidad hacia atrás

Cuatro casos, todos degradando sin romper nada (ninguno lanza error ni muestra un puente vacío o roto) — la validación vive en `reviewModel.js` (sección 2), no dispersa en el componente:

1. **Sets de antes de la Parte A**: sin campo `reformulation` en absoluto → `reformulation` del modelo queda `null`, el bloque completo no se renderiza.
2. **`micro_trottoir` / `conversation_image`**: nunca tienen `reformulation` → mismo caso que (1).
3. **Metadata parcial o corrupta** (`extrait_audio`/`option_correcte` ausentes o vacíos, o `type` fuera de los 3 valores válidos): `reviewModel.js` lo trata como (1) — nunca se muestra un bloque a medias.
4. **Ninguna opción con `literalTrap: true`** (sets generados antes de este cambio, con `reformulation` de la Parte A pero sin la marca nueva en ninguna opción): `selectedLiteralTrap` es `false` incondicionalmente, así que el puente muestra la comparación de audio/respuesta correcta con normalidad, simplemente nunca dispara la advertencia de trampa. Perder la advertencia en ese puñado de ítems intermedios es aceptable; perder el resto del puente no lo sería.

## Testing

- Backend (`backend/test/reformulation.test.js`): casos para `findLiteralTrapOptionIds` en aislamiento — devuelve exactamente los ids que califican (incluyendo el caso de más de un distractor calificando a la vez), devuelve `[]` cuando ninguno califica (ahora sí observable directamente, sin depender de que `checkReformulation` rechace primero). Casos para `checkReformulation`: las opciones calificantes quedan marcadas con `literalTrap: true`, las que no califican no tienen la propiedad, y `question.reformulation` mantiene exactamente su forma de la Parte A (sin campos nuevos).
- Backend, integración post-barajado (`backend/test/itemGenerator.test.js`), obligatorio dado el bug que motivó este rediseño: un ítem con un distractor que califica como trampa, verificar que **después** de `aleatorizarOpciones` (a) `correctId` sigue apuntando al texto de la respuesta correcta, (b) la opción con `literalTrap: true` sigue siendo la que originalmente compartía las palabras literales (identificable por texto, ya que el id cambió), (c) la opción correcta nunca queda marcada con `literalTrap: true`, y (d) el caso de dos distractores calificando simultáneamente también sobrevive el barajado con ambas marcas intactas.
- Frontend, `reviewModel.js` (`frontend/src/exam/reviewModel.test.js`): pregunta incorrecta con `reformulation` completa → bloque presente; pregunta correcta → `reformulation: null` sin importar la metadata cruda; sin respuesta → `reformulation` presente si aplica pero `selectedLiteralTrap: false` siempre; set antiguo sin `reformulation` → `null`; `reformulation` con `type` inválido o `extrait_audio`/`option_correcte` vacíos → `null`; opción incorrecta elegida que NO es la trampa → `selectedLiteralTrap: false`; opción incorrecta elegida que SÍ es la trampa → `selectedLiteralTrap: true`.
- Frontend, `ExamReview.jsx`: sin test unitario nuevo, verificación solo por navegador (correr un examen real hasta review, fallar deliberadamente una pregunta de una sección con `reformulation` para confirmar que el puente aparece con el texto correcto, incluyendo el caso donde la opción elegida es la trampa) — coherente con que el componente ya es browser-only hoy; la cobertura real de casos borde vive en los tests de `reviewModel.js`, no aquí.
