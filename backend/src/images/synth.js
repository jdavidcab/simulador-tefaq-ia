import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const IMAGE_MODEL = 'gemini-3.1-flash-image';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export function createImageSynth({ apiKey, fetchImpl = fetch }) {
  return {
    async synthImageToFile({ prompt, referenceImageBase64, outPath }) {
      if (!apiKey) {
        const error = new Error('No hay API key configurada para Gemini Image');
        error.status = 503;
        throw error;
      }

      const input = [{ type: 'text', text: prompt }];
      if (referenceImageBase64) {
        input.push({ type: 'image', mime_type: 'image/jpeg', data: referenceImageBase64 });
      }

      const response = await fetchImpl(INTERACTIONS_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          input,
          response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '512' },
        }),
      });

      if (!response.ok) {
        const cuerpo = await response.text().catch(() => '');
        const error = new Error(`${IMAGE_MODEL}: HTTP ${response.status} ${cuerpo.slice(0, 200)}`.trim());
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const base64 = data?.steps?.[0]?.content
        ?.find(content => content?.type === 'image' || content?.mime_type?.startsWith('image/'))?.data;
      if (!base64) throw new Error(`${IMAGE_MODEL}: respuesta sin datos de imagen`);

      const buffer = Buffer.from(base64, 'base64');
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buffer);

      return { base64 };
    },

    // Checkpoint de reanudación para la imagen de referencia neutral: si el
    // archivo ya existe en disco (de una corrida anterior), se relee en vez
    // de regenerarla -- evita gastar una llamada pagada de más.
    async readReferenceIfExists(path) {
      try {
        const buffer = await readFile(path);
        return buffer.toString('base64');
      } catch {
        return null;
      }
    },
  };
}
