# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TEFAQ (French listening exam for Quebec) simulator. An Express backend generates exam questions with LLMs and synthesizes the announcement audio; a React/Vite frontend runs the timed simulation. Not a git repository. No test suite, linter, or type checking exists — verify changes by running both apps.

UI text, prompts, and comments are in Spanish; generated exam content (transcript, prompt, options) is in French. Keep that split when editing.

## Commands

```bash
# backend (port 3001)
cd backend && npm install && npm start

# frontend (Vite dev server, usually 5173)
cd frontend && npm install && npm run dev
cd frontend && npm run build     # production bundle into dist/
```

The frontend hardcodes `http://localhost:3001` in `fetch` calls — the backend must be running on that port.

`backend/.env` holds `GEMINI_API_KEY`, `OPENCODE_API_KEY`, optional `TTS_GEMINI_API_KEY` (separate TTS quota), and optional `TTS_VOICE` / `TTS_VOICES` (comma-separated; `TTS_VOICES` wins). Providers whose key is missing are silently skipped at startup with a console warning, so a partially configured `.env` still runs.

## Backend architecture

Three layers, deliberately decoupled (the code comments name them Factory / Strategy / Bridge):

- `src/providers/*.provider.js` — each exposes `{ name, generate(prompt) -> string }`. `gemini.provider.js` uses the Google SDK; `opencodego.provider.js` is a generic OpenAI-compatible client instantiated once per model id.
- `src/providers/index.js` — `createProviders()` instantiates only providers with a configured key. `MODELS` maps selector keys (`deepseek`, `mimo`, `mimoPro`) to gateway model ids; `AUTO_CHAIN` is the fallback order; `VALID_SELECTORS` gates the `?provider=` query param. **Selectors are not model ids** — the frontend `<select>` values must stay in sync with `VALID_SELECTORS`.
- `src/questionGenerator.js` — provider-agnostic. Walks the chain, and for each provider: strip markdown fences → `JSON.parse` → `validateQuestion` → `randomizeCorrectOption`. Any failure (quota, network, malformed JSON, failed validation) is caught and the chain advances; only if all fail does it throw with `providersTried`. Adding a validation rule therefore also makes providers "fail" — keep rules genuinely structural.

`validateQuestion` enforces 4 options with `id`/`text`, `correctId` ∈ A–D matching an option, non-empty `feedback`, and a transcript word count inside `[minWords-2, maxWords+2]` (a ±2 tolerance the model can't reliably hit exactly). `randomizeCorrectOption` reshuffles options and reassigns A–D so the correct answer isn't biased toward one letter, then `normalizeFeedback` rewrites the feedback text to match the new letter — models frequently reference letters despite the prompt forbidding it.

### Prompt construction

`src/prompt.js` builds one system prompt per request from three randomized inputs: a topic from `TEFAQ_TOPICS`, a `DIFFICULTY_PROFILES` entry (B1/B2/C1 — vocabulary, distractor subtlety, option similarity), and a pattern from `src/tefaqPatterns.js` (`pickTefaqPattern()` samples question type, distractor pattern, announcement structure, Quebec expressions). `verticalScan=true` swaps rule 14 to force the 4 options to share a ≥3-word syntactic prefix, which is what makes the frontend's vertical-scan highlighting apply.

### Caching and prefetch

Two independent in-memory caches, both lost on restart:

- **Question queue** (`questionQueues` in `server.js`): keyed by the full param tuple `selector:minWords:maxWords:verticalScan:difficulty:warmAudio`, holding at most 1 question. `GET /api/generate-question` serves a queued question instantly (`prefetched: true`) and immediately starts generating the replacement. `POST /api/prefetch-question` (same query params) just triggers a fill. Any param change means a different key and a cold generation.
- **Audio cache** (`audioCache`, LRU, max 100): keyed by `voice:text`, with `audioInFlight` deduping concurrent requests for the same key. Prefetching a question also warms its audio unless `warmAudio=false`.

TTS calls `gemini-2.5-flash-preview-tts` via the `v1beta/interactions` REST endpoint (not the SDK), returns raw PCM, and `pcmToWav` prepends a 44-byte WAV header before responding with `audio/wav`. The voice comes from `getStableIndex(text)` — a deterministic hash of the transcript, so the prefetch and playback of the same text always resolve to the same cache entry while voices still vary across questions.

## Frontend architecture

`src/App.jsx` is the entire UI: one component driving a `phase` state machine — `idle → loading → (scanPractice | scanning → reading → answering → feedback)`. `scanPractice` is the "solo lectura rápida" mode: it skips audio and scoring entirely and can hand off into `reading` via `continueScanPracticeToFull`.

Timing is a single 1s interval on `timeLeft`; `handleTimeUp` decides the next phase. The `reading` phase's duration is negotiated between a word-count estimate (`wordsPerMinute`) and the real audio duration once `onLoadedMetadata` fires, and is extended rather than truncated if the audio would be cut off (`AUDIO_END_BUFFER_SECONDS`). Because of this, changing playback rate or audio length mid-phase must go through `getAudioRemainingTime`, not a fixed timer.

Audio blobs are managed manually: `audioRequestIdRef` invalidates in-flight TTS fetches when the question changes, and every URL swap goes through `replaceAudioUrl`/`clearAudio` so object URLs are revoked. Don't set `audioUrl` directly.

`src/trainingScan.js` is pure logic for the two scan-training overlays, kept out of the component:
- `buildTrainingView` finds the common word prefix across the 4 options; it only "applies" (`verticalApplies`) if the prefix is ≥3 tokens and every option has content past it — the backend's `verticalScan` flag makes this likely but never guarantees it, so the UI must handle both.
- `getKeywordView` extracts up to 5 French content words using a stopword list plus suffix heuristics (`IMPORTANT_SHORT_TOKENS` whitelists Quebec acronyms like STM, SAAQ, CPE).
- `getHighlightedChunks` tags each whitespace-preserving chunk as common-prefix / keyword so `renderOptionContent` can color it.
