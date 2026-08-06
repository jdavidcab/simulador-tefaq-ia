import React, { useCallback, useEffect, useRef, useState } from 'react';
import SetPicker from './SetPicker';
import ExamRunner from './ExamRunner';
import ExamSummary from './ExamSummary';
import { checkSetCompatibility } from './setCompatibility';
import { preloadSetAudio, revokeAudioUrls } from './audioPreload';

const API_BASE = 'http://localhost:3001';
const ACTIVE_PHASES = new Set(['preloading', 'unlock', 'running']);
const GUARDED_PHASES = new Set(['preloading', 'unlock', 'running', 'summary']);

const ExamMode = ({ onActiveChange }) => {
  const [phase, setPhase] = useState('picker');
  const [setId, setSetId] = useState(null);
  const [setDetail, setSetDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [compatError, setCompatError] = useState(null);
  const [preloadProgress, setPreloadProgress] = useState({ done: 0, total: 0 });
  const [failedRefs, setFailedRefs] = useState([]);
  const [results, setResults] = useState(null);

  const audioElRef = useRef(null);
  const audioUrlsRef = useRef(new Map());
  const preloadAbortRef = useRef(null);

  useEffect(() => {
    onActiveChange?.(ACTIVE_PHASES.has(phase));
  }, [phase, onActiveChange]);

  useEffect(() => {
    if (!GUARDED_PHASES.has(phase)) return undefined;
    const handler = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  const resetAudio = useCallback(() => {
    revokeAudioUrls(audioUrlsRef.current);
    audioUrlsRef.current = new Map();
    setFailedRefs([]);
    setPreloadProgress({ done: 0, total: 0 });
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
      audioElRef.current.load();
    }
  }, []);

  const goToPicker = useCallback(() => {
    preloadAbortRef.current?.abort();
    resetAudio();
    setSetId(null);
    setSetDetail(null);
    setLoadError(null);
    setCompatError(null);
    setResults(null);
    setPhase('picker');
  }, [resetAudio]);

  // Recibe `id` como parámetro en vez de leer el estado `setId` por clausura:
  // handleSelect llama a esto en el mismo tick que setSetId(chosenId), antes
  // de que React re-renderice, así que un runPreload cerrado sobre el estado
  // vería todavía el setId ANTERIOR (null en la primera selección).
  const runPreload = useCallback(async (refs, id) => {
    preloadAbortRef.current = new AbortController();
    setPhase('preloading');
    const { urls, failedRefs: failed } = await preloadSetAudio({
      setId: id,
      refs,
      signal: preloadAbortRef.current.signal,
      onProgress: setPreloadProgress,
    });
    for (const [ref, url] of urls) audioUrlsRef.current.set(ref, url);
    if (failed.length > 0) {
      setFailedRefs(failed);
      setPhase('preload-failed');
    } else {
      setFailedRefs([]);
      setPhase('unlock');
    }
  }, []);

  const handleSelect = useCallback(async (chosenId) => {
    setSetId(chosenId);
    setPhase('loading');
    try {
      const res = await fetch(`${API_BASE}/api/sets/${chosenId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const compatibility = checkSetCompatibility(data);
      if (!compatibility.ok) {
        setCompatError(compatibility.reason);
        setPhase('incompatible');
        return;
      }
      setSetDetail(data);
      const refs = data.sections.flatMap(section => section.items.map(item => item.ref));
      await runPreload(refs, chosenId);
    } catch (error) {
      setLoadError(error.message);
      setPhase('loading-error');
    }
  }, [runPreload]);

  const handleRetryFailed = useCallback(() => {
    runPreload(failedRefs, setId);
  }, [runPreload, failedRefs, setId]);

  const handleUnlock = useCallback(async () => {
    const audioEl = audioElRef.current;
    const firstRef = setDetail?.sections?.[0]?.items?.[0]?.ref;
    const firstUrl = firstRef ? audioUrlsRef.current.get(firstRef) : null;
    if (firstUrl) audioEl.src = firstUrl;
    audioEl.muted = true;
    try {
      await audioEl.play();
      audioEl.pause();
    } catch {
      // Un rechazo aquí no es fatal: ExamRunner reintenta la reproducción real
      // del primer ítem con su propio manejo de AUDIO_FAILED.
    } finally {
      audioEl.muted = false;
      audioEl.currentTime = 0;
    }
    setPhase('running');
  }, [setDetail]);

  const handleComplete = useCallback((finalResults) => {
    setResults(finalResults);
    setPhase('summary');
  }, []);

  const totalsBySection = setDetail
    ? Object.fromEntries(
        setDetail.sections.map(s => [s.type, s.items.reduce((n, i) => n + i.questions.length, 0)]),
      )
    : {};

  if (phase === 'picker') return <SetPicker onSelect={handleSelect} />;

  if (phase === 'loading') {
    return <div className="text-center py-10 text-blue-600">Cargando set...</div>;
  }

  if (phase === 'loading-error') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-red-600">No se pudo cargar el set: {loadError}</p>
        <button onClick={() => handleSelect(setId)} className="bg-blue-600 text-white px-4 py-2 rounded">
          Reintentar
        </button>
        <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">
          Volver a la lista
        </button>
      </div>
    );
  }

  if (phase === 'incompatible') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-amber-700">{compatError}</p>
        <button onClick={goToPicker} className="bg-blue-600 text-white px-4 py-2 rounded">
          Volver a la lista
        </button>
      </div>
    );
  }

  return (
    <div>
      <audio ref={audioElRef} style={{ display: 'none' }} />

      {phase === 'preloading' && (
        <div className="text-center py-10 space-y-2">
          <p className="text-blue-600">Preparando examen... {preloadProgress.done}/{preloadProgress.total}</p>
        </div>
      )}

      {phase === 'preload-failed' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-red-600">No se pudieron descargar {failedRefs.length} audio(s).</p>
          <button onClick={handleRetryFailed} className="bg-blue-600 text-white px-4 py-2 rounded">
            Reintentar fallidos
          </button>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">
            Volver a la lista
          </button>
        </div>
      )}

      {phase === 'unlock' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-green-700">Audio listo.</p>
          <button onClick={handleUnlock} className="bg-blue-600 text-white px-6 py-3 rounded text-lg">
            Comenzar examen
          </button>
        </div>
      )}

      {phase === 'running' && setDetail && (
        <ExamRunner
          set={setDetail}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onComplete={handleComplete}
          onAbandon={goToPicker}
        />
      )}

      {phase === 'summary' && results && (
        <ExamSummary
          correctTotal={results.correctTotal}
          totalQuestions={Object.values(totalsBySection).reduce((a, b) => a + b, 0)}
          correctBySection={results.correctBySection}
          totalsBySection={totalsBySection}
          onExit={goToPicker}
        />
      )}
    </div>
  );
};

export default ExamMode;
