// Answer matching policy v1. See docs/architecture/answer-matching.md. Pure and deterministic:
// no framework, database, or approximate matching.

export type MatchReason =
  'exact-match' | 'normalized-match' | 'empty-answer' | 'invalid-answer' | 'incorrect';

export type MatchResult = {
  correct: boolean;
  reason: MatchReason;
  normalizedAnswer: string;
};

export const maxAnswerLength = 200;
const maxOptionalGroups = 3;

// Characters with no meaning for a typed vocabulary answer. Hyphens and apostrophes are kept
// because they change words ("E-Mail", "geht's").
const ignoredPunctuation = /[.,!?;:¡¿"“”„«»‹›]/gu;
const ellipsis = /\.{3,}|…/gu;
const typographicApostrophes = /[’‘ʼ`´]/gu;
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f]/u;

export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFKC')
    .replace(ellipsis, ' ')
    .replace(typographicApostrophes, "'")
    .replace(ignoredPunctuation, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('de-DE');
}

// "(sich) freuen" accepts "sich freuen" and "freuen". Only the first few groups are expanded so a
// malformed entry cannot produce an unbounded number of variants.
export function expandAcceptedAnswer(answer: string): string[] {
  const groups = [...answer.matchAll(/\(([^()]*)\)/gu)].slice(0, maxOptionalGroups);
  let variants = [answer];
  for (const group of groups) {
    variants = variants.flatMap((variant) => [
      variant.replace(group[0], group[1] ?? ''),
      variant.replace(group[0], ''),
    ]);
  }
  return [...new Set(variants.map((variant) => variant.replace(/\s+/gu, ' ').trim()))].filter(
    Boolean,
  );
}

export function matchAnswer(submittedAnswer: string, acceptedAnswers: string[]): MatchResult {
  const normalizedAnswer = normalizeAnswer(submittedAnswer);
  if (
    submittedAnswer.length > maxAnswerLength ||
    controlCharacters.test(submittedAnswer.replace(/[\t\n\r]/gu, ''))
  ) {
    return { correct: false, reason: 'invalid-answer', normalizedAnswer: '' };
  }
  if (normalizedAnswer.length === 0) {
    return { correct: false, reason: 'empty-answer', normalizedAnswer };
  }
  const variants = acceptedAnswers.flatMap(expandAcceptedAnswer);
  const trimmed = submittedAnswer.normalize('NFC').trim();
  if (variants.some((variant) => variant.normalize('NFC') === trimmed)) {
    return { correct: true, reason: 'exact-match', normalizedAnswer };
  }
  if (variants.some((variant) => normalizeAnswer(variant) === normalizedAnswer)) {
    return { correct: true, reason: 'normalized-match', normalizedAnswer };
  }
  return { correct: false, reason: 'incorrect', normalizedAnswer };
}
