<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { session } from '../session';
const { t } = useI18n();
</script>

<template>
  <section class="panel" aria-labelledby="not-found-title">
    <p class="eyebrow">{{ t('app.name') }}</p>
    <h1 id="not-found-title">{{ t('errors.notFoundTitle') }}</h1>
    <p class="intro">{{ t('errors.notFoundBody') }}</p>
    <RouterLink class="btn btn--primary" :to="session.user ? '/practice' : '/login'">
      {{ session.user ? t('errors.backToPractice') : t('errors.goToLogin') }}
    </RouterLink>
  </section>
</template>
