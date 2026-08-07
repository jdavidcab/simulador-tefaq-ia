import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressTabs, buildSectionTabs } from './examProgress.js';

// Mismo fixture de 2 secciones (2 ítems + 1 ítem) que examMachine.test.js,
// para que los índices globales sean fáciles de verificar a mano.
function fixtureSet() {
  return {
    sections: [
      { type: 'annonce_publique', items: [{ ref: 's1i1' }, { ref: 's1i2' }] },
      { type: 'interview', items: [{ ref: 's2i1' }] },
    ],
  };
}

test('primer ítem del set en fase avant queda como current, el resto pending', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 0, phase: 'avant' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['current', 'pending', 'pending']);
});

test('segundo ítem de la sección: el primero queda completed', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 1, phase: 'apres' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['completed', 'current', 'pending']);
});

test('section-intro de la segunda sección: toda la sección anterior completed, nada current todavía', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'section-intro' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['completed', 'completed', 'pending']);
});

test('primer ítem de la segunda sección ya en avant: queda current', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'avant' };
  const tabs = buildProgressTabs(set, state);
  assert.deepEqual(tabs.map(t => t.status), ['completed', 'completed', 'current']);
});

test('buildSectionTabs: primer ítem de la primera sección, numeración global arranca en 1', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 0, phase: 'avant' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 1);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 1, status: 'current' },
    { globalNumber: 2, status: 'pending' },
  ]);
});

test('buildSectionTabs: segundo ítem de la primera sección', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 0, itemIndex: 1, phase: 'apres' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 2);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 1, status: 'completed' },
    { globalNumber: 2, status: 'current' },
  ]);
});

test('buildSectionTabs: section-intro de la segunda sección, numeración global NO reinicia en 1', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'section-intro' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 3);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 3, status: 'pending' },
  ]);
});

test('buildSectionTabs: primer ítem de la segunda sección ya en avant', () => {
  const set = fixtureSet();
  const state = { sectionIndex: 1, itemIndex: 0, phase: 'avant' };
  const result = buildSectionTabs(set, state);
  assert.equal(result.globalIndex, 3);
  assert.deepEqual(result.sectionTabs, [
    { globalNumber: 3, status: 'current' },
  ]);
});
