import { bloquePerfil, bloquePatron, reglasComunes, esquemaJson } from '../common.js';
import { MICRO_TROTTOIR_POSTURES, CONFIG } from '../../examFormat.js';

export function build(ctx) {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN micro-trottoir de comprensión oral.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".
Una persona entrevistada en la calle da su opinión sobre el tema. Su postura debe ser EXACTAMENTE: "${ctx.posture}", expresada de forma matizada y natural, sin anunciarla literalmente.

Las ${posturas.length} opciones NO las eliges tú: son siempre estas posturas, en este orden exacto:
${posturas.map((postura, i) => `${'ABCD'[i]}) ${postura}`).join('\n')}
El campo "correctId" debe ser la letra de la postura "${ctx.posture}".

${bloquePerfil(ctx.difficulty)}

${bloquePatron(ctx.pattern)}

${reglasComunes(ctx)}

${esquemaJson(ctx.questionsPerAudio, posturas.length)}`;
}
