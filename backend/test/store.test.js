import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSet, readSet, listSets, deleteSet, setDir, audioDir, nuevoSetId } from '../src/sets/store.js';

function setDePrueba(id = 'set-test-1') {
  return {
    id, genere_le: '2026-08-05T10:00:00Z', statut: 'partial',
    format: 'SET_STANDARD_36', formatVersion: 1, difficulty: 'B2',
    pilotes: false, seed: 1, plan: [], relaxations: [],
    ledger: { texte: { appels: 0, echecs: 0 }, tts: { appels: 0, echecs: 0 }, images: { appels: 0, echecs: 0 } },
    sections: [{
      type: 'annonce_publique', timing: { avant: 10, apres: 10 }, lectures: 1,
      items: [
        { ref: 's1i1', etat: 'pret' },
        { ref: 's1i2', etat: 'en_attente' },
        { ref: 's1i3', etat: 'echoue' },
      ],
    }],
  };
}

test('escribe y relee un set', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  const set = setDePrueba();
  await writeSet(dataDir, set);
  assert.deepEqual(await readSet(dataDir, set.id), set);
});

test('crea el directorio de audio del set', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba());
  const contenido = await readdir(setDir(dataDir, 'set-test-1'));
  assert.ok(contenido.includes('audio'));
  assert.ok(audioDir(dataDir, 'set-test-1').endsWith(join('set-test-1', 'audio')));
});

test('la escritura es atómica: no deja temporales al terminar', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba());
  const contenido = await readdir(setDir(dataDir, 'set-test-1'));
  assert.ok(!contenido.some(nombre => nombre.includes('.tmp')), `quedaron temporales: ${contenido}`);
});

test('sobrescribir no corrompe: el JSON releído sigue siendo válido', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  const set = setDePrueba();
  await writeSet(dataDir, set);
  set.statut = 'complet';
  await writeSet(dataDir, set);
  const raw = await readFile(join(setDir(dataDir, set.id), 'set.json'), 'utf8');
  assert.equal(JSON.parse(raw).statut, 'complet');
});

test('readSet lanza si el set no existe', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await assert.rejects(() => readSet(dataDir, 'no-existe'), /no-existe/);
});

test('listSets resume el progreso de cada set', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba('set-a'));
  await writeSet(dataDir, { ...setDePrueba('set-b'), genere_le: '2026-08-06T10:00:00Z' });

  const lista = await listSets(dataDir);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].id, 'set-b', 'el más reciente primero');
  const a = lista.find(s => s.id === 'set-a');
  assert.equal(a.total, 3);
  assert.equal(a.prets, 1);
  assert.equal(a.echoues, 1);
  assert.equal(a.statut, 'partial');
});

test('listSets devuelve vacío si no hay directorio', async () => {
  assert.deepEqual(await listSets(join(tmpdir(), 'jamas-existio-esto')), []);
});

test('deleteSet borra la carpeta entera', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sets-'));
  await writeSet(dataDir, setDePrueba());
  await deleteSet(dataDir, 'set-test-1');
  assert.deepEqual(await listSets(dataDir), []);
});

test('nuevoSetId incluye la fecha y un sufijo aleatorio', () => {
  const id = nuevoSetId(new Date('2026-08-05T10:00:00Z'));
  assert.match(id, /^set-2026-08-05-[a-z0-9]{4}$/);
  assert.notEqual(nuevoSetId(new Date('2026-08-05T10:00:00Z')), id);
});
