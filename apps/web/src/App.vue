<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AppButton,
  AppNav,
  ErrorState,
  LoadingState,
  StatusMessage,
  UpdateBanner,
} from './components';
import { session, signOut } from './session';

const route = useRoute();
const router = useRouter();
const networkUnavailable = ref(typeof navigator !== 'undefined' && !navigator.onLine);
const viewFailed = ref(false);
const navItems = computed(() => [
  { to: '/practice', label: 'Practice' },
  { to: '/progress', label: 'Progress' },
  { to: '/settings', label: 'Settings' },
  ...(session.user?.role === 'administrator'
    ? [{ to: '/admin/import', label: 'Import vocabulary' }]
    : []),
]);
const signedInLayout = computed(
  () => !!session.user && route.meta.access !== 'guest' && route.name !== 'not-found',
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

router.afterEach(() => {
  viewFailed.value = false;
});

async function logout(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
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
  <main class="shell">
    <UpdateBanner />
    <StatusMessage
      v-if="networkUnavailable"
      tone="warning"
      class="offline-banner"
      message="You are offline. Practice and account data need a connection."
    />
    <div v-if="!session.checked" class="panel">
      <LoadingState label="Checking your session..." />
    </div>
    <section v-else-if="signedInLayout && session.user" class="panel panel--wide">
      <header class="app-header">
        <div>
          <p class="eyebrow">TapTalk practice desk</p>
          <p class="user-label">{{ session.user.username }}</p>
        </div>
        <AppButton variant="text" @click="logout">Log out</AppButton>
      </header>
      <AppNav label="Main navigation" :items="navItems" />
      <ErrorState
        v-if="viewFailed"
        message="Something went wrong on this page."
        retry-label="Reload"
        @retry="reload"
      />
      <RouterView v-else />
    </section>
    <ErrorState
      v-else-if="viewFailed"
      class="panel"
      message="Something went wrong on this page."
      retry-label="Reload"
      @retry="reload"
    />
    <RouterView v-else />
  </main>
</template>
