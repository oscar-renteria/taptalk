<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  AppButton,
  ProgressIndicator,
  SelectField,
  StatTile,
  LiveMessage,
  TextField,
} from '../components';
import { apiFetch, jsonRequest } from '../api';
import { focus } from '../session';
import { directionOptions, type Direction, type Tone } from '../types';

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

// Preselect the saved direction unless the learner already picked one.
onMounted(async () => {
  try {
    const response = await apiFetch('/api/v1/settings');
    const payload = (await response.json()) as { settings?: { direction?: Direction } };
    if (response.ok && payload.settings?.direction && !directionTouched.value) {
      direction.value = payload.settings.direction;
    }
  } catch {
    // The default direction still works.
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
      practiceMessage.value = payload.error?.message ?? 'Practice could not be started.';
      return;
    }
    practiceSession.value = payload.session;
    // Focused mode: the shell drops navigation and the hero for the duration.
    focus.practice = true;
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = 'The practice service is unavailable.';
    return;
  } finally {
    practiceLoading.value = false;
  }
  await loadQuestion();
}

async function loadQuestion(): Promise<void> {
  practiceLoading.value = true;
  practiceMessage.value = '';
  answered.value = false;
  attempt.value = 0;
  lastScore.value = 0;
  practiceState.value = 'answering';
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
      practiceMessage.value = payload.error?.message ?? 'No question is available yet.';
      return;
    }
    question.value = payload.question;
    submittedAnswer.value = '';
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = 'The practice service is unavailable.';
  } finally {
    practiceLoading.value = false;
  }
  await nextTick();
  answerInput.value?.focus();
}

async function submitAnswer(): Promise<void> {
  if (!question.value || answered.value || practiceLoading.value) return;
  practiceLoading.value = true;
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
      }),
    );
    const payload = (await response.json()) as {
      result?: { correct: boolean; scoreDelta: number; correctAnswer: string };
      session?: { answeredCount: number; questionCount: number };
      error?: { message?: string };
    };
    if (!response.ok || !payload.result) {
      practiceTone.value = 'error';
      practiceMessage.value = payload.error?.message ?? 'The answer could not be submitted.';
      return;
    }

    answered.value = true;
    lastScore.value = payload.result.scoreDelta;
    expectedAnswer.value = payload.result.correctAnswer;
    if (practiceSession.value && payload.session) {
      practiceSession.value.answeredCount = payload.session.answeredCount;
    }
    if (payload.result.correct) {
      practiceState.value = 'correct';
      streak.value += 1;
      bestStreak.value = Math.max(bestStreak.value, streak.value);
    } else {
      practiceState.value = 'miss';
      streak.value = 0;
    }
    practiceTone.value = payload.result.correct ? 'success' : 'warning';
    practiceMessage.value = payload.result.correct
      ? `Correct. +${payload.result.scoreDelta} points.`
      : `Not quite. The answer is ${payload.result.correctAnswer}.`;
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = 'The answer could not be submitted.';
  } finally {
    practiceLoading.value = false;
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
      practiceMessage.value = payload.error?.message ?? 'The session could not be ended.';
      return;
    }
    sessionSummary.value = payload.session;
    practiceSession.value = null;
    question.value = null;
    // Leave focused mode so the navigation and hero return for the summary.
    focus.practice = false;
  } catch {
    practiceTone.value = 'error';
    practiceMessage.value = 'The session could not be ended.';
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
    class="content-section"
    aria-labelledby="practice-title"
    :data-focus="practiceState === 'idle' ? undefined : 'true'"
  >
    <template v-if="practiceState === 'idle' && !practiceSession">
      <p class="eyebrow">Today's practice</p>
      <h1 id="practice-title">Welcome back.</h1>
      <p class="intro">Pick a direction, then start a short focused round.</p>
    </template>
    <template v-else-if="practiceSession">
      <!-- The hero is removed to free vertical space, but the section still needs
           an accessible name, so the heading is kept for assistive technology. -->
      <h1 id="practice-title" class="visually-hidden">Practice question</h1>
    </template>
    <div v-if="sessionSummary" class="session-summary" aria-labelledby="summary-title">
      <h2 id="summary-title" ref="summaryHeading" tabindex="-1">
        {{ sessionSummary.status === 'completed' ? 'Session complete.' : 'Session ended early.' }}
      </h2>
      <p v-if="sessionSummary.answeredCount === 0" class="muted">
        No questions were answered in this session.
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
            :value="`${Math.round(sessionSummary.accuracy * 100)}%`"
            label="accuracy"
          />
        </div>
        <template v-if="sessionSummary.wordsToPractice.length">
          <h3>Words to practice again</h3>
          <ul class="history-list" aria-label="Words to practice again">
            <li v-for="word in sessionSummary.wordsToPractice" :key="word">{{ word }}</li>
          </ul>
        </template>
        <p v-else class="muted">Every answer was correct. No words need extra practice.</p>
      </template>
      <div class="button-row">
        <AppButton :disabled="practiceLoading" @click="startPractice">Practice again</AppButton>
        <AppButton variant="text" @click="router.push('/progress')">Go to progress</AppButton>
      </div>
    </div>
    <template v-else-if="!practiceSession">
      <SelectField
        id="direction"
        v-model="direction"
        label="Practice direction"
        :options="directionOptions"
        @change="directionTouched = true"
      />
      <AppButton :loading="practiceLoading" loading-label="Loading..." @click="startPractice">
        Start practice
      </AppButton>
    </template>
    <template v-else>
      <header class="practice-bar">
        <AppButton variant="text" class="practice-bar__exit" @click="endSession">Exit</AppButton>
        <p class="practice-bar__count">
          Question
          {{ Math.min(practiceSession.answeredCount + 1, practiceSession.questionCount) }} of
          {{ practiceSession.questionCount }}
        </p>
        <p v-if="streak > 1" class="practice-bar__streak" data-testid="streak">
          {{ streak }} in a row
        </p>
      </header>
      <ProgressIndicator
        name="Session progress"
        :value="practiceSession.answeredCount"
        :max="practiceSession.questionCount"
        :label="`Question ${Math.min(
          practiceSession.answeredCount + (answered ? 0 : 1),
          practiceSession.questionCount,
        )} of ${practiceSession.questionCount}`"
      />
      <form
        v-if="question"
        class="practice-card"
        :data-state="practiceState"
        novalidate
        @submit.prevent="primaryAction"
      >
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
        <button
          v-if="canSpeak"
          type="button"
          class="speak"
          :aria-pressed="speaking"
          :aria-label="speaking ? 'Playing pronunciation' : 'Play pronunciation'"
          @click="speak"
        >
          <span aria-hidden="true">🔊</span>
          <span>{{ speaking ? 'Playing...' : 'Listen' }}</span>
        </button>
        <p v-if="practiceState === 'retry'" class="muted">Second try — type it from memory.</p>
        <div v-if="stateful" class="practice-card__feedback" :data-tone="practiceTone">
          <p v-if="practiceState === 'correct'" class="practice-card__verdict">
            <span aria-hidden="true">✓</span> Correct! +{{ lastScore }} points
          </p>
          <template v-else>
            <p class="practice-card__verdict"><span aria-hidden="true">✕</span> Not quite</p>
            <p class="muted">
              Your answer: <strong>{{ lastSubmitted || '—' }}</strong>
            </p>
            <p v-if="revealExpected" class="muted">
              Expected: <strong>{{ expectedAnswer }}</strong>
            </p>
          </template>
        </div>
        <TextField
          id="answer"
          ref="answerInput"
          v-model="submittedAnswer"
          label="Your answer"
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
        <div class="practice-action">
          <AppButton
            type="submit"
            :loading="practiceLoading"
            loading-label="Checking..."
            :disabled="!stateful && !submittedAnswer.trim()"
          >
            <template v-if="practiceState === 'correct'">Next question →</template>
            <template v-else-if="practiceState === 'miss'">Try again</template>
            <template v-else-if="practiceState === 'retry'">Check answer</template>
            <template v-else>Check answer</template>
          </AppButton>
        </div>
        <div class="practice-action__secondary">
          <AppButton variant="text" :disabled="practiceLoading" @click="endSession">
            End session
          </AppButton>
        </div>
      </form>
    </template>
    <LiveMessage :tone="practiceTone" :message="practiceMessage" />
    <template v-if="practiceSession">
      <div class="button-row">
        <AppButton
          v-if="answered"
          ref="nextButton"
          :disabled="practiceLoading"
          @click="nextQuestion"
        >
          {{ sessionIsFull() ? 'See results' : 'Next question' }}
        </AppButton>
        <AppButton variant="text" :disabled="practiceLoading" @click="endSession">
          End session
        </AppButton>
      </div>
    </template>
  </section>
</template>
