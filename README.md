# Simulador TEFAQ con Agente de IA

Este proyecto consta de dos partes aisladas: un backend ligero (agente generador) y un frontend en React (interfaz).

## 1. Configurar el Backend (Agente IA)
1. Abre una terminal y navega a la carpeta `backend`
2. Ejecuta `npm install`
3. Crea un archivo `.env` con tus API keys:
   - `GEMINI_API_KEY` — Google Gemini (gratis en Google AI Studio, ~20 req/día).
   - `TTS_GEMINI_API_KEY` — opcional. Si quieres separar la cuota del audio TTS del resto de Gemini, usa una key distinta aquí.
   - `OPENCODE_API_KEY` — OpenCode Go (fallback cuando Gemini se agota).
   - `TTS_VOICE` — opcional. Voz única de Gemini TTS para el audio del anuncio. Default: `Kore`.
   - `TTS_VOICES` — opcional. Lista de voces separadas por coma para alternar por pregunta. Ejemplo: `Kore,Charon,Puck`. Si existe, tiene prioridad sobre `TTS_VOICE`.
4. Ejecuta `npm start`. El servidor correrá en `http://localhost:3001`.

### Arquitectura multi-proveedor (Factory + Strategy + Bridge)
El backend genera preguntas con una cadena de fallback configurable:

- **Modo `auto` (default)**: `gemini → deepseek-v4-flash → mimo-v2.5-pro → mimo-v2.5`. Si un proveedor falla (cuota, red, JSON inválido), pasa al siguiente automáticamente.
- **Modo forzado**: `GET /api/generate-question?provider=gemini|deepseek|mimo|mimoPro` usa solo ese proveedor (sin fallback).
- La generación acepta `minWords`, `maxWords` y `verticalScan=true|false` para controlar el largo del transcript y forzar opciones entrenables con escaneo vertical cuando esté activo.
- La respuesta incluye el campo `provider` con el modelo que realmente generó la pregunta.
- Los providers viven en `backend/src/providers/`, la cadena en `AUTO_CHAIN` de `backend/src/providers/index.js`, los patrones TEFAQ locales en `backend/src/tefaqPatterns.js`, y la lógica de fallback/validación en `backend/src/questionGenerator.js`.
- El backend también expone `POST /api/tts` para generar el audio del transcript con `gemini-2.5-flash-preview-tts`. El audio se cachea en memoria por texto+voz. La voz se elige de forma estable a partir del transcript para que el prefetch y la reproducción usen el mismo audio, alternando entre preguntas cuando `TTS_VOICES` tiene varias opciones.

## 2. Configurar el Frontend (React/Vite)
1. Abre otra terminal y navega a la carpeta `frontend`
2. Ejecuta `npm install`
3. Ejecuta `npm run dev`
4. Abre la URL que te indique la terminal (usualmente `http://localhost:5173`).

Desde la interfaz puedes elegir el modelo (Automático o uno específico), ver qué modelo generó cada pregunta, reiniciar la misma pregunta, llevar un contador de aciertos y escuchar un audio de alta calidad del anuncio con transcripción visible a demanda.

También puedes elegir el modo de práctica:

- **Simulación completa**: flujo normal con lectura de opciones, audio, respuesta y feedback.
- **Solo lectura rápida**: genera la pregunta y opciones para entrenar escaneo visual sin generar audio ni contar score; luego puedes mostrar respuesta o continuar con la simulación completa.

La pantalla inicial también permite parametrizar:

- segundos para leer opciones
- segundos para responder
- mínimo y máximo de palabras del anuncio

Por defecto, el transcript se pide y valida en el rango **30-50 palabras**.

¡Listo! Ya puedes empezar a practicar.
