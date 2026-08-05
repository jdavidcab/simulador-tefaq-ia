import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UNA annonce publique de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un anuncio difundido en un espacio público de Quebec (estación, comercio, institución, edificio): voz institucional, tono neutro, información práctica y una consecuencia o acción esperada para quien escucha.
Usa vocabulario y expresiones típicas quebequenses acordes al tema.

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio)}`;
}
