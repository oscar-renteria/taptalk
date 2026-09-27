<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AppButton, AppCard, ErrorState, LoadingState, StatTile } from '../components';
import { apiFetch } from '../api';
import { exam, loadExamProgress } from '../exam';
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

type Dashboard = {
  totalPoints: number;
  totalAttempts: number;
  accuracy: number;
  repeatedErrorWords: string[];
};

const router = useRouter();
const dashboard = ref<Dashboard | null>(null);
const loading = ref(false);
const failed = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const response = await apiFetch('/api/v1/dashboard');
    const payload = (await response.json()) as { dashboard?: Dashboard };
    if (response.ok && payload.dashboard) dashboard.value = payload.dashboard;
    else failed.value = true;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  // Both are requested together, and an exam failure must not hide the practice
  // statistics, so they settle independently.
  await Promise.all([load(), loadExamProgress()]);
});
</script>

<template>
  <section class="content-section" aria-labelledby="progress-title">
    <p class="eyebrow">{{ t('progress.eyebrow') }}</p>
    <h1 id="progress-title">{{ t('progress.heading') }}</h1>
    <LoadingState v-if="loading" :label="t('progress.loading')" />
    <ErrorState v-else-if="failed" :message="t('progress.loadFailed')" @retry="load" />
    <template v-else-if="dashboard">
      <div class="stat-grid">
        <StatTile
          data-testid="stat-points"
          :value="formatNumber(dashboard.totalPoints)"
          :label="t('progress.points')"
        />
        <StatTile
          data-testid="stat-attempts"
          :value="formatNumber(dashboard.totalAttempts)"
          :label="t('progress.attempts')"
        />
        <StatTile
          data-testid="stat-accuracy"
          :value="formatPercent(dashboard.accuracy)"
          :label="t('progress.accuracy')"
        />
      </div>
      <div v-if="dashboard.repeatedErrorWords.length" class="empty-state">
        <h2 class="empty-state__title">{{ t('progress.trickyTitle') }}</h2>
        <p class="muted">{{ t('progress.trickyBody') }}</p>
        <ul class="chip-list">
          <li v-for="word in dashboard.repeatedErrorWords" :key="word" class="chip">{{ word }}</li>
        </ul>
      </div>
      <div v-else class="empty-state">
        <h2 class="empty-state__title">{{ t('progress.emptyTitle') }}</h2>
        <p class="muted">
          {{ dashboard.totalAttempts > 0 ? t('progress.emptyAttempts') : t('progress.emptyNone') }}
        </p>
        <AppButton variant="secondary" @click="router.push('/practice')">
          {{ t('progress.startPractising') }}
        </AppButton>
      </div>
    </template>

    <!-- Exams: an assessment summary, kept below the practice statistics so the
         page stays a progress page rather than an analytics dashboard. -->
    <AppCard>
      <h2 class="empty-state__title">{{ t('examStats.exams') }}</h2>
      <LoadingState v-if="exam.loading && !exam.statistics" :label="t('common.loading')" />
      <template v-else-if="exam.statistics && exam.statistics.examsCompleted > 0">
        <div class="stat-grid">
          <StatTile
            data-testid="stat-exams"
            :value="formatNumber(exam.statistics.examsCompleted)"
            :label="t('examStats.examsCompleted')"
          />
          <StatTile
            data-testid="stat-exam-average"
            :value="formatPercent(exam.statistics.averageScore / 100)"
            :label="t('examStats.averageScore')"
          />
          <StatTile
            data-testid="stat-exam-best"
            :value="formatPercent(exam.statistics.bestScore / 100)"
            :label="t('examStats.bestScore')"
          />
          <StatTile
            data-testid="stat-exam-latest"
            :value="formatPercent(exam.statistics.latestScore / 100)"
            :label="t('examStats.latestScore')"
          />
        </div>

        <!-- Score over time. The bars carry a text summary for screen readers, so
             the chart is never the only way to read the trend. -->
        <div v-if="exam.statistics.scoreHistory.length > 1" class="exam-trend">
          <h3 class="exam-trend__title">{{ t('examStats.trendTitle') }}</h3>
          <p class="visually-hidden">
            {{ t('examStats.trendSummary', { count: exam.statistics.scoreHistory.length }) }}
          </p>
          <ol
            class="exam-trend__bars"
            :aria-label="t('examStats.trendTitle')"
            data-testid="exam-trend"
          >
            <li
              v-for="(score, index) in exam.statistics.scoreHistory"
              :key="index"
              class="exam-trend__bar"
            >
              <span
                class="exam-trend__fill"
                :style="{ height: `${Math.max(4, score)}%` }"
                aria-hidden="true"
              ></span>
              <span class="visually-hidden">{{ formatPercent(score / 100) }}</span>
            </li>
          </ol>
        </div>

        <h3 class="empty-state__title">{{ t('examStats.historyTitle') }}</h3>
        <ul class="exam-history">
          <li v-for="entry in exam.history" :key="entry.id" class="exam-history__row">
            <RouterLink
              class="exam-history__link"
              :to="{ name: 'exams', query: { result: entry.id } }"
            >
              <span class="exam-history__date">{{ formatDate(entry.endedAt) }}</span>
              <span class="exam-history__score">{{ formatPercent(entry.score / 100) }}</span>
              <span class="exam-history__correct">
                {{
                  t('examStats.correctOf', {
                    correct: formatNumber(entry.correctCount),
                    total: formatNumber(entry.totalQuestions),
                  })
                }}
              </span>
            </RouterLink>
          </li>
        </ul>
      </template>
      <p v-else class="muted">{{ t('examStats.noHistory') }}</p>
      <AppButton variant="secondary" @click="router.push('/exams')">
        {{ t('examStats.startExam') }}
      </AppButton>
    </AppCard>
  </section>
</template>
