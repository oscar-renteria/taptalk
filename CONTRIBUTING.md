# Contributing to TapTalk

## Before changing code

1. Read the relevant requirements, architecture notes, and decision records.
2. Inspect the existing implementation and nearby tests before editing.
3. Identify the smallest coherent change and its acceptance check.

## Development standards

TapTalk uses strict TypeScript across the frontend, backend, and shared packages. Keep dependencies flowing from presentation to application/domain services to persistence; domain modules must remain independent of framework and database details. Validate all untrusted input at its boundary and return safe, typed errors.

Frontend changes must remain responsive on small screens and tablets, use semantic accessible controls, preserve visible focus, and provide loading, empty, and error states. Backend changes must enforce authentication and authorization on the server. Database changes require a reproducible migration and appropriate repository tests.

## Verification

Run the narrowest relevant unit or integration test while developing. Before completing a meaningful change, run the applicable project checks for linting, type checking, tests, and build. Report the exact commands and results. Do not claim a check passed unless it was run.

## Pull requests and commits

- Keep commits focused and describe the user or system outcome.
- Explain architecture or product decisions in documentation or an ADR.
- Include changed behavior, verification performed, and known limitations in the pull request description.
- Never include secrets, real credentials, production data, or generated local databases.

## Atomic roadmap workflow

Execute roadmap prompts in order. Complete the acceptance criteria and gate for the current phase before starting the next. If a prompt reveals an architectural conflict, stop, document it, and resolve it before building on top of the conflict.