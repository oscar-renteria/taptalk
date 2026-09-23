// @vitest-environment happy-dom

import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, mockApi, mountApp, signedIn, signedInAdmin, signedOut } from './test-api';

const question = {
  vocabularyEntryId: 'entry-1',
  direction: 'english-to-german',
  prompt: 'hello',
  phonetics: null,
};

function summary(overrides: Record<string, unknown>) {
  return {
    id: 'session-1',
    status: 'completed',
    questionCount: 1,
    answeredCount: 1,
    correctCount: 1,
    incorrectCount: 0,
    pointsEarned: 10,
    accuracy: 1,
    wordsToPractice: [],
    ...overrides,
  };
}

function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!match) throw new Error(`No button "${label}"`);
  return match;
}

async function mountSignedIn(routes: Parameters<typeof mockApi>[0]) {
  const fetchMock = mockApi({
    ...signedIn,
    'POST /api/v1/practice/sessions': {
      status: 201,
      body: { session: { id: 'session-1', questionCount: 1, answeredCount: 0 } },
    },
    'GET /api/v1/practice/question': { body: { question } },
    ...routes,
  });
  const { wrapper, router } = await mountApp('/practice');
  return { wrapper, fetchMock, router };
}

describe('practice session flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('redirects to the login screen when no session can be restored', async () => {
    mockApi(signedOut);
    const { wrapper, router } = await mountApp('/practice');
    expect(router.currentRoute.value.fullPath).toBe('/login?redirect=/practice');
    expect(wrapper.find('#username').exists()).toBe(true);
  });

  it('answers the last question, shows results, and renders the server summary', async () => {
    const { wrapper, fetchMock } = await mountSignedIn({
      'POST /api/v1/practice/answer': {
        body: {
          result: { correct: false, scoreDelta: 0, correctAnswer: 'hallo' },
          session: { id: 'session-1', answeredCount: 1, questionCount: 1 },
        },
      },
      'POST /api/v1/practice/sessions/session-1/end': {
        body: {
          session: summary({
            correctCount: 0,
            incorrectCount: 1,
            pointsEarned: 0,
            accuracy: 0,
            wordsToPractice: ['hello'],
          }),
        },
      },
    });

    await button(wrapper, 'Start practice').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="session-progress"]').text()).toBe('Question 1 of 1');
    expect(document.activeElement?.id).toBe('answer');

    await wrapper.get('#answer').setValue('falsch');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === '/api/v1/practice/question?practiceSessionId=session-1',
      ),
    ).toBe(true);
    expect(bodyOf(fetchMock, 'POST /api/v1/practice/answer')).toMatchObject({
      practiceSessionId: 'session-1',
      submittedAnswer: 'falsch',
    });
    expect(wrapper.text()).toContain('Not quite. The answer is hallo.');
    // The answer is locked, so the same question cannot be submitted twice.
    expect(wrapper.findAll('button').some((b) => b.text() === 'Submit answer')).toBe(false);

    await button(wrapper, 'See results').trigger('click');
    await flushPromises();
    expect(wrapper.get('#summary-title').text()).toBe('Session complete.');
    expect(wrapper.get('[data-testid="summary-incorrect"]').text()).toContain('1');
    expect(wrapper.get('[data-testid="summary-accuracy"]').text()).toContain('0%');
    expect(wrapper.text()).toContain('Words to practice again');
    expect(wrapper.text()).toContain('hello');
    expect(document.activeElement?.id).toBe('summary-title');
  });

  it('handles a session ended before any question was answered', async () => {
    const { wrapper } = await mountSignedIn({
      'POST /api/v1/practice/sessions/session-1/end': {
        body: {
          session: summary({
            status: 'abandoned',
            answeredCount: 0,
            correctCount: 0,
            pointsEarned: 0,
            accuracy: 0,
          }),
        },
      },
    });
    await button(wrapper, 'Start practice').trigger('click');
    await flushPromises();
    await button(wrapper, 'End session').trigger('click');
    await flushPromises();

    expect(wrapper.get('#summary-title').text()).toBe('Session ended early.');
    expect(wrapper.text()).toContain('No questions were answered in this session.');
    expect(wrapper.find('[data-testid="summary-points"]').exists()).toBe(false);
  });

  it('reports a session that cannot be started', async () => {
    const { wrapper } = await mountSignedIn({
      'POST /api/v1/practice/sessions': {
        status: 404,
        body: { error: { message: 'No vocabulary is available.' } },
      },
    });
    await button(wrapper, 'Start practice').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('No vocabulary is available.');
    expect(wrapper.find('[data-testid="session-progress"]').exists()).toBe(false);
  });

  it('clears the previous user state on logout', async () => {
    const { wrapper, router } = await mountSignedIn({
      'POST /api/v1/auth/logout': { status: 204 },
    });
    await button(wrapper, 'Start practice').trigger('click');
    await flushPromises();
    await button(wrapper, 'Log out').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('login');
    expect(wrapper.find('#username').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('hello');
  });
});

describe('administrator import feedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps the success message after the history reloads', async () => {
    mockApi({
      ...signedInAdmin,
      'GET /api/v1/admin/vocabulary/imports': { body: { imports: [] } },
      'POST /api/v1/admin/vocabulary/preview': {
        body: {
          preview: {
            valid: [{ english: 'tree', german: 'Baum', alternatives: [] }],
            invalid: [],
            duplicates: [],
            additions: ['tree'],
            updates: [],
            warnings: [],
          },
        },
      },
      'POST /api/v1/admin/vocabulary/import': { status: 201, body: { result: {} } },
    });
    const { wrapper } = await mountApp('/admin/import');
    const input = wrapper.get('#vocabulary-file');
    const file = new File(['[{"english":"tree","german":"Baum"}]'], 'tree.json', {
      type: 'application/json',
    });
    Object.defineProperty(input.element, 'files', { value: [file] });
    await input.trigger('change');
    await flushPromises();
    await button(wrapper, 'Preview import').trigger('click');
    await flushPromises();
    await button(wrapper, 'Confirm and import').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Import committed successfully.');
    expect(wrapper.findAll('button').some((b) => b.text() === 'Confirm and import')).toBe(false);
  });
});
