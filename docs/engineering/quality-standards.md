# Quality Standards

These standards apply to the Vue frontend, Node.js API, shared TypeScript packages, and SQLite persistence.

## TypeScript

- Enable strict compiler settings and keep checked code free of implicit `any`.
- Prefer discriminated unions and validated schemas for external data.
- Keep public functions and module boundaries explicitly typed.

## Design and module boundaries

- Keep presentation, transport, application/domain, persistence, and shared contracts distinct.
- Keep domain logic deterministic and testable without a browser, HTTP server, or database.
- Prefer the repository's established patterns and the smallest change that meets the requirement.

## Errors and validation

- Validate data at every trust boundary: forms, HTTP requests, imported files, environment variables, and database results.
- Use stable error categories and safe messages for users.
- Do not expose secrets, credentials, SQL, stack traces, or unrelated user data in responses or logs.

## Testing

- Unit-test pure domain and shared validation logic.
- Integration-test API, repository, migration, transaction, authorization, and user-isolation behavior.
- Browser-test critical user journeys with stable selectors at mobile and tablet sizes.
- Cover successful behavior, invalid input, empty states, authorization failures, and relevant boundary cases.
- Keep tests deterministic, isolated, and suitable for CI.

## Accessibility and responsive design

- Use semantic HTML, labels, keyboard navigation, visible focus, logical focus management, and accessible announcements.
- Do not communicate important state through color alone.
- Support readable text, touch-friendly controls, reduced motion where relevant, and narrow mobile layouts without unintended horizontal scrolling.

## Security

- Hash credentials; never store or log plaintext passwords or PINs.
- Enforce authentication and authorization on the server.
- Protect sessions, uploads, JSON parsing, rate-sensitive endpoints, and security headers according to the approved ADRs.
- Keep secrets in environment or deployment secret management, never in source control.

## Database and migrations

- Use reviewed, reproducible, idempotent migration steps.
- Define keys, constraints, indexes, timestamps, and deletion behavior deliberately.
- Keep SQL details behind persistence modules and test migrations from an empty database.
- Use transactions for operations that must be atomic.

## Documentation and reporting

- Record unresolved requirements as `OPEN DECISION` items.
- Update relevant documentation after meaningful changes.
- Completion reports must list changed files, commands run, results, and unresolved issues.
- Agents must inspect existing code before changing it and must not claim checks passed unless they actually ran them.