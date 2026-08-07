# Barra de audio continua (avant + audio) — Design Spec

## Contexto

El runner de Modo Examen (rama `feat/exam-review`, PR #4) ya tiene una barra de audio custom en la pantalla principal de ítem, visible solo durante `audio-pending`/`audio-playing`, con el ícono y el tiempo `MM:SS / MM:SS` superpuestos dentro de la barra. Durante `avant` (la espera antes de que arranque el audio) y `apres` (el tiempo para terminar de responder tras el audio), se muestra en su lugar un cronómetro grande rojo "00:XX", separado de la barra.

El usuario pidió unificar la espera (`avant`) con la reproducción real en una sola barra continua, y que la barra no desaparezca al terminar el audio sino que se quede visible como "terminada" durante `apres`. Este spec cubre exclusivamente ese cambio visual — no toca `examMachine.js` (reducer) ni `examTiming.js` (aritmética de deadlines), es presentación pura sobre datos que el componente ya calcula.

## Comportamiento

**Visibilidad de la barra:** pasa a mostrarse en las 4 fases del ítem — `avant`, `audio-pending`, `audio-playing`, `apres` — en vez de solo las 2 últimas.

**Fórmula de `elapsed`/`total`, por fase:**

| Fase | `elapsed` | `total` |
|---|---|---|
| `avant` | `Math.min(section.timing.avant, Math.max(0, section.timing.avant - remaining))` | `section.timing.avant + item.duree_audio_s` |
| `audio-pending` | `section.timing.avant` | (igual) |
| `audio-playing` | `section.timing.avant + audioCurrentTime` | (igual) |
| `apres` | `section.timing.avant + item.duree_audio_s` (= `total`, barra 100% llena) | (igual) |

`total` es constante para el ítem completo (no cambia entre fases) — se calcula una vez por render del ítem. El clamp en `avant` existe porque `remaining` es un valor de reloj (`Math.ceil`, recalculado cada `TICK_MS`) que puede momentáneamente leer 0 o un valor negativo-redondeado en el instante exacto de la transición de fase; sin el clamp, el porcentaje de relleno podría superar el 100% o bajar de 0% por un tick.

El texto superpuesto `MM:SS / MM:SS` (vía el `formatSeconds` ya existente) usa exactamente estos mismos `elapsed`/`total` — no hay una fuente de verdad separada para el texto vs. el ancho del relleno.

**Cronómetro grande rojo "00:XX":** su condición de render cambia de `state.phase === 'avant' || state.phase === 'apres'` a solo `state.phase === 'apres'` — deja de mostrarse durante `avant` (queda subsumido en la barra continua), sin cambios para `apres` (se sigue mostrando, ahora junto a la barra ya llena en vez de en su lugar).

**Texto de estado** ("Préparation de l'audio...", "Écoute en cours..."): sin cambios de condición — solo aparece en `audio-pending`/`audio-playing`. `avant` y `apres` no ganan un texto de estado nuevo.

**Ícono dentro de la barra:** sin cambios — sigue siendo el glifo estático `▶` en las 4 fases (no hay un estado de ícono distinto para "esperando" vs. "reproduciendo" vs. "terminado" — fuera de alcance, no lo pidió el usuario).

## Testing

Presentación pura, sin módulo nuevo ni lógica nueva fuera de `ExamRunner.jsx` — sin tests unitarios nuevos, consistente con la convención ya establecida del proyecto (`ExamRunner.jsx` es verificado solo por navegador). Verificación manual del usuario, agregada al checklist ya existente del PR: confirmar que la barra arranca a llenarse desde que empieza `avant` (no aparece vacía y de golpe a mitad de camino), que no hay salto visual perceptible en el instante en que el audio real empieza a sonar, y que en `apres` la barra queda visiblemente al 100% (no vacía, no a medias) junto al cronómetro.

## Documentación

`CLAUDE.md` no necesita cambios — la oración ya agregada en el incremento anterior ("a custom, non-scrubbable progress bar... showing elapsed/total time... overlaid inside the bar itself") sigue siendo cierta; solo cambia CUÁNDO se muestra y qué mide `elapsed`/`total`, no la naturaleza del componente. Este plan no incluye una tarea de documentación.
