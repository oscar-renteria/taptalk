export function calculateScore(correct: boolean, priorErrorsInSession: number): number {
  if (!correct) {
    return 0;
  }
  return Math.max(1, 10 - Math.max(0, priorErrorsInSession) * 2);
}
