// Por cada ítem de audio, calcula el estado de cada una de sus preguntas
// y el conteo correcto/total a nivel ítem y a nivel sección. No toca DOM,
// no depende de React -- mismo principio que computeResults en
// examMachine.js, separado de cómo ExamReview lo renderiza.

const REFORMULATION_TYPES = ['nominalisation', 'synonyme', 'restructuration'];

// Única fuente de verdad de "¿corresponde mostrar el puente de
// reformulación en esta pregunta?" -- exige pregunta fallada (isCorrect
// false, lo que incluye "sin responder") Y metadata bien formada. Cualquier
// otra combinación (pregunta correcta, campo ausente, string vacío, tipo
// desconocido) se trata como "no hay puente que mostrar", nunca como un
// bloque a medio llenar. En la práctica `type` siempre es válido cuando
// `reformulation` existe (la Parte A ya lo valida antes de adjuntarlo),
// pero este chequeo no confía en esa garantía externa -- la revalida.
function buildReformulationInfo(question, isCorrect) {
  if (isCorrect) return null;
  const r = question.reformulation;
  if (!r) return null;
  if (typeof r.extrait_audio !== 'string' || !r.extrait_audio.trim()) return null;
  if (typeof r.option_correcte !== 'string' || !r.option_correcte.trim()) return null;
  if (!REFORMULATION_TYPES.includes(r.type)) return null;
  return { extrait_audio: r.extrait_audio, option_correcte: r.option_correcte, type: r.type };
}

export function buildReviewModel(set, answers) {
  const sections = set.sections.map(section => {
    const items = section.items.map(item => {
      const itemAnswers = answers[section.type]?.[item.ref] ?? {};
      const questions = item.questions.map((question, questionIndex) => {
        const selectedId = itemAnswers[questionIndex];
        // `null` significa "el tiempo se agotó sin respuesta" (ver
        // lockInUnanswered en examMachine.js) -- se muestra igual que
        // `undefined` ("nunca se visitó"), ninguno de los dos es una
        // selección real.
        const answered = selectedId !== undefined && selectedId !== null;
        const isCorrect = answered && selectedId === question.correctId;
        // Sets de antes de la Parte C1 (o de antes de la Parte A) nunca
        // traen `options` con la forma esperada -- no asumir su presencia.
        const selectedOption = answered && Array.isArray(question.options)
          ? question.options.find(option => option.id === selectedId)
          : undefined;
        return {
          questionIndex,
          selectedId: selectedId ?? null,
          correctId: question.correctId,
          answered,
          isCorrect,
          reformulation: buildReformulationInfo(question, isCorrect),
          selectedLiteralTrap: Boolean(selectedOption?.literalTrap),
        };
      });
      const correctCount = questions.filter(q => q.isCorrect).length;
      return { ref: item.ref, correctCount, questionCount: questions.length, questions };
    });
    const correctCount = items.reduce((sum, item) => sum + item.correctCount, 0);
    const questionCount = items.reduce((sum, item) => sum + item.questionCount, 0);
    return { type: section.type, correctCount, questionCount, items };
  });
  return { sections };
}
