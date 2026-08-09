import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDrillSet } from './generateDrillSet.js';

function fakeFetch(responses) {
  let call = 0;
  return async (url, opts) => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: response.status < 400,
      status: response.status,
      json: async () => response.body,
    };
  };
}

test('resuelve con el set cuando el pipeline termina complet', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 0, prets: 12, echoues: 0, statut: 'complet', enCours: false } },
  ]);
  const set = await generateDrillSet({ fetchImpl, pollIntervalMs: 1 });
  assert.equal(set.id, 'set-2026-01-01-abcd');
  assert.equal(set.statut, 'complet');
});

test('sigue haciendo polling mientras statut es partial y enCours es true', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 3, prets: 3, echoues: 0, statut: 'partial', enCours: true } },
    { status: 200, body: { total: 12, generes: 8, prets: 8, echoues: 0, statut: 'partial', enCours: true } },
    { status: 200, body: { total: 12, generes: 12, prets: 12, echoues: 0, statut: 'complet', enCours: false } },
  ]);
  const set = await generateDrillSet({ fetchImpl, pollIntervalMs: 1 });
  assert.equal(set.statut, 'complet');
});

test('rechaza con un error "stalled" cuando el pipeline se detiene sin terminar', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 8, prets: 7, echoues: 1, statut: 'partial', enCours: false } },
  ]);
  await assert.rejects(
    () => generateDrillSet({ fetchImpl, pollIntervalMs: 1 }),
    (error) => {
      assert.equal(error.code, 'stalled');
      assert.equal(error.echoues, 1);
      return true;
    },
  );
});

test('rechaza con un error definitivo en un HTTP 4xx/5xx', async () => {
  const fetchImpl = fakeFetch([{ status: 400, body: { error: 'formato inválido' } }]);
  await assert.rejects(() => generateDrillSet({ fetchImpl, pollIntervalMs: 1 }), /formato inválido/);
});

test('rechaza con un error de timeout si no llega a un estado terminal a tiempo', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 1, prets: 1, echoues: 0, statut: 'partial', enCours: true } },
  ]);
  await assert.rejects(
    () => generateDrillSet({ fetchImpl, pollIntervalMs: 1, timeoutMs: 5 }),
    (error) => {
      assert.equal(error.code, 'timeout');
      return true;
    },
  );
});

test('se detiene sin resolver ni rechazar de forma observable si el signal se aborta', async () => {
  const controller = new AbortController();
  const fetchImpl = fakeFetch([
    { status: 201, body: { id: 'set-2026-01-01-abcd', total: 12, statut: 'partial' } },
    { status: 200, body: { total: 12, generes: 1, prets: 1, echoues: 0, statut: 'partial', enCours: true } },
  ]);
  const promise = generateDrillSet({ fetchImpl, pollIntervalMs: 5, signal: controller.signal });
  controller.abort();
  await assert.rejects(
    () => promise,
    (error) => {
      assert.equal(error.name, 'AbortError');
      return true;
    },
  );
});
