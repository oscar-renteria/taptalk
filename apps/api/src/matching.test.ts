import { describe, expect, it } from 'vitest';
import {
  expandAcceptedAnswer,
  foldGermanSpelling,
  matchAnswer,
  maxAnswerLength,
  normalizeAnswer,
} from './matching.js';

describe('answer normalization', () => {
  it.each([
    ['  Guten   Tag  ', 'guten tag'],
    ['HÄLLO!', 'hällo'],
    ['Ja, bitte.', 'ja bitte'],
    ['¿Qué?', 'qué'],
    ['„Hallo“', 'hallo'],
    ['geht’s', "geht's"],
    ['E-Mail', 'e-mail'],
    ['etwas geben ...', 'etwas geben'],
    ['etwas … geben', 'etwas geben'],
    ['ﬁnden', 'finden'], // NFKC folds the "ﬁ" ligature
    ['Straße', 'straße'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });
});

describe('optional parts', () => {
  it('expands parenthesized groups into with and without variants', () => {
    expect(expandAcceptedAnswer('(sich) freuen')).toEqual(['sich freuen', 'freuen']);
    expect(expandAcceptedAnswer('(to) give (away)')).toEqual([
      'to give away',
      'to give',
      'give away',
      'give',
    ]);
    expect(expandAcceptedAnswer('hallo')).toEqual(['hallo']);
  });

  it('bounds the number of variants for malformed entries', () => {
    expect(expandAcceptedAnswer('(a) (b) (c) (d) (e) x')).toHaveLength(8);
  });
});

describe('answer matching', () => {
  const accepted = ['Hallo', 'guten Tag', '(sich) freuen'];

  it('classifies an identical answer as an exact match and preserves nothing lossy', () => {
    expect(matchAnswer('Hallo', accepted)).toEqual({
      correct: true,
      reason: 'exact-match',
      normalizedAnswer: 'hallo',
    });
    expect(matchAnswer('  guten Tag ', accepted).reason).toBe('exact-match');
    expect(matchAnswer('freuen', accepted).reason).toBe('exact-match');
  });

  it.each(['hallo', 'HALLO!', 'Guten  tag.', 'Freuen', 'Sich freuen!'])(
    'accepts %j as a normalized match',
    (answer) => {
      expect(matchAnswer(answer, accepted)).toMatchObject({
        correct: true,
        reason: 'normalized-match',
      });
    },
  );

  it.each([
    'Halo', // typo: no approximate matching
    'hallo tag', // partial overlap
    'gutenTag', // missing space changes the answer
    'sich',
  ])('rejects %j as incorrect', (answer) => {
    expect(matchAnswer(answer, [...accepted, 'Straße'])).toMatchObject({
      correct: false,
      reason: 'incorrect',
    });
  });

  it.each([
    ['Strasse', 'Straße'],
    ['STRASSE', 'Straße'],
    ['Maedchen', 'Mädchen'],
    ['schoen', 'schön'],
    ['Tuer', 'Tür'],
    ['grüße', 'Grüsse'], // also accepted in the other direction
  ])('accepts the transliteration %j for %j as a spelling variant', (answer, accepted) => {
    expect(matchAnswer(answer, [accepted])).toMatchObject({
      correct: true,
      reason: 'spelling-variant-match',
    });
  });

  it('keeps real spelling differences incorrect after transliteration', () => {
    expect(matchAnswer('Strase', ['Straße']).reason).toBe('incorrect');
    expect(matchAnswer('Madchen', ['Mädchen']).reason).toBe('incorrect');
    expect(foldGermanSpelling('grüße')).toBe('gruesse');
  });

  it.each(['', '   ', '...', '?!', '„“'])('classifies %j as empty', (answer) => {
    expect(matchAnswer(answer, accepted)).toMatchObject({ correct: false, reason: 'empty-answer' });
  });

  it('classifies oversized or control-character submissions as invalid', () => {
    expect(matchAnswer('a'.repeat(maxAnswerLength + 1), accepted).reason).toBe('invalid-answer');
    expect(matchAnswer('hallo\u0000', accepted).reason).toBe('invalid-answer');
    expect(matchAnswer('Hallo\n', accepted).reason).toBe('exact-match');
  });

  it('never matches when there are no accepted answers', () => {
    expect(matchAnswer('hallo', []).reason).toBe('incorrect');
  });
});
