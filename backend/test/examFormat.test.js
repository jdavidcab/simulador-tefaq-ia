import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_PRESETS, SET_COMPOSITIONS, GENERABLE_SECTIONS, SINGLE_QUESTION_SECTIONS,
  MICRO_TROTTOIR_POSTURES, CONFIG, wordTolerance, itemsPerSection, sectionDemand, totalQuestions,
} from '../src/examFormat.js';

test('los 9 tipos de sección están declarados', () => {
  assert.deepEqual(Object.keys(SECTION_PRESETS).sort(), [
    'annonce_publique', 'chronique', 'conversation_image', 'divers', 'drill_paraphrase',
    'interview', 'micro_trottoir', 'repondeur', 'reportage',
  ]);
});

test('los presets llevan los tiempos y rangos del livret oficial', () => {
  assert.deepEqual(SECTION_PRESETS.interview, {
    bloc: 3, questions: 6, avant: 20, apres: 30,
    questionsPerAudio: 2, minWords: 200, maxWords: 300, lectures: 1,
  });
  assert.deepEqual(SECTION_PRESETS.conversation_image, {
    bloc: 1, questions: 4, avant: 5, apres: 10,
    questionsPerAudio: 1, minWords: 40, maxWords: 55, lectures: 1,
  });
  assert.equal(SECTION_PRESETS.divers.questions, 10);
  assert.equal(SECTION_PRESETS.reportage.questionsPerAudio, 2);
});

test('SET_STANDARD_36 excluye conversation_image y suma 36 preguntas', () => {
  assert.ok(!SET_COMPOSITIONS.SET_STANDARD_36.includes('conversation_image'));
  assert.equal(SET_COMPOSITIONS.SET_STANDARD_36.length, 7);
  assert.equal(totalQuestions('SET_STANDARD_36'), 36);
});

test('SET_STANDARD_40 añade conversation_image al inicio', () => {
  assert.equal(SET_COMPOSITIONS.SET_STANDARD_40[0], 'conversation_image');
  assert.equal(totalQuestions('SET_STANDARD_40'), 40);
});

test('las secciones se ordenan por bloque', () => {
  const blocs = SET_COMPOSITIONS.SET_STANDARD_36.map(s => SECTION_PRESETS[s].bloc);
  assert.deepEqual(blocs, [...blocs].sort((a, b) => a - b));
});

test('itemsPerSection divide preguntas entre preguntas por audio', () => {
  assert.equal(itemsPerSection('interview'), 3);
  assert.equal(itemsPerSection('reportage'), 1);
  assert.equal(itemsPerSection('divers'), 10);
});

test('un set estándar son 32 ítems', () => {
  const total = Object.values(sectionDemand('SET_STANDARD_36')).reduce((a, b) => a + b, 0);
  assert.equal(total, 32);
});

test('la tolerancia de palabras es proporcional con suelo de 2', () => {
  assert.equal(wordTolerance(60), 3);
  assert.equal(wordTolerance(70), 4);
  assert.equal(wordTolerance(120), 6);
  assert.equal(wordTolerance(150), 8);
  assert.equal(wordTolerance(220), 11);
  assert.equal(wordTolerance(300), 15);
  assert.equal(wordTolerance(10), 2, 'suelo de 2 para transcripts muy cortos');
});

test('SINGLE_QUESTION_SECTIONS solo tiene secciones de una pregunta por audio', () => {
  for (const type of SINGLE_QUESTION_SECTIONS) {
    assert.equal(SECTION_PRESETS[type].questionsPerAudio, 1, type);
  }
  assert.ok(!SINGLE_QUESTION_SECTIONS.includes('interview'));
  assert.ok(!SINGLE_QUESTION_SECTIONS.includes('reportage'));
});

test('GENERABLE_SECTIONS excluye conversation_image', () => {
  assert.equal(GENERABLE_SECTIONS.length, 7);
  assert.ok(!GENERABLE_SECTIONS.includes('conversation_image'));
});

test('las posturas de micro-trottoir están en francés y la de 4 añade la abstención', () => {
  assert.deepEqual(MICRO_TROTTOIR_POSTURES[3], [
    'totalement pour', 'pour à certaines conditions', 'totalement contre',
  ]);
  assert.equal(MICRO_TROTTOIR_POSTURES[4].length, 4);
  assert.equal(MICRO_TROTTOIR_POSTURES[4][3], 'ne se prononce pas');
});

test('CONFIG expone los parámetros calibrables con sus defaults', () => {
  assert.equal(CONFIG.historyWindow, 3);
  assert.equal(CONFIG.justificationThreshold, 0.8);
  assert.equal(CONFIG.justificationMinContentWords, 5);
  assert.equal(CONFIG.microTrottoirOptions, 3);
  assert.equal(CONFIG.validationRetries, 2);
  assert.equal(CONFIG.piloteCount, 4);
  assert.equal(CONFIG.reformulationOverlapThreshold, 0.75);
  assert.equal(CONFIG.reformulationMinTrapWords, 2);
  assert.equal(CONFIG.drillReformulationOverlapThreshold, 0.5);
});

test('drill_paraphrase no se agrega a GENERABLE_SECTIONS ni cambia SET_STANDARD_36/40', () => {
  assert.ok(!GENERABLE_SECTIONS.includes('drill_paraphrase'));
  assert.equal(GENERABLE_SECTIONS.length, 7);
  assert.equal(totalQuestions('SET_STANDARD_36'), 36);
  assert.equal(totalQuestions('SET_STANDARD_40'), 40);
});

test('SET_DRILL_PARAPHRASE es una composición de un solo tipo con 12 preguntas', () => {
  assert.deepEqual(SET_COMPOSITIONS.SET_DRILL_PARAPHRASE, ['drill_paraphrase']);
  assert.equal(totalQuestions('SET_DRILL_PARAPHRASE'), 12);
  assert.deepEqual(sectionDemand('SET_DRILL_PARAPHRASE'), { drill_paraphrase: 12 });
});
