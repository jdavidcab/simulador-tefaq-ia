import { DIFFICULTY_PROFILES } from './profiles.js';

export function bloquePerfil(difficulty, opcionesFijas = false) {
  const profile = DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES.B2;
  const lineaSimilitud = opcionesFijas ? '' : `\n- Similitud entre opciones: ${profile.optionSimilarity}.`;
  return `Perfil de dificultad ${profile.label}:
- Vocabulario: ${profile.vocabulary}.
- Complejidad del audio: ${profile.audioComplexity}.
- Sutileza de distractores: ${profile.distractors}.
- Distractores por sinónimos/paráfrasis: ${profile.synonymDistractors}.${lineaSimilitud}
- Feedback esperado: ${profile.feedback}.`;
}

export function bloquePatron(pattern) {
  return `Patrón TEFAQ de esta pregunta:
- Tipo de pregunta: ${pattern?.questionType ?? 'identificar el propósito principal del mensaje'}.
- Estructura del audio: ${pattern?.announcementStructure ?? 'mensaje breve de la vida cotidiana con contexto, motivo y acción esperada'}.
- Patrón principal de distractor: ${pattern?.distractorPattern ?? 'un distractor parcialmente verdadero, pero con un detalle clave incorrecto'}.
- Expresiones/vocabulario quebequense sugerido (usa solo si encaja naturalmente): ${(pattern?.quebecExpressions ?? []).join(', ') || 'dépanneur, courriel, fin de semaine'}.`;
}

export function reglasComunes({ minWords, maxWords, questionsPerAudio, verticalScan, opcionesFijas = false }) {
  const reglas = [
    opcionesFijas
      ? 'Las opciones son fijas y no las eliges tú (se listan arriba); no inventes ni modifiques su texto.'
      : 'Las 4 opciones de cada pregunta deben ser plausibles.',
    'El transcript debe usar parafraseo y NUNCA las mismas palabras exactas de la respuesta correcta.',
    `El transcript debe tener entre ${minWords} y ${maxWords} palabras.`,
    'Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown ni comillas triples.',
    `Genera exactamente ${questionsPerAudio} pregunta(s) sobre este mismo audio.`,
    'La respuesta correcta no debe quedar sesgada siempre en la misma letra.',
    'El feedback NO debe mencionar letras de opciones (A, B, C, D). Explica el contenido correcto, el parafraseo usado y por qué los distractores no encajan.',
  ];
  if (!opcionesFijas) {
    reglas.push(
      'Los distractores deben seguir este esquema: uno parcialmente verdadero con detalle incorrecto, uno plausible pero no mencionado, uno que confunda causa/consecuencia o recomendación/obligación, y uno con detalle cambiado (hora/lugar/monto/condición) cuando sea posible.',
      'Al menos un distractor debe ser una trampa de sinónimos/paráfrasis: reutiliza una idea del audio con palabras equivalentes, pero cambia el sentido final con un matiz o dato incorrecto.',
    );
  }
  reglas.push('La respuesta correcta también debe estar parafraseada: no copies frases literales del transcript.');
  if (!opcionesFijas) {
    reglas.push(
      'Las 4 opciones deben parecer de la misma familia: longitud parecida, mismo registro, misma categoría y estructura gramatical comparable.',
      'La diferencia entre opciones debe estar en un detalle decisivo, no en que una sea mucho más específica o larga.',
    );
  }
  reglas.push(
    'En el feedback, menciona brevemente el par de sinónimos/paráfrasis que conecta el audio con la respuesta correcta.',
    'El campo "justification" de cada pregunta debe ser una CITA TEXTUAL del transcript (mínimo 8 palabras de contenido, copiada literalmente) que sostenga la respuesta correcta.',
    verticalScan
      ? 'Como entrenamiento de escaneo vertical, las 4 opciones deben compartir un inicio sintáctico natural de al menos 3 palabras y diferenciarse principalmente en la parte final. No fuerces frases artificiales; deben sonar naturales en francés.'
      : 'Las opciones pueden tener estructuras variadas y naturales; no necesitas forzar un prefijo común, pero deben mantener longitud, tono y categoría semántica similares.',
  );
  return `Reglas:\n${reglas.map((regla, i) => `${i + 1}. ${regla}`).join('\n')}`;
}

export function esquemaJson(questionsPerAudio, optionCount = 4) {
  const letras = ['A', 'B', 'C', 'D'].slice(0, optionCount);
  const opcionesEjemplo = letras.map(letra => `{ "id": "${letra}", "text": "..." }`).join(', ');
  const pregunta = `{
      "prompt": "Pregunta en francés",
      "options": [${opcionesEjemplo}],
      "correctId": "A",
      "feedback": "Explicación breve en español.",
      "justification": "cita textual del transcript"
    }`;
  return `Estructura JSON requerida:
{
  "transcript": "El texto simulado del audio en francés...",
  "questions": [${Array.from({ length: questionsPerAudio }, () => pregunta).join(',\n    ')}]
}`;
}

export function exigenciaB2() {
  return 'El audio debe exigir comprensión B2 real: opiniones matizadas, implícitos, relación causa/consecuencia y cambios de postura, no solo datos explícitos.';
}
