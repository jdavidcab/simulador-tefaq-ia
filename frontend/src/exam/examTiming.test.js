import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from './examTiming.js';

test('startPhase computes a deadline duration seconds ahead of now', () => {
  const phase = startPhase(10, 1000);
  assert.equal(phase.deadline, 11000);
});

test('remainingSeconds rounds up remaining time', () => {
  const phase = startPhase(10, 0);
  assert.equal(remainingSeconds(phase, 0), 10);
  assert.equal(remainingSeconds(phase, 500), 10); // quedan 9.5s -> ceil -> 10
  assert.equal(remainingSeconds(phase, 1000), 9);
});

test('remainingSeconds nunca es negativo', () => {
  const phase = startPhase(5, 0);
  assert.equal(remainingSeconds(phase, 10000), 0);
});

test('isExpired es false antes del deadline y true en/después de él', () => {
  const phase = startPhase(5, 0);
  assert.equal(isExpired(phase, 4999), false);
  assert.equal(isExpired(phase, 5000), true);
  assert.equal(isExpired(phase, 6000), true);
});

test('chainDeadline extiende el deadline anterior, ignorando el reloj vivo', () => {
  const phase1 = startPhase(10, 0); // deadline = 10000
  const phase2 = chainDeadline(phase1, 20);
  assert.equal(phase2.deadline, 30000);
});

test('un tick tardío detectando el vencimiento no filtra slop a la fase encadenada', () => {
  const phase1 = startPhase(10, 0); // deadline = 10000
  // El tick que detecta el vencimiento llega 250ms tarde (jank del hilo
  // principal) -- no debe filtrarse a la fase siguiente.
  const lateNow = 10250;
  assert.equal(isExpired(phase1, lateNow), true);
  const phase2 = chainDeadline(phase1, 5); // encadena desde el deadline TEÓRICO, no desde lateNow
  assert.equal(phase2.deadline, 15000);
  assert.equal(remainingSeconds(phase2, 15000), 0);
});
