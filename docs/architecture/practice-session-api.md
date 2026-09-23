# Practice session API

All endpoints require the `taptalk_session` cookie and answer `401 UNAUTHENTICATED` without it. Errors use the shared shape `{ "error": { "code": "...", "message": "..." } }`. A session belongs to one user. Another user's session ID answers `404 SESSION_NOT_FOUND`, so the API does not reveal whether it exists.

## Lifecycle

| Step                      | Request                                                                                                             | Success                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Start                     | `POST /api/v1/practice/sessions` with `{ "direction"?: "english-to-german" \| "german-to-english" \| "random" }`    | `201 { session }`                                               |
| Request a question        | `GET /api/v1/practice/question?direction=...`                                                                       | `200 { question }` (no answer key)                              |
| Answer                    | `POST /api/v1/practice/answer` with `{ vocabularyEntryId, direction, prompt, submittedAnswer, practiceSessionId? }` | `200 { result, session: { id, answeredCount, questionCount } }` |
| End (complete or abandon) | `POST /api/v1/practice/sessions/:sessionId/end`                                                                     | `200 { session: summary }`                                      |
| Results                   | `GET /api/v1/practice/sessions/:sessionId`                                                                          | `200 { session: summary }`                                      |

`session` fields: `id`, `direction`, `questionCount`, `status` (`active`, `completed` or `abandoned`), `startedAt`, `endedAt` and `answeredCount`. A summary adds `correctCount`, `incorrectCount`, `pointsEarned`, `accuracy` (0–1, and 0 when nothing was answered) and `wordsToPractice` (the English words answered incorrectly in this session).

## Policies

- `questionCount` is the user's `sessionLength` preference at start time. `direction` defaults to the preferred direction.
- A user has at most one active session. Starting a new one marks the previous active session as `abandoned`.
- Ending a session after all questions were answered sets `completed`. Ending it earlier sets `abandoned`, and its summary still counts the answered questions. Ending an already ended session is idempotent and returns the stored summary.
- `practiceSessionId` is optional, so single answers outside a session still work. With it, the attempt counts towards that session only while the session is `active` and not full.
- Summary values are computed on the server from recorded attempts. The client never supplies scores.

## Errors

| Status | Code                 | When                                                              |
| ------ | -------------------- | ----------------------------------------------------------------- |
| 400    | `INVALID_DIRECTION`  | Unknown direction when starting a session                         |
| 400    | `INVALID_ANSWER`     | Malformed answer body, including a non-string `practiceSessionId` |
| 404    | `NO_VOCABULARY`      | Starting a session or requesting a question with no vocabulary    |
| 404    | `SESSION_NOT_FOUND`  | Unknown session, or a session owned by another user               |
| 404    | `QUESTION_NOT_FOUND` | The answered vocabulary entry no longer exists                    |
| 409    | `SESSION_NOT_ACTIVE` | Answering in an ended or full session                             |
