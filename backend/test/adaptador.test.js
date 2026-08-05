import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplanarItem } from '../server.js';

test('aplana el ítem nuevo a la forma que espera el frontend de entrenamiento', () => {
  const item = {
    transcript: 'Le service sera interrompu jusqu’à midi.',
    provider: 'gemini-3.5-flash',
    tentativas: 1,
    questions: [{
      prompt: 'Quel est le message ?',
      options: [
        { id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' },
      ],
      correctId: 'C',
      feedback: 'La opción C es correcta.',
      justification: 'Le service sera interrompu',
      justificationScore: 1,
    }],
  };

  const plano = aplanarItem(item);
  assert.equal(plano.prompt, 'Quel est le message ?');
  assert.equal(plano.correctId, 'C');
  assert.equal(plano.feedback, 'La opción C es correcta.');
  assert.equal(plano.transcript, item.transcript);
  assert.equal(plano.options.length, 4);
  assert.deepEqual(plano.options.map(o => o.id), ['A', 'B', 'C', 'D']);
});

test('la forma aplanada no filtra campos internos del esquema de sets', () => {
  const plano = aplanarItem({
    transcript: 't', provider: 'p', tentativas: 3,
    questions: [{
      prompt: 'p', options: [{ id: 'A', text: 'a' }], correctId: 'A',
      feedback: 'f', justification: 'j', justificationScore: 0.9,
    }],
  });
  assert.equal(plano.questions, undefined, 'no debe exponer el array anidado');
  assert.equal(plano.justification, undefined, 'justification es interna del pipeline de sets');
  assert.equal(plano.justificationScore, undefined);
  assert.equal(plano.tentativas, undefined);
});
