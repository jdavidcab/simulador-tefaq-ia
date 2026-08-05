import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, topicsForSection, topicById } from '../src/topics/catalog.js';
import { GENERABLE_SECTIONS, sectionDemand, CONFIG } from '../src/examFormat.js';

test('el catálogo tiene al menos 150 temas', () => {
  assert.ok(TOPICS.length >= 150, `solo hay ${TOPICS.length}`);
});

test('cada tema tiene id único, texto no vacío y al menos una sección válida', () => {
  const ids = new Set();
  for (const topic of TOPICS) {
    assert.match(topic.id, /^t-\d{3,}$/, `id inválido: ${topic.id}`);
    assert.ok(!ids.has(topic.id), `id duplicado: ${topic.id}`);
    ids.add(topic.id);
    assert.ok(topic.text.trim().length > 0, `texto vacío en ${topic.id}`);
    assert.ok(topic.sections.length > 0, `sin secciones: ${topic.id}`);
    for (const section of topic.sections) {
      assert.ok(GENERABLE_SECTIONS.includes(section), `sección inválida ${section} en ${topic.id}`);
    }
  }
});

test('no hay textos de tema duplicados', () => {
  const textos = TOPICS.map(t => t.text.trim().toLowerCase());
  assert.equal(new Set(textos).size, textos.length);
});

test('cada sección tiene pool suficiente para una ventana N completa', () => {
  const demanda = sectionDemand('SET_STANDARD_36');
  for (const [section, demand] of Object.entries(demanda)) {
    const minimo = demand * (CONFIG.historyWindow + 1);
    const pool = topicsForSection(section).length;
    assert.ok(pool >= minimo, `${section}: pool ${pool} < mínimo ${minimo}`);
  }
});

test('el bloque 3 tiene al menos 40 temas de debate', () => {
  const bloque3 = new Set();
  for (const section of ['chronique', 'interview', 'reportage']) {
    for (const topic of topicsForSection(section)) bloque3.add(topic.id);
  }
  assert.ok(bloque3.size >= 40, `solo ${bloque3.size} temas de bloque 3`);
});

// NOTA: el brief de la Tarea 3 describe "59 entradas originales" en
// TEFAQ_TOPICS (prompt.js), pero el array real en backend/src/prompt.js
// (líneas 3-59) contiene 57 strings, no 59. Se verificó contando el
// array en tiempo de ejecución y leyendo el archivo línea por línea.
// Este test usa el conteo real (57) para no inventar 2 entradas
// "originales" que no existen en prompt.js.
test('se conservan las 57 entradas originales con ids estables', () => {
  const originales = TOPICS.filter(t => Number(t.id.slice(2)) <= 57);
  assert.equal(originales.length, 57);
  assert.equal(topicById('t-001').id, 't-001');
});

test('topicsForSection filtra por etiqueta', () => {
  for (const topic of topicsForSection('chronique')) {
    assert.ok(topic.sections.includes('chronique'));
  }
});

test('topicById devuelve undefined para ids inexistentes', () => {
  assert.equal(topicById('t-999999'), undefined);
});
