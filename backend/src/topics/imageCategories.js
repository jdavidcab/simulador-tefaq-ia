import { sampleWithoutReplacement } from '../rng.js';

// 8 categorías fijas para conversation_image (sección más fácil del examen,
// A2-B1). No son temas de texto libre como topics/catalog.js: son un enum
// cerrado sobre el que el planner sortea 4 por set. `label` es el texto
// completo que recibe el LLM como "tema" (mismo campo que usan las demás
// secciones vía ctx.topic), así que incluye tanto la categoría como ejemplos
// concretos -- no hace falta un campo separado.
export const IMAGE_CATEGORIES = [
  {
    id: 'objets_produits',
    label: 'Objetos y productos de la vida cotidiana en un contexto de compra, reparación o regalo: electrodomésticos, muebles, ropa, herramientas.',
  },
  {
    id: 'lieux_commerces',
    label: 'Lugares públicos y comercios cotidianos de Quebec: estación, aeropuerto, biblioteca, farmacia, café, tienda de abarrotes.',
  },
  {
    id: 'activites_loisirs',
    label: 'Personas realizando una actividad de ocio: deporte, jardinería, bricolaje, cocina.',
  },
  {
    id: 'situations_domestiques',
    label: 'Situaciones y problemas del hogar: fuga de agua, mudanza, limpieza, un aparato averiado.',
  },
  {
    id: 'transports',
    label: 'Medios de transporte y desplazamientos: metro, autobús, bicicleta, auto, a pie -- incluyendo retrasos o correspondencias.',
  },
  {
    id: 'repas_nourriture',
    label: 'Comida y contextos alimenticios: restaurante, mercado, preparación de un plato.',
  },
  {
    id: 'meteo_vetements',
    label: 'Condiciones climáticas y la ropa que corresponde a cada una.',
  },
  {
    id: 'personnes_interactions',
    label: 'Un grupo de personas interactuando: cuántas son, quién hace qué, una profesión visible en la escena.',
  },
];

export const DISCRIMINATING_DIMENSIONS = [
  'objeto principal', 'cantidad', 'acción en curso', 'lugar', 'momento del día', 'clima',
];

export function categoryById(id) {
  return IMAGE_CATEGORIES.find(cat => cat.id === id);
}

// Excluye las categorías usadas en el set inmediatamente anterior (no el
// historyWindow general de 3 -- con solo 8 categorías y 4 por set, excluir
// las últimas 4 siempre deja exactamente 4 disponibles, garantizando
// alternancia estricta sin necesitar el mecanismo de relajación 3->2->1->0
// que sí necesita el catálogo de 152 temas libres.
export function pickCategories(rng, recentPlans, count) {
  const previousIds = new Set(
    (recentPlans[0] ?? [])
      .filter(entry => entry.sectionType === 'conversation_image')
      .map(entry => entry.topicId),
  );
  const pool = IMAGE_CATEGORIES.filter(cat => !previousIds.has(cat.id));
  const disponibles = pool.length >= count ? pool : IMAGE_CATEGORIES;
  return sampleWithoutReplacement(rng, disponibles, count);
}
