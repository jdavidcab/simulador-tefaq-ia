import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReformulation, findLiteralTrapOptionIds } from '../src/validation/reformulation.js';
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
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
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

test('findLiteralTrapOptionIds devuelve los ids de las opciones que reciclan suficientes palabras literales', () => {
  const pregunta = preguntaBase();
  assert.deepEqual(findLiteralTrapOptionIds(pregunta, TRANSCRIPT, CONFIG), ['B']);
});

test('findLiteralTrapOptionIds devuelve un array vacío cuando ningún distractor califica', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'Un changement de programmation' },
      { id: 'C', text: 'Une autre option plausible' },
      { id: 'D', text: 'Encore une autre option' },
    ],
  });
  assert.deepEqual(findLiteralTrapOptionIds(pregunta, TRANSCRIPT, CONFIG), []);
});

test('findLiteralTrapOptionIds devuelve varios ids cuando más de un distractor califica', () => {
  const pregunta = preguntaBase({
    options: [
      { id: 'A', text: 'Une fermeture temporaire du service' },
      { id: 'B', text: 'On va fermer la piscine cet été' },
      { id: 'C', text: 'Des travaux de rénovation prévus cet été' },
      { id: 'D', text: 'Encore une autre option' },
    ],
  });
  assert.deepEqual(findLiteralTrapOptionIds(pregunta, TRANSCRIPT, CONFIG).sort(), ['B', 'C']);
});

test('checkReformulation marca con literalTrap las opciones calificantes y deja las demás sin la propiedad', () => {
  const pregunta = preguntaBase();
  checkReformulation(pregunta, TRANSCRIPT, CONFIG);
  const porId = Object.fromEntries(pregunta.options.map(o => [o.id, o]));
  assert.equal(porId.B.literalTrap, true);
  assert.equal(porId.A.literalTrap, undefined);
  assert.equal(porId.C.literalTrap, undefined);
  assert.equal(porId.D.literalTrap, undefined);
  assert.deepEqual(Object.keys(pregunta.reformulation).sort(), ['extrait_audio', 'option_correcte', 'type']);
});
