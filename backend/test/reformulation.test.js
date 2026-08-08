import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReformulation } from '../src/validation/reformulation.js';
import { CONFIG } from '../src/examFormat.js';

function preguntaBase(overrides = {}) {
  return {
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'On va fermer la piscine cet été' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
    correctId: 'A',
    justification: 'on va fermer la piscine cet été pour des travaux de rénovation majeurs',
    reformulationType: 'nominalisation',
    ...overrides,
  };
}

const TRANSCRIPT = 'Bonjour, on va fermer la piscine cet été pour des travaux de rénovation majeurs, merci de votre compréhension.';

test('acepta una opción correcta reformulada con trampa literal presente, y adjunta metadata', () => {
  const pregunta = preguntaBase();
  assert.doesNotThrow(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG));
  assert.deepEqual(pregunta.reformulation, {
    extrait_audio: pregunta.justification,
    option_correcte: 'Une fermeture temporaire du service',
    type: 'nominalisation',
  });
});

test('rechaza si la opción correcta calca literalmente el audio', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'on va fermer la piscine cet été' },
      { id: 'B', text: 'Une fermeture temporaire du service' },
      { id: 'C', text: 'Une otra option plausible' },
      { id: 'D', text: 'Encore una otra option' },
    ],
  });
  assert.throws(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG), /solapa/);
});

test('rechaza si ningún distractor recicla palabras literales del audio', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'Un changement de programmation' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
  });
  assert.throws(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG), /trampa obligatoria ausente/);
});

test('rechaza reformulationType ausente o inválido', () => {
  const pregunta = preguntaBase({ reformulationType: 'paraphrase' });
  assert.throws(() => checkReformulation(pregunta, TRANSCRIPT, CONFIG), /reformulationType/);
});
