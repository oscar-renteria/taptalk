<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { ShareResultPayload } from '@taptalk/shared';
import AppButton from '../components/AppButton.vue';
import AppCard from '../components/AppCard.vue';
import LoadingState from '../components/LoadingState.vue';
import { directionLabel, type ShareCardStrings } from '../share-card';

/**
 * The public page for a shared result, reachable without an account.
 *
 * It renders the sanitized payload the API returned and nothing else: there is no
 * call here that could return the sharer's identity, and no localStorage or
 * client-side tracking of any kind. Opening the link asks the API for the card,
 * which is also what records the referral cookie server-side.
 */
const props = defineProps<{ token: string }>();

const { t, locale } = useI18n();
const router = useRouter();

const state = ref<'loading' | 'ready' | 'unavailable'>('loading');
const payload = ref<ShareResultPayload | null>(null);

const format = (value: number) => {
  try {
    return new Intl.NumberFormat(locale.value).format(value);
  } catch {
    return String(value);
  }
};

const cardStrings = computed<ShareCardStrings>(() => ({
  appName: t('app.name'),
  practice: t('share.practice'),
  exam: t('share.exam'),
  beatMyScore: t('share.beatMyScore'),
  tryTapTalk: t('share.tryTapTalk'),
  englishToGerman: t('share.englishToGerman'),
  germanToEnglish: t('share.germanToEnglish'),
  mixed: t('share.mixed'),
}));

const kindLabel = computed(() =>
  payload.value?.kind === 'exam' ? t('share.exam') : t('share.practice'),
);

const direction = computed(() =>
  payload.value ? directionLabel(payload.value.direction, cardStrings.value) : '',
);

// An accessible description of the card. The page never renders the generated
// image, so this sentence is the only representation of the result a screen
// reader receives, and it says the same thing the card says.
const summarySentence = computed(() => {
  if (!payload.value) return '';
  return t('share.accessibleSummary', {
    correct: format(payload.value.correctCount),
    total: format(payload.value.totalQuestions),
    percent: format(payload.value.score),
    kind: kindLabel.value,
    direction: direction.value,
  });
});

async function load(): Promise<void> {
  state.value = 'loading';
  try {
    const response = await fetch(`/api/v1/share/card/${encodeURIComponent(props.token)}`);
    // Unknown, revoked, and malformed tokens are indistinguishable by design, so
    // the page shows one calm "not available" state for all of them.
    if (!response.ok) {
      state.value = 'unavailable';
      return;
    }
    const body = (await response.json()) as { result?: ShareResultPayload };
    if (!body.result) {
      state.value = 'unavailable';
      return;
    }
    payload.value = body.result;
    state.value = 'ready';
  } catch {
    state.value = 'unavailable';
  }
}

watch(() => props.token, load, { immediate: true });
</script>

<template>
  <section class="content-section content-section--wide" aria-labelledby="share-title">
    <template v-if="state === 'loading'">
      <h1 id="share-title" class="visually-hidden">{{ t('share.pageTitle') }}</h1>
      <LoadingState :label="t('common.loading')" />
    </template>

    <template v-else-if="state === 'unavailable'">
      <h1 id="share-title">{{ t('share.pageTitle') }}</h1>
      <!--
        Unknown, revoked, and malformed tokens are indistinguishable by design, so
        this one calm state covers all of them.
      -->
      <AppCard>
        <h2 class="empty-state__title">{{ t('share.unavailableTitle') }}</h2>
        <p class="muted">{{ t('share.unavailableBody') }}</p>
      </AppCard>
      <div class="button-row">
        <AppButton @click="router.push('/register')">
          {{ t('share.tryTapTalk') }}
        </AppButton>
        <AppButton variant="secondary" @click="router.push('/login')">
          {{ t('share.logIn') }}
        </AppButton>
      </div>
    </template>

    <template v-else-if="payload">
      <div class="share-public">
        <p class="eyebrow">{{ t('share.eyebrow') }}</p>
        <h1 id="share-title">{{ t('share.pageTitle') }}</h1>

        <AppCard>
          <!--
            The numbers are the message. They are rendered as text, not colour or
            an image, so they survive greyscale, screen readers, and text-only mode.
          -->
          <p class="share-public__score" aria-hidden="true">
            <strong class="share-public__ratio">
              {{ format(payload.correctCount) }} / {{ format(payload.totalQuestions) }}
            </strong>
            <span class="share-public__percent">✓ {{ format(payload.score) }}%</span>
            <span class="muted">{{ kindLabel }} · {{ direction }}</span>
          </p>
          <p class="visually-hidden">{{ summarySentence }}</p>
        </AppCard>

        <h2>{{ t('share.canYouBeat') }}</h2>
        <p class="muted">{{ t('share.explain') }}</p>

        <div class="button-row">
          <AppButton @click="router.push('/register')">
            {{ t('share.tryTapTalk') }}
          </AppButton>
          <AppButton variant="secondary" @click="router.push('/login')">
            {{ t('share.logIn') }}
          </AppButton>
        </div>
        <p class="muted share-public__note">{{ t('share.privacyNote') }}</p>
      </div>
    </template>
  </section>
</template>
