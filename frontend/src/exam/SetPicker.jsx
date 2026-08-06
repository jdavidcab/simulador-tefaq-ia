import React, { useCallback, useEffect, useState } from 'react';

const API_BASE = 'http://localhost:3001';

const SetPicker = ({ onSelect }) => {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sets`);
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

  if (loading) {
    return <div className="text-center py-10 text-blue-600">Cargando sets disponibles...</div>;
  }

  if (error) {
    return (
      <div className="space-y-3 text-center py-10">
        <p className="text-red-600">No se pudo cargar la lista de sets: {error}</p>
        <button onClick={loadSets} className="bg-blue-600 text-white px-4 py-2 rounded">Reintentar</button>
      </div>
    );
  }

  if (sets.length === 0) {
    return (
      <p className="text-center py-10 text-gray-600">
        No hay sets listos todavía. Genera uno desde el backend (POST /api/sets/generate).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold">Elige un set para el examen</h3>
      {sets.map(set => (
        <div key={set.id} className="flex items-center justify-between border rounded p-3">
          <div>
            <p className="font-semibold">{set.id}</p>
            <p className="text-sm text-gray-600">
              {set.difficulty ?? 'B2'} · {set.total} ítems · generado {new Date(set.genere_le).toLocaleString()}
            </p>
          </div>
          <button onClick={() => onSelect(set.id)} className="bg-blue-600 text-white px-4 py-2 rounded">
            Elegir
          </button>
        </div>
      ))}
    </div>
  );
};

export default SetPicker;
