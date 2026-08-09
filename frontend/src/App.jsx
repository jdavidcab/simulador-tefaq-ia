import React, { useState } from 'react';
import TrainingMode from './TrainingMode';
import ExamMode from './exam/ExamMode';
import DrillMode from './drill/DrillMode';

const App = () => {
  const [mode, setMode] = useState('training');
  const [examActive, setExamActive] = useState(false);
  const [drillActive, setDrillActive] = useState(false);
  const timedModeActive = examActive || drillActive;

  return (
    <div>
      <div className="max-w-2xl mx-auto mt-4 flex gap-2 px-6">
        <button
          onClick={() => setMode('training')}
          disabled={timedModeActive}
          className={`px-4 py-2 rounded ${mode === 'training' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Entrenamiento
        </button>
        <button
          onClick={() => setMode('exam')}
          disabled={timedModeActive && mode !== 'exam'}
          className={`px-4 py-2 rounded ${mode === 'exam' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Modo Examen
        </button>
        <button
          onClick={() => setMode('drill')}
          disabled={timedModeActive && mode !== 'drill'}
          className={`px-4 py-2 rounded ${mode === 'drill' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Drill Paraphrase
        </button>
      </div>
      {mode === 'training' && <TrainingMode />}
      {mode === 'exam' && <ExamMode onActiveChange={setExamActive} />}
      {mode === 'drill' && <DrillMode onActiveChange={setDrillActive} />}
    </div>
  );
};

export default App;
