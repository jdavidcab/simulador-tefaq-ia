import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN documento sonoro breve de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Puede ser una conversación, un aviso, un mensaje o una cápsula informativa de la vida cotidiana en Quebec.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
