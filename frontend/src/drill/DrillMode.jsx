import React, { useCallback, useEffect, useRef, useState } from 'react';
import DrillPicker from './DrillPicker';
import DrillRunner from './DrillRunner';
import DrillReview from './DrillReview';
import { checkDrillSetCompatibility } from './drillSetCompatibility';
import { preloadSetAudio, revokeAudioUrls } from '../exam/audioPreload';

const API_BASE = 'http://localhost:3001';
const ACTIVE_PHASES = new Set(['preloading', 'unlock', 'running']);
const GUARDED_PHASES = new Set(['preloading', 'unlock', 'running']);

const DrillMode = ({ onActiveChange }) => {
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

  const runPreload = useCallback(async (refs, id) => {
    const controller = new AbortController();
    preloadAbortRef.current = controller;
    setPhase('preloading');

    const audioResult = await preloadSetAudio({
      setId: id,
      refs,
      signal: controller.signal,
      onProgress: p => setPreloadProgress({ done: p.done, total: p.total }),
    });

    if (controller.signal.aborted || preloadAbortRef.current !== controller) {
      revokeAudioUrls(audioResult.urls);
      return;
    }
    revokeAudioUrls(audioUrlsRef.current);
    audioUrlsRef.current = new Map(audioResult.urls);

    if (audioResult.failedRefs.length > 0) {
      setFailedRefs(audioResult.failedRefs);
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
      const compatibility = checkDrillSetCompatibility(data);
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
    const refs = setDetail.sections.flatMap(section => section.items.map(item => item.ref));
    runPreload(refs, setId);
  }, [runPreload, setDetail, setId]);

  const handleUnlock = useCallback(async () => {
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
      // No es fatal: DrillRunner maneja AUDIO_FAILED con su propia UI de reintento.
    } finally {
      setPhase('running');
    }
  }, [setDetail]);

  const handleComplete = useCallback((finalResults) => {
    setResults(finalResults);
    setPhase('review');
  }, []);

  if (phase === 'picker') return <DrillPicker onSelect={handleSelect} />;

  if (phase === 'loading') {
    return <div className="text-center py-10 text-blue-600">Cargando drill...</div>;
  }

  if (phase === 'loading-error') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-red-600">No se pudo cargar el drill: {loadError}</p>
        <button onClick={() => handleSelect(setId)} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar</button>
        <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Volver a la lista</button>
      </div>
    );
  }

  if (phase === 'incompatible') {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-amber-700">{compatError}</p>
        <button onClick={goToPicker} className="bg-blue-600 text-white px-4 py-2 rounded">Volver a la lista</button>
      </div>
    );
  }

  return (
    <div>
      <audio ref={audioElRef} style={{ display: 'none' }} />

      {phase === 'preloading' && (
        <div className="text-center py-10 space-y-2">
          <p className="text-blue-600">Preparando drill... {preloadProgress.done}/{preloadProgress.total}</p>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Cancelar / Volver a la lista</button>
        </div>
      )}

      {phase === 'preload-failed' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-red-600">No se pudieron descargar {failedRefs.length} audio(s).</p>
          <button onClick={handleRetryFailed} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar fallidos</button>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Volver a la lista</button>
        </div>
      )}

      {phase === 'unlock' && (
        <div className="space-y-3 text-center py-10">
          <p className="text-green-700">Audio listo.</p>
          <button onClick={handleUnlock} className="bg-blue-600 text-white px-6 py-3 rounded text-lg">Comenzar drill</button>
          <button onClick={goToPicker} className="block mx-auto text-sm text-gray-500 hover:underline">Cancelar / Volver a la lista</button>
        </div>
      )}

      {phase === 'running' && setDetail && (
        <DrillRunner
          set={setDetail}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onComplete={handleComplete}
          onAbandon={goToPicker}
        />
      )}

      {phase === 'review' && setDetail && results && (
        <DrillReview
          set={setDetail}
          answers={results.answers}
          audioElRef={audioElRef}
          audioUrls={audioUrlsRef.current}
          onExit={goToPicker}
        />
      )}
    </div>
  );
};

export default DrillMode;
