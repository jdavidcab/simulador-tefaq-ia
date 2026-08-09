import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, aplanarItem, temaAleatorioParaSeccion, filtrarSetsPorFormato } from '../server.js';
import { TOPICS } from '../src/topics/catalog.js';
import { REFORMULATION_TYPES } from '../src/validation/reformulation.js';

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

test('POST /api/sets/generate rechaza una dificultad inválida con 400', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty: 'XYZ' }),
    });
    assert.equal(res.status, 400);
  });
});

test('GET /api/generate-question rechaza minWords/maxWords inválidos con 400', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/generate-question?minWords=abc`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(typeof data.error === 'string' && data.error.length > 0);
  });
});

test('GET /api/generate-question rechaza un provider desconocido con 400', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/generate-question?provider=noexiste`);
    assert.equal(res.status, 400);
  });
});

test('POST /api/sets/generate rechaza un typeFilter inválido con 400', async () => {
  await conServidor(async (base) => {
    const res = await fetch(`${base}/api/sets/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'SET_DRILL_PARAPHRASE', typeFilter: 'no-existe' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, new RegExp(REFORMULATION_TYPES.join('|')));
  });
});

test('filtrarSetsPorFormato sin formato deja solo los formatos de examen', () => {
  const sets = [
    { id: 'a', format: 'SET_STANDARD_36' },
    { id: 'b', format: 'SET_STANDARD_40' },
    { id: 'c', format: 'SET_DRILL_PARAPHRASE' },
  ];
  const resultado = filtrarSetsPorFormato(sets, undefined);
  assert.deepEqual(resultado.map(s => s.id), ['a', 'b']);
});

test('filtrarSetsPorFormato con formato=SET_DRILL_PARAPHRASE excluye los de examen', () => {
  const sets = [
    { id: 'a', format: 'SET_STANDARD_36' },
    { id: 'b', format: 'SET_DRILL_PARAPHRASE' },
  ];
  const resultado = filtrarSetsPorFormato(sets, 'SET_DRILL_PARAPHRASE');
  assert.deepEqual(resultado.map(s => s.id), ['b']);
});

test('filtrarSetsPorFormato con formato desconocido no revienta, solo no matchea nada', () => {
  const sets = [{ id: 'a', format: 'SET_STANDARD_36' }];
  assert.deepEqual(filtrarSetsPorFormato(sets, 'NO_EXISTE'), []);
});
