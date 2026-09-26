# Practice screen redesign

This records the decisions behind the practice screen redesign described in
`.roadmap/redesign.md`: what was built, what was deliberately left out, and why.

The design canvas referenced by the roadmap is private, so the token values and
interaction spec in the roadmap text are the source of truth here.

## Interaction model

One exercise owns the screen. The loop is:

> prompt → type → Return/Done → immediate feedback → next

| State     | Card                                            | Primary action                          |
| --------- | ----------------------------------------------- | --------------------------------------- |
| Answering | Input editable and focused on entry             | **Check answer** (disabled while empty) |
| Correct   | Success border and band, input locked           | **Next question →**                     |
| Miss      | Miss band with _Your answer_ against _Expected_ | **Try again**                           |
| Retry     | Input cleared, expected answer hidden           | **Check answer**                        |

State lives on the element as `data-state`, so it is assertable in tests and
never depends on colour alone.

Enter/Return and the sticky button call the same handler, so the loop never
needs the mouse and there is never more than one primary control.

**Try again clears the input and hides the expected answer.** Without that, a
second attempt would let the learner copy the answer still on screen, which
tests nothing.

## Focused mode

While a session runs, `focus.practice` is true and the shell:

- drops the site tabs, because navigation competes with the exercise;
- removes the hero, because it costs vertical space the card needs;
- keeps **signing out** reachable. Hiding it was a regression caught by an
  existing test: a learner on a shared device, or with a session gone wrong, must
  still be able to sign out;
- keeps a visually hidden `h1`, so the section keeps an accessible name when the
  visible hero is gone.

Direction is chosen on the dashboard rather than in practice, which keeps the
practice screen to a single job.

## Mobile

- The primary action is sticky at the bottom, above the software keyboard, and
  respects `env(safe-area-inset-bottom)`.
- The answer input is larger than the default control and sets
  `enterkeyhint="done"`.
- The tabs become a bottom bar within thumb reach. They remain a semantic
  `<ul>`, so focus order and screen-reader output are unchanged, and they are
  hidden entirely during a session.
- The speak control has a 48px target, above the 44px minimum.

## Data bug found and fixed

Phonetics are stored per entry and describe the **English** side. The dataset
contains `{"english": "We're from", "phonetics": "[wɪə frəm]", "german": "Wir sind aus"}`.
The old screen rendered them under a German prompt, so German phrases were
labelled with English IPA. They are now shown only when the prompt is the
English one.

The durable fix is to store the transcription per language, which needs a schema
migration. That is a data-model change rather than a GUI change, so it is
recorded here instead of being done silently.

## Deliberately not built

| Item                                                   | Why                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Why?" bottom sheet**                                | The explanation and literal-translation text do not exist. `vocabulary_entries` holds only `english`, `phonetics`, `german_display`, and the import format accepts only those three. Building the sheet would mean inventing explanations.                              |
| **"Also accepted" list**                               | Alternative answers _do_ exist as real data (`vocabulary_answers`: 80 rows for 54 entries) and matching already uses them, but the answer endpoint does not return them to the client. Exposing them is a small API addition, deliberately not folded into a UI change. |
| **7-day streak**                                       | The practice screen has no stored history to compute one. The implemented streak is within the current session, as the designs specify.                                                                                                                                 |
| **Swipe to next**                                      | The roadmap defers this until the button flow works. A gesture must never be the only way to progress.                                                                                                                                                                  |
| **Self-hosted Newsreader, Instrument Sans, Noto Sans** | The families are requested first in the font stacks but render the fallback until vendored. They cannot come from a font CDN because the production CSP is `font-src 'self'; style-src 'self'`. Vendoring means committing the woff2 files.                             |

## Answers to the roadmap's open questions

1. **Do alternative answers and "Why?" text already exist?** Alternatives do
   (`vocabulary_answers`); explanations and literal translations do not. See
   above.
2. **Should "Exit" and "End session" both exist?** No. The roadmap notes that if
   Exit does not keep the session, it duplicates End session. The implementation
   offers one escape, **End session**, which always shows the summary first.
3. **Does "no points on a second try" match how Progress calculates accuracy?**
   Partly. `calculateScore(correct, priorErrorsInSession)` already reduces points
   when an entry was missed earlier in the session. The UI reports the score the
   API returns and does not claim a stricter rule than the backend implements.

## Validation

296 tests pass across the workspace, including new coverage for the state
machine, the retry behaviour, and the phonetics bug. `npm run lint`,
`npm run typecheck`, and `npm run build:production` all pass.

Browser-level checks (Playwright, axe) run in CI. The four practice states, the
mobile layout, and the bottom navigation have not been verified in a real browser
as part of this change.
