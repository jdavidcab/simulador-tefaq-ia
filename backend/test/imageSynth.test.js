import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageSynth } from '../src/images/synth.js';

function fetchFake({ status = 200, base64 = 'aGVsbG8=' } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => 'cuerpo de error simulado',
    json: async () => ({ steps: [{ content: [{ type: 'image', mime_type: 'image/png', data: base64 }] }] }),
  });
}

test('synthImageToFile escribe el archivo y retorna el base64', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'img-'));
  const synth = createImageSynth({ apiKey: 'fake-key', fetchImpl: fetchFake() });
  const outPath = join(dir, 'a.png');
  const result = await synth.synthImageToFile({ prompt: 'un croissant', outPath });
  assert.equal(result.base64, 'aGVsbG8=');
  const bytes = await readFile(outPath);
  assert.equal(bytes.toString('base64'), 'aGVsbG8=');
});

test('synthImageToFile lanza sin apiKey, con status 503', async () => {
  const synth = createImageSynth({ apiKey: undefined, fetchImpl: fetchFake() });
  await assert.rejects(
    () => synth.synthImageToFile({ prompt: 'x', outPath: '/tmp/x.png' }),
    error => error.status === 503,
  );
});

test('synthImageToFile propaga error.status en un HTTP fallido', async () => {
  const synth = createImageSynth({ apiKey: 'k', fetchImpl: fetchFake({ status: 429 }) });
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
  const synth = createImageSynth({ apiKey: 'k', fetchImpl: fetchFake() });
  const outPath = join(dir, 'ref.png');
  await synth.synthImageToFile({ prompt: 'estilo neutro', outPath });
  const base64 = await synth.readReferenceIfExists(outPath);
  assert.equal(base64, 'aGVsbG8=');
});
