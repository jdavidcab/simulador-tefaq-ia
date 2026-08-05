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
