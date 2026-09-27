<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AppButton, SelectField, LiveMessage, TextField } from '../components';
import { apiFetch, jsonRequest } from '../api';
import { setLocale, supportedLocales, type LocaleCode } from '../i18n';
import { directionValues, type Direction, type Tone } from '../types';
import {
  enabledCount,
  loadPracticeVocabulary,
  practiceVocabulary,
  setAllEnabled,
  setEntryEnabled,
} from '../practice-vocabulary';
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
  void loadPracticeVocabulary();
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
    <!-- Practice vocabulary: which entries Practice Mode may use. Available to
         every identity, and stored the same way each identity stores everything
         else (an account for a user, temporary state for a guest). -->
    <section class="content-section" aria-labelledby="vocab-title">
      <h2 id="vocab-title" class="settings__heading">{{ t('vocabulary.title') }}</h2>
      <p class="muted">{{ t('vocabulary.intro') }}</p>

      <p v-if="practiceVocabulary.saving" class="muted" role="status">
        {{ t('vocabulary.saving') }}
      </p>
      <p v-else-if="practiceVocabulary.error === 'load'" class="field__error" role="alert">
        {{ t('vocabulary.loadFailed') }}
      </p>
      <p v-else-if="practiceVocabulary.error === 'save'" class="field__error" role="alert">
        {{ t('vocabulary.saveFailed') }}
      </p>

      <LoadingState
        v-if="practiceVocabulary.loading && !practiceVocabulary.loaded"
        :label="t('vocabulary.loading')"
      />

      <template v-else>
        <p v-if="!practiceVocabulary.entries.length" class="muted">
          {{ t('vocabulary.empty') }}
        </p>

        <template v-else>
          <!-- Not a live region: each checkbox already announces its own state, so
               announcing the count on every tick would only add noise. -->
          <p class="muted vocabulary__count">
            {{
              t('vocabulary.selectedOf', {
                enabled: enabledCount(),
                total: practiceVocabulary.entries.length,
              })
            }}
          </p>
          <p v-if="!enabledCount()" class="field__error">{{ t('vocabulary.noneSelected') }}</p>

          <div class="button-row">
            <AppButton variant="secondary" @click="setAllEnabled(true)">
              {{ t('vocabulary.selectAll') }}
            </AppButton>
            <AppButton variant="secondary" @click="setAllEnabled(false)">
              {{ t('vocabulary.deselectAll') }}
            </AppButton>
          </div>

          <!-- A native checkbox per row, wrapped in a label so the whole row is the
               tap target. State is carried by the control itself, not by colour. -->
          <ul class="vocabulary__list">
            <li v-for="entry in practiceVocabulary.entries" :key="entry.id">
              <label class="vocabulary__row">
                <input
                  type="checkbox"
                  class="vocabulary__checkbox"
                  :checked="entry.enabled"
                  @change="setEntryEnabled(entry.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="vocabulary__word">{{ entry.english }}</span>
                <span class="vocabulary__translation muted">{{ entry.german }}</span>
                <span class="visually-hidden">
                  {{ entry.enabled ? t('vocabulary.stateEnabled') : t('vocabulary.stateDisabled') }}
                </span>
              </label>
            </li>
          </ul>
        </template>
      </template>
    </section>

    <LiveMessage :tone="tone" :message="message" />
  </section>
</template>
