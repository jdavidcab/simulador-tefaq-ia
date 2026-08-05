import { DIFFICULTY_PROFILES } from './profiles.js';

export function bloquePerfil(difficulty) {
  const profile = DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES.B2;
  return `Perfil de dificultad ${profile.label}:
- Vocabulario: ${profile.vocabulary}.
- Complejidad del audio: ${profile.audioComplexity}.
- Sutileza de distractores: ${profile.distractors}.
- Distractores por sinónimos/paráfrasis: ${profile.synonymDistractors}.
- Similitud entre opciones: ${profile.optionSimilarity}.
- Feedback esperado: ${profile.feedback}.`;
}

export function bloquePatron(pattern) {
  return `Patrón TEFAQ de esta pregunta:
- Tipo de pregunta: ${pattern?.questionType ?? 'identificar el propósito principal del mensaje'}.
- Estructura del audio: ${pattern?.announcementStructure ?? 'mensaje breve de la vida cotidiana con contexto, motivo y acción esperada'}.
- Patrón principal de distractor: ${pattern?.distractorPattern ?? 'un distractor parcialmente verdadero, pero con un detalle clave incorrecto'}.
- Expresiones/vocabulario quebequense sugerido (usa solo si encaja naturalmente): ${(pattern?.quebecExpressions ?? []).join(', ') || 'dépanneur, courriel, fin de semaine'}.`;
}

export function reglasComunes({ minWords, maxWords, questionsPerAudio, verticalScan }) {
  return `Reglas:
1. Las 4 opciones de cada pregunta deben ser plausibles.
2. El transcript debe usar parafraseo y NUNCA las mismas palabras exactas de la respuesta correcta.
3. El transcript debe tener entre ${minWords} y ${maxWords} palabras.
4. Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown ni comillas triples.
5. Genera exactamente ${questionsPerAudio} pregunta(s) sobre este mismo audio.
6. La respuesta correcta no debe quedar sesgada siempre en la misma letra.
7. El feedback NO debe mencionar letras de opciones (A, B, C, D). Explica el contenido correcto, el parafraseo usado y por qué los distractores no encajan.
8. Los distractores deben seguir este esquema: uno parcialmente verdadero con detalle incorrecto, uno plausible pero no mencionado, uno que confunda causa/consecuencia o recomendación/obligación, y uno con detalle cambiado (hora/lugar/monto/condición) cuando sea posible.
9. Al menos un distractor debe ser una trampa de sinónimos/paráfrasis: reutiliza una idea del audio con palabras equivalentes, pero cambia el sentido final con un matiz o dato incorrecto.
10. La respuesta correcta también debe estar parafraseada: no copies frases literales del transcript.
11. Las 4 opciones deben parecer de la misma familia: longitud parecida, mismo registro, misma categoría y estructura gramatical comparable.
12. La diferencia entre opciones debe estar en un detalle decisivo, no en que una sea mucho más específica o larga.
13. En el feedback, menciona brevemente el par de sinónimos/paráfrasis que conecta el audio con la respuesta correcta.
14. El campo "justification" de cada pregunta debe ser una CITA TEXTUAL del transcript (mínimo 8 palabras, copiada literalmente) que sostenga la respuesta correcta.
${verticalScan
  ? '15. Como entrenamiento de escaneo vertical, las 4 opciones deben compartir un inicio sintáctico natural de al menos 3 palabras y diferenciarse principalmente en la parte final. No fuerces frases artificiales; deben sonar naturales en francés.'
  : '15. Las opciones pueden tener estructuras variadas y naturales; no necesitas forzar un prefijo común, pero deben mantener longitud, tono y categoría semántica similares.'}`;
}

export function esquemaJson(questionsPerAudio) {
  const pregunta = `{
      "prompt": "Pregunta en francés",
      "options": [{ "id": "A", "text": "..." }, { "id": "B", "text": "..." }, { "id": "C", "text": "..." }, { "id": "D", "text": "..." }],
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
