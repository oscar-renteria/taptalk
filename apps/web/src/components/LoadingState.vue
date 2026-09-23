<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading...' });
</script>

<template>
  <p class="loading-state muted" role="status">
    <span class="spinner" aria-hidden="true"></span>{{ label }}
  </p>
</template>
