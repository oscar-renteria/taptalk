<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ErrorState, LoadingState, StatTile } from '../components';
import { apiFetch } from '../api';

type Dashboard = {
  totalPoints: number;
  totalAttempts: number;
  accuracy: number;
  repeatedErrorWords: string[];
};

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
      <p v-if="dashboard.repeatedErrorWords.length" class="muted">
        Keep an eye on: {{ dashboard.repeatedErrorWords.join(', ') }}.
      </p>
      <p v-else class="muted">Complete a practice round to see your learning history here.</p>
    </template>
  </section>
</template>
