<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AppButton, ErrorState, LoadingState, StatTile } from '../components';
import { apiFetch } from '../api';
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

onMounted(load);
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
        <p class="muted">
          You have answered these incorrectly more than once. A short round in this direction is
          usually enough to turn them around.
        </p>
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
          Start practising
        </AppButton>
      </div>
    </template>
  </section>
</template>
