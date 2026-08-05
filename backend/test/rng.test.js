import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, sampleWithoutReplacement, shuffleWithRng } from '../src/rng.js';

test('la misma semilla produce la misma secuencia', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('semillas distintas producen secuencias distintas', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notDeepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('los valores caen en [0,1)', () => {
  const rng = createRng(999);
  for (let i = 0; i < 500; i += 1) {
    const value = rng();
    assert.ok(value >= 0 && value < 1, `fuera de rango: ${value}`);
  }
});

test('sampleWithoutReplacement devuelve n elementos distintos del origen', () => {
  const rng = createRng(42);
  const pool = ['a', 'b', 'c', 'd', 'e'];
  const picked = sampleWithoutReplacement(rng, pool, 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  for (const item of picked) assert.ok(pool.includes(item));
});

test('sampleWithoutReplacement no muta el array de origen', () => {
  const rng = createRng(7);
  const pool = ['a', 'b', 'c'];
  sampleWithoutReplacement(rng, pool, 2);
  assert.deepEqual(pool, ['a', 'b', 'c']);
});

test('sampleWithoutReplacement es determinista con la misma semilla', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
  const first = sampleWithoutReplacement(createRng(2024), pool, 4);
  const second = sampleWithoutReplacement(createRng(2024), pool, 4);
  assert.deepEqual(first, second);
});

test('sampleWithoutReplacement lanza si se piden más elementos de los que hay', () => {
  const rng = createRng(1);
  assert.throws(() => sampleWithoutReplacement(rng, ['a', 'b'], 3), /suficientes/);
});

test('shuffleWithRng devuelve una permutación sin mutar el origen', () => {
  const pool = ['a', 'b', 'c', 'd'];
  const shuffled = shuffleWithRng(createRng(5), pool);
  assert.deepEqual([...shuffled].sort(), [...pool].sort());
  assert.deepEqual(pool, ['a', 'b', 'c', 'd']);
});
