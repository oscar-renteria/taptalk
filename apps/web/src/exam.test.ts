// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exam, resetExam } from './exam';
import { mockApi, mountApp, signedIn } from './test-api';

const germanAnswer = 'Hallo';

/** The question the mock always returns. */
const question = {
  position: 1,
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
    'GET /api/v1/practice/vocabulary': {
      body: {
        entries: [
          { id: 'entry-hello', english: 'hello', german: 'Hallo', enabled: true },
          { id: 'entry-bye', english: 'bye', german: 'Tschüss', enabled: true },
        ],
      },
    },
    'POST /api/v1/exams': {
      status: 201,
      body: { session: { id: 'exam-1', questionCount: 1, answeredCount: 0 } },
    },
    'GET /api/v1/exams/exam-1/question': { body: { question } },
    'POST /api/v1/exams/exam-1/answer': {
      // Progress only. Correctness is not in the response at all, so the client
      // has nothing to hold and nothing to leak.
      body: { session: { answeredCount: 1, questionCount: 1, complete: true } },
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

  it('keeps only progress from a submitted answer, never correctness', async () => {
    mockApi(examApi());
    await mountApp('/exams');
    await flushPromises();
    await examAndSubmit();
    // The store holds progress. There is no field anywhere in it that could say
    // whether the answer was right, so no view can render one by accident.
    expect(exam.answeredCount).toBe(1);
    expect(exam.complete).toBe(true);
    expect(Object.keys(exam).join(',')).not.toMatch(/correct|verdict|score/i);
    expect(JSON.stringify(exam)).not.toMatch(/correctAnswer|correctCount|score/);
  });
});

async function examAndSubmit(): Promise<void> {
  const { startExam, submitExamAnswer } = await import('./exam');
  await startExam('english-to-german', 5);
  await submitExamAnswer(1, germanAnswer);
}

describe('an exam reveals nothing about correctness while it runs', () => {
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

  it('says nothing at all about a wrong answer', async () => {
    // A two-question exam, so the screen keeps going after the first answer and
    // the learner sees exactly what a wrong answer looks like: the same as a
    // right one, because it is the same.
    mockApi(
      examApi({
        'POST /api/v1/exams': {
          status: 201,
          body: { session: { id: 'exam-1', questionCount: 2, answeredCount: 0 } },
        },
        'POST /api/v1/exams/exam-1/answer': {
          body: { session: { answeredCount: 1, questionCount: 2, complete: false } },
        },
        'GET /api/v1/exams/exam-1/question': { body: { question: { ...question, position: 1 } } },
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

    // The whole screen, after a wrong answer. No verdict word, no tick, no
    // cross, no correctness in a class, a role, or an attribute.
    expect(wrapper.text()).not.toMatch(/Correct|Incorrect|Right|Wrong|Score|%/);
    expect(wrapper.html()).not.toMatch(
      /✓|✗|exam-verdict|data-tone|data-correct|data-state|__correct|__miss/,
    );
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    // Only that the answer was recorded, and that the exam is not over.
    expect(wrapper.text()).toContain('Answer recorded');
    expect(wrapper.text()).toContain('Next question');
  });

  it('shows the review only once the exam has been evaluated', async () => {
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

    // The last answer completed the exam, so the results replaced the running
    // screen. This, and only this, is where correctness is allowed to appear.
    expect(exam.result).not.toBeNull();
    expect(wrapper.text()).toContain('Review your answers');
    expect(wrapper.text()).toContain('Correct');
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
