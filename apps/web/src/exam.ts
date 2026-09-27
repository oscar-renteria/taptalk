import { reactive } from 'vue';
import { apiFetch, jsonRequest } from './api';
import type { ExamHistoryEntry, ExamResult, ExamStatistics } from '@taptalk/shared';

/**
 * Exam Mode state.
 *
 * An exam is the existing question flow with one rule: the client never learns
 * whether an answer was right. The server sends position and nothing else, so
 * there is no correctness anywhere in this module for the UI to leak by
 * accident — no field to render, no class to bind, no label to announce. The
 * evaluation is readable only once the exam has ended.
 *
 * Follows the app's existing state pattern: one module-level `reactive` object,
 * like `session` and `practiceVocabulary`.
 */
export const exam = reactive({
  sessionId: '' as string,
  questionCount: 0,
  answeredCount: 0,
  /** The question being answered, as the frozen set serves it. */
  position: 0,
  /** True once the server has accepted the last answer. */
  complete: false,
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
  exam.position = 0;
  exam.complete = false;
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

export async function startExam(direction: string, questionCount: number): Promise<boolean> {
  exam.loading = true;
  exam.failed = '';
  try {
    const response = await apiFetch(
      '/api/v1/exams',
      jsonRequest('POST', { direction, questionCount }),
    );
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
    // The server's count, not the requested one: a pool smaller than the request
    // produces a shorter exam, and the learner is told the length they will get.
    exam.questionCount = payload.session.questionCount;
    exam.answeredCount = 0;
    exam.position = 1;
    exam.complete = false;
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
 * Submits an answer for the current position and keeps only the progress.
 *
 * The request carries a position and an answer, and the response carries a
 * position and a count. Correctness is matched on the server and stays there
 * until the exam is over, so there is nothing here that could reveal it.
 */
export async function submitExamAnswer(
  position: number,
  submittedAnswer: string,
): Promise<boolean> {
  const response = await apiFetch(
    `/api/v1/exams/${exam.sessionId}/answer`,
    jsonRequest('POST', { position, submittedAnswer }),
  );
  if (!response.ok) {
    exam.failed = 'answer';
    return false;
  }
  const payload = (await response.json()) as {
    session: { answeredCount: number; questionCount: number; complete: boolean };
  };
  exam.answeredCount = payload.session.answeredCount;
  exam.complete = payload.session.complete;
  return true;
}

/** Leaves an unfinished exam. The server records it as abandoned, not as a result. */
export async function abandonExam(): Promise<void> {
  if (!exam.sessionId) return;
  try {
    await apiFetch(`/api/v1/exams/${exam.sessionId}/abandon`, jsonRequest('POST', {}));
  } catch {
    // Leaving must always work, even if the server cannot be reached. The
    // session is then left 'active' and is excluded from every statistic anyway.
  }
  exam.sessionId = '';
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

/**
 * Reads a finished exam by id, for the history rows on the Progress page.
 *
 * The server refuses an exam that is still running, so this cannot be used to
 * read a result before the exam has been evaluated. A result that is missing, or
 * belongs to someone else, simply leaves the screen as it was.
 */
export async function loadExamResult(sessionId: string): Promise<boolean> {
  exam.loading = true;
  exam.failed = '';
  try {
    const response = await apiFetch(`/api/v1/exams/${encodeURIComponent(sessionId)}`);
    if (!response.ok) return false;
    const payload = (await response.json()) as { result?: ExamResult | null };
    if (!payload.result) return false;
    exam.result = payload.result;
    return true;
  } catch {
    return false;
  } finally {
    exam.loading = false;
  }
}

export type { ExamResult, ExamHistoryEntry, ExamStatistics };
