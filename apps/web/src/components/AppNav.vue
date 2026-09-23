<script setup lang="ts">
// Primary navigation. RouterLink sets aria-current="page" on the active item automatically.
export type NavItem = { to: string; label: string };

defineProps<{ items: NavItem[]; label: string }>();
</script>

<template>
  <nav :aria-label="label">
    <ul class="tabs">
      <li v-for="item in items" :key="item.to">
        <RouterLink class="tab" :to="item.to">{{ item.label }}</RouterLink>
      </li>
    </ul>
  </nav>
</template>
