<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { AppButton, SelectField, LiveMessage, TextField } from '../components';
import { apiFetch, jsonRequest } from '../api';
import { directionOptions, type Direction, type Tone } from '../types';

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
      show('error', 'Settings could not be loaded.');
    }
  } catch {
    show('error', 'Settings could not be loaded.');
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
    if (response.ok) show('success', 'Settings saved.');
    else show('error', 'Settings could not be saved.');
  } catch {
    show('error', 'Settings could not be saved.');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="content-section" aria-labelledby="settings-title">
    <p class="eyebrow">Your preferences</p>
    <h1 id="settings-title">Set your rhythm.</h1>
    <!-- Locked while loading so a late response cannot overwrite the user's changes. -->
    <fieldset class="plain-fieldset" :disabled="loading">
      <legend class="visually-hidden">Practice preferences</legend>
      <SelectField
        id="settings-direction"
        v-model="direction"
        label="Default direction"
        :options="directionOptions"
      />
      <TextField
        id="settings-session-length"
        v-model.number="sessionLength"
        label="Questions per session"
        type="number"
        inputmode="numeric"
        min="1"
        max="100"
        hint="Between 1 and 100."
        required
      />
      <AppButton :loading="loading" @click="save">Save settings</AppButton>
    </fieldset>
    <LiveMessage :tone="tone" :message="message" />
  </section>
</template>
