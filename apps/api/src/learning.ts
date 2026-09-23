// Scoring policy v1. See docs/architecture/scoring.md. Pure and deterministic.

export const pointsForCorrectAnswer = 10;
export const penaltyPerPriorError = 2;
export const minimumPointsForCorrectAnswer = 1;

// `priorErrorsInSession` is the number of earlier incorrect attempts at the same vocabulary entry in
// the same practice session. It is always computed on the server, never taken from the client.
export function calculateScore(correct: boolean, priorErrorsInSession: number): number {
  if (!correct) {
    return 0;
  }
  const priorErrors = Number.isFinite(priorErrorsInSession)
    ? Math.max(0, Math.floor(priorErrorsInSession))
    : 0;
  return Math.max(
    minimumPointsForCorrectAnswer,
    pointsForCorrectAnswer - priorErrors * penaltyPerPriorError,
  );
}
