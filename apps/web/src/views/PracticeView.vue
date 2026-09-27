<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AppButton, ProgressIndicator, StatTile, LiveMessage, TextField } from '../components';
import { apiFetch, jsonRequest } from '../api';
import { focus, session } from '../session';
import type { Direction, Tone } from '../types';
const { t, locale } = useI18n();

/**
 * Numbers, percentages and dates follow the active UI locale rather than
 * English conventions: 1,234.56 in English, 1.234,56 in German, 1.234,56 in
 * Spanish. Using Intl keeps separators, decimals and percent placement correct
 * without hand-rolled formatting.
 */
function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value);
}

function formatPercent(ratio: number): string {
  return new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(ratio);
}

type Question = {
  vocabularyEntryId: string;
  direction: 'english-to-german' | 'german-to-english';
  prompt: string;
  phonetics: string | null;
};
type PracticeSession = { id: string; questionCount: number; answeredCount: number };
type SessionSummary = {
  id: string;
  status: 'active' | 'completed' | 'abandoned';
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  pointsEarned: number;
  accuracy: number;
  wordsToPractice: string[];
};

const router = useRouter();
const direction = ref<Direction>('random');
const directionTouched = ref(false);
const question = ref<Question | null>(null);
const submittedAnswer = ref('');
const practiceSession = ref<PracticeSession | null>(null);
const answered = ref(false);
const sessionSummary = ref<SessionSummary | null>(null);
const answerInput = ref<InstanceType<typeof TextField> | null>(null);
const nextButton = ref<InstanceType<typeof AppButton> | null>(null);
const summaryHeading = ref<HTMLHeadingElement | null>(null);
const practiceMessage = ref('');
const practiceTone = ref<Tone>('info');
const practiceLoading = ref(false);
// Only checking an answer shows "Checking..." on the primary action; loading the next
// question or ending the session just disables it.
const checking = ref(false);

// Redesigned interaction states. `answering` collects input, `correct` and
// `miss` present the outcome, and `retry` returns to `answering` with the
// expected answer hidden so the learner recalls it. `attempt` counts tries for
// the current question so the second-try hint can be shown.
type PracticeState = 'idle' | 'answering' | 'correct' | 'miss' | 'retry';
const practiceState = ref<PracticeState>('idle');
const attempt = ref(0);
const streak = ref(0);
const bestStreak = ref(0);
const lastScore = ref(0);
const sessionPoints = ref(0);

// The dashboard's direction choice, shown as a segmented control. "Mixed" is the
// API's random direction: each question picks one.
// Recomputed when the language changes so the labels follow the UI language.
const directionChoices = computed(() => [
  { value: 'german-to-english' as Direction, label: t('practice.germanToEnglish') },
  { value: 'english-to-german' as Direction, label: t('practice.englishToGerman') },
  { value: 'random' as Direction, label: t('practice.mixed') },
]);
const username = computed(() => session.user?.username ?? '');
const speaking = ref(false);

const stateful = computed(
  () => practiceState.value !== 'idle' && practiceState.value !== 'answering',
);
// After a miss the expected answer is hidden so "Try again" actually tests recall.
const revealExpected = computed(() => practiceState.value !== 'retry');

// Phonetics are stored per entry and describe the ENGLISH side (for example
// "We're from" is transcribed "[wɪə frəm]"). Showing them under a German prompt
// displayed English IPA against a German phrase, which is misleading, so the
// redesign only renders them when the prompt is the English one.
const showPhonetics = computed(
  () => !!question.value?.phonetics && question.value.direction === 'english-to-german',
);

const lastSubmitted = ref('');
const expectedAnswer = ref('');

// The saved session length drives the question count on the dashboard. The API
// already returns it alongside the direction, so one request is enough and the
// count is real rather than invented. A failed lookup falls back to a safe 10.
const practiceSessionSize = ref(10);

// Preselect the saved direction and session length unless the learner already
// picked a direction.
onMounted(async () => {
  try {
    const response = await apiFetch('/api/v1/settings');
    const payload = (await response.json()) as {
      settings?: { direction?: Direction; sessionLength?: number };
    };
    if (!response.ok || !payload.settings) return;
    if (payload.settings.direction && !directionTouched.value) {
      direction.value = payload.settings.direction;
    }
    if (
      typeof payload.settings.sessionLength === 'number' &&
      Number.isInteger(payload.settings.sessionLength) &&
      payload.settings.sessionLength >= 1 &&
      payload.settings.sessionLength <= 100
    ) {
      practiceSessionSize.value = payload.settings.sessionLength;
    }
  } catch {
    // The default direction and session length still work.
  }
});

async function startPractice(): Promise<void> {
  practiceLoading.value = true;
  practiceMessage.value = '';
  question.value = null;
  sessionSummary.value = null;
  practiceState.value = 'idle';
  streak.value = 0;
  bestStreak.value = 0;
  sessionPoints.value = 0;
  lastSubmitted.value = '';
  expectedAnswer.value = '';
  try {
    const response = await apiFetch(
      '/api/v1/practice/sessions',
      jsonRequest('POST', { direction: direction.value }),
    );
    const payload = (await response.json()) as {
      session?: PracticeSession;
      error?: { message?: string };
    };
    if (!response.ok || !payload.session) {
      practiceTone.value = 'error';
      practiceMessage.value = payload.error?.message ?? t('practice.couldNotStart');
      return;
    }
    practiceSession.value = payload.session;
    // Focused mode: the shell drops navigation and the hero for the duration.
    focus.practice = true;
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = t('practice.unavailable');
    return;
  } finally {
    practiceLoading.value = false;
  }
  await loadQuestion();
}

async function loadQuestion(): Promise<void> {
  practiceLoading.value = true;
  practiceMessage.value = '';
  try {
    const query = practiceSession.value
      ? `practiceSessionId=${encodeURIComponent(practiceSession.value.id)}`
      : `direction=${direction.value}`;
    const response = await apiFetch(`/api/v1/practice/question?${query}`);
    const payload = (await response.json()) as {
      question?: Question;
      error?: { message?: string };
    };
    if (!response.ok || !payload.question) {
      practiceTone.value = 'error';
      practiceMessage.value = payload.error?.message ?? t('practice.noQuestion');
      return;
    }
    // The card switches to the new question in one step. Until the question arrives
    // the previous card stays as it was (with its actions disabled), so the number
    // and state never describe a question that is not on screen yet.
    question.value = payload.question;
    submittedAnswer.value = '';
    answered.value = false;
    attempt.value = 0;
    lastScore.value = 0;
    practiceState.value = 'answering';
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = t('practice.unavailable');
  } finally {
    practiceLoading.value = false;
  }
  await nextTick();
  answerInput.value?.focus();
}

async function submitAnswer(): Promise<void> {
  // A retry resubmits a question that is already answered; the API checks it without recording it.
  const retry = practiceState.value === 'retry';
  if (!question.value || (answered.value && !retry) || practiceLoading.value) return;
  practiceLoading.value = true;
  checking.value = true;
  attempt.value += 1;
  lastSubmitted.value = submittedAnswer.value.trim();
  try {
    const response = await apiFetch(
      '/api/v1/practice/answer',
      jsonRequest('POST', {
        vocabularyEntryId: question.value.vocabularyEntryId,
        direction: question.value.direction,
        prompt: question.value.prompt,
        submittedAnswer: submittedAnswer.value,
        practiceSessionId: practiceSession.value?.id,
        ...(retry ? { retry: true } : {}),
      }),
    );
    const payload = (await response.json()) as {
      result?: { correct: boolean; scoreDelta: number; correctAnswer: string };
      session?: { answeredCount: number; questionCount: number };
      error?: { message?: string };
    };
    if (!response.ok || !payload.result) {
      practiceTone.value = 'error';
      practiceMessage.value = payload.error?.message ?? t('practice.submitFailed');
      return;
    }

    answered.value = true;
    lastScore.value = payload.result.scoreDelta;
    sessionPoints.value += payload.result.scoreDelta;
    expectedAnswer.value = payload.result.correctAnswer;
    if (practiceSession.value && payload.session) {
      practiceSession.value.answeredCount = payload.session.answeredCount;
    }
    if (payload.result.correct) {
      practiceState.value = 'correct';
      // A second try is not a first-time recall, so it does not extend the streak.
      if (!retry) {
        streak.value += 1;
        bestStreak.value = Math.max(bestStreak.value, streak.value);
      }
    } else {
      practiceState.value = 'miss';
      streak.value = 0;
    }
    practiceTone.value = payload.result.correct ? 'success' : 'warning';
    if (payload.result.correct) {
      practiceMessage.value = retry
        ? t('practice.correctSecondTry')
        : `Correct. +${payload.result.scoreDelta} points.`;
    } else {
      practiceMessage.value = retry
        ? t('practice.notQuiteYet')
        : `Not quite. The answer is ${payload.result.correctAnswer}.`;
    }
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = t('practice.submitFailed');
  } finally {
    practiceLoading.value = false;
    checking.value = false;
  }
  if (answered.value) {
    await nextTick();
    nextButton.value?.focus();
  }
}

function sessionIsFull(): boolean {
  return (
    !!practiceSession.value &&
    practiceSession.value.answeredCount >= practiceSession.value.questionCount
  );
}

// The question on screen. After an answer the API has already counted it, so the
// number must not advance until the next question is shown.
// The question in the card depends on which side is shown.
const answerQuestion = computed(() =>
  question.value?.direction === 'english-to-german'
    ? t('practice.howDoYouSay')
    : t('practice.whatDoesItMean'),
);

/**
 * The language of the learning material, which is independent of the interface
 * language. A German interface can still show an English or German answer, so
 * this is derived from the question's direction rather than from the locale.
 */
const answerLanguage = computed(() =>
  question.value?.direction === 'german-to-english' ? 'en' : 'de',
);

const questionNumber = computed(() =>
  practiceSession.value
    ? Math.min(
        practiceSession.value.answeredCount + (answered.value ? 0 : 1),
        practiceSession.value.questionCount,
      )
    : 0,
);

// The redesign's single primary action. Enter/Return and the sticky button both
// call this, so the loop never needs the mouse and never needs a second control.
async function primaryAction(): Promise<void> {
  if (practiceLoading.value) return;
  if (practiceState.value === 'correct') return nextQuestion();
  if (practiceState.value === 'miss') return tryAgain();
  if (!submittedAnswer.value.trim()) return;
  return submitAnswer();
}

// A miss clears the input and hides the expected answer, so the second attempt
// genuinely tests recall rather than letting the learner copy the answer.
async function tryAgain(): Promise<void> {
  submittedAnswer.value = '';
  practiceState.value = 'retry';
  await nextTick();
  answerInput.value?.focus();
}

// The design calls for a large speak control using the browser's own speech
// synthesis, with a visible active state while audio plays.
function speak(): void {
  if (!canSpeak.value || !question.value) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(question.value.prompt);
  utterance.lang = question.value.direction === 'english-to-german' ? 'en-GB' : 'de-DE';
  utterance.onend = () => (speaking.value = false);
  utterance.onerror = () => (speaking.value = false);
  speaking.value = true;
  window.speechSynthesis.speak(utterance);
}

const canSpeak = computed(
  () => typeof window !== 'undefined' && 'speechSynthesis' in window && !!question.value,
);

async function nextQuestion(): Promise<void> {
  if (sessionIsFull()) {
    await endSession();
    return;
  }
  await loadQuestion();
}

async function endSession(): Promise<void> {
  if (!practiceSession.value) return;
  practiceLoading.value = true;
  practiceMessage.value = '';
  try {
    const response = await apiFetch(`/api/v1/practice/sessions/${practiceSession.value.id}/end`, {
      method: 'POST',
    });
    const payload = (await response.json()) as {
      session?: SessionSummary;
      error?: { message?: string };
    };
    if (!response.ok || !payload.session) {
      practiceTone.value = 'error';
      practiceMessage.value = payload.error?.message ?? t('practice.endFailed');
      return;
    }
    sessionSummary.value = payload.session;
    practiceSession.value = null;
    question.value = null;
    // Leave focused mode so the navigation returns for the summary.
    focus.practice = false;
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = t('practice.endFailed');
  } finally {
    practiceLoading.value = false;
  }
  if (sessionSummary.value) {
    await nextTick();
    summaryHeading.value?.focus();
  }
}
</script>

<template>
  <section
    class="content-section content-section--wide"
    aria-labelledby="practice-title"
    :data-focus="practiceState === 'idle' ? undefined : 'true'"
  >
    <template v-if="sessionSummary">
      <!-- The summary keeps the page's top-level heading; the visible title is its h2. -->
      <h1 id="practice-title" class="visually-hidden">{{ t('practice.resultsTitle') }}</h1>
    </template>
    <template v-else-if="practiceSession">
      <!-- The hero is removed to free vertical space, but the section still needs
           an accessible name, so the heading is kept for assistive technology. -->
      <h1 id="practice-title" class="visually-hidden">{{ t('practice.questionTitle') }}</h1>
    </template>

    <div v-if="sessionSummary" class="session-summary" aria-labelledby="summary-title">
      <p class="eyebrow eyebrow--success">
        {{
          sessionSummary.status === 'completed'
            ? t('practice.summaryComplete')
            : t('practice.summaryEnded')
        }}
      </p>
      <h2 id="summary-title" ref="summaryHeading" tabindex="-1">
        {{
          sessionSummary.status === 'completed'
            ? t('practice.summaryComplete')
            : t('practice.summaryEarly')
        }}
      </h2>
      <p v-if="sessionSummary.answeredCount === 0" class="muted">
        {{ t('practice.summaryNone') }}
      </p>
      <template v-else>
        <p v-if="sessionSummary.status !== 'completed'" class="muted">
          You answered {{ sessionSummary.answeredCount }} of
          {{ sessionSummary.questionCount }} questions.
        </p>
        <div class="stat-grid">
          <StatTile
            data-testid="summary-questions"
            :value="sessionSummary.answeredCount"
            label="questions"
          />
          <StatTile
            data-testid="summary-correct"
            :value="sessionSummary.correctCount"
            label="correct"
          />
          <StatTile
            data-testid="summary-incorrect"
            :value="sessionSummary.incorrectCount"
            label="incorrect"
          />
          <StatTile
            data-testid="summary-points"
            :value="sessionSummary.pointsEarned"
            label="points earned"
          />
          <StatTile
            data-testid="summary-accuracy"
            :value="formatPercent(sessionSummary.accuracy)"
            label="accuracy"
          />
        </div>
        <template v-if="sessionSummary.wordsToPractice.length">
          <h3>{{ t('practice.wordsToPractice') }}</h3>
          <ul class="chip-list" :aria-label="t('practice.wordsToPractice')">
            <li v-for="word in sessionSummary.wordsToPractice" :key="word" class="chip">
              {{ word }}
            </li>
          </ul>
        </template>
        <p v-else class="muted">{{ t('practice.allCorrect') }}</p>
      </template>
      <div class="button-row">
        <AppButton :disabled="practiceLoading" @click="startPractice">
          {{ t('practice.practiceAgain') }}
        </AppButton>
        <AppButton variant="secondary" @click="router.push('/progress')">
          {{ t('practice.goToProgress') }}
        </AppButton>
      </div>
    </div>

    <div v-else-if="!practiceSession" class="dashboard">
      <div class="dashboard__lead">
        <div class="dashboard__hero">
          <p class="eyebrow">{{ t('practice.eyebrow') }}</p>
          <h1 id="practice-title" tabindex="-1">
            Welcome back<template v-if="username">, {{ username }}</template
            >.
          </h1>
          <p class="dashboard__intro">
            A round takes a few focused minutes. Navigation steps aside until you finish or exit.
          </p>
        </div>
        <fieldset class="segmented">
          <legend>{{ t('practice.direction') }}</legend>
          <div class="segmented__options">
            <label v-for="choice in directionChoices" :key="choice.value" class="segmented__option">
              <input
                v-model="direction"
                type="radio"
                name="direction"
                :value="choice.value"
                @change="directionTouched = true"
              />
              <span>{{ choice.label }}</span>
            </label>
          </div>
        </fieldset>
        <div class="dashboard__start">
          <AppButton
            class="btn--large"
            :loading="practiceLoading"
            :loading-label="t('practice.starting')"
            :disabled="practiceSessionSize === 0"
            @click="startPractice"
          >
            {{ t('practice.start') }}
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </AppButton>
          <span class="muted">{{ practiceSessionSize }} questions</span>
        </div>
      </div>
      <ul class="dashboard__cards" :aria-label="t('nav.more')">
        <li>
          <RouterLink class="dashboard-card" to="/progress">
            <span class="dashboard-card__icon" data-tone="success" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" />
              </svg>
            </span>
            <span class="dashboard-card__text">
              <span class="dashboard-card__title">{{ t('nav.progress') }}</span>
              <span class="muted">{{ t('progress.cardBody') }}</span>
            </span>
            <svg
              class="dashboard-card__chevron"
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </RouterLink>
        </li>
        <li v-if="session.user?.role === 'administrator'">
          <RouterLink class="dashboard-card" to="/admin/import">
            <span class="dashboard-card__icon" data-tone="accent" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z" />
                <path d="M5 17a3 3 0 013-3h11" />
              </svg>
            </span>
            <span class="dashboard-card__text">
              <span class="dashboard-card__title">{{ t('nav.vocabulary') }}</span>
              <span class="muted">{{ t('admin.cardBody') }}</span>
            </span>
            <svg
              class="dashboard-card__chevron"
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </RouterLink>
        </li>
        <li>
          <RouterLink class="dashboard-card" to="/settings">
            <span class="dashboard-card__icon" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path
                  d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
                />
              </svg>
            </span>
            <span class="dashboard-card__text">
              <span class="dashboard-card__title">{{ t('nav.settings') }}</span>
              <span class="muted">{{ t('settings.cardBody') }}</span>
            </span>
            <svg
              class="dashboard-card__chevron"
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </RouterLink>
        </li>
      </ul>
    </div>

    <div v-else class="practice">
      <header class="practice-bar">
        <AppButton variant="secondary" class="practice-bar__exit" @click="endSession">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Exit
        </AppButton>
        <ProgressIndicator
          class="practice-bar__progress"
          :name="t('practice.progressName')"
          :value="practiceSession.answeredCount"
          :max="practiceSession.questionCount"
          :label="`Question ${questionNumber} of ${practiceSession.questionCount}`"
        />
        <div class="practice-bar__meta">
          <p v-if="streak > 1" class="pill pill--streak" data-testid="streak">
            {{ streak }} in a row
          </p>
          <p class="pill" data-testid="session-points">
            <!-- One text node: the pill is a flex box, which would trim a space between items. -->
            <span aria-hidden="true">{{ `${sessionPoints} pts` }}</span>
            <span class="visually-hidden">{{ `${sessionPoints} points` }}</span>
          </p>
        </div>
      </header>

      <form
        v-if="question"
        class="practice-card"
        :data-state="practiceState"
        :aria-busy="practiceLoading ? 'true' : undefined"
        novalidate
        @submit.prevent="primaryAction"
      >
        <div class="practice-card__prompt">
          <div v-if="canSpeak" class="speak-row">
            <button
              type="button"
              class="speak"
              :aria-pressed="speaking"
              :aria-label="
                speaking ? t('practice.playingPronunciation') : t('practice.playPronunciation')
              "
              @click="speak"
            >
              <svg
                aria-hidden="true"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M11 5L6 9H3v6h3l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 010 7" />
                <path d="M18.5 5.5a9 9 0 010 13" />
              </svg>
            </button>
            <span class="speak-row__label" aria-hidden="true">{{
              speaking ? t('practice.playing') : t('practice.listen')
            }}</span>
          </div>
          <p
            id="practice-prompt-text"
            class="prompt"
            data-testid="practice-prompt"
            :lang="question.direction === 'english-to-german' ? 'en' : 'de'"
          >
            {{ question.prompt }}
          </p>
          <p
            v-if="showPhonetics"
            id="practice-phonetics"
            class="ipa"
            data-testid="practice-phonetics"
          >
            {{ question.phonetics }}
          </p>
        </div>

        <div class="practice-card__answer">
          <p class="practice-card__question">{{ answerQuestion }}</p>
          <TextField
            id="answer"
            ref="answerInput"
            v-model="submittedAnswer"
            :label="t('practice.yourAnswer')"
            class="practice-card__input"
            :lang="question.direction === 'english-to-german' ? 'de' : 'en'"
            :describedby="
              showPhonetics ? 'practice-prompt-text practice-phonetics' : 'practice-prompt-text'
            "
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            enterkeyhint="done"
            :readonly="practiceState === 'correct' || practiceState === 'miss'"
          />
          <p v-if="practiceState === 'retry'" class="muted">{{ t('practice.secondTry') }}</p>
          <p v-else-if="practiceState === 'answering'" class="muted practice-card__hint">
            {{ t('practice.pressEnter') }} <kbd>{{ t('practice.enterKey') }}</kbd>
            {{ t('practice.toCheck') }}
          </p>
        </div>

        <div
          v-if="practiceState === 'correct' || practiceState === 'miss'"
          class="practice-card__feedback"
          :data-tone="practiceState === 'correct' ? 'success' : 'warning'"
        >
          <span class="practice-card__badge" aria-hidden="true">
            <svg
              v-if="practiceState === 'correct'"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <svg
              v-else
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </span>
          <div v-if="practiceState === 'correct'" class="practice-card__verdict-block">
            <p class="practice-card__verdict">{{ t('practice.correct') }}</p>
            <p class="practice-card__detail">
              {{
                lastScore > 0
                  ? t('practice.pointsEarned', { points: formatNumber(lastScore) })
                  : t('practice.correctNoPoints')
              }}
              <template v-if="lastScore > 0 && streak > 1">
                · {{ t('practice.streak', { count: streak }) }}
              </template>
            </p>
          </div>
          <div v-else class="practice-card__verdict-block">
            <p class="practice-card__verdict">{{ t('practice.notQuite') }}</p>
            <dl class="practice-card__compare">
              <div>
                <dt>{{ t('practice.yourAnswer') }}</dt>
                <dd :lang="answerLanguage">{{ lastSubmitted || '—' }}</dd>
              </div>
              <div v-if="revealExpected">
                <dt>{{ t('practice.expectedLabel') }}</dt>
                <dd class="practice-card__expected" :lang="answerLanguage">
                  {{ expectedAnswer }}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div class="practice-action">
          <AppButton
            ref="nextButton"
            type="submit"
            :variant="
              practiceState === 'answering' || practiceState === 'retry' ? 'dark' : 'primary'
            "
            :loading="checking"
            :loading-label="t('common.checking')"
            :disabled="practiceLoading || (!stateful && !submittedAnswer.trim())"
          >
            <template v-if="practiceState === 'correct' && sessionIsFull()">
              {{ t('practice.seeResults') }}
            </template>
            <template v-else-if="practiceState === 'correct'">
              {{ t('practice.nextQuestion') }} <span aria-hidden="true">→</span>
            </template>
            <template v-else-if="practiceState === 'miss'">{{ t('common.tryAgain') }}</template>
            <template v-else>{{ t('practice.checkAnswer') }}</template>
          </AppButton>
          <AppButton
            v-if="practiceState === 'miss'"
            variant="secondary"
            :disabled="practiceLoading"
            @click="nextQuestion"
          >
            {{ sessionIsFull() ? t('practice.skipToResults') : t('practice.skipQuestion') }}
          </AppButton>
        </div>
      </form>
      <div class="practice-action__secondary">
        <AppButton variant="text" :disabled="practiceLoading" @click="endSession">
          End session
        </AppButton>
      </div>
    </div>
    <LiveMessage :tone="practiceTone" :message="practiceMessage" />
  </section>
</template>
