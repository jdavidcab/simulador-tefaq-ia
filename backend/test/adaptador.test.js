import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, aplanarItem, temaAleatorioParaSeccion } from '../server.js';
import { TOPICS } from '../src/topics/catalog.js';

test('aplana el ítem nuevo a la forma que espera el frontend de entrenamiento', () => {
  const item = {
    transcript: 'Le service sera interrompu jusqu’à midi.',
    provider: 'gemini-3.5-flash',
    tentativas: 1,
    questions: [{
      prompt: 'Quel est le message ?',
      options: [
        { id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' },
      ],
      correctId: 'C',
      feedback: 'La opción C es correcta.',
      justification: 'Le service sera interrompu',
      justificationScore: 1,
    }],
  };

  const plano = aplanarItem(item);
  assert.equal(plano.prompt, 'Quel est le message ?');
  assert.equal(plano.correctId, 'C');
  // aplanarItem ya no transforma el feedback (ver fix: normalizeFeedback se
  // movió a itemGenerator.js para blindar también el pipeline de sets), así
  // que aquí solo pasa el valor de entrada tal cual.
  assert.equal(plano.feedback, 'La opción C es correcta.');
  assert.equal(plano.transcript, item.transcript);
  assert.equal(plano.options.length, 4);
  assert.deepEqual(plano.options.map(o => o.id), ['A', 'B', 'C', 'D']);
});

test('la forma aplanada no filtra campos internos del esquema de sets', () => {
  const plano = aplanarItem({
    transcript: 't', provider: 'p', tentativas: 3,
    questions: [{
      prompt: 'p', options: [{ id: 'A', text: 'a' }], correctId: 'A',
      feedback: 'f', justification: 'j', justificationScore: 0.9,
    }],
  });
  assert.equal(plano.questions, undefined, 'no debe exponer el array anidado');
  assert.equal(plano.justification, undefined, 'justification es interna del pipeline de sets');
  assert.equal(plano.justificationScore, undefined);
  assert.equal(plano.tentativas, undefined);
});

test('aplanarItem no transforma el feedback, ya llega normalizado desde el generador', () => {
  const item = {
    transcript: 't',
    questions: [{
      prompt: 'p',
      options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' }],
      correctId: 'B',
      feedback: 'La opción B es correcta porque el anuncio lo menciona explícitamente.',
      justification: 'j',
    }],
  };
  const plano = aplanarItem(item);
  // La normalización (blindaje contra letras obsoletas/contradictorias en el
  // feedback) ahora vive en itemGenerator.js:generateItem, antes de que el
  // ítem llegue aquí -- aplanarItem solo hace pass-through.
  assert.equal(plano.feedback, item.questions[0].feedback);
});

test('temaAleatorioParaSeccion solo elige temas etiquetados para esa sección', () => {
  for (let i = 0; i < 50; i += 1) {
    const texto = temaAleatorioParaSeccion('divers');
    const tema = TOPICS.find(t => t.text === texto);
    assert.ok(tema, 'el texto devuelto debe corresponder a un tema real del catálogo');
    assert.ok(tema.sections.includes('divers'), `el tema "${texto}" no está etiquetado para divers`);
  }
});

async function conServidor(fn) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('rechaza un id de set con formato inválido antes de tocar el filesystem (path traversal)', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets/..%2F..%2Fetc%2Fpasswd/status`);
    assert.equal(res.status, 400);
  });
});

test('un id bien formado pero inexistente da 404, no 400', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets/set-2020-01-01-aaaa/status`);
    assert.equal(res.status, 404);
  });
});

test('la ruta de audio también rechaza un id inválido', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets/..%2F..%2Fetc/audio/x.wav`);
    assert.equal(res.status, 400);
  });
});
