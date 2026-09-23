<script setup lang="ts">
// Feedback with an icon, a coloured border, and text, so meaning never depends on colour alone.
// Errors use role="alert" (announced immediately); other tones use role="status" (polite).
// Pass the text as `message`, or as slot content for richer markup.
const props = withDefaults(
  defineProps<{ tone?: 'info' | 'success' | 'warning' | 'error'; message?: string }>(),
  { tone: 'info', message: '' },
);
</script>

<template>
  <p class="status" :data-tone="props.tone" :role="props.tone === 'error' ? 'alert' : 'status'">
    <span
      ><slot>{{ props.message }}</slot></span
    >
  </p>
</template>
