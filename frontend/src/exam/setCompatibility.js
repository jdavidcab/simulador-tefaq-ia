// Un set con pilotes:true agrega 4 ítems extra de una pregunta (ver
// backend/src/topics/planner.js) -- sigue reportando format:'SET_STANDARD_36'
// y, al completarse, statut:'complet', pero trae 36 ítems / 40 preguntas en
// vez de 32/36. Este runner está construido contra el contrato 32/36 en todas
// partes (progreso de precarga, conteos de sección, layout del resumen) y
// rechaza explícitamente lo que no lo cumpla, en vez de generalizarlo a
// medias -- puntuar ítems piloto le corresponde a una fase futura.
export function checkSetCompatibility(set) {
  if (set.format !== 'SET_STANDARD_36') {
    return { ok: false, reason: `Formato no soportado por este runner: "${set.format}".` };
  }
  if (set.pilotes) {
    return { ok: false, reason: 'Este set no es compatible con este runner (fue generado con pilotos).' };
  }
  const items = set.sections.flatMap(section => section.items);
  if (items.length !== 32) {
    return { ok: false, reason: `Este set tiene ${items.length} ítems de audio; este runner espera exactamente 32.` };
  }
  const questionCount = items.reduce((total, item) => total + item.questions.length, 0);
  if (questionCount !== 36) {
    return { ok: false, reason: `Este set tiene ${questionCount} preguntas; este runner espera exactamente 36.` };
  }
  return { ok: true };
}
