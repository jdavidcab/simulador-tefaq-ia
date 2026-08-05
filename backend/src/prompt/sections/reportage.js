import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN reportaje radiofónico de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Es un reportaje narrado por una sola voz periodística: contexto, hechos, una cifra o dato concreto, y la consecuencia o el siguiente paso.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}
16. Las ${ctx.questionsPerAudio} preguntas deben cubrir aspectos DISTINTOS del reportaje; no pueden responderse con la misma frase.

${esquemaJson(ctx.questionsPerAudio)}`;
}
