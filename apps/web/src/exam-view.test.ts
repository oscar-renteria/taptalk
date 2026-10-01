// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExam } from './exam';
import { setLocale } from './i18n';
import { mockApi, mountApp, signedIn } from './test-api';

const question = {
  position: 1,
  direction: 'english-to-german' as const,
  prompt: 'hello',
  phonetics: null,
};

function routes(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  return {
    ...signedIn,
    'GET /api/v1/settings': { body: { settings: { direction: 'english-to-german' } } },
    'GET /api/v1/practice/vocabulary': {
      body: {
        entries: [
          { id: 'entry-1', english: 'hello', german: 'Hallo', enabled: true },
          { id: 'entry-2', english: 'bye', german: 'Tschüss', enabled: true },
        ],
      },
    },
    'POST /api/v1/exams': {
      status: 201,
      body: { session: { id: 'exam-1', questionCount: 45, answeredCount: 0 } },
    },
    'GET /api/v1/exams/exam-1/question': { body: { question } },
    'POST /api/v1/exams/exam-1/answer': {
      // Position and progress only. There is no correctness here to find.
      body: { session: { answeredCount: 1, questionCount: 45, complete: false } },
    },
    ...overrides,
  };
}

/** Starts an exam and returns the mounted view showing the first question. */
async function startExam(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  mockApi(routes(overrides));
  const { wrapper } = await mountApp('/exams');
  const start = wrapper.findAll('button').find((b) => b.text().includes('Start exam'));
  await start!.trigger('click');
  await flushPromises();
  return wrapper;
}

describe('exam screen layout', () => {
  beforeEach(() => {
    resetExam();
  });

  afterEach(() => {
    resetExam();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('shows the exit control, the counter, and the questions left on one row', async () => {
    const wrapper = await startExam();
    const header = wrapper.get('header.practice-bar');
    // One row, in the same order as the practice header: exit, progress, meta.
    const parts = Array.from(header.element.children).map((child) => child.className);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('practice-bar__exit');
    expect(parts[1]).toContain('practice-bar__progress');
    expect(parts[2]).toContain('practice-bar__meta');
  });

  it('translates the questions left instead of showing a raw key', async () => {
    const wrapper = await startExam();
    // The label is a pluralised message: a raw key here means the plural form
    // did not resolve, which reads as "exam.remaining" on screen.
    expect(wrapper.get('[data-testid="exam-remaining"]').text()).toBe('45 questions left');
    expect(wrapper.text()).not.toContain('exam.remaining');

    await setLocale('de');
    expect(wrapper.get('[data-testid="exam-remaining"]').text()).toBe('Noch 45 Fragen');
    await setLocale('es');
    expect(wrapper.get('[data-testid="exam-remaining"]').text()).toBe('Quedan 45 preguntas');
  });

  it('counts the questions left down as the exam is answered', async () => {
    const wrapper = await startExam();
    expect(wrapper.get('[data-testid="session-progress"]').text()).toBe('Question 1 of 45');
    await wrapper.get('#exam-answer').setValue('Hallo');
    await wrapper.get('form.practice-card').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[data-testid="session-progress"]').text()).toBe('Question 2 of 45');
    expect(wrapper.get('[data-testid="exam-remaining"]').text()).toBe('44 questions left');
  });

  it('links the progress bar to the question counter', async () => {
    const wrapper = await startExam();
    const bar = wrapper.get('[role="progressbar"]');
    const label = wrapper.get('[data-testid="session-progress"]');
    // The bar's description is the visible counter, so the two travel together.
    expect(bar.attributes('aria-describedby')).toBe(label.attributes('id'));
    expect(bar.attributes('aria-valuetext')).toBe('Question 1 of 45');
    expect(bar.attributes('aria-label')).toBe('Exam progress');
  });
});

describe('exam question card', () => {
  beforeEach(() => {
    resetExam();
  });

  afterEach(() => {
    resetExam();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('builds the card from the practice card parts', async () => {
    const wrapper = await startExam();
    const card = wrapper.get('form.practice-card');
    // Prompt, phrase, and answer each sit in a padded, divided block, so the
    // text keeps its margin and the phrase cannot overlap the question.
    expect(card.get('.practice-card__prompt > [data-testid="exam-prompt"]').text()).toBe('hello');
    expect(card.get('.practice-card__answer > .practice-card__question').text()).toBe(
      'How do you say this in German?',
    );
    expect(card.find('.practice-card__head').exists()).toBe(false);
    expect(card.get('.practice-action .btn--dark').text()).toBe('Submit answer');
    // The answer field describes the phrase and the question, in reading order.
    expect(wrapper.get('#exam-answer').attributes('aria-describedby')).toBe(
      'exam-prompt-text exam-question-text',
    );
  });

  it('shows no verdict, and no card state, after an answer', async () => {
    const wrapper = await startExam();
    // The card carries no correctness state at all: there is nothing to leak,
    // because nothing was ever told.
    expect(wrapper.get('form.practice-card').attributes('data-state')).toBeUndefined();
    await wrapper.get('#exam-answer').setValue('wrong');
    await wrapper.get('form.practice-card').trigger('submit');
    await flushPromises();

    const card = wrapper.get('form.practice-card');
    expect(card.find('[data-testid="exam-verdict"]').exists()).toBe(false);
    // Not a word, not an icon, not a tone, not an alert, not a class.
    expect(card.text()).not.toMatch(/Correct|Incorrect|✓|✗/);
    // Every channel a verdict could hide in: a test id, a tone, a state, or a
    // class name. (Not the bare word 'correct', which `autocorrect` contains.)
    expect(card.html()).not.toMatch(
      /exam-verdict|data-tone|data-correct|data-state|__correct|__miss/,
    );
    // The answer is locked so it cannot be edited, and the next step is offered.
    expect(wrapper.get('#exam-answer').attributes('readonly')).toBeDefined();
    expect(card.get('.practice-action button').text()).toContain('Next question');
  });

  it('moves to the next question without saying how the last one went', async () => {
    const wrapper = await startExam();
    await wrapper.get('#exam-answer').setValue('Hallo');
    await wrapper.get('form.practice-card').trigger('submit');
    await flushPromises();
    const next = wrapper.get('.practice-action button');
    await next.trigger('click');
    await flushPromises();
    // The next question is asked, and the screen is back to its answering state.
    expect(wrapper.get('[data-testid="session-progress"]').text()).toBe('Question 2 of 45');
    expect(wrapper.get('form.practice-card').attributes('data-state')).toBeUndefined();
    expect(wrapper.text()).not.toMatch(/Correct|Incorrect/);
  });
});

describe('exam start screen', () => {
  beforeEach(() => {
    resetExam();
  });

  afterEach(() => {
    resetExam();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('offers the exam lengths and says how many questions there will be', async () => {
    mockApi(routes());
    const { wrapper } = await mountApp('/exams');
    // The lengths are 5, 10 and 20, and 10 is preselected.
    const values = wrapper
      .findAll('input[name="exam-length"]')
      .map((input) => input.attributes('value'));
    expect(values).toEqual(['5', '10', '20']);
    const checked = wrapper
      .findAll('input[name="exam-length"]')
      .find((input) => (input.element as HTMLInputElement).checked);
    expect(checked?.attributes('value')).toBe('10');
    // The pool here holds two enabled words, so a 10-question request is really
    // two questions, and the screen says so before the exam starts.
    expect(wrapper.get('[data-testid="exam-actual-length"]').text()).toBe(
      'Your enabled vocabulary has 2 words, so this exam has 2 questions.',
    );
  });

  it('does not promise more questions than the vocabulary can supply', async () => {
    mockApi(
      routes({
        'GET /api/v1/practice/vocabulary': {
          body: {
            entries: [
              { id: 'entry-1', english: 'hello', german: 'Hallo', enabled: true },
              { id: 'entry-2', english: 'bye', german: 'Tschüss', enabled: true },
              { id: 'entry-3', english: 'cat', german: 'Katze', enabled: true },
              { id: 'entry-4', english: 'dog', german: 'Hund', enabled: true },
            ],
          },
        },
      }),
    );
    const { wrapper } = await mountApp('/exams');
    // Four enabled words cannot make a 10-question exam.
    expect(wrapper.get('[data-testid="exam-actual-length"]').text()).toBe(
      'Your enabled vocabulary has 4 words, so this exam has 4 questions.',
    );
  });

  it('opens a past result from the Progress history link', async () => {
    // Progress links here with ?result=<id>, which used to be ignored, so the
    // link landed on the start screen and the past result was unreachable.
    mockApi(
      routes({
        'GET /api/v1/exams/exam-9': {
          body: {
            result: {
              id: 'exam-9',
              direction: 'english-to-german',
              status: 'completed',
              totalQuestions: 2,
              correctCount: 1,
              incorrectCount: 1,
              score: 50,
              durationSeconds: 65,
              startedAt: '2026-01-01T00:00:00.000Z',
              endedAt: '2026-01-01T00:01:05.000Z',
              questions: [
                {
                  index: 1,
                  vocabularyEntryId: 'entry-1',
                  prompt: 'hello',
                  direction: 'english-to-german',
                  submittedAnswer: 'Hallo',
                  correctAnswer: 'Hallo',
                  correct: true,
                },
              ],
            },
          },
        },
      }),
    );
    const { wrapper } = await mountApp('/exams?result=exam-9');
    await flushPromises();
    // The stored result is shown, not a new exam.
    expect(wrapper.find('.exam-results').exists()).toBe(true);
    expect(wrapper.text()).toContain('Exam results');
    expect(wrapper.get('.stat').text()).toContain('50%');
    // And the start screen is not rendered behind it.
    expect(wrapper.find('form.practice-card').exists()).toBe(false);
  });

  it('ignores a result id the server does not know', async () => {
    mockApi(routes({ 'GET /api/v1/exams/exam-missing': { status: 404, body: {} } }));
    const { wrapper } = await mountApp('/exams?result=exam-missing');
    await flushPromises();
    // Nothing is shown rather than something wrong: the start screen stands.
    expect(wrapper.find('.exam-results').exists()).toBe(false);
    expect(wrapper.get('.dashboard__start').text()).toContain('Start exam');
  });

  it('shows the authoritative correct answer, not the question, for a miss', async () => {
    // The reported bug: a German -> English review repeated the German prompt as
    // the correct answer. The API is the only source of both fields; the view
    // must render them as two separate things.
    mockApi(
      routes({
        'GET /api/v1/exams/exam-review': {
          body: {
            result: {
              id: 'exam-review',
              direction: 'german-to-english',
              status: 'completed',
              totalQuestions: 1,
              correctCount: 0,
              incorrectCount: 1,
              score: 0,
              durationSeconds: 30,
              startedAt: '2026-01-01T00:00:00.000Z',
              endedAt: '2026-01-01T00:00:30.000Z',
              questions: [
                {
                  index: 1,
                  vocabularyEntryId: 'entry-1',
                  prompt: 'Das (hier) ist',
                  direction: 'german-to-english',
                  submittedAnswer: 'wrong thing',
                  correctAnswer: 'That is',
                  correct: false,
                },
              ],
            },
          },
        },
      }),
    );
    const { wrapper } = await mountApp('/exams?result=exam-review');
    await flushPromises();
    expect(wrapper.find('.exam-results').exists()).toBe(true);
    const review = wrapper.get('.exam-review').text();
    expect(review).toContain('Das (hier) ist');
    expect(review).toContain('That is');
    expect(review).toContain('Incorrect');
    // The correct answer must not be the question again.
    expect(review).not.toContain('Correct answer: Das (hier) ist');
  });

  it('shows the correct answer for an English -> German miss', async () => {
    mockApi(
      routes({
        'GET /api/v1/exams/exam-forward': {
          body: {
            result: {
              id: 'exam-forward',
              direction: 'english-to-german',
              status: 'completed',
              totalQuestions: 1,
              correctCount: 0,
              incorrectCount: 1,
              score: 0,
              durationSeconds: 30,
              startedAt: '2026-01-01T00:00:00.000Z',
              endedAt: '2026-01-01T00:00:30.000Z',
              questions: [
                {
                  index: 1,
                  vocabularyEntryId: 'entry-1',
                  prompt: 'That is',
                  direction: 'english-to-german',
                  submittedAnswer: 'falsch',
                  correctAnswer: 'Das (hier) ist',
                  correct: false,
                },
              ],
            },
          },
        },
      }),
    );
    const { wrapper } = await mountApp('/exams?result=exam-forward');
    await flushPromises();
    const review = wrapper.get('.exam-review').text();
    expect(review).toContain('That is');
    expect(review).toContain('Das (hier) ist');
    expect(review).not.toContain('Correct answer: That is');
  });

  it('keeps hiding the correct answer for a correct response', async () => {
    mockApi(
      routes({
        'GET /api/v1/exams/exam-right': {
          body: {
            result: {
              id: 'exam-right',
              direction: 'english-to-german',
              status: 'completed',
              totalQuestions: 1,
              correctCount: 1,
              incorrectCount: 0,
              score: 100,
              durationSeconds: 30,
              startedAt: '2026-01-01T00:00:00.000Z',
              endedAt: '2026-01-01T00:00:30.000Z',
              questions: [
                {
                  index: 1,
                  vocabularyEntryId: 'entry-1',
                  prompt: 'hello',
                  direction: 'english-to-german',
                  submittedAnswer: 'Hallo',
                  correctAnswer: 'Hallo',
                  correct: true,
                },
              ],
            },
          },
        },
      }),
    );
    const { wrapper } = await mountApp('/exams?result=exam-right');
    await flushPromises();
    const review = wrapper.get('.exam-review').text();
    expect(review).toContain('Correct');
    expect(review).not.toContain('Correct answer');
  });
});

describe('exam section naming', () => {
  beforeEach(() => {
    resetExam();
  });

  afterEach(() => {
    resetExam();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps a heading for the section while an exam runs', async () => {
    const wrapper = await startExam();
    // The hero is gone during an exam, so aria-labelledby must still resolve.
    const heading = wrapper.find('#exam-title');
    expect(heading.exists()).toBe(true);
    expect(heading.classes()).toContain('visually-hidden');
    expect(heading.text()).toBe('Exam question');
  });

  it('resolves every component the template uses', async () => {
    // An unimported component renders nothing, which is how a missing loading
    // state turned into a blank space while a question was on its way.
    const unresolved: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      const message = String(args[0]);
      if (message.includes('Failed to resolve component')) unresolved.push(message);
    });
    try {
      const wrapper = await startExam();
      await wrapper.get('#exam-answer').setValue('wrong');
      await wrapper.get('form.practice-card').trigger('submit');
      await flushPromises();
    } finally {
      warn.mockRestore();
    }
    expect(unresolved).toEqual([]);
  });
});
