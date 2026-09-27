<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { applyUpdate, dismissUpdate, pwa } from '../pwa';
const { t } = useI18n();
import AppButton from './AppButton.vue';
import StatusMessage from './StatusMessage.vue';
</script>

<template>
  <div v-if="pwa.updateAvailable" class="update-banner">
    <StatusMessage tone="info" :message="t('errors.updateAvailable')" />
    <div class="button-row">
      <AppButton variant="secondary" @click="applyUpdate">{{ t('errors.updateNow') }}</AppButton>
      <AppButton variant="text" @click="dismissUpdate">{{ t('common.later') }}</AppButton>
    </div>
  </div>
</template>
