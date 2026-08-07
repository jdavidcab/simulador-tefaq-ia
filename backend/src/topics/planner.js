import {
  SET_COMPOSITIONS, SINGLE_QUESTION_SECTIONS, MICRO_TROTTOIR_POSTURES,
  sectionDemand, CONFIG as DEFAULT_CONFIG,
} from '../examFormat.js';
import { topicsForSection } from './catalog.js';
import { pickCategories } from './imageCategories.js';
import { createRng, sampleWithoutReplacement, shuffleWithRng } from '../rng.js';

// Temas usados por cada sección en los `window` planes más recientes.
function usadosPorSeccion(recentPlans, window) {
  const usados = new Map();
  for (const plan of recentPlans.slice(0, window)) {
    for (const entrada of plan) {
      if (!usados.has(entrada.sectionType)) usados.set(entrada.sectionType, new Set());
      usados.get(entrada.sectionType).add(entrada.topicId);
    }
  }
  return usados;
}

function disponibles(catalog, sectionType, recentPlans, window, yaAsignados) {
  const bloqueados = usadosPorSeccion(recentPlans, window).get(sectionType) ?? new Set();
  return topicsForSection(sectionType, catalog)
    .filter(topic => !bloqueados.has(topic.id) && !yaAsignados.has(topic.id));
}

export function planTopics({
  catalog, compositionKey, recentPlans = [], seed, pilotes = false, config = DEFAULT_CONFIG,
}) {
  const sections = SET_COMPOSITIONS[compositionKey];
  if (!sections) throw new Error(`Composición desconocida: ${compositionKey}`);

  const rng = createRng(seed);
  const demanda = { ...sectionDemand(compositionKey) };

  // Los pilote son ítems extra de UNA pregunta, repartidos entre las secciones
  // de una pregunta por audio presentes en la composición.
  const pilotesPorSeccion = {};
  if (pilotes) {
    const candidatas = sections.filter(type => SINGLE_QUESTION_SECTIONS.includes(type));
    const barajadas = shuffleWithRng(rng, candidatas);
    for (let i = 0; i < config.piloteCount; i += 1) {
      const type = barajadas[i % barajadas.length];
      pilotesPorSeccion[type] = (pilotesPorSeccion[type] ?? 0) + 1;
      demanda[type] += 1;
    }
  }

  // Asignar primero las secciones más escasas: si `divers` (que encaja con casi
  // todo) se sirviera primero, se comería los pocos temas de debate del bloque 3.
  const relaxations = [];
  const asignados = new Set();
  const porSeccion = {};

  const ordenPorEscasez = [...sections].sort((a, b) => {
    const holguraA = disponibles(catalog, a, recentPlans, config.historyWindow, asignados).length / demanda[a];
    const holguraB = disponibles(catalog, b, recentPlans, config.historyWindow, asignados).length / demanda[b];
    return holguraA - holguraB;
  });

  for (const sectionType of ordenPorEscasez) {
    if (sectionType === 'conversation_image') {
      const elegidas = pickCategories(rng, recentPlans, demanda[sectionType]);
      for (const categoria of elegidas) asignados.add(categoria.id);
      porSeccion[sectionType] = elegidas;
      continue;
    }

    let window = config.historyWindow;
    let pool = disponibles(catalog, sectionType, recentPlans, window, asignados);

    while (pool.length < demanda[sectionType] && window > 0) {
      window -= 1;
      pool = disponibles(catalog, sectionType, recentPlans, window, asignados);
    }
    // Si la insuficiencia es por competencia con otra sección (asignados) y no
    // por historial, bajar window no cambia el pool y el bucle se agota sin
    // éxito. El push de abajo sí se ejecuta con fenetre=0, pero la función lanza
    // inmediatamente después y nunca retorna `relaxations`, así que ningún
    // llamador observa la relajación espuria.
    if (window < config.historyWindow) relaxations.push({ sectionType, fenetre: window });

    if (pool.length < demanda[sectionType]) {
      throw new Error(
        `Temas insuficientes para "${sectionType}": ${pool.length} disponibles, ${demanda[sectionType]} necesarios. Amplía el catálogo.`,
      );
    }

    const elegidos = sampleWithoutReplacement(rng, pool, demanda[sectionType]);
    for (const topic of elegidos) asignados.add(topic.id);
    porSeccion[sectionType] = elegidos;
  }

  // Los refs se emiten en el orden de la composición, no en el de asignación.
  const posturas = MICRO_TROTTOIR_POSTURES[config.microTrottoirOptions];
  const plan = [];
  sections.forEach((sectionType, indiceSeccion) => {
    const temas = porSeccion[sectionType];
    const pilotesAqui = pilotesPorSeccion[sectionType] ?? 0;
    const primerPilote = temas.length - pilotesAqui;

    let posturasBarajadas = [];
    if (sectionType === 'micro_trottoir') {
      posturasBarajadas = temas.map((_, i) => posturas[i % posturas.length]);
      posturasBarajadas = shuffleWithRng(rng, posturasBarajadas);
    }

    temas.forEach((topic, indiceItem) => {
      const entrada = {
        ref: `s${indiceSeccion + 1}i${indiceItem + 1}`,
        sectionType,
        topicId: topic.id,
        pilote: indiceItem >= primerPilote,
      };
      if (sectionType === 'micro_trottoir') entrada.posture = posturasBarajadas[indiceItem];
      plan.push(entrada);
    });
  });

  return { plan, relaxations };
}
