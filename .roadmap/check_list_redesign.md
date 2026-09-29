# Task: Redesign the Practice Vocabulary list in Settings (display density, toolbar, undo)

## Context
TapTalk is a Vue 3 + TypeScript PWA for practising vocabulary. On the Settings screen, users choose which
vocabulary entries Practice Mode and Exam Mode use. The list works, but it is hard to use:
- Every row has a 44px checkbox filled with `--color-ink`. When most rows are ticked, those ticks carry
  no useful information and are still the loudest thing on the screen.
- English is left-aligned and German right-aligned, so on a wide screen the eye travels a long way to match a pair.
- Answers with several options are shown as one string joined with semicolons
  ("Bist du im Urlaub in?; Sind Sie im Urlaub in?; …").
- Rows are about 74px tall. 54 entries already take roughly 4,000px of scrolling, and the dataset will grow.
- "Select all" and "Deselect all" are two separate buttons. Nothing shows the current state, and a
  curated selection can be wiped with no undo.
- The server sorts with `ORDER BY e.english, e.id` (SQLite BINARY collation). That puts
  "(inline) skating" first and sorts uppercase before lowercase.

This change is **frontend only**. Do not change the API, the database schema or the
`PracticeVocabularyEntry` type (`{ id, english, german, enabled }`).

## Files to read before editing
- `apps/web/src/views/SettingsView.vue`: the vocabulary `<section aria-labelledby="vocab-title">`.
- `apps/web/src/practice-vocabulary.ts`: the reactive store, `visibleEntries`, `setEntryEnabled`,
  `setAllEnabled`, and the debounced save (600ms, generation counter, flush on pagehide).
- `apps/web/src/style.css`: the tokens in `:root`, the block
  `/* --- Practice vocabulary list (Settings) */`, and the existing `.segmented`, `.chip` and
  `.chip-list` patterns.
- `apps/web/src/components/`: reuse `AppButton`, `TextField` and `LiveMessage`.
- `apps/web/src/locales/{en,de,es}.json`: the `vocabulary.*` keys.
- Tests: `apps/web/src/practice-vocabulary.test.ts`, `e2e/practice-vocabulary.spec.ts`, `e2e/exam.spec.ts`.
- `CONTRIBUTING.md`.

## Scope

### 1. Quieter, scannable selection state
- **Keep the native checkbox.** It must keep its semantics, focus order and 44×44px tap target.
  The whole row stays a `<label>`.
- **Make the checkbox visually lighter.** Draw a smaller visible box (about 22px) centred inside the
  44px hit area. The unchecked outline uses `--color-control-border`; the checked fill uses `--color-ink`.
  Use `accent-color` or a styled `appearance: none` checkbox. If you use `appearance: none`, draw a
  visible checkmark and keep `:focus-visible` using `--color-focus` or the existing ink outline.
- **Selected row:** background `--color-highlight` and a 3px inset left bar in `--color-success`.
- **Unselected row:** background `--color-surface` or `--color-panel`, text in `--color-muted`.
  Keep contrast at WCAG AA or better. Do not use opacity if it pushes text below 4.5:1.
- **State must not rely on colour alone.** Keep the checkbox and the existing visually-hidden
  "selected / not selected for practice" text.
- **Hover:** keep the existing `border-color: var(--color-ink)` behaviour.
- **Motion:** transitions of 150ms or less, disabled under `prefers-reduced-motion`. The existing
  media query at the end of the motion section already does this; extend it.

### 2. Two-line rows and a density toggle
- **Layout:** replace the three-column grid with `checkbox | content`.
  - Line 1: `.vocabulary__word` (English), weight 600, `--color-ink`.
  - Line 2: `.vocabulary__translation` (German), left-aligned, `--color-muted`.
  - Remove `text-align: right`.
- **Multiple answers:** if a field contains `;`, split it **for display only**. Trim each part, drop
  empty parts, and render each as a small pill (background `--color-segment`, radius from the existing
  tokens, `--space-1`/`--space-2` padding). A field without `;` renders as plain text. Apply this to both
  languages. Never change the stored strings. Search keeps matching the raw strings.
- **Density:** add a toggle with two options, Comfortable (default) and Compact, built with the
  existing `.segmented` radio pattern.
  - Compact: tighter vertical padding and English and German on one line when there is room, wrapping
    to two lines on narrow screens.
  - The 44px tap target must stay in both modes.
  - Store the choice in `localStorage` under a namespaced key (for example `taptalk.vocabularyDensity`).
    Wrap every read and write in try/catch, the way `i18n.ts` and `guest.ts` do. Fall back to
    Comfortable when storage is missing or unavailable.
- **Display sort (client-side):** add a computed sorted view that is used by `visibleEntries` (or
  wraps it).
  - Sort key: the string with leading non-letter characters removed (for example the regex
    `/^[^\p{L}\p{N}]+/u`).
  - Compare with `Intl.Collator(locale, { sensitivity: 'base', numeric: true })`, falling back to `id`
    on ties.
  - Offer a sort control with two options, "English A–Z" (default) and "German A–Z".
  - Do **not** offer "selected first": rows would jump away from the pointer mid-interaction.

### 3. Sticky toolbar with a master checkbox, filter chips and undo
Replace the count paragraph and the two bulk buttons with one toolbar that sticks to the top of the
scroll area (`position: sticky`, background `--color-paper` or `--color-surface`, bottom border
`--color-line`). Check `AppNav` and the existing `position: sticky` rules in `style.css` for a sticky
header, and offset `top` so the two don't overlap.

Toolbar contents, in order. On a phone they wrap onto several lines and never scroll horizontally.

1. **Master checkbox (three states)**
   - A native `<input type="checkbox">` with a visible label, for example "38 of 54 selected".
     Use `vocabulary.selectedOf`, or a new key if the wording needs to change.
   - Its state is calculated from the **visible** rows: all enabled → checked; none enabled → unchecked;
     otherwise `indeterminate = true`, set through a template ref and a `watchEffect`.
   - Activating it calls `setAllEnabled(!allVisibleEnabled, visibleEntries.value)`: some or none
     enabled → enable all visible; all enabled → disable all visible.
   - **Keep the current filter-scoped rule**: bulk actions only affect visible rows. Its accessible name
     must say how many rows it affects, e.g. "Select all 54" / "Deselect all 54" with no filter, and
     "Select these 7" / "Deselect these 7" while a filter or search is active. Reuse the existing
     `selectAll*` / `deselectAll*` keys where possible.
2. **Search**: move the existing `TextField#vocabulary-search` into the toolbar, unchanged. Highlight
   the matched part of the text with `<mark>`. Style `mark` with `--color-accent-soft` and ink text.
   Build the highlighted text from plain-text segments, never with `v-html`.
3. **Filter chips**: All / Selected / Not selected, built as a `.segmented` radio group, not as
   toggle buttons.
   - Store the value next to `query` in the `practiceVocabulary` store as a transient field. It is
     never sent anywhere and is reset in `resetPracticeVocabulary()`.
   - `visibleEntries` applies the search, then the filter, then the sort.
   - `isFiltering()` returns true when a search **or** a non-"All" filter is active.
   - Rows stay visible until the next interaction with the filter or search. With "Selected" active,
     unticking a row must not make it vanish under the pointer. Implementation: freeze the set of
     visible ids when the filter or query changes, not on every toggle. Explain this in a short comment.
4. **Sort control** and **density toggle** (from section 2). On narrow screens these may sit on the
   toolbar's second line.

**Undo for bulk actions**
- Before `setAllEnabled` runs, save a snapshot of `{ id, enabled }` for the affected rows.
- Show a message, for example "38 words deselected · Undo", in the `LiveMessage` / `role="status"`
  area. The Undo button restores the snapshot through one batch mutation (one `generation` bump, one
  debounced save).
- **Timing (WCAG 2.2.1):** do not auto-dismiss after a short timeout. The message stays until the user
  dismisses it, runs another bulk action, or leaves Settings.
- Only one undo level. Single-row toggles do not create undo entries.
- Add a store function such as `restoreEnabled(snapshot)` in `practice-vocabulary.ts`. Keep the
  existing debounce, generation and flush-on-pagehide logic working.

**Keep these behaviours unchanged**
- The warning for "no words selected" (`vocabulary.noneSelected`), the empty state, the loading state,
  the load/save error messages, and the "Saving…" status.
- The "no matches" message. Extend it so it also covers "no words match this filter".

## i18n
Add every new string to **en, de and es** (for example the filter labels, sort labels, density labels,
undo message and undo button, and a toolbar label). Use vue-i18n pluralisation (`a | b`) where a count
appears. Do not hard-code any text.

## Accessibility requirements
- Give the toolbar `role="toolbar"` or a labelled `<div>`, with a sensible tab order: master
  checkbox → search → filter → sort → density.
- The count stays a non-live region (see the existing comment). Only the undo message is announced.
- The whole screen must pass the existing `@axe-core/playwright` check with no new violations.
- Everything must be usable with the keyboard alone. Focus must stay visible on every control.

## Design constraints
- Use **only existing CSS custom properties**. Do not add new colours; if a new token is truly needed,
  build it from existing values and explain why.
- Reuse existing spacing and radius tokens (`--space-*`, `--radius`).
- Match the existing `style.css` conventions: BEM-style `vocabulary__*` class names and a short
  explanatory comment for each block.
- It must work at 320px width with 16px gutters and no horizontal page scroll. Tablet and desktop get
  the same layout, with more room on each line.
- Do not add any dependencies.

## Tests (required)
- **Unit tests** (`apps/web/src/practice-vocabulary.test.ts`, Vitest + Vue Test Utils):
  - Three-state logic (all / none / mixed), including `indeterminate` on the element.
  - Master checkbox scoped to visible rows while searching and while a filter is active.
  - Filter + search combined, and the frozen visible set (unticking under "Selected" keeps the row
    visible until the filter changes).
  - Sort: leading punctuation ignored, case-insensitive, German sort.
  - `;` split into pills, while search still matches the raw text.
  - Undo restores exactly the previous state and triggers one save.
  - Density choice survives a remount, and falls back when `localStorage` throws.
- **E2E tests** (`e2e/practice-vocabulary.spec.ts`, `e2e/exam.spec.ts`):
  - **Important:** these tests count and iterate rows with `page.getByRole('checkbox')`. The master
    checkbox adds one more checkbox. Scope those locators to the list (for example
    `page.locator('.vocabulary__list').getByRole('checkbox')`) or to a small helper.
  - Replace clicks on the `'Select all'` / `'Deselect all'` / `'Deselect these N'` buttons with the
    master checkbox, located by its accessible name.
  - Add one E2E test: deselect all → Undo → the selection is restored after a reload (proves it was
    saved to the server).

## Out of scope
- User-defined groups/sets, smart sets, multi-select mode, shift-click range selection, keyboard
  shortcuts, audio, and the "Practise N words" button. These come later. Where it costs nothing, do not
  block them; e.g. keep space for a trailing slot on each row.
- Any API, database or shared-type change.

## Done when
1. All of the scope above is implemented, and all three locales are complete.
2. These pass, and you report the exact commands and their results (do not claim a check passed unless
   you ran it):
   `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:e2e` · `npm run build`
3. You provide screenshots of the Settings list at 375px and 1280px: Comfortable and Compact, a partial
   selection (indeterminate state), an active search with highlighting, and the undo message visible.
4. `CHANGELOG.md` has an entry under an "Unreleased" section, in the existing style.
5. A short summary lists every deviation from this prompt and why.
