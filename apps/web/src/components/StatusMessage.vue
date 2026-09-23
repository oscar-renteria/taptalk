<script setup lang="ts">
// Feedback with an icon, a coloured border, and text, so meaning never depends on colour alone.
// Errors use role="alert" (announced immediately); other tones use role="status" (polite).
// Pass `live: false` when the message sits inside an existing live region (LiveMessage).
const props = withDefaults(
  defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'error';
    message?: string;
    live?: boolean;
  }>(),
  { tone: 'info', message: '', live: true },
);
</script>

<template>
  <p
    class="status"
    :data-tone="props.tone"
    :role="props.live ? (props.tone === 'error' ? 'alert' : 'status') : undefined"
  >
    <span
      ><slot>{{ props.message }}</slot></span
    >
  </p>
</template>
