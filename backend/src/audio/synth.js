import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

// El WAV lo construimos nosotros con parámetros conocidos, así que la duración
// es aritmética exacta. No hace falta ffmpeg ni leer el archivo de vuelta.
export function wavDurationSeconds(pcmByteLength, sampleRate = 24000, channels = 1, bytesPerSample = 2) {
  return pcmByteLength / (sampleRate * channels * bytesPerSample);
}

export function getStableIndex(text, max) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % max;
}

export function createSynth({ apiKey, voices, fetchImpl = fetch }) {
  const disponibles = voices?.length ? voices : ['Kore'];

  return {
    async synthToFile({ text, outPath }) {
      if (!apiKey) {
        const error = new Error('No hay API key configurada para Gemini TTS');
        error.status = 503;
        throw error;
      }

      const voice = disponibles[getStableIndex(text, disponibles.length)];
      const response = await fetchImpl(TTS_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TTS_MODEL,
          input: text,
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice }] },
        }),
      });

      if (!response.ok) {
        const cuerpo = await response.text().catch(() => '');
        const error = new Error(`${TTS_MODEL}: HTTP ${response.status} ${cuerpo.slice(0, 200)}`.trim());
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const base64 = data?.steps?.[0]?.content
        ?.find(content => content?.type === 'audio' || content?.mime_type?.startsWith('audio/'))?.data;
      if (!base64) throw new Error(`${TTS_MODEL}: respuesta sin datos de audio`);

      const pcm = Buffer.from(base64, 'base64');
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, pcmToWav(pcm));

      return { duree_audio_s: wavDurationSeconds(pcm.length), voice };
    },
  };
}
