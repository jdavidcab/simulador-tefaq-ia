import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// El historial se deriva de los set.json en disco: una sola fuente de verdad.
// Borrar la carpeta de un set libera sus temas sin código de limpieza.
export async function readRecentPlans(setsDir, window, formats) {
  if (window <= 0) return [];

  let entries;
  try {
    entries = await readdir(setsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const sets = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await readFile(join(setsDir, entry.name, 'set.json'), 'utf8');
      const data = JSON.parse(raw);
      if (formats && !formats.includes(data.format)) continue;
      sets.push({ genere_le: data.genere_le ?? '', plan: Array.isArray(data.plan) ? data.plan : [] });
    } catch {
      // Carpeta sin set.json o JSON corrupto: no debe tumbar la planificación.
      continue;
    }
  }

  return sets
    .sort((a, b) => String(b.genere_le).localeCompare(String(a.genere_le)))
    .slice(0, window)
    .map(set => set.plan);
}
