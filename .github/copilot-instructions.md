# TapTalk Engineering Instructions

## Working method

- Inspect the existing repository, owning module, and nearby tests before changing code.
- Keep each change focused on one coherent outcome and preserve unrelated work.
- Prefer existing conventions and small, reversible changes over speculative abstractions.
- Run the narrowest relevant check after an edit, then run the applicable project gate before reporting completion.
- Never claim a test, build, lint check, or type check passed unless it was actually run.
- Document meaningful decisions, changed behavior, validation commands, and unresolved issues.

## TypeScript and module boundaries

- Use TypeScript strict mode and avoid `any`; model unknown data at trust boundaries.
- Keep UI, API, domain, persistence, and shared-contract responsibilities separate.
- Domain code must not depend on Vue components, HTTP concerns, or SQLite details.
- Shared packages contain contracts and pure utilities, not application-specific side effects.
- Use descriptive names and consistent casing: PascalCase for types/components, camelCase for values and functions, and kebab-case for file names unless a framework convention requires otherwise.

## Validation and error handling

- Validate external input at the API, file-import, persistence, and client form boundaries.
- Return stable, user-safe error shapes; do not expose stack traces, SQL, password hashes, or secrets.
- Handle expected failures explicitly and log only the minimum diagnostic context needed.
- Keep server-side validation authoritative even when client-side validation exists.

## Testing

- Add focused unit tests for pure logic and integration tests for module boundaries.
- Isolate test data and avoid production resources or real credentials.
- Cover success, invalid input, authorization, failure, and boundary cases appropriate to the change.
- Use deterministic fixtures and stable selectors for browser tests.

## Frontend and accessibility

- Build responsive layouts mobile-first, with comfortable tablet behavior.
- Use semantic HTML, labels, visible keyboard focus, accessible error announcements, and feedback that is not color-only.
- Preserve usable touch targets, readable text, and deliberate loading, empty, and error states.

## Security and data

- Never commit secrets, real credentials, production data, or sensitive test fixtures.
- Hash credentials with an approved password-hashing strategy and protect authenticated routes server-side.
- Use reproducible, reviewed database migrations; do not silently mutate schema at runtime.
- Keep user data isolated and minimize sensitive data retention.

## Documentation

- Update the relevant guide, decision record, or changelog when behavior or operating procedure changes.
- Record unresolved requirements as explicit open decisions rather than inventing product behavior.