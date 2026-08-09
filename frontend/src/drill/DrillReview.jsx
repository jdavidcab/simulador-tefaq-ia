import React, { useEffect, useState } from 'react';
import { buildReviewModel } from '../exam/reviewModel';
import { buildHighlightSegments } from '../exam/highlightSegments';

const REFORMULATION_TYPE_LABELS = {
  nominalisation: 'Nominalización',
  synonyme: 'Sinónimo',
  restructuration: 'Reestructuración',
};

const TranscriptWithHighlight = ({ transcript, justification }) => {
  const segments = buildHighlightSegments(transcript, [{ questionIndex: 0, justification }]);
  const found = segments.some(s => s.questionIndexes.length > 0);
  return (
    <div className="bg-purple-50 border border-purple-200 rounded p-4 text-sm space-y-2">
      <p>
        {segments.map((segment, i) => (
          segment.questionIndexes.length > 0
            ? <span key={i} className="bg-yellow-200 rounded px-0.5">{segment.text}</span>
            : <span key={i}>{segment.text}</span>
        ))}
      </p>
      {!found && (
        <p className="text-xs text-gray-500 italic">
          Evidencia generada — no localizada literalmente en el transcript: «{justification}»
        </p>
      )}
    </div>
  );
};

const DrillReview = ({ set, answers, audioElRef, audioUrls, onExit }) => {
  const [expandedRefs, setExpandedRefs] = useState(() => new Set());
  const [playback, setPlayback] = useState({ activeRef: null, status: 'idle', error: null });

  const model = buildReviewModel(set, answers);
  // El drill tiene una sola "sección" (SET_DRILL_PARAPHRASE = ['drill_paraphrase']),
  // así que se aplana a una lista plana de 12 ítems -- no hace falta agrupar
  // por sección como en ExamReview.jsx.
  const items = model.sections.flatMap((section, sectionIndex) =>
    section.items.map((item, itemIndex) => ({ item, setItem: set.sections[sectionIndex].items[itemIndex] })));
  const correctTotal = model.sections.reduce((sum, s) => sum + s.correctCount, 0);
  const questionTotal = model.sections.reduce((sum, s) => sum + s.questionCount, 0);

  const stopPlayback = () => {
    const audioEl = audioElRef.current;
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    }
  };

  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onPlaying = () => setPlayback(prev => (prev.activeRef ? { ...prev, status: 'playing', error: null } : prev));
    const onEnded = () => setPlayback(prev => (prev.activeRef ? { ...prev, status: 'idle' } : prev));
    const onError = () => setPlayback(prev => (prev.activeRef
      ? { ...prev, status: 'error', error: 'No se pudo reproducir el audio' }
      : prev));
    audioEl.addEventListener('playing', onPlaying);
    audioEl.addEventListener('ended', onEnded);
    audioEl.addEventListener('error', onError);
    return () => {
      audioEl.removeEventListener('playing', onPlaying);
      audioEl.removeEventListener('ended', onEnded);
      audioEl.removeEventListener('error', onError);
      stopPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioElRef]);

  const handlePlay = (ref) => {
    const audioEl = audioElRef.current;
    const url = audioUrls.get(ref);
    if (!audioEl || !url) {
      setPlayback({ activeRef: ref, status: 'error', error: 'Audio no disponible' });
      return;
    }
    setPlayback({ activeRef: ref, status: 'idle', error: null });
    try {
      audioEl.src = url;
      audioEl.currentTime = 0;
    } catch {
      setPlayback(prev => (prev.activeRef === ref ? { activeRef: ref, status: 'error', error: 'No se pudo reproducir el audio' } : prev));
      return;
    }
    Promise.resolve(audioEl.play()).catch(() => {
      setPlayback(prev => (prev.activeRef === ref ? { activeRef: ref, status: 'error', error: 'No se pudo reproducir el audio' } : prev));
    });
  };

  const handleExit = () => {
    stopPlayback();
    onExit();
  };

  const toggleExpanded = (ref) => {
    setExpandedRefs(prev => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Revisión del drill</h2>
        <span className="font-semibold">{correctTotal}/{questionTotal} correctas</span>
      </div>

      <div className="space-y-2">
        {items.map(({ item, setItem }, itemIndex) => {
          const isExpanded = expandedRefs.has(item.ref);
          const isActive = playback.activeRef === item.ref;
          const buttonLabel = isActive && playback.status === 'playing' ? 'Reiniciar' : 'Reproducir';
          const question = item.questions[0];
          const setQuestion = setItem.questions[0];

          return (
            <div key={item.ref} className="border rounded">
              <button
                onClick={() => toggleExpanded(item.ref)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50"
              >
                <span>Ítem {itemIndex + 1}/{items.length}</span>
                <span className="font-semibold">{question.isCorrect ? 'Correcta' : 'Incorrecta'}</span>
              </button>
              {isExpanded && (
                <div className="p-4 border-t space-y-4">
                  <div className="flex items-center gap-3">
                    <button onClick={() => handlePlay(item.ref)} className="bg-blue-600 text-white px-4 py-2 rounded">
                      {buttonLabel}
                    </button>
                    {isActive && playback.status === 'error' && <span className="text-red-600 text-sm">{playback.error}</span>}
                  </div>

                  <TranscriptWithHighlight transcript={setItem.transcript} justification={setQuestion.justification} />

                  <div className="space-y-2 border-t pt-3">
                    <h4 className="font-semibold">{setQuestion.prompt}</h4>
                    {!question.answered && <p className="text-sm text-amber-700 font-semibold">Sin respuesta</p>}
                    <div className="space-y-1">
                      {setQuestion.options.map(opt => {
                        const isCorrectOpt = opt.id === question.correctId;
                        const isChosenOpt = opt.id === question.selectedId;
                        let stateLabel = null;
                        let className = 'p-2 border rounded';
                        if (isCorrectOpt && isChosenOpt) {
                          stateLabel = 'Tu respuesta — correcta';
                          className += ' border-green-400 bg-green-50';
                        } else if (isCorrectOpt) {
                          stateLabel = 'Respuesta correcta';
                          className += ' border-green-400 bg-green-50';
                        } else if (isChosenOpt) {
                          stateLabel = 'Tu respuesta — incorrecta';
                          className += ' border-red-400 bg-red-50';
                        }
                        return (
                          <div key={opt.id} className={className}>
                            {opt.text}
                            {stateLabel && <span className="ml-2 text-xs font-semibold">{stateLabel}</span>}
                          </div>
                        );
                      })}
                    </div>
                    {question.reformulation && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded p-3 text-sm space-y-1">
                        <p>
                          <span className="font-semibold">Lo que dice el audio:</span> «{question.reformulation.extrait_audio}»
                        </p>
                        <p>
                          <span className="font-semibold">
                            Respuesta correcta ({REFORMULATION_TYPE_LABELS[question.reformulation.type] ?? 'Reformulación'}):
                          </span> {question.reformulation.option_correcte}
                        </p>
                        {question.selectedLiteralTrap && (
                          <p className="text-amber-800 font-semibold">
                            Elegiste una opción que comparte palabras literales con el audio. Esto puede ser una trampa de
                            reconocimiento superficial — compara el sentido completo, no solo las palabras, con la respuesta correcta.
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-sm text-gray-700">{setQuestion.feedback}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={handleExit} className="w-full bg-gray-800 text-white py-2 rounded">
        Volver a la lista de drills
      </button>
    </div>
  );
};

export default DrillReview;
