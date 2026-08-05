const BASE_URL = 'https://opencode.ai/zen/go/v1';
const DEFAULT_TIMEOUT_MS = 120000; // margen amplio para modelos más lentos del gateway

// Strategy genérica: cualquier modelo del gateway OpenCode Go (OpenAI-compatible).
// La misma clase se instancia por modelo (deepseek-v4-flash, mimo-v2.5, mimo-v2.5-pro, ...).
export function createOpenCodeGoProvider(apiKey, modelId, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return {
    name: modelId,
    async generate(prompt) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: prompt }],
            temperature: 1,
            response_format: { type: 'json_object' },
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`${modelId}: HTTP ${res.status} ${body.slice(0, 200)}`.trim());
          err.status = res.status;
          throw err;
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error(`${modelId}: respuesta sin contenido`);
        return text.trim();
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error(`${modelId}: timeout tras ${timeoutMs / 1000}s`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
