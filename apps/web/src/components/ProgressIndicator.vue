<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ value: number; max: number; label: string }>();
const clamped = computed(() => Math.min(Math.max(props.value, 0), Math.max(props.max, 1)));
const percent = computed(() => (clamped.value / Math.max(props.max, 1)) * 100);
</script>

<template>
  <div class="progress">
    <p class="muted" data-testid="session-progress">{{ props.label }}</p>
    <div
      class="progress__track"
      role="progressbar"
      :aria-valuemin="0"
      :aria-valuemax="props.max"
      :aria-valuenow="clamped"
      :aria-valuetext="props.label"
    >
      <div class="progress__bar" :style="{ width: `${percent}%` }"></div>
    </div>
  </div>
</template>
