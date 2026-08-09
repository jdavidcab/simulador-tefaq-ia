// Genera un nuevo set de drill y espera a que el pipeline lo termine.
// No es un componente React -- lógica pura de orquestación de red,
// inyectable (fetchImpl) para testear sin red real. `frontend/src/exam/`
// no tiene ningún equivalente: es la primera UI de generación bajo
// demanda del proyecto.
const API_BASE = 'http://localhost:3001';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateDrillSet({
  typeFilter, fetchImpl = fetch, pollIntervalMs = 2000, timeoutMs = 120000, signal,
} = {}) {
  const body = { format: 'SET_DRILL_PARAPHRASE' };
  if (typeFilter) body.typeFilter = typeFilter;

  const generateRes = await fetchImpl(`${API_BASE}/api/sets/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const generateData = await generateRes.json();
  if (!generateRes.ok) throw new Error(generateData.error || `HTTP ${generateRes.status}`);
  const setId = generateData.id;

  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() >= deadline) {
      const error = new Error(`Tiempo de espera agotado generando el drill "${setId}"`);
      error.code = 'timeout';
      error.setId = setId;
      throw error;
    }

    const statusRes = await fetchImpl(`${API_BASE}/api/sets/${setId}/status`, { signal });
    const statusData = await statusRes.json();
    if (!statusRes.ok) throw new Error(statusData.error || `HTTP ${statusRes.status}`);

    if (statusData.statut === 'complet') {
      return { id: setId, ...statusData };
    }
    if (statusData.statut === 'partial' && statusData.enCours === false) {
      const error = new Error(`El drill "${setId}" se detuvo sin terminar (${statusData.echoues} ítem(s) fallido(s))`);
      error.code = 'stalled';
      error.setId = setId;
      error.echoues = statusData.echoues;
      throw error;
    }

    await sleep(pollIntervalMs);
  }
}
