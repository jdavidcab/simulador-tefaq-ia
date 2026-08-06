import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reducer, currentToken, computeResults } from './examMachine.js';

// Set mínimo con dos secciones: la primera de 1-pregunta-por-audio (2 ítems,
// para cubrir el avance dentro de la sección), la segunda de 2 preguntas por
// audio (1 ítem, para cubrir interview/reportage y el fin del set).
function fixtureSet() {
  return {
    sections: [
      {
        type: 'annonce_publique',
        items: [
          { ref: 's1i1', questions: [{ correctId: 'A' }] },
          { ref: 's1i2', questions: [{ correctId: 'B' }] },
        ],
      },
      {
        type: 'interview',
        items: [
          { ref: 's2i1', questions: [{ correctId: 'A' }, { correctId: 'C' }] },
        ],
      },
    ],
  };
}

function dispatch(set, state, event) {
  return reducer(set, state, event);
}

function runItemToApres(set, state) {
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // avant -> audio-pending
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_ENDED', token: currentToken(state) }); // -> apres
  return state;
}

test('avant vence y pide reproducir audio', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  assert.equal(state.phase, 'audio-pending');
});

test('AUDIO_PLAYING solo aplica en audio-pending y con el token correcto', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  const staleToken = { sectionIndex: 0, itemIndex: 0, phase: 'avant' }; // token de la fase anterior
  const unchanged = dispatch(set, state, { type: 'AUDIO_PLAYING', token: staleToken });
  assert.equal(unchanged.phase, 'audio-pending', 'un token de una fase vieja no debe avanzar la máquina');
  const advanced = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  assert.equal(advanced.phase, 'audio-playing');
});

test('AUDIO_ENDED y un watchdog tardío compitiendo por el mismo ítem no avanzan dos veces', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  const tokenDuringAudio = currentToken(state);

  const afterEnded = dispatch(set, state, { type: 'AUDIO_ENDED', token: tokenDuringAudio });
  assert.equal(afterEnded.phase, 'apres');

  // El watchdog, armado antes de AUDIO_ENDED, dispara tarde con el MISMO
  // token capturado en audio-playing -- ya no coincide con el estado actual.
  const afterStaleWatchdog = dispatch(set, afterEnded, { type: 'TIMER_EXPIRED', token: tokenDuringAudio });
  assert.equal(afterStaleWatchdog, afterEnded, 'debe ser un no-op exacto, no una fase que coincide por casualidad');
});

test('el watchdog SÍ avanza a apres cuando AUDIO_ENDED nunca llega', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // watchdog
  assert.equal(state.phase, 'apres');
});

test('ANSWER_SELECTED se acepta durante avant, audio-pending, audio-playing y apres', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A');

  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'B' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'B', 'debe poder cambiar la respuesta mientras el ítem sigue visible');
});

test('una respuesta registrada justo antes del vencimiento del deadline queda contada', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  const beforeExpiry = state;
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence, avanza
  assert.equal(beforeExpiry.answers.annonce_publique.s1i1[0], 'A');
  assert.equal(state.itemIndex, 1, 'debe avanzar al segundo ítem de la misma sección');
});

test('preguntas sin responder quedan registradas como ausentes, no se descartan', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence sin responder
  const results = computeResults(set, state.answers);
  assert.equal(results.correctBySection.annonce_publique, 0);
});

test('el último ítem de una sección dispara section-transition, no el siguiente ítem', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> item 2 de la sección
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // último ítem -> section-transition
  assert.equal(state.phase, 'section-transition');
  assert.equal(state.sectionIndex, 0, 'todavía no cruzó a la siguiente sección hasta el clic de Continuar');
});

test('SECTION_CONTINUE cruza a la siguiente sección desde su primer ítem', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-transition
  state = dispatch(set, state, { type: 'SECTION_CONTINUE' });
  assert.equal(state.sectionIndex, 1);
  assert.equal(state.itemIndex, 0);
  assert.equal(state.phase, 'avant');
});

test('el último ítem del set (2 preguntas) pasa a status complete y computa el resultado', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-transition
  state = dispatch(set, state, { type: 'SECTION_CONTINUE' }); // sección 1 (interview)

  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 1, optionId: 'C' });
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // último ítem del set

  assert.equal(state.status, 'complete');
  const results = computeResults(set, state.answers);
  assert.equal(results.correctBySection.interview, 2);
  assert.equal(results.correctTotal, 2);
});

test('AUDIO_FAILED detiene la máquina explícitamente, nunca se confunde con AUDIO_ENDED', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'AUDIO_FAILED', token: currentToken(state) });
  assert.equal(state.phase, 'audio-failed');
  state = dispatch(set, state, { type: 'RETRY_AUDIO', token: currentToken(state) });
  assert.equal(state.phase, 'audio-pending');
});

test('ABANDON detiene la máquina desde cualquier fase; eventos posteriores son no-op', () => {
  const set = fixtureSet();
  let state = createInitialState();
  state = dispatch(set, state, { type: 'ABANDON' });
  assert.equal(state.status, 'abandoned');
  const after = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  assert.equal(after, state, 'nada debe mover un estado ya abandonado');
});
