import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHighlightSegments } from './highlightSegments.js';

test('match exacto de subcadena', () => {
  const transcript = 'Bonjour, ceci est un test important pour vous.';
  const justification = 'un test important';
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const highlighted = segments.filter(s => s.questionIndexes.includes(0)).map(s => s.text).join('');
  assert.equal(highlighted, 'un test important');
});

test('match que difiere solo en acento, apóstrofe, puntuación y mayúsculas', () => {
  const transcript = 'L’invité a dit : « C’est vraiment très important. »';
  const justification = "c'est vraiment tres important";
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const highlighted = segments.filter(s => s.questionIndexes.includes(0)).map(s => s.text).join('');
  assert.equal(highlighted, 'C’est vraiment très important');
});

test('justification ausente del transcript (parafraseada) no rompe y queda excluida', () => {
  const transcript = 'Le train part à treize heures pour Montréal.';
  const justification = 'une phrase qui n\'apparaît nulle part dans le texte';
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].questionIndexes, []);
  assert.equal(segments[0].text, transcript);
});

test('frase repetida: solo se resalta la primera aparición', () => {
  const transcript = 'Le chat est noir. Le chat est petit.';
  const justification = 'le chat';
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const highlightedSegments = segments.filter(s => s.questionIndexes.includes(0));
  assert.equal(highlightedSegments.length, 1);
  assert.equal(transcript.indexOf(highlightedSegments[0].text), 0);
});

test('dos justifications que se solapan: el segmento compartido lleva ambos questionIndexes', () => {
  const transcript = 'Le grand chat noir dort tranquillement sur le tapis.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: 'grand chat noir' },
    { questionIndex: 1, justification: 'chat noir dort' },
  ]);
  const overlapping = segments.find(s => s.questionIndexes.includes(0) && s.questionIndexes.includes(1));
  assert.ok(overlapping, 'debe existir un segmento con ambos questionIndexes');
  assert.equal(overlapping.text, 'chat noir');
});

test('dos justifications adyacentes: no se fusionan de forma incorrecta', () => {
  const transcript = 'Premiere partie. Deuxieme partie.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: 'Premiere partie' },
    { questionIndex: 1, justification: 'Deuxieme partie' },
  ]);
  const seg0 = segments.find(s => s.questionIndexes.length === 1 && s.questionIndexes[0] === 0);
  const seg1 = segments.find(s => s.questionIndexes.length === 1 && s.questionIndexes[0] === 1);
  assert.equal(seg0.text, 'Premiere partie');
  assert.equal(seg1.text, 'Deuxieme partie');
});

test('dos justifications idénticas: el mismo segmento lleva ambos questionIndexes', () => {
  const transcript = 'Le prix a beaucoup augmenté cette année.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: 'beaucoup augmenté' },
    { questionIndex: 1, justification: 'beaucoup augmenté' },
  ]);
  const shared = segments.find(s => s.text === 'beaucoup augmenté');
  assert.deepEqual([...shared.questionIndexes].sort(), [0, 1]);
});

test('concatenar todos los segmentos reconstruye el transcript exacto', () => {
  const transcript = 'L’invité a dit : « C’est vraiment très important. » Merci beaucoup.';
  const segments = buildHighlightSegments(transcript, [
    { questionIndex: 0, justification: "c'est vraiment tres important" },
    { questionIndex: 1, justification: 'merci beaucoup' },
  ]);
  assert.equal(segments.map(s => s.text).join(''), transcript);
});

test('una marca diacrítica suelta (texto ya en forma NFD) queda pegada a su letra, no se pierde en el siguiente segmento', () => {
  const transcript = 'Le thé est chaud.'.normalize('NFD'); // 'é' descompuesto en 'e' + acento suelto
  const justification = 'the'; // sin acento -- debe matchear igual, y el acento debe venir incluido en el resaltado
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const highlighted = segments.filter(s => s.questionIndexes.includes(0)).map(s => s.text).join('');
  assert.equal(highlighted, 'thé'.normalize('NFD'));
  assert.equal(segments.map(s => s.text).join(''), transcript);
});
