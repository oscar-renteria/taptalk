<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AppButton, SelectField, LiveMessage, TextField } from '../components';
import { apiFetch, jsonRequest } from '../api';
import { setLocale, supportedLocales, type LocaleCode } from '../i18n';
import { directionValues, type Direction, type Tone } from '../types';
const { t, locale } = useI18n();

type Settings = {
  direction: Direction;
  sessionLength: number;
  repetitionPreference: 'balanced' | 'errors-first';
};

const direction = ref<Direction>('random');
const sessionLength = ref(10);
const repetitionPreference = ref<Settings['repetitionPreference']>('balanced');
const loading = ref(false);
const message = ref('');
const tone = ref<Tone>('info');

// Direction labels are localized, and the list is a computed so it follows the UI language.
const directionOptions = computed(() =>
  directionValues.map((value) => ({
    value,
    label: t(
      value === 'random'
        ? 'settings.directionRandom'
        : value === 'english-to-german'
          ? 'settings.directionEnglishToGerman'
          : 'settings.directionGermanToEnglish',
    ),
  })),
);

// Language names are shown in their own language, which is the convention users
// expect from a language picker and needs no per-locale translation.
const languageOptions = supportedLocales.map((entry) => ({
  value: entry.code,
  label: entry.label,
}));

async function changeLanguage(value: string): Promise<void> {
  if (!supportedLocales.some((entry) => entry.code === value)) return;
  await setLocale(value as LocaleCode);
}

function show(nextTone: Tone, text: string): void {
  tone.value = nextTone;
  message.value = text;
}

onMounted(async () => {
  loading.value = true;
  try {
    const response = await apiFetch('/api/v1/settings');
    const payload = (await response.json()) as { settings?: Partial<Settings> };
    if (response.ok && payload.settings) {
      if (payload.settings.direction) direction.value = payload.settings.direction;
      if (payload.settings.sessionLength) sessionLength.value = payload.settings.sessionLength;
      if (payload.settings.repetitionPreference) {
        repetitionPreference.value = payload.settings.repetitionPreference;
      }
    } else if (response.status !== 401) {
      show('error', t('settings.loadFailed'));
    }
  } catch {
    show('error', t('settings.loadFailed'));
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  loading.value = true;
  message.value = '';
  try {
    const response = await apiFetch(
      '/api/v1/settings',
      jsonRequest('PUT', {
        direction: direction.value,
        sessionLength: sessionLength.value,
        repetitionPreference: repetitionPreference.value,
      }),
    );
    if (response.ok) show('success', t('settings.saved'));
    else show('error', t('settings.saveFailed'));
  } catch {
    show('error', t('settings.saveFailed'));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="content-section" aria-labelledby="settings-title">
    <p class="eyebrow">{{ t('settings.eyebrow') }}</p>
    <h1 id="settings-title">{{ t('settings.heading') }}</h1>
    <!-- Locked while loading so a late response cannot overwrite the user's changes. -->
    <fieldset class="plain-fieldset" :disabled="loading">
      <legend class="visually-hidden">{{ t('settings.preferencesLegend') }}</legend>
      <SelectField
        id="settings-direction"
        v-model="direction"
        :label="t('settings.direction')"
        :options="directionOptions"
      />
      <TextField
        id="settings-session-length"
        v-model.number="sessionLength"
        :label="t('settings.sessionLength')"
        type="number"
        inputmode="numeric"
        min="1"
        max="100"
        :hint="t('settings.sessionLengthHint')"
        required
      />
      <AppButton :loading="loading" :loading-label="t('settings.saving')" @click="save">
        {{ t('settings.save') }}
      </AppButton>
    </fieldset>
    <!-- Language is a local preference: it changes the interface immediately and
         is stored on this device, so it needs no save and no backend change. -->
    <fieldset class="plain-fieldset" :disabled="false">
      <legend class="visually-hidden">{{ t('settings.language') }}</legend>
      <SelectField
        id="settings-language"
        :model-value="locale"
        :label="t('settings.language')"
        :hint="t('settings.languageHelp')"
        :options="languageOptions"
        @update:model-value="changeLanguage"
      />
    </fieldset>
    <LiveMessage :tone="tone" :message="message" />
  </section>
</template>
