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
