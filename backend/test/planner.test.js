import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTopics } from '../src/topics/planner.js';
import {
  CONFIG, MICRO_TROTTOIR_POSTURES, SET_COMPOSITIONS, sectionDemand,
} from '../src/examFormat.js';
import { topicsForSection } from '../src/topics/catalog.js';
import { createRng, sampleWithoutReplacement } from '../src/rng.js';
import { IMAGE_CATEGORIES } from '../src/topics/imageCategories.js';

// Catálogo sintético: suficiente para SET_STANDARD_36 con holgura.
function catalogoAmplio() {
  const temas = [];
  const porSeccion = {
    annonce_publique: 30, repondeur: 30, micro_trottoir: 30,
    chronique: 30, interview: 30, reportage: 30, divers: 60,
  };
  let n = 1;
  for (const [seccion, cantidad] of Object.entries(porSeccion)) {
    for (let i = 0; i < cantidad; i += 1) {
      temas.push({ id: `t-${String(n).padStart(4, '0')}`, text: `tema ${n}`, sections: [seccion] });
      n += 1;
    }
  }
  return temas;
}

const OPCIONES_BASE = { compositionKey: 'SET_STANDARD_36', recentPlans: [], seed: 1234, pilotes: false, config: CONFIG };

test('el plan cubre los 32 ítems del set estándar', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  assert.equal(plan.length, 32);
});

test('ningún tema se repite dentro del set', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  const ids = plan.map(p => p.topicId);
  assert.equal(new Set(ids).size, ids.length);
});

test('los refs son posicionales y siguen el orden de la composición', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  assert.equal(plan[0].ref, 's1i1');
  assert.equal(plan[0].sectionType, 'annonce_publique');
  assert.equal(plan[3].ref, 's1i4');
  assert.equal(plan[4].ref, 's2i1');
  assert.equal(plan[4].sectionType, 'repondeur');
  assert.equal(plan.at(-1).sectionType, 'divers');
  assert.equal(plan.at(-1).ref, 's7i10');
});

test('cada tema asignado está etiquetado para su sección', () => {
  const catalog = catalogoAmplio();
  const { plan } = planTopics({ catalog, ...OPCIONES_BASE });
  for (const entrada of plan) {
    const tema = catalog.find(t => t.id === entrada.topicId);
    assert.ok(tema.sections.includes(entrada.sectionType), `${entrada.topicId} no sirve para ${entrada.sectionType}`);
  }
});

test('la misma semilla produce el mismo plan', () => {
  const catalog = catalogoAmplio();
  const a = planTopics({ catalog, ...OPCIONES_BASE });
  const b = planTopics({ catalog, ...OPCIONES_BASE });
  assert.deepEqual(a.plan, b.plan);
});

test('semillas distintas producen planes distintos', () => {
  const catalog = catalogoAmplio();
  const a = planTopics({ catalog, ...OPCIONES_BASE, seed: 1 });
  const b = planTopics({ catalog, ...OPCIONES_BASE, seed: 2 });
  assert.notDeepEqual(a.plan.map(p => p.topicId), b.plan.map(p => p.topicId));
});

test('excluye los temas usados en los sets recientes', () => {
  const catalog = catalogoAmplio();
  const primero = planTopics({ catalog, ...OPCIONES_BASE, seed: 10 });
  const usados = new Set(primero.plan.map(p => p.topicId));
  const segundo = planTopics({ catalog, ...OPCIONES_BASE, seed: 11, recentPlans: [primero.plan] });
  for (const entrada of segundo.plan) {
    assert.ok(!usados.has(entrada.topicId), `${entrada.topicId} repetido respecto al set anterior`);
  }
  assert.deepEqual(segundo.relaxations, []);
});

test('sirve primero a las secciones escasas por RATIO, no solo por pool bruto', () => {
  // divers: 4 compartidos + 9 exclusivos = pool 13, demanda 10, ratio 1.3
  // micro_trottoir: 4 compartidos + 7 exclusivos = pool 11, demanda 6, ratio 1.83
  // Por RATIO: divers (1.3) va antes que micro (1.83) -> correcto.
  // Por POOL BRUTO: micro (11) iría antes que divers (13) -> orden distinto.
  // Con semilla 11, un orden por pool bruto deja a divers sin temas suficientes
  // (verificado abajo con un simulador standalone que replica la misma lógica
  // pero con el comparador equivocado).
  const shared = Array.from({ length: 4 }, (_, i) => ({ id: `sh${i}`, text: `compartido ${i}`, sections: ['divers', 'micro_trottoir'] }));
  const exclDivers = Array.from({ length: 9 }, (_, i) => ({ id: `exd${i}`, text: `divers-excl ${i}`, sections: ['divers'] }));
  const exclMicro = Array.from({ length: 7 }, (_, i) => ({ id: `exm${i}`, text: `micro-excl ${i}`, sections: ['micro_trottoir'] }));
  const resto = [];
  let n = 0;
  for (const [seccion, cantidad] of Object.entries({
    annonce_publique: 20, repondeur: 20, chronique: 20, interview: 20, reportage: 20,
  })) {
    for (let i = 0; i < cantidad; i += 1) { resto.push({ id: `r${n}`, text: `resto ${n}`, sections: [seccion] }); n += 1; }
  }
  const catalog = [...shared, ...exclDivers, ...exclMicro, ...resto];

  assert.doesNotThrow(() => planTopics({
    catalog, compositionKey: 'SET_STANDARD_36', recentPlans: [], pilotes: false, config: CONFIG, seed: 11,
  }));

  // Verificación cruzada: un simulador con la MISMA lógica pero ordenando por
  // pool bruto (el error que este test debe detectar si se reintrodujera)
  // falla con la misma semilla y catálogo -- confirma que el orden importa.
  function planConOrdenPorPoolBruto() {
    const sections = SET_COMPOSITIONS.SET_STANDARD_36;
    const demanda = sectionDemand('SET_STANDARD_36');
    const rng = createRng(11);
    const asignados = new Set();
    const disponibles = (sectionType) => topicsForSection(sectionType, catalog).filter(t => !asignados.has(t.id));
    const ordenPorPool = [...sections].sort((a, b) => disponibles(a).length - disponibles(b).length);
    for (const sectionType of ordenPorPool) {
      const pool = disponibles(sectionType);
      if (pool.length < demanda[sectionType]) {
        throw new Error(`insuficiente para "${sectionType}": ${pool.length} < ${demanda[sectionType]}`);
      }
      const elegidos = sampleWithoutReplacement(rng, pool, demanda[sectionType]);
      for (const t of elegidos) asignados.add(t.id);
    }
  }
  assert.throws(planConOrdenPorPoolBruto, /insuficiente para "divers"/,
    'con orden por pool bruto, divers debería quedarse corto -- confirma que la fixture discrimina de verdad');
});

test('relaja la ventana solo en la sección afectada y lo registra', () => {
  // chronique tiene exactamente 3 temas y demanda 2. Si el set anterior usó 2
  // de ellos, con la ventana intacta solo queda 1 y hay que relajar.
  const chroniqueTemas = Array.from({ length: 3 }, (_, i) => ({
    id: `t-chr${i}`, text: `chronique ${i}`, sections: ['chronique'],
  }));
  const resto = [];
  let n = 0;
  for (const [seccion, cantidad] of Object.entries({
    annonce_publique: 20, repondeur: 20, micro_trottoir: 20,
    interview: 20, reportage: 20, divers: 40,
  })) {
    for (let i = 0; i < cantidad; i += 1) {
      resto.push({ id: `t-r${n}`, text: `resto ${n}`, sections: [seccion] });
      n += 1;
    }
  }
  const historial = [[
    { sectionType: 'chronique', topicId: 't-chr0' },
    { sectionType: 'chronique', topicId: 't-chr1' },
  ]];

  const { plan, relaxations } = planTopics({
    catalog: [...chroniqueTemas, ...resto], ...OPCIONES_BASE, recentPlans: historial,
  });

  assert.equal(plan.filter(p => p.sectionType === 'chronique').length, 2);
  const relajada = relaxations.find(r => r.sectionType === 'chronique');
  assert.ok(relajada, 'debería registrar la relajación de chronique');
  assert.ok(relajada.fenetre < CONFIG.historyWindow);
  assert.ok(!relaxations.some(r => r.sectionType === 'divers'), 'no debe relajar secciones sanas');
});

test('relaja la ventana solo lo necesario, no siempre hasta 0', () => {
  // chronique: pool total de 5 temas exclusivos (c0..c4), demanda 2.
  // Historial (más reciente primero):
  //   set más reciente:  usa c0, c1
  //   set penúltimo:     usa c2, c3
  //   set antepenúltimo: usa c4
  // window=3: bloqueados={c0,c1,c2,c3,c4} -> disponible=0 <2
  // window=2: bloqueados={c0,c1,c2,c3}    -> disponible={c4}=1 <2
  // window=1: bloqueados={c0,c1}          -> disponible={c2,c3,c4}=3 >=2  <-- se detiene aquí
  const chroniqueTemas = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, text: `chronique ${i}`, sections: ['chronique'] }));
  const resto = [];
  let n = 0;
  for (const [seccion, cantidad] of Object.entries({
    annonce_publique: 20, repondeur: 20, micro_trottoir: 20, interview: 20, reportage: 20, divers: 40,
  })) {
    for (let i = 0; i < cantidad; i += 1) { resto.push({ id: `r${n}`, text: `r${n}`, sections: [seccion] }); n += 1; }
  }
  const recentPlans = [
    [{ sectionType: 'chronique', topicId: 'c0' }, { sectionType: 'chronique', topicId: 'c1' }],
    [{ sectionType: 'chronique', topicId: 'c2' }, { sectionType: 'chronique', topicId: 'c3' }],
    [{ sectionType: 'chronique', topicId: 'c4' }],
  ];

  const { relaxations } = planTopics({
    catalog: [...chroniqueTemas, ...resto], compositionKey: 'SET_STANDARD_36',
    recentPlans, seed: 1, pilotes: false, config: CONFIG,
  });

  const relajada = relaxations.find(r => r.sectionType === 'chronique');
  assert.ok(relajada, 'chronique debería figurar en relaxations');
  assert.equal(relajada.fenetre, 1, 'debe detenerse en window=1, no seguir hasta 0 innecesariamente');
});

test('si la insuficiencia es por competencia interna (sin historial), lanza limpiamente sin relajación espuria', () => {
  // chronique y divers comparten TODO su pool (10 temas). divers (ratio 1.0)
  // se procesa antes que chronique (ratio 5.0) y se lleva los 10, dejando a
  // chronique sin nada -- sin que exista ningún historial de por medio.
  const shared = Array.from({ length: 10 }, (_, i) => ({ id: `sh${i}`, text: `c${i}`, sections: ['chronique', 'divers'] }));
  const resto = [];
  let n = 0;
  for (const [seccion, cantidad] of Object.entries({
    annonce_publique: 20, repondeur: 20, micro_trottoir: 20, interview: 20, reportage: 20,
  })) {
    for (let i = 0; i < cantidad; i += 1) { resto.push({ id: `x${n}`, text: `x${n}`, sections: [seccion] }); n += 1; }
  }

  assert.throws(
    () => planTopics({
      catalog: [...shared, ...resto], compositionKey: 'SET_STANDARD_36',
      recentPlans: [], seed: 1, pilotes: false, config: CONFIG,
    }),
    /Temas insuficientes para "chronique"/,
  );
  // La ausencia de una segunda aserción sobre `relaxations` es deliberada: al
  // lanzar, la función nunca retorna, así que no hay objeto que inspeccionar
  // -- eso es exactamente lo que demuestra que no hay relajación espuria.
});

test('aborta si ni con ventana 0 hay temas suficientes', () => {
  const catalog = catalogoAmplio().filter(t => !t.sections.includes('interview'));
  assert.throws(
    () => planTopics({ catalog, ...OPCIONES_BASE }),
    /interview/,
  );
});

test('reparte las posturas de micro-trottoir entre las disponibles', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  const micro = plan.filter(p => p.sectionType === 'micro_trottoir');
  assert.equal(micro.length, 6);
  for (const entrada of micro) {
    assert.ok(MICRO_TROTTOIR_POSTURES[CONFIG.microTrottoirOptions].includes(entrada.posture));
  }
  assert.ok(new Set(micro.map(p => p.posture)).size >= 2, 'las posturas no pueden ser todas la misma');
});

test('solo micro_trottoir lleva postura', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  for (const entrada of plan.filter(p => p.sectionType !== 'micro_trottoir')) {
    assert.equal(entrada.posture, undefined);
  }
});

test('con pilotes añade 4 ítems de una sola pregunta', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE, pilotes: true });
  const pilotes = plan.filter(p => p.pilote);
  assert.equal(pilotes.length, 4);
  assert.equal(plan.length, 36);
  for (const entrada of pilotes) {
    assert.ok(!['interview', 'reportage'].includes(entrada.sectionType), 'un pilote multi-pregunta rompería la cuenta de 40');
  }
  assert.equal(new Set(plan.map(p => p.topicId)).size, 36, 'los pilote consumen su propio tema');
});

test('sin pilotes ningún ítem va marcado', () => {
  const { plan } = planTopics({ catalog: catalogoAmplio(), ...OPCIONES_BASE });
  assert.ok(plan.every(p => p.pilote === false));
});

test('conversation_image recibe 4 categorías del catálogo de imágenes, no temas', () => {
  const { plan } = planTopics({
    catalog: catalogoAmplio(),
    compositionKey: 'SET_STANDARD_40',
    recentPlans: [],
    seed: 99,
    pilotes: false,
    config: CONFIG,
  });
  const entradasImagen = plan.filter(p => p.sectionType === 'conversation_image');
  assert.equal(entradasImagen.length, 4);
  const idsValidos = new Set(IMAGE_CATEGORIES.map(c => c.id));
  for (const entrada of entradasImagen) {
    assert.ok(idsValidos.has(entrada.topicId), `${entrada.topicId} no es una categoría de imagen válida`);
  }
  assert.equal(new Set(entradasImagen.map(e => e.topicId)).size, 4, 'las 4 categorías deben ser distintas');
});

test('SET_STANDARD_40 pone conversation_image primero, con refs s1i1..s1i4', () => {
  const { plan } = planTopics({
    catalog: catalogoAmplio(),
    compositionKey: 'SET_STANDARD_40',
    recentPlans: [],
    seed: 99,
    pilotes: false,
    config: CONFIG,
  });
  assert.equal(plan[0].sectionType, 'conversation_image');
  assert.equal(plan[0].ref, 's1i1');
  assert.equal(plan[3].ref, 's1i4');
  assert.equal(plan[4].sectionType, 'annonce_publique');
  assert.equal(plan[4].ref, 's2i1');
});
