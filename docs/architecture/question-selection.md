# Question selection (v1)

- **Status:** Implemented in `apps/api/src/selection.ts` (pure) and `GET /api/v1/practice/question`.
- **Requirements:** PR-011, PR-012, PR-013, PR-019, PR-020

Selection is a **weighted random draw over simple counts**. It is explainable and deterministic when seeded, and it is **not** machine learning.

## Candidates

A vocabulary entry is a candidate only if it has at least one accepted answer. Entries without answers are never asked. If no candidate exists, the API returns `404 NO_VOCABULARY`.

For each candidate the server reads the user's own history (no other user's data):

- `attempts`: the total number of attempts at the entry
- `recentIncorrect`: the incorrect attempts among the user's **last 5** attempts at the entry. Old mistakes fade once the word is answered correctly again.
- `correctInSession`: the correct answers in the current practice session

## Weights

| Situation | `balanced` | `errors-first` |
| --- | --- | --- |
| Never attempted (new word) | 3 | 1 |
| Attempted | 1 + 2 × recentIncorrect | 1 + 4 × recentIncorrect |
| Already answered correctly in this session | weight × 0.25 | weight × 0.25 |

`recentIncorrect` is capped at 5. The probability of an entry is its weight divided by the sum of all weights. The `repetitionPreference` setting selects the column.

**Example (`balanced`):** a mastered word (weight 1), a struggling word with 2 recent errors (weight 5) and a new word (weight 3) are drawn about 11 %, 56 % and 33 % of the time.

## Other rules

- **No immediate repeat:** within a session, the entry attempted last is excluded whenever another candidate exists.
- **Direction:** a session fixes its direction when it starts. `random` is resolved independently for **each** question (50/50). Without a session, the `direction` query parameter applies, falling back to the saved preference.
- **Explanation:** every question carries a `selectionReason`: `new-word` (never attempted), `needs-practice` (recent errors) or `review`.
- **Testing:** randomness is injected (`buildServer(db, { random })`). Tests use a seeded generator (mulberry32) for deterministic statistical checks.

## Vocabulary filters

`selectQuestion` accepts an optional `filter` predicate. No user-facing filter exists yet, because vocabulary entries have no grouping attribute (list, topic or tag) to filter by. Deferred (product decision 2026-09-23): define vocabulary grouping as part of the import policy (OPEN DECISION 004), then expose it as a practice setting.
