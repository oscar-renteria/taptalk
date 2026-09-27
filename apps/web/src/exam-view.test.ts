// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExam } from './exam';
import { setLocale } from './i18n';
import { mockApi, mountApp, signedIn } from './test-api';

const question = {
  vocabularyEntryId: 'entry-1',
  direction: 'english-to-german' as const,
  prompt: 'hello',
  phonetics: null,
};

function routes(overrides: Record<string, { status?: number; body?: unknown }> = {}) {
  return {
    ...signedIn,
    'GET /api/v1/settings': { body: { settings: { direction: 'english-to-german' } } },
    'POST /api/v1/exams': {
      status: 201,
      body: { session: { id: 'exam-1', questionCount: 45, answeredCount: 0 } },
    },
    'GET /api/v1/practice/question': { body: { question } },
    'POST /api/v1/exams/exam-1/answer': {
      body: {
        result: { correct: false },
        session: { id: 'exam-1', answeredCount: 1, questionCount: 45 },
      },
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

  it('shows the verdict in the card and moves the card state with it', async () => {
    const wrapper = await startExam();
    expect(wrapper.get('form.practice-card').attributes('data-state')).toBe('answering');
    await wrapper.get('#exam-answer').setValue('wrong');
    await wrapper.get('form.practice-card').trigger('submit');
    await flushPromises();

    const card = wrapper.get('form.practice-card');
    expect(card.attributes('data-state')).toBe('miss');
    // In the card, beside the question, instead of floating above it.
    const verdict = card.get('.practice-card__feedback[data-testid="exam-verdict"]');
    expect(verdict.text()).toBe('✗Incorrect');
    expect(verdict.attributes('data-tone')).toBe('warning');
    expect(verdict.attributes('role')).toBe('alert');
    expect(wrapper.get('#exam-answer').attributes('readonly')).toBeDefined();
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

  it('is built from the practice dashboard parts', async () => {
    mockApi(routes());
    const { wrapper } = await mountApp('/exams');
    expect(wrapper.get('.dashboard .dashboard__hero #exam-title').text()).toBe('Exam mode');
    expect(wrapper.get('.dashboard__intro').text()).toContain('Answer every question from memory');
    expect(wrapper.find('.segmented').exists()).toBe(true);
    expect(wrapper.get('.dashboard__start .btn--large').text()).toBe('Start exam');
    // The class names this screen used before had no rules at all, which is
    // what left it looking nothing like the practice dashboard.
    expect(wrapper.find('.practice-dashboard').exists()).toBe(false);
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
