import { join } from 'node:path';
import { SET_COMPOSITIONS, SECTION_PRESETS, CONFIG as DEFAULT_CONFIG } from '../examFormat.js';
import { planTopics } from '../topics/planner.js';
import { TOPICS, topicById } from '../topics/catalog.js';
import { categoryById } from '../topics/imageCategories.js';
import { readRecentPlans } from '../topics/history.js';
import { writeSet, readSet, audioDir, imagesDir, nuevoSetId, contarItems } from './store.js';
import { esFalloDeCuotaORed } from '../itemGenerator.js';

const FORMATOS_SOPORTADOS = ['SET_STANDARD_36', 'SET_STANDARD_40', 'SET_DRILL_PARAPHRASE'];

const ESTILO_NEUTRO = 'Un boceto simple en blanco y negro, trazo limpio tipo dibujo lineal minimalista, fondo blanco, sin sombreado complejo, sin texto ni letras visibles en la imagen. Estilo de referencia neutro, sin ningún tema concreto todavía -- solo el trazo y el nivel de detalle que deben compartir las siguientes imágenes.';

function promptDeOpcion(imagePrompt) {
  return `${imagePrompt}\n\nEstilo: boceto simple en blanco y negro, trazo limpio tipo dibujo lineal minimalista, fondo blanco, sin sombreado complejo. IMPORTANTE: no incluyas ningún texto, letra ni etiqueta visible dentro del dibujo.`;
}

export function statusOf(set) {
  const conteo = contarItems(set);
  return { ...conteo, statut: set.statut };
}

export function createPipeline({ dataDir, generator, synth, imageSynth, catalog = TOPICS, config = DEFAULT_CONFIG }) {
  // El lock vive en memoria a propósito: un .lock en disco sobreviviría a un
  // crash y obligaría a detectar y limpiar locks huérfanos.
  const enCurso = new Set();

  function itemsDe(set) {
    return set.sections.flatMap(section =>
      section.items.map(item => ({ item, sectionType: section.type })));
  }

  function recalcularStatut(set) {
    const { total, prets } = contarItems(set);
    set.statut = prets === total ? 'complet' : 'partial';
  }

  return {
    isRunning(setId) {
      return enCurso.has(setId);
    },

    statusOf,

    async createSet({ difficulty = 'B2', format = 'SET_STANDARD_36', pilotes = false, seed, typeFilter } = {}) {
      if (!FORMATOS_SOPORTADOS.includes(format)) {
        const error = new Error(`Formato no soportado: "${format}". Soportados: ${FORMATOS_SOPORTADOS.join(', ')}.`);
        error.status = 400;
        throw error;
      }
      if (format === 'SET_STANDARD_40' && pilotes) {
        const error = new Error('SET_STANDARD_40 ya trae las 40 preguntas reales; no admite "pilotes" (darían 44).');
        error.status = 400;
        throw error;
      }
      if (format === 'SET_DRILL_PARAPHRASE' && pilotes) {
        const error = new Error('SET_DRILL_PARAPHRASE no admite "pilotes" (el tamaño de la ráfaga es fijo).');
        error.status = 400;
        throw error;
      }

      const semilla = seed ?? Math.floor(Math.random() * 2 ** 31);
      const recentPlans = await readRecentPlans(join(dataDir, 'sets'), config.historyWindow);
      const { plan, relaxations } = planTopics({
        catalog, compositionKey: format, recentPlans, seed: semilla, pilotes, config,
      });

      const porSeccion = new Map();
      for (const entrada of plan) {
        if (!porSeccion.has(entrada.sectionType)) porSeccion.set(entrada.sectionType, []);
        porSeccion.get(entrada.sectionType).push(entrada);
      }

      const set = {
        id: nuevoSetId(),
        genere_le: new Date().toISOString(),
        statut: 'partial',
        format, formatVersion: 1, difficulty, pilotes, seed: semilla,
        plan, relaxations,
        ledger: {
          texte: { appels: 0, echecs: 0 },
          tts: { appels: 0, echecs: 0 },
          images: { appels: 0, echecs: 0 },
        },
        sections: SET_COMPOSITIONS[format].map(type => {
          const preset = SECTION_PRESETS[type];
          return {
            type,
            timing: { avant: preset.avant, apres: preset.apres },
            lectures: preset.lectures,
            items: (porSeccion.get(type) ?? []).map(entrada => ({
              ref: entrada.ref,
              etat: 'en_attente',
              topicId: entrada.topicId,
              sujet: type === 'conversation_image'
                ? categoryById(entrada.topicId)?.label ?? ''
                : topicById(entrada.topicId, catalog)?.text ?? '',
              posture: entrada.posture,
              pilote: entrada.pilote,
              images: [],
            })),
          };
        }),
      };

      if (format === 'SET_DRILL_PARAPHRASE') {
        set.drill = { expectedReformulationType: typeFilter ?? null };
      }

      await writeSet(dataDir, set);
      return set;
    },

    async run(setId, { maxItems = Infinity } = {}) {
      if (enCurso.has(setId)) {
        const error = new Error(`El set "${setId}" ya está en curso`);
        error.status = 409;
        throw error;
      }
      enCurso.add(setId);

      try {
        const set = await readSet(dataDir, setId);
        let trabajados = 0;

        for (const { item, sectionType } of itemsDe(set)) {
          if (trabajados >= maxItems) break;
          if (item.etat === 'pret') continue;

          // Paso 1: texto. Un reintento reusa el mismo topicId del plan.
          if (item.etat === 'en_attente' || item.etat === 'echoue') {
            try {
              set.ledger.texte.appels += 1;
              const generado = await generator.generateItem({
                sectionType,
                topic: item.sujet,
                topicId: item.topicId,
                difficulty: set.difficulty,
                posture: item.posture,
                expectedReformulationType: set.drill?.expectedReformulationType,
              });
              item.transcript = generado.transcript;
              item.questions = generado.questions;
              item.provider = generado.provider;
              item.tentativas = generado.tentativas;
              item.etat = 'genere';
              delete item.erreur;
            } catch (error) {
              set.ledger.texte.echecs += 1;
              item.etat = 'echoue';
              item.erreur = error.message;
              await writeSet(dataDir, set);
              trabajados += 1;
              continue;
            }
            await writeSet(dataDir, set);
          }

          // Paso 2: audio. Separado del texto para que un fallo de cuota TTS
          // no haga perder el texto ya pagado. Un fallo puntual (ej. audio
          // corrupto) es independiente por ítem y el bucle sigue con el
          // siguiente; un fallo de cuota/red (429/5xx/timeout) implica que
          // insistir con el resto del set es inútil, así que se detiene la
          // tanda entera en seco.
          // `&& !item.audio` es necesario porque conversation_image mantiene
          // etat 'genere' incluso después de que el audio ya tenga éxito
          // (esperando las imágenes) -- sin este chequeo, una reanudación
          // regeneraría el audio de nuevo aunque ya esté listo. Para las
          // demás 7 secciones esto es un no-op: su etat pasa a 'pret' en el
          // mismo instante en que item.audio se asigna, así que nunca
          // coexisten etat==='genere' && item.audio.
          if (item.etat === 'genere' && !item.audio) {
            try {
              set.ledger.tts.appels += 1;
              const relativo = `audio/${item.ref}.wav`;
              const { duree_audio_s } = await synth.synthToFile({
                text: item.transcript,
                outPath: join(audioDir(dataDir, set.id), `${item.ref}.wav`),
              });
              item.audio = relativo;
              item.duree_audio_s = duree_audio_s;
              if (sectionType !== 'conversation_image') {
                item.etat = 'pret';
              }
              delete item.erreur;
              await writeSet(dataDir, set);
            } catch (error) {
              set.ledger.tts.echecs += 1;
              item.erreur = error.message;
              await writeSet(dataDir, set);
              if (esFalloDeCuotaORed(error)) {
                trabajados += 1;
                break; // cuota/red agotada: parada limpia, no insistir con el resto del set
              }
            }
          }

          // Paso 3: imágenes (solo conversation_image) -- corre después del
          // audio, dentro del mismo etat 'genere'. Checkpoint en
          // item.images: cada reanudación solo genera los ids ausentes
          // (incluida la referencia neutral, vía readReferenceIfExists), sin
          // volver a tocar el texto ni las imágenes ya escritas. El ítem
          // pasa a 'pret' solo cuando las 4 imágenes de opción están.
          if (sectionType === 'conversation_image' && item.etat === 'genere' && item.audio) {
            try {
              const refPath = join(imagesDir(dataDir, set.id), `${item.ref}-ref.jpg`);
              let refBase64 = await imageSynth.readReferenceIfExists(refPath);
              if (!refBase64) {
                set.ledger.images.appels += 1;
                const generada = await imageSynth.synthImageToFile({ prompt: ESTILO_NEUTRO, outPath: refPath });
                refBase64 = generada.base64;
              }

              for (const option of item.questions[0].options) {
                if (item.images.some(img => img.id === option.id)) continue;
                set.ledger.images.appels += 1;
                const relativo = `images/${item.ref}-${option.id}.jpg`;
                await imageSynth.synthImageToFile({
                  prompt: promptDeOpcion(option.imagePrompt),
                  referenceImageBase64: refBase64,
                  outPath: join(imagesDir(dataDir, set.id), `${item.ref}-${option.id}.jpg`),
                });
                item.images.push({ id: option.id, path: relativo });
                await writeSet(dataDir, set);
              }

              if (item.images.length === item.questions[0].options.length) item.etat = 'pret';
              delete item.erreur;
              await writeSet(dataDir, set);
            } catch (error) {
              set.ledger.images.echecs += 1;
              item.erreur = error.message;
              await writeSet(dataDir, set);
              if (esFalloDeCuotaORed(error)) {
                trabajados += 1;
                break;
              }
            }
          }

          trabajados += 1;
        }

        recalcularStatut(set);
        await writeSet(dataDir, set);
        return set;
      } finally {
        enCurso.delete(setId);
      }
    },
  };
}
