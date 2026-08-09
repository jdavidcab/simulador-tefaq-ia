// backend/src/prompt/sections/drill_paraphrase.js
//
// Prompt dedicado para el modo Drill Paraphrase (Fase 2, Parte B): audios
// muy cortos (15-40 palabras) para repetición concentrada del salto
// oral->escrito. Fuerza el rango de palabras literalmente, sin usar
// ctx.minWords/ctx.maxWords -- mismo patrón defensivo que
// conversation_image.js fuerza difficulty:'B1' sin usar ctx.difficulty,
// aunque hoy ningún llamador real pasaría un rango distinto (el pipeline
// nunca sobreescribe minWords/maxWords para esta sección).
import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';

const REFORMULATION_TYPE_INSTRUCTIONS = {
  nominalisation: 'La transformación de la respuesta correcta para este ítem debe ser específicamente una NOMINALIZACIÓN (verbo → sustantivo). No elijas otro tipo.',
  synonyme: 'La transformación de la respuesta correcta para este ítem debe ser específicamente un SINÓNIMO (palabras equivalentes). No elijas otro tipo.',
  restructuration: 'La transformación de la respuesta correcta para este ítem debe ser específicamente una RESTRUCTURACIÓN (reordenamiento sintáctico). No elijas otro tipo.',
};

export function build(ctx) {
  const instruccionTipo = REFORMULATION_TYPE_INSTRUCTIONS[ctx.expectedReformulationType] ?? '';
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN mensaje muy corto de comprensión oral para un ejercicio de práctica concentrada de reformulación.
El mensaje ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un mensaje breve de la vida cotidiana (aviso, contestador, anuncio) con UN único hecho claro que la respuesta correcta deberá reformular.

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes({ minWords: 15, maxWords: 40, questionsPerAudio: ctx.questionsPerAudio, verticalScan: ctx.verticalScan })}
${instruccionTipo ? `\n${instruccionTipo}\n` : ''}
${esquemaJson(ctx.questionsPerAudio)}`;
}
