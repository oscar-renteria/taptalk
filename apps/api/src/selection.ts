// Question selection policy v1. See docs/architecture/question-selection.md. A transparent weighted
// draw over simple counts; it is not machine learning. Pure: randomness is injected.

export type Direction = 'english-to-german' | 'german-to-english';
export type DirectionPreference = Direction | 'random';
export type RepetitionPreference = 'balanced' | 'errors-first';
export type SelectionReason = 'new-word' | 'needs-practice' | 'review';

export type SelectionCandidate = {
  id: string;
  attempts: number;
  // Incorrect answers among the user's most recent attempts at this entry.
  recentIncorrect: number;
  correctInSession: number;
};

export type SelectionOptions = {
  repetitionPreference: RepetitionPreference;
  // Entry asked immediately before; avoided when another candidate exists.
  previousEntryId?: string | null;
  // Optional restriction, for example a future vocabulary list or tag.
  filter?: (candidate: SelectionCandidate) => boolean;
};

export type Selection = { id: string; reason: SelectionReason; weight: number };

export type Random = () => number;

export const recentAttemptWindow = 5;

const weights = {
  balanced: { newWord: 3, perRecentError: 2 },
  'errors-first': { newWord: 1, perRecentError: 4 },
} as const;
const answeredCorrectlyInSessionFactor = 0.25;

export function selectionReason(candidate: SelectionCandidate): SelectionReason {
  if (candidate.attempts === 0) return 'new-word';
  if (candidate.recentIncorrect > 0) return 'needs-practice';
  return 'review';
}

export function candidateWeight(
  candidate: SelectionCandidate,
  preference: RepetitionPreference,
): number {
  const policy = weights[preference];
  const recentErrors = Math.min(Math.max(0, candidate.recentIncorrect), recentAttemptWindow);
  const base = candidate.attempts === 0 ? policy.newWord : 1 + recentErrors * policy.perRecentError;
  return candidate.correctInSession > 0 ? base * answeredCorrectlyInSessionFactor : base;
}

export function selectQuestion(
  candidates: SelectionCandidate[],
  options: SelectionOptions,
  random: Random,
): Selection | undefined {
  const allowed = candidates.filter(options.filter ?? (() => true));
  const pool =
    allowed.length > 1 && options.previousEntryId
      ? allowed.filter((candidate) => candidate.id !== options.previousEntryId)
      : allowed;
  if (pool.length === 0) return undefined;

  const weighted = pool.map((candidate) => ({
    candidate,
    weight: candidateWeight(candidate, options.repetitionPreference),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = Math.min(Math.max(random(), 0), 0.999_999_999) * total;
  for (const entry of weighted) {
    threshold -= entry.weight;
    if (threshold < 0) {
      return {
        id: entry.candidate.id,
        reason: selectionReason(entry.candidate),
        weight: entry.weight,
      };
    }
  }
  const last = weighted[weighted.length - 1]!;
  return { id: last.candidate.id, reason: selectionReason(last.candidate), weight: last.weight };
}

export function resolveDirection(preference: DirectionPreference, random: Random): Direction {
  if (preference !== 'random') return preference;
  return random() < 0.5 ? 'english-to-german' : 'german-to-english';
}

/**
 * An exam question, frozen at the moment the exam starts.
 *
 * `position` is 1-based and is the exam's own question order.
 */
export type ExamQuestion = {
  position: number;
  vocabularyEntryId: string;
  direction: Direction;
};

/**
 * Draws an exam's whole question set up front.
 *
 * Practice Mode asks `selectQuestion` one question at a time against the live
 * selection. An exam cannot work that way: the learner is told how many
 * questions there are before the first one, the pool must not shift under them
 * if they open Settings mid-exam, and no entry may be asked twice. So the set is
 * drawn once, here, and written down.
 *
 * The draw is still the normal weighted policy, so an exam keeps preferring
 * words the learner gets wrong. Each pick is simply removed from the pool before
 * the next, which is what makes duplicates impossible, and the length is capped
 * by the pool: asking for 20 with 12 eligible entries yields 12 questions
 * rather than repeating any of them.
 */
export function buildExamQuestionSet(
  candidates: SelectionCandidate[],
  options: {
    questionCount: number;
    direction: DirectionPreference;
    repetitionPreference: RepetitionPreference;
  },
  random: Random,
): ExamQuestion[] {
  const length = Math.max(0, Math.min(options.questionCount, candidates.length));
  const remaining = [...candidates];
  const questions: ExamQuestion[] = [];
  for (let position = 1; position <= length; position += 1) {
    const selection = selectQuestion(
      remaining,
      {
        repetitionPreference: options.repetitionPreference,
        previousEntryId: null,
      },
      random,
    );
    if (!selection) break;
    const index = remaining.findIndex((candidate) => candidate.id === selection.id);
    remaining.splice(index, 1);
    questions.push({
      position,
      vocabularyEntryId: selection.id,
      direction: resolveDirection(options.direction, random),
    });
  }
  return questions;
}

// Deterministic generator (mulberry32) for reproducible tests.
export function createSeededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
