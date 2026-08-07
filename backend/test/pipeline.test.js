import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createPipeline } from '../src/sets/pipeline.js';
import { readSet } from '../src/sets/store.js';

function catalogoAmplio() {
  const temas = [];
  const porSeccion = {
    annonce_publique: 30, repondeur: 30, micro_trottoir: 30,
    chronique: 30, interview: 30, reportage: 30, divers: 60,
  };
  let n = 1;
  for (const [seccion, cantidad] of Object.entries(porSeccion)) {
    for (let i = 0; i < cantidad; i += 1) {
      temas.push({ id: `t-${String(n).padStart(4, '0')}`, text: `tema ${n}`, sections: [seccion] });
      n += 1;
    }
  }
  return temas;
}

function generadorFake({ fallarEn = new Set(), contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async generateItem({ sectionType, topicId }) {
      contador.llamadas += 1;
      if (fallarEn.has(topicId)) {
        const error = new Error('fallo simulado de generación');
        error.providersTried = [{ provider: 'fake', error: 'fallo simulado' }];
        throw error;
      }
      return {
        transcript: `transcript de ${sectionType} sobre ${topicId}`,
        questions: [{
          prompt: 'p', options: [
            { id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' },
          ],
          correctId: 'A', feedback: 'f', justification: 'j', justificationScore: 1,
        }],
        provider: 'fake-provider', tentativas: 1,
      };
    },
  };
}

function synthFake({ fallarSiempre = false, fallaDeCuota = false, contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async synthToFile({ outPath }) {
      contador.llamadas += 1;
      if (fallarSiempre) {
        const error = new Error(fallaDeCuota ? 'cuota TTS agotada' : 'audio corrupto o inválido');
        if (fallaDeCuota) error.status = 429;
        throw error;
      }
      return { duree_audio_s: 42.5, voice: 'Kore', outPath };
    },
  };
}

async function nuevoPipeline(opts = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const generator = opts.generator ?? generadorFake();
  const synth = opts.synth ?? synthFake();
  const pipeline = createPipeline({ dataDir, generator, synth, catalog: catalogoAmplio() });
  return { dataDir, pipeline, generator, synth };
}

function catalogoConImagenes() {
  return catalogoAmplio(); // conversation_image no usa este catálogo -- ver imageCategories.js
}

function generadorFakeConversationImage({ contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async generateItem({ sectionType, topicId }) {
      contador.llamadas += 1;
      if (sectionType !== 'conversation_image') {
        return generadorFake().generateItem({ sectionType, topicId });
      }
      return {
        transcript: `dialogue court sur ${topicId}`,
        questions: [{
          prompt: 'p',
          options: [
            { id: 'A', text: 'a', imagePrompt: 'ip-a' },
            { id: 'B', text: 'b', imagePrompt: 'ip-b' },
            { id: 'C', text: 'c', imagePrompt: 'ip-c' },
            { id: 'D', text: 'd', imagePrompt: 'ip-d' },
          ],
          correctId: 'A', feedback: 'f', justification: 'j', justificationScore: 1,
        }],
        provider: 'fake-provider', tentativas: 1,
      };
    },
  };
}

function imageSynthFake({ fallarSiempre = false, fallaDeCuota = false, contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async synthImageToFile({ outPath }) {
      contador.llamadas += 1;
      if (fallarSiempre) {
        const error = new Error(fallaDeCuota ? 'cuota de imagen agotada' : 'imagen no generada');
        if (fallaDeCuota) error.status = 429;
        throw error;
      }
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, 'fake-image-bytes');
      return { base64: 'ZmFrZQ==' };
    },
    async readReferenceIfExists(path) {
      try {
        await readFile(path);
        return 'ZmFrZQ==';
      } catch {
        return null;
      }
    },
  };
}

async function nuevoPipelineConImagenes(opts = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-img-'));
  const generator = opts.generator ?? generadorFakeConversationImage();
  const synth = opts.synth ?? synthFake();
  const imageSynth = opts.imageSynth ?? imageSynthFake();
  const pipeline = createPipeline({ dataDir, generator, synth, imageSynth, catalog: catalogoConImagenes() });
  return { dataDir, pipeline, generator, synth, imageSynth };
}

test('createSet escribe el esqueleto con los 32 ítems en espera y no genera nada', async () => {
  const { dataDir, pipeline, generator } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 1 });

  assert.equal(set.statut, 'partial');
  assert.equal(set.format, 'SET_STANDARD_36');
  assert.equal(set.plan.length, 32);
  assert.equal(generator.contador.llamadas, 0, 'createSet no debe generar contenido');

  const persistido = await readSet(dataDir, set.id);
  const items = persistido.sections.flatMap(s => s.items);
  assert.equal(items.length, 32);
  assert.ok(items.every(item => item.etat === 'en_attente'));
  assert.equal(persistido.sections[0].timing.avant, 10);
});

test('run completa el set y lo marca complet', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 2 });
  await pipeline.run(set.id);

  const final = await readSet(dataDir, set.id);
  assert.equal(final.statut, 'complet');
  const items = final.sections.flatMap(s => s.items);
  assert.ok(items.every(item => item.etat === 'pret'));
  assert.equal(items[0].duree_audio_s, 42.5);
  assert.match(items[0].audio, /^audio\/s1i1\.wav$/);
  assert.equal(items[0].provider, 'fake-provider');
  assert.deepEqual(items[0].images, []);
});

test('maxItems corta la tanda y el resto queda pendiente', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 3 });
  await pipeline.run(set.id, { maxItems: 5 });

  const parcial = await readSet(dataDir, set.id);
  const items = parcial.sections.flatMap(s => s.items);
  assert.equal(items.filter(i => i.etat === 'pret').length, 5);
  assert.equal(parcial.statut, 'partial');
});

test('reanudar no regenera lo ya listo', async () => {
  const { dataDir, pipeline, generator } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 4 });
  await pipeline.run(set.id, { maxItems: 10 });
  const llamadasTrasPrimera = generator.contador.llamadas;

  await pipeline.run(set.id);
  const final = await readSet(dataDir, set.id);
  assert.equal(final.statut, 'complet');
  assert.equal(generator.contador.llamadas, 32, 'cada ítem se genera exactamente una vez');
  assert.equal(llamadasTrasPrimera, 10);
});

test('el texto se persiste antes del audio: si el TTS falla no se pierde lo pagado', async () => {
  const { dataDir, pipeline } = await nuevoPipeline({ synth: synthFake({ fallarSiempre: true }) });
  const set = await pipeline.createSet({ seed: 5 });
  await pipeline.run(set.id, { maxItems: 3 });

  const parcial = await readSet(dataDir, set.id);
  const items = parcial.sections.flatMap(s => s.items);
  assert.equal(items[0].etat, 'genere', 'el texto validado debe sobrevivir al fallo de TTS');
  assert.ok(items[0].transcript.length > 0);
  assert.equal(parcial.statut, 'partial');
  assert.ok(parcial.ledger.tts.echecs > 0);
});

test('reanudar tras un fallo de TTS solo sintetiza, no regenera texto', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const generator = generadorFake();
  const roto = createPipeline({ dataDir, generator, synth: synthFake({ fallarSiempre: true }), catalog: catalogoAmplio() });
  const set = await roto.createSet({ seed: 6 });
  await roto.run(set.id, { maxItems: 2 });
  const llamadasTexto = generator.contador.llamadas;

  const sano = createPipeline({ dataDir, generator, synth: synthFake(), catalog: catalogoAmplio() });
  await sano.run(set.id, { maxItems: 2 });

  const final = await readSet(dataDir, set.id);
  const items = final.sections.flatMap(s => s.items);
  assert.equal(items[0].etat, 'pret');
  assert.equal(generator.contador.llamadas, llamadasTexto, 'no debe regenerar texto ya validado');
});

test('un ítem imposible se marca echoue y el bucle sigue', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const catalog = catalogoAmplio();
  const pipeline = createPipeline({ dataDir, generator: generadorFake(), synth: synthFake(), catalog });
  const set = await pipeline.createSet({ seed: 7 });

  const objetivo = set.plan[0].topicId;
  const conFallo = createPipeline({
    dataDir, catalog, synth: synthFake(),
    generator: generadorFake({ fallarEn: new Set([objetivo]) }),
  });
  await conFallo.run(set.id);

  const final = await readSet(dataDir, set.id);
  const items = final.sections.flatMap(s => s.items);
  assert.equal(items[0].etat, 'echoue');
  assert.ok(items[0].erreur.includes('fallo simulado'));
  assert.equal(items.filter(i => i.etat === 'pret').length, 31, 'los demás ítems deben completarse');
  assert.equal(final.statut, 'partial');
});

test('reanudar reintenta los echoue con el MISMO topicId', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const catalog = catalogoAmplio();
  const base = createPipeline({ dataDir, generator: generadorFake(), synth: synthFake(), catalog });
  const set = await base.createSet({ seed: 8 });
  const objetivo = set.plan[0].topicId;

  const conFallo = createPipeline({
    dataDir, catalog, synth: synthFake(), generator: generadorFake({ fallarEn: new Set([objetivo]) }),
  });
  await conFallo.run(set.id);
  await base.run(set.id);

  const final = await readSet(dataDir, set.id);
  assert.equal(final.statut, 'complet');
  assert.equal(final.plan[0].topicId, objetivo, 'un reintento no debe consumir un tema nuevo');
  assert.equal(final.sections[0].items[0].topicId, objetivo);
});

test('el ledger cuadra con las llamadas realizadas', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 9 });
  await pipeline.run(set.id);

  const final = await readSet(dataDir, set.id);
  assert.equal(final.ledger.texte.appels, 32);
  assert.equal(final.ledger.tts.appels, 32);
  assert.equal(final.ledger.images.appels, 0);
});

test('isRunning bloquea una segunda ejecución concurrente', async () => {
  const { pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 10 });

  const enCurso = pipeline.run(set.id);
  assert.equal(pipeline.isRunning(set.id), true);
  await assert.rejects(() => pipeline.run(set.id), /en curso/);
  await enCurso;
  assert.equal(pipeline.isRunning(set.id), false);
});

test('el plan y las relajaciones quedan persistidos en el set', async () => {
  const { dataDir, pipeline } = await nuevoPipeline();
  const set = await pipeline.createSet({ seed: 11 });
  const persistido = await readSet(dataDir, set.id);
  assert.equal(persistido.plan.length, 32);
  assert.ok(Array.isArray(persistido.relaxations));
  assert.equal(persistido.seed, 11);
});

test('createSet rechaza formatos que no existen', async () => {
  const { pipeline } = await nuevoPipeline();
  await assert.rejects(() => pipeline.createSet({ format: 'SET_STANDARD_99', seed: 1 }), /Formato no soportado/);
});

test('un fallo de TTS por cuota/red detiene la corrida completa (parada limpia)', async () => {
  const { dataDir, pipeline } = await nuevoPipeline({ synth: synthFake({ fallarSiempre: true, fallaDeCuota: true }) });
  const set = await pipeline.createSet({ seed: 20 });
  await pipeline.run(set.id, { maxItems: 5 });

  const parcial = await readSet(dataDir, set.id);
  const items = parcial.sections.flatMap(s => s.items);
  const tocados = items.filter(i => i.etat === 'genere' || i.etat === 'pret').length;
  assert.equal(tocados, 1, 'debe detenerse tras el primer fallo de cuota, sin generar texto para los demás pese a maxItems:5');
  assert.equal(parcial.statut, 'partial');
});

test('createSet con SET_STANDARD_40 escribe 36 ítems, incluida conversation_image', async () => {
  const { pipeline } = await nuevoPipelineConImagenes();
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  assert.equal(set.format, 'SET_STANDARD_40');
  assert.equal(set.plan.length, 36);
  const convImg = set.plan.filter(p => p.sectionType === 'conversation_image');
  assert.equal(convImg.length, 4);
});

test('createSet rechaza pilotes:true con SET_STANDARD_40', async () => {
  const { pipeline } = await nuevoPipelineConImagenes();
  await assert.rejects(
    () => pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40', pilotes: true }),
    /pilot/i,
  );
});

test('run genera texto, audio y 4 imágenes para conversation_image, y marca pret', async () => {
  const { dataDir, pipeline, imageSynth } = await nuevoPipelineConImagenes();
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  await pipeline.run(set.id);

  const final = await readSet(dataDir, set.id);
  const itemsImagen = final.sections.find(s => s.type === 'conversation_image').items;
  assert.equal(itemsImagen.length, 4);
  for (const item of itemsImagen) {
    assert.equal(item.etat, 'pret');
    assert.equal(item.images.length, 4);
    assert.deepEqual(item.images.map(i => i.id).sort(), ['A', 'B', 'C', 'D']);
    assert.ok(item.images.every(i => i.path === `images/${item.ref}-${i.id}.png`));
  }
  // 4 ítems x (1 referencia + 4 opciones) = 20 llamadas de imagen
  assert.equal(imageSynth.contador.llamadas, 20);
  assert.equal(final.ledger.images.appels, 20);
});

test('reanudación tras fallo de una imagen NO regenera texto ni las imágenes ya listas', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pipe-img-'));
  const generator = generadorFakeConversationImage();
  const synth = synthFake();

  let llamadas = 0;
  const imageSynthQueFallaUnaVez = {
    contador: { llamadas: 0 },
    async synthImageToFile({ outPath }) {
      llamadas += 1;
      this.contador.llamadas += 1;
      // Falla justo en la 3ra llamada de imagen del primer ítem (referencia +
      // A ok, B falla) -- fuerza una reanudación parcial.
      if (llamadas === 3) {
        const error = new Error('fallo puntual de imagen');
        throw error;
      }
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, 'fake-image-bytes');
      return { base64: 'ZmFrZQ==' };
    },
    async readReferenceIfExists(path) {
      try {
        await readFile(path);
        return 'ZmFrZQ==';
      } catch {
        return null;
      }
    },
  };

  const pipeline = createPipeline({
    dataDir, generator, synth, imageSynth: imageSynthQueFallaUnaVez, catalog: catalogoConImagenes(),
  });
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  await pipeline.run(set.id, { maxItems: 1 });

  let intermedio = await readSet(dataDir, set.id);
  const primerItem = intermedio.sections[0].items[0];
  assert.equal(primerItem.etat, 'genere', 'no debe pasar a echoue por un fallo de imagen');
  assert.equal(primerItem.images.length, 1, 'solo A quedó registrada antes del fallo');
  assert.ok(primerItem.transcript, 'el texto ya generado no se pierde');
  const llamadasGeneratorAntes = generator.contador.llamadas;

  await pipeline.run(set.id, { maxItems: 1 });

  const final = await readSet(dataDir, set.id);
  const itemFinal = final.sections[0].items[0];
  assert.equal(itemFinal.etat, 'pret');
  assert.equal(itemFinal.images.length, 4);
  assert.equal(generator.contador.llamadas, llamadasGeneratorAntes, 'no se volvió a llamar al generador de texto');
});

test('esFalloDeCuotaORed en el paso de imágenes detiene la tanda completa', async () => {
  const { pipeline, imageSynth: _unused } = await nuevoPipelineConImagenes({
    imageSynth: imageSynthFake({ fallarSiempre: true, fallaDeCuota: true }),
  });
  const set = await pipeline.createSet({ seed: 1, format: 'SET_STANDARD_40' });
  const resultado = await pipeline.run(set.id);
  const itemsImagen = resultado.sections.find(s => s.type === 'conversation_image').items;
  assert.ok(itemsImagen.every(item => item.etat !== 'pret'));
});
