<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
// LoadingState was used in the template without being imported, so the list
// rendered nothing at all while the vocabulary was being fetched.
import {
  AppButton,
  SelectField,
  LiveMessage,
  LoadingState,
  TextField,
  VocabularyGroupsPanel,
} from '../components';
import { loadGroups } from '../vocabulary-groups';
import { session } from '../session';
import { apiFetch, jsonRequest } from '../api';
import { setLocale, supportedLocales, type LocaleCode } from '../i18n';
import { directionValues, type Direction, type Tone } from '../types';
import {
  dismissUndo,
  enabledCount,
  isFiltering,
  loadPracticeVocabulary,
  practiceVocabulary,
  restoreEnabled,
  setAllEnabled,
  setEntryEnabled,
  setVocabularyDensity,
  splitAnswers,
  visibleEnabledCount,
  visibleEntries,
  type VocabularyDensity,
  type VocabularyFilter,
  type VocabularySort,
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

// --- Practice vocabulary list ------------------------------------------------

const filterValues: VocabularyFilter[] = ['all', 'selected', 'not-selected'];
const sortValues: VocabularySort[] = ['english', 'german'];
const densityValues: VocabularyDensity[] = ['comfortable', 'compact'];

const filterOptions = computed(() =>
  filterValues.map((value) => ({ value, label: t(`vocabulary.filter.${value}`) })),
);
const sortOptions = computed(() =>
  sortValues.map((value) => ({ value, label: t(`vocabulary.sort.${value}`) })),
);
const densityOptions = computed(() =>
  densityValues.map((value) => ({ value, label: t(`vocabulary.density.${value}`) })),
);

const masterCheckbox = ref<HTMLInputElement | null>(null);

/**
 * The master checkbox reflects the rows on screen, not the whole list: a search
 * or a filter narrows what a bulk action would touch, so it narrows what the
 * control reports too.
 */
const visibleCount = computed(() => visibleEntries.value.length);
const allVisibleEnabled = computed(
  () => visibleCount.value > 0 && visibleEnabledCount() === visibleCount.value,
);

/** "Indeterminate" is a property of the element, not an attribute Vue can bind. */
watchEffect(() => {
  if (masterCheckbox.value) {
    masterCheckbox.value.indeterminate = visibleEnabledCount() > 0 && !allVisibleEnabled.value;
  }
});

/**
 * The name a screen reader hears for the master checkbox: what pressing it will
 * do, and to how many rows. The visible label beside it says how many are
 * selected instead, so the two are not the same sentence.
 */
const masterLabel = computed(() => {
  const count = visibleCount.value;
  if (allVisibleEnabled.value) {
    return isFiltering()
      ? t('vocabulary.deselectAllVisible', { count })
      : t('vocabulary.deselectAllCounted', { count });
  }
  return isFiltering()
    ? t('vocabulary.selectAllVisible', { count })
    : t('vocabulary.selectAllCounted', { count });
});

function toggleAllVisible(): void {
  setAllEnabled(!allVisibleEnabled.value, visibleEntries.value);
}

/**
 * Wraps the part of a value that the search box matched, so the hit is visible
 * in the row itself. Built from plain text segments, never from markup.
 */
type Segment = { text: string; hit: boolean };

function highlight(value: string): Segment[] {
  const query = practiceVocabulary.query.trim();
  if (!query) return [{ text: value, hit: false }];
  const at = value.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return [{ text: value, hit: false }];
  return [
    { text: value.slice(0, at), hit: false },
    { text: value.slice(at, at + query.length), hit: true },
    { text: value.slice(at + query.length), hit: false },
  ].filter((segment) => segment.text.length > 0);
}

/** The German field as separate pills when it holds several answers. */
function pills(value: string): string[] {
  return splitAnswers(value);
}

const undoMessage = computed(() => {
  const undo = practiceVocabulary.undo;
  if (!undo) return '';
  return t('vocabulary.undo', { count: undo.count, enabled: enabledCount() });
});

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
  // Groups are a separate, optional scope, so they load on their own and a
  // failure there never blocks the vocabulary list above.
  void loadGroups();
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
          <!-- One toolbar for the whole list: what is selected, how to find a
               word, which ones to show, in what order, and how tall. It sticks to
               the top of the list so the count and the search stay reachable
               while a long list scrolls. -->
          <div class="vocabulary__toolbar" role="toolbar" :aria-label="t('vocabulary.toolbar')">
            <div class="vocabulary__master">
              <input
                id="vocabulary-select-all"
                ref="masterCheckbox"
                type="checkbox"
                class="vocabulary__checkbox"
                :checked="allVisibleEnabled"
                :aria-label="masterLabel"
                @change="toggleAllVisible"
              />
              <label for="vocabulary-select-all" class="vocabulary__master-label">
                {{
                  t('vocabulary.selectedOf', {
                    enabled: enabledCount(),
                    total: practiceVocabulary.entries.length,
                  })
                }}
              </label>
            </div>

            <!-- TextField passes extra attributes to the input, not to the element
                 that sits in the grid, so the width is set on a wrapper. -->
            <div class="vocabulary__search">
              <TextField
                id="vocabulary-search"
                v-model="practiceVocabulary.query"
                type="search"
                :label="t('vocabulary.searchLabel')"
                :placeholder="t('vocabulary.searchPlaceholder')"
                autocomplete="off"
              />
            </div>

            <fieldset class="segmented vocabulary__group">
              <legend>{{ t('vocabulary.filterLabel') }}</legend>
              <div class="segmented__options">
                <label
                  v-for="option in filterOptions"
                  :key="option.value"
                  class="segmented__option"
                >
                  <input
                    v-model="practiceVocabulary.filter"
                    type="radio"
                    name="vocabulary-filter"
                    :value="option.value"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="segmented vocabulary__group">
              <legend>{{ t('vocabulary.sortLabel') }}</legend>
              <div class="segmented__options">
                <label v-for="option in sortOptions" :key="option.value" class="segmented__option">
                  <input
                    v-model="practiceVocabulary.sort"
                    type="radio"
                    name="vocabulary-sort"
                    :value="option.value"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="segmented vocabulary__group">
              <legend>{{ t('vocabulary.densityLabel') }}</legend>
              <div class="segmented__options">
                <label
                  v-for="option in densityOptions"
                  :key="option.value"
                  class="segmented__option"
                >
                  <input
                    :checked="practiceVocabulary.density === option.value"
                    type="radio"
                    name="vocabulary-density"
                    :value="option.value"
                    @change="setVocabularyDensity(option.value as VocabularyDensity)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </fieldset>
          </div>

          <p v-if="!enabledCount()" class="field__error">{{ t('vocabulary.noneSelected') }}</p>

          <p v-if="isFiltering()" class="muted vocabulary__count">
            {{
              t('vocabulary.showingOf', {
                shown: visibleEntries.length,
                total: practiceVocabulary.entries.length,
              })
            }}
          </p>

          <p v-if="!visibleEntries.length" class="muted">
            {{ t('vocabulary.noMatches') }}
          </p>

          <!-- A native checkbox per row, wrapped in a label so the whole row is the
               tap target. State is carried by the control itself and by the hidden
               state text, never by colour alone. -->
          <ul class="vocabulary__list" :data-density="practiceVocabulary.density">
            <li v-for="entry in visibleEntries" :key="entry.id">
              <label class="vocabulary__row" :data-enabled="entry.enabled">
                <input
                  type="checkbox"
                  class="vocabulary__checkbox"
                  :checked="entry.enabled"
                  @change="setEntryEnabled(entry.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="vocabulary__content">
                  <span class="vocabulary__word">
                    <template v-for="(segment, index) in highlight(entry.english)" :key="index">
                      <mark v-if="segment.hit">{{ segment.text }}</mark
                      ><template v-else>{{ segment.text }}</template>
                    </template>
                  </span>
                  <span class="vocabulary__translation muted">
                    <template v-if="pills(entry.german).length > 1">
                      <span
                        v-for="(answer, index) in pills(entry.german)"
                        :key="index"
                        class="chip"
                        >{{ answer }}</span
                      >
                    </template>
                    <template v-else>{{ entry.german }}</template>
                  </span>
                </span>
                <span class="visually-hidden">
                  {{ entry.enabled ? t('vocabulary.stateEnabled') : t('vocabulary.stateDisabled') }}
                </span>
              </label>
            </li>
          </ul>

          <!-- Undo for a bulk action. It stays until the learner dismisses it,
               runs another bulk action, or leaves: a message that vanishes on a
               timer takes the only way back with it. -->
          <div v-if="practiceVocabulary.undo" class="vocabulary__undo">
            <p class="muted" role="status">{{ undoMessage }}</p>
            <div class="button-row">
              <AppButton variant="secondary" @click="restoreEnabled()">
                {{ t('vocabulary.undoAction') }}
              </AppButton>
              <AppButton variant="secondary" @click="dismissUndo()">
                {{ t('vocabulary.undoDismiss') }}
              </AppButton>
            </div>
          </div>
        </template>
      </template>
    </section>

    <!-- Groups: a separate, optional scope over the same vocabulary. Signed-in
         learners only, because a group belongs to an account. -->
    <VocabularyGroupsPanel v-if="session.user" />

    <LiveMessage :tone="tone" :message="message" />
  </section>
</template>
