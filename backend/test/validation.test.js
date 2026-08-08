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
      { id: 'C', text: 'Un bruit de voisinage proche de mot20 et mot21' },
      { id: 'D', text: 'Une porte bloquée' },
    ],
    correctId: 'B',
    feedback: 'La locataire signale de l’eau au plafond.',
    justification: transcript.split(' ').slice(0, 10).join(' '),
    reformulationType: 'nominalisation',
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

function dialogoInterview(numPalabras, turnos = 4) {
  const cuerpo = palabras(numPalabras).split(' ');
  const porTurno = Math.floor(cuerpo.length / turnos);
  const partes = [];
  for (let i = 0; i < turnos; i += 1) {
    const etiqueta = i % 2 === 0 ? 'Journaliste' : 'Invité(e)';
    const inicio = i * porTurno;
    const fin = i === turnos - 1 ? cuerpo.length : inicio + porTurno;
    partes.push(`${etiqueta}: ${cuerpo.slice(inicio, fin).join(' ')}`);
  }
  return partes.join(' ');
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

test('adjunta metadata de reformulación en secciones no excluidas', () => {
  const item = itemValido('annonce_publique', 45);
  const validado = validateItem(item, 'annonce_publique');
  assert.deepEqual(validado.questions[0].reformulation, {
    extrait_audio: validado.questions[0].justification,
    option_correcte: 'Une fuite d’eau',
    type: 'nominalisation',
  });
});

test('rechaza una pregunta sin reformulationType en secciones no excluidas', () => {
  const item = itemValido('annonce_publique', 45);
  delete item.questions[0].reformulationType;
  assert.throws(() => validateItem(item, 'annonce_publique'), /reformulationType/);
});

test('el chequeo de reformulación se salta para micro_trottoir', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const transcript = palabras(55);
  const item = {
    transcript,
    questions: [{
      prompt: 'Quelle est la position de la personne interviewée ?',
      options: posturas.map((text, i) => ({ id: 'ABCD'[i], text })),
      correctId: 'B',
      feedback: 'La persona expresa esta postura con matices.',
      justification: transcript.split(' ').slice(0, 10).join(' '),
      // deliberadamente sin reformulationType ni distractor-trampa: si el
      // guard de sectionType fallara, esto rechazaría el ítem.
    }],
  };
  assert.doesNotThrow(() => validateItem(item, 'micro_trottoir', { posture: posturas[1] }));
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

test('interview rechaza un monólogo con una sola transición (aside incidental, no diálogo real)', () => {
  const adversarial = `Journaliste: ${palabras(240)} Note: ${palabras(5)}`;
  const item = { transcript: adversarial, questions: [preguntaValida(adversarial), preguntaValida(adversarial)] };
  assert.throws(() => validateItem(item, 'interview'), /alternancia real|al menos 2 cambios/);
});

test('minWords y maxWords se pueden sobreescribir (modo entrenamiento)', () => {
  const item = itemValido('divers', 35);
  assert.throws(() => validateItem(item, 'divers'), /fuera de rango/);
  assert.doesNotThrow(() => validateItem(item, 'divers', { minWords: 30, maxWords: 50 }));
});

test('acepta exactamente en el límite inferior de tolerancia (27 palabras para annonce_publique)', () => {
  const item = itemValido('annonce_publique', 27);
  assert.doesNotThrow(() => validateItem(item, 'annonce_publique'));
});

test('rechaza una palabra por debajo del límite inferior de tolerancia (26 palabras)', () => {
  const item = itemValido('annonce_publique', 26);
  assert.throws(() => validateItem(item, 'annonce_publique'), /fuera de rango/);
});

test('acepta exactamente en el límite superior de tolerancia (63 palabras para annonce_publique)', () => {
  const item = itemValido('annonce_publique', 63);
  assert.doesNotThrow(() => validateItem(item, 'annonce_publique'));
});

test('rechaza una palabra por encima del límite superior de tolerancia (64 palabras)', () => {
  const item = itemValido('annonce_publique', 64);
  assert.throws(() => validateItem(item, 'annonce_publique'), /fuera de rango/);
});

function itemConversationImageValido(overrides = {}) {
  return {
    transcript: 'Bonjour, je cherche une baguette et un croissant pour ce matin, vous en avez encore ? Oui bien sûr, je vous les prépare tout de suite avec plaisir.',
    questions: [{
      prompt: 'Quelle image correspond à la conversation ?',
      options: [
        { id: 'A', text: 'Une baguette', imagePrompt: 'Un pain baguette sur un comptoir' },
        { id: 'B', text: 'Un croissant', imagePrompt: 'Un croissant sur une assiette' },
        { id: 'C', text: 'Une pizza', imagePrompt: 'Une pizza sur une table' },
        { id: 'D', text: 'Une salade', imagePrompt: 'Une salade dans un bol' },
      ],
      correctId: 'A',
      feedback: 'Se menciona explícitamente una baguette.',
      justification: 'je cherche une baguette et un croissant pour ce matin, vous en avez encore',
    }],
    ...overrides,
  };
}

test('valida un ítem correcto de conversation_image', () => {
  const item = itemConversationImageValido();
  assert.doesNotThrow(() => validateItem(item, 'conversation_image', { minWords: 5, maxWords: 100 }));
});

test('rechaza una opción de conversation_image sin imagePrompt', () => {
  const item = itemConversationImageValido();
  delete item.questions[0].options[0].imagePrompt;
  assert.throws(
    () => validateItem(item, 'conversation_image', { minWords: 5, maxWords: 100 }),
    /imagePrompt/,
  );
});

test('rechaza una opción de conversation_image con imagePrompt vacío', () => {
  const item = itemConversationImageValido();
  item.questions[0].options[1].imagePrompt = '   ';
  assert.throws(
    () => validateItem(item, 'conversation_image', { minWords: 5, maxWords: 100 }),
    /imagePrompt/,
  );
});
