import React from 'react';
import { estimateScore699 } from './examScoring';

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const ExamSummary = ({ correctTotal, totalQuestions, correctBySection, totalsBySection, onExit }) => {
  const { estimated699, isB2, thresholdCount } = estimateScore699(correctTotal, totalQuestions);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">Examen completado</h2>
      <div className="p-4 rounded bg-blue-50 border border-blue-200 text-center">
        <p className="text-3xl font-bold text-blue-800">{correctTotal} / {totalQuestions}</p>
        <p className="text-sm text-blue-700">respuestas correctas</p>
      </div>

      <div className={`p-4 rounded border text-center space-y-1 ${isB2 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <p className={`text-xl font-bold ${isB2 ? 'text-green-800' : 'text-amber-800'}`}>
          ≈ {estimated699} / 699
        </p>
        <p className="text-xs text-gray-500">
          Estimación lineal no oficial — la escala real del TEFAQ usa un escalamiento psicométrico no público.
        </p>
        <p className={`text-sm font-semibold ${isB2 ? 'text-green-700' : 'text-amber-700'}`}>
          {isB2 ? 'Nivel B2 alcanzado' : 'Todavía no alcanza B2'}
        </p>
        <p className="text-xs text-gray-600">
          Necesitás ~{thresholdCount}/{totalQuestions} aciertos para B2.
        </p>
      </div>

      <div className="space-y-2">
        {Object.keys(SECTION_LABELS).map(sectionType => (
          totalsBySection[sectionType] != null && (
            <div key={sectionType} className="flex items-center justify-between border rounded p-3">
              <span>{SECTION_LABELS[sectionType]}</span>
              <span className="font-semibold">{correctBySection[sectionType] ?? 0} / {totalsBySection[sectionType]}</span>
            </div>
          )
        ))}
      </div>
      <button onClick={onExit} className="w-full bg-blue-600 text-white py-2 rounded">
        Volver a la lista de sets
      </button>
    </div>
  );
};

export default ExamSummary;
