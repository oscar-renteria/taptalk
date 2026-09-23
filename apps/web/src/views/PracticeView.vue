<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  AppButton,
  AppCard,
  ProgressIndicator,
  SelectField,
  StatTile,
  StatusMessage,
  TextField,
} from '../components';
import { apiFetch, jsonRequest } from '../api';
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
    if (practiceSession.value && payload.session) {
      practiceSession.value.answeredCount = payload.session.answeredCount;
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
  <section class="content-section" aria-labelledby="practice-title">
    <p class="eyebrow">Today’s session</p>
    <h1 id="practice-title">Ready when you are.</h1>
    <p class="intro">Choose a direction, then begin a short focused practice round.</p>
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
      <ProgressIndicator
        :value="practiceSession.answeredCount"
        :max="practiceSession.questionCount"
        :label="`Question ${Math.min(
          practiceSession.answeredCount + (answered ? 0 : 1),
          practiceSession.questionCount,
        )} of ${practiceSession.questionCount}`"
      />
      <AppCard v-if="question" as="form" @submit.prevent="submitAnswer">
        <p class="prompt" data-testid="practice-prompt">{{ question.prompt }}</p>
        <p v-if="question.phonetics" class="muted">{{ question.phonetics }}</p>
        <TextField
          id="answer"
          ref="answerInput"
          v-model="submittedAnswer"
          label="Your answer"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="done"
          :readonly="answered"
        />
        <AppButton
          v-if="!answered"
          type="submit"
          :loading="practiceLoading"
          loading-label="Checking..."
        >
          Submit answer
        </AppButton>
      </AppCard>
      <StatusMessage v-if="practiceMessage" :tone="practiceTone" :message="practiceMessage" />
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
    <StatusMessage
      v-if="practiceMessage && !practiceSession"
      :tone="practiceTone"
      :message="practiceMessage"
    />
  </section>
</template>
