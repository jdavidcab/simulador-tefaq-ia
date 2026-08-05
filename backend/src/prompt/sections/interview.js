import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson, exigenciaB2 } from '../common.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UNA entrevista radiofónica de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
El transcript debe ser un DIÁLOGO etiquetado, alternando turnos varias veces, con este formato exacto de etiquetas:
Journaliste: … / Invité(e): …
La persona invitada debe matizar, condicionar o rectificar al menos una vez.
${exigenciaB2()}

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}
16. Las ${ctx.questionsPerAudio} preguntas deben cubrir aspectos DISTINTOS de la entrevista; no pueden responderse con la misma frase.

${esquemaJson(ctx.questionsPerAudio)}`;
}
