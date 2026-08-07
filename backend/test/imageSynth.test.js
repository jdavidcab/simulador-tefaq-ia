import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageSynth } from '../src/images/synth.js';

// Captura url/options de cada llamada en `calls` para que los tests puedan
// aserter sobre el cuerpo real enviado (ver test de response_format más
// abajo), en vez de ignorar los argumentos como antes.
function fetchFake({ status = 200, base64 = 'aGVsbG8=', responseBody } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => 'cuerpo de error simulado',
      json: async () => responseBody
        ?? { steps: [{ content: [{ type: 'image', mime_type: 'image/jpeg', data: base64 }] }] },
    };
  };
  return { fetchImpl, calls };
}

test('synthImageToFile escribe el archivo y retorna el base64', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'img-'));
  const { fetchImpl } = fetchFake();
  const synth = createImageSynth({ apiKey: 'fake-key', fetchImpl });
  const outPath = join(dir, 'a.png');
  const result = await synth.synthImageToFile({ prompt: 'un croissant', outPath });
  assert.equal(result.base64, 'aGVsbG8=');
  const bytes = await readFile(outPath);
  assert.equal(bytes.toString('base64'), 'aGVsbG8=');
});

// Pin de los dos valores descubiertos únicamente a golpes de HTTP 400 contra
// la API real (ver comentario en src/images/synth.js): mime_type debe ser
// 'image/jpeg' (no 'image/png') e image_size debe ser el string pelado
// '512' (no '512px'). Sin este test, un futuro "arreglo" cosmético de
// cualquiera de los dos regresaría en silencio con la suite mockeada en
// verde.
test('synthImageToFile envía mime_type image/jpeg e image_size "512" en el body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'img-'));
  const { fetchImpl, calls } = fetchFake();
  const synth = createImageSynth({ apiKey: 'fake-key', fetchImpl });
  const outPath = join(dir, 'b.png');
  await synth.synthImageToFile({ prompt: 'un croissant', outPath });
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.response_format, { type: 'image', mime_type: 'image/jpeg', image_size: '512' });
});

test('synthImageToFile encuentra el step con content cuando steps[0] es un "thought" sin content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'img-'));
  const { fetchImpl } = fetchFake({
    responseBody: {
      steps: [
        { type: 'thought' },
        { content: [{ type: 'image', mime_type: 'image/jpeg', data: 'ZmFrZQ==' }] },
      ],
    },
  });
  const synth = createImageSynth({ apiKey: 'fake-key', fetchImpl });
  const outPath = join(dir, 'c.png');
  const result = await synth.synthImageToFile({ prompt: 'un croissant', outPath });
  assert.equal(result.base64, 'ZmFrZQ==');
  const bytes = await readFile(outPath);
  assert.equal(bytes.toString('base64'), 'ZmFrZQ==');
});

test('synthImageToFile lanza sin apiKey, con status 503', async () => {
  const { fetchImpl } = fetchFake();
  const synth = createImageSynth({ apiKey: undefined, fetchImpl });
  await assert.rejects(
    () => synth.synthImageToFile({ prompt: 'x', outPath: '/tmp/x.png' }),
    error => error.status === 503,
  );
});

test('synthImageToFile propaga error.status en un HTTP fallido', async () => {
  const { fetchImpl } = fetchFake({ status: 429 });
  const synth = createImageSynth({ apiKey: 'k', fetchImpl });
  await assert.rejects(
    () => synth.synthImageToFile({ prompt: 'x', outPath: '/tmp/x.png' }),
    error => error.status === 429,
  );
});

test('readReferenceIfExists retorna null si el archivo no existe', async () => {
  const synth = createImageSynth({ apiKey: 'k' });
  const result = await synth.readReferenceIfExists('/no/existe/nunca.png');
  assert.equal(result, null);
});

test('readReferenceIfExists relee un archivo ya escrito', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'img-'));
  const { fetchImpl } = fetchFake();
  const synth = createImageSynth({ apiKey: 'k', fetchImpl });
  const outPath = join(dir, 'ref.png');
  await synth.synthImageToFile({ prompt: 'estilo neutro', outPath });
  const base64 = await synth.readReferenceIfExists(outPath);
  assert.equal(base64, 'aGVsbG8=');
});
