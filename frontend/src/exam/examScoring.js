// Estimación lineal, claramente no oficial, del puntaje /699 del TEFAQ real
// -- la conversión oficial es un escalamiento psicométrico no público. El
// umbral B2 (400/699 ≈ 57.2%) es el mismo punto de calibración que el
// "~23+/40" del spec original, reexpresado para el formato de 36 preguntas
// realmente implementado (SET_STANDARD_36, sin pilotes -- el runner ya
// rechaza cualquier otro formato antes de que un intento pueda arrancar).
export function estimateScore699(correctTotal, totalQuestions) {
  if (!Number.isInteger(totalQuestions) || totalQuestions <= 0) {
    throw new Error(`totalQuestions inválido: ${totalQuestions}`);
  }
  if (!Number.isInteger(correctTotal) || correctTotal < 0 || correctTotal > totalQuestions) {
    throw new Error(`correctTotal inválido: ${correctTotal}`);
  }
  const estimated699 = Math.round((correctTotal / totalQuestions) * 699);
  const isB2 = estimated699 >= 400;
  const thresholdCount = Math.ceil((400 / 699) * totalQuestions);
  return { estimated699, isB2, thresholdCount };
}
