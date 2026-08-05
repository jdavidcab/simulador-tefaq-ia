// Copia deliberada de la lista de frontend/src/trainingScan.js: son dos paquetes
// npm sin workspace, y los usos divergen (allí se resaltan palabras clave, aquí
// se verifican citas). Duplicar lógica sería deuda; duplicar una lista estática no.
const FRENCH_STOPWORDS = new Set([
  'a', 'alors', 'au', 'aucun', 'aussi', 'aux', 'avec', 'ce', 'ces', 'chez', 'comme', 'dans', 'de', 'des',
  'du', 'elle', 'en', 'entre', 'est', 'et', 'eux', 'il', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma',
  'mais', 'me', 'mes', 'moi', 'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas', 'pour',
  'qu', 'que', 'qui', 'sa', 'se', 'ses', 'son', 'sur', 'ta', 'te', 'tes', 'toi', 'ton', 'tu', 'un', 'une',
  'vos', 'votre', 'vous', 'y', 'd', 'l', 'c', 'n', 'j', 'm', 't', 's', 'quand', 'si', 'car', 'donc', 'or',
]);

export function normalizeText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function contentWords(text) {
  const normalizado = normalizeText(text);
  if (!normalizado) return [];
  const vistas = new Set();
  for (const token of normalizado.split(' ')) {
    if (!token || FRENCH_STOPWORDS.has(token)) continue;
    vistas.add(token);
  }
  return [...vistas];
}
