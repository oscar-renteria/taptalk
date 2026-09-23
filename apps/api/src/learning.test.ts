import { describe, expect, it } from 'vitest';
import { calculateScore } from './learning.js';

describe('scoring policy', () => {
  it.each([
    [0, 10],
    [1, 8],
    [2, 6],
    [4, 2],
    [5, 1], // lower bound: a correct answer always earns at least 1 point
    [100, 1],
  ])('a correct answer after %i prior errors earns %i points', (priorErrors, points) => {
    expect(calculateScore(true, priorErrors)).toBe(points);
  });

  it.each([0, 3, 100])(
    'an incorrect answer earns 0 points after %i prior errors',
    (priorErrors) => {
      expect(calculateScore(false, priorErrors)).toBe(0);
    },
  );

  it.each([
    [-3, 10],
    [1.9, 8],
    [Number.NaN, 10],
    [Number.POSITIVE_INFINITY, 10],
  ])('sanitizes an out-of-range prior error count %s', (priorErrors, points) => {
    expect(calculateScore(true, priorErrors)).toBe(points);
  });

  it('only produces non-negative integers', () => {
    for (let errors = -5; errors < 20; errors += 1) {
      for (const correct of [true, false]) {
        const score = calculateScore(correct, errors);
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
