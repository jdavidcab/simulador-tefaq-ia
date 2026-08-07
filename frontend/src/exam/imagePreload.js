// Precarga de imágenes para conversation_image. A diferencia de
// audioPreload.js, no usa blob URLs -- las imágenes son livianas (bocetos
// 512px) y no necesitan gestión de memoria explícita; "precargar" aquí
// significa solo confirmar que cada imagen decodifica antes de arrancar el
// intento, para que no aparezca un ícono roto a mitad del examen.

const API_BASE = 'http://localhost:3001';
const IMAGE_LOAD_TIMEOUT_MS = 15000;

function imageUrlFor(setId, path) {
  return `${API_BASE}/api/sets/${setId}/${path}`;
}

function confirmLoadable(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const img = new Image();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
    const onLoad = () => finish(resolve);
    const onError = () => finish(reject, new Error('Imagen no decodificable'));
    const timer = setTimeout(
      () => finish(reject, new Error('Tiempo de espera agotado al validar imagen')),
      IMAGE_LOAD_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', onAbort);
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    img.src = url;
  });
}

// `images`: array de { key, path } -- key es `${ref}-${optionId}`, path es
// item.images[i].path (relativo, ej. "images/s1i1-A.jpg").
export async function preloadSetImages({ setId, images, concurrency = 4, signal, onProgress }) {
  const urls = new Map();
  const failedKeys = [];
  let done = 0;
  let cursor = 0;

  const report = () => onProgress?.({ done, total: images.length, failedKeys: [...failedKeys] });

  async function worker() {
    while (cursor < images.length) {
      const image = images[cursor];
      cursor += 1;
      try {
        const url = imageUrlFor(setId, image.path);
        await confirmLoadable(url, signal);
        urls.set(image.key, url);
      } catch (error) {
        if (signal?.aborted) return;
        failedKeys.push(image.key);
      } finally {
        done += 1;
        report();
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, images.length || 1));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { urls, failedKeys };
}
