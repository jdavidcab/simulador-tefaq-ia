import {
  SECTION_PRESETS, MICRO_TROTTOIR_POSTURES, wordTolerance, CONFIG as DEFAULT_CONFIG,
} from '../examFormat.js';
import { checkJustification } from './justification.js';

export function countWords(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function validarPregunta(question, transcript, config, expectedOptions = 4) {
  if (!question || typeof question !== 'object') throw new Error('pregunta inválida');
  if (typeof question.prompt !== 'string' || !question.prompt.trim()) throw new Error('falta "prompt"');

  if (!Array.isArray(question.options) || question.options.length !== expectedOptions) {
    throw new Error(`"options" debe ser un array de ${expectedOptions} elementos`);
  }
  for (const option of question.options) {
    if (!option || typeof option.id !== 'string' || typeof option.text !== 'string' || !option.text.trim()) {
      throw new Error('opción inválida (cada una requiere "id" y "text")');
    }
  }

  if (!['A', 'B', 'C', 'D'].includes(question.correctId)) throw new Error('"correctId" debe ser A, B, C o D');
  if (!question.options.some(option => option.id === question.correctId)) {
    throw new Error('"correctId" no coincide con ninguna opción');
  }
  if (typeof question.feedback !== 'string' || !question.feedback.trim()) throw new Error('falta "feedback"');

  const cita = checkJustification(question.justification, transcript, config);
  if (!cita.ok) throw new Error(cita.error);
  question.justificationScore = cita.score;
}

function validarMicroTrottoir(item, posture, config) {
  const esperadas = MICRO_TROTTOIR_POSTURES[config.microTrottoirOptions];
  const question = item.questions[0];
  const textos = question.options.map(option => option.text.trim());

  if (textos.length !== esperadas.length || textos.some((texto, i) => texto !== esperadas[i])) {
    throw new Error(`micro_trottoir: las opciones deben ser exactamente las posturas del preset, en orden: ${esperadas.join(' | ')}`);
  }
  if (posture) {
    const correcta = question.options.find(option => option.id === question.correctId).text.trim();
    if (correcta !== posture) {
      throw new Error(`micro_trottoir: la postura correcta es "${correcta}" pero se pidió "${posture}"`);
    }
  }
}

function validarInterview(item) {
  const etiquetas = [...item.transcript.matchAll(/(^|\s)([A-ZÀ-Ý][\wÀ-ÿ'()’ -]{2,20}):/g)]
    .map(match => match[2].trim());
  const distintas = new Set(etiquetas);
  if (distintas.size < 2) {
    throw new Error('interview: el transcript debe ser un diálogo con al menos dos hablantes etiquetados');
  }
  const alterna = etiquetas.some((etiqueta, i) => i > 0 && etiqueta !== etiquetas[i - 1]);
  if (!alterna) throw new Error('interview: el transcript no muestra alternancia entre hablantes');
}

export function validateItem(item, sectionType, opts = {}) {
  const config = opts.config ?? DEFAULT_CONFIG;
  const preset = SECTION_PRESETS[sectionType];
  if (!preset) throw new Error(`Tipo de sección desconocido: ${sectionType}`);

  if (!item || typeof item !== 'object') throw new Error('la respuesta no es un objeto JSON');
  if (typeof item.transcript !== 'string' || !item.transcript.trim()) throw new Error('falta "transcript"');

  const minWords = opts.minWords ?? preset.minWords;
  const maxWords = opts.maxWords ?? preset.maxWords;
  const tolerancia = wordTolerance(maxWords);
  const total = countWords(item.transcript.trim());
  if (total < minWords - tolerancia || total > maxWords + tolerancia) {
    throw new Error(`"transcript" fuera de rango: ${total} palabras (esperadas ${minWords}-${maxWords}, tolerancia ±${tolerancia})`);
  }

  if (!Array.isArray(item.questions) || item.questions.length !== preset.questionsPerAudio) {
    throw new Error(`"${sectionType}" requiere ${preset.questionsPerAudio} preguntas, llegaron ${item.questions?.length ?? 0}`);
  }
  // micro_trottoir tiene tantas opciones como posturas del preset (3 o 4);
  // el resto de secciones son siempre QCM de 4 opciones.
  const expectedOptions = sectionType === 'micro_trottoir'
    ? MICRO_TROTTOIR_POSTURES[config.microTrottoirOptions].length
    : 4;
  for (const question of item.questions) validarPregunta(question, item.transcript, config, expectedOptions);

  if (sectionType === 'micro_trottoir') validarMicroTrottoir(item, opts.posture, config);
  if (sectionType === 'interview') validarInterview(item);

  return item;
}
