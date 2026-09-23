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

  it('documents but does not remove ellipses', () => {
    expect(parseVocabularyImport('[{"english":"...","german":"..."}]')[0]).toMatchObject({
      english: '...',
      german: '...',
      warning: expect.stringContaining('preserved'),
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
