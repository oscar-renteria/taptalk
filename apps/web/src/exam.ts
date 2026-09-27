import { reactive } from 'vue';
import { apiFetch, jsonRequest } from './api';
import type { ExamHistoryEntry, ExamResult, ExamStatistics } from '@taptalk/shared';

/**
 * Exam Mode state.
 *
 * An exam is the existing question flow with one rule: the server returns only
 * whether an answer was correct, and the result is unreadable until the exam
 * ends. Nothing here ever holds a correct answer during an exam, so there is
 * nothing for the UI to leak by accident.
 *
 * Follows the app's existing state pattern: one module-level `reactive` object,
 * like `session` and `practiceVocabulary`.
 */
export const exam = reactive({
  sessionId: '' as string,
  questionCount: 0,
  answeredCount: 0,
  /** The most recent verdict, shown as a single word plus an icon. Nothing else. */
  lastCorrect: null as boolean | null,
  result: null as ExamResult | null,
  history: [] as ExamHistoryEntry[],
  statistics: null as ExamStatistics | null,
  loading: false,
  ending: false,
  /** '' | 'start' | 'answer' | 'end' | 'vocabulary' */
  failed: '' as '' | 'start' | 'answer' | 'end' | 'vocabulary',
});

/** Test helper: returns the view to its starting state. */
export function resetExam(): void {
  exam.sessionId = '';
  exam.questionCount = 0;
  exam.answeredCount = 0;
  exam.lastCorrect = null;
  exam.result = null;
  exam.history = [];
  exam.statistics = null;
  exam.loading = false;
  exam.ending = false;
  exam.failed = '';
}

/** True while an exam is running, before any results exist. */
export function examInProgress(): boolean {
  return !!exam.sessionId && !exam.result;
}

export async function startExam(direction: string): Promise<boolean> {
  exam.loading = true;
  exam.failed = '';
  try {
    const response = await apiFetch('/api/v1/exams', jsonRequest('POST', { direction }));
    const payload = (await response.json()) as {
      session?: { id: string; questionCount: number };
      error?: { code?: string; message?: string };
    };
    if (!response.ok || !payload.session) {
      // The API's message is developer English, so the user sees a localized one.
      exam.failed = payload.error?.code === 'NO_PRACTICE_VOCABULARY' ? 'vocabulary' : 'start';
      return false;
    }
    exam.sessionId = payload.session.id;
    exam.questionCount = payload.session.questionCount;
    exam.answeredCount = 0;
    exam.lastCorrect = null;
    exam.result = null;
    return true;
  } catch {
    exam.failed = 'start';
    return false;
  } finally {
    exam.loading = false;
  }
}

/**
 * Submits an answer and keeps only the verdict. The response carries no answer,
 * no reason, and no score, so the UI has nothing more to show.
 */
export async function submitExamAnswer(
  question: {
    vocabularyEntryId: string;
    direction: 'english-to-german' | 'german-to-english';
  },
  submittedAnswer: string,
): Promise<boolean> {
  const response = await apiFetch(
    `/api/v1/exams/${exam.sessionId}/answer`,
    jsonRequest('POST', {
      vocabularyEntryId: question.vocabularyEntryId,
      direction: question.direction,
      submittedAnswer,
    }),
  );
  if (!response.ok) {
    exam.failed = 'answer';
    return false;
  }
  const payload = (await response.json()) as {
    result: { correct: boolean };
    session: { answeredCount: number };
  };
  exam.lastCorrect = payload.result.correct;
  exam.answeredCount = payload.session.answeredCount;
  return true;
}

/** Ends the exam and takes the result, which is the first time answers appear. */
export async function endExam(): Promise<void> {
  exam.ending = true;
  try {
    const response = await apiFetch(`/api/v1/exams/${exam.sessionId}/end`, jsonRequest('POST', {}));
    const payload = (await response.json()) as { result?: ExamResult | null };
    exam.result = payload.result ?? null;
    exam.sessionId = '';
  } catch {
    exam.failed = 'end';
  } finally {
    exam.ending = false;
  }
}

/** Loads history and aggregates for the Progress page, in parallel. */
export async function loadExamProgress(): Promise<void> {
  exam.loading = true;
  try {
    const [history, statistics] = await Promise.all([
      apiFetch('/api/v1/exams'),
      apiFetch('/api/v1/exams/statistics'),
    ]);
    const historyBody = (await history.json()) as { history?: ExamHistoryEntry[] };
    const statisticsBody = (await statistics.json()) as { statistics?: ExamStatistics };
    if (history.ok && historyBody.history) exam.history = historyBody.history;
    if (statistics.ok && statisticsBody.statistics) exam.statistics = statisticsBody.statistics;
  } catch {
    // A missing exam section must not take the Practice statistics down with it.
  } finally {
    exam.loading = false;
  }
}

export type { ExamResult, ExamHistoryEntry, ExamStatistics };
