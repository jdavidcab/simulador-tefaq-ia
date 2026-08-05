import { SECTION_PRESETS } from '../examFormat.js';
import { pickTefaqPattern } from '../tefaqPatterns.js';
import { build as annonce_publique } from './sections/annonce_publique.js';
import { build as repondeur } from './sections/repondeur.js';
import { build as micro_trottoir } from './sections/micro_trottoir.js';
import { build as chronique } from './sections/chronique.js';
import { build as interview } from './sections/interview.js';
import { build as reportage } from './sections/reportage.js';
import { build as divers } from './sections/divers.js';

const CONSTRUCTORES = {
  annonce_publique, repondeur, micro_trottoir, chronique, interview, reportage, divers,
};

export function buildSectionPrompt(sectionType, opts = {}) {
  const build = CONSTRUCTORES[sectionType];
  if (!build) {
    throw new Error(`No hay constructor de prompt para "${sectionType}" (conversation_image llega en el slice 4)`);
  }

  const preset = SECTION_PRESETS[sectionType];
  return build({
    topic: opts.topic,
    difficulty: opts.difficulty ?? 'B2',
    posture: opts.posture,
    pattern: opts.pattern ?? pickTefaqPattern(),
    minWords: opts.minWords ?? preset.minWords,
    maxWords: opts.maxWords ?? preset.maxWords,
    questionsPerAudio: preset.questionsPerAudio,
    verticalScan: Boolean(opts.verticalScan),
  });
}
