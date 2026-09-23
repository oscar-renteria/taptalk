# Answer matching policy (v1)

- **Status:** Accepted (resolves OPEN DECISION 005; product decision 2026-09-23). Implemented in `apps/api/src/matching.ts`.
- **Requirements:** PR-007, PR-015, PR-016, PR-018

Matching is deterministic, runs only on the server, and has no framework or database dependencies. Approximate matching (typo tolerance, similarity scores, semantic matching) is **not** used.

## Accepted answers

- An English-to-German question accepts every German alternative. Alternatives are separated by `;` in the import file, for example `hallo; guten Tag`.
- A German-to-English question accepts the English text of the entry.
- Text in parentheses is optional. `(sich) freuen` accepts both `sich freuen` and `freuen`. At most 3 groups are expanded per answer.
- Alternatives that are identical after normalization (for example `Hallo; hallo!`) are merged at import time, and the preview shows a warning.
- A German value with no answerable content (for example only `...`) is rejected at import time.

## Normalization

Both the submission and each accepted answer are normalized the same way before they are compared:

| Step | Effect | Example |
| --- | --- | --- |
| Unicode NFKC | Compatibility characters fold to their plain form | `ﬁnden` → `finden` |
| Ellipses removed | `...` and `…` are placeholders, not answer text | `etwas geben ...` → `etwas geben` |
| Apostrophes unified | Typographic apostrophes become `'` | `geht’s` → `geht's` |
| Punctuation removed | `. , ! ? ; : ¡ ¿` and quotation marks | `Ja, bitte.` → `ja bitte` |
| Whitespace collapsed | Runs of whitespace become one space, then trimmed | `  guten   Tag ` → `guten tag` |
| Lower case (German locale) | Capitalization is ignored | `HALLO` → `hallo` |

The following are deliberately **not** normalized, because they change the answer:

- hyphens (`E-Mail`) and apostrophes (`geht's`)
- word boundaries. `gutenTag` does not match `guten Tag`.

## German spelling variants

Learners without a German keyboard may type the standard transliterations. They are accepted in both directions:

| Letter | Transliteration | Example |
| --- | --- | --- |
| ä / ö / ü | ae / oe / ue | `Maedchen` matches `Mädchen`, `schoen` matches `schön` |
| ß | ss | `Strasse` matches `Straße` |

These matches are classified as `spelling-variant-match`, so they stay distinguishable from exact answers. Other spelling differences are still incorrect: `Strase` and `Madchen` do not match. Transliteration applies only when answers are compared. Stored answers and the import's duplicate check keep the original spelling.

## Results

| Reason | Correct | When |
| --- | --- | --- |
| `exact-match` | yes | The trimmed submission equals an accepted form exactly (after NFC) |
| `normalized-match` | yes | Equal only after normalization, for example a case or punctuation difference |
| `spelling-variant-match` | yes | Equal only after ä/ö/ü/ß transliteration |
| `empty-answer` | no | Nothing is left after normalization, for example `""`, `...` or `?!` |
| `invalid-answer` | no | Longer than 200 characters, or contains control characters |
| `incorrect` | no | Anything else |

Every attempt stores the original submission unchanged, the normalized value and the reason (PR-018). Stored answers (`vocabulary_answers.normalized_answer`) use the same normalization function, so the stored values and the matcher cannot drift apart.

## Decisions

- Capitalization of German nouns (`haus` vs `Haus`) counts as correct without a hint.
- Umlaut and ß transliterations count as correct (`spelling-variant-match`). A later UI change could show the standard spelling as a hint.
