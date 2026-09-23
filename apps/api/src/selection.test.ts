import { describe, expect, it } from 'vitest';
import {
  candidateWeight,
  createSeededRandom,
  resolveDirection,
  selectQuestion,
  type SelectionCandidate,
} from './selection.js';

const fresh = (id: string): SelectionCandidate => ({
  id,
  attempts: 0,
  recentIncorrect: 0,
  correctInSession: 0,
});

function frequencies(
  candidates: SelectionCandidate[],
  options: Parameters<typeof selectQuestion>[1],
  draws = 20_000,
) {
  const random = createSeededRandom(42);
  const counts = new Map<string, number>();
  for (let draw = 0; draw < draws; draw += 1) {
    const id = selectQuestion(candidates, options, random)?.id ?? 'none';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (id: string) => (counts.get(id) ?? 0) / draws;
}

describe('candidate weights', () => {
  it.each([
    [{ attempts: 0, recentIncorrect: 0, correctInSession: 0 }, 'balanced', 3],
    [{ attempts: 4, recentIncorrect: 0, correctInSession: 0 }, 'balanced', 1],
    [{ attempts: 4, recentIncorrect: 2, correctInSession: 0 }, 'balanced', 5],
    [{ attempts: 9, recentIncorrect: 9, correctInSession: 0 }, 'balanced', 11], // capped at 5 errors
    [{ attempts: 0, recentIncorrect: 0, correctInSession: 0 }, 'errors-first', 1],
    [{ attempts: 4, recentIncorrect: 2, correctInSession: 0 }, 'errors-first', 9],
    [{ attempts: 4, recentIncorrect: 2, correctInSession: 1 }, 'balanced', 1.25],
  ] as const)('weighs %j with %s as %d', (stats, preference, weight) => {
    expect(candidateWeight({ id: 'x', ...stats }, preference)).toBe(weight);
  });
});

describe('question selection', () => {
  it('returns undefined for an empty or fully filtered candidate set', () => {
    const random = createSeededRandom(1);
    expect(selectQuestion([], { repetitionPreference: 'balanced' }, random)).toBeUndefined();
    expect(
      selectQuestion(
        [fresh('a')],
        { repetitionPreference: 'balanced', filter: () => false },
        random,
      ),
    ).toBeUndefined();
  });

  it('is deterministic for a given seed', () => {
    const candidates = ['a', 'b', 'c', 'd'].map(fresh);
    const draw = (seed: number) => {
      const random = createSeededRandom(seed);
      return Array.from(
        { length: 10 },
        () => selectQuestion(candidates, { repetitionPreference: 'balanced' }, random)?.id,
      );
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it('draws in proportion to weight, favouring words with repeated errors', () => {
    const candidates: SelectionCandidate[] = [
      { id: 'mastered', attempts: 5, recentIncorrect: 0, correctInSession: 0 }, // weight 1
      { id: 'struggling', attempts: 5, recentIncorrect: 2, correctInSession: 0 }, // weight 5
      fresh('new'), // weight 3
    ];
    const share = frequencies(candidates, { repetitionPreference: 'balanced' });
    expect(share('mastered')).toBeCloseTo(1 / 9, 1);
    expect(share('struggling')).toBeCloseTo(5 / 9, 1);
    expect(share('new')).toBeCloseTo(3 / 9, 1);
  });

  it('shifts towards errors with the errors-first preference', () => {
    const candidates: SelectionCandidate[] = [
      { id: 'struggling', attempts: 5, recentIncorrect: 2, correctInSession: 0 },
      fresh('new'),
    ];
    const balanced = frequencies(candidates, { repetitionPreference: 'balanced' });
    const errorsFirst = frequencies(candidates, { repetitionPreference: 'errors-first' });
    expect(errorsFirst('struggling')).toBeGreaterThan(balanced('struggling') + 0.2);
  });

  it('never repeats the previous entry while another candidate exists', () => {
    const share = frequencies(['a', 'b'].map(fresh), {
      repetitionPreference: 'balanced',
      previousEntryId: 'a',
    });
    expect(share('a')).toBe(0);
    expect(
      selectQuestion(
        [fresh('a')],
        { repetitionPreference: 'balanced', previousEntryId: 'a' },
        () => 0,
      )?.id,
    ).toBe('a');
  });

  it('applies the optional filter and explains each selection', () => {
    const random = createSeededRandom(3);
    const selection = selectQuestion(
      [fresh('a'), { id: 'b', attempts: 2, recentIncorrect: 1, correctInSession: 0 }],
      { repetitionPreference: 'balanced', filter: (candidate) => candidate.id === 'b' },
      random,
    );
    expect(selection).toEqual({ id: 'b', reason: 'needs-practice', weight: 3 });
    expect(selectQuestion([fresh('a')], { repetitionPreference: 'balanced' }, random)?.reason).toBe(
      'new-word',
    );
  });

  it('handles random values at the interval edges', () => {
    const candidates = ['a', 'b'].map(fresh);
    expect(selectQuestion(candidates, { repetitionPreference: 'balanced' }, () => 0)?.id).toBe('a');
    expect(selectQuestion(candidates, { repetitionPreference: 'balanced' }, () => 1)?.id).toBe('b');
  });
});

describe('direction', () => {
  it('keeps a fixed direction and splits random evenly', () => {
    const random = createSeededRandom(9);
    expect(resolveDirection('german-to-english', random)).toBe('german-to-english');
    const draws = Array.from({ length: 10_000 }, () => resolveDirection('random', random));
    const share = draws.filter((direction) => direction === 'english-to-german').length / 10_000;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });
});
