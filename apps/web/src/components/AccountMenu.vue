<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
const { t } = useI18n();

// The account chip from the redesign. A disclosure (not an ARIA menu): the toggle reports
// aria-expanded, the panel holds ordinary buttons, and Escape or a click outside closes it.
// The panel is hidden with v-show so signing out stays one reliable element in the document.
const props = defineProps<{ username?: string | undefined; guest?: boolean | undefined }>();
const emit = defineEmits<{ logout: [] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const toggle = ref<HTMLButtonElement | null>(null);
const logoutButton = ref<HTMLButtonElement | null>(null);
const initial = computed(() => props.username?.charAt(0).toUpperCase() ?? '?');
const route = useRoute();

watch(
  () => route.fullPath,
  () => (open.value = false),
);

async function toggleMenu(): Promise<void> {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    logoutButton.value?.focus();
  }
}

function close(returnFocus: boolean): void {
  if (!open.value) return;
  open.value = false;
  if (returnFocus) toggle.value?.focus();
}

function onDocumentClick(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close(false);
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onUnmounted(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div ref="root" class="account" @keydown.escape="close(true)">
    <button
      ref="toggle"
      type="button"
      class="account__toggle"
      :aria-expanded="open ? 'true' : 'false'"
      aria-controls="account-menu"
      :aria-label="
        props.guest ? t('nav.guestMenu') : t('nav.accountMenu', { username: props.username ?? '' })
      "
      @click="toggleMenu"
    >
      <span class="account__avatar" aria-hidden="true">{{ initial }}</span>
      <span v-if="!props.guest" class="account__name">{{ props.username }}</span>
      <span v-else class="account__guest">{{ t('nav.guestBadge') }}</span>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
    <div v-show="open" id="account-menu" class="account__menu">
      <p class="account__signed-in">
        {{
          props.guest
            ? t('guest.menuNotice')
            : t('nav.signedInAs', { username: props.username ?? '' })
        }}
      </p>
      <button ref="logoutButton" type="button" class="account__item" @click="emit('logout')">
        {{ props.guest ? t('guest.end') : t('nav.logOut') }}
      </button>
    </div>
  </div>
</template>
