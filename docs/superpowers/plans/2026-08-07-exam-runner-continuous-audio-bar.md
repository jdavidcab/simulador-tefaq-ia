# Continuous Avant+Audio Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the exam runner's audio progress bar with the `avant` waiting period into one continuous fill, and keep the bar visible (fully filled) through `apres` instead of disappearing when the audio ends.

**Architecture:** Single-file presentation change in `frontend/src/exam/ExamRunner.jsx`. The bar's `elapsed`/`total` seconds are computed once per render, per phase, from data the component already tracks (`remaining`, `audioCurrentTime`, `section.timing.avant`, `item.duree_audio_s`) — no reducer (`examMachine.js`) or timing-arithmetic (`examTiming.js`) changes.

**Tech Stack:** React 18, Tailwind utility classes (no new dependencies).

## Global Constraints

- La barra pasa a mostrarse en las 4 fases del ítem (`avant`, `audio-pending`, `audio-playing`, `apres`), no solo `audio-pending`/`audio-playing`.
- `total` es constante por ítem: `section.timing.avant + item.duree_audio_s`.
- `elapsed` por fase: `avant` → `min(avant, max(0, avant - remaining))`; `audio-pending` → `avant` (fijo); `audio-playing` → `avant + audioCurrentTime`; `apres` → `total` (fijo, barra 100%).
- El texto superpuesto `MM:SS / MM:SS` usa los mismos `elapsed`/`total` que el ancho del relleno — una sola fuente de verdad.
- El cronómetro grande rojo "00:XX" deja de mostrarse en `avant`; se mantiene sin cambios en `apres`.
- El texto de estado ("Préparation de l'audio...", "Écoute en cours...") no cambia de condición — nada nuevo para `avant`/`apres`.
- Sin cambios en `examMachine.js`, `examTiming.js`, ni ningún módulo puro testeado. Sin tests nuevos — `ExamRunner.jsx` sigue siendo verificado solo por navegador.

---

### Task 1: Barra continua avant + audio en `ExamRunner.jsx`

**Files:**
- Modify: `frontend/src/exam/ExamRunner.jsx`

**Interfaces:**
- No produce ni consume nada de/para otras tasks — es la única task del plan.

- [ ] **Step 1: Reemplazar el bloque del cronómetro + barra de audio**

Este es el bloque actual completo (la rama `else` que maneja el ítem principal, desde su apertura hasta el cierre de la celda izquierda de la tabla):

```jsx
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    const useSelect = SELECT_SECTIONS.has(section.type);
    body = (
      <div className="space-y-4">
        {(state.phase === 'avant' || state.phase === 'apres') && (
          <div className="text-center text-4xl font-mono text-red-600">
            00:{remaining.toString().padStart(2, '0')}
          </div>
        )}

        <table className="w-full border-collapse table-fixed">
          <tbody>
            <tr>
              <td className="w-[300px] align-top py-2 pr-6">
                {state.phase === 'audio-pending' && <p className="text-center text-blue-600 mb-2 text-sm">Préparation de l'audio...</p>}
                {state.phase === 'audio-playing' && <p className="text-center text-blue-600 mb-2 text-sm">Écoute en cours...</p>}
                {(state.phase === 'audio-pending' || state.phase === 'audio-playing') && (
                  <div className="relative h-[22px] bg-gray-400 rounded overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-gray-500"
                      style={{ width: `${item.duree_audio_s > 0 ? Math.min(100, (audioCurrentTime / item.duree_audio_s) * 100) : 0}%` }}
                    />
                    <div className="absolute inset-y-0 left-0 w-5 bg-gray-700 flex items-center justify-center text-white text-[9px]">
                      &#9654;
                    </div>
                    <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-mono text-gray-50">
                      {formatSeconds(audioCurrentTime)} / {formatSeconds(item.duree_audio_s)}
                    </span>
                  </div>
                )}
              </td>
```

Reemplazarlo por completo con:

```jsx
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    const useSelect = SELECT_SECTIONS.has(section.type);
    const totalBarSeconds = section.timing.avant + item.duree_audio_s;
    let elapsedBarSeconds = 0;
    if (state.phase === 'avant') {
      elapsedBarSeconds = Math.min(section.timing.avant, Math.max(0, section.timing.avant - remaining));
    } else if (state.phase === 'audio-pending') {
      elapsedBarSeconds = section.timing.avant;
    } else if (state.phase === 'audio-playing') {
      elapsedBarSeconds = section.timing.avant + audioCurrentTime;
    } else if (state.phase === 'apres') {
      elapsedBarSeconds = totalBarSeconds;
    }
    body = (
      <div className="space-y-4">
        {state.phase === 'apres' && (
          <div className="text-center text-4xl font-mono text-red-600">
            00:{remaining.toString().padStart(2, '0')}
          </div>
        )}

        <table className="w-full border-collapse table-fixed">
          <tbody>
            <tr>
              <td className="w-[300px] align-top py-2 pr-6">
                {state.phase === 'audio-pending' && <p className="text-center text-blue-600 mb-2 text-sm">Préparation de l'audio...</p>}
                {state.phase === 'audio-playing' && <p className="text-center text-blue-600 mb-2 text-sm">Écoute en cours...</p>}
                <div className="relative h-[22px] bg-gray-400 rounded overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gray-500"
                    style={{ width: `${totalBarSeconds > 0 ? Math.min(100, (elapsedBarSeconds / totalBarSeconds) * 100) : 0}%` }}
                  />
                  <div className="absolute inset-y-0 left-0 w-5 bg-gray-700 flex items-center justify-center text-white text-[9px]">
                    &#9654;
                  </div>
                  <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-mono text-gray-50">
                    {formatSeconds(elapsedBarSeconds)} / {formatSeconds(totalBarSeconds)}
                  </span>
                </div>
              </td>
```

Nota: la barra ya no está envuelta en una condición de fase (`{(state.phase === 'audio-pending' || state.phase === 'audio-playing') && (...)}`) — se elimina esa envoltura porque la rama `else` que la contiene solo se alcanza cuando la fase es `avant`, `audio-pending`, `audio-playing` o `apres` (las otras dos fases posibles, `section-intro` y `audio-failed`, tienen sus propias ramas `if`/`else if` anteriores que ya retornan un `body` distinto) — así que la barra debe renderizarse siempre dentro de esta rama, sin gate adicional.

El resto del archivo (la celda derecha de la tabla con las preguntas/opciones, el header/footer compartido, las otras dos ramas de `body`) no cambia.

- [ ] **Step 2: Verificar el build**

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 3: Verificar que los tests existentes siguen pasando**

Run: `cd frontend && npm test`
Expected: 61/61 (este cambio no toca ningún módulo con tests unitarios, solo confirma que nada más se rompió).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/exam/ExamRunner.jsx
git commit -m "feat(exam): unify avant wait and audio playback into one continuous progress bar"
```

- [ ] **Step 5: Checklist de verificación manual (obligatorio, no delegable a un agente)**

Ningún agente en este entorno tiene navegador — este paso lo hace el usuario:

- [ ] Al entrar a un ítem, la barra ya se ve llenándose desde el arranque de `avant` (no aparece vacía y de golpe a mitad de camino cuando empieza el audio).
- [ ] No hay salto visual perceptible en el instante exacto en que el audio real empieza a sonar (la barra sigue avanzando sin reiniciarse a 0%).
- [ ] El cronómetro grande rojo ya NO aparece durante `avant` (antes sí aparecía).
- [ ] Al terminar el audio (fase `apres`), la barra queda visiblemente al 100% (llena), no vacía ni a medias, junto con el cronómetro de `apres` (que sigue mostrándose igual que antes).
- [ ] El texto `MM:SS / MM:SS` superpuesto en la barra coincide con lo que muestra el relleno en todo momento (espera + audio, sin cortes).
