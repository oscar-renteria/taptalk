import { describe, expect, it } from 'vitest';
import { calculateScore } from './learning.js';

describe('learning rules', () => {
  it('reduces points after repeated errors and never rewards an incorrect answer', () => {
    expect(calculateScore(true, 0)).toBe(10);
    expect(calculateScore(true, 2)).toBe(6);
    expect(calculateScore(true, 100)).toBe(1);
    expect(calculateScore(false, 0)).toBe(0);
  });
});
