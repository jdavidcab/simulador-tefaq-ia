import React, { useEffect, useState } from 'react';
import { buildReviewModel } from './reviewModel';
import { buildHighlightSegments } from './highlightSegments';

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const HIGHLIGHT_COLORS = ['bg-yellow-200', 'bg-sky-200', 'bg-pink-200'];

const TranscriptWithHighlights = ({ transcript, questions }) => {
  const questionJustifications = questions.map((q, questionIndex) => ({
    questionIndex,
    justification: q.justification,
  }));
  const segments = buildHighlightSegments(transcript, questionJustifications);
  const foundIndexes = new Set(segments.flatMap(s => s.questionIndexes));

  return (
    <div className="bg-purple-50 border border-purple-200 rounded p-4 text-sm space-y-2">
      <p>
        {segments.map((segment, i) => {
          if (segment.questionIndexes.length === 0) return <span key={i}>{segment.text}</span>;
          const colorClass = HIGHLIGHT_COLORS[segment.questionIndexes[0] % HIGHLIGHT_COLORS.length];
          return (
            <span key={i} className={`${colorClass} rounded px-0.5`}>
              {segment.text}
            </span>
          );
        })}
      </p>
      {questions.map((q, questionIndex) => (
        !foundIndexes.has(questionIndex) && (
          <p key={questionIndex} className="text-xs text-gray-500 italic">
            Evidencia generada — no localizada literalmente en el transcript: «{q.justification}»
          </p>
        )
      ))}
    </div>
  );
};

const ExamReview = ({ set, answers, audioElRef, audioUrls, onBackToSummary, onExit }) => {
  const [expandedRefs, setExpandedRefs] = useState(() => new Set());
  const [playback, setPlayback] = useState({ activeRef: null, status: 'idle', error: null });

  const model = buildReviewModel(set, answers);

  const stopPlayback = () => {
    const audioEl = audioElRef.current;
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    }
  };

  // Escucha los eventos reales del elemento compartido durante toda la vida
  // de ExamReview -- nunca asume que play() tuvo éxito ni que el estado
  // sigue siendo válido sin confirmación del propio elemento.
  useEffect(() => {
    const audioEl = audioElRef.current;
    if (!audioEl) return undefined;
    const onPlaying = () => setPlayback(prev => ({ ...prev, status: 'playing', error: null }));
    const onEnded = () => setPlayback(prev => ({ ...prev, status: 'idle' }));
    const onError = () => setPlayback(prev => ({ ...prev, status: 'error' }));
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
    audioEl.src = url;
    audioEl.currentTime = 0;
    Promise.resolve(audioEl.play()).catch(() => {
      setPlayback({ activeRef: ref, status: 'error', error: 'No se pudo reproducir el audio' });
    });
  };

  const handleBack = () => {
    stopPlayback();
    onBackToSummary();
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Revisión detallada</h2>
        <button onClick={handleBack} className="text-blue-600 hover:underline text-sm">
          Volver al resumen
        </button>
      </div>

      {model.sections.map((section, sectionIndex) => (
        <div key={section.type} className="space-y-2">
          <h3 className="font-bold text-lg">
            {SECTION_LABELS[section.type]} — {section.correctCount}/{section.questionCount} correctas
          </h3>
          {section.items.map((item, itemIndex) => {
            const setItem = set.sections[sectionIndex].items[itemIndex];
            const isExpanded = expandedRefs.has(item.ref);
            const isActive = playback.activeRef === item.ref;
            const buttonLabel = isActive && playback.status === 'playing' ? 'Reiniciar' : 'Reproducir';

            return (
              <div key={item.ref} className="border rounded">
                <button
                  onClick={() => toggleExpanded(item.ref)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50"
                >
                  <span>Audio {itemIndex + 1}/{section.items.length}</span>
                  <span className="font-semibold">{item.correctCount}/{item.questionCount} correctas</span>
                </button>
                {isExpanded && (
                  <div className="p-4 border-t space-y-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handlePlay(item.ref)}
                        className="bg-blue-600 text-white px-4 py-2 rounded"
                      >
                        {buttonLabel}
                      </button>
                      {isActive && playback.status === 'error' && (
                        <span className="text-red-600 text-sm">{playback.error}</span>
                      )}
                    </div>

                    <TranscriptWithHighlights transcript={setItem.transcript} questions={setItem.questions} />

                    {item.questions.map((question, questionIndex) => {
                      const setQuestion = setItem.questions[questionIndex];
                      return (
                        <div key={questionIndex} className="space-y-2 border-t pt-3">
                          <h4 className="font-semibold">{setQuestion.prompt}</h4>
                          {!question.answered && (
                            <p className="text-sm text-amber-700 font-semibold">Sin respuesta</p>
                          )}
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
                                  <span className="font-bold mr-2">{opt.id})</span>
                                  {opt.text}
                                  {stateLabel && (
                                    <span className="ml-2 text-xs font-semibold">{stateLabel}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-sm text-gray-700">{setQuestion.feedback}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <button onClick={handleExit} className="w-full bg-gray-800 text-white py-2 rounded">
        Volver a la lista de sets
      </button>
    </div>
  );
};

export default ExamReview;
