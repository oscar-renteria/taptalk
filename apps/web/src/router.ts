import {
  createRouter,
  createWebHistory,
  type RouteLocationRaw,
  type RouterHistory,
} from 'vue-router';
import { setSessionExpiredHandler } from './api';
import { restoreSession, session } from './session';
import AdminImportView from './views/AdminImportView.vue';
import AuthView from './views/AuthView.vue';
import NotFoundView from './views/NotFoundView.vue';
import PracticeView from './views/PracticeView.vue';
import ProgressView from './views/ProgressView.vue';
import SettingsView from './views/SettingsView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title: string;
    access: 'guest' | 'user' | 'administrator' | 'any';
  }
}

// Only same-origin paths are accepted as a post-login destination (no open redirects).
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/practice';
}

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: '/practice' },
      {
        path: '/login',
        name: 'login',
        component: AuthView,
        props: { mode: 'login' },
        meta: { title: 'Log in', access: 'guest' },
      },
      {
        path: '/register',
        name: 'register',
        component: AuthView,
        props: { mode: 'register' },
        meta: { title: 'Create account', access: 'guest' },
      },
      {
        path: '/practice',
        name: 'practice',
        component: PracticeView,
        meta: { title: 'Practice', access: 'user' },
      },
      {
        path: '/progress',
        name: 'progress',
        component: ProgressView,
        meta: { title: 'Progress', access: 'user' },
      },
      {
        path: '/settings',
        name: 'settings',
        component: SettingsView,
        meta: { title: 'Settings', access: 'user' },
      },
      {
        path: '/admin/import',
        name: 'admin-import',
        component: AdminImportView,
        meta: { title: 'Import vocabulary', access: 'administrator' },
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: NotFoundView,
        meta: { title: 'Page not found', access: 'any' },
      },
    ],
    scrollBehavior: () => ({ top: 0 }),
  });

  // The UI guard only decides what to show; the API enforces access on every request.
  router.beforeEach(async (to): Promise<true | RouteLocationRaw> => {
    await restoreSession();
    const { access } = to.meta;
    if (access === 'guest' && session.user) return safeRedirect(to.query.redirect);
    if ((access === 'user' || access === 'administrator') && !session.user) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
    if (access === 'administrator' && session.user?.role !== 'administrator') {
      return { name: 'practice' };
    }
    return true;
  });

  router.afterEach((to) => {
    document.title = `${to.meta.title} · TapTalk`;
  });

  return router;
}

// A 401 from the API means the session ended elsewhere: go to login and come back afterwards.
export function installSessionExpiry(router: ReturnType<typeof createAppRouter>): void {
  setSessionExpiredHandler(() => {
    const current = router.currentRoute.value;
    if (current.meta.access !== 'guest') {
      void router.replace({ name: 'login', query: { redirect: current.fullPath } });
    }
  });
}
