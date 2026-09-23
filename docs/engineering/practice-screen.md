# Practice screen

`apps/web/src/views/PracticeView.vue`, backed by the practice session API (`docs/architecture/practice-session-api.md`).

## Flow

1. The learner picks a direction, preselected from their saved setting, and selects **Start practice**. This creates a session with the preferred number of questions.
2. Each question shows the prompt, optional phonetics and a progress indicator ("Question 2 of 10" plus a bar with `role="progressbar"`).
3. **Submit answer** (or Enter) checks the answer on the server. The answer field becomes read-only, and the feedback shows the correct answer when the answer was wrong.
4. **Next question** loads the next server-selected question. After the last one it becomes **See results**, which ends the session and shows the summary. **End session** is always available.

## Focus

| Moment | Focus moves to |
| --- | --- |
| A question appears | the answer field |
| Feedback appears | the **Next question** / **See results** button, so Enter continues |
| The summary appears | the summary heading (`tabindex="-1"`), so screen readers announce the result |

## Feedback

The status message carries the meaning in text and icon as well as colour (see the design system):

| Situation | Tone | Example |
| --- | --- | --- |
| Correct | success ✓ | "Correct. +10 points." |
| Wrong | warning → (neutral, not an error) | "Not quite. The answer is hallo." |
| Failure (network, server, no vocabulary) | error ✕, `role="alert"` | "The answer could not be submitted." |

## Robustness

- **No double submission:** while an answer is being checked, the submit button is disabled and `aria-busy` ("Checking..."), and repeated submits are ignored. Once an answer is recorded, the field is read-only until the next question.
- **Failed submission:** the answer stays editable, so the learner can try again.
- **Mobile keyboards:** the input disables autocapitalize and spellcheck and sets `enterkeyhint="done"`. Its font size stays at or above 16px, which prevents iOS zoom.

## Tests

`apps/web/src/practice-view.test.ts` covers the success, wrong-answer, loading, failure and error states, single submission, retry, next question and focus. `apps/web/src/practice-session.test.ts` covers the summary, and `e2e/practice.spec.ts` covers the full journeys, including Enter to submit.
