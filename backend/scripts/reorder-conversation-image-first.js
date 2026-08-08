// backend/scripts/reorder-conversation-image-first.js
//
// Script de UNA SOLA VEZ para reordenar el set SET_STANDARD_40 ya existente
// set-2026-08-06-xwwe, moviendo la sección conversation_image (agregada al
// final -- s8 -- por backfill-conversation-image.js para no colisionar con
// los refs de las 32 ítems ya existentes) al frente (s1), que es el orden
// canónico real de SET_STANDARD_40 (ver SET_STANDARD_40 en examFormat.js:
// ['conversation_image', ...GENERABLE_SECTIONS]). No regenera ningún
// contenido: es una rotación cíclica pura de refs (JSON + nombres de
// archivo de audio/imágenes en disco). No es una funcionalidad reusable del
// producto -- se corre manualmente, una vez, con supervisión directa.
//
// Es una rotación cíclica, no swaps por pares, así que un rename directo
// viejo->nuevo colisionaría (ej.: renombrar s1i1.wav -> s2i1.wav pisaría el
// s2i1.wav todavía no movido, que a su vez necesita convertirse en s3i1.wav).
// Por eso el rename de archivos se hace en dos fases con un sufijo temporal
// (ver renombrarArchivos más abajo: fase A agrega el sufijo a todo, fase B
// lo reemplaza por el nombre final), con rollback si algo falla a mitad de
// camino.
//
// Uso: node backend/scripts/reorder-conversation-image-first.js
import { readFile, cp, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSet } from '../src/sets/store.js';

const SET_ID = 'set-2026-08-06-xwwe';
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const SET_DIR = join(DATA_DIR, 'sets', SET_ID);
const SET_JSON = join(SET_DIR, 'set.json');
const AUDIO_DIR = join(SET_DIR, 'audio');
const IMAGES_DIR = join(SET_DIR, 'images');
const TMP_SUFFIX = '.reordertmp';
const IMAGE_SUFFIXES = ['ref', 'A', 'B', 'C', 'D'];

// Orden y conteos de ítems actuales, verificados a mano contra el archivo
// real antes de escribir este script. Si el set no coincide EXACTAMENTE con
// esto, el script aborta -- está escrito para este ÚNICO estado de partida
// conocido, no como herramienta de reorder general.
const ORDEN_ACTUAL_ESPERADO = [
  { type: 'annonce_publique', count: 4 },
  { type: 'repondeur', count: 6 },
  { type: 'micro_trottoir', count: 6 },
  { type: 'chronique', count: 2 },
  { type: 'interview', count: 3 },
  { type: 'reportage', count: 1 },
  { type: 'divers', count: 10 },
  { type: 'conversation_image', count: 4 },
];

function verificarOrdenActual(set) {
  const secciones = set.sections ?? [];
  if (secciones.length !== ORDEN_ACTUAL_ESPERADO.length) {
    throw new Error(
      `Se esperaban ${ORDEN_ACTUAL_ESPERADO.length} secciones, se encontraron ${secciones.length}. Abortando sin tocar nada.`
    );
  }
  for (let i = 0; i < ORDEN_ACTUAL_ESPERADO.length; i++) {
    const esperado = ORDEN_ACTUAL_ESPERADO[i];
    const real = secciones[i];
    if (!real || real.type !== esperado.type) {
      throw new Error(
        `Sección ${i}: se esperaba type="${esperado.type}", se encontró "${real?.type}". Abortando sin tocar nada.`
      );
    }
    const items = real.items ?? [];
    if (items.length !== esperado.count) {
      throw new Error(
        `Sección "${esperado.type}" (índice ${i}): se esperaban ${esperado.count} ítems, se encontraron ${items.length}. Abortando sin tocar nada.`
      );
    }
  }
}

// Para una sección actualmente en índice i (0-6, todas menos
// conversation_image), su nuevo número de sección es i+2 (1-indexado,
// desplazado en uno: viejo s1 -> nuevo s2, ..., viejo s7 -> nuevo s8).
// conversation_image (índice 7) pasa a ser el nuevo s1.
function nuevoNumeroSeccion(indiceActual, type) {
  if (type === 'conversation_image') return 1;
  return indiceActual + 2;
}

// Construye el mapa oldRef -> newRef para las 36 ítems, y lo valida como
// una función bien definida e inyectiva sobre las 36 ítems (ver la NOTA
// dentro de la función sobre por qué NO es una permutación en el sentido
// de "mismo conjunto de refs", pese a que en un caso más simple lo sería).
function construirMapeoRefs(set) {
  const mapeo = {};
  set.sections.forEach((section, indiceActual) => {
    const nuevoNumero = nuevoNumeroSeccion(indiceActual, section.type);
    section.items.forEach(item => {
      const sufijoItem = item.ref.replace(/^s\d+/, ''); // "iN" -- no cambia
      const nuevoRef = `s${nuevoNumero}${sufijoItem}`;
      mapeo[item.ref] = nuevoRef;
    });
  });

  const oldRefs = new Set(Object.keys(mapeo));
  const newRefs = new Set(Object.values(mapeo));
  if (oldRefs.size !== 36 || newRefs.size !== 36) {
    throw new Error(
      `Mapeo de refs inválido: se esperaban 36 refs únicos en cada lado, se encontraron ${oldRefs.size} viejos / ${newRefs.size} nuevos.`
    );
  }
  // NOTA: el mapeo NO es una permutación en el sentido de "el conjunto de
  // 36 refs nuevos es exactamente igual, como strings, al conjunto de 36
  // refs viejos". Eso sería cierto solo si cada sección conservara su
  // conteo de ítems al desplazarse de posición, y no es el caso acá: p.ej.
  // micro_trottoir (6 ítems, viejo s3) pasa a ocupar la posición s4, que
  // chronique (solo 2 ítems) dejó vacante -- así que aparecen refs nuevos
  // como s4i5/s4i6 que ningún ítem viejo tenía como ref (verificado a mano
  // contra los conteos reales: 4,6,6,2,3,1,10,4). Lo que sí se puede y debe
  // verificar acá -- y es lo que realmente importa para que el rename sea
  // seguro -- es que el mapeo sea una función bien definida e inyectiva
  // sobre las 36 ítems: 36 refs viejos de entrada, 36 refs nuevos de
  // salida, todos distintos entre sí (ya verificado arriba). Eso es lo que
  // garantiza que la fase B del rename no puede hacer que dos ítems
  // distintos terminen queriendo el mismo nombre de archivo. La seguridad
  // ante colisiones intermedias (un nuevo ref que coincide con el ref
  // viejo de OTRO ítem que todavía no fue renombrado) la da el sufijo
  // temporal de dos fases más abajo, no esta aserción.
  for (const [oldRef, newRef] of Object.entries(mapeo)) {
    if (typeof newRef !== 'string' || newRef.length === 0) {
      throw new Error(`Mapeo de refs inválido: "${oldRef}" no tiene un nuevo ref válido.`);
    }
  }

  return mapeo;
}

async function renombrar(desde, hasta, historial) {
  await rename(desde, hasta);
  historial.push({ desde, hasta });
}

async function deshacerRenombres(historial) {
  const fallos = [];
  // Deshace en orden inverso a como se hicieron.
  for (let i = historial.length - 1; i >= 0; i--) {
    const { desde, hasta } = historial[i];
    try {
      await rename(hasta, desde);
    } catch (error) {
      fallos.push({ desde, hasta, error });
    }
  }
  return fallos;
}

async function renombrarArchivos(set, mapeo) {
  const historial = [];
  try {
    // Fase A: viejo nombre -> viejo nombre + sufijo temporal.
    for (const section of set.sections) {
      for (const item of section.items) {
        const oldRef = item.ref;
        await renombrar(
          join(AUDIO_DIR, `${oldRef}.wav`),
          join(AUDIO_DIR, `${oldRef}.wav${TMP_SUFFIX}`),
          historial
        );
        if (section.type === 'conversation_image') {
          for (const sufijo of IMAGE_SUFFIXES) {
            await renombrar(
              join(IMAGES_DIR, `${oldRef}-${sufijo}.jpg`),
              join(IMAGES_DIR, `${oldRef}-${sufijo}.jpg${TMP_SUFFIX}`),
              historial
            );
          }
        }
      }
    }

    // Fase B: viejo nombre + sufijo temporal -> nuevo nombre final.
    for (const section of set.sections) {
      for (const item of section.items) {
        const oldRef = item.ref;
        const newRef = mapeo[oldRef];
        await renombrar(
          join(AUDIO_DIR, `${oldRef}.wav${TMP_SUFFIX}`),
          join(AUDIO_DIR, `${newRef}.wav`),
          historial
        );
        if (section.type === 'conversation_image') {
          for (const sufijo of IMAGE_SUFFIXES) {
            await renombrar(
              join(IMAGES_DIR, `${oldRef}-${sufijo}.jpg${TMP_SUFFIX}`),
              join(IMAGES_DIR, `${newRef}-${sufijo}.jpg`),
              historial
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('Falló el renombrado de archivos a mitad de camino. Intentando deshacer los renombres ya realizados...');
    const fallosRollback = await deshacerRenombres(historial);
    if (fallosRollback.length > 0) {
      console.error('El rollback también falló parcialmente. NO se tocó set.json. Recuperación manual necesaria.');
      console.error(`Directorio de backup (segunda línea de defensa): ${BACKUP_DIR_ACTUAL}`);
      console.error('Error original:', error);
      console.error('Fallos de rollback:', fallosRollback);
      throw new Error(
        `Renombrado falló Y el rollback falló parcialmente (${fallosRollback.length} archivo(s) no se pudieron restaurar). ` +
        `set.json no fue tocado. Backup completo disponible en: ${BACKUP_DIR_ACTUAL}. ` +
        `Ver arriba el error original y los fallos de rollback para recuperación manual.`
      );
    }
    console.error(`Rollback completado exitosamente -- todos los archivos renombrados fueron restaurados a su nombre original. set.json no fue tocado.`);
    console.error(`Backup completo (segunda línea de defensa) disponible en: ${BACKUP_DIR_ACTUAL}`);
    throw new Error(
      `Renombrado de archivos falló, pero el rollback fue exitoso -- todos los archivos están de vuelta en su nombre original. ` +
      `set.json no fue tocado. Backup completo disponible en: ${BACKUP_DIR_ACTUAL}. Error original: ${error.message}`
    );
  }
}

async function verificarArchivosNuevos(set, mapeo) {
  const faltantes = [];
  for (const section of set.sections) {
    for (const item of section.items) {
      const newRef = mapeo[item.ref];
      const audioPath = join(AUDIO_DIR, `${newRef}.wav`);
      try {
        await stat(audioPath);
      } catch {
        faltantes.push(audioPath);
      }
      if (section.type === 'conversation_image') {
        for (const sufijo of IMAGE_SUFFIXES) {
          const imgPath = join(IMAGES_DIR, `${newRef}-${sufijo}.jpg`);
          try {
            await stat(imgPath);
          } catch {
            faltantes.push(imgPath);
          }
        }
      }
    }
  }

  if (faltantes.length > 0) {
    throw new Error(
      `Verificación post-rename falló: ${faltantes.length} archivo(s) esperado(s) no existen en su nueva ubicación:\n` +
      faltantes.map(f => `  - ${f}`).join('\n') +
      `\nLos archivos ya renombrados permanecen en su nueva ubicación (set.json todavía NO fue tocado, así que ` +
      `el set.json viejo -- con refs viejos apuntando a nombres de archivo que ya no existen -- quedaría roto). ` +
      `El directorio de backup es la vía de recuperación para este caso: ${BACKUP_DIR_ACTUAL}`
    );
  }
}

function actualizarSetJson(set, mapeo) {
  // Reordena set.sections: conversation_image primero, las otras 7 en su
  // orden relativo original.
  const conversationImage = set.sections.find(s => s.type === 'conversation_image');
  const resto = set.sections.filter(s => s.type !== 'conversation_image');
  set.sections = [conversationImage, ...resto];

  for (const section of set.sections) {
    for (const item of section.items) {
      const newRef = mapeo[item.ref];
      item.ref = newRef;
      item.audio = `audio/${newRef}.wav`;
      if (section.type === 'conversation_image' && Array.isArray(item.images)) {
        item.images = item.images.map(img => ({ ...img, path: `images/${newRef}-${img.id}.jpg` }));
      }
    }
  }

  set.plan = set.plan.map(entry => ({ ...entry, ref: mapeo[entry.ref] }));

  return set;
}

let BACKUP_DIR_ACTUAL = null;

async function main() {
  const raw = await readFile(SET_JSON, 'utf8');
  const set = JSON.parse(raw);

  // Idempotencia: si conversation_image ya está primero, el reorder ya se
  // hizo en una corrida anterior. Seguro de re-ejecutar.
  if (set.sections?.[0]?.type === 'conversation_image') {
    console.log('conversation_image ya está en la posición 0 -- el reorder ya se aplicó. Nada que hacer.');
    return;
  }

  verificarOrdenActual(set);
  const mapeo = construirMapeoRefs(set);

  console.log('Mapeo de refs (viejo -> nuevo):');
  for (const [oldRef, newRef] of Object.entries(mapeo)) {
    console.log(`  ${oldRef} -> ${newRef}`);
  }

  // Backup del directorio COMPLETO (no solo set.json) antes de tocar nada --
  // este reorder también renombra archivos reales de audio/imagen.
  const timestamp = Date.now();
  BACKUP_DIR_ACTUAL = `${SET_DIR}.backup-reorder-${timestamp}`;
  await cp(SET_DIR, BACKUP_DIR_ACTUAL, { recursive: true });
  console.log(`Backup completo del directorio del set creado en: ${BACKUP_DIR_ACTUAL}`);

  await renombrarArchivos(set, mapeo);
  console.log('Renombrado de archivos (audio + imágenes) completado.');

  await verificarArchivosNuevos(set, mapeo);
  console.log('Verificación post-rename OK: los 36 archivos de audio y 20 archivos de imagen existen en su nueva ubicación.');

  const setActualizado = actualizarSetJson(set, mapeo);
  await writeSet(DATA_DIR, setActualizado);
  console.log('set.json actualizado y escrito atómicamente.');

  // Lectura de vuelta desde disco (no el objeto en memoria) para confirmar.
  const verificacion = JSON.parse(await readFile(SET_JSON, 'utf8'));
  console.log('\nOrden final de secciones (leído de vuelta desde disco):');
  verificacion.sections.forEach((s, i) => console.log(`  ${i}: ${s.type} (${s.items.length} ítems)`));
  console.log(`\nsections[0].type === 'conversation_image': ${verificacion.sections[0]?.type === 'conversation_image'}`);
  console.log(`\nBackup completo disponible en: ${BACKUP_DIR_ACTUAL}`);
}

main().catch(error => {
  console.error('Reorder falló:', error.message);
  process.exit(1);
});
