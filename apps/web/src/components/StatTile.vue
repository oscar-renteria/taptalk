<script setup lang="ts">
defineProps<{ value: string | number; label: string }>();
</script>

<template>
  <div class="stat">
    <!-- Kept on one line so the space survives template whitespace condensing ("42 points"). -->
    <strong>{{ value }}</strong> <span>{{ label }}</span>
  </div>
</template>
