import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pcmToWav, wavDurationSeconds, createSynth } from '../src/audio/synth.js';

test('wavDurationSeconds calcula la duración desde el tamaño del PCM', () => {
  assert.equal(wavDurationSeconds(48000), 1);      // 24 kHz mono 16 bits = 48000 B/s
  assert.equal(wavDurationSeconds(24000), 0.5);
  assert.equal(wavDurationSeconds(0), 0);
});

test('pcmToWav antepone una cabecera RIFF de 44 bytes', () => {
  const pcm = Buffer.alloc(100, 1);
  const wav = pcmToWav(pcm);
  assert.equal(wav.length, 144);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000, 'sample rate');
  assert.equal(wav.readUInt32LE(40), 100, 'tamaño de datos');
});

test('escribe el WAV a disco y devuelve la duración medida', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));
  const outPath = join(dir, 's1i1.wav');
  const pcm = Buffer.alloc(96000, 7); // 2 segundos

  const fetchFake = async () => ({
    ok: true,
    json: async () => ({ steps: [{ content: [{ type: 'audio', data: pcm.toString('base64') }] }] }),
  });

  const synth = createSynth({ apiKey: 'fake', voices: ['Kore'], fetchImpl: fetchFake });
  const { duree_audio_s, voice } = await synth.synthToFile({ text: 'bonjour tout le monde', outPath });

  assert.equal(duree_audio_s, 2);
  assert.equal(voice, 'Kore');
  const escrito = await readFile(outPath);
  assert.equal(escrito.length, 96000 + 44);
});

test('elige la voz de forma estable a partir del texto', async () => {
  const pcm = Buffer.alloc(4800, 1);
  const fetchFake = async () => ({
    ok: true,
    json: async () => ({ steps: [{ content: [{ type: 'audio', data: pcm.toString('base64') }] }] }),
  });
  const synth = createSynth({ apiKey: 'fake', voices: ['Kore', 'Charon', 'Puck'], fetchImpl: fetchFake });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));

  const a = await synth.synthToFile({ text: 'même texte', outPath: join(dir, 'a.wav') });
  const b = await synth.synthToFile({ text: 'même texte', outPath: join(dir, 'b.wav') });
  assert.equal(a.voice, b.voice, 'el mismo texto debe dar siempre la misma voz');
});

test('propaga el status HTTP para que el generador sepa si es cuota', async () => {
  const fetchFake = async () => ({ ok: false, status: 429, text: async () => 'quota exceeded' });
  const synth = createSynth({ apiKey: 'fake', voices: ['Kore'], fetchImpl: fetchFake });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));

  await assert.rejects(
    () => synth.synthToFile({ text: 'bonjour', outPath: join(dir, 'x.wav') }),
    (error) => {
      assert.equal(error.status, 429);
      return true;
    },
  );
});

test('lanza si la respuesta no trae audio', async () => {
  const fetchFake = async () => ({ ok: true, json: async () => ({ steps: [{ content: [] }] }) });
  const synth = createSynth({ apiKey: 'fake', voices: ['Kore'], fetchImpl: fetchFake });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));
  await assert.rejects(() => synth.synthToFile({ text: 'bonjour', outPath: join(dir, 'x.wav') }), /audio/);
});

test('lanza si no hay API key configurada', async () => {
  const synth = createSynth({ apiKey: '', voices: ['Kore'] });
  const dir = await mkdtemp(join(tmpdir(), 'synth-'));
  await assert.rejects(
    () => synth.synthToFile({ text: 'bonjour', outPath: join(dir, 'x.wav') }),
    (error) => {
      assert.equal(error.status, 503);
      return true;
    },
  );
});
