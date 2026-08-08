# Fase 2, Parte A — Regla de reformulación en la generación — Design Spec

## Contexto

TEFAQ simulator. Detección del usuario sobre su propia fuga de puntos en el examen real: entiende el audio pero no logra relacionarlo con las opciones escritas, porque el examen TEF construye la opción correcta como una **reformulación** (sinónimos, y sobre todo nominalización oral→escrito formal) mientras los distractores suelen reciclar palabras literales del audio con el sentido alterado. Si el simulador genera opciones fáciles de mapear palabra a palabra contra el audio, entrena el hábito equivocado.

Esta es la Parte A de una fase de tres partes (A: regla de generación, B: modo "Drill Paraphrase", C: revisión + cosecha de vocabulario), a implementar en orden A → C → B porque las otras dos dependen de esta. Cada parte tendrá su propio spec y plan de implementación independientes; este documento cubre únicamente la Parte A.

**Hallazgo clave durante el diseño:** `backend/src/prompt/common.js`'s `reglasComunes()` ya contiene una regla genérica ("la respuesta correcta también debe estar parafraseada: no copies frases literales del transcript") y una regla de distractor-trampa por *sinónimos* (línea 37). Ninguna de las dos resuelve el problema reportado: la primera es demasiado débil/genérica (sin ejemplos concretos de nominalización, sin validación programática), y la segunda pide el patrón opuesto al que hace falta (un distractor que parafrasea con sinónimos, no uno que reutiliza palabras literales). Parte A no parte de cero: refuerza la regla existente y agrega la regla de distractor-trampa-literal que falta, más la validación programática que hoy no existe para ninguna de las dos.

## Alcance

Aplica a las 6 secciones de opciones generadas por el modelo: `annonce_publique`, `repondeur`, `chronique`, `interview`, `reportage`, `divers`.

**Excluidas:**
- `micro_trottoir` — sus 4 opciones son posturas fijas del preset (`opcionesFijas: true`), no generadas a partir del audio; "¿la opción copia el audio?" no es una pregunta con sentido ahí. Ya existe el patrón de saltar reglas para `opcionesFijas` en `reglasComunes()`.
- `conversation_image` — sus opciones son descripciones de escena para un boceto (`text` + `imagePrompt`), con un constructor de prompt deliberadamente bespoke que no usa `reglasComunes()`/`esquemaJson()` de la forma estándar. Queda fuera de esta fase; se revisitará si hace falta más adelante.

**Alcance temporal — solo generación futura.** Esta regla afecta únicamente a ítems generados *después* de implementarse: nueva generación en modo entrenamiento y nuevos sets de Modo Examen. El set ya existente en disco (`set-2026-08-06-xwwe`, `SET_STANDARD_40`, `complet`) **no se modifica ni se regenera** — queda tal cual, sin el campo `reformulation` en sus preguntas. Esto es coherente con el manejo de compatibilidad descrito abajo: la ausencia del campo es un estado válido y esperado, no un caso de error.

## 1. Cambios de prompt (`backend/src/prompt/common.js`)

Dentro del bloque `if (!opcionesFijas)` de `reglasComunes()` (donde ya vive la regla de distractor-trampa-sinónimos existente):

- **Refuerzo de la regla de reformulación de la respuesta correcta.** Reemplaza el texto genérico actual por una instrucción concreta que exige nominalización oral→escrito formal y prohíbe explícitamente que la opción correcta reutilice los sintagmas clave del audio literalmente, con 2-3 ejemplos de transformación embebidos en la instrucción (p. ej. `"on va fermer la piscine" → "fermeture de la piscine"`, `"il a refusé de signer" → "son refus de signer"`, `"les prix vont monter" → "une hausse des tarifs"`).
- **Nueva regla de distractor-trampa-literal**, independiente y adicional a la trampa-sinónimos ya existente: al menos un distractor debe reciclar palabras literales del audio con el sentido cambiado (trampa de reconocimiento superficial). Ambas trampas pueden coexistir en distractores distintos de los 3 disponibles; no se exige que sean mutuamente excluyentes, solo que cada patrón esté presente en al menos uno.

**Nuevo campo obligatorio en el esquema JSON** (`esquemaJson()`): `reformulationType`, uno de `nominalisation | synonyme | restructuration`, autoreportado por el modelo para la transformación aplicada a la opción correcta. `esquemaJson()` gana un parámetro opcional `{ includeReformulationType = true }`; `micro_trottoir.js` lo invoca con `includeReformulationType: false`. `conversation_image` no se ve afectado porque no usa `esquemaJson()` de esta forma.

## 2. Validación programática (`backend/src/validation/`)

Nuevo módulo `reformulation.js`, invocado desde `validarPregunta()` en `index.js`, con un guard explícito que lo salta cuando `sectionType` es `micro_trottoir` o `conversation_image`.

Reutiliza `contentWords()`/`scoreJustification()` de `frenchWords.js`/`justification.js` (mismas utilidades que ya usa el chequeo de justificación, sin duplicar lógica de tokenización):

1. **Solapamiento de la respuesta correcta.** Calcula qué fracción de las content words de la opción correcta aparece en `question.justification` (la cita textual del transcript ya validada). Si supera `config.reformulationOverlapThreshold` (default `0.6`), lanza un `Error` descriptivo — esto entra al loop de reintento genérico ya existente en `itemGenerator.js` (reintento con el mismo proveedor, porque es un error de validación, no de cuota/red vía `esFalloDeCuotaORed`).
2. **Distractor-trampa-literal.** Si ninguno de los 3 distractores comparte al menos `config.reformulationMinTrapWords` (default `2`) content words con el transcript completo, lanza un `Error` y rechaza el ítem.
3. **Tipo de reformulación.** Si `question.reformulationType` está ausente o no es uno de los 3 valores permitidos, lanza un `Error` y rechaza el ítem.

Al pasar las tres verificaciones, adjunta metadata a la pregunta (mismo patrón que `question.justificationScore = cita.score` en el chequeo de justificación existente):

```js
question.reformulation = {
  extrait_audio: question.justification,
  option_correcte: <texto de la opción cuyo id === correctId>,
  type: question.reformulationType,
};
```

Esto ocurre **antes** del barajado de opciones en `itemGenerator.js` (`aleatorizarOpciones`); como el objeto `reformulation` referencia texto y no letras, sobrevive el barajado sin ajuste adicional.

**Reintentos y logging.** No se introduce un contador de reintentos ni de causas separado: se reutiliza el mecanismo genérico ya existente (`config.validationRetries`, que no distingue la causa del fallo — cualquier `Error` lanzado dentro de `validateItem` retrocede al mismo flujo de reintento-mismo-proveedor). El rechazo queda visible vía el `console.error` ya existente en `itemGenerator.js`, que imprime `error.message` por intento fallido; los mensajes de error de este módulo son lo bastante descriptivos (p. ej. incluyen el porcentaje de solapamiento medido) para poder grepear logs y calibrar los umbrales manualmente si hace falta.

## 3. Metadata y compatibilidad hacia atrás

El objeto `question.reformulation` queda persistido en `set.json` automáticamente en cuanto se adjunta durante la generación — no requiere cambios en `sets/pipeline.js` ni en `sets/store.js`. Los sets generados antes de esta fase (y el set ya existente, que no se regenera) simplemente no tienen el campo. Cualquier consumidor futuro (Parte C, la vista de revisión) debe tratar su ausencia como un caso válido y degradar la UI con elegancia (no mostrar el puente de reformulación si el campo no existe), no como un error.

## Testing

- Backend: tests unitarios nuevos para `validation/reformulation.js` — casos de solapamiento alto en la respuesta correcta (rechazo), ningún distractor con palabras literales (rechazo), `reformulationType` ausente/inválido (rechazo), caso exitoso con metadata adjuntada correctamente, y confirmación de que el guard salta correctamente para `micro_trottoir`/`conversation_image`.
- Test de integración ligero en `itemGenerator.test.js`: confirmar que un rechazo de `reformulation.js` dispara el reintento mismo-proveedor existente (no salta al siguiente proveedor), igual que ya se prueba para el chequeo de justificación.
- Verificación manual: generar una ráfaga de ítems nuevos con la regla activa y confirmar a ojo que las opciones correctas ya no calcan el audio — esto es además el criterio de cierre explícito de toda la Fase 2 (mostrar una ráfaga de 10 ítems de drill con la regla A activa y su vista de revisión), aunque el drill en sí es Parte B.
