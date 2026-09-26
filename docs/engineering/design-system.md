# TapTalk design system

The design system is deliberately small: CSS custom properties (tokens) plus component classes in `apps/web/src/style.css`, and Vue components in `apps/web/src/components/`, exported from `components/index.ts`. Layouts are designed mobile first; tablet adjustments start at `48rem`.

## Tokens

| Group       | Tokens                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour      | `--color-ink`, `--color-muted`, `--color-body`, `--color-paper`, `--color-surface`, `--color-card`, `--color-line`, `--color-line-soft`, `--color-segment`, `--color-border`, `--color-control-border`, `--color-accent`, `--color-accent-soft`, `--color-accent-strong`, `--color-on-accent`, `--color-focus`, plus `--color-{success,warning,danger}` with a matching `-bg` |
| Type        | `--font-display` (Newsreader) for headings and prompts; `--font-ui` (Instrument Sans) for controls and labels; both bundled from `@fontsource-variable` and served from the app's origin (CSP `font-src 'self'`); sizes `--text-sm`, `--text-md`, `--text-lg`, `--text-prompt`, `--text-title` (fluid `clamp`)                                                                |
| Space       | `--space-1` (0.25rem) to `--space-8` (2rem)                                                                                                                                                                                                                                                                                                                                   |
| Interaction | `--touch-target: 2.75rem` (44px), `--focus-ring: 3px solid var(--color-focus)`, `--radius` (0.75rem), `--radius-lg` (1.25rem, cards)                                                                                                                                                                                                                                          |
| Layout      | `--content-width: 44rem`, `--form-width: 24rem`                                                                                                                                                                                                                                                                                                                               |
| Motion      | `--motion-fast: 120ms`, `--motion-base: 200ms`, `--ease-out`                                                                                                                                                                                                                                                                                                                  |
| Elevation   | `--shadow-panel` (hard offset, signed-out panel), `--shadow-raised` (hover lift, menus), `--shadow-card` (practice and summary cards)                                                                                                                                                                                                                                         |
| Feedback    | `--hover-lift: -1px`, `--active-drop: 1px`                                                                                                                                                                                                                                                                                                                                    |

## Interaction states

Every interactive control defines all of its states. Hover is the only
pointer-specific one, and it is declared inside `@media (hover: hover) and
(pointer: fine)` so a touch device never keeps a hovered style after a tap.
Press feedback is declared for every pointer type, because it is the only
tactile cue a touch user gets. State changes never rely on one channel
alone: a colour change is paired with a border, shadow, or underline change.

| State    | Treatment                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default  | Token colours and 44px minimum target                                                                                                                    |
| Hover    | Pointer-only. Primary darkens, secondary gains `--shadow-raised` and a stronger border, text buttons thicken the underline, inactive tabs gain a surface |
| Focus    | `:focus-visible` with `--focus-ring` and a 2px offset, unchanged by hover                                                                                |
| Active   | `translateY(var(--active-drop))` on buttons and inactive tabs                                                                                            |
| Disabled | `cursor: not-allowed`, 60% opacity, and a distinct background on inputs and selects                                                                      |
| Loading  | `aria-busy` with an inline spinner, dimensions preserved                                                                                                 |

## Components

| Component           | Purpose                           | Key props                                                                                                                                                               | Accessibility                                                                                                                            |
| ------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AppButton`         | All buttons                       | `variant` (`primary`, `secondary`, `text`, `dark`), class `btn--large` for the dashboard start action, `type`, `loading`, `loadingLabel`, `disabled`; exposes `focus()` | Disabled and `aria-busy` while loading, so double submission is impossible; 44px minimum size, including text buttons                    |
| `TextField`         | Labelled input                    | `id`, `label`, `type`, `hint`, `error`, `describedby` (extra ids), `v-model`; other attributes pass through to the `<input>`; `#after` slot; exposes `focus()`          | `<label for>`, `aria-describedby` for hint and error, `aria-invalid`; errors are prefixed with "!"                                       |
| `SelectField`       | Labelled select                   | `id`, `label`, `options`, `v-model`                                                                                                                                     | Native `<select>`                                                                                                                        |
| `AppCard`           | Bordered surface                  | `as` (element, for example `form`)                                                                                                                                      | Semantic element of your choice                                                                                                          |
| `StatusMessage`     | Feedback                          | `tone` (`info`, `success`, `warning`, `error`), `message` or slot                                                                                                       | `role="alert"` for errors, `role="status"` otherwise; tone is shown by an icon (✓ → ✕ i), a border and the text, never by colour alone   |
| `ProgressIndicator` | Session progress                  | `value`, `max`, `label`, `name` (accessible name)                                                                                                                       | `role="progressbar"` with `aria-valuenow`, `aria-valuemax` and `aria-valuetext`                                                          |
| `LiveMessage`       | Messages that should be announced | `tone`, `message`                                                                                                                                                       | Always renders an empty `role="status"` region, so screen readers announce content changes; errors render as `role="alert"`              |
| `LoadingState`      | Loading placeholder               | `label`                                                                                                                                                                 | `role="status"`; the spinner is decorative and stops with reduced motion                                                                 |
| `ErrorState`        | Failure with retry                | `message`, `retryLabel`, emits `retry`                                                                                                                                  | Alert plus a focusable retry button                                                                                                      |
| `StatTile`          | Metric                            | `value`, `label`                                                                                                                                                        | Readable as "42 points"                                                                                                                  |
| `AppNav`            | Primary navigation                | `items` (`id`, `label`, `current`), `label`, emits `navigate`                                                                                                           | `<nav aria-label>` list; the current item has `aria-current="page"`. Underline tabs in the header; a fixed bottom bar below 48rem        |
| `AccountMenu`       | Account chip and sign-out         | `username`, emits `logout`                                                                                                                                              | Disclosure button with `aria-expanded`/`aria-controls`; opening focuses "Log out", Escape closes and returns focus, outside click closes |
| Segmented control   | Dashboard direction               | Markup pattern (`.segmented`): a `<fieldset>` with `<legend>` and native radios                                                                                         | Radio semantics and arrow keys are native; each input covers its segment invisibly, the focus ring is drawn on the segment               |

Feedback tones:

- `success`: a correct answer, a saved setting or a committed import
- `warning`: a wrong answer (neutral, not alarming, for young learners), or offline
- `error`: failures the user cannot fix by trying the exercise again

## Contrast (WCAG 2.2 AA)

| Pair                                                              | Ratio             | Requirement    |
| ----------------------------------------------------------------- | ----------------- | -------------- |
| Ink on paper / surface                                            | 12.2 / 13.5 : 1   | 4.5 : 1 text   |
| Muted on surface / paper                                          | 5.2 / 4.7 : 1     | 4.5 : 1 text   |
| Accent (eyebrow) on surface; on-accent on accent (primary button) | 4.6 : 1           | 4.5 : 1 text   |
| Success, warning, danger text on their backgrounds                | 6.7, 7.5, 7.2 : 1 | 4.5 : 1 text   |
| Control border on surface                                         | 3.1 : 1           | 3 : 1 non-text |
| Focus ring (`#9a5b12`) on paper                                   | 4.8 : 1           | 3 : 1 non-text |

The earlier focus colour `#df9b43` had only 2.1 : 1 and was replaced.

## Other rules

- Keyboard focus is always visible: `:focus-visible` uses `--focus-ring` with a 2px offset.
- Inputs use at least a 16px font size, which prevents iOS zoom on focus.
- `prefers-reduced-motion: reduce` removes spinner and progress animations.
- Long words and prompts wrap (`overflow-wrap: anywhere`) instead of overflowing on narrow screens.
- The shell applies `env(safe-area-inset-*)` on all four sides, so the header clears a notch and the content clears the home indicator. `max()` preserves the previous padding where the insets are zero.
- Empty states use `.empty-state` (dashed surface) and answer what is empty, why, and the next action; `.chip-list`/`.chip` present scannable words.

## Tests

`apps/web/src/components/components.test.ts` covers variants, loading, disabled, focus, v-model, hint and error wiring, roles per tone, progress clamping, retry events and navigation state.
