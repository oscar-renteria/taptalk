<script setup lang="ts">
import StatusMessage from './StatusMessage.vue';

// Screen readers announce changes only inside live regions that already exist, so this wrapper is
// always rendered and only its content changes. Errors are rendered as role="alert" instead,
// which is announced reliably when inserted.
const props = withDefaults(
  defineProps<{ tone?: 'info' | 'success' | 'warning' | 'error'; message?: string }>(),
  { tone: 'info', message: '' },
);
</script>

<template>
  <div class="live-message" role="status" aria-live="polite" aria-atomic="true">
    <StatusMessage
      v-if="props.message && props.tone !== 'error'"
      :tone="props.tone"
      :message="props.message"
      :live="false"
    />
  </div>
  <StatusMessage
    v-if="props.message && props.tone === 'error'"
    tone="error"
    :message="props.message"
  />
</template>
