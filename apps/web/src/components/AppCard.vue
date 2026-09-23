<script setup lang="ts">
withDefaults(defineProps<{ as?: string }>(), { as: 'div' });
</script>

<template>
  <component :is="as" class="card"><slot /></component>
</template>
