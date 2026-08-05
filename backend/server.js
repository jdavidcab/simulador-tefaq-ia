import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createProviders, VALID_SELECTORS } from './src/providers/index.js';
import { createItemGenerator } from './src/itemGenerator.js';
import { pcmToWav, getStableIndex, createSynth } from './src/audio/synth.js';
import { createPipeline } from './src/sets/pipeline.js';
import { listSets, readSet, deleteSet, audioDir } from './src/sets/store.js';
import { VALID_DIFFICULTIES } from './src/prompt/profiles.js';
import { TOPICS } from './src/topics/catalog.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Factory (crea los providers disponibles) + Bridge (cadena de fallback)
const providers = createProviders();
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_VOICES = (process.env.TTS_VOICES || process.env.TTS_VOICE || 'Kore,Charon,Puck')
  .split(',')
  .map(voice => voice.trim())
  .filter(Boolean);
if (TTS_VOICES.length === 0) TTS_VOICES.push('Kore');
const TTS_API_KEY = process.env.TTS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));
const generator = createItemGenerator(providers);
const synth = createSynth({ apiKey: TTS_API_KEY, voices: TTS_VOICES });
const pipeline = createPipeline({ dataDir: DATA_DIR, generator, synth });

// El modo entrenamiento sigue usando el formato de una sola pregunta corta.
const SECCION_ENTRENAMIENTO = 'divers';

// Elige un tema al azar entre los etiquetados para la sección pedida; si
// ninguno calza (no debería pasar con el catálogo actual), cae al catálogo
// completo antes que fallar.
export function temaAleatorioParaSeccion(sectionType) {
  const candidatos = TOPICS.filter(tema => tema.sections.includes(sectionType));
  const pool = candidatos.length > 0 ? candidatos : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)].text;
}

// El frontend de entrenamiento espera la forma plana de siempre.
export function aplanarItem(item) {
  const question = item.questions[0];
  return {
    prompt: question.prompt,
    options: question.options,
    correctId: question.correctId,
    feedback: question.feedback,
    transcript: item.transcript,
  };
}

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
    .generateItem({
      sectionType: SECCION_ENTRENAMIENTO,
      topic: temaAleatorioParaSeccion(SECCION_ENTRENAMIENTO),
      difficulty: params.difficulty,
      minWords: params.minWords,
      maxWords: params.maxWords,
      verticalScan: params.verticalScan,
      selector: params.selector === 'auto' ? undefined : [params.selector],
    })
    .then(item => {
      const question = { ...aplanarItem(item), provider: item.provider };
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
    const item = await generator.generateItem({
      sectionType: SECCION_ENTRENAMIENTO,
      topic: temaAleatorioParaSeccion(SECCION_ENTRENAMIENTO),
      difficulty: params.difficulty,
      minWords: params.minWords,
      maxWords: params.maxWords,
      verticalScan: params.verticalScan,
      selector: params.selector === 'auto' ? undefined : [params.selector],
    });
    const question = { ...aplanarItem(item), provider: item.provider };
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

// Valida el formato de :id en las 5 rutas que lo usan de una sola vez, antes
// de que llegue a ningún handler: un id no confiable no debe tocar el
// filesystem (ver deleteSet/readSet/audioDir, que construyen rutas con él).
const ID_SET_VALIDO = /^set-\d{4}-\d{2}-\d{2}-[a-z0-9]{4}$/;

app.param('id', (req, res, next, id) => {
  if (!ID_SET_VALIDO.test(id)) {
    return res.status(400).json({ error: 'id de set inválido' });
  }
  next();
});

app.post('/api/sets/generate', async (req, res) => {
  try {
    const set = await pipeline.createSet({
      difficulty: req.body?.difficulty,
      format: req.body?.format,
      pilotes: Boolean(req.body?.pilotes),
      seed: req.body?.seed,
    });
    res.status(201).json({ id: set.id, total: set.plan.length, statut: set.statut });
    // Arranca en background: el disco ya tiene el esqueleto completo.
    pipeline.run(set.id, { maxItems: req.body?.maxItems }).catch(error => {
      console.error(`[pipeline] ${set.id} falló:`, error.message);
    });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.post('/api/sets/:id/resume', async (req, res) => {
  if (pipeline.isRunning(req.params.id)) {
    return res.status(409).json({ error: 'El set ya está en curso' });
  }
  try {
    const set = await readSet(DATA_DIR, req.params.id);
    res.json({ id: set.id, ...pipeline.statusOf(set) });
    pipeline.run(set.id, { maxItems: req.body?.maxItems }).catch(error => {
      console.error(`[pipeline] ${set.id} falló:`, error.message);
    });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/sets', async (_req, res) => {
  try {
    res.json(await listSets(DATA_DIR));
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/sets/:id', async (req, res) => {
  try {
    res.json(await readSet(DATA_DIR, req.params.id));
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/sets/:id/status', async (req, res) => {
  try {
    const set = await readSet(DATA_DIR, req.params.id);
    res.json({ ...pipeline.statusOf(set), enCours: pipeline.isRunning(set.id) });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/sets/:id/audio/:archivo', (req, res) => {
  if (!/^[\w-]+\.wav$/.test(req.params.archivo)) {
    return res.status(400).json({ error: 'Nombre de audio inválido' });
  }
  res.sendFile(join(audioDir(DATA_DIR, req.params.id), req.params.archivo), error => {
    if (error) res.status(404).json({ error: 'Audio no encontrado' });
  });
});

app.delete('/api/sets/:id', async (req, res) => {
  if (pipeline.isRunning(req.params.id)) {
    return res.status(409).json({ error: 'No se puede borrar un set en curso' });
  }
  try {
    await deleteSet(DATA_DIR, req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

// Solo escucha si se ejecuta directamente (`node server.js`); importarlo desde
// un test no debe abrir un puerto.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`TEFAQ Agent running on port ${PORT}`);
  });
}

export { app };
