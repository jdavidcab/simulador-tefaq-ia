import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSectionPrompt } from '../src/prompt/index.js';
import { VALID_DIFFICULTIES, DIFFICULTY_PROFILES } from '../src/prompt/profiles.js';
import { SECTION_PRESETS, MICRO_TROTTOIR_POSTURES, CONFIG, GENERABLE_SECTIONS } from '../src/examFormat.js';

const BASE = { topic: 'una consulta pública sobre un proyecto de vivienda', difficulty: 'B2' };

test('los perfiles de dificultad sobreviven al refactor', () => {
  assert.deepEqual(VALID_DIFFICULTIES, ['B1', 'B2', 'C1']);
  assert.ok(DIFFICULTY_PROFILES.C1.synonymDistractors.length > 0);
});

test('hay constructor para las 7 secciones generables', () => {
  for (const sectionType of GENERABLE_SECTIONS) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.ok(prompt.length > 200, `${sectionType}: prompt sospechosamente corto`);
  }
});

test('conversation_image no tiene constructor todavía', () => {
  assert.throws(() => buildSectionPrompt('conversation_image', BASE), /conversation_image/);
});

test('el prompt lleva el tema y el rango de palabras del preset', () => {
  const prompt = buildSectionPrompt('chronique', BASE);
  assert.ok(prompt.includes(BASE.topic));
  assert.ok(prompt.includes(String(SECTION_PRESETS.chronique.minWords)));
  assert.ok(prompt.includes(String(SECTION_PRESETS.chronique.maxWords)));
});

test('todos los constructores exigen justification y el esquema questions', () => {
  for (const sectionType of GENERABLE_SECTIONS) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.ok(prompt.includes('justification'), `${sectionType} no pide justification`);
    assert.ok(prompt.includes('"questions"'), `${sectionType} no define el esquema questions`);
  }
});

test('interview y reportage piden 2 preguntas; el resto 1', () => {
  for (const sectionType of GENERABLE_SECTIONS) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    const esperadas = SECTION_PRESETS[sectionType].questionsPerAudio;
    assert.ok(prompt.includes(`${esperadas} pregunta`), `${sectionType} debería pedir ${esperadas} pregunta(s)`);
  }
});

test('interview pide diálogo etiquetado', () => {
  const prompt = buildSectionPrompt('interview', BASE);
  assert.ok(prompt.includes('Journaliste:'));
  assert.ok(prompt.includes('Invité'));
});

test('micro_trottoir inyecta la postura pedida y las opciones fijas', () => {
  const posturas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions];
  const prompt = buildSectionPrompt('micro_trottoir', { ...BASE, posture: posturas[2] });
  assert.ok(prompt.includes(posturas[2]));
  for (const postura of posturas) assert.ok(prompt.includes(postura));
});

test('los bloques 3 y 4 exigen matices de B2 real', () => {
  for (const sectionType of ['chronique', 'interview', 'reportage', 'divers']) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.match(prompt, /implícit|matiz|causa/i, `${sectionType} no exige nivel B2 real`);
  }
});

test('minWords y maxWords se pueden sobreescribir (modo entrenamiento)', () => {
  const prompt = buildSectionPrompt('divers', { ...BASE, minWords: 30, maxWords: 50 });
  assert.ok(prompt.includes('30'));
  assert.ok(prompt.includes('50'));
  assert.ok(!prompt.includes('entre 60 y 120'));
});

test('verticalScan cambia la regla de escaneo vertical', () => {
  const con = buildSectionPrompt('divers', { ...BASE, verticalScan: true });
  const sin = buildSectionPrompt('divers', { ...BASE, verticalScan: false });
  assert.ok(con.includes('escaneo vertical'));
  assert.ok(!sin.includes('escaneo vertical'));
});

test('la dificultad cambia el perfil inyectado', () => {
  const b1 = buildSectionPrompt('divers', { ...BASE, difficulty: 'B1' });
  const c1 = buildSectionPrompt('divers', { ...BASE, difficulty: 'C1' });
  assert.ok(b1.includes(DIFFICULTY_PROFILES.B1.vocabulary));
  assert.ok(c1.includes(DIFFICULTY_PROFILES.C1.vocabulary));
});

test('el esquema JSON de micro_trottoir tiene tantos slots de opción como posturas configuradas', () => {
  const prompt = buildSectionPrompt('micro_trottoir', { ...BASE, posture: MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions][0] });
  const esperadas = MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions].length;
  const coincidencias = prompt.match(/"id":\s*"[A-D]"/g) ?? [];
  // El bloque de ejemplo JSON aparece una vez por pregunta (questionsPerAudio=1 aquí);
  // cada slot de opción tiene un "id". Cuenta solo dentro del bloque de esquema.
  const bloqueEsquema = prompt.slice(prompt.indexOf('Estructura JSON requerida'));
  const idsEnEsquema = bloqueEsquema.match(/"id":\s*"[A-D]"/g) ?? [];
  assert.equal(idsEnEsquema.length, esperadas, `el ejemplo JSON debería tener ${esperadas} slots de opción, tiene ${idsEnEsquema.length}`);
  assert.ok(!prompt.includes(`Las 4 opciones NO las eliges`), 'el encabezado no debe hardcodear "4" cuando hay 3 posturas configuradas');
});

test('micro_trottoir no menciona "4 opciones" en ningún punto del prompt', () => {
  const prompt = buildSectionPrompt('micro_trottoir', { ...BASE, posture: MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions][0] });
  assert.ok(!/\b4\s+opci/i.test(prompt), 'el prompt de micro_trottoir no debe hablar de "4 opciones" en ningún lado');
});

test('las otras 6 secciones siguen mencionando "las 4 opciones" (sin regresión)', () => {
  for (const sectionType of ['annonce_publique', 'repondeur', 'chronique', 'interview', 'reportage', 'divers']) {
    const prompt = buildSectionPrompt(sectionType, BASE);
    assert.ok(/las 4 opciones/i.test(prompt), `${sectionType} debería seguir mencionando "las 4 opciones"`);
  }
});
