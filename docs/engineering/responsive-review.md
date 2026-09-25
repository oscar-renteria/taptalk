# Responsive design review (Prompt 033)

- **Date:** 2026-09-24
- **Targets:** Emulated Pixel 7 (412×915), forced narrow phone (320×640), reduced-height phone (320×360), phone landscape (915×412), tablet portrait (820×1180), and tablet landscape (1180×820)
- **Scope:** login and registration errors, practice start/question/long prompt, progress, settings confirmation, and administrator vocabulary import/history

## How it was checked

| Check                           | Method                                                                                                                       | Where                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Core screen review              | CSS and Vue review of every routed view and shared component; existing journeys rerun at phone and tablet sizes              | `apps/web/src/`, existing `e2e/*.spec.ts`   |
| Unintended horizontal scrolling | Compare the widest document content with the viewport in account errors, practice, progress, settings, and import states     | `e2e/responsive.spec.ts`                    |
| Long content                    | Inject a 180-character unbroken error, a long vocabulary prompt, and a valid 195-character import file name                  | same                                        |
| Input visibility                | Reduce the viewport to 320×360, blur/refocus the answer input, and require its full box to remain inside the visual viewport | same                                        |
| Orientation changes             | Resize an active question from portrait to phone/tablet landscape and recheck reflow, focus, and touch targets               | same                                        |
| Touch and button sizing         | Measure every visible link, button, input, and select against the 44×44 CSS-pixel target                                     | same, plus `accessibility.spec.ts`          |
| Navigation                      | Exercise the real router links at both project viewports; wrapped tabs remain individually reachable                         | existing core journeys and responsive suite |
| Dashboard readability           | Require three stat tiles in one row on tablet and a readable two-row layout on Pixel 7                                       | `e2e/responsive.spec.ts`                    |
| Summary and feedback            | Existing completion, wrong-answer, long-content, and overflow journeys run at both configured projects                       | `practice.spec.ts`, `accessibility.spec.ts` |

## Findings and fixes

| Severity | Finding                                                                                                                                                     | Fix                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serious  | A long unbroken server error inside the flex status message could widen the document and force horizontal scrolling.                                        | Give the message span `min-width: 0` and `overflow-wrap: anywhere`.                                                                                              |
| Moderate | A valid import file name could contain an unbroken sequence close to the 200-character API limit; the selected-file text had no explicit wrapping contract. | Apply secondary-text wrapping to `.muted` and locate the selected file by its visible text in the responsive regression test.                                    |
| Moderate | The shell used only `100vh`, which can retain a stale full-height canvas on devices with changing browser chrome or an on-screen keyboard.                  | Keep `100vh` as a compatibility fallback and use `100dvh` where supported; add root scroll padding so focused controls are not placed against the viewport edge. |

Long prompts, stat tiles, form controls, and the session summary were already bounded correctly. The responsive suite confirms those existing rules rather than duplicating them with device-specific CSS.

## Result

`e2e/responsive.spec.ts` passes under both the `mobile` and `tablet` Playwright projects. No unintended horizontal scrolling was found in the reviewed states. The tablet dashboard uses one three-column row, while the Pixel 7 layout uses two readable rows. Practice input remains horizontally contained and can be focused into view after the viewport is reduced or rotated.

## Known limitations

- Playwright emulates layout and touch capability but does not display a real software keyboard. The reduced-height viewport plus blur/refocus is a deterministic proxy, not a substitute for a physical-device check.
- Coverage is Chromium-only. Safari/WebKit and platform-specific visual viewport behaviour remain unverified.
- Automated geometry checks do not replace a short manual pass on one iOS and one Android device before release.
