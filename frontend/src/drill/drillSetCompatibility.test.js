import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDrillSetCompatibility } from './drillSetCompatibility.js';

function fixtureSet(overrides = {}) {
  return {
    format: 'SET_DRILL_PARAPHRASE',
    pilotes: false,
    sections: [{ type: 'drill_paraphrase', items: Array.from({ length: 12 }, () => ({ questions: [{}] })) }],
    ...overrides,
  };
}

test('acepta un set de drill válido (12 ítems, 12 preguntas)', () => {
  assert.deepEqual(checkDrillSetCompatibility(fixtureSet()), { ok: true });
});

test('rechaza un formato que no sea SET_DRILL_PARAPHRASE', () => {
  const result = checkDrillSetCompatibility(fixtureSet({ format: 'SET_STANDARD_36' }));
  assert.equal(result.ok, false);
});

test('rechaza un set con pilotes', () => {
  const result = checkDrillSetCompatibility(fixtureSet({ pilotes: true }));
  assert.equal(result.ok, false);
});

test('rechaza si el conteo de ítems no es 12', () => {
  const set = fixtureSet();
  set.sections[0].items.pop();
  const result = checkDrillSetCompatibility(set);
  assert.equal(result.ok, false);
});
