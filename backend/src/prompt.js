// Temas típicos de la prueba de comprensión oral del TEFAQ (vida diaria en Quebec)
export const TEFAQ_TOPICS = [
  "Un problema de mantenimiento en un departamento o edificio en Quebec (ej. calefacción, plomería, ruido de vecinos).",
  "Un anuncio en el transporte público de Montreal (ej. metro, autobús, STM) sobre un retraso, desvío o normas de cortesía.",
  "Una conversación de trabajo sobre el teletrabajo, una reunión pospuesta, o un conflicto menor en la oficina.",
  "Un mensaje en el contestador sobre la cancelación, reprogramación de una cita médica o un servicio no entregado.",
  "Un fragmento de radio debatiendo un tema de actualidad (ej. uso de redes sociales, inflación en el supermercado, medio ambiente).",
  "Una conversación informal entre amigos planeando una actividad típica (ej. ir a un chalet, esquí, festival de verano).",
  "Un cliente haciendo una queja o pidiendo información sobre facturación en un servicio al cliente (telefonía, internet).",
  "Instrucciones o nuevas normativas en un espacio público (ej. gimnasio, biblioteca, universidad).",
  "una llamada al servicio al cliente de un banco (Desjardins, RBC, etc.)",
  "un reporte del clima en la radio (frío, nieve, tormenta)",
  "una reclamación en una tienda o un dépanneur",
  "una reservación por teléfono en un restaurante",
  "un trámite en la SAAQ (licencia, registro de auto)",
  "un mensaje de la escuela o la guardería (CPE) de un niño",
  "una conversación con un vecino sobre la recolección de basura o reciclaje",
  "un anuncio de ofertas en un supermercado (IGA, Metro, Provigo)",
  "una conversación sobre la búsqueda de empleo o una entrevista",
  "un mensaje de Hydro-Québec sobre un corte de electricidad",
  "una invitación a una fiesta o un 5 à 7 entre amigos",
  "una conversación sobre un viaje por carretera a Québec o a las Laurentides",
  "un reclamo de seguro de auto o de vivienda",
  "una conversación con un funcionario de Immigration Québec o del municipio",
  "un boletín de radio sobre una nueva medida municipal de estacionamiento en Montreal",
  "una noticia local sobre obras viales que afectan el acceso a un barrio o puente",
  "un aviso del municipio sobre una consulta pública para un proyecto de vivienda",
  "una cápsula informativa sobre aumento de alquileres y derechos de los inquilinos",
  "una entrevista breve con una asociación de vecinos sobre ruido, seguridad o limpieza",
  "un anuncio de salud pública sobre vacunación, clínica sin cita o prevención estacional",
  "una noticia sobre cambios en el sistema de salud, una clínica cerrada o tiempos de espera",
  "un segmento de radio sobre educación, huelga escolar o cambios en el calendario académico",
  "un mensaje universitario sobre inscripción, becas, examen aplazado o servicio estudiantil",
  "un aviso sobre francisation, curso de francés gratuito o cambio de horario en un centro comunitario",
  "una conversación sobre impuestos, declaración fiscal, Revenu Québec o un documento faltante",
  "un aviso de Élections Québec sobre inscripción electoral, lugar de votación o fecha límite",
  "un debate corto en radio sobre una promesa electoral provincial o municipal",
  "una noticia sobre transporte público: aumento de tarifas, nueva línea, interrupción o accesibilidad",
  "un anuncio de aeropuerto o estación de tren sobre retraso, equipaje o cambio de puerta",
  "una cápsula de consumo sobre garantía legal, devolución de producto o contrato cancelado",
  "una llamada con una compañía de energía o telecomunicaciones sobre un contrato promocional",
  "una noticia ambiental sobre compostaje, reciclaje, calidad del aire o restricciones de agua",
  "un aviso de seguridad pública sobre tormenta, inundación, ola de calor o evacuación preventiva",
  "una conversación laboral sobre sindicato, convenio colectivo, horas extra o cambio de turno",
  "un mensaje de recursos humanos sobre formación obligatoria, beneficios o evaluación anual",
  "una entrevista de radio con un comerciante afectado por obras, inflación o falta de personal",
  "un anuncio cultural sobre festival, museo, espectáculo cancelado o cambio de programación",
  "una crónica cultural sobre cine quebequense, música local o evento comunitario",
  "una noticia deportiva local sobre cierre de instalaciones, inscripción o cambio de horario",
  "un aviso de biblioteca sobre préstamo vencido, actividad gratuita o sala reservada",
  "una conversación sobre compra de auto usado, inspección mecánica o garantía",
  "un aviso de condominio sobre asamblea, presupuesto, reparación urgente o reglas comunes",
  "una llamada sobre guardería, lista de espera, subsidio o ausencia de educadora",
  "una noticia sobre inmigración, reconocimiento de diplomas o integración laboral",
  "un mensaje de una organización comunitaria sobre banco de alimentos, voluntariado o donaciones",
  "una conversación sobre una cita con notario, contrato de arrendamiento o documento oficial",
  "un boletín económico breve sobre precios de alimentos, tasas de interés o empleo en Quebec",
  "una opinión de radio sobre redes sociales, privacidad, inteligencia artificial o desinformación",
  "una entrevista breve sobre turismo regional, temporada alta o recomendaciones para visitantes",
];

export const DIFFICULTY_PROFILES = {
  B1: {
    label: 'B1',
    vocabulary: 'vocabulario cotidiano y concreto, con frases directas y pocas expresiones idiomáticas',
    audioComplexity: 'una sola intención principal, orden cronológico simple y pocos detalles secundarios',
    distractors: 'distractores plausibles pero distinguibles, con errores claros de lugar, hora, motivo o acción',
    synonymDistractors: 'un distractor debe usar un sinónimo simple de una palabra clave del audio, pero cambiar un dato evidente; por ejemplo, reemplazar annuler por reporter, acheter por réserver, o problème por plainte cuando el sentido no coincide completamente',
    optionSimilarity: 'las 4 opciones deben tener una estructura parecida y longitud similar, pero con diferencias claras en una palabra clave o dato central',
    feedback: 'feedback breve centrado en el dato explícito que permite responder',
  },
  B2: {
    label: 'B2',
    vocabulary: 'vocabulario natural de Quebec, incluyendo términos administrativos o cotidianos según el tema',
    audioComplexity: 'mensaje con contexto, motivo, consecuencia y una acción esperada o condición importante',
    distractors: 'distractores parcialmente verdaderos, con paráfrasis y detalles cambiados de forma realista',
    synonymDistractors: 'uno o dos distractores deben apoyarse en sinónimos o paráfrasis naturales del audio, pero alterar una condición, obligación, causa, consecuencia o intención; deben sonar correctos si se reconoce solo una palabra clave',
    optionSimilarity: 'las 4 opciones deben compartir una construcción gramatical similar y un campo semántico común; deben diferenciarse por condición, intención, consecuencia, tiempo, lugar o grado de obligación',
    feedback: 'feedback que explique el parafraseo y por qué los distractores no encajan',
  },
  C1: {
    label: 'C1',
    vocabulary: 'vocabulario más abstracto, administrativo o mediático, con matices y conectores complejos',
    audioComplexity: 'mensaje denso con contraste de puntos de vista, condición implícita o cambio de postura',
    distractors: 'distractores muy cercanos a la respuesta correcta, basados en inferencias, matices o confusión causa-consecuencia',
    synonymDistractors: 'dos distractores deben usar sinónimos, reformulaciones o términos casi equivalentes, pero desplazar un matiz decisivo como certeza/probabilidad, obligación/recomendación, causa/consecuencia, intención/opinión o alcance de la medida',
    optionSimilarity: 'las 4 opciones deben ser muy parecidas en tono, longitud, estructura y vocabulario; deben distinguirse por matices finos como certeza vs posibilidad, recomendación vs obligación, causa directa vs contexto, o alcance limitado vs general',
    feedback: 'feedback que explique la inferencia necesaria, el matiz decisivo y la trampa principal',
  },
};

export const VALID_DIFFICULTIES = Object.keys(DIFFICULTY_PROFILES);

export function buildSystemPrompt(topic, { minWords = 30, maxWords = 50, verticalScan = false, pattern, difficulty = 'B2' } = {}) {
  const profile = DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES.B2;

  return `Actúa como un examinador experto del examen TEFAQ (nivel ${profile.label}). Tu tarea es generar UNA pregunta de comprensión oral simulada.
El escenario ESTA VEZ DEBE TRATAR ESTRICTAMENTE SOBRE: "${topic}".
Usa vocabulario y expresiones típicas quebequenses acordes al tema.

Perfil de dificultad ${profile.label}:
- Vocabulario: ${profile.vocabulary}.
- Complejidad del audio: ${profile.audioComplexity}.
- Sutileza de distractores: ${profile.distractors}.
- Distractores por sinónimos/paráfrasis: ${profile.synonymDistractors}.
- Similitud entre opciones: ${profile.optionSimilarity}.
- Feedback esperado: ${profile.feedback}.

Patrón TEFAQ de esta pregunta:
- Tipo de pregunta: ${pattern?.questionType ?? 'identificar el propósito principal del mensaje'}.
- Estructura del audio: ${pattern?.announcementStructure ?? 'mensaje breve de la vida cotidiana con contexto, motivo y acción esperada'}.
- Patrón principal de distractor: ${pattern?.distractorPattern ?? 'un distractor parcialmente verdadero, pero con un detalle clave incorrecto'}.
- Expresiones/vocabulario quebequense sugerido (usa solo si encaja naturalmente): ${(pattern?.quebecExpressions ?? []).join(', ') || 'dépanneur, courriel, fin de semaine'}.

Reglas:
1. Las 4 opciones deben ser plausibles.
2. El transcript ("audio") debe usar parafraseo y NUNCA usar las mismas palabras exactas de la respuesta correcta.
3. El transcript debe tener entre ${minWords} y ${maxWords} palabras.
4. Devuelve ÚNICAMENTE un objeto JSON válido, sin Markdown ni comillas triples.
5. La respuesta correcta no debe quedar sesgada siempre en la misma letra.
6. En el feedback, evita depender de una letra fija si no es necesario; prioriza explicar por qué el contenido de la respuesta es correcto.
7. El feedback NO debe mencionar letras de opciones (A, B, C, D). Explica únicamente el contenido correcto, el parafraseo usado y por qué los distractores no encajan.
8. Los distractores deben seguir este esquema: uno parcialmente verdadero con detalle incorrecto, uno plausible pero no mencionado, uno que confunda causa/consecuencia o recomendación/obligación, y uno con detalle cambiado (hora/lugar/monto/condición) cuando sea posible.
9. Al menos un distractor debe ser una trampa de sinónimos/paráfrasis: reutiliza una idea del audio con palabras equivalentes o cercanas, pero cambia el sentido final con un matiz o dato incorrecto según el perfil de dificultad.
10. La respuesta correcta también debe estar parafraseada: no copies frases literales del transcript; usa sinónimos válidos que conserven exactamente el mismo sentido.
11. Las 4 opciones deben parecer de la misma familia: longitud parecida, mismo registro, misma categoría de respuesta y estructura gramatical comparable. Evita que una opción sea obviamente diferente por estilo, tamaño o nivel de detalle.
12. La diferencia entre opciones debe estar en un detalle decisivo, no en que una opción sea mucho más específica, larga o natural que las otras.
13. En el feedback, menciona brevemente el par de sinónimos/paráfrasis que conecta el audio con la respuesta correcta y explica por qué el distractor de sinónimos falla.
${verticalScan ? '14. Como entrenamiento de escaneo vertical, las 4 opciones deben compartir un inicio sintáctico natural de al menos 3 palabras y diferenciarse principalmente en la parte final. No fuerces frases artificiales; deben sonar naturales en francés.' : '14. Las opciones pueden tener estructuras variadas y naturales; no necesitas forzar un prefijo común, pero aun así deben tener longitud, tono y categoría semántica similares.'}

Estructura JSON requerida:
{
  "prompt": "Pregunta principal en francés",
  "options": [{ "id": "A", "text": "..." }, { "id": "B", "text": "..." }, { "id": "C", "text": "..." }, { "id": "D", "text": "..." }],
  "transcript": "El texto simulado del audio en francés...",
  "correctId": "A",
  "feedback": "Explicación breve en español de por qué es correcta y los sinónimos usados."
}`;
}
