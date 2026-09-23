<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AppButton, StatusMessage, TextField } from '../components';
import { safeRedirect } from '../router';
import { signIn } from '../session';
import type { ApiErrorBody, User } from '../types';

const props = defineProps<{ mode: 'login' | 'register' }>();
const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const message = ref('');
const loading = ref(false);

async function submit(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  message.value = '';
  try {
    const response = await fetch(`/api/v1/auth/${props.mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    const payload = (await response.json()) as { user?: User } & ApiErrorBody;
    if (!response.ok || !payload.user) {
      message.value = payload.error?.details?.length
        ? payload.error.details.map((detail) => detail.message).join(' ')
        : (payload.error?.message ?? 'The request could not be completed.');
      return;
    }
    password.value = '';
    signIn(payload.user);
    await router.replace(safeRedirect(route.query.redirect));
  } catch {
    message.value = 'The service is unavailable. Try again in a moment.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="page-title">
    <p class="eyebrow">TapTalk</p>
    <h1 id="page-title">Small steps. Stronger words.</h1>
    <p class="intro">A quiet place to build your German, one answer at a time.</p>
    <form @submit.prevent="submit">
      <TextField
        id="username"
        v-model="username"
        label="Username"
        autocomplete="username"
        required
        minlength="2"
      />
      <TextField
        id="password"
        v-model="password"
        label="Password"
        type="password"
        :autocomplete="props.mode === 'login' ? 'current-password' : 'new-password'"
        required
        minlength="8"
      />
      <AppButton type="submit" :loading="loading">
        {{ props.mode === 'login' ? 'Log in' : 'Create account' }}
      </AppButton>
    </form>
    <StatusMessage v-if="message" tone="error" :message="message" />
    <RouterLink
      class="btn btn--text"
      :to="{ name: props.mode === 'login' ? 'register' : 'login', query: route.query }"
    >
      {{ props.mode === 'login' ? 'Need an account?' : 'Already have an account?' }}
    </RouterLink>
  </section>
</template>
