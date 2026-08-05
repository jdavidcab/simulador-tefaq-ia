import { buildSectionPrompt } from './prompt/index.js';
import { validateItem } from './validation/index.js';
import { AUTO_CHAIN } from './providers/index.js';
import { CONFIG as DEFAULT_CONFIG } from './examFormat.js';

function limpiarMarkdown(text) {
  let limpio = text.trim();
  if (limpio.startsWith('```')) limpio = limpio.replace(/```(?:json)?/g, '').trim();
  return limpio;
}

function barajar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Reordena las opciones y renumera A-D para que la correcta no se sesgue a una letra.
function aleatorizarOpciones(question) {
  const correctaOriginal = question.options.find(option => option.id === question.correctId);
  const barajadas = barajar(question.options).map((option, indice) => ({
    ...option,
    id: ['A', 'B', 'C', 'D'][indice],
  }));
  const nuevaCorrecta = barajadas.find(option => option.text === correctaOriginal.text);
  if (!nuevaCorrecta) throw new Error('No se pudo remapear la opción correcta tras mezclar');
  return { ...question, options: barajadas, correctId: nuevaCorrecta.id };
}

// Red de seguridad si el modelo desobedece la regla de no mencionar letras
// en el feedback (rule 7 del prompt), o si el barajado de opciones deja
// obsoleta una referencia de letra que el modelo escribió antes de barajar.
// No intentamos rescatar quirúrgicamente el razonamiento del modelo si
// menciona una letra de opción en cualquier parte del texto (primera frase o
// posterior, en español, francés con elisión -- "L'option A" -- o inglés):
// preferimos perder el detalle a arriesgar una referencia obsoleta o
// contradictoria con el correctId final tras el barajado. Sí conservamos,
// en cambio, casos donde la letra mayúscula NO es una referencia a una
// opción (p. ej. "A diferencia de..." o "vitamina C").
function normalizeFeedback(feedback, correctId) {
  const text = feedback.trim();
  const fallback = `La opción ${correctId} es correcta según lo que se dice en el audio.`;

  // Señal fuerte: "opción B" / "option A" / "L'option B" (con o sin elisión,
  // singular o plural) -- siempre se trata como referencia a una letra, sin
  // importar qué palabra sigue.
  const conMarcador = /\b(?:opci[oó]n(?:es)?|l['’]?options?|options?)\s+[ABCD]\b/i.test(text);
  // Señal débil: una letra suelta que NO continúa en una palabra en
  // minúscula justo después. Esto distingue "es correcta la A." (letra
  // aislada, cuenta) de "A pesar de" o "vitamina C como" (la letra sigue en
  // una palabra, es una preposición o coincidencia, no cuenta).
  const letraSuelta = /\b[ABCD]\b(?!\s*[a-zà-ÿ])/i.test(text);

  if (!text || conMarcador || letraSuelta) return fallback;

  const body = text.charAt(0).toUpperCase() + text.slice(1);
  return `La opción ${correctId} es correcta. ${body}`;
}

// Un 429 o un timeout no mejora reintentando el mismo modelo; un fallo de
// validación con temperature 1 casi siempre sí.
export function esFalloDeCuotaORed(error) {
  if (typeof error.status === 'number') return error.status === 429 || error.status >= 500;
  return /timeout|fetch failed|ECONNRESET|ENOTFOUND|network|socket/i.test(error.message);
}

export function createItemGenerator(providers, config = DEFAULT_CONFIG) {
  return {
    async generateItem(opts) {
      const { sectionType, topic, difficulty, posture } = opts;
      const cadena = opts.selector ?? AUTO_CHAIN;
      const disponibles = cadena.filter(key => providers[key]);

      if (disponibles.length === 0) {
        const error = new Error(`Ningún provider de la cadena [${cadena.join(' → ')}] está configurado`);
        error.providersTried = [];
        throw error;
      }

      const prompt = buildSectionPrompt(sectionType, {
        topic, difficulty, posture,
        minWords: opts.minWords, maxWords: opts.maxWords, verticalScan: opts.verticalScan,
      });

      const errores = [];
      let tentativas = 0;

      for (const key of disponibles) {
        const provider = providers[key];
        const maxIntentos = config.validationRetries + 1;
        let ultimoError = null;

        for (let intento = 0; intento < maxIntentos; intento += 1) {
          tentativas += 1;
          try {
            const texto = await provider.generate(prompt);
            const bruto = JSON.parse(limpiarMarkdown(texto));
            const validado = validateItem(bruto, sectionType, {
              config, posture, minWords: opts.minWords, maxWords: opts.maxWords,
            });

            // Las opciones de micro_trottoir son fijas: barajarlas rompería el contrato.
            const barajadas = sectionType === 'micro_trottoir'
              ? validado.questions
              : validado.questions.map(aleatorizarOpciones);
            // El feedback se normaliza SIEMPRE, para todas las secciones, después
            // de cualquier barajado -- así nunca queda una referencia de letra
            // obsoleta o contradictoria con el correctId final.
            const questions = barajadas.map(q => ({ ...q, feedback: normalizeFeedback(q.feedback, q.correctId) }));

            return { transcript: validado.transcript, questions, provider: provider.name, tentativas };
          } catch (error) {
            console.error(`[generador] ${provider.name} falló: ${error.message}`);
            ultimoError = error;
            if (esFalloDeCuotaORed(error)) break; // no insistir con este proveedor
          }
        }

        // Una entrada por proveedor agotado (no una por intento): refleja el
        // último fallo con el que se rindió antes de avanzar en la cadena.
        // Si el config no trae validationRetries válido, el bucle interno
        // puede no ejecutarse ni una vez -- ultimoError sigue en null.
        errores.push({ provider: provider.name, error: ultimoError?.message ?? 'sin intentos ejecutados (config inválido)' });
      }

      const error = new Error('Todos los providers de la cadena fallaron');
      error.providersTried = errores;
      throw error;
    },
  };
}
