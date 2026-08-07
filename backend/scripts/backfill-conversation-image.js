// backend/scripts/backfill-conversation-image.js
//
// Script de UNA SOLA VEZ para agregar la sección conversation_image al set
// SET_STANDARD_36 ya existente set-2026-08-06-xwwe, sin regenerarlo. No es
// una funcionalidad reusable del producto -- se corre manualmente, una vez,
// con supervisión directa. Hace backup antes de mutar y verifica que los
// refs nuevos no colisionen con los 32 ítems ya existentes.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPipeline } from '../src/sets/pipeline.js';
import { createItemGenerator } from '../src/itemGenerator.js';
import { createProviders } from '../src/providers/index.js';
import { createSynth } from '../src/audio/synth.js';
import { createImageSynth } from '../src/images/synth.js';
import { SECTION_PRESETS } from '../src/examFormat.js';
import { IMAGE_CATEGORIES } from '../src/topics/imageCategories.js';
import dotenv from 'dotenv';

dotenv.config();

const SET_ID = 'set-2026-08-06-xwwe';
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const SET_JSON = join(DATA_DIR, 'sets', SET_ID, 'set.json');

async function main() {
  const raw = await readFile(SET_JSON, 'utf8');
  const set = JSON.parse(raw);

  if (set.format === 'SET_STANDARD_40') {
    console.log('El set ya es SET_STANDARD_40, nada que hacer.');
    return;
  }
  if (set.sections.some(s => s.type === 'conversation_image')) {
    throw new Error('El set ya tiene una sección conversation_image -- revisar manualmente antes de continuar.');
  }

  // Backup antes de mutar nada.
  await copyFile(SET_JSON, `${SET_JSON}.backup-${Date.now()}`);

  // Append puro: las 7 secciones existentes ya ocupan s1-s7 (ver el plan
  // original de este set), así que la nueva sección usa s8 -- NO se
  // re-deriva el plan bajo el orden canónico de SET_STANDARD_40 (que pondría
  // conversation_image primero como s1, colisionando con annonce_publique).
  const indiceSeccion = set.sections.length; // 7 -> nueva sección en índice 7 (s8)
  const refsExistentes = new Set(set.sections.flatMap(s => s.items.map(i => i.ref)));

  const categoriasElegidas = IMAGE_CATEGORIES.slice(0, 4); // determinista, no hace falta rotación para un backfill de una vez
  const preset = SECTION_PRESETS.conversation_image;
  const nuevosItems = categoriasElegidas.map((categoria, i) => {
    const ref = `s${indiceSeccion + 1}i${i + 1}`;
    if (refsExistentes.has(ref)) {
      throw new Error(`Colisión de ref detectada: "${ref}" ya existe en el set. Abortando sin escribir nada.`);
    }
    return {
      ref,
      etat: 'en_attente',
      topicId: categoria.id,
      sujet: categoria.label,
      posture: undefined,
      pilote: false,
      images: [],
    };
  });

  set.sections.push({
    type: 'conversation_image',
    timing: { avant: preset.avant, apres: preset.apres },
    lectures: preset.lectures,
    items: nuevosItems,
  });
  set.format = 'SET_STANDARD_40';
  set.plan.unshift(...nuevosItems.map(item => ({
    ref: item.ref, sectionType: 'conversation_image', topicId: item.topicId, pilote: false,
  })));
  if (!set.ledger.images) set.ledger.images = { appels: 0, echecs: 0 };
  set.statut = 'partial';

  await writeFile(SET_JSON, JSON.stringify(set, null, 2), 'utf8');
  console.log(`Sección conversation_image agregada (${nuevosItems.map(i => i.ref).join(', ')}). Corriendo el pipeline...`);

  const providers = createProviders();
  const generator = createItemGenerator(providers);
  const synth = createSynth({ apiKey: process.env.TTS_GEMINI_API_KEY || process.env.GEMINI_API_KEY, voices: ['Kore', 'Charon', 'Puck'] });
  const imageSynth = createImageSynth({ apiKey: process.env.GEMINI_API_KEY });
  const pipeline = createPipeline({ dataDir: DATA_DIR, generator, synth, imageSynth });

  const resultado = await pipeline.run(SET_ID);
  console.log(`Estado final: ${resultado.statut}`);
}

main().catch(error => {
  console.error('Backfill falló:', error);
  process.exit(1);
});
