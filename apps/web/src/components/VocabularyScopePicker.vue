<script setup lang="ts">
/**
 * Chooses which words the next session draws from.
 *
 * "All available words" is the default and stays the default: a learner with no
 * groups sees exactly the behaviour they had before this existed.
 *
 * The picker only ever names a group. It never sends vocabulary ids, because the
 * API resolves membership itself -- the browser cannot widen a scope it was not
 * given, and cannot narrow one either.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { SelectField } from './index';
import { loadGroups, selectScope, selectedGroup, vocabularyGroups } from '../vocabulary-groups';

const { t } = useI18n();

onMounted(() => {
  void loadGroups();
});

const value = computed(() => vocabularyGroups.selectedGroupId ?? '');
const current = computed(() => selectedGroup());

const options = computed(() => [
  { value: '', label: t('practice.scope.all') },
  ...vocabularyGroups.groups.map((group) => ({
    value: group.id,
    label: t('practice.scope.count', { name: group.name, count: group.selectedCount }),
  })),
]);

/**
 * Why the current choice may fail to start, or empty when it is fine.
 *
 * The API stays the authority: this only warns ahead of time. The same cases are
 * still refused with a typed error, because a hint in the browser proves nothing.
 */
const warning = computed(() => {
  const group = current.value;
  if (!group) return '';
  if (group.selectedCount === 0) return t('practice.scope.emptyWarning');
  return '';
});
</script>

<template>
  <!-- Only for signed-in learners: a group belongs to an account, so a guest has
       none to choose and the control would be permanently empty. -->
  <div v-if="vocabularyGroups.groups.length" class="field">
    <SelectField
      id="vocabulary-scope"
      :model-value="value"
      :options="options"
      :label="t('practice.scope.label')"
      :error="warning || undefined"
      @update:model-value="selectScope($event === '' ? null : String($event))"
    />
    <p v-if="warning" class="field__error" role="alert">{{ warning }}</p>
  </div>
</template>
