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

El planner asigna 4 de las 8 categorías por set (una por ítem de bloc 1), reutilizando el mismo mecanismo de anti-repetición por historial que ya usa `topics/planner.js` para los demás temas.

## Generación de contenido

`conversation_image` gana su propio constructor en `prompt/sections/conversation_image.js`, siguiendo el patrón `opcionesFijas` que ya existe para `micro_trottoir` (las opciones no las inventa el modelo libremente: se ancla a la categoría+dimensiones dadas). Por ítem, el LLM genera:

- `transcript`: diálogo corto entre 2 personas (usa el rango `minWords`/`maxWords` ya calibrado en `examFormat.js` para esta sección: 40-70 palabras).
- 1 pregunta (`questionsPerAudio: 1`, ya así en el preset).
- 4 opciones, cada una con una **descripción corta en francés de la escena-variante** (en vez de `text`) — insumo para el paso de generación de imagen, no para mostrarse directamente.
- `correctId`, `feedback` (español), `justification` (cita textual del transcript) — sin cambios respecto al esquema existente.

**Dificultad forzada a B1** siempre, sin importar la dificultad global elegida para el resto del set — el registro A2-B1 no es negociable para esta sección (es deliberadamente la más fácil del examen real). `buildSectionPrompt` pasa `difficulty: 'B1'` de forma fija para `conversation_image`, ignorando el parámetro que llega para las demás secciones del mismo set.

## Generación de imágenes

Nuevo paso en `sets/pipeline.js`, análogo al de audio pero exclusivo de esta sección. Modelo: `gemini-3.1-flash-image` (nombre estable vigente; la API no garantiza conteo exacto de imágenes en una sola llamada, así que se generan 4 llamadas separadas por ítem):

1. Generar la imagen de la opción **correcta** primero, a partir de su descripción.
2. Generar las 3 imágenes distractoras, cada una usando la imagen de la opción correcta como **imagen de referencia de estilo** (el modelo está diseñado para mantener consistencia de estilo entre múltiples referencias) — así las 4 opciones de un mismo ítem se ven de la misma familia visual.
3. Resolución mínima (512px / ~0.25MP) — son bocetos simples, no necesitan detalle fino; es además el tier más barato del modelo.

Reutiliza `ledger.images.appels/echecs` (ya reservado) y la misma clasificación `esFalloDeCuotaORed` que ya gobierna el paso de audio: un fallo de cuota/red detiene la tanda completa; un fallo puntual de una imagen pasa el ítem a `echoue` y sigue con el siguiente.

**Fuera de alcance deliberado:** no hay validación automática de que las 4 imágenes sean "igual de plausibles" (la vara de calidad de arriba). Es un chequeo subjetivo que no se puede automatizar de forma confiable — el QA manual del primer set generado es el filtro real, igual que la calidad de prompts de las demás secciones se refinó empíricamente.

## Almacenamiento y servido

- `sets/<id>/images/<ref>-A.png` (y `-B`, `-C`, `-D`) — mismo patrón que `audio/<ref>.wav`.
- Nueva ruta `GET /api/sets/:id/images/:archivo` en `server.js`, análoga a `/api/sets/:id/audio/:archivo`, con la misma validación de nombre de archivo contra path traversal.
- El ítem generado guarda las 4 rutas en su ya reservado `images: []`, con la forma `[{ id: 'A', path: 'images/<ref>-A.png' }, ...]` — única fuente de verdad para las rutas (igual que `item.audio` es la única fuente de verdad para el audio). Las `options` de la pregunta siguen llevando solo `{ id, ... }` sin duplicar la ruta; el frontend cruza `option.id` contra `item.images` para resolver qué archivo mostrar.

## Frontend

**Renderizado de la pregunta:** nueva variante en `ExamRunner.jsx`, activada cuando `section.type === 'conversation_image'`, que resuelve cada opción cruzando `option.id` contra `item.images` (ver Almacenamiento) en vez de mostrar `option.text` — reutiliza exactamente el layout ya validado con el usuario vía mockup: fila de 4 imágenes, cada una con su radio button debajo (sin texto/etiqueta bajo la imagen, fiel al examen real), mismo estilo de fondo gris al seleccionar / hover que ya usan las opciones de texto de las demás secciones.

**Precarga:** el preload actual (`audioPreload.js`) solo trae audio. Se extiende (o se agrega un módulo análogo) para también precargar las 4 imágenes por ítem de `conversation_image` antes de que el intento pueda arrancar — mismo criterio que hoy bloquea el arranque hasta que el audio esté listo.

**Compatibilidad del set:** `setCompatibility.js` hoy rechaza cualquier set que no sea exactamente 32 ítems/36 preguntas de formato `SET_STANDARD_36`. Se generaliza para aceptar también `SET_STANDARD_40` (36 ítems/40 preguntas). Verificado que **no** hace falta tocar `examScoring.js` ni `ExamSummary.jsx` (el `/699` ya es genérico sobre el total real de preguntas que le llega) ni `examProgress.js` (las pestañas ya iteran `set.sections`/ítems reales, no una constante 32).

**Repaso post-examen (`ExamReview.jsx`):** la sección de repaso también necesita poder mostrar las 4 imágenes de un ítem de `conversation_image` en vez de texto — mismo patrón de renderizado que en el runner.

## Habilitación de `SET_STANDARD_40`

Una vez `conversation_image` tiene constructor de prompt y soporte en el pipeline, `sets/pipeline.js` deja de rechazar `SET_STANDARD_40` en `createSet` (hoy `FORMATO_SOPORTADO` solo permite `SET_STANDARD_36`). No existe una UI de "generar set" (los sets se crean vía `POST /api/sets/generate`, `SetPicker.jsx` solo lista los ya `complet`) — así que no hay selector que tocar ahí; el cambio real de exposición es que `setCompatibility.js` deje de rechazar el set una vez generado.

## Completar el set existente

`set-2026-08-06-xwwe` (el único set real en disco, `SET_STANDARD_36`, `complet`, 32 ítems) se completa a 40 con un **script puntual de una sola vez** (no una funcionalidad reusable del producto): agrega la sección `conversation_image` (4 ítems nuevos en `en_attente`) al `sections` array de su `set.json`, cambia `format` a `SET_STANDARD_40`, y vuelve a invocar `pipeline.run()` sobre ese mismo id — el pipeline ya es resumible por diseño (salta ítems en `pret`), así que solo procesa los 4 ítems nuevos sin tocar los 32 ya generados.

## Testing

- Backend: tests unitarios para el nuevo constructor de prompt (`conversation_image.js`), el catálogo de categorías/dimensiones, y el paso de generación de imágenes en `sets/pipeline.js` (mockeando el proveedor de imágenes igual que ya se mockea el de texto/TTS). `esFalloDeCuotaORed` ya tiene cobertura, solo se reutiliza.
- Frontend: `setCompatibility.js` gana tests para el caso `SET_STANDARD_40` (36/40) además del `SET_STANDARD_36` (32/36) ya cubierto. El nuevo renderizado de opciones-imagen en `ExamRunner.jsx`/`ExamReview.jsx` sigue la convención ya establecida del proyecto: sin test unitario, verificación solo por navegador (igual que el resto de `ExamRunner.jsx`).
- Verificación manual obligatoria (no delegable): generar un `SET_STANDARD_40` completo y aplicar la vara de calidad de 30 segundos por ítem antes de darlo por bueno; correr el examen completo en el runner y confirmar que las imágenes se ven, se precargan, y el `/699` y las pestañas de progreso escalan bien a 40 preguntas.
