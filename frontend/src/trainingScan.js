const FRENCH_STOPWORDS = new Set([
  'a', 'alors', 'au', 'aucun', 'aussi', 'aux', 'avec', 'ce', 'ces', 'chez', 'comme', 'dans', 'de', 'des',
  'du', 'elle', 'en', 'entre', 'est', 'et', 'eux', 'il', 'je', 'la', 'le', 'les', 'leur', 'lui', 'ma',
  'mais', 'me', 'mes', 'moi', 'mon', 'ne', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'pas', 'pour',
  'qu', 'que', 'qui', 'sa', 'se', 'ses', 'son', 'sur', 'ta', 'te', 'tes', 'toi', 'ton', 'tu', 'un', 'une',
  'vos', 'votre', 'vous', 'y', 'd', 'l', 'c', 'n', 'j', 'm', 't', 's', 'quand', 'si', 'car', 'donc', 'or',
]);

const IMPORTANT_SHORT_TOKENS = new Set(['stm', 'cpe', 'saaq', 'clsc', 'hydro-quebec']);

function cleanToken(token) {
  return token
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function tokenize(text) {
  return text
    .split(/\s+/)
    .map(token => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, ''))
    .filter(Boolean);
}

function isLikelyContentWord(token) {
  const cleaned = cleanToken(token).replace(/[’']/g, '');
  if (!cleaned) return false;
  if (IMPORTANT_SHORT_TOKENS.has(cleaned)) return true;
  if (/\d/.test(token)) return true;
  if (cleaned.length >= 4 && !FRENCH_STOPWORDS.has(cleaned)) return true;
  if (/(er|ir|re|oir|age|ment|tion|sion|teur|euse|aire|isme|ette|ence|ance|eur|eau|ier|iere|ure|oir)$/.test(cleaned)) return true;
  return false;
}

export function getKeywordView(text) {
  const tokens = tokenize(text);
  const keywords = [];

  for (const token of tokens) {
    if (!isLikelyContentWord(token)) continue;
    const key = cleanToken(token);
    if (keywords.some(existing => cleanToken(existing) === key)) continue;
    keywords.push(token);
    if (keywords.length >= 5) break;
  }

  return keywords.join(' · ');
}

function getKeywordTokens(text) {
  const keywordView = getKeywordView(text);
  if (!keywordView) return [];
  return keywordView.split(' · ').map(cleanToken);
}

function getCommonPrefixTokens(optionTexts) {
  const tokenLists = optionTexts.map(tokenize);
  if (tokenLists.some(list => list.length === 0)) return [];

  const prefix = [];
  for (let i = 0; ; i += 1) {
    const token = tokenLists[0][i];
    if (!token) break;
    if (tokenLists.every(list => list[i] === token)) {
      prefix.push(token);
      continue;
    }
    break;
  }

  return prefix;
}

export function buildTrainingView(options, config) {
  const verbNounScan = Boolean(config.verbNounScan);
  const verticalScan = Boolean(config.verticalScan);

  const optionTexts = options.map(option => option.text);
  const commonPrefixTokens = verticalScan ? getCommonPrefixTokens(optionTexts) : [];
  const verticalApplies = commonPrefixTokens.length >= 3 && options.every(option => tokenize(option.text).length > commonPrefixTokens.length);

  const commonPrefixText = verticalApplies ? commonPrefixTokens.join(' ') : '';

  return {
    commonPrefixText,
    commonPrefixTokenCount: commonPrefixTokens.length,
    verticalApplies,
    options: options.map(option => {
      const tokens = tokenize(option.text);
      const distinctiveText = verticalApplies ? tokens.slice(commonPrefixTokens.length).join(' ') : '';
      const keywordSource = distinctiveText || option.text;
      const keywordTokens = verbNounScan ? getKeywordTokens(keywordSource) : [];

      return {
        ...option,
        distinctiveText,
        keywordTokens,
      };
    }),
  };
}

export function getHighlightedChunks(text, optionView, trainingView) {
  const parts = text.match(/\S+|\s+/g) || [];
  const chunks = [];
  let wordIndex = 0;

  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      chunks.push({ text: part, isWord: false, isCommonPrefix: false, isKeyword: false });
      continue;
    }

    const normalized = cleanToken(part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, ''));
    const isCommonPrefix = Boolean(trainingView?.verticalApplies) && wordIndex < (trainingView?.commonPrefixTokenCount ?? 0);
    const isKeyword = optionView?.keywordTokens?.includes(normalized);

    chunks.push({ text: part, isWord: true, isCommonPrefix, isKeyword });
    wordIndex += 1;
  }

  return chunks;
}
