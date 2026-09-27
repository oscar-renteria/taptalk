<script setup lang="ts">
import { computed, useId } from 'vue';

// `name` is the accessible name of the bar (for example "Session progress"); `label` is the
// visible text, also used as aria-valuetext.
const props = withDefaults(
  defineProps<{ value: number; max: number; label: string; name?: string }>(),
  { name: 'Progress' },
);
const clamped = computed(() => Math.min(Math.max(props.value, 0), Math.max(props.max, 1)));
const percent = computed(() => (clamped.value / Math.max(props.max, 1)) * 100);
// The bar describes the counter above it, so the two are linked by id: assistive
// technology reads the visible question counter as the bar's description, not
// merely as text that happens to look like it.
const labelId = useId();
</script>

<template>
  <div class="progress">
    <p :id="labelId" class="muted" data-testid="session-progress">{{ props.label }}</p>
    <div
      class="progress__track"
      role="progressbar"
      :aria-label="props.name"
      :aria-describedby="labelId"
      :aria-valuemin="0"
      :aria-valuemax="props.max"
      :aria-valuenow="clamped"
      :aria-valuetext="props.label"
    >
      <div class="progress__bar" :style="{ width: `${percent}%` }"></div>
    </div>
  </div>
</template>
