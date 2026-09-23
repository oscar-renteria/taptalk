import { describe, expect, it } from 'vitest';
import { parseVocabularyImport, previewVocabularyImport } from './vocabulary.js';

describe('vocabulary parser', () => {
  it('preserves display text and represents alternatives', () => {
    expect(
      parseVocabularyImport(
        '[{"english":"hello","phonetics":"həˈləʊ","german":"hallo; guten Tag"}]',
      ),
    ).toEqual([
      {
        english: 'hello',
        phonetics: 'həˈləʊ',
        german: 'hallo; guten Tag',
        alternatives: ['hallo', 'guten Tag'],
      },
    ]);
  });

  it('preserves ellipses for display and warns that they are ignored when matching', () => {
    expect(
      parseVocabularyImport('[{"english":"to give ...","german":"jemandem etwas geben ..."}]')[0],
    ).toMatchObject({
      german: 'jemandem etwas geben ...',
      alternatives: ['jemandem etwas geben ...'],
      warning: expect.stringContaining('ignored when answers are checked'),
    });
  });

  it('rejects a record whose German text has no answerable content', () => {
    expect(() => parseVocabularyImport('[{"english":"...","german":"..."}]')).toThrow(
      'at least one German answer',
    );
  });

  it('merges alternatives that only differ by case or punctuation', () => {
    expect(
      parseVocabularyImport('[{"english":"hello","german":"Hallo; hallo!; guten Tag"}]')[0],
    ).toMatchObject({
      alternatives: ['Hallo', 'guten Tag'],
      warning: expect.stringContaining('"hallo!" repeats another answer'),
    });
  });

  it('rejects malformed imports', () => {
    expect(() => parseVocabularyImport('{"english":"hello"}')).toThrow();
    expect(() => parseVocabularyImport('[{"english":""}]')).toThrow();
  });

  it('previews invalid records and existing-entry changes without persistence', () => {
    const preview = previewVocabularyImport(
      '[{"english":"hello","german":"hallo"},{"english":"hello","german":"hi"},{"english":"","german":"bad"}]',
      ['hello'],
    );
    expect(preview.valid).toHaveLength(1);
    expect(preview.invalid).toHaveLength(1);
    expect(preview.duplicates).toEqual([1]);
    expect(preview.updates).toEqual(['hello']);
    expect(preview.additions).toEqual([]);
  });
});
