// Un set con pilotes:true agrega 4 ítems extra de una pregunta (ver
// backend/src/topics/planner.js) -- sigue reportando el mismo format y, al
// completarse, statut:'complet', pero trae ítems/preguntas de más. Este
// runner está construido contra un contrato fijo de ítems/preguntas por
// formato en todas partes (progreso de precarga, conteos de sección, layout
// del resumen) y rechaza explícitamente lo que no lo cumpla, en vez de
// generalizarlo a medias -- puntuar ítems piloto le corresponde a una fase
// futura.
const CONTRATOS = {
  SET_STANDARD_36: { items: 32, questions: 36 },
  SET_STANDARD_40: { items: 36, questions: 40 },
};

export function checkSetCompatibility(set) {
  const contrato = CONTRATOS[set.format];
  if (!contrato) {
    return { ok: false, reason: `Formato no soportado por este runner: "${set.format}".` };
  }
  if (set.pilotes) {
    return { ok: false, reason: 'Este set no es compatible con este runner (fue generado con pilotos).' };
  }
  const items = set.sections.flatMap(section => section.items);
  if (items.length !== contrato.items) {
    return { ok: false, reason: `Este set tiene ${items.length} ítems de audio; este runner espera exactamente ${contrato.items}.` };
  }
  const questionCount = items.reduce((total, item) => total + item.questions.length, 0);
  if (questionCount !== contrato.questions) {
    return { ok: false, reason: `Este set tiene ${questionCount} preguntas; este runner espera exactamente ${contrato.questions}.` };
  }
  return { ok: true };
}
