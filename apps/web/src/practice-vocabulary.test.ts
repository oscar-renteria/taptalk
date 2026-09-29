// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enabledCount,
  isFiltering,
  loadPracticeVocabulary,
  loadVocabularyDensity,
  practiceVocabulary,
  resetPracticeVocabulary,
  restoreEnabled,
  dismissUndo,
  savePracticeVocabulary,
  setAllEnabled,
  setEntryEnabled,
  setVocabularyDensity,
  sortKey,
  splitAnswers,
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

  it('renders one accessible checkbox per entry, plus a master checkbox', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    // The master control lives in the toolbar, so the row checkboxes are counted
    // inside the list rather than across the whole screen.
    const boxes = wrapper.findAll('.vocabulary__list input[type="checkbox"]');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.attributes('type')).toBe('checkbox');
      // A native checkbox inside a label, so the row is the target and the
      // control keeps its semantics for keyboard and screen readers.
      expect(box.element.closest('label')).not.toBeNull();
    }
    // And one master checkbox, which is not inside the list.
    expect(wrapper.findAll('#vocabulary-select-all')).toHaveLength(1);
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

  it('selects and deselects everything from the master checkbox', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    const master = () => wrapper.get<HTMLInputElement>('#vocabulary-select-all');
    // All three are on, so pressing the control turns them all off.
    expect(master().element.checked).toBe(true);
    await master().trigger('change');
    expect(enabledCount()).toBe(0);
    // The empty case is called out rather than looking like a broken list.
    expect(wrapper.text()).toContain('No vocabulary is currently selected for practice');

    // Now none are on, so the same control turns them all on.
    await master().trigger('change');
    expect(enabledCount()).toBe(3);
  });

  it('reports a partial selection as indeterminate', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    const master = () => wrapper.get<HTMLInputElement>('#vocabulary-select-all');
    expect(master().element.indeterminate).toBe(false);

    setEntryEnabled('entry-house', false);
    await flushPromises();
    // Neither on nor off: the list is in between, and the control says so.
    expect(master().element.checked).toBe(false);
    expect(master().element.indeterminate).toBe(true);
    // A screen reader is told what pressing it will do, and to how many rows.
    expect(master().attributes('aria-label')).toBe('Select all 3');

    setEntryEnabled('entry-house', true);
    await flushPromises();
    expect(master().element.indeterminate).toBe(false);
    expect(master().attributes('aria-label')).toBe('Deselect all 3');
  });

  it('scopes the master checkbox to the rows the search leaves visible', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    practiceVocabulary.query = 'app';
    await flushPromises();
    const master = () => wrapper.get<HTMLInputElement>('#vocabulary-select-all');
    // One row is visible, so the control speaks about one row.
    expect(master().attributes('aria-label')).toBe('Deselect these 1');

    await master().trigger('change');
    // Only the match was touched; the rows the search hid kept their state.
    expect(enabledCount()).toBe(2);
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
    await flushPromises();
    // Scoped to the list, so the master checkbox in the toolbar is not counted.
    expect(wrapper.findAll('.vocabulary__list input[type="checkbox"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('1 of 3 shown');
  });

  it('says how many rows the master checkbox will change when filtering', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();

    await wrapper.get('#vocabulary-search').setValue('o');
    await flushPromises();
    // The control says how many it will change, not "all".
    const master = wrapper.get<HTMLInputElement>('#vocabulary-select-all');
    expect(master.attributes('aria-label')).toBe('Deselect these 2');
  });

  it('says how many rows the master checkbox covers when nothing is filtered', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();
    expect(wrapper.get('#vocabulary-select-all').attributes('aria-label')).toBe('Deselect all 3');
  });

  it('explains an empty search result', async () => {
    mockApi({ ...signedIn, ...practiceVocabularyApi });
    const { wrapper } = await mountApp('/settings');
    await flushPromises();
    await wrapper.get('#vocabulary-search').setValue('zzzz');
    await flushPromises();
    // The message covers a search and a filter, because either can empty the list.
    expect(wrapper.text()).toContain('No words match your search or filter.');
    // No rows left, and the master control with them.
    expect(wrapper.findAll('.vocabulary__list input[type="checkbox"]')).toHaveLength(0);
  });
});

describe('filtering, sorting and density', () => {
  beforeEach(() => {
    resetPracticeVocabulary();
    window.localStorage.clear();
  });

  afterEach(() => {
    resetPracticeVocabulary();
    window.localStorage.clear();
  });

  /**
   * Loaded through the real path, so the id index the store keeps is rebuilt the
   * way the app rebuilds it. Assigning `entries` directly would leave that index
   * pointing at the previous list, and a toggle would quietly do nothing.
   */
  const awkward = [
    { id: 'e-1', english: '(inline) skating', german: 'Inlineskaten', enabled: true },
    { id: 'e-2', english: 'zebra', german: 'Zebra', enabled: false },
    { id: 'e-3', english: 'Apple', german: 'Apfel', enabled: true },
    { id: 'e-4', english: 'banana 10', german: 'Bananen', enabled: false },
    { id: 'e-5', english: 'banana 2', german: 'Zwiebel', enabled: true },
  ];

  async function load() {
    mockApi({ 'GET /api/v1/practice/vocabulary': { body: { entries: awkward } } });
    await loadPracticeVocabulary();
  }

  it('sorts by English, ignoring leading punctuation and case', async () => {
    await load();
    expect(visibleEntries.value.map((e) => e.english)).toEqual([
      'Apple',
      'banana 2',
      'banana 10',
      '(inline) skating',
      'zebra',
    ]);
  });

  it('sorts by German when asked', async () => {
    await load();
    practiceVocabulary.sort = 'german';
    expect(visibleEntries.value.map((e) => e.german)).toEqual([
      'Apfel',
      'Bananen',
      'Inlineskaten',
      'Zebra',
      'Zwiebel',
    ]);
  });

  it('sorts numerically inside a word, so 2 comes before 10', async () => {
    await load();
    const words = visibleEntries.value.map((e) => e.english);
    expect(words.indexOf('banana 2')).toBeLessThan(words.indexOf('banana 10'));
  });

  it('drops leading punctuation to build the sort key', () => {
    expect(sortKey('(inline) skating')).toBe('inline) skating');
    expect(sortKey('"quoted"')).toBe('quoted"');
    expect(sortKey('word')).toBe('word');
  });

  it('shows only the selected rows under the Selected filter', async () => {
    await load();
    practiceVocabulary.filter = 'selected';
    expect(visibleEntries.value.map((e) => e.english)).toEqual([
      'Apple',
      'banana 2',
      '(inline) skating',
    ]);
  });

  it('shows only the unselected rows under the Not selected filter', async () => {
    await load();
    practiceVocabulary.filter = 'not-selected';
    expect(visibleEntries.value.map((e) => e.english)).toEqual(['banana 10', 'zebra']);
  });

  it('counts a filter as filtering, so bulk actions say how many they touch', async () => {
    await load();
    expect(isFiltering()).toBe(false);
    practiceVocabulary.filter = 'selected';
    expect(isFiltering()).toBe(true);
    practiceVocabulary.filter = 'all';
    expect(isFiltering()).toBe(false);
    practiceVocabulary.query = 'a';
    expect(isFiltering()).toBe(true);
  });

  it('keeps an unticked row visible under Selected until the filter changes', async () => {
    await load();
    practiceVocabulary.filter = 'selected';
    const before = visibleEntries.value.map((e) => e.id);
    // Unticking must not make the row vanish from under the pointer.
    setEntryEnabled('e-3', false);
    expect(visibleEntries.value.map((e) => e.id)).toEqual(before);
    // The learner changes what they are looking at, and the row moves there.
    // Order is the English sort, so Apple, banana, zebra.
    practiceVocabulary.filter = 'not-selected';
    expect(visibleEntries.value.map((e) => e.english)).toEqual(['Apple', 'banana 10', 'zebra']);
  });

  it('combines a search with a filter', async () => {
    await load();
    practiceVocabulary.query = 'a';
    practiceVocabulary.filter = 'not-selected';
    expect(visibleEntries.value.map((e) => e.english)).toEqual(['banana 10', 'zebra']);
  });

  it('splits a field of several answers into pills, without changing the text', () => {
    expect(splitAnswers('Bist du im Urlaub in?; Sind Sie im Urlaub in?')).toEqual([
      'Bist du im Urlaub in?',
      'Sind Sie im Urlaub in?',
    ]);
    // Trimmed, and empty parts dropped.
    expect(splitAnswers(' a ;; b ;')).toEqual(['a', 'b']);
    // A single answer is left alone.
    expect(splitAnswers('Hallo')).toEqual(['Hallo']);
    const stored = 'Bist du im Urlaub in?; Sind Sie im Urlaub in?';
    splitAnswers(stored);
    expect(stored).toBe('Bist du im Urlaub in?; Sind Sie im Urlaub in?');
  });

  it('still matches the raw text when searching a multi-answer field', () => {
    practiceVocabulary.entries = [
      {
        id: 'e-1',
        english: 'on holiday',
        german: 'Bist du im Urlaub in?; Sind Sie im Urlaub in?',
        enabled: true,
      },
    ];
    practiceVocabulary.query = 'Sind Sie';
    expect(visibleEntries.value).toHaveLength(1);
  });

  it('remembers the density and falls back when storage is unavailable', () => {
    expect(loadVocabularyDensity()).toBe('comfortable');
    setVocabularyDensity('compact');
    expect(practiceVocabulary.density).toBe('compact');
    expect(loadVocabularyDensity()).toBe('compact');
    // A storage that throws must not take the list down with it: the list is
    // still usable, it is simply not remembered.
    const real = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => undefined,
      },
    });
    expect(loadVocabularyDensity()).toBe('comfortable');
    Object.defineProperty(window, 'localStorage', { configurable: true, value: real });
  });

  it('keeps the density across a remount', () => {
    setVocabularyDensity('compact');
    resetPracticeVocabulary();
    expect(practiceVocabulary.density).toBe('compact');
  });
});

describe('undo for a bulk action', () => {
  beforeEach(() => {
    resetPracticeVocabulary();
  });

  afterEach(() => {
    resetPracticeVocabulary();
  });

  it('restores exactly the previous selection', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setEntryEnabled('entry-house', false);
    setEntryEnabled('entry-car', false);
    expect(enabledCount()).toBe(1);

    setAllEnabled(true);
    expect(enabledCount()).toBe(3);

    restoreEnabled();
    // The two that were off are off again, and the one that was on is on.
    expect(enabledCount()).toBe(1);
    expect(practiceVocabulary.entries.find((e) => e.id === 'entry-house')?.enabled).toBe(false);
    expect(practiceVocabulary.entries.find((e) => e.id === 'entry-car')?.enabled).toBe(false);
    expect(practiceVocabulary.entries.find((e) => e.id === 'entry-apple')?.enabled).toBe(true);
  });

  it('undoes only the rows the bulk action touched', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    practiceVocabulary.query = 'app';
    setAllEnabled(false, visibleEntries.value);
    // Only the match was switched off.
    expect(practiceVocabulary.entries.find((e) => e.id === 'entry-apple')?.enabled).toBe(false);
    expect(practiceVocabulary.entries.find((e) => e.id === 'entry-house')?.enabled).toBe(true);

    restoreEnabled();
    expect(practiceVocabulary.entries.find((e) => e.id === 'entry-apple')?.enabled).toBe(true);
  });

  it('does not record an undo entry for a single-row toggle', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setEntryEnabled('entry-house', false);
    expect(practiceVocabulary.undo).toBeNull();
    setAllEnabled(false);
    expect(practiceVocabulary.undo).not.toBeNull();
  });

  it('replaces the undo entry when another bulk action runs', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setAllEnabled(false);
    expect(practiceVocabulary.undo?.count).toBe(3);
    setAllEnabled(true);
    // One level only: the newer action supersedes the older one.
    expect(practiceVocabulary.undo?.count).toBe(3);
    restoreEnabled();
    expect(enabledCount()).toBe(0);
  });

  it('clears the undo entry once it has been used or dismissed', async () => {
    mockApi(practiceVocabularyApi);
    await loadPracticeVocabulary();
    setAllEnabled(false);
    restoreEnabled();
    expect(practiceVocabulary.undo).toBeNull();

    setAllEnabled(false);
    dismissUndo();
    expect(practiceVocabulary.undo).toBeNull();
  });
});
