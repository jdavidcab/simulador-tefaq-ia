import React, { useCallback, useEffect, useState } from 'react';
import { generateDrillSet, resumeDrillSet } from './generateDrillSet';

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
  const [resumingId, setResumingId] = useState(null);
  const [resumeError, setResumeError] = useState(null);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sets?format=SET_DRILL_PARAPHRASE`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSets(data);
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
      if (err.code === 'timeout') {
        setGenerateError(
          `El drill "${err.setId}" sigue generándose en el servidor (tardó más de lo esperado, pero no se cortó). `
          + 'Actualizá la lista en unos minutos en vez de generar uno nuevo -- generar otro ahora sumaría gasto de API en paralelo.',
        );
      } else {
        setGenerateError(err.message);
      }
    } finally {
      setGenerating(false);
      await loadSets();
    }
  };

  const handleResume = async (setId) => {
    setResumingId(setId);
    setResumeError(null);
    try {
      await resumeDrillSet({ setId });
    } catch (err) {
      setResumeError(err.message);
    } finally {
      setResumingId(null);
      await loadSets();
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

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {!loading && !error && `${sets.length} set(s)`}
        </span>
        <button onClick={loadSets} className="text-sm text-blue-600 hover:underline">Actualizar lista</button>
      </div>

      {loading && <div className="text-center py-6 text-blue-600">Cargando drills disponibles...</div>}

      {error && (
        <div className="space-y-3 text-center py-6">
          <p className="text-red-600">No se pudo cargar la lista de drills: {error}</p>
          <button onClick={loadSets} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar</button>
        </div>
      )}

      {resumeError && <p className="text-red-600 text-sm text-center">{resumeError}</p>}

      {!loading && !error && sets.length === 0 && (
        <p className="text-center py-6 text-gray-600">No hay drills todavía. Generá uno arriba.</p>
      )}

      {!loading && !error && sets.length > 0 && (
        <div className="space-y-3">
          {sets.map(set => (
            <div key={set.id} className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="font-semibold">{set.id}</p>
                <p className="text-sm text-gray-600">
                  {set.total} ítems · generado {new Date(set.genere_le).toLocaleString()}
                  {set.statut === 'partial' && ` · ${set.prets}/${set.total} listos`}
                </p>
              </div>
              {set.statut === 'complet' && (
                <button onClick={() => onSelect(set.id)} className="bg-blue-600 text-white px-4 py-2 rounded">
                  Elegir
                </button>
              )}
              {set.statut === 'partial' && set.enCours && (
                <span className="text-sm text-blue-600">Generando...</span>
              )}
              {set.statut === 'partial' && !set.enCours && (
                <button
                  onClick={() => handleResume(set.id)}
                  disabled={resumingId === set.id}
                  className="bg-amber-600 text-white px-4 py-2 rounded disabled:opacity-50"
                >
                  {resumingId === set.id ? 'Reanudando...' : 'Reanudar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DrillPicker;
