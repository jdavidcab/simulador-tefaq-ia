import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTopics } from '../src/topics/planner.js';
import { CONFIG, MICRO_TROTTOIR_POSTURES } from '../src/examFormat.js';

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

test('sirve primero a las secciones escasas: annonce no puede vaciar el pool de divers', () => {
  // divers (demanda 10) SOLO puede usar 10 temas compartidos.
  // annonce_publique (demanda 4) puede usar esos mismos 10 más 4 exclusivos.
  // El orden de composición pondría annonce primero, que robaría del pool
  // compartido y dejaría a divers sin temas suficientes. El orden por escasez
  // sirve divers primero (ratio 1.0 frente a 3.5) y ambas caben.
  const compartidos = Array.from({ length: 10 }, (_, i) => ({
    id: `t-comp${i}`, text: `compartido ${i}`, sections: ['annonce_publique', 'divers'],
  }));
  const exclusivosAnnonce = Array.from({ length: 4 }, (_, i) => ({
    id: `t-excl${i}`, text: `exclusivo ${i}`, sections: ['annonce_publique'],
  }));
  const resto = [];
  let n = 0;
  for (const [seccion, cantidad] of Object.entries({
    repondeur: 20, micro_trottoir: 20, chronique: 20, interview: 20, reportage: 20,
  })) {
    for (let i = 0; i < cantidad; i += 1) {
      resto.push({ id: `t-r${n}`, text: `resto ${n}`, sections: [seccion] });
      n += 1;
    }
  }

  const { plan } = planTopics({
    catalog: [...compartidos, ...exclusivosAnnonce, ...resto], ...OPCIONES_BASE,
  });

  const idsDivers = plan.filter(p => p.sectionType === 'divers').map(p => p.topicId).sort();
  const idsAnnonce = plan.filter(p => p.sectionType === 'annonce_publique').map(p => p.topicId).sort();

  assert.deepEqual(idsDivers, compartidos.map(t => t.id).sort(),
    'divers debe quedarse con todo el pool compartido');
  assert.deepEqual(idsAnnonce, exclusivosAnnonce.map(t => t.id).sort(),
    'annonce debe conformarse con sus exclusivos');
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
