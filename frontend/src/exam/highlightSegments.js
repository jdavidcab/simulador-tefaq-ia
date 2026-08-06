// Ubica cada justification dentro de su transcript, normalizando igual que
// el backend (validation/frenchWords.js: diacríticos fuera, minúsculas,
// puntuación/espacios colapsados) pero devolviendo offsets sobre el
// transcript ORIGINAL -- la normalización cambia el largo del string, así
// que machear en el texto normalizado y cortar el original en los mismos
// índices sería incorrecto. Solo el primer match de cada justification
// cuenta. Construye los segmentos del transcript COMPLETO de una sola vez
// para que justifications solapadas, adyacentes o idénticas queden
// resueltas por construcción: cada segmento lleva la lista de qué
// preguntas lo justifican, no una sola.
//
// Duplicado deliberado de la normalización del backend (mismo patrón que
// frontend/src/trainingScan.js vs backend/src/validation/frenchWords.js):
// son dos paquetes npm sin workspace compartido.

function normalizeWithMap(text) {
  const original = String(text);
  let normalized = '';
  const map = [];
  let inSpaceRun = true; // evita un espacio inicial si el texto empieza con puntuación

  for (let i = 0; i < original.length; i += 1) {
    const decomposed = original[i].normalize('NFD').replace(/\p{Diacritic}/gu, '');
    for (const dch of decomposed) {
      if (/[\p{L}\p{N}]/u.test(dch)) {
        normalized += dch.toLowerCase();
        map.push(i);
        inSpaceRun = false;
      } else if (!inSpaceRun) {
        normalized += ' ';
        map.push(i);
        inSpaceRun = true;
      }
    }
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }

  return { normalized, map };
}

function findFirstMatch(transcript, justification) {
  const { normalized: normTranscript, map } = normalizeWithMap(transcript);
  const { normalized: normJustification } = normalizeWithMap(justification);
  if (!normJustification) return null;

  const idx = normTranscript.indexOf(normJustification);
  if (idx === -1) return null;

  const start = map[idx];
  const end = map[idx + normJustification.length - 1] + 1;
  return { start, end };
}

export function buildHighlightSegments(transcript, questionJustifications) {
  const spans = [];
  for (const { questionIndex, justification } of questionJustifications) {
    const match = findFirstMatch(transcript, justification);
    if (match) spans.push({ ...match, questionIndex });
  }

  if (spans.length === 0) {
    return [{ text: transcript, questionIndexes: [] }];
  }

  const boundaries = new Set([0, transcript.length]);
  for (const span of spans) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  const segments = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];
    if (start === end) continue;
    const questionIndexes = spans
      .filter(span => span.start <= start && span.end >= end)
      .map(span => span.questionIndex);
    segments.push({ text: transcript.slice(start, end), questionIndexes });
  }
  return segments;
}
