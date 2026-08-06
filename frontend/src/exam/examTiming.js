// Aritmética de deadlines para el Runner de examen. Cada fase se ancla a un
// deadline absoluto y siempre recalcula el tiempo restante desde el reloj,
// nunca desde el valor del tick anterior -- un tick tardío o saltado se
// autocorrige en el siguiente en vez de acumular error. chainDeadline es la
// pieza que evita que ESE error se filtre entre fases: calcula el próximo
// deadline sumando al anterior, no capturando el reloj vivo en el momento
// (posiblemente tardío) en que corre el callback de transición.

export function startPhase(durationSeconds, now = performance.now()) {
  return { deadline: now + durationSeconds * 1000 };
}

export function remainingSeconds(phaseState, now = performance.now()) {
  return Math.max(0, Math.ceil((phaseState.deadline - now) / 1000));
}

export function isExpired(phaseState, now = performance.now()) {
  return now >= phaseState.deadline;
}

export function chainDeadline(previousPhaseState, nextDurationSeconds) {
  return { deadline: previousPhaseState.deadline + nextDurationSeconds * 1000 };
}
