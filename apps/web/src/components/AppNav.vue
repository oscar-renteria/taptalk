<script setup lang="ts">
export type NavItem = { id: string; label: string; current: boolean };

defineProps<{ items: NavItem[]; label: string }>();
defineEmits<{ navigate: [id: string] }>();
</script>

<template>
  <nav :aria-label="label">
    <ul class="tabs">
      <li v-for="item in items" :key="item.id">
        <button
          class="tab"
          type="button"
          :aria-current="item.current ? 'page' : undefined"
          @click="$emit('navigate', item.id)"
        >
          {{ item.label }}
        </button>
      </li>
    </ul>
  </nav>
</template>
