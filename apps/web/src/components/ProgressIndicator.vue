<script setup lang="ts">
import { computed } from 'vue';

// `name` is the accessible name of the bar (for example "Session progress"); `label` is the
// visible text, also used as aria-valuetext.
const props = withDefaults(
  defineProps<{ value: number; max: number; label: string; name?: string }>(),
  { name: 'Progress' },
);
const clamped = computed(() => Math.min(Math.max(props.value, 0), Math.max(props.max, 1)));
const percent = computed(() => (clamped.value / Math.max(props.max, 1)) * 100);
</script>

<template>
  <div class="progress">
    <p class="muted" data-testid="session-progress">{{ props.label }}</p>
    <div
      class="progress__track"
      role="progressbar"
      :aria-label="props.name"
      :aria-valuemin="0"
      :aria-valuemax="props.max"
      :aria-valuenow="clamped"
      :aria-valuetext="props.label"
    >
      <div class="progress__bar" :style="{ width: `${percent}%` }"></div>
    </div>
  </div>
</template>
