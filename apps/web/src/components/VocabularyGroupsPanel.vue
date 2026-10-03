<script setup lang="ts">
/**
 * Settings: the learner's vocabulary groups.
 *
 * Two screens in one component, because they are two steps of the same job: the
 * list of groups, and the editor that chooses which words one group holds.
 *
 * Everything here works in vocabulary ids and asks the API what the group
 * contains. The client never decides membership, because the API owns that.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { AppButton, LiveMessage, LoadingState, TextField } from './index';
import {
  closeGroup,
  createGroup,
  deleteGroup,
  dismissUndo,
  isFilteringGroups,
  loadGroups,
  openGroup,
  renameGroup,
  restoreSelected,
  selectScope,
  setAllSelected,
  setEntrySelected,
  vocabularyGroups,
  visibleGroupEntries,
  visibleSelectedCount,
} from '../vocabulary-groups';

const { t } = useI18n();
const router = useRouter();

// The panel owns loading its own data, so it works wherever it is mounted.
onMounted(() => {
  void loadGroups();
});

const newName = ref('');
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const confirmingDelete = ref<VocabularyGroupSummary | null>(null);
const openGroupRecord = computed(
  () => vocabularyGroups.groups.find((group) => group.id === vocabularyGroups.openGroupId) ?? null,
);

/** Just what the confirm dialog needs to name the group. */
type VocabularyGroupSummary = { id: string; name: string };

const allVisibleSelected = computed(
  () =>
    visibleGroupEntries.value.length > 0 &&
    visibleSelectedCount() === visibleGroupEntries.value.length,
);

function wordCount(count: number): string {
  return count === 1
    ? t('vocabulary.groups.wordCountOne')
    : t('vocabulary.groups.wordCount', { count });
}

async function submitNew(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  const group = await createGroup(name);
  if (group) {
    newName.value = '';
    await openGroup(group.id);
  }
}

function startRename(id: string, name: string): void {
  renamingId.value = id;
  renameValue.value = name;
}

async function submitRename(): Promise<void> {
  const name = renameValue.value.trim();
  const id = renamingId.value;
  if (!id || !name) return;
  if (await renameGroup(id, name)) renamingId.value = null;
}

async function confirmDelete(): Promise<void> {
  const target = confirmingDelete.value;
  if (!target) return;
  if (await deleteGroup(target.id)) confirmingDelete.value = null;
}

/**
 * Chooses this group as the scope for the next session and leaves Settings.
 *
 * The scope is remembered in the store, so the Practice screen's picker already
 * shows it. The API still resolves which words that means.
 */
async function practiseGroup(groupId: string): Promise<void> {
  selectScope(groupId);
  await router.push({ name: 'practice' });
}

/**
 * Bulk buttons only act on the rows actually on screen, so searching and then
 * clearing never touches a word that was never shown. While a search is
 * narrowing the list, the label says so rather than implying the whole list.
 */
function bulkLabel(action: 'select' | 'clear'): string {
  const filtering = isFilteringGroups();
  const key = filtering
    ? action === 'select'
      ? 'vocabulary.groupEditor.selectAllVisible'
      : 'vocabulary.groupEditor.clearAllVisible'
    : action === 'select'
      ? 'vocabulary.groupEditor.selectAll'
      : 'vocabulary.groupEditor.clearAll';
  return t(key, { count: visibleGroupEntries.value.length });
}

function toggleAllVisible(): void {
  // Bulk actions act on the rows actually on screen, so searching and then
  // clearing never touches a word that was never shown.
  setAllSelected(!allVisibleSelected.value, visibleGroupEntries.value);
}

const undoLabel = computed(() => {
  const undo = vocabularyGroups.undo;
  if (!undo) return '';
  return t('vocabulary.groupEditor.undo', {
    action: t(
      `vocabulary.groups.${undo.label === 'cleared' ? 'selectAll' : 'clearAll'}`,
    ).toLowerCase(),
    count: undo.ids.length,
  });
});
</script>

<template>
  <section class="content-section" aria-labelledby="groups-title">
    <h2 id="groups-title" class="settings__heading">{{ t('vocabulary.groups.title') }}</h2>
    <p class="muted">{{ t('vocabulary.groups.intro') }}</p>

    <LoadingState
      v-if="vocabularyGroups.loading && !vocabularyGroups.loaded"
      :label="t('vocabulary.groups.loading')"
    />

    <template v-else>
      <!-- The editor takes over the whole section while a group is open. -->
      <template v-if="openGroupRecord">
        <h3>{{ t('vocabulary.groupEditor.title') }}</h3>
        <p class="muted">{{ t('vocabulary.groupEditor.intro') }}</p>

        <div class="vocabulary__toolbar" role="toolbar">
          <div class="vocabulary__master">
            <input
              id="group-select-all"
              type="checkbox"
              class="vocabulary__checkbox"
              :checked="allVisibleSelected"
              :aria-label="allVisibleSelected ? bulkLabel('clear') : bulkLabel('select')"
              @change="toggleAllVisible"
            />
            <label for="group-select-all" class="vocabulary__master-label">
              {{
                t('vocabulary.groupEditor.selectedOf', {
                  selected: visibleSelectedCount(),
                  total: vocabularyGroups.entries.length,
                })
              }}
            </label>
          </div>
          <div class="vocabulary__search">
            <TextField
              id="group-search"
              :model-value="vocabularyGroups.query"
              :label="t('vocabulary.groupEditor.search')"
              type="search"
              @update:model-value="vocabularyGroups.query = String($event)"
            />
          </div>
        </div>

        <p v-if="vocabularyGroups.saving" class="muted" role="status">
          {{ t('vocabulary.saving') }}
        </p>
        <p v-else-if="vocabularyGroups.error === 'save'" class="field__error" role="alert">
          {{ t('vocabulary.groupEditor.saveFailed') }}
        </p>

        <LiveMessage v-if="vocabularyGroups.undo" class="muted">
          {{ undoLabel }}
          <AppButton variant="text" @click="restoreSelected()">
            {{ t('vocabulary.undoAction') }}
          </AppButton>
          <AppButton variant="text" @click="dismissUndo()">
            {{ t('vocabulary.undoDismiss') }}
          </AppButton>
        </LiveMessage>

        <p v-if="!visibleGroupEntries.length" class="muted">
          {{ t('vocabulary.groupEditor.empty') }}
        </p>

        <ul v-else class="vocabulary__list">
          <li
            v-for="entry in visibleGroupEntries"
            :key="entry.vocabularyEntryId"
            class="vocabulary__row"
          >
            <label class="vocabulary__row-label">
              <input
                type="checkbox"
                class="vocabulary__checkbox"
                :checked="entry.selected"
                @change="setEntrySelected(entry.vocabularyEntryId, !entry.selected)"
              />
              <span class="vocabulary__english">{{ entry.english }}</span>
              <span class="vocabulary__german">{{ entry.german }}</span>
            </label>
          </li>
        </ul>

        <AppButton @click="closeGroup()">{{ t('vocabulary.groupEditor.back') }}</AppButton>
      </template>

      <template v-else>
        <p v-if="vocabularyGroups.error === 'load'" class="field__error" role="alert">
          {{ t('vocabulary.groups.loadFailed') }}
        </p>
        <p v-else-if="vocabularyGroups.error === 'delete'" class="field__error" role="alert">
          {{ t('vocabulary.groups.deleteFailed') }}
        </p>
        <p v-else-if="vocabularyGroups.error === 'rename'" class="field__error" role="alert">
          {{ t('vocabulary.groups.renameFailed') }}
        </p>
        <p v-else-if="vocabularyGroups.error === 'create'" class="field__error" role="alert">
          {{ t('vocabulary.groups.createFailed') }}
        </p>

        <p v-if="!vocabularyGroups.groups.length" class="muted">
          {{ t('vocabulary.groups.empty') }}
        </p>

        <ul v-else class="vocabulary__list">
          <li v-for="group in vocabularyGroups.groups" :key="group.id" class="vocabulary__row">
            <div class="vocabulary__row-label">
              <template v-if="renamingId === group.id">
                <TextField
                  id="group-rename"
                  :model-value="renameValue"
                  :label="t('vocabulary.groups.createPlaceholder')"
                  @update:model-value="renameValue = String($event)"
                  @keyup.enter="submitRename"
                />
                <AppButton @click="submitRename()">
                  {{ t('vocabulary.groups.renameAction') }}
                </AppButton>
              </template>
              <template v-else>
                <span class="vocabulary__english">{{ group.name }}</span>
                <span class="muted">
                  {{
                    group.selectedCount
                      ? wordCount(group.selectedCount)
                      : t('vocabulary.groups.none')
                  }}
                </span>
              </template>
            </div>
            <div class="vocabulary__actions">
              <AppButton v-if="renamingId !== group.id" @click="openGroup(group.id)">
                {{ t('vocabulary.groups.open') }}
              </AppButton>
              <AppButton
                v-if="renamingId !== group.id"
                variant="text"
                @click="startRename(group.id, group.name)"
              >
                {{ t('vocabulary.groups.rename') }}
              </AppButton>
              <AppButton @click="practiseGroup(group.id)">
                {{ t('vocabulary.groups.practiseWith') }}
              </AppButton>
              <AppButton
                variant="text"
                @click="confirmingDelete = { id: group.id, name: group.name }"
              >
                {{ t('vocabulary.groups.delete') }}
              </AppButton>
            </div>
          </li>
        </ul>

        <div
          v-if="confirmingDelete"
          class="vocabulary__actions"
          role="alertdialog"
          :aria-label="t('vocabulary.groups.delete')"
        >
          <p>{{ t('vocabulary.groups.deleteConfirm', { name: confirmingDelete.name }) }}</p>
          <AppButton @click="confirmDelete()">{{ t('vocabulary.groups.delete') }}</AppButton>
          <AppButton variant="text" @click="confirmingDelete = null">
            {{ t('vocabulary.groups.deleteCancel') }}
          </AppButton>
        </div>

        <form class="vocabulary__actions" @submit.prevent="submitNew">
          <TextField
            id="group-name"
            v-model="newName"
            :label="t('vocabulary.groups.createPlaceholder')"
            :placeholder="t('vocabulary.groups.createPlaceholder')"
          />
          <AppButton type="submit">{{ t('vocabulary.groups.createAction') }}</AppButton>
        </form>
      </template>
    </template>
  </section>
</template>
