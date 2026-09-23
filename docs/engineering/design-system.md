# TapTalk design system

The design system is deliberately small: CSS custom properties (tokens) plus component classes in `apps/web/src/style.css`, and Vue components in `apps/web/src/components/`, exported from `components/index.ts`. Layouts are designed mobile first; tablet adjustments start at `48rem`.

## Tokens

| Group | Tokens |
| --- | --- |
| Colour | `--color-ink`, `--color-muted`, `--color-paper`, `--color-surface`, `--color-border`, `--color-control-border`, `--color-accent`, `--color-on-accent`, `--color-focus`, plus `--color-{success,warning,danger}` with a matching `-bg` |
| Type | `--font-display` (Georgia) for headings and prompts; `--font-ui` (system sans) for controls and labels; sizes `--text-sm`, `--text-md`, `--text-lg`, `--text-prompt`, `--text-title` (fluid `clamp`) |
| Space | `--space-1` (0.25rem) to `--space-8` (2rem) |
| Interaction | `--touch-target: 2.75rem` (44px), `--focus-ring: 3px solid var(--color-focus)`, `--radius` |
| Layout | `--content-width: 44rem`, `--form-width: 24rem` |

## Components

| Component | Purpose | Key props | Accessibility |
| --- | --- | --- | --- |
| `AppButton` | All buttons | `variant` (`primary`, `secondary`, `text`), `type`, `loading`, `loadingLabel`, `disabled`; exposes `focus()` | Disabled and `aria-busy` while loading, so double submission is impossible; 44px minimum size, including text buttons |
| `TextField` | Labelled input | `id`, `label`, `type`, `hint`, `error`, `describedby` (extra ids), `v-model`; other attributes pass through to the `<input>`; `#after` slot; exposes `focus()` | `<label for>`, `aria-describedby` for hint and error, `aria-invalid`; errors are prefixed with "!" |
| `SelectField` | Labelled select | `id`, `label`, `options`, `v-model` | Native `<select>` |
| `AppCard` | Bordered surface | `as` (element, for example `form`) | Semantic element of your choice |
| `StatusMessage` | Feedback | `tone` (`info`, `success`, `warning`, `error`), `message` or slot | `role="alert"` for errors, `role="status"` otherwise; tone is shown by an icon (✓ → ✕ i), a border and the text, never by colour alone |
| `ProgressIndicator` | Session progress | `value`, `max`, `label`, `name` (accessible name) | `role="progressbar"` with `aria-valuenow`, `aria-valuemax` and `aria-valuetext` |
| `LiveMessage` | Messages that should be announced | `tone`, `message` | Always renders an empty `role="status"` region, so screen readers announce content changes; errors render as `role="alert"` |
| `LoadingState` | Loading placeholder | `label` | `role="status"`; the spinner is decorative and stops with reduced motion |
| `ErrorState` | Failure with retry | `message`, `retryLabel`, emits `retry` | Alert plus a focusable retry button |
| `StatTile` | Metric | `value`, `label` | Readable as "42 points" |
| `AppNav` | Primary navigation | `items` (`id`, `label`, `current`), `label`, emits `navigate` | `<nav aria-label>` list; the current item has `aria-current="page"` |

Feedback tones:

- `success`: a correct answer, a saved setting or a committed import
- `warning`: a wrong answer (neutral, not alarming, for young learners), or offline
- `error`: failures the user cannot fix by trying the exercise again

## Contrast (WCAG 2.2 AA)

| Pair | Ratio | Requirement |
| --- | --- | --- |
| Ink on paper / surface | 12.2 / 13.5 : 1 | 4.5 : 1 text |
| Muted on surface / paper | 5.2 / 4.7 : 1 | 4.5 : 1 text |
| Accent (eyebrow) on surface; on-accent on accent (primary button) | 4.6 : 1 | 4.5 : 1 text |
| Success, warning, danger text on their backgrounds | 6.7, 7.5, 7.2 : 1 | 4.5 : 1 text |
| Control border on surface | 3.1 : 1 | 3 : 1 non-text |
| Focus ring (`#9a5b12`) on paper | 4.8 : 1 | 3 : 1 non-text |

The earlier focus colour `#df9b43` had only 2.1 : 1 and was replaced.

## Other rules

- Keyboard focus is always visible: `:focus-visible` uses `--focus-ring` with a 2px offset.
- Inputs use at least a 16px font size, which prevents iOS zoom on focus.
- `prefers-reduced-motion: reduce` removes spinner and progress animations.
- Long words and prompts wrap (`overflow-wrap: anywhere`) instead of overflowing on narrow screens.

## Tests

`apps/web/src/components/components.test.ts` covers variants, loading, disabled, focus, v-model, hint and error wiring, roles per tone, progress clamping, retry events and navigation state.
