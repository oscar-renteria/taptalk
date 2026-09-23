<script setup lang="ts">
import AppButton from './AppButton.vue';
import StatusMessage from './StatusMessage.vue';

withDefaults(defineProps<{ message: string; retryLabel?: string }>(), { retryLabel: 'Try again' });
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="error-state">
    <StatusMessage tone="error">{{ message }}</StatusMessage>
    <AppButton variant="secondary" @click="$emit('retry')">{{ retryLabel }}</AppButton>
  </div>
</template>
