# Fidelidad visual del Runner de Modo Examen con el simulador oficial — Design Spec

## Contexto

El PR #4 (rama `feat/exam-review`) ya llevó el runner de Modo Examen a una primera paridad de UX con el simulador oficial TEF-CO: pantalla de instrucciones auto-timed por sección, franja de progreso de 32 ítems, barra de audio custom, radio buttons sin letras. Tras revisarlo en el navegador contra el simulador real (`lefrancaisdesaffaires.fr/documents/Tutoriel-TEF-CO/story.html`), el usuario pidió un segundo paso: acercar la fidelidad visual — header, tipografía, layout de cada pantalla — todavía más al original. Este spec cubre exclusivamente esa capa visual sobre el runner ya existente (`frontend/src/exam/ExamRunner.jsx` + `frontend/src/exam/examProgress.js`); no toca `examMachine.js` (el reducer no cambia, esto es 100% presentación), ni `ExamReview.jsx`/`ExamSummary.jsx`.

Dos mockups fueron aprobados explícitamente por el usuario en una sesión de brainstorming visual (companion en navegador) antes de este spec: la pantalla de instrucciones de sección y la pantalla principal de ítem (audio + pregunta + respuestas). Las decisiones de layout de este documento son las que quedaron validadas ahí, no una propuesta nueva.

**Restricciones ya fijadas en trabajo previo, no renegociables sin decisión explícita del usuario:** sin navegación libre (atrás/adelante), sin corrección durante el examen (vive solo en `ExamReview.jsx`), la franja/pestañas de progreso NUNCA son clicables.

## Branding: reales, no genéricos

El usuario decidió explícitamente usar el branding real de "Le Français des Affaires" / "CCI Paris Île-de-France" (no una versión genérica) — la app es una herramienta de práctica personal, no distribuida ni presentada como oficial, y el objetivo es sentirse lo más cerca posible del escenario real del examen.

**Assets:** el usuario coloca los archivos de imagen reales en `frontend/src/assets/`:
- `frontend/src/assets/le-francais-des-affaires-logo.png` (isotipo "LE FRANÇAIS DES AFFAIRES", rojo/azul, con el asterisco)
- `frontend/src/assets/cci-paris-logo.png` (badge "CCI PARIS ILE-DE-FRANCE EDUCATION", azul con ícono circular)

Si algún archivo falta al momento de implementar, la tarea correspondiente del plan debe fallar visiblemente (import roto), no hacer un fallback silencioso a texto — así se detecta de inmediato en vez de perderse en una revisión de código.

## 1. Header

Franja superior, borde inferior rojo de 3px (separador, no botón). Contenido, de izquierda a derecha:
- Logo "Le Français des Affaires" (imagen).
- Badge "CCI Paris Île-de-France Education" (imagen).
- A la derecha: texto de dos líneas, alineado a la derecha — **"Candidat(e)"** (línea 1, negrita) / **"Simulateur TEFAQ"** (línea 2) — reemplaza el nombre de usuario real de la referencia (no tenemos sistema de usuarios), mismo estilo visual (azul, dos líneas).

Aparece en las 3 pantallas del runner (section-intro, audio-failed, ítem principal) — mismo componente, sin variación entre ellas.

## 2. Contador global + barra fina

Debajo del header, alineado a la derecha: texto `{contestadas}/{total}` (ej. "6/32") + una barra fina (6px alto, ancho fijo ~160px) mostrando el progreso global como porcentaje, sin segmentos ni números — es un resumen compacto, no la franja de 32 ítems.

`{contestadas}` cuenta preguntas respondidas (no ítems) sobre el total de 36 del set. No reutiliza `computeResults` (esa función mide *corrección*, no *si fue respondida*, y solo tiene sentido llamarla al final) — se cuenta directamente recorriendo `state.answers` (`{ [sectionType]: { [itemRef]: { [questionIndex]: optionId } } }`, la misma estructura que ya puebla `ANSWER_SELECTED`): la cantidad de entradas `questionIndex -> optionId` en todo el árbol, sin importar si la opción elegida es correcta.

## 3. Franja de pestañas por sección (nueva) + franja global (existente, se simplifica)

Dos franjas separadas, cada una con su rol:

- **Franja superior, por sección** (nueva): pestañas tipo "Écran N", una por cada ítem de audio de la **sección actual únicamente** (no las 32) — con **números globales** (si la sección 2 empieza en el ítem 5 global, sus pestañas dicen "Écran 5, 6, 7..."), no reinician en 1 por sección. Estilo: pestaña activa en azul sólido con texto blanco, resto en gris claro con texto oscuro. No clicable.
- **Franja inferior, global** (ya existe desde el PR #4, se simplifica): los 32 segmentos de color por estado (completado/actual/pendiente) que ya tenemos — **se le quitan los números** que agregamos en el commit anterior (esos números ahora viven en la franja superior, por sección). Sigue sin ser clicable.

**Caption "ÉCRAN N"**: entre la franja de pestañas y el contenido, una línea de texto pequeña, gris claro, mayúsculas, mostrando el número global del ítem actual (ej. "ÉCRAN 6") — replica el caption que tiene el simulador oficial encima de cada pantalla de contenido, distinto de las pestañas.

**Nueva función pura en `examProgress.js`:**

```js
export function buildSectionTabs(set, state) {
  // Retorna { globalIndex, sectionTabs: [{ globalNumber, status }] }
  // globalIndex: posición global 1-N del ítem actual (para el caption "ÉCRAN N")
  // sectionTabs: solo los ítems de la sección de state.sectionIndex, con su
  // número GLOBAL (no reinicia en 1) y status 'completed'|'current'|'pending',
  // misma lógica de estado que ya usa buildProgressTabs (incluida la regla de
  // section-intro: ningún ítem de la sección es 'current' todavía).
}
```

Reutiliza la misma lógica de `status` que `buildProgressTabs` (no se duplica el cálculo completo — se factoriza el helper interno `tabStatus` para que ambas funciones lo compartan).

## 4. Pantalla de instrucciones de sección (section-intro)

Redistribución de textos según el mockup aprobado: título de la sección (ahora en **francés** — `SECTION_LABELS` pasa de español a francés, ej. "Anuncios públicos" → "Annonces publiques"), conteo de preguntas, texto instruccional (`SECTION_INSTRUCTIONS`, ya en francés desde el PR anterior), línea de tiempos (avant/apres, ya en francés), countdown. Layout: todo centrado verticalmente, como ya está — el cambio principal de esta pantalla es el header/franjas de arriba, no su cuerpo.

## 5. Pantalla principal de ítem (audio + pregunta + respuestas)

Layout de 2 columnas (tabla, no flexbox — más predecible), validado en el mockup:

- **Columna izquierda (300px fijo):** barra de audio custom — una sola franja rectangular (no píldora), con el ícono de play/pausa y el texto `MM:SS / MM:SS` **superpuestos dentro de la barra** (no como elementos separados al costado o debajo). Sin scrubbing, como ya establecido. La caja de nota roja "le jour du test..." del oficial **no se reproduce** — es texto específico del tutorial, no aplica a nuestro simulador.
- **Columna derecha (flexible):** pregunta(s) + opciones. Radio buttons sin letras (ya así desde el commit anterior), texto de opción explícitamente en negro (`#111`, no heredado), mismo padding horizontal/vertical en todas las filas (seleccionada y no seleccionadas) — solo cambia el fondo gris de la fila seleccionada, para que no se vean desalineadas.
- Para `interview`/`reportage` (2 preguntas por ítem, ya usan `OptionSelect`): misma estructura de 2 columnas, columna derecha con las 2 preguntas apiladas.

## 6. Idioma

Confirmado por el usuario: **todo el texto queda en francés desde que arranca el examen** (fase `running` en adelante), incluyendo chrome que hoy está en español — `SECTION_LABELS`, el conteo "X preguntas" → "X questions", y el botón "Abandonar" → **"Abandonner"**. Esto es una extensión explícita, ya documentada como excepción deliberada en `CLAUDE.md`, de la regla general "UI en español" — se aplica únicamente a las pantallas del runner durante el examen, no a `SetPicker`, `ExamSummary` ni `ExamReview` (esas pantallas se quedan en español, sin cambios de este plan).

## 7. Botón "Abandonner"

Sin equivalente en el diseño oficial (que tiene "Précédent"/"Suivant", explícitamente descartados por la regla de "sin navegación libre"). Se reubica a la posición donde el oficial tiene esos botones — pie de página, alineado a la derecha — como único control ahí, sin agregar navegación real. Estilo: outline rojo, texto rojo (visualmente distinto de un botón de acción primaria).

## Testing

- `examProgress.js`: `buildSectionTabs` es pura, se testea con los mismos fixtures de 2 secciones que ya usa `buildProgressTabs` — casos: ítem de la sección 1 (tabs con números 1..N), ítem de la sección 2 (tabs con números N+1..M, no reinician), `section-intro` de una sección (ningún tab 'current').
- Todo lo demás (header, layout de 2 columnas, franjas visuales, idioma) es presentación pura sin lógica — se verifica por code review + build, igual que el resto de `ExamRunner.jsx`. Sin navegador de pruebas en este entorno — **verificación manual del usuario obligatoria antes de mergear**, como ya viene siendo la norma en este proyecto.

## Documentación

`CLAUDE.md` se actualiza para mencionar `buildSectionTabs` en la lista de funciones puras de `examProgress.js`, y la extensión del idioma francés a todo el chrome del runner durante el examen.
