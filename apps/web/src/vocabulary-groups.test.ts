// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeGroup,
  createGroup,
  deleteGroup,
  isFilteringGroups,
  loadGroups,
  openGroup,
  renameGroup,
  resetGroups,
  restoreSelected,
  selectScope,
  selectedGroup,
  selectedGroupCount,
  selectedGroupId,
  setAllSelected,
  setEntrySelected,
  vocabularyGroups,
  visibleGroupEntries,
  visibleSelectedCount,
} from './vocabulary-groups';
import { session } from './session';
import type { User } from './types';
import { bodyOf, learner, mockApi } from './test-api';

const saveDelay = 700;

const groups = [
  {
    id: 'group-food',
    name: 'Food',
    selectedCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'group-travel',
    name: 'Travel',
    selectedCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const entries = [
  { vocabularyEntryId: 'entry-apple', english: 'apple', german: 'Apfel', selected: true },
  { vocabularyEntryId: 'entry-house', english: 'house', german: 'Haus', selected: true },
  { vocabularyEntryId: 'entry-car', english: 'car', german: 'Auto', selected: false },
];

const groupsApi = {
  'GET /api/v1/groups': { body: { groups } },
  'POST /api/v1/groups': { status: 201, body: { group: groups[0] } },
  'GET /api/v1/groups/group-food': { body: { group: groups[0], entries } },
  'PATCH /api/v1/groups/group-food': { body: { group: { ...groups[0], name: 'Meals' } } },
  'DELETE /api/v1/groups/group-food': { body: { deleted: true } },
  'PUT /api/v1/groups/group-food/entries': {
    body: { group: groups[0], entryIds: ['entry-apple'] },
  },
};

describe('vocabulary groups state', () => {
  beforeEach(() => {
    resetGroups();
    session.user = learner as User;
  });

  afterEach(() => {
    resetGroups();
    session.user = null;
  });

  it('loads the learner groups', async () => {
    mockApi(groupsApi);
    await loadGroups();
    expect(vocabularyGroups.groups.map((group) => group.name)).toEqual(['Food', 'Travel']);
    expect(vocabularyGroups.loaded).toBe(true);
  });

  it('has no groups for a guest, without asking the API', async () => {
    session.user = null;
    const fetchMock = mockApi({});
    await loadGroups();
    expect(vocabularyGroups.groups).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens a group and brings back every entry with its membership', async () => {
    mockApi(groupsApi);
    await openGroup('group-food');
    expect(vocabularyGroups.openGroupId).toBe('group-food');
    expect(vocabularyGroups.entries).toHaveLength(3);
    expect(visibleSelectedCount()).toBe(2);
  });

  it('filters the editor by a search across both languages', async () => {
    mockApi(groupsApi);
    await openGroup('group-food');
    vocabularyGroups.query = 'Haus';
    expect(visibleGroupEntries.value).toHaveLength(1);
    expect(isFilteringGroups()).toBe(true);
    vocabularyGroups.query = 'app';
    expect(visibleGroupEntries.value.map((entry) => entry.vocabularyEntryId)).toEqual([
      'entry-apple',
    ]);
    vocabularyGroups.query = '';
    expect(isFilteringGroups()).toBe(false);
  });

  it('sends the whole membership as one request, not one per row', async () => {
    const fetchMock = mockApi(groupsApi);
    await openGroup('group-food');
    setEntrySelected('entry-car', true);
    await new Promise((resolve) => setTimeout(resolve, saveDelay));
    await flushPromises();
    const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(bodyOf(fetchMock, 'PUT /api/v1/groups/group-food/entries')).toEqual({
      vocabularyEntryIds: ['entry-apple', 'entry-house', 'entry-car'],
    });
  });

  it('lets a bulk action be undone in one step', async () => {
    mockApi(groupsApi);
    await openGroup('group-food');
    setAllSelected(false, visibleGroupEntries.value);
    expect(visibleSelectedCount()).toBe(0);
    restoreSelected();
    // Back to the two words that were in the group before the clear.
    expect(visibleSelectedCount()).toBe(2);
  });

  it('only acts on the rows a search actually shows', async () => {
    const fetchMock = mockApi(groupsApi);
    await openGroup('group-food');
    vocabularyGroups.query = 'car';
    setAllSelected(true, visibleGroupEntries.value);
    await new Promise((resolve) => setTimeout(resolve, saveDelay));
    await flushPromises();
    // 'car' joined the group; apple and house were never touched.
    expect(bodyOf(fetchMock, 'PUT /api/v1/groups/group-food/entries')).toEqual({
      vocabularyEntryIds: ['entry-apple', 'entry-house', 'entry-car'],
    });
  });

  it('starts empty for a learner with no groups', async () => {
    mockApi({ 'GET /api/v1/groups': { body: { groups: [] } } });
    await loadGroups();
    expect(vocabularyGroups.groups).toEqual([]);
    expect(vocabularyGroups.error).toBe('');
  });

  it('keeps the chosen scope separate from the list, and clears it on delete', async () => {
    mockApi(groupsApi);
    await loadGroups();
    expect(selectedGroupId()).toBeNull();
    selectScope('group-food');
    expect(selectedGroup()?.name).toBe('Food');
    expect(selectedGroupCount()).toBe(2);

    await deleteGroup('group-food');
    // A deleted group can no longer be the scope, or a session would be sent a
    // group the API no longer knows.
    expect(selectedGroupId()).toBeNull();
    expect(vocabularyGroups.groups.map((group) => group.id)).toEqual(['group-travel']);
  });

  it('renames a group in place', async () => {
    mockApi(groupsApi);
    await loadGroups();
    expect(await renameGroup('group-food', 'Meals')).toBe(true);
    expect(vocabularyGroups.groups[0]?.name).toBe('Meals');
  });

  it('reports a rejected name instead of adding a broken group', async () => {
    mockApi({ ...groupsApi, 'POST /api/v1/groups': { status: 400, body: { error: {} } } });
    expect(await createGroup('   ')).toBeNull();
    expect(vocabularyGroups.error).toBe('create');
  });

  it('leaves the editor without saving when it is closed', async () => {
    mockApi(groupsApi);
    await openGroup('group-food');
    setEntrySelected('entry-car', true);
    closeGroup();
    expect(vocabularyGroups.openGroupId).toBeNull();
    expect(vocabularyGroups.entries).toEqual([]);
    expect(vocabularyGroups.undo).toBeNull();
  });

  it('does not warn for a signed-in learner with no groups to pick', async () => {
    mockApi({ 'GET /api/v1/groups': { body: { groups: [] } } });
    await loadGroups();
    selectScope(null);
    expect(selectedGroupCount()).toBeNull();
  });
});
