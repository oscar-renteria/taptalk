<script setup lang="ts">
import { ref } from 'vue';

// Primary for the main action of a view, secondary for alternatives, text for low-emphasis links.
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'text';
    type?: 'button' | 'submit';
    loading?: boolean;
    loadingLabel?: string;
    disabled?: boolean;
  }>(),
  {
    variant: 'primary',
    type: 'button',
    loading: false,
    loadingLabel: 'Working...',
    disabled: false,
  },
);

const element = ref<HTMLButtonElement | null>(null);
defineExpose({ focus: () => element.value?.focus() });
</script>

<template>
  <button
    ref="element"
    :type="props.type"
    :class="['btn', `btn--${props.variant}`]"
    :disabled="props.disabled || props.loading"
    :aria-busy="props.loading ? 'true' : undefined"
  >
    <span v-if="props.loading" class="spinner" aria-hidden="true"></span>
    <template v-if="props.loading">{{ props.loadingLabel }}</template>
    <slot v-else />
  </button>
</template>
