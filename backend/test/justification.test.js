import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, contentWords } from '../src/validation/frenchWords.js';
import { scoreJustification, checkJustification } from '../src/validation/justification.js';
import { CONFIG } from '../src/examFormat.js';

test('normalizeText baja a minúsculas, quita diacríticos y puntuación, colapsa espacios', () => {
  assert.equal(normalizeText('  Le  MÉTRO, c\'est « retardé »!  '), 'le metro c est retarde');
});

test('contentWords quita stopwords y duplicados', () => {
  const palabras = contentWords('Le métro de la ligne est retardé, le métro est retardé');
  assert.ok(palabras.includes('metro'));
  assert.ok(palabras.includes('retarde'));
  assert.ok(!palabras.includes('le'));
  assert.ok(!palabras.includes('de'));
  assert.equal(new Set(palabras).size, palabras.length);
});

test('una cita literal puntúa 1.0', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu\'à midi.';
  assert.equal(scoreJustification('la ligne orange sera interrompue entre Berri et Jean-Talon', transcript), 1);
});

test('una cita con puntuación y acentos distintos sigue puntuando 1.0', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu\'à midi.';
  assert.equal(scoreJustification('«La ligne orange sera interrompue, entre Berri et Jean-Talon»!', transcript), 1);
});

test('una paráfrasis con casi todas las palabras de contenido puntúa alto', () => {
  const transcript = 'Le service sera interrompu sur la ligne orange entre Berri et Jean-Talon jusqu\'à midi.';
  const score = scoreJustification('service interrompu ligne orange Berri Jean-Talon midi', transcript);
  assert.ok(score >= 0.9, `score fue ${score}`);
});

test('una cita inventada puntúa bajo', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu\'à midi.';
  const score = scoreJustification('les travaux de voirie commenceront lundi prochain dans le quartier', transcript);
  assert.ok(score < 0.5, `score fue ${score}`);
});

test('checkJustification acepta por encima del umbral', () => {
  const transcript = 'Le service sera interrompu sur la ligne orange entre Berri et Jean-Talon jusqu\'à midi.';
  const resultado = checkJustification('le service sera interrompu sur la ligne orange', transcript, CONFIG);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.score, 1);
});

test('checkJustification rechaza por debajo del umbral', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu\'à midi.';
  const resultado = checkJustification('les travaux de voirie commenceront lundi prochain dans le quartier', transcript, CONFIG);
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /justification/i);
});

test('rechaza citas demasiado cortas aunque coincidan', () => {
  const transcript = 'La ligne orange sera interrompue entre Berri et Jean-Talon jusqu\'à midi.';
  const resultado = checkJustification('la ligne orange', transcript, CONFIG);
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /5 palabras de contenido/);
});

test('rechaza una justificación vacía', () => {
  const resultado = checkJustification('   ', 'cualquier transcript', CONFIG);
  assert.equal(resultado.ok, false);
});
