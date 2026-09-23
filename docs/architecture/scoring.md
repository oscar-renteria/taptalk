# Scoring policy (v1)

- **Status:** Proposed for OPEN DECISION 006. Implemented in `apps/api/src/learning.ts` (`calculateScore`).
- **Requirements:** PR-017, PR-018

## Formula

```
incorrect, empty or invalid answer → 0 points
correct answer                     → max(1, 10 − 2 × priorErrors)
```

`priorErrors` is the number of earlier **incorrect** attempts at the **same vocabulary entry** in the **same practice session**.

| Earlier errors on this word in the session | Points for a correct answer |
| --- | --- |
| 0 | 10 |
| 1 | 8 |
| 2 | 6 |
| 3 | 4 |
| 4 | 2 |
| 5 or more | 1 |

## Rules

- **No negative points.** A wrong answer earns 0, and totals never go down. This keeps motivation up for young learners.
- **A correct answer always earns at least 1 point**, even after many errors.
- **Repeated attempts** at the same word in one session each earn points on their own, using the formula above. The penalty keeps counting all earlier errors in the session, so recovering after two mistakes still earns 6. A new session starts from zero errors.
- **Attempts outside a session** (no `practiceSessionId`) score as if there were no earlier errors. Points are private, because public leaderboards are out of scope, so repeated answers outside a session do not disadvantage anyone. If points ever become comparable between users, require a session for every scored attempt (OPEN DECISION 007).
- **Integers only.** No rounding is needed. Out-of-range inputs (negative, fractional or non-finite error counts) are sanitized.
- **Server-side only.** The server computes `priorErrors` from recorded attempts. Any `scoreDelta`, `correct` or similar field sent by the client is ignored, which a test covers.

## Where scores appear

- Each attempt stores `score_delta`.
- The dashboard total is the sum over all of a user's attempts.
- The session summary total is the sum over that session's attempts.
