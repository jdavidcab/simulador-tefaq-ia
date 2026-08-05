import { TEFAQ_TOPICS, buildSystemPrompt } from './prompt.js';
import { AUTO_CHAIN } from './providers/index.js';
import { pickTefaqPattern } from './tefaqPatterns.js';

// Quitar posibles bloques de código markdown del output (```json ... ``` o ``` ... ```)
function cleanMarkdown(text) {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/```(?:json)?/g, '').trim();
  return t;
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function getWordRangeTolerance(minWords, maxWords) {
  return {
    min: Math.max(1, minWords - 2),
    max: maxWords + 2,
  };
}

// Validación estructural: si falta algo, cuenta como fallo del provider
function validateQuestion(data, { minWords = 30, maxWords = 50 } = {}) {
  if (!data || typeof data !== 'object') throw new Error('la respuesta no es un objeto JSON');
  if (typeof data.prompt !== 'string' || !data.prompt.trim()) throw new Error('falta "prompt"');
  if (!Array.isArray(data.options) || data.options.length !== 4) {
    throw new Error('"options" debe ser un array de 4 elementos');
  }
  for (const opt of data.options) {
    if (!opt || typeof opt.id !== 'string' || typeof opt.text !== 'string') {
      throw new Error('opción inválida (cada una requiere "id" y "text")');
    }
  }
  if (typeof data.transcript !== 'string' || !data.transcript.trim()) throw new Error('falta "transcript"');
  const transcriptWords = countWords(data.transcript.trim());
  const toleratedRange = getWordRangeTolerance(minWords, maxWords);
  if (transcriptWords < toleratedRange.min || transcriptWords > toleratedRange.max) {
    throw new Error(`"transcript" fuera de rango: ${transcriptWords} palabras (esperadas ${minWords}-${maxWords}, tolerancia ${toleratedRange.min}-${toleratedRange.max})`);
  }
  if (!['A', 'B', 'C', 'D'].includes(data.correctId)) throw new Error('"correctId" debe ser A, B, C o D');
  if (!data.options.some(opt => opt.id === data.correctId)) {
    throw new Error('"correctId" no coincide con ninguna opción');
  }
  if (typeof data.feedback !== 'string' || !data.feedback.trim()) throw new Error('falta "feedback"');
  return data;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeFeedback(feedback, correctId) {
  const text = feedback.trim();
  const sentences = text.split(/(?<=[.?!])\s+/);
  const firstSentence = sentences[0] ?? '';
  const rest = sentences.slice(1).join(' ').trim();

  const looksLikeLetterAssertion = /(opci(?:ón|on)|option|respuesta|réponse|answer|correct|correcte|bonne|buena).*\b[ABCD]\b/i.test(firstSentence);
  const reasonMatch = firstSentence.match(/\b(?:porque|car|because)\b\s*(.+?)[.?!]?$/i);

  let body = text;
  if (looksLikeLetterAssertion && reasonMatch?.[1]) {
    body = reasonMatch[1].trim();
    if (rest) body = `${body}. ${rest}`;
  } else if (looksLikeLetterAssertion) {
    body = rest;
  }

  body = body
    .replace(/\b[Ll]as?\s+(?:opciones|options?)\s+[ABCD](?:\s*(?:y|et|and|,)\s*[ABCD])*/g, 'las otras opciones')
    .replace(/\b[Ll]a\s+(?:opci(?:ón|on)|option|respuesta|réponse|answer)\s+[ABCD]\b/g, 'esa opción')
    .replace(/\b[Tt]he\s+(?:option|answer)\s+[ABCD]\b/g, 'that option')
    .trim();

  if (!body) return `La opción ${correctId} es correcta según la información del anuncio.`;

  body = body.charAt(0).toUpperCase() + body.slice(1);

  return `La opción ${correctId} es correcta. ${body}`;
}

function randomizeCorrectOption(data) {
  const originalCorrect = data.options.find(opt => opt.id === data.correctId);
  const shuffledOptions = shuffle(data.options).map((opt, index) => ({
    ...opt,
    originalId: opt.id,
    id: ['A', 'B', 'C', 'D'][index],
  }));

  const nextCorrect = shuffledOptions.find(opt => opt.text === originalCorrect.text);
  if (!nextCorrect) throw new Error('No se pudo remapear la opción correcta tras mezclar las opciones');

  return {
    ...data,
    options: shuffledOptions.map(({ originalId, ...option }) => option),
    correctId: nextCorrect.id,
    feedback: normalizeFeedback(data.feedback, nextCorrect.id),
  };
}

// Bridge: la abstracción (qué se genera, cómo se valida) desacoplada de
// la implementación (qué provider/modelo lo genera).
export function createQuestionGenerator(providers) {
  return {
    async generateQuestion(selector = 'auto', wordRange = {}) {
      const requested = selector === 'auto' ? AUTO_CHAIN : [selector];
      const available = requested.filter(key => providers[key]);
      const skipped = requested.filter(key => !providers[key]);

      if (skipped.length > 0) {
        console.warn(`[generator] providers no configurados, se omiten: ${skipped.join(', ')}`);
      }
      if (available.length === 0) {
        const err = new Error(`Ningún provider de la cadena [${requested.join(' → ')}] está configurado`);
        err.providersTried = [];
        throw err;
      }

      const topic = TEFAQ_TOPICS[Math.floor(Math.random() * TEFAQ_TOPICS.length)];
      const prompt = buildSystemPrompt(topic, { ...wordRange, pattern: pickTefaqPattern() });

      const errors = [];
      for (const key of available) {
        const provider = providers[key];
        try {
          const text = await provider.generate(prompt);
          const data = randomizeCorrectOption(validateQuestion(JSON.parse(cleanMarkdown(text)), wordRange));
          return { ...data, provider: provider.name };
        } catch (error) {
          console.error(`[generator] ${provider.name} falló: ${error.message}`);
          errors.push({ provider: provider.name, error: error.message });
        }
      }

      const err = new Error('Todos los providers de la cadena fallaron');
      err.providersTried = errors;
      throw err;
    },
  };
}
