import { computed, reactive } from 'vue';
import { apiFetch, jsonRequest } from './api';
import { session } from './session';
import type { PracticeVocabularyEntry } from '@taptalk/shared';

/** Which rows the list shows. Transient: never sent anywhere, never persisted. */
export type VocabularyFilter = 'all' | 'selected' | 'not-selected';
/** Display order. A display choice only, so it is not sent anywhere either. */
export type VocabularySort = 'english' | 'german';
/** How tall the rows are. This one is a real preference, so it is remembered. */
export type VocabularyDensity = 'comfortable' | 'compact';

const densityStorageKey = 'taptalk.vocabularyDensity';

/**
 * Reads the remembered density.
 *
 * Wrapped because storage throws in private browsing on some platforms, and a
 * list that cannot be made comfortable is still a usable list.
 */
export function loadVocabularyDensity(): VocabularyDensity {
  try {
    return window.localStorage.getItem(densityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function storeVocabularyDensity(density: VocabularyDensity): void {
  try {
    window.localStorage.setItem(densityStorageKey, density);
  } catch {
    // A preference that cannot be stored is simply not remembered.
  }
}

/**
 * Splits a stored answer string into the separate answers it holds.
 *
 * The dataset stores "Bist du im Urlaub in?; Sind Sie im Urlaub in?" in one
 * field. It is split for display only: the stored string is never rewritten, and
 * the search box still matches the original text.
 */
export function splitAnswers(value: string): string[] {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The word the list sorts on.
 *
 * Leading punctuation and symbols are dropped, so "(inline) skating" files under
 * I rather than sorting ahead of every letter on a byte comparison.
 */
export function sortKey(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+/u, '');
}

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
  /** Search text for the Settings list. Transient, never sent anywhere. */
  query: '',
  /** Which rows are shown. Transient, never sent anywhere. */
  filter: 'all' as VocabularyFilter,
  /** Display order. Transient, never sent anywhere. */
  sort: 'english' as VocabularySort,
  /** Row height. Remembered locally, because it is a display preference. */
  density: loadVocabularyDensity(),
  /** The one undo level for a bulk action, or null when there is nothing to undo. */
  undo: null as { snapshot: Array<{ id: string; enabled: boolean }>; count: number } | null,
});

/** Sets the density and remembers it. */
export function setVocabularyDensity(density: VocabularyDensity): void {
  practiceVocabulary.density = density;
  storeVocabularyDensity(density);
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: PracticeVocabularyEntry[] | null = null;
// Bumped on every edit. A save response that belongs to an older generation is
// ignored, so a slow request can never overwrite a newer selection.
let generation = 0;

const saveDelayMs = 600;

/**
 * Id lookup, so a toggle is O(1) instead of scanning the list. Rebuilt whenever
 * the list is replaced; this only matters once the list is long.
 */
let byId = new Map<string, PracticeVocabularyEntry>();

function reindex(): void {
  byId = new Map(practiceVocabulary.entries.map((entry) => [entry.id, entry]));
}

export function enabledCount(): number {
  return practiceVocabulary.entries.reduce((total, entry) => total + (entry.enabled ? 1 : 0), 0);
}

/**
 * The rows the user can currently see: everything, or the matches for the search
 * box. Matching is case-insensitive across both languages, because a learner
 * looking for a word may know it in either.
 *
 * Filtering is client-side on purpose. The API already returns the whole list in
 * one response, so the client already holds every row: paging the reads would not
 * save anything and would make "select everything" ambiguous.
 */
const matchedEntries = computed(() => {
  const query = practiceVocabulary.query.trim().toLowerCase();
  if (!query) return practiceVocabulary.entries;
  return practiceVocabulary.entries.filter(
    (entry) =>
      entry.english.toLowerCase().includes(query) || entry.german.toLowerCase().includes(query),
  );
});

/** Search first, then the All / Selected / Not selected filter. */
const filteredEntries = computed(() => {
  const filter = practiceVocabulary.filter;
  if (filter === 'all') return matchedEntries.value;
  return matchedEntries.value.filter((entry) =>
    filter === 'selected' ? entry.enabled : !entry.enabled,
  );
});

/**
 * Rows the filter and search currently admit.
 *
 * With "Selected" showing, unticking a row would otherwise make it disappear the
 * instant the pointer is still on it. So the visible set is frozen whenever the
 * search or the filter changes, and not on every tick: the row stays put until
 * the learner next changes what they are looking at.
 *
 * The freeze is recomputed on read rather than in a watcher, so it is always in
 * step with the list. A watcher would lag by a flush and show a row that had
 * just left the filter, which is the same bug in a different place.
 */
let frozenKey: string | null = null;
let frozenIds: Set<string> = new Set();

function frozenFor(key: string): Set<string> {
  if (key !== frozenKey) {
    frozenKey = key;
    frozenIds = new Set(filteredEntries.value.map((entry) => entry.id));
  }
  return frozenIds;
}

/** The rows on screen, in the chosen order. */
export const visibleEntries = computed(() => {
  // The list arriving counts as a change in what is visible; its length does not
  // change when a save comes back, so a save cannot re-freeze mid-interaction.
  const key = `${practiceVocabulary.query}|${practiceVocabulary.filter}|${practiceVocabulary.entries.length}`;
  const ids = frozenFor(key);
  // Search results, narrowed to the rows the freeze admitted. The Selected
  // filter is deliberately not re-applied here: it already decided which rows
  // these are, and re-applying it would drop a row the moment it is unticked.
  const rows = matchedEntries.value.filter((entry) => ids.has(entry.id));
  const locale = typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en';
  // A collator, not a string compare: it ignores case, orders accented letters
  // where a reader expects them, and sorts embedded numbers as numbers.
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const field = practiceVocabulary.sort === 'german' ? 'german' : 'english';
  return [...rows].sort(
    (a, b) => collator.compare(sortKey(a[field]), sortKey(b[field])) || a.id.localeCompare(b.id),
  );
});

/** True when a search or a filter is narrowing the list, so bulk actions must say so. */
export function isFiltering(): boolean {
  return practiceVocabulary.query.trim().length > 0 || practiceVocabulary.filter !== 'all';
}

/** How many of the visible rows are currently on, for the master checkbox. */
export function visibleEnabledCount(): number {
  return visibleEntries.value.reduce((total, entry) => total + (entry.enabled ? 1 : 0), 0);
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
      reindex();
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
  const entry = byId.get(id);
  if (!entry) return;
  entry.enabled = enabled;
  generation += 1;
  scheduleSave();
}

/**
 * Bulk action over the given rows, defaulting to the whole list.
 *
 * Settings passes the rows the user can actually see, so a search followed by
 * "deselect" only touches the matches. Without that, filtering to find something
 * and then deselecting would quietly switch off every word that was never shown.
 *
 * The previous state of the affected rows is kept so the action can be undone:
 * a curated selection is worth a lot of work, and losing it to one mis-tap is
 * not a recoverable mistake. Single-row toggles deliberately do not create an
 * undo entry; they are already trivial to reverse.
 */
export function setAllEnabled(enabled: boolean, rows?: PracticeVocabularyEntry[]): void {
  const affected = rows ?? practiceVocabulary.entries;
  practiceVocabulary.undo = {
    snapshot: affected.map((entry) => ({ id: entry.id, enabled: entry.enabled })),
    count: affected.length,
  };
  for (const entry of affected) entry.enabled = enabled;
  generation += 1;
  scheduleSave();
}

/** Undoes the last bulk action as one batched change, so it costs one save. */
export function restoreEnabled(): void {
  const undo = practiceVocabulary.undo;
  if (!undo) return;
  for (const { id, enabled } of undo.snapshot) {
    const entry = byId.get(id);
    if (entry) entry.enabled = enabled;
  }
  practiceVocabulary.undo = null;
  generation += 1;
  scheduleSave();
}

/** Dismisses the undo message without changing anything. */
export function dismissUndo(): void {
  practiceVocabulary.undo = null;
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
      if (payload.entries) {
        practiceVocabulary.entries = payload.entries;
        reindex();
      }
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
  practiceVocabulary.query = '';
  practiceVocabulary.filter = 'all';
  practiceVocabulary.sort = 'english';
  practiceVocabulary.density = loadVocabularyDensity();
  practiceVocabulary.undo = null;
  frozenKey = null;
  frozenIds = new Set();
  reindex();
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
