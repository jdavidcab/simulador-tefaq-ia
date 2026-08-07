// Deriva el estado visual (completado / actual / pendiente) de cada ítem de
// audio del set, para los dos indicadores de progreso del runner: la franja
// global de 32 ítems (buildProgressTabs) y la franja de pestañas filtrada a
// la sección actual, con numeración global (buildSectionTabs). Puro: no toca
// DOM ni reloj -- solo compara índices contra el estado del reducer
// (examMachine.js), sin importar nada de ahí.

export function buildProgressTabs(set, state) {
  const tabs = [];
  set.sections.forEach((section, sectionIndex) => {
    section.items.forEach((_item, itemIndex) => {
      tabs.push({ status: tabStatus(state, sectionIndex, itemIndex) });
    });
  });
  return tabs;
}

export function buildSectionTabs(set, state) {
  let globalNumber = 0;
  let globalIndex = null;
  const sectionTabs = [];
  set.sections.forEach((section, sectionIndex) => {
    section.items.forEach((_item, itemIndex) => {
      globalNumber += 1;
      if (sectionIndex === state.sectionIndex && itemIndex === state.itemIndex) {
        globalIndex = globalNumber;
      }
      if (sectionIndex === state.sectionIndex) {
        sectionTabs.push({ globalNumber, status: tabStatus(state, sectionIndex, itemIndex) });
      }
    });
  });
  return { globalIndex, sectionTabs };
}

function tabStatus(state, sectionIndex, itemIndex) {
  if (sectionIndex < state.sectionIndex) return 'completed';
  if (sectionIndex > state.sectionIndex) return 'pending';
  // misma sección que el estado actual
  if (state.phase === 'section-intro') return 'pending'; // ningún ítem arrancó todavía
  if (itemIndex < state.itemIndex) return 'completed';
  if (itemIndex === state.itemIndex) return 'current';
  return 'pending';
}
