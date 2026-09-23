// @vitest-environment happy-dom

import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, mountApp, signedIn } from './test-api';

const question = {
  vocabularyEntryId: 'entry-1',
  direction: 'english-to-german',
  prompt: 'hello',
  phonetics: 'həˈləʊ',
};
const session = { id: 'session-1', questionCount: 3, answeredCount: 0 };
const baseRoutes = {
  ...signedIn,
  'GET /api/v1/settings': { body: { settings: { direction: 'english-to-german' } } },
  'POST /api/v1/practice/sessions': { status: 201, body: { session } },
  'GET /api/v1/practice/question': { body: { question } },
};

function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!match) throw new Error(`No button "${label}" in: ${wrapper.text()}`);
  return match;
}

async function startSession(routes: Parameters<typeof mockApi>[0] = {}) {
  const fetchMock = mockApi({ ...baseRoutes, ...routes });
  const { wrapper } = await mountApp('/practice');
  await button(wrapper, 'Start practice').trigger('click');
  await flushPromises();
  return { wrapper, fetchMock };
}

function answerCalls(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/v1/practice/answer');
}

describe('practice screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('preselects the saved direction', async () => {
    mockApi(baseRoutes);
    const { wrapper } = await mountApp('/practice');
    expect((wrapper.get('#direction').element as HTMLSelectElement).value).toBe(
      'english-to-german',
    );
  });

  it('shows the prompt, phonetics and progress, and focuses the answer field', async () => {
    const { wrapper } = await startSession();
    expect(wrapper.get('[data-testid="practice-prompt"]').text()).toBe('hello');
    expect(wrapper.text()).toContain('həˈləʊ');
    expect(wrapper.get('[data-testid="session-progress"]').text()).toBe('Question 1 of 3');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('0');
    expect(document.activeElement?.id).toBe('answer');
  });

  it('confirms a correct answer with a success tone and moves focus to the next action', async () => {
    const { wrapper } = await startSession({
      'POST /api/v1/practice/answer': {
        body: {
          result: { correct: true, scoreDelta: 10, correctAnswer: 'hallo' },
          session: { id: 'session-1', answeredCount: 1, questionCount: 3 },
        },
      },
    });
    await wrapper.get('#answer').setValue('hallo');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const feedback = wrapper.get('[role="status"].status');
    expect(feedback.text()).toBe('Correct. +10 points.');
    expect(feedback.attributes('data-tone')).toBe('success');
    expect(wrapper.get('#answer').attributes('readonly')).toBeDefined();
    expect(document.activeElement?.textContent?.trim()).toBe('Next question');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('1');
  });

  it('explains a wrong answer with a neutral tone, not an error', async () => {
    const { wrapper } = await startSession({
      'POST /api/v1/practice/answer': {
        body: {
          result: { correct: false, scoreDelta: 0, correctAnswer: 'hallo' },
          session: { id: 'session-1', answeredCount: 1, questionCount: 3 },
        },
      },
    });
    await wrapper.get('#answer').setValue('falsch');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const feedback = wrapper.get('.status');
    expect(feedback.text()).toBe('Not quite. The answer is hallo.');
    expect(feedback.attributes('data-tone')).toBe('warning');
    expect(feedback.attributes('role')).toBe('status');
  });

  it('shows the checking state and sends one request for repeated submits', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const { wrapper, fetchMock } = await startSession();
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      input === '/api/v1/practice/answer'
        ? (fetchMock(input, init), new Promise((done) => (resolve = done)))
        : base(input, init),
    );
    await wrapper.get('#answer').setValue('hallo');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(answerCalls(fetchMock)).toHaveLength(1);
    const submit = wrapper.get('button[type="submit"]');
    expect(submit.text()).toBe('Checking...');
    expect(submit.attributes('aria-busy')).toBe('true');
    expect(submit.attributes('disabled')).toBeDefined();

    resolve({
      ok: true,
      status: 200,
      json: async () => ({
        result: { correct: true, scoreDelta: 10, correctAnswer: 'hallo' },
        session: { id: 'session-1', answeredCount: 1, questionCount: 3 },
      }),
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Correct. +10 points.');
  });

  it('keeps the answer editable after a failed submission so it can be retried', async () => {
    const { wrapper, fetchMock } = await startSession({
      'POST /api/v1/practice/answer': [
        { status: 500, body: { error: { message: 'Something went wrong. Try again.' } } },
        {
          body: {
            result: { correct: true, scoreDelta: 10, correctAnswer: 'hallo' },
            session: { id: 'session-1', answeredCount: 1, questionCount: 3 },
          },
        },
      ],
    });
    await wrapper.get('#answer').setValue('hallo');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Something went wrong. Try again.');
    expect(wrapper.get('#answer').attributes('readonly')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(answerCalls(fetchMock)).toHaveLength(2);
    expect(wrapper.text()).toContain('Correct. +10 points.');
  });

  it('reports an unreachable service and a missing question as errors', async () => {
    const { wrapper } = await startSession({
      'GET /api/v1/practice/question': {
        status: 404,
        body: { error: { message: 'No vocabulary is available.' } },
      },
    });
    expect(wrapper.get('[role="alert"]').text()).toBe('No vocabulary is available.');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(button(wrapper, 'End session').attributes('disabled')).toBeUndefined();

    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await button(wrapper, 'End session').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('The session could not be ended.');
  });

  it('asks the next question in the same session and updates progress', async () => {
    const { wrapper, fetchMock } = await startSession({
      'POST /api/v1/practice/answer': {
        body: {
          result: { correct: true, scoreDelta: 10, correctAnswer: 'hallo' },
          session: { id: 'session-1', answeredCount: 1, questionCount: 3 },
        },
      },
    });
    await wrapper.get('#answer').setValue('hallo');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await button(wrapper, 'Next question').trigger('click');
    await flushPromises();

    const questionCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/v1/practice/question'),
    );
    expect(questionCalls).toHaveLength(2);
    expect(wrapper.get('[data-testid="session-progress"]').text()).toBe('Question 2 of 3');
    expect((wrapper.get('#answer').element as HTMLInputElement).value).toBe('');
    expect(document.activeElement?.id).toBe('answer');
  });
});
