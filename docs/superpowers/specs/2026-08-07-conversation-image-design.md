# Sección `conversation_image` — Design Spec

## Contexto

TEFAQ simulator, rama principal (`main`, tras el merge de PR #4). De las 8 secciones oficiales del examen, `conversation_image` es la única sin constructor de prompt (`backend/src/prompt/sections/`), por lo que `SET_STANDARD_40` (36+4=40 preguntas, formato completo y fiel al examen real) está declarado en `examFormat.js` pero rechazado por el pipeline. Este spec cubre implementarla end-to-end: generación de contenido, generación de imágenes, almacenamiento, y reproducción en el runner del frontend.

El esquema de datos ya reserva espacio para esto sin que nadie lo haya construido: cada ítem trae `images: []` y el ledger del set trae `images: { appels: 0, echecs: 0 }` (mismo patrón que `texte`/`tts` — contadores de llamadas a una API de generación).

**Formato real de la sección** (corregido tras revisar el simulador oficial, no es "foto de escenario + preguntas de texto"): el evaluado escucha un audio corto (10-20s) y elige, entre **4 imágenes** (bocetos simples, no fotorrealistas), la que corresponde a lo escuchado. Es la sección más fácil del examen (registro A2-B1) — el CECR la describe como "sujet concret et familier".

## Categorías y dimensiones discriminantes

8 categorías fijas (derivadas del livret oficial, no del catálogo de 152 temas libres existente — son estructuralmente distintas: categorías cerradas + dimensiones, no escenarios de texto libre). Viven en un catálogo nuevo, pequeño, separado de `topics/catalog.js`: `backend/src/topics/imageCategories.js`, junto al resto del código de asignación de temas.

- `objets_produits` — compra/reparación/regalo: electrodomésticos, muebles, ropa, herramientas.
- `lieux_commerces` — gare, aéroport, bibliothèque, pharmacie, café, épicerie.
- `activites_loisirs` — deporte, jardinage, bricolage, cuisine.
- `situations_domestiques` — fuite d'eau, déménagement, ménage, panne.
- `transports` — métro, bus, vélo, voiture, à pied.
- `repas_nourriture` — restaurant, marché, préparation.
- `meteo_vetements` — condiciones climáticas y atuendo correspondiente.
- `personnes_interactions` — cantidad de personas, quién hace qué, profesión visible.

6 dimensiones discriminantes que el generador debe elegir 1-2 por ítem y variar entre las 4 opciones: **objeto principal, cantidad, acción en curso, lugar, momento del día, clima**.

**Vara de calidad** (la da el usuario, no automatizable): mirar las 4 imágenes sin escuchar el audio — si se puede descartar alguna a simple vista (estilo distinto, categoría equivocada, absurda), el ítem está roto. En el examen real las 4 son igual de plausibles hasta que el audio discrimina.

**Asignación de categorías — rotación dedicada, no el mecanismo genérico de `topics/planner.js`.** Ese mecanismo bloquea IDs usados en los últimos `historyWindow` (3) planes; con solo 8 categorías y 4 usadas por set, para el tercer set ya no quedan categorías sin bloquear y la relajación 3→2→1→0 cae permanentemente a 0 (cero anti-repetición real de ahí en adelante) — el mecanismo está pensado para pools grandes con IDs libres, no para un enum cerrado de 8. En su lugar, `imageCategories.js` expone un shuffle-bag propio: se barajan las 8 categorías una vez y se reparten en 2 grupos fijos de 4; cada set nuevo consume el siguiente grupo de la bolsa (agotada la bolsa, se re-baraja) — garantiza que las 8 categorías se usan por parejas completas antes de repetir cualquiera, sin pedir prestada la maquinaria de topics de texto libre.

## Generación de contenido

`conversation_image` gana su propio constructor en `prompt/sections/conversation_image.js`, siguiendo el patrón `opcionesFijas` que ya existe para `micro_trottoir` (las opciones no las inventa el modelo libremente: se ancla a la categoría+dimensiones dadas). Por ítem, el LLM genera:

- `transcript`: diálogo corto entre 2 personas. **Recalibrado a 40-55 palabras** (no 40-70, el rango que ya traía el preset): a ~150 palabras/minuto de habla francesa conversacional, 70 palabras rondan 28-30s, fuera del "10-20s" real de esta sección; 40-55 palabras encajan mejor en esa ventana. Ajuste en `examFormat.js`.
- 1 pregunta (`questionsPerAudio: 1`, ya así en el preset).
- 4 opciones **sin romper el contrato existente de `{id, text}`**: cada opción trae `text` (una descripción corta en francés de la escena-variante — sigue siendo lo que usan `validation/index.js` para exigir contenido no vacío y `itemGenerator.js`'s `aleatorizarOpciones` para remapear la opción correcta tras el barajado por *contenido de `text`*, no por id) más un campo nuevo `imagePrompt` (versión enriquecida específicamente para el paso de generación de imagen). El frontend simplemente no renderiza `text` para esta sección. El barajado de opciones ya ocurre antes de cualquier paso de audio/imagen (mismo orden de pipeline que hoy), así que las imágenes siempre se generan con los IDs A-D ya finales.
- `correctId`, `feedback` (español), `justification` (cita textual del transcript) — sin cambios respecto al esquema existente.

**Dificultad forzada a B1** siempre, sin importar la dificultad global elegida para el resto del set — el registro A2-B1 no es negociable para esta sección (es deliberadamente la más fácil del examen real). `buildSectionPrompt` pasa `difficulty: 'B1'` de forma fija para `conversation_image`, ignorando el parámetro que llega para las demás secciones del mismo set.

## Generación de imágenes

Nuevo paso en `sets/pipeline.js`, análogo al de audio pero exclusivo de esta sección. Modelo: `gemini-3.1-flash-image` (nombre estable vigente; la API no garantiza conteo exacto de imágenes en una sola llamada, así que se generan llamadas separadas):

1. Generar una **imagen de referencia de estilo neutral** (5ª imagen, descartada — no es ninguna de las 4 opciones), a partir de una descripción de estilo genérica compartida (boceto simple, mismo trazo, sin texto/letras visibles). Generarla a partir de la opción correcta la volvería, sin querer, la única sin referencia — una asimetría estadística que un evaluado atento podría notar (la opción "distinta" siempre siendo la correcta). Con una referencia neutral, ninguna de las 4 queda privilegiada.
2. Generar las 4 imágenes de opción (A-D) en llamadas separadas, todas usando la referencia neutral del paso 1 para consistencia de estilo.
3. Resolución mínima (512px / ~0.25MP) — son bocetos simples, no necesitan detalle fino; es además el tier más barato del modelo.
4. El prompt de cada imagen prohíbe explícitamente texto, letras o etiquetas visibles dentro del dibujo — es una debilidad conocida de los modelos de generación de imagen y, para bocetos de concepto, no aporta nada.

Costo: 5 llamadas/ítem × hasta 4 ítems/set ≈ 20 llamadas, ~$0.045 c/u en el tier más barato ≈ $0.90/set — sigue siendo marginal.

**Reanudación parcial — checkpoint por imagen, sin estado nuevo.** Si falla una sola imagen (red, contenido rechazado, etc.), el ítem **no** pasa a `echoue` — ese estado ya significa "regenerar texto" en `pipeline.js` (`item.etat === 'echoue'` reentra el paso de texto), y perder el transcript/preguntas ya validados y pagados por una imagen fallida sería un desperdicio real. En su lugar, igual que el paso de audio no tiene un estado dedicado para "a medias" (es un solo archivo atómico), el paso de imágenes usa el propio `item.images` como checkpoint: en cada reanudación, solo se generan los IDs ausentes de `item.images` (incluida la referencia neutral, si tampoco existe). Por cada imagen: escribir el archivo primero, agregar su entrada a `item.images` después, `writeSet` (flush) inmediatamente — mismo principio de "flush tras cada paso" que ya sigue el resto del pipeline. Si el proceso muere a mitad de una escritura, esa imagen nunca llegó a registrarse en `item.images`, así que la reanudación simplemente la regenera; no hace falta escritura atómica con archivo temporal + rename (el resto del pipeline tampoco la usa para audio). `item.etat` se mantiene en `genere` durante todo el paso, igual que hoy hace audio — no se introduce un estado nuevo. Antes de escribir cada imagen se verifica que la respuesta trajo bytes de imagen reales (no solo HTTP 200); no se valida dimensión/formato más allá de eso.

Reutiliza `ledger.images.appels/echecs` (ya reservado) y la misma clasificación `esFalloDeCuotaORed` que ya gobierna el paso de audio: un fallo de cuota/red detiene la tanda completa; un fallo puntual de una imagen dentro de un ítem no aborta el ítem, solo deja pendiente esa imagen para la próxima reanudación. `maxItems` sigue contando **ítems** procesados (no llamadas de imagen), igual que ya hace para los pasos de texto/audio — un ítem con generación de imágenes sigue sumando 1 a `trabajados` al terminar su iteración del loop, sin importar cuántas de las 5 llamadas hizo.

**`pilotes:true` + `SET_STANDARD_40` se rechazan explícitamente en `createSet()`.** `conversation_image` es de una pregunta por audio, así que calificaría para recibir pilotos igual que las demás secciones de `SINGLE_QUESTION_SECTIONS` — pero el propósito de los pilotos (rellenar `SET_STANDARD_36` a 40 preguntas antes de que existiera esta sección real) ya no aplica cuando el set nace con las 40 reales: `36 + 4 pilotos = 44`, rompiendo el invariante que ya documenta `examFormat.js`.

**Fuera de alcance deliberado:** no hay validación automática de que las 4 imágenes sean "igual de plausibles" (la vara de calidad de arriba), ni decodificación/verificación de dimensiones más allá de "llegaron bytes de imagen". Es un chequeo subjetivo que no se puede automatizar de forma confiable — el QA manual del primer set generado es el filtro real, igual que la calidad de prompts de las demás secciones se refinó empíricamente.

## Almacenamiento y servido

- `sets/<id>/images/<ref>-A.png` (y `-B`, `-C`, `-D`) — mismo patrón que `audio/<ref>.wav`.
- Nueva ruta `GET /api/sets/:id/images/:archivo` en `server.js`, análoga a `/api/sets/:id/audio/:archivo`, con la misma validación de nombre de archivo contra path traversal.
- El ítem generado guarda las 4 rutas en su ya reservado `images: []`, con la forma `[{ id: 'A', path: 'images/<ref>-A.png' }, ...]` — única fuente de verdad para las rutas (igual que `item.audio` es la única fuente de verdad para el audio). Las `options` de la pregunta siguen llevando solo `{ id, ... }` sin duplicar la ruta; el frontend cruza `option.id` contra `item.images` para resolver qué archivo mostrar.

## Frontend

**Renderizado de la pregunta:** nueva variante en `ExamRunner.jsx`, activada cuando `section.type === 'conversation_image'`, que resuelve cada opción cruzando `option.id` contra `item.images` (ver Almacenamiento) en vez de mostrar `option.text` — reutiliza exactamente el layout ya validado con el usuario vía mockup: fila de 4 imágenes, cada una con su radio button debajo (sin texto/etiqueta bajo la imagen, fiel al examen real), mismo estilo de fondo gris al seleccionar / hover que ya usan las opciones de texto de las demás secciones. Layout responsive (la columna de audio ya reserva 300px fijos a la izquierda; la fila de 4 imágenes necesita colapsar a 2×2 en pantallas angostas, detalle de implementación). `<img>` con `alt="Option {id}"` (no describe el contenido — evitaría dar la respuesta — pero da un mínimo semántico). `SECTION_LABELS` y `SECTION_INSTRUCTIONS` (`ExamRunner.jsx`) y su equivalente en `ExamReview.jsx` ganan la entrada de `conversation_image`, igual que las 7 secciones existentes.

**Precarga:** el preload actual (`audioPreload.js`) indexa su `Map` de blob URLs solo por `item.ref` — insuficiente aquí porque un ítem de `conversation_image` tiene 4 (realmente 5, contando la referencia neutral descartada solo en el backend) imágenes, no 1. Un módulo nuevo análogo (mismo patrón: concurrencia acotada, `AbortController`, revocación de blob URLs) indexa por clave compuesta `` `${ref}-${optionId}` `` — mismo estilo de clave compuesta que ya usa el código (ej. `name={`${item.ref}-q${questionIndex}`}` en los radio buttons). Igual que `confirmPlayable` no se conforma con "llegaron bytes" para audio, la precarga de imagen espera que el `<img>` dispare `onload`/`decode()` antes de darla por lista. El progreso de precarga combina audio + imágenes en un solo contador.

**Compatibilidad del set:** `setCompatibility.js` hoy rechaza cualquier set que no sea exactamente 32 ítems/36 preguntas de formato `SET_STANDARD_36`. Se generaliza para aceptar también `SET_STANDARD_40` (36 ítems/40 preguntas). Verificado que **no** hace falta tocar `examScoring.js` ni `ExamSummary.jsx` (el `/699` ya es genérico sobre el total real de preguntas que le llega) ni `examProgress.js` (las pestañas ya iteran `set.sections`/ítems reales, no una constante 32) — sí hay que actualizar el comentario de `examScoring.js` que hoy afirma "el runner ya rechaza cualquier otro formato", que dejará de ser cierto. **Deliberadamente no se agrega validación estructural profunda por ítem** (que las 4 imágenes existan, que los ids calcen, etc.) — `checkSetCompatibility` hoy tampoco valida eso para ninguna otra sección (ej. nunca revisa que `item.transcript` no esté vacío), solo cuenta agregados; el invariante de completitud lo garantiza el pipeline al gatear `pret` (ver checkpoint de imágenes arriba), no el consumidor.

**Repaso post-examen (`ExamReview.jsx`):** la sección de repaso también necesita poder mostrar las 4 imágenes de un ítem de `conversation_image` en vez de texto — mismo patrón de renderizado que en el runner.

## Habilitación de `SET_STANDARD_40`

Una vez `conversation_image` tiene constructor de prompt y soporte en el pipeline, `sets/pipeline.js` deja de rechazar `SET_STANDARD_40` en `createSet` (hoy `FORMATO_SOPORTADO` solo permite `SET_STANDARD_36`). No existe una UI de "generar set" (los sets se crean vía `POST /api/sets/generate`, `SetPicker.jsx` solo lista los ya `complet`) — así que no hay selector que tocar ahí; el cambio real de exposición es que `setCompatibility.js` deje de rechazar el set una vez generado.

## Completar el set existente

`set-2026-08-06-xwwe` (el único set real en disco, `SET_STANDARD_36`, `complet`, 32 ítems) se completa a 40 con un **script puntual de una sola vez** (no una funcionalidad reusable del producto): agrega la sección `conversation_image` (4 ítems nuevos en `en_attente`) al `sections` array de su `set.json`, cambia `format` a `SET_STANDARD_40`, y vuelve a invocar `pipeline.run()` sobre ese mismo id — el pipeline ya es resumible por diseño (salta ítems en `pret`), así que solo procesa los 4 ítems nuevos sin tocar los 32 ya generados.

**Riesgo de colisión de refs, y por qué NO es un problema de arquitectura general:** `SET_STANDARD_40` pone `conversation_image` primero en su composición canónica (`examFormat.js`), así que un set generado *desde cero* con ese formato le asignaría refs `s1i1..s1i4` — que en `set-2026-08-06-xwwe` ya pertenecen a `annonce_publique`. La colisión solo aparecería si el script re-derivara el plan desde cero bajo el orden canónico de `SET_STANDARD_40`; en vez de eso, el script trata la sección nueva como un **append** puro: le asigna refs `s8i1..s8i4` (las 7 secciones existentes ya ocupan s1-s7 en este set concreto), y verifica explícitamente que ningún ref nuevo colisione con los 32 ya existentes antes de escribir. No hace falta ninguna clave compuesta `sectionType/ref` en el frontend — el problema es enteramente del script, y se resuelve ahí. El script hace un backup de `set.json` antes de mutarlo (no un flag `--dry-run` completo: es una operación supervisada, se corre una sola vez con el usuario revisando el diff antes).

## Testing

- Backend: tests unitarios para el nuevo constructor de prompt (`conversation_image.js`), el shuffle-bag de categorías (`imageCategories.js`), y el paso de generación de imágenes en `sets/pipeline.js` (mockeando el proveedor de imágenes igual que ya se mockea el de texto/TTS) — incluyendo específicamente: reanudación con `item.images` parcialmente poblado (solo regenera los IDs ausentes, no reintenta texto), y que `createSet()` rechaza `pilotes:true` con `format: SET_STANDARD_40`. `esFalloDeCuotaORed` ya tiene cobertura, solo se reutiliza.
- El script de backfill gana su propia verificación (no necesariamente `node --test` formal, dado que es de un solo uso): confirmar que los refs nuevos no colisionan con los 32 existentes antes de escribir, y que hace backup del `set.json` original.
- Frontend: `setCompatibility.js` gana tests para el caso `SET_STANDARD_40` (36/40) además del `SET_STANDARD_36` (32/36) ya cubierto. El nuevo renderizado de opciones-imagen en `ExamRunner.jsx`/`ExamReview.jsx` sigue la convención ya establecida del proyecto: sin test unitario, verificación solo por navegador (igual que el resto de `ExamRunner.jsx`).
- Verificación manual obligatoria (no delegable): generar un `SET_STANDARD_40` completo y aplicar la vara de calidad de 30 segundos por ítem antes de darlo por bueno; correr el examen completo en el runner y confirmar que las imágenes se ven, se precargan, y el `/699` y las pestañas de progreso escalan bien a 40 preguntas.
