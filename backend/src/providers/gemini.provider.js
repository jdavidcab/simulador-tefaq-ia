import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODEL = 'gemini-3.5-flash';

// Strategy: generación vía el SDK oficial de Google Gemini
export function createGeminiProvider(apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    name: GEMINI_MODEL,
    async generate(prompt) {
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      if (!text) throw new Error(`${GEMINI_MODEL}: respuesta sin contenido`);
      return text.trim();
    },
  };
}
