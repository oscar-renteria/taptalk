<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  AppButton,
  AppCard,
  LiveMessage,
  LoadingState,
  ProgressIndicator,
  StatusMessage,
  TextField,
  VocabularyScopePicker,
} from '../components';
import { apiFetch } from '../api';
import { selectedGroupCount } from '../vocabulary-groups';
import ShareResultDialog from '../components/ShareResultDialog.vue';
import { useShareResult } from '../useShareResult';
import { defaultExamLength, examLengths } from '@taptalk/shared';
import {
  abandonExam,
  endExam,
  exam,
  examInProgress,
  loadExamResult,
  resetExam,
  startExam,
  submitExamAnswer,
} from '../exam';
import { focus } from '../session';
import { enabledCount, loadPracticeVocabulary } from '../practice-vocabulary';

const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

type Question = {
  position: number;
  direction: 'english-to-german' | 'german-to-english';
  prompt: string;
  phonetics: string | null;
};
type Direction = 'english-to-german' | 'german-to-english' | 'random';

const question = ref<Question | null>(null);
const direction = ref<Direction>('random');
const length = ref<number>(defaultExamLength);
const submitted = ref('');
/** True once an answer is in, which shows Next instead of Submit. */
const answered = ref(false);
const loadingQuestion = ref(false);
const confirmingExit = ref(false);

const directionChoices = computed(() => [
  { value: 'german-to-english' as Direction, label: t('practice.germanToEnglish') },
  { value: 'english-to-german' as Direction, label: t('practice.englishToGerman') },
  { value: 'random' as Direction, label: t('practice.mixed') },
]);

const lengthChoices = computed(() =>
  examLengths.map((value) => ({ value, label: t('exam.questionCount', { count: value }) })),
);

const questionNumber = computed(() => Math.min(exam.answeredCount + 1, exam.questionCount));
const remaining = computed(() => Math.max(0, exam.questionCount - exam.answeredCount));

/**
 * The number of questions the learner will actually be asked.
 *
 * An exam cannot ask more than the enabled vocabulary holds, so a 20-question
 * exam drawn from 12 words is 12 questions. Showing the real figure before the
 * exam starts is the point: nobody should begin an exam expecting 20 questions
 * and be given 12.
 */
const availableCount = computed(() => enabledCount());
const actualLength = computed(() =>
  availableCount.value > 0 ? Math.min(length.value, availableCount.value) : length.value,
);
/** True when the request is trimmed to the pool, which is worth saying plainly. */
const trimmed = computed(() => availableCount.value > 0 && actualLength.value < length.value);

/** Locale-aware formatting, matching the rest of the app. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value);
}
/**
 * Sharing is offered only once the exam has ended. `shareSession` asks the API to
 * create the share; if the API refuses (a guest, or an exam it does not consider
 * finished) nothing opens.
 *
 * The refs are destructured so the template's `v-if` narrows `payload` to a
 * non-null value before it is passed to the dialog.
 */
const {
  open: shareOpen,
  path: sharePath,
  payload: sharePayload,
  shareSession,
  close: closeShare,
} = useShareResult();

function openShare(sessionId: string): void {
  void shareSession(sessionId);
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
    // The exam's own question endpoint, which serves the set frozen at the start.
    const response = await apiFetch(`/api/v1/exams/${exam.sessionId}/question`);
    const payload = (await response.json()) as { question?: Question };
    if (response.ok && payload.question) {
      question.value = payload.question;
      exam.position = payload.question.position;
      submitted.value = '';
      answered.value = false;
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
  if (await startExam(direction.value, length.value)) await loadQuestion();
}

/**
 * Records the answer and moves on.
 *
 * Nothing on the screen changes to say whether the answer was right, because the
 * client was never told. The only change is the button: Next replaces Submit,
 * and the next question arrives when the learner asks for it.
 */
async function submit(): Promise<void> {
  if (!question.value) return;
  if (!(await submitExamAnswer(exam.position, submitted.value))) return;
  // The last answer ends the exam, and the results are the first place anything
  // about correctness is shown.
  if (exam.complete) {
    await finish();
    return;
  }
  answered.value = true;
}

async function next(): Promise<void> {
  await loadQuestion();
}

async function finish(): Promise<void> {
  await endExam();
  focus.practice = false;
  question.value = null;
}

async function leave(): Promise<void> {
  // Leaving discards the run: an unfinished exam is never scored or counted.
  focus.practice = false;
  confirmingExit.value = false;
  // The learner is taken back straight away, and the abandon request is left to
  // finish on its own. Awaiting it first left a window in which the navigation
  // was live, so tapping another tab was undone when this push finally landed.
  // The session id is read synchronously when the request is built, so clearing
  // the store below does not lose it.
  const abandoned = abandonExam();
  resetExam();
  await router.push('/exams');
  await abandoned;
}

async function goToProgress(): Promise<void> {
  focus.practice = false;
  resetExam();
  await router.push('/progress');
}

onMounted(async () => {
  // The Progress page's exam history links here with ?result=<id>. Without this
  // the link landed on the start screen and the past result was unreachable.
  const requested = route.query.result;
  if (typeof requested === 'string' && requested) {
    await loadExamResult(requested);
    // The id is not part of the exam start screen, so it is dropped once read.
    if (exam.result) {
      focus.practice = false;
      await router.replace({ name: 'exams' });
    }
  }
  // The enabled vocabulary decides the real exam length, so it is needed before
  // the learner presses Start, not after.
  void loadPracticeVocabulary();
  await apiFetch('/api/v1/settings')
    .then((response) => response.json())
    .then((payload: { settings?: { direction?: Direction } }) => {
      if (payload.settings?.direction) direction.value = payload.settings.direction;
    })
    .catch(() => undefined);
});
</script>

<template>
  <section class="content-section content-section--wide" aria-labelledby="exam-title">
    <!-- Results: shown only once the exam has ended. -->
    <template v-if="exam.result">
      <div class="exam-results">
        <div class="dashboard__hero">
          <p class="eyebrow eyebrow--success">{{ t('exam.resultsEyebrow') }}</p>
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
          <!--
            Only a finished exam carries a final score, so the action appears with
            the results. The API still decides: an abandoned exam is refused there.
          -->
          <AppButton
            v-if="exam.result?.status === 'completed'"
            variant="secondary"
            data-testid="share-result"
            @click="openShare(exam.result.id)"
          >
            {{ t('share.shareResult') }}
          </AppButton>
        </div>
        <ShareResultDialog
          v-if="sharePayload"
          :open="shareOpen"
          :path="sharePath"
          :payload="sharePayload"
          @close="closeShare"
        />
      </div>
    </template>

    <!-- Running exam: the question and the position, and nothing at all about
         how the learner is doing. -->
    <template v-else-if="examInProgress()">
      <!-- The hero is gone while an exam runs, but the section still needs an
           accessible name, so the heading is kept for assistive technology. -->
      <h1 id="exam-title" class="visually-hidden">{{ t('exam.questionTitle') }}</h1>

      <!-- Exit, counter with its progress bar, and the questions left sit on one
           row, in the same order and balance as the practice header. -->
      <header class="practice-bar">
        <AppButton
          variant="secondary"
          class="practice-bar__exit"
          :disabled="exam.ending"
          @click="confirmingExit = true"
        >
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
          {{ t('exam.exit') }}
        </AppButton>
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
      </header>

      <form
        v-if="question"
        class="practice-card"
        :aria-busy="loadingQuestion ? 'true' : undefined"
        novalidate
        @submit.prevent="answered ? next() : submit()"
      >
        <div class="practice-card__prompt">
          <p
            id="exam-prompt-text"
            class="prompt"
            data-testid="exam-prompt"
            :lang="question.direction === 'english-to-german' ? 'en' : 'de'"
          >
            {{ question.prompt }}
          </p>
        </div>
        <div class="practice-card__answer">
          <p id="exam-question-text" class="practice-card__question">
            {{
              question.direction === 'english-to-german'
                ? t('practice.howDoYouSay')
                : t('practice.whatDoesItMean')
            }}
          </p>
          <TextField
            id="exam-answer"
            v-model="submitted"
            :label="t('practice.yourAnswer')"
            class="practice-card__input"
            :lang="question.direction === 'english-to-german' ? 'de' : 'en'"
            describedby="exam-prompt-text exam-question-text"
            exercise
            autocomplete="off"
            enterkeyhint="done"
            :readonly="answered"
          />
          <p v-if="!answered" class="muted practice-card__hint">
            {{ t('exam.pressEnter') }} <kbd>{{ t('exam.enterKey') }}</kbd>
            {{ t('exam.toSubmit') }}
          </p>
          <p v-else class="muted practice-card__hint">{{ t('exam.answerRecorded') }}</p>
        </div>

        <div class="practice-action">
          <AppButton
            v-if="!answered"
            type="submit"
            variant="dark"
            :loading="loadingQuestion"
            :disabled="loadingQuestion || !submitted.trim()"
          >
            {{ t('exam.submit') }}
          </AppButton>
          <AppButton v-else :loading="loadingQuestion" :disabled="loadingQuestion" @click="next">
            {{ t('exam.nextQuestion') }} <span aria-hidden="true">→</span>
          </AppButton>
        </div>
      </form>
      <div v-if="!question && loadingQuestion" class="exam-loading">
        <LoadingState :label="t('common.loading')" />
      </div>
    </template>

    <!-- Start -->
    <template v-else>
      <div class="dashboard">
        <div class="dashboard__lead exam-start">
          <div class="dashboard__hero">
            <p class="eyebrow">{{ t('exam.eyebrow') }}</p>
            <h1 id="exam-title" tabindex="-1">{{ t('exam.heading') }}</h1>
            <p class="dashboard__intro">{{ t('exam.intro') }}</p>
          </div>

          <StatusMessage
            v-if="exam.failed === 'vocabulary'"
            tone="warning"
            :message="t('vocabulary.startBlocked')"
          />
          <StatusMessage
            v-else-if="exam.failed === 'groupEmpty'"
            tone="warning"
            :message="t('practice.scope.emptyWarning')"
          />
          <StatusMessage
            v-else-if="exam.failed === 'groupTooSmall'"
            tone="warning"
            :message="t('practice.scope.tooSmallWarning', { count: selectedGroupCount() ?? 0 })"
          />
          <StatusMessage v-else-if="exam.failed" tone="error" :message="t('exam.failed')" />

          <fieldset class="segmented">
            <legend>{{ t('practice.direction') }}</legend>
            <div class="segmented__options">
              <label
                v-for="choice in directionChoices"
                :key="choice.value"
                class="segmented__option"
              >
                <input
                  v-model="direction"
                  type="radio"
                  name="exam-direction"
                  :value="choice.value"
                />
                <span>{{ choice.label }}</span>
              </label>
            </div>
          </fieldset>

          <VocabularyScopePicker />

          <!-- The exam length is the exam's own setting: 5, 10, or 20 questions. It
               is deliberately not the Practice "questions per session" preference. -->
          <fieldset class="segmented">
            <legend>{{ t('exam.length') }}</legend>
            <div class="segmented__options">
              <label v-for="choice in lengthChoices" :key="choice.value" class="segmented__option">
                <input
                  v-model.number="length"
                  type="radio"
                  name="exam-length"
                  :value="choice.value"
                />
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
            <span class="muted" data-testid="exam-actual-length">{{
              trimmed
                ? t('exam.actualLengthTrimmed', {
                    count: actualLength,
                    available: availableCount,
                  })
                : t('exam.actualLength', { count: actualLength })
            }}</span>
          </div>
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
