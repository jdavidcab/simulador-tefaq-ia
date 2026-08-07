import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSetCompatibility } from './setCompatibility.js';

// Espeja la composición real de SET_STANDARD_36 (backend/src/examFormat.js):
// 32 ítems de audio, 36 preguntas en total.
const COMPOSITION = [
  { type: 'annonce_publique', items: 4, questionsPerItem: 1 },
  { type: 'repondeur', items: 6, questionsPerItem: 1 },
  { type: 'micro_trottoir', items: 6, questionsPerItem: 1 },
  { type: 'chronique', items: 2, questionsPerItem: 1 },
  { type: 'interview', items: 3, questionsPerItem: 2 },
  { type: 'reportage', items: 1, questionsPerItem: 2 },
  { type: 'divers', items: 10, questionsPerItem: 1 },
];

function validSet(overrides = {}) {
  const sections = COMPOSITION.map(({ type, items, questionsPerItem }) => ({
    type,
    items: Array.from({ length: items }, (_, i) => ({
      ref: `${type}-${i}`,
      questions: Array.from({ length: questionsPerItem }, () => ({ correctId: 'A' })),
    })),
  }));
  return { format: 'SET_STANDARD_36', pilotes: false, sections, ...overrides };
}

test('acepta un set 32/36 sin pilotos', () => {
  assert.deepEqual(checkSetCompatibility(validSet()), { ok: true });
});

test('rechaza un set con pilotos', () => {
  const result = checkSetCompatibility(validSet({ pilotes: true }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /pilotos/);
});

test('rechaza un formato desconocido', () => {
  const result = checkSetCompatibility(validSet({ format: 'FORMATO_INVENTADO' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /Formato/);
});

const COMPOSITION_40 = [
  { type: 'conversation_image', items: 4, questionsPerItem: 1 },
  ...COMPOSITION,
];

function validSet40(overrides = {}) {
  const sections = COMPOSITION_40.map(({ type, items, questionsPerItem }) => ({
    type,
    items: Array.from({ length: items }, (_, i) => ({
      ref: `${type}-${i}`,
      questions: Array.from({ length: questionsPerItem }, () => ({ correctId: 'A' })),
    })),
  }));
  return { format: 'SET_STANDARD_40', pilotes: false, sections, ...overrides };
}

test('acepta un set 36/40 sin pilotos', () => {
  assert.deepEqual(checkSetCompatibility(validSet40()), { ok: true });
});

test('rechaza un SET_STANDARD_40 con menos de 36 ítems', () => {
  const set = validSet40();
  set.sections[0].items = set.sections[0].items.slice(0, 1);
  const result = checkSetCompatibility(set);
  assert.equal(result.ok, false);
  assert.match(result.reason, /36/);
});

test('rechaza un SET_STANDARD_40 con pilotos', () => {
  const result = checkSetCompatibility(validSet40({ pilotes: true }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /pilotos/);
});

test('rechaza un set con menos de 32 ítems', () => {
  const set = validSet();
  set.sections[0].items = set.sections[0].items.slice(0, 1);
  const result = checkSetCompatibility(set);
  assert.equal(result.ok, false);
  assert.match(result.reason, /32/);
});

test('rechaza un set cuyo total de preguntas no da 36 aunque los ítems den 32', () => {
  const set = validSet();
  set.sections[4].items[0].questions.push({ correctId: 'B' }); // interview con 3 preguntas en vez de 2
  const result = checkSetCompatibility(set);
  assert.equal(result.ok, false);
  assert.match(result.reason, /preguntas/);
});
