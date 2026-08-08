// Máquina de estados pura del Runner de examen: (set, state, event) -> nextState.
// No toca DOM, timers ni fetch -- eso vive en ExamRunner.jsx. Los eventos que
// pueden llegar de un callback asíncrono tardío (TIMER_EXPIRED, AUDIO_PLAYING,
// AUDIO_ENDED, AUDIO_FAILED, RETRY_AUDIO) llevan un token {sectionIndex,
// itemIndex, phase} que se compara contra el estado actual: si no coincide,
// el evento es un no-op. Así, un watchdog y un 'ended' real compitiendo por
// el mismo ítem nunca avanzan la máquina dos veces.

export function createInitialState() {
  return {
    status: 'running', // 'running' | 'complete' | 'abandoned'
    sectionIndex: 0,
    itemIndex: 0,
    phase: 'section-intro', // 'section-intro' | 'avant' | 'audio-pending' | 'audio-playing' | 'audio-failed' | 'apres'
    answers: {},
  };
}

export function currentToken(state) {
  return { sectionIndex: state.sectionIndex, itemIndex: state.itemIndex, phase: state.phase };
}

function sameToken(a, b) {
  return a.sectionIndex === b.sectionIndex && a.itemIndex === b.itemIndex && a.phase === b.phase;
}

function sameItem(a, b) {
  return a.sectionIndex === b.sectionIndex && a.itemIndex === b.itemIndex;
}

function isLastItemInSection(set, sectionIndex, itemIndex) {
  return itemIndex === set.sections[sectionIndex].items.length - 1;
}

function isLastSection(set, sectionIndex) {
  return sectionIndex === set.sections.length - 1;
}

function advance(set, state) {
  const { sectionIndex, itemIndex } = state;
  if (!isLastItemInSection(set, sectionIndex, itemIndex)) {
    return { ...state, itemIndex: itemIndex + 1, phase: 'avant' };
  }
  if (!isLastSection(set, sectionIndex)) {
    return { ...state, sectionIndex: sectionIndex + 1, itemIndex: 0, phase: 'section-intro' };
  }
  return { ...state, status: 'complete' };
}

const ANSWERABLE_PHASES = new Set(['avant', 'audio-pending', 'audio-playing', 'apres']);

// Al vencer 'apres' el ítem actual queda cerrado -- cualquier pregunta que
// siga sin respuesta se registra explícitamente como `null` (distinto de
// `undefined`, que significa "todavía no llegó a este ítem"). Ese `null`
// hace que countAnswered la cuente (ya está "resuelta", solo que incorrecta)
// y que computeResults la trate como incorrecta igual que cualquier otra
// respuesta que no matchea correctId.
function lockInUnanswered(set, state) {
  const section = set.sections[state.sectionIndex];
  const item = section.items[state.itemIndex];
  const existing = state.answers[section.type]?.[item.ref] ?? {};
  const locked = { ...existing };
  let changed = false;
  item.questions.forEach((_, questionIndex) => {
    if (!(questionIndex in locked)) {
      locked[questionIndex] = null;
      changed = true;
    }
  });
  if (!changed) return state.answers;
  return {
    ...state.answers,
    [section.type]: {
      ...state.answers[section.type],
      [item.ref]: locked,
    },
  };
}

export function reducer(set, state, event) {
  if (event.type === 'ABANDON') {
    return state.status === 'running' ? { ...state, status: 'abandoned' } : state;
  }
  if (state.status !== 'running') return state;

  switch (event.type) {
    case 'ANSWER_SELECTED': {
      if (!sameItem(event.token, currentToken(state))) return state;
      if (!ANSWERABLE_PHASES.has(state.phase)) return state;
      const sectionType = set.sections[state.sectionIndex].type;
      const ref = set.sections[state.sectionIndex].items[state.itemIndex].ref;
      return {
        ...state,
        answers: {
          ...state.answers,
          [sectionType]: {
            ...state.answers[sectionType],
            [ref]: {
              ...(state.answers[sectionType]?.[ref]),
              [event.questionIndex]: event.optionId,
            },
          },
        },
      };
    }

    case 'TIMER_EXPIRED': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase === 'section-intro') return { ...state, phase: 'avant' };
      if (state.phase === 'avant') return { ...state, phase: 'audio-pending' };
      if (state.phase === 'audio-playing') return { ...state, phase: 'apres' }; // watchdog
      if (state.phase === 'apres') return advance(set, { ...state, answers: lockInUnanswered(set, state) });
      return state;
    }

    case 'AUDIO_PLAYING': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase !== 'audio-pending') return state;
      return { ...state, phase: 'audio-playing' };
    }

    case 'AUDIO_ENDED': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase !== 'audio-playing') return state;
      return { ...state, phase: 'apres' };
    }

    case 'AUDIO_FAILED': {
      if (!sameToken(event.token, currentToken(state))) return state;
      // El único emisor real es el manejador de rechazo de play(), que por
      // definición no puede disparar una vez que el estado ya avanzó a
      // audio-playing -- se restringe la aceptación a audio-pending.
      if (state.phase !== 'audio-pending') return state;
      return { ...state, phase: 'audio-failed' };
    }

    case 'RETRY_AUDIO': {
      if (!sameToken(event.token, currentToken(state))) return state;
      if (state.phase !== 'audio-failed') return state;
      return { ...state, phase: 'audio-pending' };
    }

    default:
      return state;
  }
}

export function computeResults(set, answers) {
  let correctTotal = 0;
  const correctBySection = {};
  for (const section of set.sections) {
    let correct = 0;
    for (const item of section.items) {
      const itemAnswers = answers[section.type]?.[item.ref] ?? {};
      item.questions.forEach((question, questionIndex) => {
        if (itemAnswers[questionIndex] === question.correctId) correct += 1;
      });
    }
    correctBySection[section.type] = correct;
    correctTotal += correct;
  }
  return { answers, correctBySection, correctTotal };
}

export function countAnswered(answers) {
  let count = 0;
  for (const itemsByRef of Object.values(answers)) {
    for (const questionsByIndex of Object.values(itemsByRef)) {
      count += Object.keys(questionsByIndex).length;
    }
  }
  return count;
}
