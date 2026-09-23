export type MatchReason = 'empty-answer' | 'exact-match' | 'incorrect';

export type MatchResult = {
  correct: boolean;
  reason: MatchReason;
  normalizedAnswer: string;
};

export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[.,!?;:]+$/u, '');
}

export function matchAnswer(submittedAnswer: string, acceptedAnswers: string[]): MatchResult {
  const normalizedAnswer = normalizeAnswer(submittedAnswer);
  if (normalizedAnswer.length === 0) {
    return { correct: false, reason: 'empty-answer', normalizedAnswer };
  }
  const correct = acceptedAnswers.some((answer) => normalizeAnswer(answer) === normalizedAnswer);
  return { correct, reason: correct ? 'exact-match' : 'incorrect', normalizedAnswer };
}

export function calculateScore(correct: boolean, priorErrorsInSession: number): number {
  if (!correct) {
    return 0;
  }
  return Math.max(1, 10 - Math.max(0, priorErrorsInSession) * 2);
}
