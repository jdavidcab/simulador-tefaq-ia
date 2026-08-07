// backend/src/prompt/sections/conversation_image.js
//
// A diferencia de las demás 7 secciones, esta NO reutiliza reglasComunes()/
// opcionesFijas: las opciones no son texto libre inventado (como el resto)
// ni texto fijo predefinido (como micro_trottoir) -- son descripciones de
// escena ancladas a una categoría+dimensión, pensadas para convertirse en
// una imagen, no para leerse. La dificultad se fuerza a B1 SIEMPRE, sin
// importar ctx.difficulty (esta sección es deliberadamente la más fácil del
// examen real, A2-B1, "sujet concret et familier").
import { bloquePerfil } from '../common.js';
import { DISCRIMINATING_DIMENSIONS } from '../../topics/imageCategories.js';

export function build(ctx) {
  return `Actúa como un examinador experto del examen TEFAQ. Genera UN diálogo corto de comprensión oral para la sección "conversation_image", la más fácil del examen (nivel A2-B1, sujet concret et familier).
El diálogo ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${ctx.topic}".

Dos personas conversan brevemente (10-20 segundos de habla real, ${ctx.minWords}-${ctx.maxWords} palabras) y el resultado debe dejar claro, sin ambigüedad, UN elemento concreto específico relacionado con el tema de arriba.

${bloquePerfil('B1')}

Elige 1 o 2 de estas dimensiones para variar entre las 4 opciones (no todas a la vez): ${DISCRIMINATING_DIMENSIONS.join(', ')}.

Reglas:
1. Las 4 opciones NO son texto para leer: cada una es una descripción de una escena-variante que luego se convierte en un boceto simple. Deben ser igual de plausibles entre sí hasta escuchar el audio -- ninguna debe ser absurda, de otra categoría, u obviamente descartable a simple vista.
2. Cada opción tiene dos campos: "text" (descripción breve en francés de la escena, 1 frase) e "imagePrompt" (versión más detallada en francés de esa misma escena, pensada para generar el boceto -- incluye el/los elemento(s) que varían según la(s) dimensión(es) elegida(s)).
3. Las 4 opciones deben variar ÚNICAMENTE en la(s) dimensión(es) elegida(s); todo lo demás (tipo de escena, nivel de detalle) debe ser comparable entre las 4.
4. El transcript debe usar parafraseo natural; el elemento discriminante debe quedar claro por el CONTENIDO del diálogo, no por una palabra aislada fácil de adivinar sin escuchar el resto.
5. El campo "justification" de cada pregunta debe ser una CITA TEXTUAL del transcript (mínimo 8 palabras de contenido, copiada literalmente) que sostenga la respuesta correcta.
6. El feedback NO debe mencionar letras de opciones (A, B, C, D). Explica qué detalle del diálogo confirma la escena correcta.
7. Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown ni comillas triples.

Estructura JSON requerida:
{
  "transcript": "El diálogo en francés...",
  "questions": [{
    "prompt": "Pregunta en francés (ej. Quelle image correspond à la conversation ?)",
    "options": [
      { "id": "A", "text": "Description brève en français", "imagePrompt": "Description détaillée en français pour le dessin" },
      { "id": "B", "text": "...", "imagePrompt": "..." },
      { "id": "C", "text": "...", "imagePrompt": "..." },
      { "id": "D", "text": "...", "imagePrompt": "..." }
    ],
    "correctId": "A",
    "feedback": "Explicación breve en español.",
    "justification": "cita textual del transcript"
  }]
}`;
}
