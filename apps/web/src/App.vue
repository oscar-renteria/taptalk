<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, nextTick, onErrorCaptured, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AccountMenu,
  AppNav,
  ErrorState,
  LoadingState,
  StatusMessage,
  UpdateBanner,
} from './components';
import { endGuestSession } from './guest';
import { session, signOut, focus } from './session';
const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const networkUnavailable = ref(typeof navigator !== 'undefined' && !navigator.onLine);
const viewFailed = ref(false);
const navItems = computed(() => [
  { to: '/practice', label: t('nav.practice') },
  { to: '/exams', label: t('nav.exams') },
  { to: '/progress', label: t('nav.progress') },
  ...(session.user?.role === 'administrator'
    ? [{ to: '/admin/import', label: t('nav.vocabulary') }]
    : []),
  { to: '/settings', label: t('nav.settings') },
]);
// A guest uses the same app shell as a user, so the experience is identical.
const hasIdentity = computed(() => !!session.user || session.guest);
const signedInLayout = computed(
  () => hasIdentity.value && route.meta.access !== 'guest' && route.name !== 'not-found',
);

function updateNetworkState(): void {
  networkUnavailable.value = !navigator.onLine;
}

onMounted(() => {
  window.addEventListener('online', updateNetworkState);
  window.addEventListener('offline', updateNetworkState);
});

onUnmounted(() => {
  window.removeEventListener('online', updateNetworkState);
  window.removeEventListener('offline', updateNetworkState);
});

// Safe error state: an unexpected rendering error shows a recovery screen instead of a blank page.
onErrorCaptured((error) => {
  console.error(error);
  viewFailed.value = true;
  return false;
});

// After an in-app navigation, move focus to the new page heading so screen reader and keyboard
// users learn that the page changed. The first load keeps the browser's default focus.
let initialNavigation = true;
router.afterEach(async (to, from) => {
  viewFailed.value = false;
  if (initialNavigation) {
    initialNavigation = false;
    return;
  }
  if (to.path === from.path) return;
  await nextTick();
  const heading = document.querySelector<HTMLElement>('main h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
});

async function logout(): Promise<void> {
  try {
    if (session.guest) {
      // Ends the guest session and discards its temporary state.
      await endGuestSession();
    } else {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    }
  } finally {
    signOut();
    await router.replace('/login');
  }
}

function reload(): void {
  window.location.reload();
}
</script>

<template>
  <div
    class="shell"
    :data-layout="signedInLayout && hasIdentity ? 'app' : 'guest'"
    :data-focus="focus.practice ? 'true' : undefined"
  >
    <!-- The header stays available in focused mode: the redesign moves the tabs
         out of a live session, but signing out must remain reachable (a shared
         device, or a session that has gone wrong). -->
    <header v-if="session.checked && signedInLayout && hasIdentity" class="app-header">
      <RouterLink class="brand" to="/practice">
        <svg class="brand__mark" aria-hidden="true" width="32" height="32" viewBox="0 0 24 24">
          <path
            d="M4 4h16a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0120 17h-8l-5 4v-4H4a1.5 1.5 0 01-1.5-1.5v-10A1.5 1.5 0 014 4z"
            fill="currentColor"
          />
          <circle cx="9" cy="10.5" r="1.3" fill="var(--color-paper)" />
          <circle cx="15" cy="10.5" r="1.3" fill="var(--color-paper)" />
        </svg>
        <span class="brand__name">TapTalk</span>
      </RouterLink>
      <AppNav v-if="!focus.practice" :label="t('nav.label')" :items="navItems" />
      <AccountMenu :username="session.user?.username" :guest="session.guest" @logout="logout" />
    </header>
    <main class="page">
      <UpdateBanner />
      <StatusMessage
        v-if="session.guest"
        tone="info"
        class="guest-banner"
        :message="t('guest.banner')"
      />
      <StatusMessage
        v-if="networkUnavailable"
        tone="warning"
        class="offline-banner"
        :message="t('errors.network')"
      />
      <div v-if="!session.checked" class="panel">
        <LoadingState :label="t('common.checkingSession')" />
      </div>
      <ErrorState
        v-else-if="viewFailed"
        :class="{ panel: !signedInLayout }"
        :message="t('errors.pageError')"
        :retry-label="t('errors.reload')"
        @retry="reload"
      />
      <RouterView v-else />
    </main>
  </div>
</template>
