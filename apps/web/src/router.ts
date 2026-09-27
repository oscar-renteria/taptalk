import { watch } from 'vue';
import {
  createRouter,
  createWebHistory,
  type RouteLocationRaw,
  type RouterHistory,
} from 'vue-router';
import { setSessionExpiredHandler } from './api';
import { i18n } from './i18n';
import { flushPracticeVocabulary } from './practice-vocabulary';
import { actorKind, restoreSession, session } from './session';
import AdminImportView from './views/AdminImportView.vue';
import AuthView from './views/AuthView.vue';
import NotFoundView from './views/NotFoundView.vue';
import PracticeView from './views/PracticeView.vue';
import ProgressView from './views/ProgressView.vue';
import ExamView from './views/ExamView.vue';
import SettingsView from './views/SettingsView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** Translation key for the document title, resolved in the active UI language. */
    titleKey: string;
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
        meta: { titleKey: 'auth.loginTitle', access: 'guest' },
      },
      {
        path: '/register',
        name: 'register',
        component: AuthView,
        props: { mode: 'register' },
        meta: { titleKey: 'auth.registerTitle', access: 'guest' },
      },
      {
        path: '/practice',
        name: 'practice',
        component: PracticeView,
        meta: { titleKey: 'nav.practice', access: 'user' },
      },
      {
        path: '/exams',
        name: 'exams',
        component: ExamView,
        meta: { titleKey: 'nav.exams', access: 'user' },
      },
      {
        path: '/progress',
        name: 'progress',
        component: ProgressView,
        meta: { titleKey: 'nav.progress', access: 'user' },
      },
      {
        path: '/settings',
        name: 'settings',
        component: SettingsView,
        meta: { titleKey: 'nav.settings', access: 'user' },
      },
      {
        path: '/admin/import',
        name: 'admin-import',
        component: AdminImportView,
        meta: { titleKey: 'admin.title', access: 'administrator' },
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: NotFoundView,
        meta: { titleKey: 'nav.pageNotFound', access: 'any' },
      },
    ],
    scrollBehavior: () => ({ top: 0 }),
  });

  // The UI guard only decides what to show; the API enforces access on every request.
  router.beforeEach(async (to): Promise<true | RouteLocationRaw> => {
    // Leaving Settings is as good a moment as closing the tab: a pending
    // vocabulary edit is sent now rather than waiting out its debounce.
    flushPracticeVocabulary();
    await restoreSession();
    const { access } = to.meta;
    // Anyone with an identity (a real user or a guest) is kept out of the account screens.
    if (access === 'guest' && actorKind() !== 'anonymous') return safeRedirect(to.query.redirect);
    // A guest reaches the practice, progress, and settings screens, exactly as a
    // user does, but never the account screens.
    const canUseApp = !!session.user || session.guest;
    if (access === 'user' && !canUseApp) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
    if (access === 'administrator') {
      // A guest has no role, so a guest reaching an administrator URL is simply
      // returned to the app they can use, not bounced to the login screen.
      if (session.guest) return { name: 'practice' };
      if (!session.user) return { name: 'login', query: { redirect: to.fullPath } };
      if (session.user.role !== 'administrator') return { name: 'practice' };
    }
    return true;
  });

  // Titles are translation keys so they follow the UI language, including when
  // the language changes while the user stays on the same route.
  const applyTitle = (to: { meta: { titleKey?: string } }): void => {
    const key = to.meta.titleKey;
    document.title = key
      ? `${i18n.global.t(key)} · ${i18n.global.t('app.name')}`
      : (i18n.global.t('app.name') as string);
  };
  router.afterEach(applyTitle);
  // Re-apply on locale change so switching language updates the title too.
  watch(
    () => i18n.global.locale.value,
    () => applyTitle(router.currentRoute.value),
  );
  // Set once at creation so the first paint already has a translated title.
  applyTitle(router.currentRoute.value);

  return router;
}

// A 401 from the API means the session ended elsewhere: go to login and come back afterwards.
// `expired` is carried in the query so the login screen can explain why the visitor is back,
// instead of leaving them to guess whether they were logged out or their link failed.
export function installSessionExpiry(router: ReturnType<typeof createAppRouter>): void {
  setSessionExpiredHandler(() => {
    const current = router.currentRoute.value;
    if (current.meta.access !== 'guest') {
      void router.replace({
        name: 'login',
        query: { redirect: current.fullPath, expired: '1' },
      });
    }
  });
}
