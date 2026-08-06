// Precarga de audio para el Runner de examen. No es lógica pura (usa fetch,
// Audio, URL.createObjectURL) -- se verifica manualmente en el navegador,
// como el resto del frontend. Concurrencia acotada + AbortController +
// verificación real de reproducibilidad (no solo "llegaron bytes") porque un
// set completo son ~50-60MB de WAV sin comprimir.

const API_BASE = 'http://localhost:3001';
const AUDIO_LOAD_TIMEOUT_MS = 30000;

function audioUrlFor(setId, ref) {
  return `${API_BASE}/api/sets/${setId}/audio/${ref}.wav`;
}

async function fetchAudioBlob(setId, ref, signal) {
  const response = await fetch(audioUrlFor(setId, ref), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar ${ref}.wav`);
  return response.blob();
}

// Confirma que el blob es audio reproducible de verdad, no solo que
// llegaron bytes -- espera loadedmetadata con una duración finita.
function confirmPlayable(blobUrl) {
  return new Promise((resolve, reject) => {
    const probe = new Audio();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeEventListener('loadedmetadata', onLoaded);
      probe.removeEventListener('error', onError);
      fn(value);
    };
    const onLoaded = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) finish(resolve);
      else finish(reject, new Error('Duración de audio no válida'));
    };
    const onError = () => finish(reject, new Error('Audio no decodificable'));
    const timer = setTimeout(
      () => finish(reject, new Error('Tiempo de espera agotado al validar audio')),
      AUDIO_LOAD_TIMEOUT_MS,
    );
    probe.addEventListener('loadedmetadata', onLoaded);
    probe.addEventListener('error', onError);
    probe.src = blobUrl;
  });
}

export async function preloadSetAudio({ setId, refs, concurrency = 4, signal, onProgress }) {
  const urls = new Map();
  const failedRefs = [];
  let done = 0;
  let cursor = 0;

  const report = () => onProgress?.({ done, total: refs.length, failedRefs: [...failedRefs] });

  async function worker() {
    while (cursor < refs.length) {
      const ref = refs[cursor];
      cursor += 1;
      let blobUrl = null;
      try {
        const blob = await fetchAudioBlob(setId, ref, signal);
        blobUrl = URL.createObjectURL(blob);
        await confirmPlayable(blobUrl);
        urls.set(ref, blobUrl);
      } catch (error) {
        if (blobUrl) URL.revokeObjectURL(blobUrl); // siempre revocar, incluso si el fallo fue por abort
        if (signal?.aborted) return;
        failedRefs.push(ref);
      } finally {
        done += 1;
        report();
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, refs.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { urls, failedRefs };
}

export function revokeAudioUrls(urls) {
  for (const url of urls.values()) URL.revokeObjectURL(url);
}
