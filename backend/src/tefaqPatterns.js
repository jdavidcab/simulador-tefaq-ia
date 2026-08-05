export const QUESTION_TYPES = [
  'identificar el propósito principal del mensaje',
  'identificar el problema o motivo de la llamada/anuncio',
  'identificar la acción esperada del oyente',
  'identificar un cambio anunciado (horario, lugar, servicio, condición)',
  'identificar una consecuencia práctica para el oyente',
  'identificar un detalle específico (hora, lugar, monto, documento, condición)',
  'identificar una restricción, excepción o condición importante',
];

export const DISTRACTOR_PATTERNS = [
  'un distractor parcialmente verdadero, pero con un detalle clave incorrecto',
  'un distractor relacionado con el mismo tema, pero no mencionado en el audio',
  'un distractor que confunda la causa con la consecuencia',
  'un distractor que confunda una recomendación con una obligación',
  'un distractor que cambie sutilmente hora, lugar, monto o condición',
  'un distractor que use palabras parecidas al audio, pero con intención distinta',
];

export const ANNOUNCEMENT_STRUCTURES = [
  'mensaje breve de contestador con saludo, motivo y acción esperada',
  'anuncio público con contexto, cambio importante y consecuencia práctica',
  'conversación corta con un problema, una aclaración y una solución propuesta',
  'aviso de servicio con interrupción, horario afectado y alternativa sugerida',
  'reclamo o llamada de servicio al cliente con cargo, error o seguimiento',
  'mensaje institucional con una regla nueva, fecha de aplicación y excepción',
];

export const QUEBEC_EXPRESSIONS = [
  'dépanneur',
  'char',
  'cellulaire',
  'fin de semaine',
  'courriel',
  'covoiturage',
  '5 à 7',
  'chum/blonde',
  'à tantôt',
  'c’est correct',
  'pas pire',
  'ça se peut-tu',
  'ligne d’autobus',
  'centre de services',
];

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function pickMany(array, count) {
  return [...array]
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
}

export function pickTefaqPattern() {
  return {
    questionType: pick(QUESTION_TYPES),
    distractorPattern: pick(DISTRACTOR_PATTERNS),
    announcementStructure: pick(ANNOUNCEMENT_STRUCTURES),
    quebecExpressions: pickMany(QUEBEC_EXPRESSIONS, 3),
  };
}
