import { reactive } from 'vue';
import { apiFetch, jsonRequest } from './api';
import { session } from './session';
import type { PracticeVocabularyEntry } from '@taptalk/shared';

/**
 * The single source of truth for which vocabulary Practice Mode may use.
 *
 * Settings writes it and Practice Mode reads it, so the checkbox a user leaves
 * ticked and the question they are actually asked cannot disagree. It follows
 * the existing state pattern in this app: one module-level `reactive` object,
 * like `session` and `pwa`, rather than a new store library.
 *
 * Edits are applied locally first and then saved as one debounced batch, so
 * ticking a row is instant and a long list costs one request, not one per row.
 */
export const practiceVocabulary = reactive({
  entries: [] as PracticeVocabularyEntry[],
  loading: false,
  saving: false,
  error: '',
  loaded: false,
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: PracticeVocabularyEntry[] | null = null;
// Bumped on every edit. A save response that belongs to an older generation is
// ignored, so a slow request can never overwrite a newer selection.
let generation = 0;

const saveDelayMs = 600;

export function enabledCount(): number {
  return practiceVocabulary.entries.filter((entry) => entry.enabled).length;
}

/** Loads the list and the stored selection for the current identity. */
export async function loadPracticeVocabulary(): Promise<void> {
  practiceVocabulary.loading = true;
  practiceVocabulary.error = '';
  try {
    const response = await apiFetch('/api/v1/practice/vocabulary');
    const payload = (await response.json()) as { entries?: PracticeVocabularyEntry[] };
    if (response.ok && payload.entries) {
      practiceVocabulary.entries = payload.entries;
      practiceVocabulary.loaded = true;
    } else if (response.status !== 401) {
      practiceVocabulary.error = 'load';
    }
  } catch {
    practiceVocabulary.error = 'load';
  } finally {
    practiceVocabulary.loading = false;
  }
}

/** Flips one entry and schedules a batched save. */
export function setEntryEnabled(id: string, enabled: boolean): void {
  const entry = practiceVocabulary.entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  entry.enabled = enabled;
  generation += 1;
  scheduleSave();
}

/** Bulk actions share the same batched save, so a full list change is still one request. */
export function setAllEnabled(enabled: boolean): void {
  for (const entry of practiceVocabulary.entries) entry.enabled = enabled;
  generation += 1;
  scheduleSave();
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void savePracticeVocabulary();
  }, saveDelayMs);
}

/** Sends the whole disabled set in one request, replacing it server-side. */
export async function savePracticeVocabulary(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  pending ??= practiceVocabulary.entries.map((entry) => ({ ...entry }));
  const snapshot = pending;
  const sentAt = generation;
  pending = null;
  practiceVocabulary.saving = true;
  practiceVocabulary.error = '';
  try {
    const response = await apiFetch(
      '/api/v1/practice/vocabulary',
      jsonRequest('PUT', { disabledIds: snapshot.filter((e) => !e.enabled).map((e) => e.id) }),
    );
    // An edit made while this was in flight makes the response stale.
    if (sentAt !== generation) return;
    if (response.ok) {
      const payload = (await response.json()) as { entries?: PracticeVocabularyEntry[] };
      if (payload.entries) practiceVocabulary.entries = payload.entries;
    } else {
      practiceVocabulary.error = 'save';
    }
  } catch {
    if (sentAt === generation) practiceVocabulary.error = 'save';
  } finally {
    if (sentAt === generation) practiceVocabulary.saving = false;
  }
}

/**
 * Saves any pending edit immediately.
 *
 * Edits are debounced so a long list stays responsive, but a user who ticks a
 * box and immediately closes the tab or the PWA must not lose the change. This
 * runs on page hide, when the debounce has not had time to fire.
 */
export function flushPracticeVocabulary(): void {
  if (saveTimer) void savePracticeVocabulary();
}

if (typeof window !== 'undefined') {
  // `pagehide` also fires on mobile when the app is backgrounded or closed, and
  // unlike `beforeunload` it is reliable on iOS.
  window.addEventListener('pagehide', flushPracticeVocabulary);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPracticeVocabulary();
  });
}

/** Test helper: clears state and any pending save. */
export function resetPracticeVocabulary(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  pending = null;
  generation += 1;
  practiceVocabulary.entries = [];
  practiceVocabulary.loading = false;
  practiceVocabulary.saving = false;
  practiceVocabulary.error = '';
  practiceVocabulary.loaded = false;
}

// The identity decides where this is stored: a user persists it to their
// account, a guest keeps it in the session with the rest of their temporary
// state. Either way the component above is identical.
export function vocabularyStorageLabel(): 'account' | 'guest' | 'none' {
  if (session.user) return 'account';
  return session.guest ? 'guest' : 'none';
}
