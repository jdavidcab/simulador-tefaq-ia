import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, countWords } from '../src/validation/index.js';
import { MICRO_TROTTOIR_POSTURES, CONFIG } from '../src/examFormat.js';

function palabras(n, base = 'mot') {
  return Array.from({ length: n }, (_, i) => `${base}${i}`).join(' ');
}

function preguntaValida(transcript) {
  return {
    prompt: 'Quel est le problème signalé ?',
    options: [
      { id: 'A', text: 'Une panne de chauffage' },
      { id: 'B', text: 'Une fuite d’eau' },
      { id: 'C', text: 'Un bruit de voisinage' },
      { id: 'D', text: 'Une porte bloquée' },
    ],
    correctId: 'B',
    feedback: 'La locataire signale de l’eau au plafond.',
    justification: transcript.split(' ').slice(0, 10).join(' '),
  };
}

function itemValido(sectionType, numPalabras) {
  const transcript = palabras(numPalabras);
  return { transcript, questions: [preguntaValida(transcript)] };
}

test('acepta un ítem correcto de annonce_publique', () => {
  const item = itemValido('annonce_publique', 45);
  assert.doesNotThrow(() => validateItem(item, 'annonce_publique'));
});

test('anota justificationScore en cada pregunta', () => {
  const item = itemValido('annonce_publique', 45);
  const validado = validateItem(item, 'annonce_publique');
  assert.equal(validado.questions[0].justificationScore, 1);
});

test('rechaza transcript vacío', () => {
  const item = itemValido('annonce_publique', 45);
  item.transcript = '   ';
  assert.throws(() => validateItem(item, 'annonce_publique'), /transcript/);
});

test('countWords ignora espacios múltiples', () => {
  assert.equal(countWords('  un   deux trois  '), 3);
});

function dialogoInterview(numPalabras) {
  const cuerpo = palabras(numPalabras).split(' ');
  const mitad = Math.floor(cuerpo.length / 2);
  return `Journaliste: ${cuerpo.slice(0, mitad).join(' ')} Invité(e): ${cuerpo.slice(mitad).join(' ')}`;
}

test('aplica tolerancia proporcional: interview admite ±15 sobre 200-300', () => {
  const transcript = dialogoInterview(311); // 313 palabras con las etiquetas: dentro de 185-315
  const dentro = { transcript, questions: [preguntaValida(transcript), preguntaValida(transcript)] };
  assert.doesNotThrow(() => validateItem(dentro, 'interview'));

  const largo = dialogoInterview(400);
  const fuera = { transcript: largo, questions: [preguntaValida(largo), preguntaValida(largo)] };
  assert.throws(() => validateItem(fuera, 'interview'), /fuera de rango/);
});

test('rechaza transcript fuera del rango tolerado', () => {
  const item = itemValido('annonce_publique', 100);
  assert.throws(() => validateItem(item, 'annonce_publique'), /fuera de rango/);
});

test('exige tantas preguntas como questionsPerAudio', () => {
  const item = itemValido('reportage', 180);
  assert.throws(() => validateItem(item, 'reportage'), /2 preguntas/);
});

test('rechaza si no hay exactamente 4 opciones', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].options.pop();
  assert.throws(() => validateItem(item, 'annonce_publique'), /4 elementos/);
});

test('rechaza correctId que no apunta a ninguna opción', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].correctId = 'Z';
  assert.throws(() => validateItem(item, 'annonce_publique'), /correctId/);
});

test('rechaza feedback vacío', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].feedback = '';
  assert.throws(() => validateItem(item, 'annonce_publique'), /feedback/);
});

test('rechaza justification que no está en el transcript', () => {
  const item = itemValido('annonce_publique', 45);
  item.questions[0].justification = 'ceci ne figure absolument nulle part dans le message';
  assert.throws(() => validateItem(item, 'annonce_publique'), /justification/);
});

test('micro_trottoir exige las posturas del preset en orden fijo', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const transcript = palabras(55);
  const item = {
    transcript,
    questions: [{
      ...preguntaValida(transcript),
      options: posturas.map((text, i) => ({ id: 'ABCD'[i], text })),
      correctId: 'B',
    }],
  };
  assert.doesNotThrow(() => validateItem(item, 'micro_trottoir', { posture: posturas[1] }));

  item.questions[0].options[0].text = 'plutôt favorable';
  assert.throws(() => validateItem(item, 'micro_trottoir', { posture: posturas[1] }), /posturas/);
});

test('micro_trottoir rechaza si la postura correcta no es la pedida', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const transcript = palabras(55);
  const item = {
    transcript,
    questions: [{
      ...preguntaValida(transcript),
      options: posturas.map((text, i) => ({ id: 'ABCD'[i], text })),
      correctId: 'A',
    }],
  };
  assert.throws(() => validateItem(item, 'micro_trottoir', { posture: posturas[2] }), /postura/);
});

test('interview exige diálogo con dos etiquetas alternadas', () => {
  const dialogado = dialogoInterview(240);
  const item = { transcript: dialogado, questions: [preguntaValida(dialogado), preguntaValida(dialogado)] };
  assert.doesNotThrow(() => validateItem(item, 'interview'));
});

test('interview rechaza un monólogo con una sola etiqueta', () => {
  const monologo = `Journaliste: ${palabras(250)}`;
  const item = { transcript: monologo, questions: [preguntaValida(monologo), preguntaValida(monologo)] };
  assert.throws(() => validateItem(item, 'interview'), /diálogo|alternancia/i);
});

test('minWords y maxWords se pueden sobreescribir (modo entrenamiento)', () => {
  const item = itemValido('divers', 35);
  assert.throws(() => validateItem(item, 'divers'), /fuera de rango/);
  assert.doesNotThrow(() => validateItem(item, 'divers', { minWords: 30, maxWords: 50 }));
});
