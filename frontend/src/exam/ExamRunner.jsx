import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, currentToken, computeResults } from './examMachine';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from './examTiming';

const TICK_MS = 250;
const WATCHDOG_GRACE_MS = 1000;

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const SELECT_SECTIONS = new Set(['interview', 'reportage']);

// Listbox propio en vez de <select> nativo: el texto de las opciones largas
// no envuelve de forma confiable dentro de un <option> en todos los
// navegadores, y necesitamos que las 2 preguntas de interview/reportage
// quepan visibles a la vez sin truncar ninguna respuesta.
const OptionSelect = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const selected = options.find(opt => opt.id === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full text-left border rounded px-3 py-2 bg-white"
      >
        {selected
          ? <span><span className="font-bold mr-2">{selected.id})</span>{selected.text}</span>
          : 'Elige una respuesta'}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full border rounded bg-white shadow-lg max-h-64 overflow-y-auto">
          {options.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className="block w-full text-left p-3 hover:bg-blue-50 whitespace-normal"
            >
              <span className="font-bold mr-2">{opt.id})</span>{opt.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ExamRunner = ({ set, audioElRef, audioUrls, onComplete, onAbandon }) => {
  const [state, dispatch] = useReducer((s, e) => reducer(set, s, e), undefined, createInitialState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const phaseTimingRef = useRef(null);
  const lastApresPhaseTimingRef = useRef(null);
  const watchdogRef = useRef(null);
  const firedRef = useRef(false);
  const [remaining, setRemaining] = useState(0);

  const section = set.sections[state.sectionIndex];
  const item = section?.items?.[state.itemIndex];

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Arranca/reancla el deadline de avant o apres al entrar a esa fase. Para
  // avant, si viene de un apres de la MISMA sección (avance normal
  // ítem-a-ítem), encadena desde el deadline teórico de ese apres en vez de
  // "ahora" -- así el tick que detectó el vencimiento (hasta TICK_MS tarde)
  // no filtra slop al ítem siguiente. Tras una transición de sección
  // (clic en Continuar) o en el primer ítem, arranca fresco desde "ahora".
  useEffect(() => {
    if (state.status !== 'running' || !section) return;
    if (state.phase === 'avant') {
      phaseTimingRef.current = lastApresPhaseTimingRef.current
        ? chainDeadline(lastApresPhaseTimingRef.current, section.timing.avant)
        : startPhase(section.timing.avant);
      lastApresPhaseTimingRef.current = null;
      setRemaining(remainingSeconds(phaseTimingRef.current));
    } else if (state.phase === 'apres') {
      // La fase apres arranca del instante REAL en que terminó el audio
      // (AUDIO_ENDED o el watchdog), no de una duración programada.
      phaseTimingRef.current = startPhase(section.timing.apres);
      setRemaining(remainingSeconds(phaseTimingRef.current));
    }
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status, section]);

  // Tick de las fases con reloj (avant / apres): nunca acumula drift dentro
  // de la fase, porque remainingSeconds siempre recalcula desde el deadline.
  useEffect(() => {
    if (state.status !== 'running') return;
    if (state.phase !== 'avant' && state.phase !== 'apres') return;

    const interval = setInterval(() => {
      const timing = phaseTimingRef.current;
      if (!timing) return;
      setRemaining(remainingSeconds(timing));
      if (isExpired(timing)) {
        if (state.phase === 'apres') lastApresPhaseTimingRef.current = timing;
        dispatch({ type: 'TIMER_EXPIRED', token: currentToken(stateRef.current) });
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status]);

  // Arranca la reproducción al entrar a audio-pending. Nunca asume que
  // play() tuvo éxito: solo dispara AUDIO_PLAYING cuando la promesa resuelve.
  useEffect(() => {
    if (state.phase !== 'audio-pending' || !item) return;
    const audioEl = audioElRef.current;
    const token = currentToken(state);
    audioEl.src = audioUrls.get(item.ref);
    audioEl.play().then(
      () => dispatch({ type: 'AUDIO_PLAYING', token }),
      () => dispatch({ type: 'AUDIO_FAILED', token }),
    );
  }, [state.phase, state.sectionIndex, state.itemIndex, audioElRef, audioUrls, item]);

  // Arma el watchdog solo tras confirmar reproducción real.
  useEffect(() => {
    if (state.phase !== 'audio-playing' || !item) return;
    const token = currentToken(state);
    watchdogRef.current = setTimeout(() => {
      dispatch({ type: 'TIMER_EXPIRED', token });
    }, item.duree_audio_s * 1000 + WATCHDOG_GRACE_MS);
    return clearWatchdog;
  }, [state.phase, state.sectionIndex, state.itemIndex, item, clearWatchdog]);

  // Escucha 'ended' del elemento de audio compartido durante toda la corrida.
  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onEnded = () => {
      if (stateRef.current.phase !== 'audio-playing') return;
      clearWatchdog();
      dispatch({ type: 'AUDIO_ENDED', token: currentToken(stateRef.current) });
    };
    audioEl.addEventListener('ended', onEnded);
    return () => audioEl.removeEventListener('ended', onEnded);
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
    if (!window.confirm('¿Seguro que quieres abandonar el examen? Se perderá todo el progreso.')) return;
    dispatch({ type: 'ABANDON' });
  };

  const handleSectionContinue = () => {
    lastApresPhaseTimingRef.current = null; // cruzar de sección siempre arranca fresco, no encadenado
    dispatch({ type: 'SECTION_CONTINUE' });
  };

  const handleRetryAudio = () => {
    dispatch({ type: 'RETRY_AUDIO', token: currentToken(state) });
  };

  if (state.status !== 'running') return null;

  if (state.phase === 'section-transition') {
    const nextSection = set.sections[state.sectionIndex + 1];
    return (
      <div className="space-y-4 text-center py-10">
        <h3 className="text-xl font-bold">Sección siguiente: {SECTION_LABELS[nextSection.type]}</h3>
        <p className="text-gray-600">{nextSection.items.length} ítems</p>
        <button onClick={handleSectionContinue} className="bg-blue-600 text-white px-6 py-2 rounded">
          Continuar
        </button>
      </div>
    );
  }

  if (state.phase === 'audio-failed') {
    return (
      <div className="space-y-4 text-center py-10">
        <p className="text-red-600">No se pudo reproducir el audio.</p>
        <button onClick={handleRetryAudio} className="bg-blue-600 text-white px-6 py-2 rounded">Reintentar</button>
        <button onClick={handleAbandon} className="block mx-auto text-sm text-gray-500 hover:underline">Abandonar</button>
      </div>
    );
  }

  if (!item) return null;

  const questions = item.questions;
  const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
  const useSelect = SELECT_SECTIONS.has(section.type);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{SECTION_LABELS[section.type]} · ítem {state.itemIndex + 1}/{section.items.length}</span>
        <button onClick={handleAbandon} className="text-red-600 hover:underline">Abandonar</button>
      </div>

      <div className="text-center text-4xl font-mono text-red-600">
        00:{remaining.toString().padStart(2, '0')}
      </div>

      {state.phase === 'audio-pending' && <p className="text-center text-blue-600">Preparando audio...</p>}
      {state.phase === 'audio-playing' && <p className="text-center text-blue-600">Escuchando...</p>}

      <div className="space-y-6">
        {questions.map((question, questionIndex) => (
          <div key={`${item.ref}-${questionIndex}`} className="border rounded p-4 space-y-2">
            <h3 className="font-bold">{question.prompt}</h3>
            {useSelect ? (
              <OptionSelect
                options={question.options}
                value={itemAnswers[questionIndex]}
                onChange={optionId => handleAnswer(questionIndex, optionId)}
              />
            ) : (
              question.options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleAnswer(questionIndex, opt.id)}
                  className={`w-full text-left p-3 border rounded hover:bg-blue-100 ${itemAnswers[questionIndex] === opt.id ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200' : ''}`}
                >
                  <span className="font-bold mr-2">{opt.id})</span>{opt.text}
                </button>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExamRunner;
