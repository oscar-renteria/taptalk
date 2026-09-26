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

// The redesign labels the primary action with a trailing arrow, and button copy
// can change again, so matching ignores trailing decoration and whitespace.
function button(wrapper: VueWrapper, label: string) {
  const wanted = label.replace(/[→\s]+$/u, '').trim();
  const match = wrapper.findAll('button').find(
    (candidate) =>
      candidate
        .text()
        .replace(/[→\s]+$/u, '')
        .trim() === wanted,
  );
  if (!match) throw new Error(`No button "${label}"`);
  return match;
}

// The redesign's primary action is a submit button whose label depends on the
// card state, so these helpers read it the way a user reads the screen.
function primaryButton(wrapper: VueWrapper) {
  return wrapper.get('.practice-action button[type="submit"]');
}

async function startSession(wrapper: VueWrapper): Promise<void> {
  await button(wrapper, 'Start practice').trigger('click');
  await flushPromises();
}

async function typeAndSubmit(wrapper: VueWrapper, answer: string): Promise<void> {
  await wrapper.get('#answer').setValue(answer);
  await wrapper.get('form.practice-card').trigger('submit');
  await flushPromises();
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

describe('redesigned practice interaction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('starts on "Check answer" and disables it until something is typed', async () => {
    const { wrapper } = await mountSignedIn({});
    await startSession(wrapper);

    expect(primaryButton(wrapper).text()).toBe('Check answer');
    expect(primaryButton(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.get('.practice-card').attributes('data-state')).toBe('answering');
  });

  it('turns the card into a correct state and offers the next question', async () => {
    const { wrapper } = await mountSignedIn({
      'POST /api/v1/practice/answer': {
        body: {
          result: {
            correct: true,
            scoreDelta: 10,
            correctAnswer: 'hallo',
            matchingReason: 'exact',
          },
          session: { answeredCount: 1, questionCount: 1 },
        },
      },
    });
    await startSession(wrapper);
    await typeAndSubmit(wrapper, 'hallo');

    const card = wrapper.get('.practice-card');
    // State is carried on the element, not only by colour, so it is assertable.
    expect(card.attributes('data-state')).toBe('correct');
    expect(card.text()).toContain('Correct!');
    expect(card.text()).toContain('+10 points');
    expect(primaryButton(wrapper).text()).toBe('Next question →');
  });

  it('offers "Try again" after a miss and hides the expected answer on the retry', async () => {
    const { wrapper } = await mountSignedIn({
      'POST /api/v1/practice/answer': {
        body: {
          result: {
            correct: false,
            scoreDelta: 0,
            correctAnswer: 'Das war knapp!',
            matchingReason: 'none',
          },
          session: { answeredCount: 0, questionCount: 1 },
        },
      },
    });
    await startSession(wrapper);
    await typeAndSubmit(wrapper, 'I was close');

    expect(wrapper.get('.practice-card').attributes('data-state')).toBe('miss');
    expect(primaryButton(wrapper).text()).toBe('Try again');
    // The miss shows both the learner's answer and the expected one.
    expect(wrapper.text()).toContain('Your answer:');
    expect(wrapper.text()).toContain('Expected:');

    await primaryButton(wrapper).trigger('click');
    await flushPromises();

    // The retry clears the field and hides the answer so recall is tested.
    expect(wrapper.get('.practice-card').attributes('data-state')).toBe('retry');
    expect(wrapper.get('#answer').element).toHaveProperty('value', '');
    expect(wrapper.text()).not.toContain('Expected:');
    expect(wrapper.text()).toContain('Second try');
    expect(primaryButton(wrapper).text()).toBe('Check answer');
  });

  it('shows phonetics only when the prompt is the English side', async () => {
    const { wrapper } = await mountSignedIn({
      'GET /api/v1/practice/question': {
        body: { question: { ...question, phonetics: '[həˈləʊ]' } },
      },
    });
    await startSession(wrapper);

    // English prompt with English transcription: show it.
    expect(wrapper.find('[data-testid="practice-phonetics"]').exists()).toBe(true);
  });

  it('hides phonetics under a German prompt, where they would be the wrong language', async () => {
    const { wrapper } = await mountSignedIn({
      'GET /api/v1/practice/question': {
        body: {
          question: {
            vocabularyEntryId: 'entry-2',
            direction: 'german-to-english',
            prompt: 'Das war knapp!',
            phonetics: '[həˈləʊ]',
          },
        },
      },
    });
    await startSession(wrapper);

    // Phonetics describe the English side, so showing them under a German phrase
    // would display English IPA as though it were German.
    expect(wrapper.find('[data-testid="practice-phonetics"]').exists()).toBe(false);
  });
});
