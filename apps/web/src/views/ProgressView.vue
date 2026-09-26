<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AppButton, ErrorState, LoadingState, StatTile } from '../components';
import { apiFetch } from '../api';

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
    <p class="eyebrow">Your progress</p>
    <h1 id="progress-title">A clear beginning.</h1>
    <LoadingState v-if="loading" label="Loading your progress..." />
    <ErrorState v-else-if="failed" message="Your progress could not be loaded." @retry="load" />
    <template v-else-if="dashboard">
      <div class="stat-grid">
        <StatTile data-testid="stat-points" :value="dashboard.totalPoints" label="points" />
        <StatTile data-testid="stat-attempts" :value="dashboard.totalAttempts" label="attempts" />
        <StatTile
          data-testid="stat-accuracy"
          :value="`${Math.round(dashboard.accuracy * 100)}%`"
          label="accuracy"
        />
      </div>
      <div v-if="dashboard.repeatedErrorWords.length" class="empty-state">
        <h2 class="empty-state__title">Words worth another look</h2>
        <p class="muted">
          You have answered these incorrectly more than once. A short round in this direction is
          usually enough to turn them around.
        </p>
        <ul class="chip-list">
          <li v-for="word in dashboard.repeatedErrorWords" :key="word" class="chip">{{ word }}</li>
        </ul>
      </div>
      <div v-else class="empty-state">
        <h2 class="empty-state__title">No history yet</h2>
        <p class="muted">
          {{
            dashboard.totalAttempts > 0
              ? 'You have answered questions, but nothing has come up twice yet. That is a good sign.'
              : 'Answer a few questions and your accuracy, points, and tricky words will appear here.'
          }}
        </p>
        <AppButton variant="secondary" @click="router.push('/practice')">
          Start practising
        </AppButton>
      </div>
    </template>
  </section>
</template>
