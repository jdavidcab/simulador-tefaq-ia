import React, { useState, useEffect, useRef } from 'react';
import { buildTrainingView, getHighlightedChunks } from './trainingScan';

const WORD_RANGE_PRESETS = [
  { label: '30-50', min: 30, max: 50 },
  { label: '50-70', min: 50, max: 70 },
  { label: '70-90', min: 70, max: 90 },
];

const AUDIO_END_BUFFER_SECONDS = 2;

const TrainingMode = () => {
  const [config, setConfig] = useState({
    scanTime: 10,
    answerTime: 10,
    wordsPerMinute: 150,
    minWords: 30,
    maxWords: 50,
    difficulty: 'B2',
    verbNounScan: false,
    verticalScan: false,
    practiceMode: 'full',
  });
  const [phase, setPhase] = useState('idle'); // idle, loading, scanPractice, scanning, reading, answering, feedback
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [scanPracticeRevealed, setScanPracticeRevealed] = useState(false);
  const [showScanTechniqueModal, setShowScanTechniqueModal] = useState(false);
  const [scanTechniqueDraft, setScanTechniqueDraft] = useState({ verbNounScan: false, verticalScan: false });
  const [stats, setStats] = useState({ correct: 0, total: 0 });
  const [selectedProvider, setSelectedProvider] = useState('auto');
  const [provider, setProvider] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showFeedbackOptions, setShowFeedbackOptions] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioRate, setAudioRate] = useState(1);
  const [audioDuration, setAudioDuration] = useState(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const audioLoadingRef = useRef(false);
  const audioRequestIdRef = useRef(0);
  const audioAdvanceTimeoutRef = useRef(null);
  const questionPrefetchKeyRef = useRef(null);

  const buildQuestionParams = () => new URLSearchParams({
    provider: selectedProvider,
    minWords: String(config.minWords),
    maxWords: String(config.maxWords),
    difficulty: config.difficulty,
    verticalScan: String(config.verticalScan),
    warmAudio: String(config.practiceMode !== 'scan'),
  });

  const getEstimatedReadingTime = () => {
    const words = currentQuestion?.transcript?.split(' ').filter(Boolean).length ?? 0;
    return Math.ceil((words / config.wordsPerMinute) * 60);
  };

  const getAudioRemainingTime = () => {
    if (!audioRef.current || !Number.isFinite(audioRef.current.duration)) return null;
    const rate = audioRef.current.playbackRate || audioRate || 1;
    const remainingSeconds = Math.ceil((audioRef.current.duration - audioRef.current.currentTime) / rate);
    return Math.max(0, remainingSeconds);
  };

  const clearAudioAdvanceTimeout = () => {
    if (audioAdvanceTimeoutRef.current) {
      clearTimeout(audioAdvanceTimeoutRef.current);
      audioAdvanceTimeoutRef.current = null;
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setAudioPlaying(false);
  };

  const replaceAudioUrl = (nextUrl) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
  };

  const clearAudio = () => {
    audioRequestIdRef.current += 1;
    clearAudioAdvanceTimeout();
    stopAudio();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioUrl(null);
    audioLoadingRef.current = false;
    setAudioLoading(false);
    setAudioError(null);
    setAudioDuration(null);
  };

  const prefetchAudio = async (transcript) => {
    if (audioUrlRef.current || audioLoadingRef.current) return;
    const requestId = ++audioRequestIdRef.current;
    audioLoadingRef.current = true;
    setAudioLoading(true);
    setAudioError(null);

    try {
      const res = await fetch('http://localhost:3001/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const audioBlob = await res.blob();
      if (requestId !== audioRequestIdRef.current) return;
      replaceAudioUrl(URL.createObjectURL(audioBlob));
    } catch (error) {
      if (requestId !== audioRequestIdRef.current) return;
      console.error('Error fetching audio:', error);
      setAudioError('No se pudo generar el audio del anuncio.');
    } finally {
      if (requestId === audioRequestIdRef.current) {
        audioLoadingRef.current = false;
        setAudioLoading(false);
      }
    }
  };

  const prefetchNextQuestion = async () => {
    try {
      await fetch(`http://localhost:3001/api/prefetch-question?${buildQuestionParams().toString()}`, {
        method: 'POST',
      });
    } catch (error) {
      console.warn('No se pudo precargar la siguiente pregunta:', error);
    }
  };

  // Liberar el blob de audio al desmontar
  useEffect(() => {
    return () => {
      clearAudioAdvanceTimeout();
      if (audioRef.current) audioRef.current.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  // Detener el audio al salir de la fase de escucha
  useEffect(() => {
    if (phase !== 'reading') {
      clearAudioAdvanceTimeout();
      stopAudio();
    }
  }, [phase]);

  // Mantener la velocidad seleccionada en el elemento <audio>
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = audioRate;
  }, [audioRate]);

  // Si el audio real dura más que la estimación, extender la fase de escucha
  useEffect(() => {
    if (phase !== 'reading') return;
    const remainingAudioTime = getAudioRemainingTime();
    if (remainingAudioTime == null) return;
    setTimeLeft(prev => Math.max(prev, remainingAudioTime + AUDIO_END_BUFFER_SECONDS));
  }, [phase, audioDuration, audioRate]);

  // Reproducir automáticamente apenas el audio esté listo en la fase de escucha
  useEffect(() => {
    if (phase === 'reading' && audioUrl && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.playbackRate = audioRate;
      audioRef.current.play().catch(() => {
        setAudioPlaying(false);
      });
    }
  }, [phase, audioUrl]);

  useEffect(() => {
    if (!currentQuestion || !['scanPractice', 'scanning', 'reading', 'answering'].includes(phase)) return;
    const prefetchKey = `${currentQuestion.prompt}:${currentQuestion.transcript}:${buildQuestionParams().toString()}`;
    if (questionPrefetchKeyRef.current === prefetchKey) return;
    questionPrefetchKeyRef.current = prefetchKey;
    prefetchNextQuestion();
  }, [currentQuestion, phase, selectedProvider, config.minWords, config.maxWords, config.difficulty, config.verticalScan, config.practiceMode]);

  useEffect(() => {
    if (timeLeft <= 0 && phase !== 'idle' && phase !== 'feedback' && phase !== 'loading') {
      handleTimeUp();
      return;
    }
    if (!showScanTechniqueModal && (phase === 'scanPractice' || phase === 'scanning' || phase === 'reading' || phase === 'answering')) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [timeLeft, phase, showScanTechniqueModal]);

  const handleTimeUp = () => {
    if (phase === 'scanning') {
      const estimatedReadingTime = getEstimatedReadingTime();
      const audioReadingTime = audioDuration != null ? Math.ceil(audioDuration / audioRate) + AUDIO_END_BUFFER_SECONDS : 0;
      const readingTime = Math.max(estimatedReadingTime, audioReadingTime);
      setPhase('reading');
      setTimeLeft(readingTime);
    } else if (phase === 'reading') {
      const remainingAudioTime = getAudioRemainingTime();
      if (remainingAudioTime != null && remainingAudioTime > 0) {
        setTimeLeft(remainingAudioTime + AUDIO_END_BUFFER_SECONDS);
        return;
      }
      continueToAnswering();
    } else if (phase === 'answering') {
      setStats(prev => ({
        total: prev.total + 1,
        correct: prev.correct + (selectedAnswer === currentQuestion?.correctId ? 1 : 0),
      }));
      setPhase('feedback');
    } else if (phase === 'scanPractice') {
      setTimeLeft(0);
    }
  };

  const fetchQuestion = async () => {
    clearAudio();
    setPhase('loading');
    try {
      const params = buildQuestionParams();
      const res = await fetch(`http://localhost:3001/api/generate-question?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCurrentQuestion(data);
      setProvider(data.provider ?? null);
      setSelectedAnswer(null);
      setShowTranscript(false);
      setShowFeedbackOptions(false);
      setScanPracticeRevealed(false);
      if (config.practiceMode === 'scan') {
        setPhase('scanPractice');
      } else {
        prefetchAudio(data.transcript);
        setPhase('scanning');
      }
      setTimeLeft(config.scanTime);
    } catch (error) {
      console.error("Error fetching question:", error);
      alert("Error al generar la pregunta. Revisa que el backend esté corriendo y las API keys configuradas.");
      setPhase('idle');
    }
  };

  const handleAnswer = (id) => {
    setSelectedAnswer(id);
  };

  const resetStats = () => setStats({ correct: 0, total: 0 });

  const restartQuestion = () => {
    setSelectedAnswer(null);
    setShowTranscript(false);
    setShowFeedbackOptions(false);
    setScanPracticeRevealed(false);
    stopAudio();
    setPhase(config.practiceMode === 'scan' ? 'scanPractice' : 'scanning');
    setTimeLeft(config.scanTime);
  };

  const updateConfig = (key, value) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    setConfig(prev => {
      const next = { ...prev, [key]: Math.max(1, parsed) };
      if (key === 'minWords' && next.minWords > next.maxWords) next.maxWords = next.minWords;
      if (key === 'maxWords' && next.maxWords < next.minWords) next.minWords = next.maxWords;
      return next;
    });
  };

  const toggleConfig = (key) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const applyWordRangePreset = ({ min, max }) => {
    setConfig(prev => ({ ...prev, minWords: min, maxWords: max }));
  };

  const playAudio = (restart = false) => {
    if (!audioRef.current || !audioUrl) return;
    if (restart) audioRef.current.currentTime = 0;
    audioRef.current.playbackRate = audioRate;
    audioRef.current.play().catch(() => {
      setAudioPlaying(false);
    });
  };

  const continueToAnswering = () => {
    clearAudioAdvanceTimeout();
    stopAudio();
    setPhase('answering');
    setTimeLeft(config.answerTime);
  };

  const scheduleAnsweringAfterAudio = () => {
    setAudioPlaying(false);
    if (phase !== 'reading') return;
    clearAudioAdvanceTimeout();
    setTimeLeft(AUDIO_END_BUFFER_SECONDS);
  };

  const openScanTechniqueModal = () => {
    setScanTechniqueDraft({
      verbNounScan: config.verbNounScan,
      verticalScan: config.verticalScan,
    });
    setShowScanTechniqueModal(true);
  };

  const retryScanPractice = () => {
    setConfig(prev => ({
      ...prev,
      verbNounScan: scanTechniqueDraft.verbNounScan,
      verticalScan: scanTechniqueDraft.verticalScan,
    }));
    setScanPracticeRevealed(false);
    setShowScanTechniqueModal(false);
    setTimeLeft(config.scanTime);
  };

  const continueScanPracticeToFull = () => {
    if (!currentQuestion) return;
    setScanPracticeRevealed(false);
    prefetchAudio(currentQuestion.transcript);
    setPhase('reading');
    setTimeLeft(getEstimatedReadingTime());
  };

  const trainingView = currentQuestion ? buildTrainingView(currentQuestion.options, config) : null;
  const hideScanPracticeContent = phase === 'scanPractice' && timeLeft <= 0 && !scanPracticeRevealed;

  const renderOptionContent = (option) => {
    const scannedOption = trainingView?.options.find(item => item.id === option.id);
    const showTraining = config.verbNounScan || (config.verticalScan && trainingView?.verticalApplies);
    const chunks = showTraining && scannedOption ? getHighlightedChunks(option.text, scannedOption, trainingView) : null;

    return (
      <>
        <span className="font-bold mr-2">{option.id})</span>
        {showTraining && chunks ? (
          <span>
            {chunks.map((chunk, index) => {
              if (!chunk.isWord) return <span key={index}>{chunk.text}</span>;

              const highlightedClass = chunk.isKeyword
                ? 'bg-blue-100 text-blue-900 rounded px-1 py-0.5'
                : chunk.isCommonPrefix
                  ? 'text-gray-400'
                  : trainingView?.verticalApplies
                    ? 'font-semibold text-amber-800'
                    : '';

              return highlightedClass
                ? <span key={index} className={highlightedClass}>{chunk.text}</span>
                : <span key={index}>{chunk.text}</span>;
            })}
          </span>
        ) : (
          <span>{option.text}</span>
        )}
      </>
    );
  };

  const renderQuestionOptions = (helperText) => (
    <div className="space-y-3">
      <h3 className="text-xl font-bold">{currentQuestion.prompt}</h3>
      {currentQuestion.options.map(opt => (
        <button
          key={opt.id}
          onClick={() => handleAnswer(opt.id)}
          className={`w-full text-left p-3 border rounded hover:bg-blue-100 ${selectedAnswer === opt.id ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200' : ''}`}
        >
          {renderOptionContent(opt)}
        </button>
      ))}
      {selectedAnswer && (
        <p className="text-sm text-blue-700">Respuesta seleccionada: {selectedAnswer}. {helperText}</p>
      )}
    </div>
  );

  const showScanLegend = config.verbNounScan || config.verticalScan;

  return (
    <div className="p-6 max-w-2xl mx-auto mt-10 bg-white rounded-xl shadow-md space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">Simulador TEFAQ {config.difficulty}</h2>

      <div className="flex items-center justify-between bg-gray-50 border rounded-lg px-4 py-2 text-sm">
        <span className="font-semibold text-gray-700">
          Correctas: <span className="text-green-600">{stats.correct}</span> / {stats.total}
          {stats.total > 0 && ` (${Math.round((stats.correct / stats.total) * 100)}%)`}
        </span>
        <button
          onClick={resetStats}
          disabled={stats.total === 0}
          className="text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          Restablecer
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gray-50 border rounded-lg px-4 py-2 text-sm">
        <label className="flex items-center gap-2 text-gray-700">
          <span className="font-semibold">Modelo:</span>
          <select
            value={selectedProvider}
            onChange={e => setSelectedProvider(e.target.value)}
            className="border rounded px-2 py-1 bg-white text-gray-700"
          >
            <option value="auto">Automático</option>
            <option value="gemini">Gemini 3.5 Flash</option>
            <option value="deepseek">DeepSeek V4 Flash</option>
            <option value="mimo">MiMo V2.5</option>
            <option value="mimoPro">MiMo V2.5 Pro</option>
          </select>
        </label>
        {provider && (
          <span className="self-start sm:self-auto text-xs bg-gray-200 text-gray-600 rounded px-2 py-1">
            via {provider}
          </span>
        )}
      </div>

      {phase === 'idle' && (
        <div className="space-y-4 border p-4 rounded-lg bg-gray-50">
          <h3 className="font-semibold">Configuración</h3>
          <label className="space-y-1 text-sm text-gray-700 block">
            <span className="block font-medium">Modo de práctica</span>
            <select
              value={config.practiceMode}
              onChange={e => setConfig(prev => ({ ...prev, practiceMode: e.target.value }))}
              className="w-full rounded border px-3 py-2 bg-white"
            >
              <option value="full">Simulación completa</option>
              <option value="scan">Solo lectura rápida</option>
            </select>
          </label>
          <label className="space-y-1 text-sm text-gray-700 block">
            <span className="block font-medium">Dificultad</span>
            <select
              value={config.difficulty}
              onChange={e => setConfig(prev => ({ ...prev, difficulty: e.target.value }))}
              className="w-full rounded border px-3 py-2 bg-white"
            >
              <option value="B1">B1 - directo</option>
              <option value="B2">B2 - TEFAQ actual</option>
              <option value="C1">C1 - distractores sutiles</option>
            </select>
            <span className="block text-xs text-gray-500">Ajusta vocabulario, complejidad del audio y sutileza de distractores.</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-gray-700">
              <span className="block font-medium">Segundos para leer opciones</span>
              <input
                type="number"
                min="1"
                value={config.scanTime}
                onChange={e => updateConfig('scanTime', e.target.value)}
                className="w-full rounded border px-3 py-2 bg-white"
              />
            </label>
            <label className="space-y-1 text-sm text-gray-700">
              <span className="block font-medium">Segundos para responder</span>
              <input
                type="number"
                min="1"
                value={config.answerTime}
                onChange={e => updateConfig('answerTime', e.target.value)}
                className="w-full rounded border px-3 py-2 bg-white"
              />
            </label>
          </div>
          <div className="space-y-3 rounded-lg border bg-white p-4">
            <div className="space-y-1">
              <span className="block text-sm font-medium text-gray-700">Técnicas de escaneo</span>
              <p className="text-xs text-gray-500">Estas ayudas visuales se mostrarán en scanning y answering.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-3 rounded border px-3 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={config.verbNounScan}
                  onChange={() => toggleConfig('verbNounScan')}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">Verbo + Sustantivo</span>
                  <span className="text-xs text-gray-500">Reduce cada opción a palabras clave de contenido.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded border px-3 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={config.verticalScan}
                  onChange={() => toggleConfig('verticalScan')}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">Escaneo vertical</span>
                  <span className="text-xs text-gray-500">Destaca solo la diferencia entre opciones cuando comparten un inicio.</span>
                </span>
              </label>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border bg-white p-4">
            <div className="space-y-1">
              <span className="block text-sm font-medium text-gray-700">Largo del anuncio</span>
              <p className="text-xs text-gray-500">Elige un preset o ajusta un rango personalizado.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {WORD_RANGE_PRESETS.map(preset => {
                const isActive = config.minWords === preset.min && config.maxWords === preset.max;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyWordRangePreset(preset)}
                    className={`rounded border px-3 py-2 text-sm ${isActive ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    {preset.label} palabras
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm text-gray-700">
                <span className="block font-medium">Mínimo de palabras</span>
                <input
                  type="number"
                  min="1"
                  value={config.minWords}
                  onChange={e => updateConfig('minWords', e.target.value)}
                  className="w-full rounded border px-3 py-2 bg-white"
                />
              </label>
              <label className="space-y-1 text-sm text-gray-700">
                <span className="block font-medium">Máximo de palabras</span>
                <input
                  type="number"
                  min="1"
                  value={config.maxWords}
                  onChange={e => updateConfig('maxWords', e.target.value)}
                  className="w-full rounded border px-3 py-2 bg-white"
                />
              </label>
            </div>
          </div>
          <button onClick={fetchQuestion} className="w-full bg-blue-600 text-white py-2 rounded">Generar Pregunta con IA</button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="text-center py-10 animate-pulse text-blue-600 font-semibold">
          El agente de IA está redactando un escenario en Quebec...
        </div>
      )}

      {(phase === 'scanPractice' || phase === 'scanning' || phase === 'reading' || phase === 'answering') && (
        <div className="text-center text-4xl font-mono text-red-600 mb-4">
          00:{timeLeft.toString().padStart(2, '0')}
        </div>
      )}

      {showScanLegend && (phase === 'scanPractice' || phase === 'scanning' || phase === 'answering') && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-600">
          {config.verbNounScan && (
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
              Palabras clave
            </span>
          )}
          {config.verticalScan && (
            <>
              <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
                Base común
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                Diferencia clave
              </span>
            </>
          )}
        </div>
      )}

      {phase === 'scanPractice' && currentQuestion && (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="text-lg font-bold text-blue-900">Práctica de lectura rápida</h3>
            <p className="text-sm text-blue-800">Entrena el escaneo de la pregunta y las opciones. No se generará audio ni se contará score hasta que continúes.</p>
          </div>

          <div className="relative">
            <div className={`space-y-3 transition ${hideScanPracticeContent ? 'select-none blur-sm opacity-30' : ''}`}>
              <h3 className="text-xl font-bold">{currentQuestion.prompt}</h3>
              {currentQuestion.options.map(opt => (
                <div key={opt.id} className="p-3 border rounded bg-gray-100">{renderOptionContent(opt)}</div>
              ))}
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-950">
                <h4 className="mb-2 font-bold">Texto del anuncio</h4>
                <p>{currentQuestion.transcript}</p>
              </div>
            </div>
            {hideScanPracticeContent && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50/90 p-4 text-center">
                <div className="space-y-1">
                  <p className="font-semibold text-amber-900">Tiempo terminado</p>
                  <p className="text-sm text-amber-800">La pregunta y las respuestas están ocultas para entrenar el escaneo rápido.</p>
                </div>
              </div>
            )}
          </div>

          {scanPracticeRevealed && (
            <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div><span className="font-semibold">Respuesta correcta:</span> {currentQuestion.correctId}</div>
              <div>
                <h4 className="font-bold mb-1">Feedback del Tutor:</h4>
                <p>{currentQuestion.feedback}</p>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={openScanTechniqueModal} className="rounded border border-blue-600 px-4 py-2 text-blue-700 hover:bg-blue-50">Reintentar escaneo</button>
            <button onClick={() => setScanPracticeRevealed(prev => !prev)} className="rounded border border-green-600 px-4 py-2 text-green-700 hover:bg-green-50">
              {scanPracticeRevealed ? 'Ocultar respuesta' : 'Mostrar respuesta'}
            </button>
            <button onClick={continueScanPracticeToFull} className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">Continuar con simulación completa</button>
            <button onClick={fetchQuestion} className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-900">Nueva pregunta</button>
          </div>
        </div>
      )}

      {showScanTechniqueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Reintentar escaneo</h3>
              <p className="text-sm text-gray-500">Elige las técnicas para este intento. Se usará la misma pregunta.</p>
            </div>
            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded border px-3 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={scanTechniqueDraft.verbNounScan}
                  onChange={() => setScanTechniqueDraft(prev => ({ ...prev, verbNounScan: !prev.verbNounScan }))}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">Verbo + Sustantivo</span>
                  <span className="text-xs text-gray-500">Marca palabras clave de contenido.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded border px-3 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={scanTechniqueDraft.verticalScan}
                  onChange={() => setScanTechniqueDraft(prev => ({ ...prev, verticalScan: !prev.verticalScan }))}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">Escaneo vertical</span>
                  <span className="text-xs text-gray-500">Resalta la diferencia entre opciones similares.</span>
                </span>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button onClick={() => setShowScanTechniqueModal(false)} className="rounded border px-4 py-2 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={retryScanPractice} className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">Iniciar intento</button>
            </div>
          </div>
        </div>
      )}

      {(phase === 'scanning' || phase === 'reading' || phase === 'answering') && currentQuestion && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          {renderQuestionOptions(
            phase === 'answering'
              ? 'Espera a que termine el tiempo para ver el resultado.'
              : 'Puedes cambiarla hasta que termine el tiempo de respuesta.'
          )}
        </div>
      )}

      {phase === 'reading' && currentQuestion && (
        <div className="p-6 bg-blue-50 border border-blue-200 rounded space-y-4">
          <h3 className="text-lg font-bold text-blue-900">Escucha el mensaje</h3>

          <audio
            ref={audioRef}
            src={audioUrl ?? undefined}
            preload="auto"
            onLoadedMetadata={() => {
              const duration = audioRef.current?.duration ?? null;
              setAudioDuration(duration);
              if (phase === 'reading' && Number.isFinite(duration)) {
                setTimeLeft(Math.ceil(duration / audioRate) + AUDIO_END_BUFFER_SECONDS);
              }
            }}
            onPlay={() => setAudioPlaying(true)}
            onPause={() => setAudioPlaying(false)}
            onEnded={scheduleAnsweringAfterAudio}
          />

          <div className="space-y-3 rounded-lg border border-blue-100 bg-white/70 p-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button onClick={() => playAudio(false)} disabled={!audioUrl || audioLoading} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed">
                {audioPlaying ? 'Reproduciendo...' : 'Escuchar'}
              </button>
              <button onClick={() => playAudio(true)} disabled={!audioUrl || audioLoading} className="border border-blue-600 text-blue-600 px-4 py-2 rounded hover:bg-blue-100 disabled:text-blue-300 disabled:border-blue-300 disabled:cursor-not-allowed">
                Repetir
              </button>
              <button onClick={stopAudio} disabled={!audioUrl || !audioPlaying} className="border px-4 py-2 rounded text-gray-600 hover:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                Detener
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-gray-600">Velocidad de reproducción</span>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-1">
                {[0.75, 1, 1.25].map(r => (
                  <button key={r} onClick={() => setAudioRate(r)} className={`px-2 py-2 rounded border text-sm ${audioRate === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                    {r}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {audioLoading && <p className="text-sm text-gray-600">Generando audio de alta calidad...</p>}
          {audioError && <p className="text-sm text-red-600">{audioError}</p>}

          <button onClick={continueToAnswering} className="w-full rounded border border-blue-600 bg-white px-4 py-2 text-blue-700 hover:bg-blue-50">
            Continuar a las preguntas
          </button>

          <button onClick={() => setShowTranscript(prev => !prev)} className="text-blue-600 text-sm hover:underline">
            {showTranscript ? 'Ocultar transcripción' : 'Ver transcripción'}
          </button>
          {showTranscript && (
            <p className="italic text-lg border-t border-blue-200 pt-3">"{currentQuestion.transcript}"</p>
          )}
        </div>
      )}

      {phase === 'answering' && currentQuestion && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Últimos segundos para confirmar o cambiar tu respuesta.
        </div>
      )}

      {phase === 'feedback' && currentQuestion && (
        <div className="space-y-4">
          <div className={`p-4 rounded ${selectedAnswer === currentQuestion.correctId ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {selectedAnswer === currentQuestion.correctId ? '¡Correcto!' : `Incorrecto. La correcta era la ${currentQuestion.correctId}.`}
          </div>
          <div className="bg-gray-100 p-4 rounded text-sm">
            <h4 className="font-bold mb-1">Feedback del Tutor:</h4>
            <p>{currentQuestion.feedback}</p>
          </div>
          <button onClick={() => setShowTranscript(prev => !prev)} className="text-blue-600 text-sm hover:underline">
            {showTranscript ? 'Ocultar transcripción' : 'Ver transcripción'}
          </button>
          {showTranscript && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded italic text-sm">
              "{currentQuestion.transcript}"
            </div>
          )}
          <button onClick={() => setShowFeedbackOptions(prev => !prev)} className="text-blue-600 text-sm hover:underline">
            {showFeedbackOptions ? 'Ocultar respuestas' : 'Ver respuestas'}
          </button>
          {showFeedbackOptions && (
            <div className="space-y-2 rounded border bg-gray-50 p-4 text-sm">
              {currentQuestion.options.map(opt => {
                const isCorrect = opt.id === currentQuestion.correctId;
                const isSelected = opt.id === selectedAnswer;
                return (
                  <div
                    key={opt.id}
                    className={`rounded border p-3 ${isCorrect ? 'border-green-300 bg-green-50 text-green-900' : isSelected ? 'border-red-300 bg-red-50 text-red-900' : 'bg-white text-gray-700'}`}
                  >
                    <div>{renderOptionContent(opt)}</div>
                    <div className="mt-1 text-xs font-semibold">
                      {isCorrect && 'Respuesta correcta'}
                      {!isCorrect && isSelected && 'Tu respuesta'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={restartQuestion} className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700">Reiniciar Pregunta</button>
            <button onClick={fetchQuestion} className="flex-1 bg-gray-800 text-white py-2 px-4 rounded hover:bg-gray-900">Generar Nueva Pregunta</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainingMode;
