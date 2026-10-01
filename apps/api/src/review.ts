import type { AttemptDirection } from '@taptalk/shared';

/**
 * The result-review mapping: which side of a vocabulary entry is the question, and
 * which side is the answer the learner owed.
 *
 * A review item has to distinguish three different things, and conflating any two of
 * them is what this module exists to prevent:
 *
 *   prompt           -- the side shown as the question
 *   submittedAnswer  -- what the learner typed
 *   correctAnswer    -- the side they were expected to produce
 *
 * The direction decides the split. For an English -> German question the prompt is
 * the English and the expected answer is the German; for German -> English it is the
 * other way round. Returning the German unconditionally makes a German -> English
 * review print the question back at the learner as the correct answer.
 *
 * This is the single written statement of the rule. The guest store calls it; the
 * persisted exam review expresses the same rule in SQL, and `review.test.ts` pins the
 * two together so they cannot drift apart again.
 */

export type ReviewEntry = {
  english: string;
  germanDisplay: string;
};

/**
 * The answer the learner owed for one question.
 *
 * `fallbackPrompt` is used only when the vocabulary entry has since been deleted:
 * attempts keep their prompt, so the question is still answerable and the review can
 * still show something better than an empty field.
 */
export function correctAnswerFor(
  direction: AttemptDirection,
  entry: ReviewEntry | undefined,
  fallbackPrompt: string,
): string {
  if (!entry) return fallbackPrompt;
  return direction === 'english-to-german' ? entry.germanDisplay : entry.english;
}
