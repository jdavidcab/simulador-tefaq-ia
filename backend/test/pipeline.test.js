import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function synthFake({ fallarSiempre = false, contador = { llamadas: 0 } } = {}) {
  return {
    contador,
    async synthToFile({ outPath }) {
      contador.llamadas += 1;
      if (fallarSiempre) {
        const error = new Error('cuota TTS agotada');
        error.status = 429;
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

test('createSet rechaza formatos que este slice no genera', async () => {
  const { pipeline } = await nuevoPipeline();
  await assert.rejects(() => pipeline.createSet({ format: 'SET_STANDARD_40', seed: 1 }), /SET_STANDARD_36/);
});
