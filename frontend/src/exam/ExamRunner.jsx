import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createInitialState, reducer, currentToken, computeResults, countAnswered } from './examMachine';
import { startPhase, remainingSeconds, isExpired, chainDeadline } from './examTiming';
import { buildProgressTabs, buildSectionTabs } from './examProgress';
import lfaLogo from '../assets/le-francais-des-affaires-logo.png';
import cciLogo from '../assets/cci-paris-logo.jpg';

const TICK_MS = 250;
const WATCHDOG_GRACE_MS = 1000;
const SECTION_INTRO_SECONDS = 15;

const SECTION_LABELS = {
  annonce_publique: 'Annonces publiques',
  repondeur: 'Répondeur',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Chronique',
  interview: 'Interview',
  reportage: 'Reportage',
  divers: 'Divers',
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
        {selected ? selected.text : 'Choisissez une réponse'}
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
  <div className="flex gap-0.5" aria-hidden="true">
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

const Header = () => (
  <div className="flex items-center justify-between px-8 py-5 border-b-[3px] border-red-600">
    <div className="flex items-center gap-3">
      <img src={lfaLogo} alt="Le Français des Affaires" className="h-10" />
      <img src={cciLogo} alt="CCI Paris Île-de-France Education" className="h-10" />
    </div>
    <div className="text-right leading-tight">
      <div className="font-bold text-blue-900 text-sm">Candidat(e)</div>
      <div className="text-blue-900 text-xs">Simulateur TEFAQ</div>
    </div>
  </div>
);

const AnsweredCounter = ({ answered, total }) => (
  <div className="flex justify-end items-center gap-2.5 px-8 pt-2">
    <span className="text-sm text-gray-700">{answered}/{total}</span>
    <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div className="h-full bg-gray-400" style={{ width: `${total > 0 ? (answered / total) * 100 : 0}%` }} />
    </div>
  </div>
);

const SectionTabs = ({ tabs, countdown }) => (
  <div className="flex items-center border-b border-gray-200 mt-3.5">
    <div className="flex overflow-x-auto flex-1" aria-hidden="true">
      {tabs.map(tab => (
        <div
          key={tab.globalNumber}
          className={`shrink-0 whitespace-nowrap px-5 py-3 text-sm font-semibold ${tab.status === 'current' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}
        >
          Écran {tab.globalNumber}
        </div>
      ))}
    </div>
    {countdown != null && (
      <div className="shrink-0 px-5 text-sm font-mono font-semibold text-red-600">
        00:{countdown.toString().padStart(2, '0')}
      </div>
    )}
  </div>
);

const Footer = ({ tabs, onAbandon }) => (
  <div className="px-8 py-4 border-t border-gray-100">
    <div className="mb-4">
      <ProgressTabs tabs={tabs} />
    </div>
    <div className="flex justify-end">
      <button onClick={onAbandon} className="border border-red-600 text-red-600 px-5 py-2 rounded-full text-sm font-semibold hover:bg-red-50">
        Abandonner
      </button>
    </div>
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
  const sectionTabs = buildSectionTabs(set, state);
  const answeredCount = countAnswered(state.answers);
  const totalQuestions = set.sections.reduce((sum, s) => sum + s.items.reduce((n, i) => n + i.questions.length, 0), 0);

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
    if (!window.confirm("Voulez-vous vraiment abandonner l'examen ? Toute votre progression sera perdue.")) return;
    dispatch({ type: 'ABANDON' });
  };

  const handleRetryAudio = () => {
    dispatch({ type: 'RETRY_AUDIO', token: currentToken(state) });
  };

  if (state.status !== 'running') return null;

  let body;
  if (state.phase === 'section-intro') {
    const introQuestionCount = section.items.reduce((n, i) => n + i.questions.length, 0);
    const introHasMultipleQuestions = section.items[0]?.questions.length > 1;
    body = (
      <div className="space-y-4 text-center py-10">
        <h3 className="text-xl font-bold">{SECTION_LABELS[section.type]}</h3>
        <p className="text-gray-600">{introQuestionCount} questions</p>
        <p className="text-blue-800 font-semibold max-w-lg mx-auto px-4">{SECTION_INSTRUCTIONS[section.type]}</p>
        <p className="text-red-600 font-semibold max-w-lg mx-auto px-4">
          Vous avez {section.timing.avant} secondes avant et {section.timing.apres} secondes après chaque document sonore pour lire et répondre {introHasMultipleQuestions ? 'aux questions' : 'à la question'}.
        </p>
        <div className="text-center text-4xl font-mono text-red-600">
          00:{remaining.toString().padStart(2, '0')}
        </div>
      </div>
    );
  } else if (state.phase === 'audio-failed') {
    body = (
      <div className="space-y-4 text-center py-10">
        <p className="text-red-600">Impossible de lire l'audio.</p>
        <button onClick={handleRetryAudio} className="bg-blue-600 text-white px-6 py-2 rounded">Réessayer</button>
      </div>
    );
  } else if (!item) {
    return null;
  } else {
    const questions = item.questions;
    const itemAnswers = state.answers[section.type]?.[item.ref] ?? {};
    const useSelect = SELECT_SECTIONS.has(section.type);
    const totalBarSeconds = section.timing.avant + item.duree_audio_s;
    let elapsedBarSeconds = 0;
    if (state.phase === 'avant') {
      elapsedBarSeconds = Math.min(section.timing.avant, Math.max(0, section.timing.avant - remaining));
    } else if (state.phase === 'audio-pending') {
      elapsedBarSeconds = section.timing.avant;
    } else if (state.phase === 'audio-playing') {
      elapsedBarSeconds = section.timing.avant + audioCurrentTime;
    } else if (state.phase === 'apres') {
      elapsedBarSeconds = totalBarSeconds;
    }
    body = (
      <div className="space-y-4">
        <table className="w-full border-collapse table-fixed">
          <tbody>
            <tr>
              <td className="w-[300px] align-top py-2 pr-6">
                {state.phase === 'audio-pending' && <p className="text-center text-blue-600 mb-2 text-sm">Préparation de l'audio...</p>}
                <div className="relative h-[22px] bg-gray-400 rounded overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gray-500"
                    style={{ width: `${totalBarSeconds > 0 ? Math.min(100, (elapsedBarSeconds / totalBarSeconds) * 100) : 0}%` }}
                  />
                  <div className="absolute inset-y-0 left-0 w-5 bg-gray-700 flex items-center justify-center text-white text-[9px]">
                    &#9654;
                  </div>
                  <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-mono text-gray-50">
                    {formatSeconds(elapsedBarSeconds)} / {formatSeconds(totalBarSeconds)}
                  </span>
                </div>
              </td>
              <td className="align-top py-2">
                <div className="space-y-6">
                  {questions.map((question, questionIndex) => (
                    <div key={`${item.ref}-${questionIndex}`}>
                      <h3 className="font-bold text-black mb-3">{question.prompt}</h3>
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
                              <span className="text-black">{opt.text}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <Header />
      <AnsweredCounter answered={answeredCount} total={totalQuestions} />
      <SectionTabs tabs={sectionTabs.sectionTabs} countdown={state.phase === 'apres' ? remaining : null} />
      <p className="mx-10 mt-4 text-xs tracking-wider uppercase text-gray-400 font-semibold">Écran {sectionTabs.globalIndex}</p>
      <div className="mx-10 mt-2 mb-4 border-b border-gray-100" />
      <div className="px-10 pb-2">{body}</div>
      <Footer tabs={progressTabs} onAbandon={handleAbandon} />
    </div>
  );
};

export default ExamRunner;
