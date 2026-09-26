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

**A retry is checked but not recorded.** The client sends it with
`retry: true`. The API applies the same matching policy (alternatives,
normalisation, umlaut transliteration) but writes no attempt, so the retry earns
no points, keeps the question slot, and leaves accuracy untouched. Recording it
would have spent one of the session's questions on every retry. Checking it on
the client instead would have meant duplicating the matching policy, and the
client does not receive the alternative answers. A correct retry does not extend
the streak.

After a miss the secondary action is **Skip question** (**Skip to results** on
the last question), so a learner is never stuck in a retry loop. After the last
correct answer the primary action reads **See results**.

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

## Visual design

The screens follow the canvas: a full-width header with the brand, underline
tabs, and an account chip (`AccountMenu`, which holds "Log out"); a two-column
dashboard with the welcome, a segmented direction control, the start action,
and destination cards with icons; and a centred practice card with the prompt,
the question, the answer field, an in-card feedback band, and the actions. The
signed-out screens keep the framed panel.

Newsreader and Instrument Sans are bundled through `@fontsource-variable`
(SIL Open Font License) and served from the app's own origin, so they satisfy
the production CSP `font-src 'self'`. Noto Sans for IPA is not bundled; IPA falls
back to the UI face.

The dashboard direction control offers **Mixed** besides the two directions,
because the API and Settings support a random direction and the redesign should
not remove it.

## Mobile

- While typing, the primary action is sticky at the bottom, above the software
  keyboard, and respects `env(safe-area-inset-bottom)`. After an answer it sits in
  the card, so it never covers "End session".
- On a phone the header scrolls away instead of sticking, because with enlarged
  text it wraps and would cover the exercise. The practice bar puts Exit and the
  points on one row and the progress on the next.
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

| Item                              | Why                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Why?" bottom sheet**           | The explanation and literal-translation text do not exist. `vocabulary_entries` holds only `english`, `phonetics`, `german_display`, and the import format accepts only those three. Building the sheet would mean inventing explanations.                              |
| **"Also accepted" list**          | Alternative answers _do_ exist as real data (`vocabulary_answers`: 80 rows for 54 entries) and matching already uses them, but the answer endpoint does not return them to the client. Exposing them is a small API addition, deliberately not folded into a UI change. |
| **7-day streak**                  | The practice screen has no stored history to compute one. The implemented streak is within the current session, as the designs specify.                                                                                                                                 |
| **Swipe to next**                 | The roadmap defers this until the button flow works. A gesture must never be the only way to progress.                                                                                                                                                                  |
| **Self-hosted Noto Sans for IPA** | Newsreader and Instrument Sans are now bundled. Noto Sans is left out: IPA renders in the UI face, which covers the transcriptions in the dataset, and a third family would add download weight for one line of text.                                                   |

## Answers to the roadmap's open questions

1. **Do alternative answers and "Why?" text already exist?** Alternatives do
   (`vocabulary_answers`); explanations and literal translations do not. See
   above.
2. **Should "Exit" and "End session" both exist?** Both remain, and both end the
   session and show the summary; neither keeps the session for later. **Exit** in
   the header is the only way out when a question fails to load and no card is
   rendered, which is why it was kept. Resuming a session later is not built.
3. **Does "no points on a second try" match how Progress calculates accuracy?**
   Partly. `calculateScore(correct, priorErrorsInSession)` already reduces points
   when an entry was missed earlier in the session. The UI reports the score the
   API returns and does not claim a stricter rule than the backend implements.

## Validation

299 unit and integration tests pass across the workspace (206 API, 78 web,
15 shared), including coverage for the state machine, a submitted retry, the
single primary action, the question number, and the phonetics bug.
`npm run lint`, `npm run typecheck`, and `npm run build:production` pass.

All 75 Playwright tests pass locally (`npm run test:e2e`) on the PWA, mobile
(Pixel 7), and tablet projects, including the axe audits, touch-target, reflow,
and keyboard-only checks. Before that fix, 32 of them failed on the redesign
commits because they still used the old copy; one real defect surfaced once they
ran again (the summary had no `h1`).
