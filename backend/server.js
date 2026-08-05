import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createProviders, VALID_SELECTORS } from './src/providers/index.js';
import { createQuestionGenerator } from './src/questionGenerator.js';
import { VALID_DIFFICULTIES } from './src/prompt.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Factory (crea los providers disponibles) + Bridge (cadena de fallback)
const providers = createProviders();
const generator = createQuestionGenerator(providers);
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_VOICES = (process.env.TTS_VOICES || process.env.TTS_VOICE || 'Kore,Charon,Puck')
  .split(',')
  .map(voice => voice.trim())
  .filter(Boolean);
if (TTS_VOICES.length === 0) TTS_VOICES.push('Kore');
const TTS_API_KEY = process.env.TTS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const MAX_AUDIO_CACHE = 100;
const audioCache = new Map();
const audioInFlight = new Map();
const DEFAULT_WORD_RANGE = { minWords: 30, maxWords: 50 };
const MAX_PREFETCHED_QUESTIONS_PER_KEY = 1;
const questionQueues = new Map();

function getQuestionParams(req) {
  const selector = req.query.provider ?? 'auto';
  const minWords = Number(req.query.minWords ?? DEFAULT_WORD_RANGE.minWords);
  const maxWords = Number(req.query.maxWords ?? DEFAULT_WORD_RANGE.maxWords);
  const verticalScan = req.query.verticalScan === 'true';
  const warmAudio = req.query.warmAudio !== 'false';
  const difficulty = String(req.query.difficulty ?? 'B2').toUpperCase();

  if (!VALID_SELECTORS.includes(selector)) {
    const err = new Error(`provider inválido: "${selector}". Válidos: ${VALID_SELECTORS.join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (!Number.isFinite(minWords) || !Number.isFinite(maxWords) || minWords < 1 || maxWords < minWords) {
    const err = new Error(`Rango de palabras inválido: minWords=${req.query.minWords ?? ''}, maxWords=${req.query.maxWords ?? ''}`);
    err.status = 400;
    throw err;
  }

  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    const err = new Error(`Dificultad inválida: "${difficulty}". Válidas: ${VALID_DIFFICULTIES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  return { selector, minWords, maxWords, verticalScan, warmAudio, difficulty };
}

function getQuestionQueueKey({ selector, minWords, maxWords, verticalScan, difficulty, warmAudio }) {
  return `${selector}:${minWords}:${maxWords}:${verticalScan}:${difficulty}:${warmAudio}`;
}

function getQuestionQueue(key) {
  if (!questionQueues.has(key)) questionQueues.set(key, { questions: [], inFlight: null });
  return questionQueues.get(key);
}

function generatePrefetchedQuestion(params, key) {
  const queue = getQuestionQueue(key);
  if (queue.inFlight || queue.questions.length >= MAX_PREFETCHED_QUESTIONS_PER_KEY) return queue.inFlight;

  queue.inFlight = generator
    .generateQuestion(params.selector, {
      minWords: params.minWords,
      maxWords: params.maxWords,
      verticalScan: params.verticalScan,
      difficulty: params.difficulty,
    })
    .then(question => {
      if (queue.questions.length < MAX_PREFETCHED_QUESTIONS_PER_KEY) queue.questions.push(question);
      if (params.warmAudio) warmAudioCache(question.transcript);
      return question;
    })
    .catch(error => {
      console.error('[prefetch] Error generating question:', error.message);
      return null;
    })
    .finally(() => {
      queue.inFlight = null;
    });

  return queue.inFlight;
}

function ensurePrefetchedQuestion(params) {
  const key = getQuestionQueueKey(params);
  generatePrefetchedQuestion(params, key);
}

function rememberAudio(cacheKey, buffer) {
  if (audioCache.has(cacheKey)) audioCache.delete(cacheKey);
  audioCache.set(cacheKey, buffer);
  if (audioCache.size > MAX_AUDIO_CACHE) {
    const oldestKey = audioCache.keys().next().value;
    audioCache.delete(oldestKey);
  }
}

function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
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

function getStableIndex(text, max) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % max;
}

function getTtsVoice(text) {
  return TTS_VOICES[getStableIndex(text, TTS_VOICES.length)] || 'Kore';
}

async function generateTtsAudio(text) {
  if (!TTS_API_KEY) {
    const err = new Error('No hay API key configurada para Gemini TTS');
    err.status = 503;
    throw err;
  }

  const voice = getTtsVoice(text);
  const cacheKey = `${voice}:${text}`;
  if (audioCache.has(cacheKey)) return audioCache.get(cacheKey);
  if (audioInFlight.has(cacheKey)) return audioInFlight.get(cacheKey);

  const request = fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'x-goog-api-key': TTS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: text,
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ voice }],
      },
    }),
  })
    .then(async response => {
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${TTS_MODEL}: HTTP ${response.status} ${body.slice(0, 200)}`.trim());
      }

      const data = await response.json();
      const base64Audio = data?.steps?.[0]?.content?.find(content => content?.type === 'audio' || content?.mime_type?.startsWith('audio/'))?.data;
      if (!base64Audio) throw new Error(`${TTS_MODEL}: respuesta sin output_audio.data`);

      const wavBuffer = pcmToWav(Buffer.from(base64Audio, 'base64'));
      rememberAudio(cacheKey, wavBuffer);
      return wavBuffer;
    })
    .finally(() => {
      audioInFlight.delete(cacheKey);
    });

  audioInFlight.set(cacheKey, request);
  return request;
}

function warmAudioCache(text) {
  if (!text || !TTS_API_KEY) return;
  generateTtsAudio(text).catch(error => {
    console.error('[prefetch] Error warming TTS cache:', error.message);
  });
}

app.get('/api/generate-question', async (req, res) => {
  let params;
  try {
    params = getQuestionParams(req);
  } catch (error) {
    return res.status(error.status ?? 400).json({ error: error.message });
  }

  const key = getQuestionQueueKey(params);
  const queue = getQuestionQueue(key);
  const prefetchedQuestion = queue.questions.shift();

  if (prefetchedQuestion) {
    res.json({ ...prefetchedQuestion, prefetched: true });
    ensurePrefetchedQuestion(params);
    return;
  }

  try {
    const question = await generator.generateQuestion(params.selector, {
      minWords: params.minWords,
      maxWords: params.maxWords,
      verticalScan: params.verticalScan,
      difficulty: params.difficulty,
    });
    res.json({ ...question, prefetched: false });
    ensurePrefetchedQuestion(params);
  } catch (error) {
    console.error('Error generating question:', error.message);
    res.status(503).json({
      error: 'No se pudo generar la pregunta con ningún proveedor',
      providersTried: error.providersTried ?? [],
    });
  }
});

app.post('/api/prefetch-question', (req, res) => {
  let params;
  try {
    params = getQuestionParams(req);
  } catch (error) {
    return res.status(error.status ?? 400).json({ error: error.message });
  }

  const key = getQuestionQueueKey(params);
  const queue = getQuestionQueue(key);
  const ready = queue.questions.length;
  const inFlight = Boolean(queue.inFlight);
  ensurePrefetchedQuestion(params);

  res.json({ ok: true, ready, inFlight });
});

app.post('/api/tts', async (req, res) => {
  const text = req.body?.text?.trim();

  if (!text) {
    return res.status(400).json({ error: 'Falta el campo "text" para generar el audio' });
  }

  try {
    const wavBuffer = await generateTtsAudio(text);
    res
      .set('Content-Type', 'audio/wav')
      .set('Cache-Control', 'public, max-age=3600')
      .send(wavBuffer);
  } catch (error) {
    console.error('Error generating TTS:', error.message);
    res.status(503).json({ error: 'No se pudo generar el audio del anuncio' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`TEFAQ Agent running on port ${PORT}`);
});
