// Test vocabulary only. `seedVocabulary` is imported by the setup project; the UI import spec adds
// `adminImportVocabulary`. Practice questions may be drawn from either list.
export const seedVocabulary = [
  { english: 'hello', german: 'hallo' },
  { english: 'thank you', german: 'danke' },
  { english: 'good morning', german: 'guten Morgen' },
];

export const adminImportVocabulary = [
  { english: 'the tree', german: 'der Baum' },
  { english: 'the house', german: 'das Haus' },
];

const allVocabulary = [...seedVocabulary, ...adminImportVocabulary];

export function answerFor(prompt: string): string {
  const entry = allVocabulary.find((candidate) => candidate.english === prompt);
  if (!entry) {
    throw new Error(`Prompt "${prompt}" is not part of the e2e vocabulary fixtures.`);
  }
  return entry.german;
}

/**
 * The English side of a German prompt, for German -> English exams.
 *
 * The inverse of `answerFor`, and needed because the two directions ask for
 * different sides of the same entry.
 */
export function englishFor(germanPrompt: string): string {
  const entry = allVocabulary.find((candidate) => candidate.german === germanPrompt);
  if (!entry) {
    throw new Error(`Prompt "${germanPrompt}" is not part of the e2e vocabulary fixtures.`);
  }
  return entry.english;
}
