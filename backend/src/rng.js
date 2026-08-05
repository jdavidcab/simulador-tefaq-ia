// mulberry32: PRNG de 32 bits, rápido y con semilla. Suficiente para muestreo
// reproducible en tests; no es criptográfico y no pretende serlo.
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithRng(rng, array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sampleWithoutReplacement(rng, array, n) {
  if (n > array.length) {
    throw new Error(`No hay elementos suficientes: se piden ${n} de ${array.length}`);
  }
  return shuffleWithRng(rng, array).slice(0, n);
}
