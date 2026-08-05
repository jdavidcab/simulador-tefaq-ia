import { normalizeText, contentWords } from './frenchWords.js';

// 1.0 si la cita aparece literalmente (tras normalizar); si no, fracción de sus
// palabras de contenido distintas que aparecen en el transcript.
export function scoreJustification(justification, transcript) {
  const citaNorm = normalizeText(justification);
  const transcriptNorm = normalizeText(transcript);
  if (!citaNorm) return 0;
  if (transcriptNorm.includes(citaNorm)) return 1;

  const palabrasCita = contentWords(justification);
  if (palabrasCita.length === 0) return 0;
  const palabrasTranscript = new Set(normalizeText(transcript).split(' '));
  const presentes = palabrasCita.filter(palabra => palabrasTranscript.has(palabra)).length;
  return presentes / palabrasCita.length;
}

export function checkJustification(justification, transcript, config) {
  const texto = String(justification ?? '').trim();
  if (!texto) {
    return { ok: false, score: 0, error: 'falta "justification"' };
  }

  const palabras = contentWords(texto);
  if (palabras.length < config.justificationMinContentWords) {
    // Sin esta guarda, una "cita" de tres palabras hace match trivial.
    return {
      ok: false,
      score: scoreJustification(texto, transcript),
      error: `"justification" necesita al menos ${config.justificationMinContentWords} palabras de contenido, tiene ${palabras.length}`,
    };
  }

  const score = scoreJustification(texto, transcript);
  if (score < config.justificationThreshold) {
    return {
      ok: false,
      score,
      error: `"justification" no aparece en el transcript (score ${score.toFixed(2)} < ${config.justificationThreshold})`,
    };
  }

  return { ok: true, score };
}
