import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateScore699 } from './examScoring.js';

test('0/36 correctas -> estimado 0, no B2', () => {
  const result = estimateScore699(0, 36);
  assert.equal(result.estimated699, 0);
  assert.equal(result.isB2, false);
});

test('36/36 correctas -> estimado 699, B2', () => {
  const result = estimateScore699(36, 36);
  assert.equal(result.estimated699, 699);
  assert.equal(result.isB2, true);
});

test('20/36 correctas -> estimado 388, no B2', () => {
  const result = estimateScore699(20, 36);
  assert.equal(result.estimated699, 388);
  assert.equal(result.isB2, false);
});

test('21/36 correctas -> estimado 408, B2', () => {
  const result = estimateScore699(21, 36);
  assert.equal(result.estimated699, 408);
  assert.equal(result.isB2, true);
});

test('thresholdCount es 21 para 36 preguntas', () => {
  const { thresholdCount } = estimateScore699(0, 36);
  assert.equal(thresholdCount, 21);
});

test('invariante: 0 <= estimated699 <= 699 para todo correctTotal de 0 a 36', () => {
  for (let correctTotal = 0; correctTotal <= 36; correctTotal += 1) {
    const { estimated699 } = estimateScore699(correctTotal, 36);
    assert.ok(
      estimated699 >= 0 && estimated699 <= 699,
      `fuera de rango en correctTotal=${correctTotal}: ${estimated699}`,
    );
  }
});

// Confirma que thresholdCount es genuinamente el mínimo que la propia fórmula
// marca como B2 a 36 preguntas -- no una cifra calculada aparte que
// coincidentemente se ve bien. No se generaliza a otros totalQuestions (ver
// docs/superpowers/specs/2026-08-06-score-699-design.md, sección Testing).
test('consistencia badge/threshold a 36 preguntas: thresholdCount-1 no es B2, thresholdCount sí', () => {
  const { thresholdCount } = estimateScore699(0, 36);
  assert.equal(estimateScore699(thresholdCount - 1, 36).isB2, false);
  assert.equal(estimateScore699(thresholdCount, 36).isB2, true);
});

test('rechaza totalQuestions inválido: cero, negativo, decimal', () => {
  assert.throws(() => estimateScore699(0, 0));
  assert.throws(() => estimateScore699(0, -5));
  assert.throws(() => estimateScore699(0, 36.5));
});

test('rechaza correctTotal inválido: negativo, decimal, mayor que totalQuestions', () => {
  assert.throws(() => estimateScore699(-1, 36));
  assert.throws(() => estimateScore699(10.5, 36));
  assert.throws(() => estimateScore699(37, 36));
});
