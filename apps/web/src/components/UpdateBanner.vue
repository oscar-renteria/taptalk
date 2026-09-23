<script setup lang="ts">
import { applyUpdate, dismissUpdate, pwa } from '../pwa';
import AppButton from './AppButton.vue';
import StatusMessage from './StatusMessage.vue';
</script>

<template>
  <div v-if="pwa.updateAvailable" class="update-banner">
    <StatusMessage tone="info" message="A new version of TapTalk is ready." />
    <div class="button-row">
      <AppButton variant="secondary" @click="applyUpdate">Reload to update</AppButton>
      <AppButton variant="text" @click="dismissUpdate">Later</AppButton>
    </div>
  </div>
</template>
