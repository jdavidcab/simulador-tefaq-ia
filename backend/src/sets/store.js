import { mkdir, writeFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function setDir(dataDir, setId) {
  return join(dataDir, 'sets', setId);
}

export function audioDir(dataDir, setId) {
  return join(setDir(dataDir, setId), 'audio');
}

export function imagesDir(dataDir, setId) {
  return join(setDir(dataDir, setId), 'images');
}

export function nuevoSetId(fecha = new Date()) {
  const dia = fecha.toISOString().slice(0, 10);
  const sufijo = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `set-${dia}-${sufijo}`;
}

// Escritura atómica: un crash a mitad de escritura no debe dejar un set.json
// truncado, porque eso no es perder un ítem sino el set entero.
export async function writeSet(dataDir, set) {
  const dir = setDir(dataDir, set.id);
  await mkdir(join(dir, 'audio'), { recursive: true });
  await mkdir(join(dir, 'images'), { recursive: true });
  const destino = join(dir, 'set.json');
  const sufijo = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const temporal = `${destino}.${sufijo}.tmp`;
  await writeFile(temporal, JSON.stringify(set, null, 2), 'utf8');
  await rename(temporal, destino);
}

export async function readSet(dataDir, setId) {
  try {
    return JSON.parse(await readFile(join(setDir(dataDir, setId), 'set.json'), 'utf8'));
  } catch (error) {
    const err = new Error(`No se pudo leer el set "${setId}": ${error.message}`);
    err.status = error.code === 'ENOENT' ? 404 : 422;
    throw err;
  }
}

function contarItems(set) {
  const items = (set.sections ?? []).flatMap(section => section.items ?? []);
  return {
    total: items.length,
    generes: items.filter(item => item.etat === 'genere').length,
    prets: items.filter(item => item.etat === 'pret').length,
    echoues: items.filter(item => item.etat === 'echoue').length,
  };
}

export async function listSets(dataDir) {
  let entries;
  try {
    entries = await readdir(join(dataDir, 'sets'), { withFileTypes: true });
  } catch {
    return [];
  }

  const resumenes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const set = await readSet(dataDir, entry.name);
      resumenes.push({
        id: set.id, statut: set.statut, format: set.format,
        genere_le: set.genere_le, difficulty: set.difficulty, ...contarItems(set),
      });
    } catch {
      continue;
    }
  }

  return resumenes.sort((a, b) => String(b.genere_le).localeCompare(String(a.genere_le)));
}

export async function deleteSet(dataDir, setId) {
  await rm(setDir(dataDir, setId), { recursive: true, force: true });
}

export { contarItems };
