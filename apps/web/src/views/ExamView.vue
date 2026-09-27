<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  AppButton,
  AppCard,
  LiveMessage,
  ProgressIndicator,
  StatusMessage,
  TextField,
} from '../components';
import { apiFetch } from '../api';
import { endExam, exam, examInProgress, resetExam, startExam, submitExamAnswer } from '../exam';
import { focus } from '../session';

const { t, locale } = useI18n();
const router = useRouter();

type Question = {
  vocabularyEntryId: string;
  direction: 'english-to-german' | 'german-to-english';
  prompt: string;
  phonetics: string | null;
};
type Direction = 'english-to-german' | 'german-to-english' | 'random';

const question = ref<Question | null>(null);
const direction = ref<Direction>('random');
const submitted = ref('');
const loadingQuestion = ref(false);
const confirmingExit = ref(false);

const directionChoices = computed(() => [
  { value: 'german-to-english' as Direction, label: t('practice.germanToEnglish') },
  { value: 'english-to-german' as Direction, label: t('practice.englishToGerman') },
  { value: 'random' as Direction, label: t('practice.mixed') },
]);

const questionNumber = computed(() => Math.min(exam.answeredCount + 1, exam.questionCount));
const remaining = computed(() => Math.max(0, exam.questionCount - exam.answeredCount));

/** Locale-aware formatting, matching the rest of the app. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value);
}
function formatPercent(score: number): string {
  return new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
    score / 100,
  );
}
/** mm:ss, so a long exam reads as a duration rather than a number. */
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${formatNumber(minutes)}:${String(seconds).padStart(2, '0')}`;
}

async function loadQuestion(): Promise<void> {
  loadingQuestion.value = true;
  try {
    const response = await apiFetch(
      `/api/v1/practice/question?practiceSessionId=${encodeURIComponent(exam.sessionId)}`,
    );
    const payload = (await response.json()) as { question?: Question };
    if (response.ok && payload.question) {
      question.value = payload.question;
      submitted.value = '';
      focus.practice = true;
    } else {
      question.value = null;
    }
  } catch {
    question.value = null;
  } finally {
    loadingQuestion.value = false;
  }
}

async function begin(): Promise<void> {
  exam.failed = '';
  if (await startExam(direction.value)) await loadQuestion();
}

async function submit(): Promise<void> {
  if (!question.value) return;
  const answered = await submitExamAnswer(question.value, submitted.value);
  if (!answered) return;
  // The last answer ends the exam and reveals the results; otherwise the verdict
  // stays on screen until the learner chooses to move on.
  if (exam.answeredCount >= exam.questionCount) await finish();
}

/** Moves to the next question, clearing the previous verdict. */
async function next(): Promise<void> {
  exam.lastCorrect = null;
  await loadQuestion();
}

async function finish(): Promise<void> {
  await endExam();
  focus.practice = false;
  question.value = null;
}

function leave(): void {
  // Leaving discards the run: an unfinished exam is never recorded.
  focus.practice = false;
  resetExam();
  confirmingExit.value = false;
  void router.push('/exams');
}

async function goToProgress(): Promise<void> {
  focus.practice = false;
  resetExam();
  await router.push('/progress');
}

onMounted(async () => {
  await apiFetch('/api/v1/settings')
    .then((response) => response.json())
    .then((payload: { settings?: { direction?: Direction } }) => {
      if (payload.settings?.direction) direction.value = payload.settings.direction;
    })
    .catch(() => undefined);
});
</script>

<template>
  <section class="content-section" aria-labelledby="exam-title">
    <!-- Results: shown only once the exam has ended. -->
    <template v-if="exam.result">
      <div class="practice-dashboard">
        <div class="practice-dashboard__hero">
          <p class="eyebrow">{{ t('exam.resultsEyebrow') }}</p>
          <h1 id="exam-title">{{ t('exam.resultsTitle') }}</h1>
        </div>

        <div class="stat-grid">
          <div class="stat">
            <strong>{{ formatPercent(exam.result.score) }}</strong>
            <span>{{ t('exam.score') }}</span>
          </div>
          <div class="stat">
            <strong
              >{{ formatNumber(exam.result.correctCount) }} /
              {{ formatNumber(exam.result.totalQuestions) }}</strong
            >
            <span>{{ t('exam.correctAnswers') }}</span>
          </div>
          <div class="stat">
            <strong
              >{{ formatNumber(exam.result.incorrectCount) }} /
              {{ formatNumber(exam.result.totalQuestions) }}</strong
            >
            <span>{{ t('exam.incorrectAnswers') }}</span>
          </div>
        </div>
        <p class="muted">
          {{ t('exam.duration') }}: {{ formatDuration(exam.result.durationSeconds) }} ·
          {{ t('exam.status') }}:
          {{ exam.result.status === 'completed' ? t('exam.completed') : t('exam.abandoned') }}
        </p>

        <!-- Review: the correct answers are available for the first time here. -->
        <AppCard>
          <h2 class="empty-state__title">{{ t('exam.reviewTitle') }}</h2>
          <ol class="exam-review">
            <li
              v-for="item in exam.result.questions"
              :key="item.index"
              class="exam-review__item"
              :data-correct="item.correct ? 'true' : 'false'"
            >
              <p class="exam-review__prompt">
                <span class="exam-review__number">{{ formatNumber(item.index) }}.</span>
                <span :lang="item.direction === 'english-to-german' ? 'en' : 'de'">{{
                  item.prompt
                }}</span>
              </p>
              <p class="exam-review__line">
                <span class="visually-hidden">{{ t('exam.yourAnswer') }}: </span>
                <span class="muted">{{ t('exam.yourAnswer') }}:</span>
                <span :lang="item.direction === 'english-to-german' ? 'de' : 'en'">{{
                  item.submittedAnswer
                }}</span>
              </p>
              <p class="exam-review__verdict" :data-correct="item.correct ? 'true' : 'false'">
                <span aria-hidden="true">{{ item.correct ? '✓' : '✗' }}</span>
                {{ item.correct ? t('exam.correct') : t('exam.incorrect') }}
              </p>
              <p v-if="!item.correct" class="exam-review__line">
                <span class="muted">{{ t('exam.correctAnswer') }}:</span>
                <span :lang="item.direction === 'english-to-german' ? 'de' : 'en'">{{
                  item.correctAnswer
                }}</span>
              </p>
            </li>
          </ol>
        </AppCard>

        <div class="button-row">
          <AppButton variant="secondary" @click="goToProgress">
            {{ t('exam.seeProgress') }}
          </AppButton>
          <AppButton
            @click="
              resetExam();
              void router.push('/exams');
            "
          >
            {{ t('exam.again') }}
          </AppButton>
        </div>
      </div>
    </template>

    <!-- Running exam: the question, progress, and one word of verdict. -->
    <template v-else-if="examInProgress()">
      <div class="practice-bar">
        <ProgressIndicator
          class="practice-bar__progress"
          :name="t('exam.progressName')"
          :value="exam.answeredCount"
          :max="exam.questionCount"
          :label="t('exam.questionOf', { current: questionNumber, total: exam.questionCount })"
        />
        <div class="practice-bar__meta">
          <p class="pill" data-testid="exam-remaining">
            {{ t('exam.remaining', { count: remaining }) }}
          </p>
        </div>
        <AppButton variant="text" :disabled="exam.ending" @click="confirmingExit = true">
          {{ t('exam.exit') }}
        </AppButton>
      </div>

      <!-- The verdict is one icon plus one word. The icon is real text rather than
           a CSS decoration, so correctness is never carried by colour alone. -->
      <StatusMessage
        v-if="exam.lastCorrect !== null"
        :tone="exam.lastCorrect ? 'success' : 'error'"
        data-testid="exam-verdict"
      >
        <span aria-hidden="true">{{ exam.lastCorrect ? '✓' : '✗' }}</span>
        {{ exam.lastCorrect ? t('exam.correct') : t('exam.incorrect') }}
      </StatusMessage>

      <form v-if="question" class="practice-card" @submit.prevent="submit">
        <div class="practice-card__head">
          <p id="exam-question-text" class="practice-card__question">
            {{
              question.direction === 'english-to-german'
                ? t('practice.howDoYouSay')
                : t('practice.whatDoesItMean')
            }}
          </p>
          <p
            id="exam-prompt-text"
            class="prompt"
            data-testid="exam-prompt"
            :lang="question.direction === 'english-to-german' ? 'en' : 'de'"
          >
            {{ question.prompt }}
          </p>
        </div>
        <TextField
          id="exam-answer"
          v-model="submitted"
          :label="t('practice.yourAnswer')"
          class="practice-card__input"
          :lang="question.direction === 'english-to-german' ? 'de' : 'en'"
          describedby="exam-question-text exam-prompt-text"
          exercise
          autocomplete="off"
          enterkeyhint="done"
          :readonly="exam.lastCorrect !== null"
        />
        <div class="practice-action">
          <AppButton
            v-if="exam.lastCorrect === null"
            type="submit"
            :loading="loadingQuestion"
            :disabled="loadingQuestion || !submitted.trim()"
          >
            {{ t('exam.submit') }}
          </AppButton>
          <AppButton v-else :loading="loadingQuestion" :disabled="loadingQuestion" @click="next">
            {{ t('exam.nextQuestion') }}
          </AppButton>
        </div>
      </form>
      <LoadingState v-else-if="loadingQuestion" :label="t('common.loading')" />
    </template>

    <!-- Start -->
    <template v-else>
      <div class="practice-dashboard">
        <div class="practice-dashboard__hero">
          <p class="eyebrow">{{ t('exam.eyebrow') }}</p>
          <h1 id="exam-title">{{ t('exam.heading') }}</h1>
          <p class="practice-dashboard__intro">{{ t('exam.intro') }}</p>
        </div>

        <StatusMessage
          v-if="exam.failed === 'vocabulary'"
          tone="warning"
          :message="t('vocabulary.startBlocked')"
        />
        <StatusMessage v-else-if="exam.failed" tone="error" :message="t('exam.failed')" />

        <fieldset class="segmented">
          <legend>{{ t('practice.direction') }}</legend>
          <div class="segmented__options">
            <label v-for="choice in directionChoices" :key="choice.value" class="segmented__option">
              <input v-model="direction" type="radio" name="exam-direction" :value="choice.value" />
              <span>{{ choice.label }}</span>
            </label>
          </div>
        </fieldset>

        <div class="dashboard__start">
          <AppButton
            class="btn--large"
            :loading="exam.loading"
            :loading-label="t('exam.starting')"
            :disabled="exam.loading"
            @click="begin"
          >
            {{ t('exam.start') }}
          </AppButton>
          <span class="muted">{{ t('exam.questionCountHint') }}</span>
        </div>
      </div>
    </template>

    <!-- Leaving mid-exam: the app's own message component, no new dialog system. -->
    <LiveMessage v-if="confirmingExit" tone="warning" :message="t('exam.leaveConfirm')" />
    <div v-if="confirmingExit" class="button-row">
      <AppButton variant="secondary" @click="confirmingExit = false">
        {{ t('exam.stay') }}
      </AppButton>
      <AppButton @click="leave">{{ t('exam.leave') }}</AppButton>
    </div>
  </section>
</template>
