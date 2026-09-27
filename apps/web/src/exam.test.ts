// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exam, resetExam } from './exam';
import { mockApi, mountApp, signedIn } from './test-api';

const germanAnswer = 'Hallo';

/** The question the mock always returns. */
const question = {
  vocabularyEntryId: 'entry-hello',
  direction: 'english-to-german' as const,
  prompt: 'hello',
  phonetics: null,
};

function examApi(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  return {
    ...signedIn,
    'GET /api/v1/settings': {
      body: {
        settings: {
          direction: 'english-to-german',
          sessionLength: 1,
          repetitionPreference: 'balanced',
        },
      },
    },
    'POST /api/v1/exams': {
      status: 201,
      body: { session: { id: 'exam-1', questionCount: 1, answeredCount: 0 } },
    },
    'GET /api/v1/practice/question': { body: { question } },
    'POST /api/v1/exams/exam-1/answer': {
      body: {
        result: { correct: true },
        session: { id: 'exam-1', answeredCount: 1, questionCount: 1 },
      },
    },
    'POST /api/v1/exams/exam-1/end': {
      body: {
        result: {
          id: 'exam-1',
          direction: 'english-to-german',
          status: 'completed',
          totalQuestions: 1,
          correctCount: 1,
          incorrectCount: 0,
          score: 100,
          durationSeconds: 42,
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:42.000Z',
          questions: [
            {
              index: 1,
              vocabularyEntryId: 'entry-hello',
              prompt: 'hello',
              direction: 'english-to-german',
              submittedAnswer: germanAnswer,
              correctAnswer: germanAnswer,
              correct: true,
            },
          ],
        },
      },
    },
    'GET /api/v1/dashboard': {
      body: {
        dashboard: { totalPoints: 0, totalAttempts: 0, accuracy: 0, repeatedErrorWords: [] },
      },
    },
    ...overrides,
  };
}

/** Starts an exam and answers the single question. */
async function playExam() {
  const { wrapper } = await mountApp('/exams');
  await flushPromises();
  await wrapper
    .findAll('button')
    .find((b) => b.text().includes('Start exam'))!
    .trigger('click');
  await flushPromises();
  await wrapper.get('#exam-answer').setValue(germanAnswer);
  await wrapper.get('form.practice-card').trigger('submit');
  await flushPromises();
  return wrapper;
}

describe('exam mode state', () => {
  beforeEach(() => {
    resetExam();
  });

  afterEach(() => {
    resetExam();
  });

  it('keeps only the verdict from a submitted answer', async () => {
    mockApi(examApi());
    await mountApp('/exams');
    await flushPromises();
    await examAndSubmit();
    // The store holds correctness and progress, and nothing that could be an answer.
    expect(exam.lastCorrect).toBe(true);
    expect(JSON.stringify(exam)).not.toMatch(/correctAnswer/);
  });
});

async function examAndSubmit(): Promise<void> {
  const { startExam, submitExamAnswer } = await import('./exam');
  await startExam('english-to-german');
  await submitExamAnswer(
    { vocabularyEntryId: question.vocabularyEntryId, direction: question.direction },
    germanAnswer,
  );
}

describe('an exam only shows correctness while it runs', () => {
  beforeEach(() => {
    resetExam();
  });

  afterEach(() => {
    resetExam();
  });

  it('does not render the correct answer anywhere on the question screen', async () => {
    mockApi(examApi());
    const { wrapper } = await mountApp('/exams');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Start exam'))!
      .trigger('click');
    await flushPromises();

    const text = wrapper.text();
    // The prompt is shown; the answer and the result are not.
    expect(text).toContain('hello');
    expect(text).not.toContain(germanAnswer);
    expect(text).not.toContain('Correct answer');
    expect(text).not.toContain('Review');
    // No element carries the answer as a hidden attribute or aria text either.
    expect(wrapper.html()).not.toContain(germanAnswer);
  });

  it('shows a single word of feedback after a correct answer', async () => {
    mockApi(examApi());
    const { wrapper } = await mountApp('/exams');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Start exam'))!
      .trigger('click');
    await flushPromises();
    await wrapper.get('#exam-answer').setValue(germanAnswer);
    await wrapper.get('form.practice-card').trigger('submit');
    await flushPromises();

    // The result replaced the running screen; still nothing during the exam.
    expect(exam.result).not.toBeNull();
    // Now, and only now, the review exists.
    expect(wrapper.text()).toContain('Review your answers');
    expect(wrapper.text()).toContain('Correct');
  });

  it('shows Incorrect and no answer after a wrong answer', async () => {
    mockApi(
      examApi({
        'GET /api/v1/practice/question': { body: { question } },
        'POST /api/v1/exams/exam-1/answer': {
          body: {
            result: { correct: false },
            session: { id: 'exam-1', answeredCount: 0, questionCount: 2 },
          },
        },
      }),
    );
    const { wrapper } = await mountApp('/exams');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Start exam'))!
      .trigger('click');
    await flushPromises();
    await wrapper.get('#exam-answer').setValue('wrong');
    await wrapper.get('form.practice-card').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Incorrect');
    expect(wrapper.text()).not.toContain('Correct answer');
  });

  it('uses the same no-autocorrect answer field as Practice Mode', async () => {
    mockApi(examApi());
    const { wrapper } = await mountApp('/exams');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Start exam'))!
      .trigger('click');
    await flushPromises();

    const field = wrapper.get('#exam-answer').element as HTMLInputElement;
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(field.getAttribute('autocapitalize')).toBe('none');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.getAttribute('autocomplete')).toBe('off');
  });
});

describe('exam results and review', () => {
  beforeEach(() => {
    resetExam();
  });

  afterEach(() => {
    resetExam();
  });

  it('shows the score, counts, duration, and the review after the exam', async () => {
    mockApi(examApi());
    const wrapper = await playExam();
    expect(wrapper.text()).toContain('Exam results');
    expect(wrapper.text()).toContain('100%');
    expect(wrapper.text()).toContain('1 / 1');
    expect(wrapper.text()).toContain('Review your answers');
    expect(exam.result?.score).toBe(100);
    expect(exam.result?.durationSeconds).toBe(42);
  });

  it('marks each reviewed question with a word, not only colour', async () => {
    mockApi(examApi());
    const wrapper = await playExam();
    const item = wrapper.get('.exam-review__item');
    expect(item.attributes('data-correct')).toBe('true');
    // The verdict text and icon are both present, so meaning is not colour-only.
    expect(item.text()).toContain('Correct');
    expect(item.text()).toContain('✓');
  });

  it('asks before leaving an exam and discards it if confirmed', async () => {
    mockApi(examApi());
    const { wrapper } = await mountApp('/exams');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Start exam'))!
      .trigger('click');
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Exit exam'))!
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Leave exam?');
    // Staying keeps the exam.
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Keep going'))!
      .trigger('click');
    await flushPromises();
    expect(exam.sessionId).not.toBe('');
    // Leaving discards it, and records nothing.
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Exit exam'))!
      .trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Leave exam')!
      .trigger('click');
    await flushPromises();
    expect(exam.sessionId).toBe('');
    expect(exam.result).toBeNull();
  });

  it('explains that no vocabulary is selected rather than starting broken', async () => {
    mockApi(
      examApi({
        'POST /api/v1/exams': {
          status: 404,
          body: { error: { code: 'NO_PRACTICE_VOCABULARY', message: 'dev text' } },
        },
      }),
    );
    const { wrapper } = await mountApp('/exams');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Start exam'))!
      .trigger('click');
    await flushPromises();
    // A localized message, not the API's English one.
    expect(wrapper.text()).toContain('No vocabulary is currently selected for practice.');
    expect(wrapper.text()).not.toContain('dev text');
  });
});
