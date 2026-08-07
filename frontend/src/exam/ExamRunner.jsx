import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, currentToken, computeResults } from './examMachine';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from './examTiming';
import { buildProgressTabs } from './examProgress';

const TICK_MS = 250;
const WATCHDOG_GRACE_MS = 1000;
const SECTION_INTRO_SECONDS = 15;

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const SECTION_INSTRUCTIONS = {
  annonce_publique: 'Vous allez entendre des annonces publiques. Écoutez chacune et répondez à la question.',
  repondeur: 'Vous allez entendre des messages de répondeur téléphonique. Écoutez chacun et répondez à la question.',
  micro_trottoir: 'Vous allez entendre un micro-trottoir : plusieurs personnes donnent leur opinion. Écoutez chacune et répondez à la question.',
  chronique: 'Vous allez entendre une chronique radiophonique. Écoutez-la attentivement et répondez aux questions.',
  interview: 'Vous allez entendre une interview. Écoutez-la attentivement et répondez aux questions.',
  reportage: 'Vous allez entendre un reportage. Écoutez-le attentivement et répondez aux questions.',
  divers: 'Vous allez entendre différents documents sonores. Écoutez chacun et répondez à la question.',
};

function formatSeconds(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
        {selected ? selected.text : 'Elige una respuesta'}
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
              {opt.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ProgressTabs = ({ tabs }) => (
  <div className="flex gap-1" aria-hidden="true">
    {tabs.map((tab, i) => (
      <div
        key={i}
        className={`h-2 flex-1 rounded-sm ${
          tab.status === 'completed' ? 'bg-blue-600'
            : tab.status === 'current' ? 'bg-blue-400'
              : 'bg-gray-200'
        }`}
      />
    ))}
  </div>
);

const ExamRunner = ({ set, audioElRef, audioUrls, onComplete, onAbandon }) => {
  const [state, dispatch] = useReducer((s, e) => reducer(set, s, e), undefined, createInitialState);
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
  const progressTabs = buildProgressTabs(set, state);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Arranca/reancla el deadline de section-intro, avant o apres al entrar a
  // esa fase. section-intro siempre arranca fresco desde "ahora" -- es un
  // límite natural entre secciones. avant, en cambio, siempre encadena desde
  // el deadline teórico de la fase anterior (el apres del ítem previo dentro
  // de la misma sección, o el section-intro si es el primer ítem de la
  // sección) en vez de "ahora", así el tick que detectó el vencimiento (hasta
  // TICK_MS tarde) no filtra slop al ítem siguiente.
  useEffect(() => {
    if (state.status !== 'running' || !section) return;
    if (state.phase === 'section-intro') {
      // Siempre arranca fresco: es un límite natural entre secciones, no se
      // encadena desde nada anterior.
      phaseTimingRef.current = startPhase(SECTION_INTRO_SECONDS);
      setRemaining(remainingSeconds(phaseTimingRef.current));
    } else if (state.phase === 'avant') {
      // Encadenar SIEMPRE desde el deadline teórico de la fase anterior
      // (apres del ítem previo, o section-intro si es el primer ítem de la
      // sección), nunca desde "ahora" -- así el tick que detectó el
      // vencimiento (hasta TICK_MS tarde, o mucho más si la pestaña estuvo en
      // background y el navegador throttleó el interval) nunca regala tiempo
      // extra. Si el deadline encadenado ya venció para cuando este efecto
      // corre, el próximo tick lo detecta como vencido de inmediato y avanza
      // -- ocultar la pestaña durante un examen estricto en lockstep no debe
      // generar una ventana de lectura nueva y completa, sería explotable. Si
      // algún día se decide que ocultar la pestaña debe PAUSAR el examen, eso
      // necesita ser una decisión de producto explícita y su propio mecanismo
      // (p.ej. visibilitychange), no un efecto secundario de esta aritmética.
      phaseTimingRef.current = lastPhaseTimingRef.current
        ? chainDeadline(lastPhaseTimingRef.current, section.timing.avant)
        : startPhase(section.timing.avant);
      lastPhaseTimingRef.current = null;
      setRemaining(remainingSeconds(phaseTimingRef.current));
    } else if (state.phase === 'apres') {
      // La fase apres arranca del instante REAL en que terminó el audio
      // (AUDIO_ENDED o el watchdog), no de una duración programada.
      phaseTimingRef.current = startPhase(section.timing.apres);
      setRemaining(remainingSeconds(phaseTimingRef.current));
    }
  }, [state.phase, state.sectionIndex, state.itemIndex, state.status, section]);

  // Tick de las fases con reloj (avant / apres / section-intro): nunca
  // acumula drift dentro de la fase, porque remainingSeconds siempre
  // recalcula desde el deadline.
  useEffect(() => {
    if (state.status !== 'running') return;
    if (state.phase !== 'avant' && state.phase !== 'apres' && state.phase !== 'section-intro') return;

    const interval = setInterval(() => {
      const timing = phaseTimingRef.current;
      if (!timing) return;
      setRemaining(remainingSeconds(timing));
      if (isExpired(timing)) {
        if (state.phase === 'apres' || state.phase === 'section-intro') lastPhaseTimingRef.current = timing;
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
    const url = audioUrls.get(item.ref);
    // No debería pasar dado el contrato de preload+compatibilidad, pero por
    // defensividad: sin ref o sin URL, no dejar que audioEl.src se stringifique
    // a "undefined" y falle con un error confuso tipo 404.
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
    if (!window.confirm('¿Seguro que quieres abandonar el examen? Se perderá todo el progreso.')) return;
    dispatch({ type: 'ABANDON' });
  };

  const handleRetryAudio = () => {
    dispatch({ type: 'RETRY_AUDIO', token: currentToken(state) });
  };

  if (state.status !== 'running') return null;

  if (state.phase === 'section-intro') {
    const introQuestionCount = section.items.reduce((n, i) => n + i.questions.length, 0);
    const introHasMultipleQuestions = section.items[0]?.questions.length > 1;
    return (
      <div className="space-y-4 text-center py-10">
        <ProgressTabs tabs={progressTabs} />
        <h3 className="text-xl font-bold">{SECTION_LABELS[section.type]}</h3>
        <p className="text-gray-600">{introQuestionCount} preguntas</p>
        <p className="text-blue-800 font-semibold max-w-lg mx-auto px-4">{SECTION_INSTRUCTIONS[section.type]}</p>
        <p className="text-red-600 font-semibold max-w-lg mx-auto px-4">
          Vous avez {section.timing.avant} secondes avant et {section.timing.apres} secondes après chaque document sonore pour lire et répondre {introHasMultipleQuestions ? 'aux questions' : 'à la question'}.
        </p>
        <div className="text-center text-4xl font-mono text-red-600">
          00:{remaining.toString().padStart(2, '0')}
        </div>
        <button onClick={handleAbandon} className="block mx-auto text-sm text-gray-500 hover:underline">Abandonar</button>
      </div>
    );
  }

  if (state.phase === 'audio-failed') {
    return (
      <div className="space-y-4 text-center py-10">
        <ProgressTabs tabs={progressTabs} />
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
      <ProgressTabs tabs={progressTabs} />
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{SECTION_LABELS[section.type]} · ítem {state.itemIndex + 1}/{section.items.length}</span>
        <button onClick={handleAbandon} className="text-red-600 hover:underline">Abandonar</button>
      </div>

      {(state.phase === 'avant' || state.phase === 'apres') && (
        <div className="text-center text-4xl font-mono text-red-600">
          00:{remaining.toString().padStart(2, '0')}
        </div>
      )}

      {state.phase === 'audio-pending' && <p className="text-center text-blue-600">Preparando audio...</p>}
      {state.phase === 'audio-playing' && <p className="text-center text-blue-600">Escuchando...</p>}

      {(state.phase === 'audio-pending' || state.phase === 'audio-playing') && (
        <div className="max-w-md mx-auto space-y-1">
          <div className="h-2 bg-gray-300 rounded overflow-hidden">
            <div
              className="h-full bg-gray-600"
              style={{ width: `${item.duree_audio_s > 0 ? Math.min(100, (audioCurrentTime / item.duree_audio_s) * 100) : 0}%` }}
            />
          </div>
          <p className="text-center text-xs text-gray-500">
            {formatSeconds(audioCurrentTime)} / {formatSeconds(item.duree_audio_s)}
          </p>
        </div>
      )}

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
              question.options.map(opt => {
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
                      className="h-4 w-4 shrink-0"
                    />
                    <span>{opt.text}</span>
                  </label>
                );
              })
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExamRunner;
