# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TEFAQ (French listening exam for Quebec) simulator. An Express backend generates exam content with LLMs and synthesizes audio; a React/Vite frontend runs the timed training simulation. Two modes share the same generation core: a single-question **training mode** (`TrainingMode.jsx`, unchanged behavior) and a **Modo Examen** pipeline that generates and persists full 36-question exam sets to disk, played back by a lockstep frontend runner (`frontend/src/exam/`) that consumes already-generated sets — it does not trigger generation itself. No linter or type checking exists; the backend has a `node --test` suite (157 tests), and the frontend now has one too (`frontend/src/exam/*.test.js`, run via `cd frontend && npm test`) covering the runner's pure modules (`examTiming.js`, `examMachine.js`, `examProgress.js`, `setCompatibility.js`, `examScoring.js`, `reviewModel.js`, `highlightSegments.js`) — everything else in the frontend is still verified by running the app.

UI text, prompts, and comments are in Spanish; generated exam content (transcript, prompt, options, feedback reasoning) is in French except `feedback`, which is Spanish. Keep that split when editing.

## Commands

```bash
# backend (port 3001)
cd backend && npm install && npm start
cd backend && npm test           # node --test, full suite
cd backend && node --test test/itemGenerator.test.js   # a single file

# frontend (Vite dev server, usually 5173)
cd frontend && npm install && npm run dev
cd frontend && npm run build     # production bundle into dist/
```

The frontend hardcodes `http://localhost:3001` in `fetch` calls — the backend must be running on that port.

`backend/.env` holds `GEMINI_API_KEY`, `OPENCODE_API_KEY`, optional `TTS_GEMINI_API_KEY` (separate TTS quota), and optional `TTS_VOICE` / `TTS_VOICES` (comma-separated; `TTS_VOICES` wins). Providers whose key is missing are silently skipped at startup with a console warning, so a partially configured `.env` still runs.

## Backend architecture

`backend/src/` is split into pure logic (no disk, no network, no clock) and I/O, so most of it is unit-testable without mocks:

- **Pure**: `examFormat.js` (section presets, calibrated by hand — see below), `topics/catalog.js` + `topics/planner.js`, `prompt/` (per-section prompt constructors), `validation/` (structural + content checks), `itemGenerator.js`'s shuffle/feedback logic.
- **I/O**: `topics/history.js` (reads recent sets off disk), `sets/store.js` (atomic set persistence), `audio/synth.js` (TTS + WAV), `providers/*` (LLM clients).
- **Orchestration**: `itemGenerator.js` ties prompt+validation+providers into one generated item; `sets/pipeline.js` ties planner+generator+synth+store into a resumable set-generation run; `server.js` wires both into HTTP routes.

`src/providers/*.provider.js` each expose `{ name, generate(prompt) -> string }` (`gemini.provider.js` via the Google SDK, `opencodego.provider.js` a generic OpenAI-compatible client instantiated once per model id). `src/providers/index.js`'s `createProviders()` skips any provider whose key is missing; `AUTO_CHAIN` is the fallback order; `VALID_SELECTORS` gates the `?provider=` query param — **selectors are not model ids**, keep the frontend `<select>` in sync.

### Item generation (`itemGenerator.js`)

`createItemGenerator(providers, config).generateItem(opts)` builds a section prompt, calls a provider, validates the JSON, shuffles options (except `micro_trottoir`, whose options are fixed postures), and normalizes feedback — used identically by training mode and the exam-set pipeline.

**Two-tier retry policy**, the reason this module exists as its own layer: `esFalloDeCuotaORed(error)` classifies a failure as quota/network (HTTP 429/5xx, timeout) or validation (bad JSON, out-of-range word count, failed justification check, etc.). Quota/network failures skip straight to the next provider in the chain — retrying the same model against a dead key wastes calls. Validation failures retry the *same* provider up to `config.validationRetries` times first, since with `temperature: 1` they're usually sampling noise, not a systemic problem, and downgrading models loses quality for nothing.

**`normalizeFeedback`** is a safety net against the prompt's "don't mention option letters in feedback" rule, applied to every question of every section type after any shuffle. It does not try to surgically edit around a detected letter — if a bare `A`/`B`/`C`/`D` token appears *anywhere* in the feedback (first sentence or the tenth, in Spanish, English, or French elision like `L'option A`), the model's reasoning is discarded entirely for a generic-but-correct fallback message. This was tightened after real generated content showed a surgical-edit version (which only checked the first sentence) leaving contradictory feedback — e.g. citing letter A as correct while `correctId` was B — because shuffling reassigns letters after the model writes its reasoning.

### Prompt construction (`prompt/`)

`prompt/index.js`'s `buildSectionPrompt(sectionType, opts)` dispatches to one constructor per section in `prompt/sections/` (`annonce_publique`, `repondeur`, `micro_trottoir`, `chronique`, `interview`, `reportage`, `divers` — `conversation_image` has no constructor yet, deferred to a future slice). These 7 files are deliberately *not* collapsed into one table-driven constructor: prompts are expected to keep diverging per section (postures for `micro_trottoir`, dialogue-alternation rules for `interview`), and a shared constructor would accumulate per-section conditionals. `prompt/common.js` holds the genuinely shared fragments (difficulty-profile text, the JSON schema block, the word-count/justification rules); `prompt/profiles.js` holds `DIFFICULTY_PROFILES`/`VALID_DIFFICULTIES` (B1/B2/C1).

Every section's prompt requires a `justification` field per question: a near-verbatim quote from the transcript supporting the correct answer. `validation/justification.js` scores it — exact substring match scores 1.0; otherwise it's the fraction of the justification's distinct content words (via `validation/frenchWords.js`, a deliberate duplicate of the frontend's stopword list — the two are allowed to diverge) that appear in the transcript. This is a coarse anti-hallucination gate (catches a justification unrelated to the transcript) and deliberately *not* order/adjacency-aware (catching a justification that grafts real words from unrelated sentences into a false claim) — the prompt requires paraphrasing, so a stricter check would reject legitimate paraphrases too.

### Exam-set generation (`sets/`, `topics/`, Modo Examen)

`sets/pipeline.js`'s `createPipeline(...).createSet(...)` samples a full set's topic plan via `topics/planner.js` and writes the skeleton (32 items, all `en_attente`) to disk before generating anything. `run(setId, {maxItems})` then works items in plan order; each item moves `en_attente` → `genere` (text validated, flushed to disk) → `pret` (audio synthesized, flushed) or `echoue`, with a flush after *every* step — this is what makes crash-resume, quota-exhaustion-stop, and `maxItems`-cutoff the same code path as normal operation rather than special cases. A retry always reuses the item's original `topicId` from the plan. On a TTS failure, quota/network-classified errors (`esFalloDeCuotaORed`) stop the whole run cleanly; other TTS failures move on to the next item. The in-memory `enCurso` lock (not a lock file) rejects a second concurrent `run()` for the same set.

`topics/planner.js`'s `planTopics(...)` assigns topics **scarcest-section-first** (by pool-size ÷ demand ratio) so a large, flexible section like `divers` can't claim shared topics before a tightly-constrained one like `chronique` gets its share; if a section's pool is short even before competition, the anti-repetition window against recent sets (`CONFIG.historyWindow`, default 3) relaxes 3→2→1→0 for *that section only*, recorded in `relaxations`. `topics/catalog.js` has ~150 topics tagged by which section(s) they suit — bloc 3 (`chronique`/`interview`/`reportage`) needs real debate/current-affairs topics, not just volume.

Only `SET_STANDARD_36` (the 8 official sections minus `conversation_image`, 36 questions / 32 audio items) is generable today; `SET_STANDARD_40` is declared in `examFormat.js` but rejected by the pipeline until `conversation_image` has a prompt constructor.

Set routes (`/api/sets/*`) validate `:id` against `nuevoSetId()`'s format (`app.param('id', ...)` in `server.js`) before it ever reaches a filesystem path — this exists specifically to block path traversal, since CORS is open and any page a user's browser visits could otherwise hit `localhost:3001`.

### Caching and prefetch (training mode)

Two independent in-memory caches in `server.js`, both lost on restart:

- **Question queue** (`questionQueues`): keyed by the full param tuple `selector:minWords:maxWords:verticalScan:difficulty:warmAudio`, holding at most 1 question. `GET /api/generate-question` serves a queued question instantly (`prefetched: true`, via the `aplanarItem` adapter that flattens `itemGenerator.js`'s `{transcript, questions:[q]}` to the flat shape the frontend expects) and immediately starts generating the replacement. `POST /api/prefetch-question` (same query params) just triggers a fill.
- **Audio cache** (`audioCache`, LRU, max 100): keyed by `voice:text`, with `audioInFlight` deduping concurrent requests. Prefetching a question also warms its audio unless `warmAudio=false`.

TTS calls `gemini-2.5-flash-preview-tts` via the `v1beta/interactions` REST endpoint (not the SDK) in `src/audio/synth.js`, returns raw PCM, and `pcmToWav` prepends a 44-byte WAV header. The voice comes from `getStableIndex(text)` — a deterministic hash, so the prefetch and playback of the same text (training mode) or a resumed synthesis (exam sets) always pick the same voice, while voices still vary across items.

## Frontend architecture

`src/App.jsx` is now a thin shell: a mode switcher between `TrainingMode.jsx` (training) and `exam/ExamMode.jsx` (Modo Examen), disabled while an exam attempt is active so it can't be discarded silently. `TrainingMode.jsx` is the entire training UI: one component driving a `phase` state machine — `idle → loading → (scanPractice | scanning → reading → answering | feedback)`. `scanPractice` is the "solo lectura rápida" mode: it skips audio and scoring entirely and can hand off into `reading` via `continueScanPracticeToFull`.

`exam/` holds the Modo Examen runner, kept deliberately separate from training mode (no shared state, no shared audio-control UI — exam audio is autoplay-only). `ExamMode.jsx` owns the top-level flow (`picker → loading → (loading-error | incompatible) → preloading → preload-failed → unlock → running → (summary ⇄ review)`) and the persistent `<audio>` element reused for every item's playback during the run, and again for on-demand playback in `review`. `examMachine.js` is a pure reducer (`(set, state, event) -> nextState`) driving the per-item lockstep (`avant → audio-pending → audio-playing → apres`, plus a `section-intro` phase before each of the 7 sections — 15 fixed seconds of instructions/timing, auto-advancing via the same `TIMER_EXPIRED` mechanism as every other timed phase, no manual continue) — every async-originated event carries a `{sectionIndex, itemIndex, phase}` token so a stale callback (a late audio-end after a watchdog already fired, or vice versa) is a no-op instead of double-advancing. `examProgress.js` derives each of the 32 audio items' visual state (`completed`/`current`/`pending`) from `sectionIndex`/`itemIndex`/`phase` for the runner's non-interactive progress-tab strip. During `audio-pending`/`audio-playing` the shared `<audio>` element is no longer fully hidden — a custom, non-scrubbable progress bar (driven by the audio's own `timeupdate` event, not the reducer) shows elapsed/total time; the rest of the run it stays `display: none`. `examTiming.js` anchors phase countdowns to absolute deadlines rather than decrementing a counter, and chains a new item's deadline from the previous phase's deadline (not the live clock) so per-transition scheduling slop can't compound over a 40-minute run. `setCompatibility.js` rejects sets generated with `pilotes: true` (36 items/40 questions, not this runner's 32/36 contract) before preload starts. `examScoring.js` computes the non-official `/699` estimate shown on `ExamSummary`. `reviewModel.js` computes per-question/item/section correctness for `ExamReview` (the untimed post-exam review screen — re-listen to any item, transcript with justifications highlighted, full feedback); `highlightSegments.js` locates justifications inside their transcript, normalizing the same way `backend/src/validation/frenchWords.js` does (not just case-insensitively) and resolving overlapping justifications by construction rather than assuming they can't happen. Audio blob URLs are kept alive through `summary` and `review` (not revoked the instant the exam completes, as earlier) — release still happens exactly once, via the same `goToPicker`/unmount cleanup every exit path already used. All seven pure modules are unit-tested; `ExamRunner.jsx`/`ExamMode.jsx`/`SetPicker.jsx`/`ExamSummary.jsx`/`ExamReview.jsx` are browser-verified only.

Timing is a single 1s interval on `timeLeft`; `handleTimeUp` decides the next phase. The `reading` phase's duration is negotiated between a word-count estimate (`wordsPerMinute`) and the real audio duration once `onLoadedMetadata` fires, and is extended rather than truncated if the audio would be cut off (`AUDIO_END_BUFFER_SECONDS`). Because of this, changing playback rate or audio length mid-phase must go through `getAudioRemainingTime`, not a fixed timer.

Audio blobs are managed manually: `audioRequestIdRef` invalidates in-flight TTS fetches when the question changes, and every URL swap goes through `replaceAudioUrl`/`clearAudio` so object URLs are revoked. Don't set `audioUrl` directly.

`src/trainingScan.js` is pure logic for the two scan-training overlays, kept out of the component:
- `buildTrainingView` finds the common word prefix across the 4 options; it only "applies" (`verticalApplies`) if the prefix is ≥3 tokens and every option has content past it — the backend's `verticalScan` flag makes this likely but never guarantees it, so the UI must handle both.
- `getKeywordView` extracts up to 5 French content words using a stopword list plus suffix heuristics (`IMPORTANT_SHORT_TOKENS` whitelists Quebec acronyms like STM, SAAQ, CPE).
- `getHighlightedChunks` tags each whitespace-preserving chunk as common-prefix / keyword so `renderOptionContent` can color it.
