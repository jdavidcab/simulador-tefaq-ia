import { join } from 'node:path';
import { SET_COMPOSITIONS, SECTION_PRESETS, CONFIG as DEFAULT_CONFIG } from '../examFormat.js';
import { planTopics } from '../topics/planner.js';
import { TOPICS, topicById } from '../topics/catalog.js';
import { readRecentPlans } from '../topics/history.js';
import { writeSet, readSet, audioDir, nuevoSetId, contarItems } from './store.js';
import { esFalloDeCuotaORed } from '../itemGenerator.js';

const FORMATO_SOPORTADO = 'SET_STANDARD_36';

export function statusOf(set) {
  const conteo = contarItems(set);
  return { ...conteo, statut: set.statut };
}

export function createPipeline({ dataDir, generator, synth, catalog = TOPICS, config = DEFAULT_CONFIG }) {
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

    async createSet({ difficulty = 'B2', format = FORMATO_SOPORTADO, pilotes = false, seed } = {}) {
      if (format !== FORMATO_SOPORTADO) {
        const error = new Error(`Formato no soportado en este slice: "${format}". Solo ${FORMATO_SOPORTADO}.`);
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
              sujet: topicById(entrada.topicId, catalog)?.text ?? '',
              posture: entrada.posture,
              pilote: entrada.pilote,
              images: [],
            })),
          };
        }),
      };

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
          if (item.etat === 'genere') {
            try {
              set.ledger.tts.appels += 1;
              const relativo = `audio/${item.ref}.wav`;
              const { duree_audio_s } = await synth.synthToFile({
                text: item.transcript,
                outPath: join(audioDir(dataDir, set.id), `${item.ref}.wav`),
              });
              item.audio = relativo;
              item.duree_audio_s = duree_audio_s;
              item.etat = 'pret';
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
