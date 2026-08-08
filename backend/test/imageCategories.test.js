import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/rng.js';
import {
  IMAGE_CATEGORIES, DISCRIMINATING_DIMENSIONS, categoryById, pickCategories,
} from '../src/topics/imageCategories.js';

test('hay exactamente 8 categorías con id y label', () => {
  assert.equal(IMAGE_CATEGORIES.length, 8);
  for (const cat of IMAGE_CATEGORIES) {
    assert.equal(typeof cat.id, 'string');
    assert.ok(cat.label.length > 20);
  }
});

test('hay exactamente 6 dimensiones discriminantes', () => {
  assert.equal(DISCRIMINATING_DIMENSIONS.length, 6);
});

test('categoryById encuentra una categoría existente', () => {
  assert.equal(categoryById('objets_produits').id, 'objets_produits');
});

test('categoryById retorna undefined para un id inexistente', () => {
  assert.equal(categoryById('no-existe'), undefined);
});

test('pickCategories sin historial retorna `count` categorías distintas', () => {
  const rng = createRng(1);
  const elegidas = pickCategories(rng, [], 4);
  assert.equal(elegidas.length, 4);
  assert.equal(new Set(elegidas.map(c => c.id)).size, 4);
});

test('pickCategories excluye las 4 categorías del set inmediatamente anterior', () => {
  const rng = createRng(1);
  const anterior = [
    { sectionType: 'conversation_image', topicId: 'objets_produits' },
    { sectionType: 'conversation_image', topicId: 'lieux_commerces' },
    { sectionType: 'conversation_image', topicId: 'activites_loisirs' },
    { sectionType: 'conversation_image', topicId: 'situations_domestiques' },
    { sectionType: 'annonce_publique', topicId: 't-001' }, // de otra sección, no debe afectar
  ];
  const elegidas = pickCategories(rng, [anterior], 4);
  const idsElegidos = elegidas.map(c => c.id);
  assert.deepEqual(
    idsElegidos.sort(),
    ['meteo_vetements', 'personnes_interactions', 'repas_nourriture', 'transports'].sort(),
  );
});

test('pickCategories con más de un plan reciente solo mira el más reciente (recentPlans[0])', () => {
  const rng = createRng(1);
  const masReciente = [{ sectionType: 'conversation_image', topicId: 'transports' }];
  const viejo = [{ sectionType: 'conversation_image', topicId: 'objets_produits' }];
  const elegidas = pickCategories(rng, [masReciente, viejo], 7);
  assert.ok(!elegidas.some(c => c.id === 'transports'));
  assert.ok(elegidas.some(c => c.id === 'objets_produits'));
});
