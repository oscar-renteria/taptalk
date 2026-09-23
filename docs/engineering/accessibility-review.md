# Accessibility review (Prompt 031)

- **Date:** 2026-09-23
- **Target:** WCAG 2.2 level AA, on phone (Pixel 7) and tablet (820×1180) viewports
- **Scope:** login, registration (including field errors), practice (question, correct and wrong feedback, summary), progress, settings, administrator import (including preview errors), not-found

## How it was checked

| Check | Method | Where |
| --- | --- | --- |
| Automated rules (WCAG 2.0/2.1/2.2 A and AA, plus best practice) | axe-core via `@axe-core/playwright`, in 12 screen states | `e2e/accessibility.spec.ts` |
| Keyboard-only use | Scripted journey: Tab into login, submit with Enter, pick a direction, practise, Enter to continue, navigate, log out; focus ring visible | same |
| Focus management | Asserted in unit and e2e tests: answer field → next button → summary heading, and page heading after navigation | same, plus `practice-view.test.ts` |
| Text scaling and reflow (1.4.4, 1.4.10) | 320 px viewport with root text at 200 %: no horizontal scrolling on registration, practice, summary, progress and settings | same |
| Touch targets (2.5.8; our goal is 44 px) | Every visible button, link and field measured to be at least 44×44 px | same |
| Non-colour feedback (1.4.1) | Each status tone has its own icon, and the text carries the meaning | same, plus design system |
| Reduced motion (2.3.3) | With `prefers-reduced-motion: reduce`, the spinner and progress transitions stop | same |
| Contrast (1.4.3, 1.4.11) | axe, plus the calculated token table in `design-system.md` | – |
| Semantics, labels, language | Code review of every view, plus axe | – |

## Findings and fixes

| # | Severity | Finding | WCAG | Fix |
| --- | --- | --- | --- | --- |
| 1 | Serious | The session progress bar had no accessible name (found by axe) | 4.1.2 | `ProgressIndicator` takes a `name` ("Session progress") |
| 2 | Serious | Pages scrolled sideways at 200 % text on a 320 px screen, on registration (+260 px), practice and the summary. Three causes: (a) the shell sized its column to its content, (b) text inputs keep a ~20-character minimum width, (c) the `auto-fit` stat grid with `max-width` produced 4 columns | 1.4.10, 1.4.4 | Bounded shell column; fields use `width: 100%; min-width: 0`; stat grid without `max-width`; headings, intro text, usernames and tile labels may wrap within words |
| 3 | Serious | Polite messages ("Correct", "Settings saved", "Import committed") were inserted together with their live region, which some screen readers do not announce | 4.1.3 | New `LiveMessage` keeps an empty polite live region in place and only changes its content. Errors are still inserted as `role="alert"` |
| 4 | Moderate | German prompts and answer fields were marked as English, so screen readers would pronounce German words wrongly | 3.1.2 | The prompt and the answer field get `lang="de"` or `lang="en"` depending on the direction |
| 5 | Moderate | Focus moved to the answer field, but its description did not include the question, so a screen reader announced only "Your answer" | 1.3.1, 2.4.6 | The field is `aria-describedby` the prompt (and phonetics) |
| 6 | Moderate | Navigating between pages kept focus on the clicked link, with no signal that the content had changed | 2.4.3 | After in-app navigation, focus moves to the new page's `h1` (`tabindex="-1"`, no focus ring on the heading) |

Fixed earlier in Prompts 015 and 017 and re-verified here: correct answers shown in error red, focus ring contrast 2.1:1, text buttons under 44 px, stat tiles read as "42points", field errors not linked to their inputs.

No critical defects remain open. axe reports no violations in any of the audited states on either viewport.

## Known limitations

- **No screen reader testing.** No real screen reader (NVDA, JAWS, VoiceOver, TalkBack) has been used. The checks above verify semantics and structure, but not real announcements. Recommended before release: a short NVDA + Firefox and VoiceOver + iOS Safari pass through login, one practice session and settings.
- **Mixed-language feedback.** In "Not quite. The answer is hallo.", the German answer is not marked `lang="de"` within the English sentence.
- **Browser coverage.** Checks run in Chromium only. Safari/WebKit text zoom and focus behaviour are unverified.
- **Automated tools are not a full audit.** Automated checks find roughly a third of WCAG issues. Cognitive load and plain language for young children still need review with real learners.
- **Out of scope.** Native OS text-size settings (as opposed to browser text size) and Windows high-contrast mode were not tested.
