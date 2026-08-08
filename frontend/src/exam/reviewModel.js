// Por cada ítem de audio, calcula el estado de cada una de sus preguntas
// y el conteo correcto/total a nivel ítem y a nivel sección. No toca DOM,
// no depende de React -- mismo principio que computeResults en
// examMachine.js, separado de cómo ExamReview lo renderiza.
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
        return {
          questionIndex,
          selectedId: selectedId ?? null,
          correctId: question.correctId,
          answered,
          isCorrect,
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
