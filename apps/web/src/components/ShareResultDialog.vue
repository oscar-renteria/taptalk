<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ShareResultPayload } from '@taptalk/shared';
import AppButton from './AppButton.vue';
import AppCard from './AppCard.vue';
import LiveMessage from './LiveMessage.vue';
import {
  directionLabel,
  renderShareCardBlob,
  shareCardFilename,
  type ShareCardStrings,
} from '../share-card';
import {
  buildShareMessage,
  canNativeShare,
  canShareFiles,
  copyText,
  downloadBlob,
  nativeShare,
  shareUrl,
  type ShareMessages,
} from '../share';

/**
 * The share sheet for one completed result.
 *
 * Owns presentation only. The payload it renders is the sanitized object the API
 * returned, so nothing here can recalculate a score or reach private data.
 *
 * Native sharing is offered when the browser has it but is never the only route:
 * the copy and save actions stay visible, because desktop browsers frequently
 * expose `navigator.share` and still refuse to attach files.
 */
const props = defineProps<{
  open: boolean;
  path: string;
  payload: ShareResultPayload;
}>();

const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();
const dialog = ref<HTMLDivElement | null>(null);
const message = ref('');
const tone = ref<'info' | 'success' | 'error'>('info');
const busy = ref(false);

const url = computed(() => shareUrl(props.path));
const format = (value: number) => {
  try {
    return new Intl.NumberFormat(locale.value).format(value);
  } catch {
    return String(value);
  }
};
const kindLabel = computed(() =>
  props.payload.kind === 'exam' ? t('share.exam') : t('share.practice'),
);

/** The card's own strings, resolved from the active locale. */
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

const direction = computed(() => directionLabel(props.payload.direction, cardStrings.value));

const messageStrings = computed<ShareMessages>(() => ({
  headline: t('share.messageHeadline', { correct: '{correct}', total: '{total}' }),
  invitation: t('share.messageInvitation'),
  tryTapTalk: t('share.tryTapTalk'),
}));

const fullMessage = computed(() =>
  buildShareMessage(props.payload, url.value, messageStrings.value, locale.value),
);

// Resolved while the dialog is open rather than at setup: `navigator` is only
// meaningful in a browser, and support must be re-checked on each open.
const nativeSupported = ref(false);
const filesSupported = ref(false);

async function buildCard(): Promise<File | null> {
  try {
    const blob = await renderShareCardBlob(props.payload, cardStrings.value, {
      locale: locale.value,
      url: url.value,
    });
    return new File([blob], shareCardFilename(props.payload), { type: 'image/png' });
  } catch {
    return null;
  }
}

async function refreshSupport(): Promise<void> {
  nativeSupported.value = canNativeShare({ text: fullMessage.value });
  filesSupported.value = false;
  if (!nativeSupported.value) return;
  const file = await buildCard();
  filesSupported.value = file ? canShareFiles([file]) : false;
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    message.value = '';
    void refreshSupport();
    // Focus moves into the dialog so the keyboard and a screen reader land here
    // rather than back on the Share button behind it.
    requestAnimationFrame(() => {
      dialog.value?.querySelector<HTMLElement>('button')?.focus();
    });
  },
  // `immediate` matters: the dialog is mounted already open (the parent only
  // renders it once a share exists), so without it this watcher would never run
  // and native sharing would never be detected.
  { immediate: true },
);

/** Escape closes, and Tab is kept inside the dialog while it is open. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
    return;
  }
  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}
async function onShare(): Promise<void> {
  busy.value = true;
  const text = fullMessage.value;
  const file = filesSupported.value ? await buildCard() : null;
  const title = t('share.dialogTitle');
  // Prefer sharing the image itself where the OS accepts files; otherwise send
  // the text and URL. Target selection is the operating system's job.
  const outcome = await nativeShare(
    file ? { files: [file], text, title } : { text, title, url: url.value },
  );
  busy.value = false;
  if (outcome === 'shared') {
    tone.value = 'success';
    message.value = t('share.shared');
  } else if (outcome === 'dismissed') {
    message.value = '';
  } else if (outcome === 'unsupported') {
    tone.value = 'info';
    message.value = t('share.nativeUnsupported');
  } else {
    tone.value = 'error';
    message.value = t('share.shareFailed');
  }
}

async function copyLink(): Promise<void> {
  const ok = await copyText(url.value);
  tone.value = ok ? 'success' : 'error';
  message.value = ok ? t('share.linkCopied') : t('share.copyFailed');
}

async function copyMessage(): Promise<void> {
  const ok = await copyText(fullMessage.value);
  tone.value = ok ? 'success' : 'error';
  message.value = ok ? t('share.messageCopied') : t('share.copyFailed');
}

async function saveImage(): Promise<void> {
  busy.value = true;
  try {
    const blob = await renderShareCardBlob(props.payload, cardStrings.value, {
      locale: locale.value,
      url: url.value,
    });
    downloadBlob(blob, shareCardFilename(props.payload));
    tone.value = 'success';
    message.value = t('share.imageSaved');
  } catch {
    tone.value = 'error';
    message.value = t('share.imageFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="props.open" class="share-overlay" @keydown="onKeydown">
    <!-- The click target that dismisses the sheet sits behind the card. -->
    <div class="share-overlay__scrim" @click="emit('close')"></div>
    <div
      ref="dialog"
      class="share-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
    >
      <AppCard>
        <h2 id="share-dialog-title">{{ t('share.dialogTitle') }}</h2>

        <!--
          The textual equivalent of the generated image. A canvas has no accessible
          contents, so this is what a screen reader announces instead.
        -->
        <p class="share-dialog__preview" data-testid="share-preview">
          <strong class="share-dialog__score">
            {{ format(props.payload.correctCount) }} /
            {{ format(props.payload.totalQuestions) }}
          </strong>
          <span class="share-dialog__percent">{{ format(props.payload.score) }}%</span>
          <span class="muted">{{ kindLabel }} · {{ direction }}</span>
        </p>

        <div class="button-row">
          <AppButton
            v-if="nativeSupported"
            :loading="busy"
            :loading-label="t('share.sharing')"
            @click="onShare"
          >
            {{ t('share.nativeShare') }}
          </AppButton>
          <AppButton v-else variant="secondary" :disabled="busy" @click="copyLink">
            {{ t('share.copyLink') }}
          </AppButton>
          <AppButton
            variant="secondary"
            :loading="busy"
            :loading-label="t('share.saving')"
            @click="saveImage"
          >
            {{ t('share.saveImage') }}
          </AppButton>
        </div>

        <!--
          The fallback actions are always present, not only when native sharing is
          missing: a desktop browser can offer the share sheet and still refuse to
          send an image, and the learner needs a way out either way.
        -->
        <div class="button-row">
          <AppButton v-if="nativeSupported" variant="text" :disabled="busy" @click="copyLink">
            {{ t('share.copyLink') }}
          </AppButton>
          <AppButton variant="text" :disabled="busy" @click="copyMessage">
            {{ t('share.copyMessage') }}
          </AppButton>
          <AppButton variant="text" :disabled="busy" @click="emit('close')">
            {{ t('common.close') }}
          </AppButton>
        </div>

        <p class="muted share-dialog__note">{{ t('share.privacyNote') }}</p>
        <LiveMessage :tone="tone" :message="message" />
      </AppCard>
    </div>
  </div>
</template>
