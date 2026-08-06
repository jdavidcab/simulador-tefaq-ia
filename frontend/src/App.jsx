import React, { useState } from 'react';
import TrainingMode from './TrainingMode';
import ExamMode from './exam/ExamMode';

const App = () => {
  const [mode, setMode] = useState('training');
  const [examActive, setExamActive] = useState(false);

  return (
    <div>
      <div className="max-w-2xl mx-auto mt-4 flex gap-2 px-6">
        <button
          onClick={() => setMode('training')}
          disabled={examActive}
          className={`px-4 py-2 rounded ${mode === 'training' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Entrenamiento
        </button>
        <button
          onClick={() => setMode('exam')}
          disabled={examActive && mode !== 'exam'}
          className={`px-4 py-2 rounded ${mode === 'exam' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Modo Examen
        </button>
      </div>
      {mode === 'training' ? <TrainingMode /> : <ExamMode onActiveChange={setExamActive} />}
    </div>
  );
};

export default App;
