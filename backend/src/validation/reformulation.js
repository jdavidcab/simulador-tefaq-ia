import { contentWords } from './frenchWords.js';
import { scoreJustification } from './justification.js';

const REFORMULATION_TYPES = ['nominalisation', 'synonyme', 'restructuration'];

// Aplica solo a las 6 secciones de opciones generadas por el modelo (no
// micro_trottoir, cuyas opciones son posturas fijas, ni conversation_image,
// que tiene su propio esquema de opciones-imagen).
export function checkReformulation(question, transcript, config) {
  const correctOption = question.options.find(option => option.id === question.correctId);

  const overlapScore = scoreJustification(correctOption.text, question.justification);
  if (overlapScore > config.reformulationOverlapThreshold) {
    throw new Error(
      `reformulation: la opción correcta solapa ${(overlapScore * 100).toFixed(0)}% con el audio `
      + `(máximo ${(config.reformulationOverlapThreshold * 100).toFixed(0)}%) -- no está reformulada`,
    );
  }

  const palabrasTranscript = new Set(contentWords(transcript));
  const hayTrampaLiteral = question.options
    .filter(option => option.id !== question.correctId)
    .some(option => contentWords(option.text)
      .filter(palabra => palabrasTranscript.has(palabra)).length >= config.reformulationMinTrapWords);
  if (!hayTrampaLiteral) {
    throw new Error(
      `reformulation: ningún distractor recicla al menos ${config.reformulationMinTrapWords} `
      + 'palabras literales del audio (trampa obligatoria ausente)',
    );
  }

  if (!REFORMULATION_TYPES.includes(question.reformulationType)) {
    throw new Error(
      `reformulation: "reformulationType" debe ser uno de ${REFORMULATION_TYPES.join('|')}, `
      + `llegó "${question.reformulationType}"`,
    );
  }

  question.reformulation = {
    extrait_audio: question.justification,
    option_correcte: correctOption.text,
    type: question.reformulationType,
  };
}
