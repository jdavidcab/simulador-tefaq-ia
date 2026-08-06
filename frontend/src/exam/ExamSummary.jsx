import React from 'react';

const SECTION_LABELS = {
  annonce_publique: 'Anuncios públicos',
  repondeur: 'Contestador',
  micro_trottoir: 'Micro-trottoir',
  chronique: 'Crónica',
  interview: 'Entrevista',
  reportage: 'Reportaje',
  divers: 'Diversos',
};

const ExamSummary = ({ correctTotal, totalQuestions, correctBySection, totalsBySection, onExit }) => (
  <div className="space-y-4">
    <h2 className="text-2xl font-bold text-gray-800">Examen completado</h2>
    <div className="p-4 rounded bg-blue-50 border border-blue-200 text-center">
      <p className="text-3xl font-bold text-blue-800">{correctTotal} / {totalQuestions}</p>
      <p className="text-sm text-blue-700">respuestas correctas</p>
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

export default ExamSummary;
