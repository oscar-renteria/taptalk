# Answer matching policy (v1)

- **Status:** Proposed for OPEN DECISION 005. Implemented in `apps/api/src/matching.ts`; the product owner should confirm the German-specific choices below.
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
- `ß` and umlauts. `Strasse` does not match `Straße`, and `ae` does not match `ä`. If an alternative spelling should count, add it as an explicit alternative.
- word boundaries. `gutenTag` does not match `guten Tag`.

## Results

| Reason | Correct | When |
| --- | --- | --- |
| `exact-match` | yes | The trimmed submission equals an accepted form exactly (after NFC) |
| `normalized-match` | yes | Equal only after normalization, for example a case or punctuation difference |
| `empty-answer` | no | Nothing is left after normalization, for example `""`, `...` or `?!` |
| `invalid-answer` | no | Longer than 200 characters, or contains control characters |
| `incorrect` | no | Anything else |

Every attempt stores the original submission unchanged, the normalized value and the reason (PR-018). Stored answers (`vocabulary_answers.normalized_answer`) use the same normalization function, so the stored values and the matcher cannot drift apart.

## Open points for the product owner

- Should capitalization of German nouns (`haus` vs `Haus`) count as correct but show a hint? Currently it counts as correct without a hint.
- Should common umlaut transliterations (`ae`, `oe`, `ue`, `ss`) be accepted for learners without a German keyboard? Currently they are not.
