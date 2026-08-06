import React, { useCallback, useEffect, useRef, useState } from 'react';
import SetPicker from './SetPicker';
import ExamRunner from './ExamRunner';
import ExamReview from './ExamReview';
import ExamSummary from './ExamSummary';
import { checkSetCompatibility } from './setCompatibility';
import { preloadSetAudio, revokeAudioUrls } from './audioPreload';

const API_BASE = 'http://localhost:3001';
const ACTIVE_PHASES = new Set(['preloading', 'unlock', 'running']);
const GUARDED_PHASES = new Set(['preloading', 'unlock', 'running']);

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
  // El cuerpo del efecto (no solo su cleanup) tiene que volver a poner
  // mountedRef.current = true: bajo React.StrictMode (dev), React monta ->
  // desmonta -> vuelve a montar cada componente una vez a propósito. Ese
  // desmontaje simulado ejecuta el cleanup ANTES de que el usuario haga
  // nada, dejando mountedRef.current en false para siempre si el efecto no
  // lo reafirma al (re)montar -- lo que convertía cada guard de abajo en un
  // no-op permanente y dejaba handleSelect trabado en 'loading'.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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

  // Red de seguridad para cuando ExamMode se desmonta (p.ej. el usuario
  // vuelve a Entrenamiento) sin pasar por goToPicker -- reaching 'summary' o
  // 'preload-failed' ya reactivó el selector de modo (ver ACTIVE_PHASES), así
  // que un desmontaje directo desde ahí saltaría toda la limpieza normal.
  useEffect(() => () => {
    preloadAbortRef.current?.abort();
    revokeAudioUrls(audioUrlsRef.current);
  }, []);

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
    const controller = new AbortController();
    preloadAbortRef.current = controller;
    setPhase('preloading');
    const { urls, failedRefs: failed } = await preloadSetAudio({
      setId: id,
      refs,
      signal: controller.signal,
      onProgress: setPreloadProgress,
    });
    // Compara la identidad de ESTA llamada, no el ref mutable: si mientras
    // esperábamos, otra llamada a runPreload ya reemplazó preloadAbortRef.current
    // con un controller nuevo, esta resolución es obsoleta -- no debe tocar el
    // estado de la operación nueva, ni siquiera si su propio controller nunca
    // se abortó explícitamente. Revocar lo descargado: nadie más lo hará.
    if (controller.signal.aborted || preloadAbortRef.current !== controller) {
      revokeAudioUrls(urls);
      return;
    }
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
      if (!mountedRef.current) return;
      const data = await res.json();
      if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
      setLoadError(error.message);
      setPhase('loading-error');
    }
  }, [runPreload]);

  const handleRetryFailed = useCallback(() => {
    runPreload(failedRefs, setId);
  }, [runPreload, failedRefs, setId]);

  const handleUnlock = useCallback(async () => {
    // Toda la función va envuelta: NADA de lo de aquí adentro (ref nula,
    // .currentTime = 0 lanzando InvalidStateError en algunos motores cuando
    // readyState === HAVE_NOTHING, etc.) puede impedir llegar a
    // setPhase('running') -- ese es justo el síntoma original que esto arregla.
    try {
      const audioEl = audioElRef.current;
      const firstRef = setDetail?.sections?.[0]?.items?.[0]?.ref;
      const firstUrl = firstRef ? audioUrlsRef.current.get(firstRef) : null;
      if (firstUrl) audioEl.src = firstUrl;
      audioEl.muted = true;
      try {
        await audioEl.play();
        audioEl.pause();
      } finally {
        audioEl.muted = false;
        audioEl.currentTime = 0;
      }
    } catch {
      // Nada aquí es fatal para arrancar el examen: ExamRunner maneja
      // AUDIO_FAILED con su propia UI de reintento una vez en 'running'.
    } finally {
      setPhase('running');
    }
  }, [setDetail]);

  const handleComplete = useCallback((finalResults) => {
    setResults(finalResults);
    setPhase('summary');
  }, []);

  const handleShowReview = useCallback(() => setPhase('review'), []);
  const handleBackToSummary = useCallback(() => setPhase('summary'), []);

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
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">
            Cancelar / Volver a la lista
          </button>
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
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">
            Cancelar / Volver a la lista
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
          onShowReview={handleShowReview}
        />
      )}

      {phase === 'review' && setDetail && results && (
        <ExamReview
          set={setDetail}
          answers={results.answers}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onBackToSummary={handleBackToSummary}
          onExit={goToPicker}
        />
      )}
    </div>
  );
};

export default ExamMode;
