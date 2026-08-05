import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UNA chronique radiofónica de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es una columna de opinión de un cronista de radio quebequense: presenta un tema de actualidad, toma posición con matices y anticipa una objeción.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
