# Diseño — Generación y persistencia de sets de examen (slice 1)

Fecha: 2026-08-05
Estado: aprobado, listo para plan de implementación

## 1. Contexto

`simulador-tefaq-ia` genera hoy preguntas sueltas de compréhension orale con una cadena de proveedores LLM y las presenta en un frontend React con fases de entrenamiento. El objetivo a largo plazo es un **Modo Examen lockstep** que reproduzca el ritmo forzado del examen real.

Ese objetivo abarca ocho subsistemas independientes. Este documento cubre **solo el primero**: producir y persistir sets de examen completos. El runner lockstep, los resultados y el enriquecimiento multimedia tienen sus propios specs.

### Descomposición acordada

| # | Sub-proyecto | Contenido |
|---|---|---|
| **1** | **Sets generables** (este spec) | Esquema de los 8 tipos de sección, generación de los 5 tipos solo-texto más interview y reportage, planificador temático con historial, persistencia reanudable, TTS a disco |
| 2 | Runner lockstep | Máquina de estados por ítem, timers sin deriva, precarga total de audio, guardado continuo y reanudación |
| 3 | Resultados y bitácora | Puntaje por sección, estimación /699 etiquetada, analítica por pregunta, revisión, export, curva de progreso |
| 4 | Enriquecimiento multimedia | `conversation_image` (generación de imágenes), voces por interlocutor, ambiente de fondo con ffmpeg |
| 5 | Variantes de entrenamiento | Modo recuperación con distractores, drill por sección |

### Alcance de este slice

**Entra:**

- El esquema de datos cubre los **8 tipos de sección**, incluido `conversation_image`.
- La **generación** cubre 7 tipos: `annonce_publique`, `repondeur`, `micro_trottoir`, `chronique`, `interview`, `reportage`, `divers`.
- Sets de **36 preguntas** (`SET_STANDARD_36`): la estructura oficial sin el bloque 1.
- Planificador temático con anti-repetición por sección contra el historial de sets anteriores.
- Persistencia a disco reanudable ante crash o agotamiento de cuota.
- Síntesis TTS a WAV en disco con duración medida.

**No entra:**

- Generación de imágenes para `conversation_image` (slice 4). El tipo existe en los presets y el campo `images: []` existe en el contrato, pero `SET_STANDARD_36` no lo incluye y no hay constructor de prompt para él.
- Alternancia de voces por interlocutor y ambiente de fondo (slice 4). Los transcripts dialogados de `interview` se sintetizan con voz única.
- Cualquier cambio en el frontend.
- Revelado de ítems pilote y puntuación (slice 3). Este slice genera y marca los pilote; no los puntúa.

### Restricción transversal

El modo entrenamiento actual debe seguir funcionando sin cambios observables. `frontend/src/App.jsx` no se toca y el contrato de `/api/generate-question` se mantiene idéntico.

## 2. Decisiones y su porqué

**Estructura del set = oficial menos el bloque 1.** Rellenar hasta 40 preguntas con ítems extra de otros tipos alteraría la mezcla de secciones, y la mezcla *es* el examen: el bloque 4 (10 preguntas rápidas) cansa distinto que el bloque 3 (audios largos). El umbral B2 se re-ancla proporcionalmente a ~21/36 y debe mostrarse siempre etiquetado como estimación (slice 3).

**Catálogo de temas ampliado a ~150 entradas etiquetadas.** Un set consume 32 temas y el catálogo actual tiene 59, con solo 10-12 entradas de perfil debate/actualidad. Sin ampliación, la anti-repetición por sección es imposible más allá del segundo set — que es exactamente el problema que infló los resultados caseros.

**Los fallos de validación y los de cuota se tratan distinto.** El código actual trata cualquier fallo como fallo del proveedor y avanza en la cadena; en un pipeline de 32 ítems eso produce sets con calidad desigual e invisible. Un 429 o un timeout justifica avanzar; un transcript tres palabras fuera de rango es ruido de muestreo con `temperature: 1` y merece reintentar el mismo modelo.

**Núcleo compartido con adaptador para el modo entrenamiento.** Lo que hoy genera `buildSystemPrompt()` es en la práctica un `divers`. El generador nuevo lo subsume; `/api/generate-question` aplana `{transcript, questions:[q]}` a la forma actual antes de responder. Se evita duplicar validación, `randomizeCorrectOption` y `normalizeFeedback`, y el frontend no se entera.

**Orquestación como job en proceso con el disco como única fuente de verdad.** Cada ítem se escribe a disco en cuanto está listo. Con eso, reanudar tras un crash, pausar por cuota y continuar mañana dejan de ser tres funcionalidades y pasan a ser la misma ruta de código. `maxItems` queda como límite opcional por invocación, no como mecanismo de reanudación.

## 3. Arquitectura de módulos

```
backend/src/
  examFormat.js              datos puros: presets de sección y composición de sets
  topics/
    catalog.js               ~150 temas etiquetados
    planner.js               plan temático del set (función pura)
    history.js               lector del historial sobre data/sets/
  prompt/
    index.js                 buildSectionPrompt(type, opts) — despacho
    sections/*.js            un constructor por tipo de sección
    profiles.js              DIFFICULTY_PROFILES (movido desde prompt.js)
  validation/
    index.js                 validateItem(item, sectionType)
    justification.js         verificación de cita
    frenchWords.js           stopwords francesas (copia backend)
  itemGenerator.js           genera UN ítem con política de reintentos
  sets/
    store.js                 I/O de set.json, escritura atómica
    pipeline.js              bucle de generación, lock, ledger
  audio/
    synth.js                 TTS a WAV en disco + duración
  providers/                 sin cambios
  server.js                  rutas nuevas + adaptador de entrenamiento
```

Frontera: `topics/planner.js`, `prompt/`, `validation/` y `examFormat.js` son puros — sin disco, sin red, sin reloj. Todo el I/O vive en `sets/store.js`, `topics/history.js`, `audio/synth.js` y los providers. Esa separación es lo que hace que los tests no necesiten mocks de sistema de archivos.

`backend/src/prompt.js` y `backend/src/questionGenerator.js` desaparecen: `TEFAQ_TOPICS` va a `topics/catalog.js`, `DIFFICULTY_PROFILES` a `prompt/profiles.js`, `buildSystemPrompt` se convierte en los constructores de `prompt/sections/`, `validateQuestion` en `validation/`, y el resto en `itemGenerator.js`. `tefaqPatterns.js` se mantiene tal cual y lo siguen usando los constructores de prompt.

### Datos en disco

```
backend/data/
  sets/
    <set-id>/
      set.json
      audio/<ref>.wav
```

No hay archivo de historial separado: el historial se deriva leyendo el campo `plan` de los `set.json` existentes. Una sola fuente de verdad, y borrar la carpeta de un set libera sus temas sin código de limpieza.

## 4. `examFormat.js` — presets

Datos puros. Es el archivo que el usuario editará al calibrar contra su memoria del examen real; no debe contener lógica.

| Clave | Bloque | Preguntas | `avant` | `apres` | Preg./audio | Palabras |
|---|---|---|---|---|---|---|
| `conversation_image` | 1 | 4 | 5 s | 10 s | 1 | 40–70 |
| `annonce_publique` | 2 | 4 | 10 s | 10 s | 1 | 30–60 |
| `repondeur` | 2 | 6 | 10 s | 10 s | 1 | 30–60 |
| `micro_trottoir` | 2 | 6 | 5 s | 15 s | 1 | 40–70 |
| `chronique` | 3 | 2 | 10 s | 15 s | 1 | 100–150 |
| `interview` | 3 | 6 (3 audios × 2) | 20 s | 30 s | **2** | 200–300 |
| `reportage` | 3 | 2 (1 audio × 2) | 10 s | 15 s | **2** | 150–220 |
| `divers` | 4 | 10 | 10 s | 15 s | 1 | 60–120 |

Cada preset expone además `lectures: 1`.

**Composiciones:**

- `SET_STANDARD_36` — las 7 secciones generables en orden de bloque. 36 preguntas, 32 ítems (audios).
- `SET_STANDARD_40` — declarada pero **no seleccionable** en este slice; añade `conversation_image` al inicio. La habilita el slice 4. El endpoint de generación rechaza con `400` cualquier `format` distinto de `SET_STANDARD_36`.

**Tolerancia de rango de palabras:** `max(2, round(maxWords × 0.05))`. La tolerancia fija de ±2 actual es razonable para un annonce de 30-60 pero absurdamente estrecha para una interview de 200-300, donde rechazaría ítems buenos por un 1% de desviación y haría pagar el reintento. Valores resultantes: ±3 annonce/répondeur, ±4 micro-trottoir, ±8 chronique, ±11 reportage, ±15 interview, ±6 divers.

**Otros parámetros configurables aquí:** ventana `N` del historial (default 3), umbral de `justificationScore` (default 0.8), mínimo de palabras de contenido en una justificación (default 5), número de posturas de micro-trottoir (3 o 4), reintentos por fallo de validación (default 2).

**Posturas de `micro_trottoir`** (orden fijo, textos en francés):

- 3 opciones: `totalement pour` · `pour à certaines conditions` · `totalement contre`
- 4 opciones: las tres anteriores más `ne se prononce pas`

## 5. Catálogo de temas

`TEFAQ_TOPICS` deja de ser un array de strings y pasa a array de objetos:

```js
{ id: 't-042', text: 'un aviso del municipio sobre una consulta pública…', sections: ['annonce_publique', 'divers'] }
```

El `id` es estable y es lo que viaja al plan y al historial. El `text` puede reescribirse sin invalidar historial.

**Volumen requerido.** Para sostener una ventana `N=3` sin relajaciones, cada sección necesita un pool de al menos `demanda × (N+1)`:

| Sección | Demanda/set | Pool mínimo |
|---|---|---|
| `annonce_publique` | 4 | 16 |
| `repondeur` | 6 | 24 |
| `micro_trottoir` | 6 | 24 |
| `chronique` | 2 | 8 |
| `interview` | 3 | 12 |
| `reportage` | 1 | 4 |
| `divers` | 10 | 40 |

Como un tema puede etiquetarse para varias secciones, un catálogo de ~150 entradas cubre estos mínimos con holgura. Requisito específico: **al menos 40 temas etiquetados para el bloque 3** (`chronique`, `interview`, `reportage`), que es donde el agotamiento muerde primero. Las 59 entradas actuales se conservan y se etiquetan; el resto se redacta nuevo y lo revisa el usuario antes de dar por cerrado el slice.

## 6. Planificador temático

`planTopics({ catalog, composition, history, seed })` → array de `{ ref, sectionType, topicId, posture? }`. Función pura; con la misma semilla devuelve el mismo plan, lo que permite tests de igualdad exacta.

**Algoritmo:**

1. Calcular, por sección, el pool de candidatos: temas del catálogo etiquetados para ese tipo, menos los usados en los últimos `N` sets del historial.
2. **Ordenar las secciones por escasez ascendente** (`|pool| / demanda`) y asignar en ese orden. Si se asignara `divers` primero —que encaja con casi cualquier tema— consumiría los pocos temas de debate que el bloque 3 necesita y el planificador se quedaría sin opciones al llegar a él. Es asignación con restricciones y se resuelve sirviendo primero al más restringido.
3. Dentro de cada sección, muestrear sin reemplazo del pool disponible, descontando lo ya asignado a secciones anteriores del mismo set.
4. Para `micro_trottoir`, sortear además la **postura objetivo** de cada ítem, repartida entre las posturas disponibles. Sin esto, si el modelo tiende a escribir hablantes a favor, la respuesta correcta sería casi siempre la A.

**Degradación cuando un pool se agota:** relajar la ventana `N` progresivamente (3 → 2 → 1 → 0) **solo para la sección afectada**, y registrar en el `set.json` qué secciones la relajaron y hasta qué valor. Así el agotamiento del catálogo se detecta como dato y no por intuición.

**Invariante inviolable:** ningún tema se repite dentro de un mismo set. Si ni con `N=0` hay temas suficientes para una sección, la generación aborta con error explícito antes de gastar una sola llamada.

## 7. Contrato de datos

```json
{
  "id": "set-2026-08-05-a1b2",
  "genere_le": "2026-08-05T11:40:00Z",
  "statut": "partial",
  "format": "SET_STANDARD_36",
  "formatVersion": 1,
  "difficulty": "B2",
  "pilotes": false,
  "seed": 918273,
  "plan": [
    { "ref": "s1i1", "sectionType": "annonce_publique", "topicId": "t-042" },
    { "ref": "s3i4", "sectionType": "micro_trottoir", "topicId": "t-101", "posture": "pour à certaines conditions" },
    { "ref": "s5i2", "sectionType": "interview", "topicId": "t-088" }
  ],
  "relaxations": [{ "sectionType": "chronique", "fenetre": 1 }],
  "ledger": {
    "texte":  { "appels": 34, "echecs": 2 },
    "tts":    { "appels": 32, "echecs": 0 },
    "images": { "appels": 0,  "echecs": 0 }
  },
  "sections": [{
    "type": "interview",
    "timing": { "avant": 20, "apres": 30 },
    "lectures": 1,
    "items": [{
      "ref": "s5i2",
      "etat": "pret",
      "topicId": "t-088",
      "sujet": "…",
      "pilote": false,
      "provider": "gemini-3.5-flash",
      "tentatives": 2,
      "transcript": "Journaliste: … Invité(e): …",
      "audio": "audio/s5i2.wav",
      "duree_audio_s": 98.4,
      "images": [],
      "questions": [{
        "prompt": "…",
        "options": [{ "id": "A", "text": "…" }, { "id": "B", "text": "…" },
                    { "id": "C", "text": "…" }, { "id": "D", "text": "…" }],
        "correctId": "B",
        "feedback": "…",
        "justification": "cita textual del transcript que sostiene la respuesta",
        "justificationScore": 0.92
      }]
    }]
  }]
}
```

**Estados de ítem:** `en_attente` → `genere` (texto validado y persistido) → `pret` (audio en disco). Más `echoue`.

**Estados de set:** `partial` (mientras haya ítems no `pret`) · `complet` (todos `pret`).

### Decisiones del contrato

**El plan se escribe entero antes de generar nada.** Es lo que hace honesto el muestreo sin reemplazo: los 32 temas se sortean de una vez y no dependen del orden de generación ni de los reintentos.

**Un reintento reusa el mismo `topicId`.** Regenerar un ítem fallido no consume un tema nuevo, así que la cuota temática no se erosiona con la mala suerte.

**`etat` por ítem es todo el mecanismo de reanudación.** El pipeline hace «busca el primer ítem que no esté `pret` y trabájalo». No hay código de reanudación aparte.

**Texto y audio son estados separados** para que quedarse sin cuota de TTS no haga perder el texto ya pagado.

**`ref` posicional en vez de número global de pregunta.** Ítems y preguntas no coinciden: un ítem de interview son 2 preguntas. Numerar 32 ítems como `q1..q32` mientras el examen habla de preguntas 1..36 garantiza confusión al depurar. El número visible para el usuario se deriva al ejecutar.

**`format` y `formatVersion` explícitos** para que, cuando el slice 4 añada el bloque 1 y los sets pasen a 40, los sets de 36 sigan siendo legibles y ejecutables en vez de basura silenciosa.

**`pilotes` es un flag, no una funcionalidad completa.** Con `true` se generan **4 preguntas** extra no puntuables: 40 preguntas de las que 36 puntúan, misma proporción que el examen real. Para que la cuenta sea exacta, los ítems pilote se sortean **solo entre secciones de una pregunta por audio** (`annonce_publique`, `repondeur`, `micro_trottoir`, `chronique`, `divers`); si se permitiera un pilote de `interview`, aportaría 2 preguntas y el total sería 38, no 40. Cada ítem pilote consume su propio tema del plan, como cualquier otro. Revelar cuáles eran al terminar es puntuación, o sea slice 3.

**`justificationScore` se guarda siempre**, pase o falle la validación: una tendencia a la baja a lo largo de varios sets es la señal temprana de que un proveedor está degradando.

## 8. Generación de un ítem

`generateItem({ sectionType, topicId, posture, difficulty, providers })` → ítem validado.

1. `buildSectionPrompt(sectionType, { topic, difficulty, pattern, posture, minWords, maxWords })`.
2. Llamar al proveedor actual de la cadena.
3. Limpiar markdown, `JSON.parse`, `validateItem`.
4. `randomizeCorrectOption` + `normalizeFeedback` por cada pregunta — **excepto** en `micro_trottoir`, donde las opciones son fijas y no se barajan.
5. Devolver con `provider` y `tentativas`.

### Política de reintentos

| Fallo | Acción |
|---|---|
| HTTP 429, 5xx, timeout, red | Avanzar al siguiente proveedor de `AUTO_CHAIN` de inmediato |
| Validación (rango, JSON, `justification`, `correctId`, postura, alternancia) | Reintentar **el mismo** proveedor hasta `k=2` veces; agotado, avanzar en la cadena |
| Cadena agotada | Marcar el ítem `echoue` con el motivo del último fallo |

`provider` y `tentativas` quedan en el ítem para poder auditar la homogeneidad del set a posteriori.

### Constructores de prompt

`buildSectionPrompt` despacha a un constructor por tipo. Todos reusan `DIFFICULTY_PROFILES` y `pickTefaqPattern()`. Particularidades:

- **Bloques 3 y 4** exigen B2 real: opiniones, matices, implícitos, causa/consecuencia. Se apoyan en los perfiles B2/C1 existentes.
- **`micro_trottoir`**: el prompt pide un hablante con la **postura objetivo sorteada**, matizada y coherente; las opciones no las genera el modelo, vienen del preset.
- **`interview`**: transcript dialogado con etiquetas `Journaliste:` / `Invité(e):` y **2 preguntas** sobre el mismo audio.
- **`reportage`**: 2 preguntas sobre un audio único, sin diálogo etiquetado.
- Todos los constructores exigen el campo `justification` por pregunta: cita textual del transcript que sostiene la respuesta.

## 9. Validación

`validateItem(item, sectionType)` lanza con mensaje explícito al primer fallo. Reglas comunes:

- `transcript` no vacío; recuento de palabras dentro del rango del preset ± tolerancia proporcional.
- `questions.length` igual al `questionsPerAudio` del preset.
- Por pregunta: `prompt` no vacío, 4 opciones con `id` y `text`, `correctId` ∈ {A,B,C,D} y coincidente con una opción, `feedback` no vacío, `justification` válida.

Reglas por sección:

- **`micro_trottoir`**: las opciones son exactamente el juego de posturas del preset, en su orden fijo; la postura marcada correcta es la que se pidió al generador.
- **`interview`**: al menos dos etiquetas de hablante distintas y alternancia real entre ellas, no un monólogo con una etiqueta al principio.

### Verificación de `justification`

1. Normalizar justificación y transcript: minúsculas, sin diacríticos, sin puntuación ni comillas, espacios colapsados.
2. Si la justificación normalizada es substring del transcript normalizado → `score = 1.0`, pasa.
3. Si no, `score` = fracción de las palabras de contenido **distintas** de la justificación que aparecen en el transcript (sin exigir orden ni multiplicidad).
4. Pasa si `score ≥ 0.8` (configurable en `examFormat.js`).

**Guarda:** la justificación debe tener al menos 5 palabras de contenido. Sin ella, una «cita» de tres palabras hace match trivial y la regla no vale nada.

Las palabras de contenido se determinan con una lista de stopwords francesas en `validation/frenchWords.js`. Existe una lista equivalente en `frontend/src/trainingScan.js` y **no se comparte**: backend y frontend son dos paquetes npm sin workspace, y montar uno para una lista congelada es desproporcionado. Además los dos usos divergirán —el frontend resalta palabras clave, el backend verifica citas—. Duplicar lógica sería deuda; duplicar una lista estática es lo barato y lo correcto.

## 10. Audio

`synthItemAudio(setId, ref, transcript)` reusa la llamada a `gemini-2.5-flash-preview-tts` y `pcmToWav()` existentes, pero escribe el WAV a `data/sets/<id>/audio/<ref>.wav` en vez de cachearlo en memoria.

**Duración sin dependencias externas.** `ffmpeg` no está instalado y no hace falta: el WAV lo construimos nosotros con parámetros conocidos (24 kHz, mono, 16 bits), así que la duración es aritmética exacta sobre el buffer PCM — `pcmBuffer.length / 48000` segundos. Sin lectura del archivo y sin error de redondeo.

La voz se elige con el hash estable existente. La alternancia por interlocutor y el ambiente de fondo son slice 4; aquí cada transcript se sintetiza con voz única.

`/api/tts` y el caché en memoria actuales **no se tocan**: pertenecen al modo entrenamiento y el pipeline de sets no los usa.

## 11. Endpoints

| Ruta | Comportamiento |
|---|---|
| `POST /api/sets/generate` | Body `{ difficulty?, format?, pilotes?, seed?, maxItems? }`. Sortea el plan, escribe el `set.json` completo con todos los ítems en `en_attente`, responde `201 { id, total }` de inmediato y arranca el bucle en background |
| `POST /api/sets/:id/resume` | Body `{ maxItems? }`. Retoma desde el primer ítem no `pret` |
| `GET /api/sets` | Lista: `id`, `statut`, `format`, `genere_le`, progreso |
| `GET /api/sets/:id` | Set completo |
| `GET /api/sets/:id/status` | `{ total, generes, prets, echoues, statut, enCours }` |
| `GET /api/sets/:id/audio/:ref.wav` | Sirve el WAV |
| `DELETE /api/sets/:id` | Borra la carpeta; con ella libera sus temas del historial |

Un POST sobre un set ya en curso responde `409`.

## 12. Pipeline

Por cada ítem que no esté `pret`, en orden de plan:

- Si `en_attente` o `echoue`: generar texto → validar → barajar → persistir ítem como `genere` → flush del `set.json` → actualizar ledger.
- Si `genere`: sintetizar WAV → escribir a disco → medir duración → persistir como `pret` → flush → actualizar ledger.

Respeta `maxItems` si viene. Al terminar la tanda recalcula `statut`.

**El lock vive en memoria**, no en disco: un `.lock` en el sistema de archivos sobrevive a un crash y obliga a escribir código para detectar y limpiar locks huérfanos. Un `Set` de ids en curso desaparece con el proceso, que es el comportamiento correcto — si el proceso murió, nada se está generando.

**Escritura atómica** en todo flush: escribir a temporal y `rename`. Un crash a mitad de escritura dejaría un `set.json` truncado, y eso no es perder un ítem sino el set entero.

## 13. Errores

| Situación | Comportamiento |
|---|---|
| Ítem agota reintentos y cadena | Marcar `echoue` con motivo y **continuar con el siguiente**. Un ítem imposible no debe costar los 31 restantes. El set queda `partial`; reanudar reintenta solo `echoue` y `en_attente` |
| Cuota de texto o TTS agotada | Parada limpia, `partial`, nada perdido |
| Crash del proceso | El disco ya refleja el último ítem completado; `resume` continúa |
| Pool temático insuficiente incluso con `N=0` | Abortar antes de gastar llamadas, con error explícito |
| `set.json` corrupto o ilegible | `GET` responde 422 con el id; no se intenta reparar |

## 14. Adaptador del modo entrenamiento

`GET /api/generate-question` conserva query params, códigos de error y forma de respuesta actuales. Internamente llama a `generateItem` con el tipo de sección equivalente al formato de hoy y aplana el resultado:

```js
{ transcript, questions: [q] }  →  { prompt, options, correctId, feedback, transcript, provider, prefetched }
```

La cola de prefetch de 1, el caché de audio en memoria y `/api/tts` siguen exactamente como están.

## 15. Tests

`node --test` (incluido en Node 22, cero dependencias nuevas). `createQuestionGenerator(providers)` ya inyecta proveedores, así que los dobles de prueba entran sin refactor previo.

1. **Planificador** — sin repetición intra-set; respeta la ventana `N` con historial simulado; **caso construido donde el orden ingenuo agota el bloque 3 y el orden por escasez no**; relaja `N` y lo registra cuando el pool no da; aborta si ni con `N=0` alcanza; determinista con semilla fija; reparto de posturas de micro-trottoir.
2. **Validación** — cada regla común y por sección; tolerancia proporcional en los tres tamaños de transcript; `justification` (substring exacto, overlap por encima y por debajo del umbral, guarda de 5 palabras); posturas fijas de micro-trottoir; alternancia de hablantes en interview; `questions.length` por preset.
3. **Política de reintentos** — con proveedores falsos: un fallo de validación reintenta el mismo modelo, un 429 avanza en la cadena, el agotamiento marca `echoue`, y `tentativas`/`provider` quedan registrados correctamente.
4. **Pipeline y reanudación** — con generador y TTS falsos: interrumpir a mitad y reanudar produce un set completo sin regenerar ningún ítem `pret`; un reintento reusa el mismo `topicId`; el ledger cuadra con las llamadas realizadas; la escritura atómica sobrevive a un fallo simulado a mitad de flush.
5. **Contrato del modo entrenamiento** — la respuesta de `/api/generate-question` conserva exactamente la forma actual. Es el test que sostiene la decisión del núcleo compartido: si se pone rojo, el refactor tocó lo que no debía.

## 16. Criterio de aceptación

- Los cinco grupos de tests en verde.
- El modo entrenamiento funciona sin cambios observables en el navegador.
- Un set real de **2 secciones** —`annonce_publique` e `interview`— generado de extremo a extremo con sus WAV en disco, revisado por el usuario. Entre las dos cubren mono-pregunta, multi-pregunta, transcript corto, transcript largo y diálogo etiquetado.
- Un set `SET_STANDARD_36` completo generado, con `ledger` coherente y sin temas repetidos.
- Interrumpir la generación a mitad y reanudarla produce un set `complet`.
