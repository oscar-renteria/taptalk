<script setup lang="ts">
import { passwordRules, registrationErrors, usernameRules } from '@taptalk/shared';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AppButton, StatusMessage, TextField } from '../components';
import { safeRedirect } from '../router';
import { signIn } from '../session';
import type { ApiErrorBody, User } from '../types';

type Field = 'username' | 'password';

const props = defineProps<{ mode: 'login' | 'register' }>();
const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const submitted = ref(false);
const formError = ref('');
const serverErrors = reactive<Record<Field, string>>({ username: '', password: '' });
const usernameField = ref<InstanceType<typeof TextField> | null>(null);
const passwordField = ref<InstanceType<typeof TextField> | null>(null);

const isRegister = computed(() => props.mode === 'register');

// The same schema the API uses. It gives immediate feedback; the server remains the authority.
// Login only checks for presence, so accounts created under older rules can still sign in.
const clientErrors = computed<Record<Field, string>>(() => {
  const errors: Record<Field, string> = { username: '', password: '' };
  if (!username.value.trim()) errors.username = 'Enter your username.';
  if (!password.value) errors.password = 'Enter your password.';
  if (isRegister.value && !errors.username && !errors.password) {
    for (const issue of registrationErrors({
      username: username.value,
      password: password.value,
    })) {
      const field = issue.field === 'password' ? 'password' : 'username';
      errors[field] ||= issue.message;
    }
  }
  return errors;
});

// Errors appear after the first submit attempt, then update as the user types.
function fieldError(field: Field): string {
  return serverErrors[field] || (submitted.value ? clientErrors.value[field] : '');
}

watch([username, password], () => {
  serverErrors.username = '';
  serverErrors.password = '';
  formError.value = '';
});

watch(
  () => props.mode,
  () => {
    submitted.value = false;
    formError.value = '';
    serverErrors.username = '';
    serverErrors.password = '';
  },
);

async function focusFirstError(): Promise<void> {
  await nextTick();
  if (fieldError('username')) usernameField.value?.focus();
  else if (fieldError('password')) passwordField.value?.focus();
}

async function submit(): Promise<void> {
  if (loading.value) return; // Prevents a second request from a double tap or repeated Enter.
  submitted.value = true;
  formError.value = '';
  if (clientErrors.value.username || clientErrors.value.password) {
    await focusFirstError();
    return;
  }
  loading.value = true;
  try {
    const response = await fetch(`/api/v1/auth/${props.mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    const payload = (await response.json()) as { user?: User } & ApiErrorBody;
    if (!response.ok || !payload.user) {
      const details = payload.error?.details ?? [];
      for (const detail of details) {
        const field: Field = detail.field === 'password' ? 'password' : 'username';
        serverErrors[field] ||= detail.message;
      }
      if (payload.error?.code === 'USERNAME_UNAVAILABLE') {
        serverErrors.username = 'This username is taken. Try another one.';
      }
      if (!details.length && payload.error?.code !== 'USERNAME_UNAVAILABLE') {
        formError.value = payload.error?.message ?? 'The request could not be completed.';
      }
      await focusFirstError();
      return;
    }
    password.value = '';
    signIn(payload.user);
    await router.replace(safeRedirect(route.query.redirect));
  } catch {
    formError.value = 'The service is unavailable. Try again in a moment.';
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
    <h2 id="form-title">{{ isRegister ? 'Create your account' : 'Log in to practise' }}</h2>
    <form aria-labelledby="form-title" novalidate @submit.prevent="submit">
      <TextField
        id="username"
        ref="usernameField"
        v-model="username"
        label="Username"
        autocomplete="username"
        autocapitalize="off"
        spellcheck="false"
        :maxlength="usernameRules.maxLength"
        :hint="
          isRegister
            ? `${usernameRules.minLength}–${usernameRules.maxLength} characters: letters, numbers, dots, hyphens, underscores.`
            : ''
        "
        :error="fieldError('username')"
        required
      />
      <TextField
        id="password"
        ref="passwordField"
        v-model="password"
        label="Password"
        :type="showPassword ? 'text' : 'password'"
        :autocomplete="isRegister ? 'new-password' : 'current-password'"
        :maxlength="passwordRules.maxLength"
        :hint="
          isRegister
            ? `At least ${passwordRules.minLength} characters. Do not use your username or a common password.`
            : ''
        "
        :error="fieldError('password')"
        required
      >
        <template #after>
          <AppButton
            variant="secondary"
            :aria-pressed="showPassword ? 'true' : 'false'"
            aria-controls="password"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? 'Hide' : 'Show' }}
            <span class="visually-hidden">password</span>
          </AppButton>
        </template>
      </TextField>
      <AppButton
        type="submit"
        :loading="loading"
        :loading-label="isRegister ? 'Creating account...' : 'Logging in...'"
      >
        {{ isRegister ? 'Create account' : 'Log in' }}
      </AppButton>
    </form>
    <StatusMessage v-if="formError" tone="error" :message="formError" />
    <RouterLink
      class="btn btn--text"
      :to="{ name: isRegister ? 'login' : 'register', query: route.query }"
    >
      {{ isRegister ? 'Already have an account?' : 'Need an account?' }}
    </RouterLink>
  </section>
</template>
