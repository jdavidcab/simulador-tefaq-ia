// Presets del formato TEFAQ. SOLO DATOS: aquí se calibra contra el examen real.
// Tiempos en segundos, del livret oficial 2024.
export const SECTION_PRESETS = {
  conversation_image: { bloc: 1, questions: 4,  avant: 5,  apres: 10, questionsPerAudio: 1, minWords: 40,  maxWords: 55,  lectures: 1 },
  annonce_publique:   { bloc: 2, questions: 4,  avant: 10, apres: 10, questionsPerAudio: 1, minWords: 30,  maxWords: 60,  lectures: 1 },
  repondeur:          { bloc: 2, questions: 6,  avant: 10, apres: 10, questionsPerAudio: 1, minWords: 30,  maxWords: 60,  lectures: 1 },
  micro_trottoir:     { bloc: 2, questions: 6,  avant: 5,  apres: 15, questionsPerAudio: 1, minWords: 40,  maxWords: 70,  lectures: 1 },
  chronique:          { bloc: 3, questions: 2,  avant: 10, apres: 15, questionsPerAudio: 1, minWords: 100, maxWords: 150, lectures: 1 },
  interview:          { bloc: 3, questions: 6,  avant: 20, apres: 30, questionsPerAudio: 2, minWords: 200, maxWords: 300, lectures: 1 },
  reportage:          { bloc: 3, questions: 2,  avant: 10, apres: 15, questionsPerAudio: 2, minWords: 150, maxWords: 220, lectures: 1 },
  divers:             { bloc: 4, questions: 10, avant: 10, apres: 15, questionsPerAudio: 1, minWords: 60,  maxWords: 120, lectures: 1 },
};

// Las 7 secciones que comparten la ruta genérica de generación (texto ->
// audio). No incluye conversation_image: tiene su propio constructor de
// prompt y un paso extra de generación de imágenes (ver sets/pipeline.js).
// SET_STANDARD_40 la antepone aparte (no aquí) para no duplicarla.
export const GENERABLE_SECTIONS = [
  'annonce_publique', 'repondeur', 'micro_trottoir',
  'chronique', 'interview', 'reportage', 'divers',
];

export const SET_COMPOSITIONS = {
  SET_STANDARD_36: [...GENERABLE_SECTIONS],
  SET_STANDARD_40: ['conversation_image', ...GENERABLE_SECTIONS],
};

// Los ítems pilote deben aportar exactamente 1 pregunta cada uno para que
// 36 + 4 = 40. Un pilote de interview aportaría 2 y la cuenta saldría 38.
export const SINGLE_QUESTION_SECTIONS = GENERABLE_SECTIONS
  .filter(type => SECTION_PRESETS[type].questionsPerAudio === 1);

export const MICRO_TROTTOIR_POSTURES = {
  3: ['totalement pour', 'pour à certaines conditions', 'totalement contre'],
  4: ['totalement pour', 'pour à certaines conditions', 'totalement contre', 'ne se prononce pas'],
};

export const CONFIG = {
  historyWindow: 3,               // sets hacia atrás que bloquean un tema
  justificationThreshold: 0.8,    // solapamiento mínimo de la cita
  justificationMinContentWords: 5,
  microTrottoirOptions: 3,        // 3 o 4
  validationRetries: 2,           // reintentos en el MISMO proveedor
  piloteCount: 4,
  reformulationOverlapThreshold: 0.75,  // por encima de esto, la opción correcta calca el audio
  reformulationMinTrapWords: 2,        // mínimo de palabras literales compartidas para contar como trampa
};

// ±2 fijo sería absurdamente estrecho para una interview de 200-300 palabras.
export function wordTolerance(maxWords) {
  return Math.max(2, Math.round(maxWords * 0.05));
}

export function itemsPerSection(sectionType) {
  const preset = SECTION_PRESETS[sectionType];
  if (!preset) throw new Error(`Tipo de sección desconocido: ${sectionType}`);
  return preset.questions / preset.questionsPerAudio;
}

export function sectionDemand(compositionKey) {
  const sections = SET_COMPOSITIONS[compositionKey];
  if (!sections) throw new Error(`Composición desconocida: ${compositionKey}`);
  return Object.fromEntries(sections.map(type => [type, itemsPerSection(type)]));
}

export function totalQuestions(compositionKey) {
  const sections = SET_COMPOSITIONS[compositionKey];
  if (!sections) throw new Error(`Composición desconocida: ${compositionKey}`);
  return sections.reduce((sum, type) => sum + SECTION_PRESETS[type].questions, 0);
}
