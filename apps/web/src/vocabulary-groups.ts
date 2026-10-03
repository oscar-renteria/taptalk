import { computed, reactive } from 'vue';
import { apiFetch } from './api';
import { session } from './session';
import type { VocabularyGroup, VocabularyGroupEntry } from '@taptalk/shared';

/**
 * Custom vocabulary groups: a named, user-owned *scope* over the existing
 * vocabulary.
 *
 * A group is a selection, not a copy. It never edits vocabulary, never touches
 * attempts, and never widens the existing per-user on/off choice in Settings: it
 * narrows on top of it. So the word a learner toggles there and the word they are
 * actually asked cannot drift apart.
 *
 * The API is authoritative. Nothing here decides which words a group contains or
 * which entries a session may ask -- it sends ids and renders what comes back.
 * That is what keeps the scope from being inferred in the browser.
 *
 * It follows the existing state pattern in this app: one module-level `reactive`
 * object, like `practiceVocabulary`, `session` and `pwa`.
 */
export const vocabularyGroups = reactive({
  groups: [] as VocabularyGroup[],
  /** The group being edited, or null when the list is showing. */
  openGroupId: null as string | null,
  /** Every vocabulary entry with its membership flag for the open group. */
  entries: [] as VocabularyGroupEntry[],
  loading: false,
  saving: false,
  /** Typed failure reasons, translated at the point of display. */
  error: '' as '' | 'load' | 'save' | 'create' | 'rename' | 'delete',
  loaded: false,
  /** Search text for the group editor. Transient, never sent anywhere. */
  query: '',
  /**
   * The scope chosen for the next session, or null for all available vocabulary.
   *
   * Only a group id is ever sent. The browser cannot name vocabulary ids for a
   * session, because the API resolves membership itself.
   */
  selectedGroupId: null as string | null,
  /** The one undo level for a bulk membership action, or null. */
  undo: null as { ids: string[]; label: 'selected' | 'cleared' } | null,
});

/** Groups are only meaningful for a signed-in learner; a guest has none. */
export function groupsAvailable(): boolean {
  return Boolean(session.user);
}

/** The chosen scope, or null for the whole vocabulary. */
export function selectedGroup(): VocabularyGroup | null {
  return (
    vocabularyGroups.groups.find((group) => group.id === vocabularyGroups.selectedGroupId) ?? null
  );
}

/**
 * The chosen scope's id, or null for all available vocabulary.
 *
 * A getter rather than a bare property read so callers cannot write it by
 * accident: the scope is chosen through `selectScope`.
 */
export function selectedGroupId(): string | null {
  return vocabularyGroups.selectedGroupId;
}

/** How many words the chosen scope holds, for the picker's summary line. */
export function selectedGroupCount(): number | null {
  return selectedGroup()?.selectedCount ?? null;
}

const matchedEntries = computed(() => {
  const query = vocabularyGroups.query.trim().toLowerCase();
  if (!query) return vocabularyGroups.entries;
  return vocabularyGroups.entries.filter(
    (entry) =>
      entry.english.toLowerCase().includes(query) || entry.german.toLowerCase().includes(query),
  );
});

/** The editor rows, matching the search box across both languages. */
export const visibleGroupEntries = computed(() => matchedEntries.value);

/** True when a search is narrowing the editor, so bulk actions must say so. */
export function isFilteringGroups(): boolean {
  return vocabularyGroups.query.trim().length > 0;
}

/** How many visible rows are currently in the group, for the master checkbox. */
export function visibleSelectedCount(): number {
  return visibleGroupEntries.value.reduce((total, entry) => total + (entry.selected ? 1 : 0), 0);
}

/** Loads the learner's groups. Guests simply have none. */
export async function loadGroups(): Promise<void> {
  if (!groupsAvailable()) {
    vocabularyGroups.groups = [];
    vocabularyGroups.loaded = true;
    return;
  }
  vocabularyGroups.loading = true;
  vocabularyGroups.error = '';
  try {
    const response = await apiFetch('/api/v1/groups');
    const payload = (await response.json()) as { groups?: VocabularyGroup[] };
    if (response.ok && payload.groups) {
      vocabularyGroups.groups = payload.groups;
      vocabularyGroups.loaded = true;
    } else if (response.status !== 401) {
      vocabularyGroups.error = 'load';
    }
  } catch {
    vocabularyGroups.error = 'load';
  } finally {
    vocabularyGroups.loading = false;
  }
}

/**
 * Loads one group together with every vocabulary entry and its membership flag.
 *
 * One request, so the editor never needs a call per word.
 */
export async function openGroup(groupId: string): Promise<void> {
  vocabularyGroups.openGroupId = groupId;
  vocabularyGroups.loading = true;
  vocabularyGroups.error = '';
  vocabularyGroups.undo = null;
  try {
    const response = await apiFetch(`/api/v1/groups/${encodeURIComponent(groupId)}`);
    const payload = (await response.json()) as {
      group?: VocabularyGroup;
      entries?: VocabularyGroupEntry[];
    };
    if (response.ok && payload.group && payload.entries) {
      vocabularyGroups.entries = payload.entries;
      const index = vocabularyGroups.groups.findIndex((group) => group.id === groupId);
      if (index >= 0) vocabularyGroups.groups[index] = payload.group;
    } else if (response.status !== 401) {
      vocabularyGroups.error = 'load';
    }
  } catch {
    vocabularyGroups.error = 'load';
  } finally {
    vocabularyGroups.loading = false;
  }
}

/** Leaves the editor without saving anything. */
export function closeGroup(): void {
  vocabularyGroups.openGroupId = null;
  vocabularyGroups.entries = [];
  vocabularyGroups.query = '';
  vocabularyGroups.undo = null;
}

/** Creates a group and opens it, so the learner can pick words straight away. */
export async function createGroup(name: string): Promise<VocabularyGroup | null> {
  vocabularyGroups.error = '';
  const response = await apiFetch('/api/v1/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    vocabularyGroups.error = 'create';
    return null;
  }
  const { group } = (await response.json()) as { group: VocabularyGroup };
  vocabularyGroups.groups = [group, ...vocabularyGroups.groups];
  return group;
}

export async function renameGroup(groupId: string, name: string): Promise<boolean> {
  vocabularyGroups.error = '';
  const response = await apiFetch(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    vocabularyGroups.error = 'rename';
    return false;
  }
  const { group } = (await response.json()) as { group: VocabularyGroup };
  const index = vocabularyGroups.groups.findIndex((candidate) => candidate.id === groupId);
  if (index >= 0) vocabularyGroups.groups[index] = group;
  return true;
}

/**
 * Deletes a group.
 *
 * This removes the scope and nothing else: no vocabulary, no answers, no attempts,
 * and no historical session is affected. Sessions created under it keep the name
 * they were started with.
 */
export async function deleteGroup(groupId: string): Promise<boolean> {
  vocabularyGroups.error = '';
  const response = await apiFetch(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    vocabularyGroups.error = 'delete';
    return false;
  }
  vocabularyGroups.groups = vocabularyGroups.groups.filter((group) => group.id !== groupId);
  // A deleted group can no longer be the chosen scope.
  if (vocabularyGroups.selectedGroupId === groupId) vocabularyGroups.selectedGroupId = null;
  return true;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Bumped on every membership edit, so a slow save belonging to an older state can
// never overwrite a newer one.
let generation = 0;
const saveDelayMs = 600;

/** Flips one entry and schedules a batched save. */
export function setEntrySelected(vocabularyEntryId: string, selected: boolean): void {
  const entry = vocabularyGroups.entries.find(
    (candidate) => candidate.vocabularyEntryId === vocabularyEntryId,
  );
  if (!entry) return;
  entry.selected = selected;
  generation += 1;
  scheduleSave();
}

/**
 * Bulk action over the given rows, defaulting to the whole list.
 *
 * The affected rows are kept so the action can be undone. Selecting the words of a
 * whole unit is real work, and losing it to one mis-tap is not recoverable.
 */
export function setAllSelected(selected: boolean, rows?: VocabularyGroupEntry[]): void {
  const affected = rows ?? vocabularyGroups.entries;
  vocabularyGroups.undo = {
    ids: affected.filter((entry) => entry.selected).map((entry) => entry.vocabularyEntryId),
    label: selected ? 'cleared' : 'selected',
  };
  for (const entry of affected) entry.selected = selected;
  generation += 1;
  scheduleSave();
}

/**
 * Undoes the last bulk action as one batched change.
 *
 * `undo.label` records what the rows were *before* the action, not what the
 * action did: 'selected' means these words were on, 'cleared' means none were.
 * That is the only thing needed to put them back, and it keeps the undo correct
 * for a partial search-scoped action as well as a whole-list one.
 */
export function restoreSelected(): void {
  const undo = vocabularyGroups.undo;
  if (!undo) return;
  const wasSelected = new Set(undo.ids);
  for (const entry of vocabularyGroups.entries) {
    entry.selected = undo.label === 'selected' ? wasSelected.has(entry.vocabularyEntryId) : false;
  }
  vocabularyGroups.undo = null;
  generation += 1;
  scheduleSave();
}

export function dismissUndo(): void {
  vocabularyGroups.undo = null;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveGroupEntries();
  }, saveDelayMs);
}

/**
 * Sends the whole membership as one request, replacing it server-side.
 *
 * Replacing rather than merging is what makes "Clear all" one round trip. The
 * server validates every id against the real vocabulary table before writing.
 */
export async function saveGroupEntries(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  const groupId = vocabularyGroups.openGroupId;
  if (!groupId) return;
  const vocabularyEntryIds = vocabularyGroups.entries
    .filter((entry) => entry.selected)
    .map((entry) => entry.vocabularyEntryId);
  const sentAt = generation;
  vocabularyGroups.saving = true;
  vocabularyGroups.error = '';
  try {
    const response = await apiFetch(`/api/v1/groups/${encodeURIComponent(groupId)}/entries`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vocabularyEntryIds }),
    });
    if (!response.ok) {
      vocabularyGroups.error = 'save';
      return;
    }
    // A save that belongs to an older generation must not settle the UI.
    if (sentAt !== generation) return;
    const group = vocabularyGroups.groups.find((candidate) => candidate.id === groupId);
    if (group) group.selectedCount = vocabularyEntryIds.length;
  } catch {
    vocabularyGroups.error = 'save';
  } finally {
    vocabularyGroups.saving = false;
  }
}

/** Chooses the scope for the next session, or null for all vocabulary. */
export function selectScope(groupId: string | null): void {
  vocabularyGroups.selectedGroupId = groupId;
}

/** Clears every cached group state, e.g. on sign-out. */
export function resetGroups(): void {
  vocabularyGroups.groups = [];
  vocabularyGroups.entries = [];
  vocabularyGroups.openGroupId = null;
  vocabularyGroups.selectedGroupId = null;
  vocabularyGroups.query = '';
  vocabularyGroups.undo = null;
  vocabularyGroups.loaded = false;
  vocabularyGroups.error = '';
}
