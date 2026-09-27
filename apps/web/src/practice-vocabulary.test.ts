// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enabledCount,
  isFiltering,
  loadPracticeVocabulary,
  practiceVocabulary,
  resetPracticeVocabulary,
  savePracticeVocabulary,
  setAllEnabled,
  setEntryEnabled,
  visibleEntries,
} from './practice-vocabulary';
import { mockApi, mountApp, practiceVocabularyApi, signedIn, vocabularyEntries } from './test-api';

const saveDelay = 700;

describe('practice vocabulary state', () => {
  beforeEach(() => {
    resetPracticeVocabulary();
  });

  afterEach(() => {
    resetPracticeVocabulary();
  });

  it('loads the list and marks every entry enabled by default', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    expect(practiceVocabulary.entries).toHaveLength(3);
    expect(enabledCount()).toBe(3);
    expect(practiceVocabulary.loaded).toBe(true);
  });

  it('reports a load failure without leaving the list half-set', async () => {
    mockApi({ 'GET /api/v1/practice/vocabulary': { status: 500, body: {} } });
    await loadPracticeVocabulary();
    expect(practiceVocabulary.error).toBe('load');
    expect(practiceVocabulary.entries).toHaveLength(0);
  });

  it('batches edits into a single request rather than one per row', async () => {
    const fetchMock = mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    const puts = () =>
      fetchMock.mock.calls.filter(
        ([i, init]) => i === '/api/v1/practice/vocabulary' && init?.method === 'PUT',
      );

    setEntryEnabled('entry-car', false);
    setEntryEnabled('entry-house', false);
    setEntryEnabled('entry-apple', false);
    // Still one request: nothing has been sent while the user keeps tapping.
    expect(puts()).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, saveDelay));
    await flushPromises();
    // One request carries the whole disabled set.
    expect(puts()).toHaveLength(1);
    const body = JSON.parse(String(puts()[0]![1]!.body));
    expect(body.disabledIds.sort()).toEqual(['entry-apple', 'entry-car', 'entry-house']);
  });

  it('applies a tick instantly, before the save completes', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setEntryEnabled('entry-car', false);
    // The UI reflects the change at once rather than waiting for the network.
    expect(enabledCount()).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, saveDelay));
    await flushPromises();
  });

  it('supports select all and deselect all', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setAllEnabled(false);
    expect(enabledCount()).toBe(0);
    setAllEnabled(true);
    expect(enabledCount()).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, saveDelay));
    await flushPromises();
  });

  it('surfaces a save failure', async () => {
    mockApi({
      'GET /api/v1/practice/vocabulary': { body: { entries: vocabularyEntries } },
      'PUT /api/v1/practice/vocabulary': { status: 500, body: {} },
    });
    await loadPracticeVocabulary();
    await savePracticeVocabulary();
    expect(practiceVocabulary.error).toBe('save');
  });

  it('ignores an unknown id instead of inventing state', () => {
    mockApi(practiceVocabularyApi);
    setEntryEnabled('does-not-exist', false);
    expect(enabledCount()).toBe(0);
  });
});

describe('vocabulary selection in Settings', () => {
  beforeEach(() => {
    resetPracticeVocabulary();
  });

  afterEach(() => {
    resetPracticeVocabulary();
  });

  it('renders one accessible checkbox per entry', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.attributes('type')).toBe('checkbox');
      // A native checkbox inside a label, so the row is the target and the
      // control keeps its semantics for keyboard and screen readers.
      expect(box.element.closest('label')).not.toBeNull();
    }
    expect(wrapper.text()).toContain('apple');
  });

  it('shows the selected state and toggles it', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    // Narrowed to HTMLInputElement so the checked state can be read.
    const car = () => wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')[2]!;
    expect(car().element.checked).toBe(true);
    await car().setValue(false);
    expect(car().element.checked).toBe(false);
    expect(enabledCount()).toBe(2);
  });

  it('offers select all and deselect all', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Deselect all')!
      .trigger('click');
    expect(enabledCount()).toBe(0);
    // The empty case is called out rather than looking like a broken list.
    expect(wrapper.text()).toContain('No vocabulary is currently selected for practice');

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Select all')!
      .trigger('click');
    expect(enabledCount()).toBe(3);
  });

  it('shows an empty state when there is no vocabulary', async () => {
    mockApi({
      ...signedIn,
      'GET /api/v1/practice/vocabulary': { body: { entries: [] } },
    });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();
    expect(wrapper.text()).toContain('There is no vocabulary yet');
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
  });
});

describe('searching a long list', () => {
  beforeEach(() => {
    resetPracticeVocabulary();
  });

  afterEach(() => {
    resetPracticeVocabulary();
  });

  it('filters on the English word', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    practiceVocabulary.query = 'app';
    expect(visibleEntries.value.map((e) => e.english)).toEqual(['apple']);
  });

  it('filters on the German word too, and ignores case', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    practiceVocabulary.query = 'HAUS';
    expect(visibleEntries.value.map((e) => e.english)).toEqual(['house']);
  });

  it('shows everything again when the search is cleared', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    practiceVocabulary.query = 'car';
    expect(visibleEntries.value).toHaveLength(1);
    practiceVocabulary.query = '   ';
    expect(visibleEntries.value).toHaveLength(3);
    expect(isFiltering()).toBe(false);
  });

  it('returns nothing for a search that matches nothing', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    practiceVocabulary.query = 'zzzz';
    expect(visibleEntries.value).toHaveLength(0);
    // The underlying list is untouched, so clearing the search brings it back.
    expect(practiceVocabulary.entries).toHaveLength(3);
  });
});

describe('bulk actions respect the search', () => {
  beforeEach(() => {
    resetPracticeVocabulary();
  });

  afterEach(() => {
    resetPracticeVocabulary();
  });

  it('deselects only the visible rows, leaving hidden ones alone', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    practiceVocabulary.query = 'o'; // matches house and car
    setAllEnabled(false, visibleEntries.value);
    // The two matches are off; the hidden row is untouched.
    const off = practiceVocabulary.entries.filter((e) => !e.enabled).map((e) => e.english);
    expect(off.sort()).toEqual(['car', 'house']);
    expect(visibleEntries.value).toHaveLength(2);
  });

  it('selects only the visible rows', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setAllEnabled(false, visibleEntries.value); // all off
    practiceVocabulary.query = 'apple';
    setAllEnabled(true, visibleEntries.value);
    expect(enabledCount()).toBe(1);
  });

  it('still acts on the whole list when no search is active', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setAllEnabled(false, visibleEntries.value);
    expect(enabledCount()).toBe(0);
  });

  it('sends only the disabled rows in the batched save', async () => {
    const fetchMock = mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    practiceVocabulary.query = 'o';
    setAllEnabled(false, visibleEntries.value);
    await savePracticeVocabulary();
    const put = fetchMock.mock.calls.find(
      ([i, init]) => i === '/api/v1/practice/vocabulary' && init?.method === 'PUT',
    );
    const body = JSON.parse(String(put![1]!.body));
    expect(body.disabledIds.sort()).toEqual(['entry-car', 'entry-house']);
  });
});

describe('the Settings list reflects the search', () => {
  beforeEach(() => {
    resetPracticeVocabulary();
  });

  afterEach(() => {
    resetPracticeVocabulary();
  });

  it('shows only matching rows and says how many are shown', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    await wrapper.get('#vocabulary-search').setValue('car');
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('1 of 3 shown');
  });

  it('labels the bulk buttons with the filtered count', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    await wrapper.get('#vocabulary-search').setValue('o');
    // The buttons say how many they will change, not "all".
    expect(wrapper.text()).toContain('Deselect these 2');
    expect(wrapper.text()).toContain('Select these 2');
  });

  it('keeps the plain labels when nothing is filtered', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();
    expect(wrapper.text()).toContain('Deselect all');
    expect(wrapper.text()).not.toContain('Deselect these');
  });

  it('explains an empty search result', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();
    await wrapper.get('#vocabulary-search').setValue('zzzz');
    expect(wrapper.text()).toContain('No words match your search.');
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
  });
});
