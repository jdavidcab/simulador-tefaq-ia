// Contrato propio de drill/, sin importar ni extender exam/setCompatibility.js
// -- esa función es de Modo Examen, y esta es deliberadamente su propia
// pieza independiente (mismo dato de fondo -- items/questions -- pero sin
// acoplar los dos contratos).
const CONTRATO = { items: 12, questions: 12 };

export function checkDrillSetCompatibility(set) {
  if (set.format !== 'SET_DRILL_PARAPHRASE') {
    return { ok: false, reason: `Formato no soportado por el drill: "${set.format}".` };
  }
  if (set.pilotes) {
    return { ok: false, reason: 'Este set no es compatible con el drill (fue generado con pilotos).' };
  }
  const items = set.sections.flatMap(section => section.items);
  if (items.length !== CONTRATO.items) {
    return { ok: false, reason: `Este set tiene ${items.length} ítems; el drill espera exactamente ${CONTRATO.items}.` };
  }
  const questionCount = items.reduce((total, item) => total + item.questions.length, 0);
  if (questionCount !== CONTRATO.questions) {
    return { ok: false, reason: `Este set tiene ${questionCount} preguntas; el drill espera exactamente ${CONTRATO.questions}.` };
  }
  return { ok: true };
}
