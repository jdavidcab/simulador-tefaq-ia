import { createGeminiProvider } from './gemini.provider.js';
import { createOpenCodeGoProvider } from './opencodego.provider.js';

// Catálogo de modelos OpenCode Go disponibles para selección
// deepseek-v4-flash está restringido a la región China y exige opt-in
// explícito (HTTP 403 permanente en esta cuenta) -- deepseek-v4-pro no tiene
// esa restricción y responde con JSON limpio bajo response_format json_object.
export const MODELS = {
  deepseek: 'deepseek-v4-pro',
  mimo: 'mimo-v2.5',
  mimoPro: 'mimo-v2.5-pro',
};

// Orden de la cadena de fallback en modo "auto"
export const AUTO_CHAIN = ['gemini', 'deepseek', 'mimoPro', 'mimo'];

// Valores válidos para ?provider= (selectores, no ids de modelo)
export const VALID_SELECTORS = ['auto', 'gemini', ...Object.keys(MODELS)];

// Factory: instancia solo los providers cuya API key esté configurada
export function createProviders(env = process.env) {
  const providers = {};

  if (env.GEMINI_API_KEY) {
    providers.gemini = createGeminiProvider(env.GEMINI_API_KEY);
  } else {
    console.warn('[providers] GEMINI_API_KEY no configurada — "gemini" deshabilitado');
  }

  if (env.OPENCODE_API_KEY) {
    for (const [key, modelId] of Object.entries(MODELS)) {
      providers[key] = createOpenCodeGoProvider(env.OPENCODE_API_KEY, modelId);
    }
  } else {
    console.warn(`[providers] OPENCODE_API_KEY no configurada — ${Object.keys(MODELS).join(', ')} deshabilitados`);
  }

  return providers;
}
