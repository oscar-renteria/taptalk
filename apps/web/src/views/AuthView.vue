<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { passwordRules, registrationErrors, usernameRules } from '@taptalk/shared';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AppButton, SelectField, StatusMessage, TextField } from '../components';
import { startGuestSession } from '../guest';
import { setLocale, supportedLocales, type LocaleCode } from '../i18n';
import { safeRedirect } from '../router';
import { signIn } from '../session';
import type { ApiErrorBody, User } from '../types';
const { t, locale } = useI18n();

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

// Language names are shown in their own language, which is what a language
// picker is expected to do and needs no per-locale translation.
const languageOptions = supportedLocales.map((entry) => ({
  value: entry.code,
  label: entry.label,
}));

async function changeLanguage(value: string): Promise<void> {
  if (!supportedLocales.some((entry) => entry.code === value)) return;
  await setLocale(value as LocaleCode);
}

const isRegister = computed(() => props.mode === 'register');
const guestLoading = ref(false);

// Starting guest mode is an explicit choice; a failure leaves the visitor on the
// account screen with a message rather than dropping them into a broken session.
async function continueAsGuest(): Promise<void> {
  guestLoading.value = true;
  formError.value = '';
  try {
    if (await startGuestSession()) {
      await router.replace(safeRedirect(route.query.redirect));
      return;
    }
    formError.value = t('guest.failed');
  } catch {
    formError.value = t('guest.failed');
  } finally {
    guestLoading.value = false;
  }
}
// The router adds `expired` when a 401 ended the session, so the return is explained rather than
// leaving the learner to wonder why they are back at the login screen.
const sessionEnded = computed(() => route.query.expired === '1');

// The same schema the API uses. It gives immediate feedback; the server remains the authority.
// Login only checks for presence, so accounts created under older rules can still sign in.
const clientErrors = computed<Record<Field, string>>(() => {
  const errors: Record<Field, string> = { username: '', password: '' };
  if (!username.value.trim()) errors.username = t('auth.usernameRequired');
  if (!password.value) errors.password = t('auth.passwordRequired');
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
        serverErrors.username = t('auth.usernameTaken');
      }
      if (!details.length && payload.error?.code !== 'USERNAME_UNAVAILABLE') {
        formError.value = payload.error?.message ?? t('auth.requestFailed');
      }
      await focusFirstError();
      return;
    }
    password.value = '';
    signIn(payload.user);
    await router.replace(safeRedirect(route.query.redirect));
  } catch {
    formError.value = t('auth.serviceUnavailable');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="page-title">
    <p class="eyebrow">{{ t('app.name') }}</p>
    <h1 id="page-title">{{ t('auth.heading') }}</h1>
    <p class="intro">{{ t('app.tagline') }}</p>
    <h2 id="form-title">{{ isRegister ? t('auth.registerTitle') : t('auth.loginTitle') }}</h2>
    <StatusMessage v-if="sessionEnded" tone="info" :message="t('auth.sessionEnded')" />
    <form aria-labelledby="form-title" novalidate @submit.prevent="submit">
      <TextField
        id="username"
        ref="usernameField"
        v-model="username"
        :label="t('auth.username')"
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
        :label="t('auth.password')"
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
            {{ showPassword ? t('auth.hidePasswordShort') : t('auth.showPasswordShort') }}
            <span class="visually-hidden">password</span>
          </AppButton>
        </template>
      </TextField>
      <AppButton
        type="submit"
        :loading="loading"
        :loading-label="isRegister ? t('auth.creatingAccount') : t('auth.loggingIn')"
      >
        {{ isRegister ? t('auth.register') : t('auth.logIn') }}
      </AppButton>
    </form>
    <StatusMessage v-if="formError" tone="error" :message="formError" />
    <RouterLink
      class="btn btn--text"
      :to="{ name: isRegister ? 'login' : 'register', query: route.query }"
    >
      {{ isRegister ? t('auth.haveAccount') : t('auth.noAccount') }}
    </RouterLink>
    <AppButton
      class="auth__guest"
      variant="secondary"
      :loading="guestLoading"
      :loading-label="t('guest.starting')"
      :disabled="guestLoading"
      @click="continueAsGuest"
    >
      {{ t('guest.continue') }}
    </AppButton>
    <p class="auth__guest-note muted">{{ t('guest.notice') }}</p>
    <div class="auth__language">
      <SelectField
        id="auth-language"
        :model-value="locale"
        :label="t('settings.language')"
        :options="languageOptions"
        @update:model-value="changeLanguage"
      />
    </div>
  </section>
</template>
