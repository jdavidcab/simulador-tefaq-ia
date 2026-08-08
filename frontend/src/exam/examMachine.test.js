import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reducer, currentToken, computeResults, countAnswered } from './examMachine.js';

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

// El estado inicial arranca en 'section-intro'; todos los tests que asumen
// estar ya en 'avant' del primer ítem necesitan pasar por acá primero.
function skipIntro(set, state) {
  return dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
}

function runItemToApres(set, state) {
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // avant -> audio-pending
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_ENDED', token: currentToken(state) }); // -> apres
  return state;
}

test('el estado inicial arranca en section-intro de la primera sección', () => {
  const state = createInitialState();
  assert.equal(state.phase, 'section-intro');
  assert.equal(state.sectionIndex, 0);
  assert.equal(state.itemIndex, 0);
});

test('TIMER_EXPIRED en section-intro pasa a avant sin tocar sectionIndex/itemIndex', () => {
  const set = fixtureSet();
  const state = skipIntro(set, createInitialState());
  assert.equal(state.phase, 'avant');
  assert.equal(state.sectionIndex, 0);
  assert.equal(state.itemIndex, 0);
});

test('avant vence y pide reproducir audio', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  assert.equal(state.phase, 'audio-pending');
});

test('AUDIO_PLAYING solo aplica en audio-pending y con el token correcto', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  const staleToken = { sectionIndex: 0, itemIndex: 0, phase: 'avant' }; // token de la fase anterior
  const unchanged = dispatch(set, state, { type: 'AUDIO_PLAYING', token: staleToken });
  assert.equal(unchanged.phase, 'audio-pending', 'un token de una fase vieja no debe avanzar la máquina');
  const advanced = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  assert.equal(advanced.phase, 'audio-playing');
});

test('AUDIO_ENDED y un watchdog tardío compitiendo por el mismo ítem no avanzan dos veces', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
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
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) });
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // watchdog
  assert.equal(state.phase, 'apres');
});

test('ANSWER_SELECTED se acepta durante avant, audio-pending, audio-playing y apres', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A');

  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'B' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'B', 'debe poder cambiar la respuesta mientras el ítem sigue visible');

  // Continuar a audio-playing
  state = dispatch(set, state, { type: 'AUDIO_PLAYING', token: currentToken(state) }); // -> audio-playing
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'C' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'C', 'debe aceptar respuesta durante audio-playing');

  // Continuar a apres
  state = dispatch(set, state, { type: 'AUDIO_ENDED', token: currentToken(state) }); // -> apres
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A', 'debe aceptar respuesta durante apres');
});

test('ANSWER_SELECTED acepta token con phase desactualizado si el ítem coincide', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);

  // Estamos en phase: 'apres', pero enviamos un token con phase: 'avant' (desactualizado)
  // Si la verificación fuera sameToken en lugar de sameItem, esto fallaría.
  const stalePhaseToken = { sectionIndex: 0, itemIndex: 0, phase: 'avant' };
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: stalePhaseToken, questionIndex: 0, optionId: 'A' });
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A', 'debe aceptar respuesta incluso con token de phase desactualizado, siempre que el ítem coincida');
});

test('una respuesta registrada justo antes del vencimiento del deadline queda contada', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  const beforeExpiry = state;
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence, avanza
  assert.equal(beforeExpiry.answers.annonce_publique.s1i1[0], 'A');
  assert.equal(state.itemIndex, 1, 'debe avanzar al segundo ítem de la misma sección');
});

test('preguntas sin responder quedan registradas como ausentes, no se descartan', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence sin responder
  const results = computeResults(set, state.answers);
  assert.equal(results.correctBySection.annonce_publique, 0);
});

test('apres vence sin responder: la pregunta queda cerrada con null, no undefined, y cuenta como respondida', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence sin responder
  assert.equal(state.answers.annonce_publique.s1i1[0], null, 'debe cerrarse explícitamente como null, no quedar ausente');
  assert.equal(countAnswered(state.answers), 1, 'una pregunta cerrada sin responder cuenta en el contador');
});

test('apres vence sin responder no pisa una respuesta ya elegida en ese mismo ítem', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // apres vence
  assert.equal(state.answers.annonce_publique.s1i1[0], 'A', 'una respuesta real ya elegida no debe reemplazarse por null');
});

test('el último ítem de una sección dispara section-intro de la siguiente, con sectionIndex ya incrementado', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> item 2 de la sección
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // último ítem -> section-intro
  assert.equal(state.phase, 'section-intro');
  assert.equal(state.sectionIndex, 1, 'a diferencia de antes, ya cruzó a la siguiente sección en el mismo paso');
  assert.equal(state.itemIndex, 0);
});

test('TIMER_EXPIRED en section-intro de la siguiente sección pasa a avant de su primer ítem', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-intro (sección 1)
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> avant
  assert.equal(state.sectionIndex, 1);
  assert.equal(state.itemIndex, 0);
  assert.equal(state.phase, 'avant');
});

test('el último ítem del set (2 preguntas) pasa a status complete y computa el resultado', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-intro (sección 1)
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> avant, sección 1 (interview)

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
  let state = skipIntro(set, createInitialState());
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

test('countAnswered cuenta preguntas respondidas, no ítems', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  assert.equal(countAnswered(state.answers), 0);

  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(countAnswered(state.answers), 1);

  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> item 2 (s1i1 ya tenía respuesta, no gana nada al cerrarse)
  assert.equal(countAnswered(state.answers), 1, 'el ítem que avanza ya tenía respuesta real; el ítem 2, aún sin visitar, no suma');

  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> audio-pending
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'B' });
  assert.equal(countAnswered(state.answers), 2, 'segundo ítem respondido suma, sin pisar el primero');
});

test('countAnswered cuenta cada pregunta de un ítem multi-pregunta por separado', () => {
  const set = fixtureSet();
  let state = skipIntro(set, createInitialState());
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) });
  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // section-intro (sección 1)
  state = dispatch(set, state, { type: 'TIMER_EXPIRED', token: currentToken(state) }); // -> avant, interview

  // Los 2 ítems de annonce_publique recorridos arriba vencieron sin
  // respuesta, así que ya quedaron cerrados (contados como null) antes de
  // llegar a interview -- la baseline captura eso para no confundirlo con
  // el conteo del ítem multi-pregunta bajo prueba.
  const baseline = countAnswered(state.answers);
  assert.equal(baseline, 2, 'los 2 ítems previos, vencidos sin responder, ya quedaron cerrados');

  state = runItemToApres(set, state);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 0, optionId: 'A' });
  assert.equal(countAnswered(state.answers), baseline + 1);
  state = dispatch(set, state, { type: 'ANSWER_SELECTED', token: currentToken(state), questionIndex: 1, optionId: 'C' });
  assert.equal(countAnswered(state.answers), baseline + 2, 'las 2 preguntas del mismo ítem cuentan por separado');
});
