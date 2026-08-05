import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN mensaje de contestador (répondeur) de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un mensaje dejado en el buzón de voz de la persona que escucha: quien llama se identifica, explica el motivo y pide una acción concreta o anuncia un cambio.
Usa vocabulario y expresiones típicas quebequenses acordes al tema.

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
