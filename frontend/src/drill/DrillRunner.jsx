import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, currentToken, computeResults, countAnswered } from '../exam/examMachine';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from '../exam/examTiming';

const TICK_MS = 250;
const WATCHDOG_GRACE_MS = 1000;

// La composición del drill es una sola "sección" (SET_DRILL_PARAPHRASE =
// ['drill_paraphrase']) -- createInitialState() de examMachine.js siempre
// arranca en phase:'section-intro', que para el drill no tiene sentido
// (pedido explícito: sin pantalla de instrucciones). Se evita sin tocar el
// reducer compartido ni simular una expiración de temporizador -- eso
// introduciría un render y callbacks asíncronos artificiales -- construyendo
// el estado inicial directamente en 'avant'.
function createDrillInitialState() {
  return { ...createInitialState(), phase: 'avant' };
}

const DrillRunner = ({ set, audioElRef, audioUrls, onComplete, onAbandon }) => {
  const [state, dispatch] = useReducer((s, e) => reducer(set, s, e), undefined, createDrillInitialState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const phaseTimingRef = useRef(null);
  const lastPhaseTimingRef = useRef(null);
  const watchdogRef = useRef(null);
  const firedRef = useRef(false);
  const [remaining, setRemaining] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  const section = set.sections[state.sectionIndex];
  const item = section?.items?.[state.itemIndex];
  const answeredCount = countAnswered(state.answers);
  const totalQuestions = set.sections.reduce((sum, s) => sum + s.items.reduce((n, i) => n + i.questions.length, 0), 0);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Mismo esquema de anclaje que ExamRunner.jsx: avant encadena desde el
  // deadline teórico de la fase anterior (nunca desde "ahora"), apres
  // arranca fresco desde el instante real en que terminó el audio.
  useEffect(() => {
    if (state.status !== 'running' || !section) return;
    if (state.phase === 'avant') {
      phaseTimingRef.current = lastPhaseTimingRef.current
        ? chainDeadline(lastPhaseTimingRef.current, section.timing.avant)
        : startPhase(section.timing.avant);
      lastPhaseTimingRef.current = null;
      setRemaining(remainingSeconds(phaseTimingRef.current));
    } else if (state.phase === 'apres') {
      phaseTimingRef.current = startPhase(section.timing.apres);
      setRemaining(remainingSeconds(phaseTimingRef.current));
    }
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status, section]);

  useEffect(() => {
    if (state.status !== 'running') return;
    if (state.phase !== 'avant' && state.phase !== 'apres') return;

    const interval = setInterval(() => {
      const timing = phaseTimingRef.current;
      if (!timing) return;
      setRemaining(remainingSeconds(timing));
      if (isExpired(timing)) {
        if (state.phase === 'apres') lastPhaseTimingRef.current = timing;
        dispatch({ type: 'TIMER_EXPIRED', token: currentToken(stateRef.current) });
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status]);

  useEffect(() => {
    if (state.phase !== 'audio-pending' || !item) return;
    const audioEl = audioElRef.current;
    const token = currentToken(state);
    const url = audioUrls.get(item.ref);
    if (!audioEl || !url) {
      dispatch({ type: 'AUDIO_FAILED', token });
      return;
    }
    audioEl.src = url;
    setAudioCurrentTime(0);
    audioEl.play().then(
      () => dispatch({ type: 'AUDIO_PLAYING', token }),
      () => dispatch({ type: 'AUDIO_FAILED', token }),
    );
  }, [state.phase, state.sectionIndex, state.itemIndex, audioElRef, audioUrls, item]);

  // Watchdog reimplementado de forma independiente -- en ExamRunner.jsx este
  // mecanismo vive embebido en el componente, no en un módulo separado, así
  // que no hay nada que importar; es el costo concreto aceptado por la
  // independencia total pedida entre drill y Modo Examen.
  useEffect(() => {
    if (state.phase !== 'audio-playing' || !item) return;
    const token = currentToken(state);
    watchdogRef.current = setTimeout(() => {
      dispatch({ type: 'TIMER_EXPIRED', token });
    }, item.duree_audio_s * 1000 + WATCHDOG_GRACE_MS);
    return clearWatchdog;
  }, [state.phase, state.sectionIndex, state.itemIndex, item, clearWatchdog]);

  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onEnded = () => {
      if (stateRef.current.phase !== 'audio-playing') return;
      clearWatchdog();
      dispatch({ type: 'AUDIO_ENDED', token: currentToken(stateRef.current) });
    };
    const onTimeUpdate = () => setAudioCurrentTime(audioEl.currentTime);
    audioEl.addEventListener('ended', onEnded);
    audioEl.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      audioEl.removeEventListener('ended', onEnded);
      audioEl.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [audioElRef, clearWatchdog]);

  useEffect(() => {
    if (firedRef.current) return;
    if (state.status === 'complete') {
      firedRef.current = true;
      onComplete(computeResults(set, state.answers));
    } else if (state.status === 'abandoned') {
      firedRef.current = true;
      onAbandon();
    }
  }, [state.status, set, state.answers, onComplete, onAbandon]);

  const handleAnswer = (questionIndex, optionId) => {
    dispatch({ type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex, optionId });
  };

  const handleAbandon = () => {
    if (!window.confirm('¿Seguro que querés abandonar la ráfaga? Se perderá todo tu progreso.')) return;
    dispatch({ type: 'ABANDON' });
  };

  const handleRetryAudio = () => {
    dispatch({ type: 'RETRY_AUDIO', token: currentToken(state) });
  };

  if (state.status !== 'running') return null;

  let body;
  if (state.phase === 'audio-failed') {
    body = (
      <div className="space-y-4 text-center py-10">
        <p className="text-red-600">No se pudo reproducir el audio.</p>
        <button onClick={handleRetryAudio} className="bg-blue-600 text-white px-6 py-2 rounded">Reintentar</button>
      </div>
    );
  } else if (!item) {
    return null;
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    const totalAudioSeconds = item.duree_audio_s;
    let elapsedAudioSeconds = 0;
    if (state.phase === 'audio-playing') {
      elapsedAudioSeconds = audioCurrentTime;
    } else if (state.phase === 'apres') {
      elapsedAudioSeconds = totalAudioSeconds;
    }
    // El contador y la barra de audio quedan siempre montados (nunca
    // condicionados por fase) para que las opciones de abajo no salten de
    // posición al aparecer/desaparecer estos elementos entre fases.
    const displayRemaining = (state.phase === 'audio-pending' || state.phase === 'audio-playing') ? 0 : remaining;
    body = (
      <div className="space-y-6">
        <p className="text-center text-blue-600 text-sm h-5">
          {state.phase === 'audio-pending' ? 'Preparando audio...' : ' '}
        </p>
        <div className="text-center text-3xl font-mono text-red-600">
          00:{displayRemaining.toString().padStart(2, '0')}
        </div>
        <div className="relative h-[10px] bg-gray-300 rounded overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-blue-500"
            style={{ width: `${totalAudioSeconds > 0 ? Math.min(100, (elapsedAudioSeconds / totalAudioSeconds) * 100) : 0}%` }}
          />
        </div>
        {questions.map((question, questionIndex) => (
          <div key={`${item.ref}-${questionIndex}`}>
            <h3 className="font-bold text-black mb-3">{question.prompt}</h3>
            <div className="space-y-1">
              {question.options.map(opt => {
                const selected = itemAnswers[questionIndex] === opt.id;
                return (
                  <label
                    key={opt.id}
                    className={`flex items-center gap-3 w-full text-left p-3 rounded cursor-pointer ${selected ? 'bg-gray-200' : 'hover:bg-gray-50'}`}
                  >
                    <input
                      type="radio"
                      name={`${item.ref}-q${questionIndex}`}
                      checked={selected}
                      onChange={() => handleAnswer(questionIndex, opt.id)}
                      className="h-6 w-6 shrink-0"
                    />
                    <span className="text-black">{opt.text}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">Drill Paraphrase</h2>
        <span className="text-sm text-gray-600">Ítem {state.itemIndex + 1}/{section.items.length} · {answeredCount}/{totalQuestions} respondidas</span>
      </div>
      {body}
      <div className="flex justify-end pt-4 border-t">
        <button onClick={handleAbandon} className="border border-red-600 text-red-600 px-5 py-2 rounded-full text-sm font-semibold hover:bg-red-50">
          Abandonar
        </button>
      </div>
    </div>
  );
};

export default DrillRunner;
