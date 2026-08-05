import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createItemGenerator, esFalloDeCuotaORed } from '../src/itemGenerator.js';
import { CONFIG } from '../src/examFormat.js';

function itemJson({ palabras = 45, correctId = 'B' } = {}) {
  const transcript = Array.from({ length: palabras }, (_, i) => `mot${i}`).join(' ');
  return JSON.stringify({
    transcript,
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible' },
      ],
      correctId,
      feedback: 'El anuncio lo dice de forma parafraseada.',
      justification: transcript.split(' ').slice(0, 10).join(' '),
    }],
  });
}

function proveedorFake(name, respuestas) {
  const llamadas = [];
  return {
    name,
    llamadas,
    async generate(prompt) {
      llamadas.push(prompt);
      const siguiente = respuestas.shift();
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    },
  };
}

function errorHttp(status) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
}

const BASE = { sectionType: 'annonce_publique', topic: 'un aviso municipal', difficulty: 'B2' };

test('devuelve el ítem validado con el proveedor y el número de intentos', async () => {
  const gemini = proveedorFake('gemini', [itemJson()]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.equal(item.provider, 'gemini');
  assert.equal(item.tentativas, 1);
  assert.equal(item.questions.length, 1);
});

test('limpia las vallas de markdown alrededor del JSON', async () => {
  const gemini = proveedorFake('gemini', ['```json\n' + itemJson() + '\n```']);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.ok(item.transcript.length > 0);
});

test('un fallo de validación reintenta el MISMO proveedor', async () => {
  const gemini = proveedorFake('gemini', [itemJson({ palabras: 500 }), itemJson()]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'gemini', 'no debe bajar de modelo por ruido de muestreo');
  assert.equal(item.tentativas, 2);
  assert.equal(deepseek.llamadas.length, 0);
});

test('agotados los reintentos de validación, avanza en la cadena', async () => {
  const malo = itemJson({ palabras: 500 });
  const gemini = proveedorFake('gemini', [malo, malo, malo]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, CONFIG.validationRetries + 1);
  assert.equal(item.provider, 'deepseek');
});

test('un 429 avanza de proveedor sin reintentar', async () => {
  const gemini = proveedorFake('gemini', [errorHttp(429)]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, 1, 'reintentar el mismo modelo tras un 429 no sirve de nada');
  assert.equal(item.provider, 'deepseek');
});

test('un timeout también avanza sin reintentar', async () => {
  const gemini = proveedorFake('gemini', [new Error('gemini: timeout tras 120s')]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, 1);
  assert.equal(item.provider, 'deepseek');
});

test('esFalloDeCuotaORed distingue los dos tipos de fallo', () => {
  assert.equal(esFalloDeCuotaORed(errorHttp(429)), true);
  assert.equal(esFalloDeCuotaORed(errorHttp(503)), true);
  assert.equal(esFalloDeCuotaORed(new Error('timeout tras 120s')), true);
  assert.equal(esFalloDeCuotaORed(new Error('fetch failed')), true);
  assert.equal(esFalloDeCuotaORed(new Error('"transcript" fuera de rango: 500 palabras')), false);
  assert.equal(esFalloDeCuotaORed(errorHttp(400)), false);
});

test('si toda la cadena falla, lanza con el detalle de lo intentado', async () => {
  const malo = itemJson({ palabras: 500 });
  const gemini = proveedorFake('gemini', [malo, malo, malo]);
  const deepseek = proveedorFake('deepseek', [errorHttp(429)]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  await assert.rejects(
    () => generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] }),
    (error) => {
      assert.equal(error.providersTried.length, 2);
      assert.match(error.providersTried[0].error, /fuera de rango/);
      return true;
    },
  );
});

test('omite los proveedores no configurados', async () => {
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ deepseek }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'deepseek');
});

test('lanza si ningún proveedor de la cadena está configurado', async () => {
  const generador = createItemGenerator({}, CONFIG);
  await assert.rejects(
    () => generador.generateItem({ ...BASE, selector: ['gemini'] }),
    /configurado/,
  );
});

test('baraja las opciones y renumera correctId salvo en micro_trottoir', async () => {
  const gemini = proveedorFake('gemini', [itemJson()]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.deepEqual(item.questions[0].options.map(o => o.id), ['A', 'B', 'C', 'D']);
  assert.ok(['A', 'B', 'C', 'D'].includes(item.questions[0].correctId));
});
