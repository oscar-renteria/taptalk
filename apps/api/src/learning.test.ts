import { describe, expect, it } from 'vitest';
import { calculateScore, matchAnswer, normalizeAnswer } from './learning.js';

describe('learning rules', () => {
  it('normalizes safe presentation differences without approximate matching', () => {
    expect(normalizeAnswer('  HÄLLO!  ')).toBe('hällo');
    expect(matchAnswer(' Hallo! ', ['hallo', 'guten tag'])).toMatchObject({
      correct: true,
      reason: 'exact-match',
    });
    expect(matchAnswer('near enough', ['hello'])).toMatchObject({
      correct: false,
      reason: 'incorrect',
    });
    expect(matchAnswer('   ', ['hello']).reason).toBe('empty-answer');
  });

  it('reduces points after repeated errors and never rewards an incorrect answer', () => {
    expect(calculateScore(true, 0)).toBe(10);
    expect(calculateScore(true, 2)).toBe(6);
    expect(calculateScore(true, 100)).toBe(1);
    expect(calculateScore(false, 0)).toBe(0);
  });
});
