import React, { useCallback, useEffect, useState } from 'react';
import { generateDrillSet } from './generateDrillSet';

const API_BASE = 'http://localhost:3001';

const TYPE_OPTIONS = [
  { value: '', label: 'Cualquiera' },
  { value: 'nominalisation', label: 'Nominalización' },
  { value: 'synonyme', label: 'Sinónimo' },
  { value: 'restructuration', label: 'Reestructuración' },
];

const DrillPicker = ({ onSelect }) => {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sets?format=SET_DRILL_PARAPHRASE`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSets(data.filter(set => set.statut === 'complet'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSets(); }, [loadSets]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      await generateDrillSet({ typeFilter: typeFilter || undefined });
      await loadSets();
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">Drill Paraphrase</h3>

      <div className="border rounded p-4 space-y-3 bg-gray-50">
        <p className="text-sm text-gray-700">
          Generar una ráfaga nueva de 12 ítems (~8-10 min). El filtro de tipo solo verifica que el modelo
          reportó esa transformación, no que sea semánticamente correcta — no es una garantía absoluta.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            disabled={generating}
            className="border rounded px-3 py-2"
          >
            {TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {generating ? 'Generando...' : 'Generar nuevo drill'}
          </button>
        </div>
        {generateError && <p className="text-red-600 text-sm">{generateError}</p>}
      </div>

      {loading && <div className="text-center py-6 text-blue-600">Cargando drills disponibles...</div>}

      {error && (
        <div className="space-y-3 text-center py-6">
          <p className="text-red-600">No se pudo cargar la lista de drills: {error}</p>
          <button onClick={loadSets} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar</button>
        </div>
      )}

      {!loading && !error && sets.length === 0 && (
        <p className="text-center py-6 text-gray-600">No hay drills listos todavía. Generá uno arriba.</p>
      )}

      {!loading && !error && sets.length > 0 && (
        <div className="space-y-3">
          {sets.map(set => (
            <div key={set.id} className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="font-semibold">{set.id}</p>
                <p className="text-sm text-gray-600">
                  {set.total} ítems · generado {new Date(set.genere_le).toLocaleString()}
                </p>
              </div>
              <button onClick={() => onSelect(set.id)} className="bg-blue-600 text-white px-4 py-2 rounded">
                Elegir
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DrillPicker;
