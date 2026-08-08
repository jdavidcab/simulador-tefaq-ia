import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createItemGenerator, esFalloDeCuotaORed } from '../src/itemGenerator.js';
import { CONFIG } from '../src/examFormat.js';

function itemJson({ palabras = 45, correctId = 'B' } = {}) {
  const transcript = Array.from({ length: palabras }, (_, i) => `mot${i}`).join(' ');
  return JSON.stringify({
    transcript,
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId,
      feedback: 'El anuncio lo dice de forma parafraseada.',
      justification: transcript.split(' ').slice(0, 10).join(' '),
      reformulationType: 'nominalisation',
    }],
  });
}

function proveedorFake(name, respuestas) {
  const llamadas = [];
  return {
    name,
    llamadas,
    async generate(prompt) {
      llamadas.push(prompt);
      const siguiente = respuestas.shift();
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    },
  };
}

function errorHttp(status) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  return error;
}

const BASE = { sectionType: 'annonce_publique', topic: 'un aviso municipal', difficulty: 'B2' };

test('devuelve el ítem validado con el proveedor y el número de intentos', async () => {
  const gemini = proveedorFake('gemini', [itemJson()]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.equal(item.provider, 'gemini');
  assert.equal(item.tentativas, 1);
  assert.equal(item.questions.length, 1);
});

test('limpia las vallas de markdown alrededor del JSON', async () => {
  const gemini = proveedorFake('gemini', ['```json\n' + itemJson() + '\n```']);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.ok(item.transcript.length > 0);
});

test('un fallo de validación reintenta el MISMO proveedor', async () => {
  const gemini = proveedorFake('gemini', [itemJson({ palabras: 500 }), itemJson()]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'gemini', 'no debe bajar de modelo por ruido de muestreo');
  assert.equal(item.tentativas, 2);
  assert.equal(deepseek.llamadas.length, 0);
});

test('agotados los reintentos de validación, avanza en la cadena', async () => {
  const malo = itemJson({ palabras: 500 });
  const gemini = proveedorFake('gemini', [malo, malo, malo]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, CONFIG.validationRetries + 1);
  assert.equal(item.provider, 'deepseek');
});

test('un 429 avanza de proveedor sin reintentar', async () => {
  const gemini = proveedorFake('gemini', [errorHttp(429)]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, 1, 'reintentar el mismo modelo tras un 429 no sirve de nada');
  assert.equal(item.provider, 'deepseek');
});

test('un timeout también avanza sin reintentar', async () => {
  const gemini = proveedorFake('gemini', [new Error('gemini: timeout tras 120s')]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(gemini.llamadas.length, 1);
  assert.equal(item.provider, 'deepseek');
});

test('esFalloDeCuotaORed distingue los dos tipos de fallo', () => {
  assert.equal(esFalloDeCuotaORed(errorHttp(429)), true);
  assert.equal(esFalloDeCuotaORed(errorHttp(503)), true);
  assert.equal(esFalloDeCuotaORed(new Error('timeout tras 120s')), true);
  assert.equal(esFalloDeCuotaORed(new Error('fetch failed')), true);
  assert.equal(esFalloDeCuotaORed(new Error('"transcript" fuera de rango: 500 palabras')), false);
  assert.equal(esFalloDeCuotaORed(errorHttp(400)), false);
  assert.equal(esFalloDeCuotaORed(errorHttp(401)), true);
  assert.equal(esFalloDeCuotaORed(errorHttp(403)), true);
});

test('si toda la cadena falla, lanza con el detalle de lo intentado', async () => {
  const malo = itemJson({ palabras: 500 });
  const gemini = proveedorFake('gemini', [malo, malo, malo]);
  const deepseek = proveedorFake('deepseek', [errorHttp(429)]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  await assert.rejects(
    () => generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] }),
    (error) => {
      assert.equal(error.providersTried.length, 2);
      assert.match(error.providersTried[0].error, /fuera de rango/);
      return true;
    },
  );
});

test('omite los proveedores no configurados', async () => {
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ deepseek }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'deepseek');
});

test('lanza si ningún proveedor de la cadena está configurado', async () => {
  const generador = createItemGenerator({}, CONFIG);
  await assert.rejects(
    () => generador.generateItem({ ...BASE, selector: ['gemini'] }),
    /configurado/,
  );
});

test('baraja las opciones y renumera correctId salvo en micro_trottoir', async () => {
  const gemini = proveedorFake('gemini', [itemJson()]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.deepEqual(item.questions[0].options.map(o => o.id), ['A', 'B', 'C', 'D']);
  assert.ok(['A', 'B', 'C', 'D'].includes(item.questions[0].correctId));
});

test('no crashea si el config no trae validationRetries (queda como NaN)', async () => {
  const nuncaLlamado = proveedorFake('gemini', []);
  nuncaLlamado.generate = async () => { throw new Error('no debería llamarse con maxIntentos inválido'); };
  const generador = createItemGenerator({ gemini: nuncaLlamado }, {});
  await assert.rejects(
    () => generador.generateItem({ ...BASE, selector: ['gemini'] }),
    (error) => {
      assert.equal(error.providersTried.length, 1);
      assert.match(error.providersTried[0].error, /sin intentos ejecutados/);
      return true;
    },
  );
});

test('normaliza el feedback contra el correctId final aunque la letra aparezca en una frase posterior con elisión francesa', async () => {
  const conElisionFrancesa = JSON.stringify({
    transcript: Array.from({ length: 45 }, (_, i) => `mot${i}`).join(' '),
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId: 'B',
      feedback: "Le message est clair sur ce point précis. L'option A est un distracteur partiellement vrai qui reprend un détail secondaire.",
      justification: 'mot0 mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9',
      reformulationType: 'nominalisation',
    }],
  });
  const proveedor = proveedorFake('gemini', [conElisionFrancesa]);
  const generador = createItemGenerator({ gemini: proveedor }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });

  const feedback = item.questions[0].feedback;
  // El propio prefijo canónico "La opción X es correcta" contiene la letra
  // del correctId final -- eso es esperado, no una fuga. Lo que no debe
  // aparecer es una letra FUERA de ese prefijo.
  const sinPrefijo = feedback.replace(/^La opción [ABCD] es correcta\.?\s*/, '');
  assert.ok(!/\b[ABCD]\b/.test(sinPrefijo), `no debe quedar ninguna letra suelta fuera del prefijo canónico, ni siquiera de una frase posterior: "${feedback}"`);
  assert.match(feedback, new RegExp(`^La opción ${item.questions[0].correctId} es correcta`), 'debe citar el correctId FINAL, post-barajado');
});

test('conserva el razonamiento del modelo cuando el feedback no menciona ninguna letra', async () => {
  const proveedor = proveedorFake('gemini', [itemJson({ correctId: 'A' })]);
  const generador = createItemGenerator({ gemini: proveedor }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });

  const feedback = item.questions[0].feedback;
  assert.match(feedback, new RegExp(`^La opción ${item.questions[0].correctId} es correcta\\. `), 'sin letras que limpiar, debe conservar el cuerpo original con el prefijo canónico');
  assert.ok(feedback.includes('anuncio lo dice de forma parafraseada'), 'el razonamiento original no debe perderse cuando no hay nada que limpiar');
});

function itemJsonMicroTrottoir({ postureCorrecta, palabras = 45 } = {}) {
  const posturas = ['totalement pour', 'pour à certaines conditions', 'totalement contre'];
  const transcript = Array.from({ length: palabras }, (_, i) => `mot${i}`).join(' ');
  return JSON.stringify({
    transcript,
    questions: [{
      prompt: 'Quelle est la position de la personne interviewée ?',
      options: posturas.map((text, i) => ({ id: 'ABCD'[i], text })),
      correctId: 'ABCD'[posturas.indexOf(postureCorrecta)],
      feedback: 'La persona expresa esta postura con matices.',
      justification: transcript.split(' ').slice(0, 10).join(' '),
    }],
  });
}

test('conserva razonamiento que empieza con "A" como preposición española, no como letra de opción', async () => {
  const conPreposicion = JSON.stringify({
    transcript: Array.from({ length: 45 }, (_, i) => `mot${i}`).join(' '),
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId: 'C',
      feedback: 'A diferencia de los distractores, esta opción se apoya en un dato explícito del audio.',
      justification: 'mot0 mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9',
      reformulationType: 'nominalisation',
    }],
  });
  const proveedor = proveedorFake('gemini', [conPreposicion]);
  const generador = createItemGenerator({ gemini: proveedor }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });

  const feedback = item.questions[0].feedback;
  assert.ok(feedback.includes('diferencia de los distractores'), `no debe descartar una "A" que es preposición, no letra de opción: "${feedback}"`);
});

test('descarta el razonamiento si el feedback menciona una letra con marcador "opción"/"option" aunque siga una palabra en minúscula', async () => {
  const conMarcador = JSON.stringify({
    transcript: Array.from({ length: 45 }, (_, i) => `mot${i}`).join(' '),
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId: 'D',
      feedback: "L'option B est un distracteur partiellement vrai qui reprend un détail secondaire.",
      justification: 'mot0 mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9',
      reformulationType: 'nominalisation',
    }],
  });
  const proveedor = proveedorFake('gemini', [conMarcador]);
  const generador = createItemGenerator({ gemini: proveedor }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });

  const feedback = item.questions[0].feedback;
  // No se puede fijar la letra esperada: aleatorizarOpciones() reasigna
  // correctId tras barajar las opciones (BASE.sectionType no es
  // micro_trottoir), así que se compara contra el correctId FINAL, como ya
  // hace el test de elisión francesa más arriba.
  assert.match(feedback, new RegExp(`^La opción ${item.questions[0].correctId} es correcta según lo que se dice en el audio\\.$`), `debe descartar el razonamiento pese a que "est" sigue a la letra: "${feedback}"`);
});

test('descarta el razonamiento si el feedback dice "el distractor B" (marcador sin "opción"/"option")', async () => {
  const conDistractor = JSON.stringify({
    transcript: Array.from({ length: 45 }, (_, i) => `mot${i}`).join(' '),
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'Une première option plausible' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId: 'A',
      // Caso real encontrado en contenido generado: "el distractor B mezcla..."
      // -- la letra sigue en una palabra en minúscula ("mezcla"), así que
      // letraSuelta no la detecta; hace falta que "distractor" cuente como
      // marcador igual que "opción"/"option".
      feedback: 'El distractor B mezcla la idea de salario durante la formación con una condición que no se menciona en el audio.',
      justification: 'mot0 mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9',
      reformulationType: 'nominalisation',
    }],
  });
  const proveedor = proveedorFake('gemini', [conDistractor]);
  const generador = createItemGenerator({ gemini: proveedor }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });

  const feedback = item.questions[0].feedback;
  assert.match(feedback, new RegExp(`^La opción ${item.questions[0].correctId} es correcta según lo que se dice en el audio\\.$`), `debe descartar el razonamiento pese a que la letra sigue a "distractor", no a "opción": "${feedback}"`);
});

test('no baraja las opciones de micro_trottoir (son fijas y en orden)', async () => {
  const posturas = ['totalement pour', 'pour à certaines conditions', 'totalement contre'];
  const gemini = proveedorFake('gemini', [itemJsonMicroTrottoir({ postureCorrecta: posturas[1] })]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({
    sectionType: 'micro_trottoir', topic: 'un tema opinable de la vida en Quebec', difficulty: 'B2',
    posture: posturas[1], selector: ['gemini'],
  });
  assert.deepEqual(item.questions[0].options.map(o => o.text), posturas, 'el orden y el texto de las posturas no debe cambiar');
  assert.deepEqual(item.questions[0].options.map(o => o.id), ['A', 'B', 'C']);
  assert.equal(item.questions[0].correctId, 'B');
});

test('un fallo de reformulación (opción correcta calca el audio) reintenta el MISMO proveedor', async () => {
  const malo = JSON.stringify({
    transcript: Array.from({ length: 45 }, (_, i) => `mot${i}`).join(' '),
    questions: [{
      prompt: 'Quel est le message principal ?',
      options: [
        { id: 'A', text: 'mot0 mot1 mot2 mot3 mot4 mot5' },
        { id: 'B', text: 'Une deuxième option plausible, proche de mot20 et mot21' },
        { id: 'C', text: 'Une troisième option plausible' },
        { id: 'D', text: 'Une quatrième option plausible, proche de mot22 et mot23' },
      ],
      correctId: 'A',
      feedback: 'x',
      justification: 'mot0 mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9',
      reformulationType: 'nominalisation',
    }],
  });
  const gemini = proveedorFake('gemini', [malo, itemJson()]);
  const deepseek = proveedorFake('deepseek', [itemJson()]);
  const generador = createItemGenerator({ gemini, deepseek }, CONFIG);

  const item = await generador.generateItem({ ...BASE, selector: ['gemini', 'deepseek'] });
  assert.equal(item.provider, 'gemini', 'un fallo de reformulación es de validación, no de cuota/red');
  assert.equal(item.tentativas, 2);
  assert.equal(deepseek.llamadas.length, 0);
});

test('adjunta metadata de reformulación al ítem generado, sobreviviendo el barajado de opciones', async () => {
  const gemini = proveedorFake('gemini', [itemJson({ correctId: 'A' })]);
  const generador = createItemGenerator({ gemini }, CONFIG);
  const item = await generador.generateItem({ ...BASE, selector: ['gemini'] });
  assert.equal(item.questions[0].reformulation.type, 'nominalisation');
  assert.equal(item.questions[0].reformulation.option_correcte, 'Une première option plausible');
});
