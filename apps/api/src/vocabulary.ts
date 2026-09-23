import type { VocabularyImportRecord } from '@taptalk/shared';

export type ParsedVocabularyRecord = VocabularyImportRecord & {
  alternatives: string[];
  warning?: string;
};

export type VocabularyImportPreview = {
  valid: ParsedVocabularyRecord[];
  invalid: Array<{ index: number; error: string; record: unknown }>;
  duplicates: number[];
  additions: string[];
  updates: string[];
  warnings: string[];
};

export function parseVocabularyImport(content: string): ParsedVocabularyRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('Vocabulary import must contain valid JSON.');
  }
  if (!Array.isArray(value)) {
    throw new Error('Vocabulary import must be a JSON array.');
  }
  return value.map((record, index) => parseRecord(record, index));
}

export function previewVocabularyImport(
  content: string,
  existingEnglish: string[] = [],
): VocabularyImportPreview {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return {
      valid: [],
      invalid: [{ index: 0, error: 'Vocabulary import must contain valid JSON.', record: content }],
      duplicates: [],
      additions: [],
      updates: [],
      warnings: [],
    };
  }
  if (!Array.isArray(value)) {
    return {
      valid: [],
      invalid: [{ index: 0, error: 'Vocabulary import must be a JSON array.', record: value }],
      duplicates: [],
      additions: [],
      updates: [],
      warnings: [],
    };
  }

  const valid: ParsedVocabularyRecord[] = [];
  const invalid: VocabularyImportPreview['invalid'] = [];
  const duplicates: number[] = [];
  const seen = new Set<string>();
  for (const [index, record] of value.entries()) {
    try {
      const parsed = parseRecord(record, index);
      const key = parsed.english.normalize('NFKC').trim().toLocaleLowerCase();
      if (seen.has(key)) {
        duplicates.push(index);
      } else {
        seen.add(key);
        valid.push(parsed);
      }
    } catch (error) {
      invalid.push({
        index,
        error: error instanceof Error ? error.message : 'Invalid record.',
        record,
      });
    }
  }
  const existing = new Set(
    existingEnglish.map((english) => english.normalize('NFKC').trim().toLocaleLowerCase()),
  );
  const additions = valid
    .filter((record) => !existing.has(record.english.normalize('NFKC').trim().toLocaleLowerCase()))
    .map((record) => record.english);
  const updates = valid
    .filter((record) => existing.has(record.english.normalize('NFKC').trim().toLocaleLowerCase()))
    .map((record) => record.english);
  return {
    valid,
    invalid,
    duplicates,
    additions,
    updates,
    warnings: valid.flatMap((record) => (record.warning ? [record.warning] : [])),
  };
}

function parseRecord(record: unknown, index: number): ParsedVocabularyRecord {
  if (!record || typeof record !== 'object') {
    throw new Error(`Vocabulary record ${index + 1} must be an object.`);
  }
  const candidate = record as Record<string, unknown>;
  if (
    typeof candidate.english !== 'string' ||
    candidate.english.trim() === '' ||
    typeof candidate.german !== 'string' ||
    candidate.german.trim() === ''
  ) {
    throw new Error(`Vocabulary record ${index + 1} requires English and German text.`);
  }
  if (candidate.phonetics !== undefined && typeof candidate.phonetics !== 'string') {
    throw new Error(`Vocabulary record ${index + 1} has invalid phonetics.`);
  }
  const originalGerman = candidate.german.trim();
  const alternatives = originalGerman
    .split(';')
    .map((answer) => answer.normalize('NFKC').trim())
    .filter(Boolean);
  return {
    english: candidate.english.trim(),
    phonetics: candidate.phonetics?.trim(),
    german: originalGerman,
    alternatives,
    ...(originalGerman.includes('...')
      ? { warning: 'Ellipses were preserved in display and answer values.' }
      : {}),
  };
}
