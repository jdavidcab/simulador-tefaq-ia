import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewModel } from './reviewModel.js';

function fixtureSet() {
  return {
    sections: [
      {
        type: 'annonce_publique',
        items: [
          { ref: 's1i1', questions: [{ correctId: 'A' }] },
          { ref: 's1i2', questions: [{ correctId: 'B' }] },
        ],
      },
      {
        type: 'interview',
        items: [
          { ref: 's2i1', questions: [{ correctId: 'A' }, { correctId: 'C' }] },
        ],
      },
    ],
  };
}

function fixtureSetReformulacion(questionOverrides = {}) {
  return {
    sections: [
      {
        type: 'annonce_publique',
        items: [
          {
            ref: 's1i1',
            questions: [{
              correctId: 'A',
              options: [
                { id: 'A', text: 'Fermeture de la piscine' },
                { id: 'B', text: 'Une option quelconque', literalTrap: true },
                { id: 'C', text: 'Une autre option' },
              ],
              reformulation: {
                extrait_audio: 'on va fermer la piscine cet été',
                option_correcte: 'Fermeture de la piscine',
                type: 'nominalisation',
              },
              ...questionOverrides,
            }],
          },
        ],
      },
    ],
  };
}

test('pregunta correcta: answered true, isCorrect true', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'A' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.answered, true);
  assert.equal(q.isCorrect, true);
  assert.equal(q.selectedId, 'A');
  assert.equal(q.correctId, 'A');
});

test('pregunta incorrecta: answered true, isCorrect false', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.answered, true);
  assert.equal(q.isCorrect, false);
});

test('pregunta sin responder: answered false, isCorrect false, distinto de una respuesta incorrecta', () => {
  const set = fixtureSet();
  const model = buildReviewModel(set, {});
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.answered, false);
  assert.equal(q.isCorrect, false);
  assert.equal(q.selectedId, null);
});

test('pregunta cerrada sin responder (null, tiempo agotado): answered false, isCorrect false, igual que sin visitar', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: null } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.answered, false);
  assert.equal(q.isCorrect, false);
  assert.equal(q.selectedId, null);
});

test('ítem de una pregunta: correctCount/questionCount del ítem', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'A' }, s1i2: { 0: 'X' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].correctCount, 1);
  assert.equal(model.sections[0].items[0].questionCount, 1);
  assert.equal(model.sections[0].items[1].correctCount, 0);
});

test('ítem de dos preguntas (interview): correctCount cuenta ambas preguntas', () => {
  const set = fixtureSet();
  const answers = { interview: { s2i1: { 0: 'A', 1: 'X' } } };
  const model = buildReviewModel(set, answers);
  const item = model.sections[1].items[0];
  assert.equal(item.questionCount, 2);
  assert.equal(item.correctCount, 1);
});

test('conteo a nivel sección suma los ítems', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'A' }, s1i2: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].correctCount, 2);
  assert.equal(model.sections[0].questionCount, 2);
});

test('sección sin ninguna respuesta: correctCount 0, questionCount igual a las preguntas reales', () => {
  const set = fixtureSet();
  const model = buildReviewModel(set, {});
  assert.equal(model.sections[1].correctCount, 0);
  assert.equal(model.sections[1].questionCount, 2);
});

test('pregunta fallada con reformulation completa: el modelo expone el bloque', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.deepEqual(q.reformulation, {
    extrait_audio: 'on va fermer la piscine cet été',
    option_correcte: 'Fermeture de la piscine',
    type: 'nominalisation',
  });
});

test('pregunta correcta: reformulation queda null aunque la metadata cruda sea válida', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'A' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].reformulation, null);
});

test('sin responder: reformulation presente (cuenta como fallada), selectedLiteralTrap false', () => {
  const set = fixtureSetReformulacion();
  const model = buildReviewModel(set, {});
  const q = model.sections[0].items[0].questions[0];
  assert.deepEqual(q.reformulation, {
    extrait_audio: 'on va fermer la piscine cet été',
    option_correcte: 'Fermeture de la piscine',
    type: 'nominalisation',
  });
  assert.equal(q.selectedLiteralTrap, false);
});

test('set sin metadata de reformulación (sections/items sin options ni reformulation): reformulation null', () => {
  const set = fixtureSet();
  const answers = { annonce_publique: { s1i1: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  const q = model.sections[0].items[0].questions[0];
  assert.equal(q.reformulation, null);
  assert.equal(q.selectedLiteralTrap, false);
});

test('reformulation con type inválido: se trata como ausente', () => {
  const set = fixtureSetReformulacion({
    reformulation: { extrait_audio: 'texto', option_correcte: 'Fermeture de la piscine', type: 'paraphrase' },
  });
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].reformulation, null);
});

test('reformulation con extrait_audio vacío: se trata como ausente', () => {
  const set = fixtureSetReformulacion({
    reformulation: { extrait_audio: '', option_correcte: 'Fermeture de la piscine', type: 'nominalisation' },
  });
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].reformulation, null);
});

test('opción incorrecta elegida que NO es la trampa: selectedLiteralTrap false', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'C' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].selectedLiteralTrap, false);
});

test('opción incorrecta elegida que SÍ es la trampa: selectedLiteralTrap true', () => {
  const set = fixtureSetReformulacion();
  const answers = { annonce_publique: { s1i1: { 0: 'B' } } };
  const model = buildReviewModel(set, answers);
  assert.equal(model.sections[0].items[0].questions[0].selectedLiteralTrap, true);
});
