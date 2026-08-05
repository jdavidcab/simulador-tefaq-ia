import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecentPlans } from '../src/topics/history.js';

async function crearSet(setsDir, id, genereLe, plan) {
  const dir = join(setsDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'set.json'), JSON.stringify({ id, genere_le: genereLe, plan }));
}

test('devuelve los planes de los N sets más recientes, del más nuevo al más viejo', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-a', '2026-01-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-001' }]);
  await crearSet(setsDir, 'set-b', '2026-03-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-002' }]);
  await crearSet(setsDir, 'set-c', '2026-02-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-003' }]);

  const planes = await readRecentPlans(setsDir, 2);
  assert.equal(planes.length, 2);
  assert.equal(planes[0][0].topicId, 't-002');
  assert.equal(planes[1][0].topicId, 't-003');
});

test('devuelve array vacío si el directorio no existe', async () => {
  assert.deepEqual(await readRecentPlans(join(tmpdir(), 'no-existe-jamas'), 3), []);
});

test('devuelve array vacío si no hay sets', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  assert.deepEqual(await readRecentPlans(setsDir, 3), []);
});

test('ignora carpetas sin set.json y sets con JSON corrupto', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await mkdir(join(setsDir, 'vacia'), { recursive: true });
  await mkdir(join(setsDir, 'rota'), { recursive: true });
  await writeFile(join(setsDir, 'rota', 'set.json'), '{ esto no es json');
  await crearSet(setsDir, 'set-ok', '2026-01-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-007' }]);

  const planes = await readRecentPlans(setsDir, 5);
  assert.equal(planes.length, 1);
  assert.equal(planes[0][0].topicId, 't-007');
});

test('un set sin campo plan aporta un plan vacío, no rompe', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-sin-plan', '2026-01-01T00:00:00Z', undefined);
  const planes = await readRecentPlans(setsDir, 3);
  assert.deepEqual(planes, [[]]);
});

test('window 0 devuelve array vacío', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-a', '2026-01-01T00:00:00Z', [{ sectionType: 'divers', topicId: 't-001' }]);
  assert.deepEqual(await readRecentPlans(setsDir, 0), []);
});

test('plan como string se convierte a array vacío', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-bad-string', '2026-01-01T00:00:00Z', 'oops');
  const planes = await readRecentPlans(setsDir, 3);
  assert.deepEqual(planes, [[]]);
});

test('plan como objeto se convierte a array vacío', async () => {
  const setsDir = await mkdtemp(join(tmpdir(), 'hist-'));
  await crearSet(setsDir, 'set-bad-object', '2026-01-01T00:00:00Z', {});
  const planes = await readRecentPlans(setsDir, 3);
  assert.deepEqual(planes, [[]]);
});
