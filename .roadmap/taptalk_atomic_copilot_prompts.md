# TapTalk --- Atomic Copilot Development Prompts

## How to use

Run these prompts in order from the repository root. Each prompt is
intentionally narrow. The agent must inspect the current repository,
implement only the requested scope, run relevant checks, update
documentation, and report any unresolved issues.

Global rules for every prompt:

-   Do not rewrite unrelated code.
-   Do not introduce dependencies without explaining why.
-   Prefer secure, typed, tested, accessible solutions.
-   Use existing conventions before creating new ones.
-   Do not claim success without running the relevant checks.
-   If requirements conflict or are ambiguous, stop and document the
    decision needed.
-   Update the relevant documentation and changelog after meaningful
    changes.
-   Never commit secrets, real credentials, or production data.

## Current execution status

`DONE` means the prompt's implementation and acceptance checks have been completed and verified. `IN PROGRESS` means code exists but one or more acceptance criteria remain. `NOT STARTED` means the prompt has not been implemented.

### DONE

- Prompt 001: Repository operating rules
- Prompt 002: Product requirements baseline
- Prompt 003: Architecture and ADR process
- Prompt 004: Workspace scaffold
- Prompt 005: Code quality and test tooling
- Prompt 006: Shared validation package
- Prompt 007: Database schema
- Prompt 008: Database migrations and repositories
- Prompt 009: Secure account creation (credential policy ADR-006, rate limiting, transactional registration)
- Prompt 010: Login, logout and session protection (deny-by-default guard, expiry, ADR-005 session strategy)
- Prompt 011: Authorization roles (central guard, set-role CLI, provisioning guide)
- Prompt 012: Vocabulary parser and normalizer
- Prompt 013: Vocabulary import preview
- Prompt 014: Transactional vocabulary import
- Prompt 018: Answer matching rules (policy v1 in docs/architecture/answer-matching.md)
- Prompt 021: Attempt recording
- Prompt 022: Practice session API (lifecycle endpoints, contract in `docs/architecture/practice-session-api.md`)
- Prompt 024: Session completion summary
- Prompt 025: Dashboard APIs and UI
- Prompt 026: User settings
- Prompt 027: Administrator import UI (E2E coverage in `e2e/admin-import.spec.ts`)
- Prompt 029: Backend integration test suite
- Prompt 030: End-to-end browser tests (`npm run test:e2e`, all 9 journeys, mobile and tablet)

### IN PROGRESS

- Prompt 015: Reusable design-system components and component tests remain.
- Prompt 016: Refresh now restores the authenticated session. Real client routing, URL-based views and a not-found page remain.
- Prompt 017: Dedicated registration/login component and integration tests remain.
- Prompt 019: Adaptive weighted question selection remains.
- Prompt 020: Documented scoring formula and boundary tests remain.
- Prompt 023: Session progress, next-question action, deliberate focus and double-submit protection are done. A loading-state UI test remains, and question variety depends on Prompt 019.
- Prompt 028: Browser-level PWA verification remains.

### NOT STARTED

- Prompts 031–038: Accessibility, security and responsive reviews, deployment, operations, smoke testing, and handover

------------------------------------------------------------------------

# Phase 0 --- Governance and discovery

## Prompt 001 --- Establish repository operating rules [DONE]

**Goal:** Create the project-wide engineering rules used by all future
agents.

**Instructions:**

1.  Inspect the repository and identify the current state.
2.  Create or update:
    -   `.github/copilot-instructions.md`
    -   `CONTRIBUTING.md`
    -   `docs/engineering/quality-standards.md`
3.  Define standards for:
    -   TypeScript strictness
    -   naming and module boundaries
    -   error handling
    -   validation
    -   testing
    -   accessibility
    -   responsive design
    -   security
    -   database migrations
    -   documentation
4.  State that agents must inspect existing code before changing it.
5.  State that agents must not claim tests passed unless they actually
    ran them.

**Acceptance criteria:**

-   Shared rules exist and are internally consistent.
-   Rules apply to frontend, backend, shared packages, and database
    work.
-   No implementation code is changed unnecessarily.
-   Documentation is readable and actionable.

------------------------------------------------------------------------

## Prompt 002 --- Create the product requirements baseline [DONE]

**Goal:** Capture the initial functional and non-functional
requirements.

**Instructions:**

Create `docs/requirements/product-requirements.md` covering:

-   user registration and login without email
-   vocabulary import
-   English-to-German, German-to-English, and random practice
-   typed answers
-   answer validation
-   scoring
-   attempt history
-   adaptive statistical repetition
-   dashboard
-   user settings
-   responsive PWA requirements
-   administrative access
-   privacy and security assumptions
-   explicit out-of-scope features

Identify unresolved decisions and mark them as `OPEN DECISION` rather
than inventing requirements.

**Acceptance criteria:**

-   Requirements are uniquely numbered.
-   Each requirement has a clear, testable statement.
-   Ambiguities are listed separately.
-   No requirement contradicts the current project brief.

------------------------------------------------------------------------

## Prompt 003 --- Define architecture and ADR process [DONE]

**Goal:** Establish the technical architecture before feature
implementation.

**Instructions:**

1.  Inspect the repository.
2.  Create `docs/architecture/system-architecture.md`.
3.  Define the proposed modular monolith:
    -   Vue PWA
    -   Node.js API
    -   application/domain services
    -   persistence layer
    -   shared schemas and types
4.  Define module boundaries and dependency direction.
5.  Create `docs/decisions/README.md`.
6.  Add ADRs for:
    -   SQLite deployment model
    -   monorepo structure
    -   API style
    -   validation strategy
    -   authentication/session strategy
7.  Record alternatives and trade-offs.

**Acceptance criteria:**

-   Architecture is documented with a diagram or structured explanation.
-   Modules have clear responsibilities.
-   ADRs explain decisions and rejected alternatives.
-   The architecture does not require microservices for the first
    release.

------------------------------------------------------------------------

# Phase 1 --- Project foundation

## Prompt 004 --- Scaffold the workspace [DONE]

**Goal:** Create a runnable full-stack workspace.

**Instructions:**

1.  Use a maintainable workspace structure with:
    -   `apps/web`
    -   `apps/api`
    -   `packages/shared`
    -   `database`
    -   `docs`
2.  Configure package management and workspace scripts.
3.  Configure TypeScript with strict settings.
4.  Add development scripts for:
    -   install
    -   development
    -   build
    -   lint
    -   typecheck
    -   test
5.  Add environment variable examples without secrets.
6.  Create a minimal health endpoint and a minimal frontend route.

**Acceptance criteria:**

-   Fresh setup instructions work on a clean machine.
-   Frontend and API start successfully.
-   Health endpoint returns a documented response.
-   Build, lint, and typecheck scripts run.
-   No credentials are committed.

------------------------------------------------------------------------

## Prompt 005 --- Configure code quality and test tooling [DONE]

**Goal:** Establish consistent automated checks.

**Instructions:**

Configure:

-   ESLint
-   Prettier
-   TypeScript checks
-   unit test framework
-   coverage reporting
-   pre-commit or equivalent local validation if appropriate
-   CI workflow for lint, typecheck, test, and build

Use the chosen tools consistently across the workspace.

**Acceptance criteria:**

-   A deliberately failing test is detected, then restored.
-   CI runs the same essential checks as local development.
-   Coverage output is available.
-   Configuration is documented.

------------------------------------------------------------------------

## Prompt 006 --- Create the shared validation package [DONE]

**Goal:** Establish shared contracts without duplicating schemas.

**Instructions:**

1.  Create shared schemas and types for:
    -   API error responses
    -   user-safe public data
    -   vocabulary import records
    -   practice direction
    -   attempt result
    -   dashboard summaries
2.  Use runtime validation at trust boundaries.
3.  Export types inferred from schemas where appropriate.
4.  Add unit tests for valid and invalid payloads.

**Acceptance criteria:**

-   Shared contracts are imported by both frontend and backend where
    appropriate.
-   Invalid data is rejected with useful errors.
-   No password or secret field is exposed through public response
    types.

------------------------------------------------------------------------

# Phase 2 --- Database and backend foundation

## Prompt 007 --- Design the database schema [DONE]

**Goal:** Create a normalized schema for the first release.

**Instructions:**

Design and document tables for at least:

-   users
-   vocabulary entries
-   vocabulary translations or accepted answers
-   vocabulary imports
-   user preferences
-   learning attempts
-   optional learning statistics projections
-   sessions or refresh-token records, according to the selected auth
    design

Include:

-   primary keys
-   foreign keys
-   unique constraints
-   indexes
-   timestamps
-   deletion behavior
-   migration strategy

Create `docs/architecture/data-model.md`.

**Acceptance criteria:**

-   Schema supports multiple users.
-   Attempt history is attributable to a user and vocabulary entry.
-   English and German alternatives can be represented.
-   Migrations are reproducible.
-   Sensitive data is not unnecessarily stored.

------------------------------------------------------------------------

## Prompt 008 --- Implement database migrations and repositories [DONE]

**Goal:** Implement persistence without coupling business logic to SQL
details.

**Instructions:**

1.  Add the chosen SQLite access layer.
2.  Implement migrations.
3.  Create repository modules for users, vocabulary, preferences, and
    attempts.
4.  Add transaction support where required.
5.  Add repository tests against a temporary test database.
6.  Document how to reset and migrate development databases.

**Acceptance criteria:**

-   Migrations run from an empty database.
-   Re-running migrations is safe.
-   Repository tests cover successful and invalid operations.
-   Database errors are mapped to safe application errors.

------------------------------------------------------------------------

## Prompt 009 --- Implement secure account creation [DONE]

**Goal:** Add account registration without email.

**Instructions:**

1.  Implement a username or nickname registration flow based on the
    approved product decision.
2.  Hash passwords or PIN-equivalents using an appropriate password
    hashing strategy.
3.  Validate credentials and prevent duplicate usernames.
4.  Return safe responses that never expose password hashes.
5.  Add rate limiting or an equivalent abuse mitigation strategy
    appropriate to the deployment.
6.  Add tests for:
    -   successful registration
    -   duplicate username
    -   invalid credentials
    -   weak credential policy
    -   database failure

**Acceptance criteria:**

-   Plaintext credentials are never stored.
-   Duplicate accounts are handled safely.
-   Validation errors are clear but do not leak sensitive information.
-   Automated tests pass.

------------------------------------------------------------------------

## Prompt 010 --- Implement login, logout, and session protection [DONE]

**Goal:** Provide secure authenticated sessions.

**Instructions:**

1.  Implement login and logout.
2.  Select and document a secure session strategy.
3.  Protect authenticated API routes.
4.  Add session expiration and invalidation behavior.
5.  Avoid storing sensitive authentication data in unsafe browser
    storage.
6.  Add authorization middleware and tests.

**Acceptance criteria:**

-   Unauthenticated users cannot access protected endpoints.
-   Invalid credentials do not reveal whether a username exists.
-   Logout invalidates the session as designed.
-   Authentication tests cover expiration and unauthorized access.

------------------------------------------------------------------------

## Prompt 011 --- Implement authorization roles [DONE]

**Goal:** Separate regular users from vocabulary administrators.

**Instructions:**

1.  Add the minimum role model required by the approved design.
2.  Protect import and management endpoints.
3.  Enforce authorization on the server, not only in the UI.
4.  Add tests proving a regular user cannot access administrator
    operations.
5.  Document the initial administrator provisioning process without
    hardcoding credentials.

**Acceptance criteria:**

-   Role checks are centralized and testable.
-   Protected operations reject unauthorized users.
-   No frontend-only authorization is relied upon.

------------------------------------------------------------------------

# Phase 3 --- Vocabulary ingestion

## Prompt 012 --- Build the vocabulary parser and normalizer [DONE]

**Goal:** Parse the supplied JSON format safely.

**Instructions:**

Support records containing:

-   `english`
-   `phonetics`
-   `german`

Implement:

-   JSON structure validation
-   required and optional field handling
-   semicolon-separated German alternatives
-   whitespace normalization
-   Unicode normalization where appropriate
-   preservation of original display values
-   explicit handling of `...`
-   duplicate detection
-   useful validation errors

Do not blindly remove ellipses from display content. Document the chosen
normalization policy and add tests for placeholder phrases.

**Acceptance criteria:**

-   Valid sample records are accepted.
-   Malformed JSON and malformed records are rejected.
-   Multiple German alternatives are represented structurally.
-   Ellipsis behavior is documented and tested.
-   Parser tests cover edge cases.

------------------------------------------------------------------------

## Prompt 013 --- Implement vocabulary import preview [DONE]

**Goal:** Allow administrators to inspect an import before committing
it.

**Instructions:**

1.  Add an authenticated administrator endpoint for uploading or
    submitting JSON.
2.  Parse and validate the content.
3.  Produce a preview containing:
    -   valid records
    -   invalid records
    -   additions
    -   updates
    -   duplicates
    -   normalization warnings
4.  Do not mutate the production vocabulary during preview.
5.  Apply file size and request limits.

**Acceptance criteria:**

-   Preview does not change persistent data.
-   Invalid records are reported individually where possible.
-   Import processing is protected by authorization.
-   Tests cover malformed files, duplicates, and large input rejection.

------------------------------------------------------------------------

## Prompt 014 --- Implement transactional vocabulary import [DONE]

**Goal:** Commit approved vocabulary changes safely.

**Instructions:**

1.  Implement the approved replace, merge, or versioned import policy.
2.  Require explicit confirmation after preview.
3.  Use a database transaction.
4.  Record import metadata and outcome.
5.  Ensure failed imports do not leave partial data.
6.  Add an administrator-facing import result summary.

**Acceptance criteria:**

-   Successful imports are atomic.
-   Failed imports roll back correctly.
-   Import history is recorded.
-   Existing user attempt history remains consistent.
-   Tests verify rollback and duplicate behavior.

------------------------------------------------------------------------

# Phase 4 --- Frontend foundation

## Prompt 015 --- Create the TapTalk design system [IN PROGRESS]

**Goal:** Establish a consistent child-friendly interface.

**Instructions:**

Create reusable design tokens and components for:

-   typography
-   spacing
-   colors
-   cards
-   buttons
-   inputs
-   feedback messages
-   navigation
-   progress indicators
-   loading and error states

Design for small screens first and larger tablets second. Use accessible
focus states, readable sizing, and touch-friendly controls. Avoid
excessive visual complexity.

**Acceptance criteria:**

-   Components are reusable and documented.
-   Keyboard focus is visible.
-   Contrast and touch target requirements are addressed.
-   Components work across mobile and tablet breakpoints.
-   Component tests cover important states.

------------------------------------------------------------------------

## Prompt 016 --- Implement routing and authenticated application shell [IN PROGRESS]

**Goal:** Create the main application navigation.

**Instructions:**

Implement routes for:

-   login
-   registration
-   practice
-   dashboard
-   settings
-   administrator import area, if authorized

Add:

-   authenticated route handling
-   navigation
-   loading state
-   not-found page
-   safe error state
-   responsive layout

**Acceptance criteria:**

-   Unauthorized routes redirect safely.
-   Navigation works on small screens and tablets.
-   Refreshing an authenticated page behaves correctly.
-   Routes are tested.

------------------------------------------------------------------------

## Prompt 017 --- Implement registration and login screens [IN PROGRESS]

**Goal:** Connect the frontend account flow to the API.

**Instructions:**

Create accessible forms with:

-   client-side validation
-   server error handling
-   loading states
-   password/PIN visibility behavior as appropriate
-   safe error messages
-   keyboard-friendly submission

Do not duplicate server-side security rules as the only validation
mechanism.

**Acceptance criteria:**

-   Users can register and log in through the UI.
-   Errors are understandable.
-   Forms do not submit multiple times accidentally.
-   Successful login reaches the authenticated shell.
-   Component and integration tests pass.

------------------------------------------------------------------------

# Phase 5 --- Learning domain

## Prompt 018 --- Define answer matching rules [DONE]

**Goal:** Create deterministic answer validation.

**Instructions:**

Document and implement the approved matching policy. At minimum,
consider:

-   leading/trailing whitespace
-   Unicode normalization
-   capitalization
-   punctuation
-   accepted alternative translations
-   empty answers
-   placeholders and ellipses
-   preserving original user input

Keep answer matching in a testable domain module independent of Vue
components.

**Acceptance criteria:**

-   Matching rules are documented.
-   Tests cover correct answers, incorrect answers, alternatives,
    punctuation, and whitespace.
-   The system does not silently accept arbitrary approximate answers.
-   Matching results include a reason or classification where useful.

------------------------------------------------------------------------

## Prompt 019 --- Implement practice question selection [IN PROGRESS]

**Goal:** Select questions according to user preferences and learning
history.

**Instructions:**

Implement a deterministic, testable selection service supporting:

-   English-to-German
-   German-to-English
-   random direction
-   selected vocabulary filters
-   avoidance of invalid or unavailable entries
-   a reasonable mix of new and previously practiced entries

Create an initial explainable weighted strategy that increases selection
probability for words with repeated errors. Avoid claiming that this is
machine learning.

**Acceptance criteria:**

-   Direction selection works correctly.
-   Preferences are respected.
-   Empty candidate sets are handled safely.
-   Weighted selection is tested statistically or through deterministic
    seeded tests.
-   Selection logic is independent of the UI.

------------------------------------------------------------------------

## Prompt 020 --- Implement scoring rules [IN PROGRESS]

**Goal:** Define and implement the points system.

**Instructions:**

1.  Document the scoring formula.
2.  Decide how correct and incorrect attempts affect points.
3.  Define whether repeated attempts in one session earn points
    independently.
4.  Ensure scoring is calculated server-side.
5.  Add tests for all scoring cases.
6.  Prevent client-provided scores from being trusted.

**Acceptance criteria:**

-   Score calculations are deterministic.
-   Client manipulation cannot directly assign points.
-   Scoring rules are visible in documentation.
-   Boundary and negative-value cases are tested.

------------------------------------------------------------------------

## Prompt 021 --- Implement attempt recording [DONE]

**Goal:** Persist every submitted answer safely.

**Instructions:**

Record at least:

-   user
-   vocabulary entry
-   direction
-   prompt shown
-   submitted answer
-   correctness
-   scoring result
-   timestamp
-   relevant normalization or matching result

Use a transaction when attempt recording and user statistics must change
together.

**Acceptance criteria:**

-   Correct and incorrect attempts are stored.
-   History is attributable to the correct user.
-   Duplicate requests are handled according to an explicit policy.
-   Database failures do not create inconsistent scoring.
-   Integration tests pass.

------------------------------------------------------------------------

## Prompt 022 --- Implement the practice session API [DONE]

**Goal:** Provide backend endpoints for the learning loop.

**Instructions:**

Implement endpoints or equivalent handlers for:

-   starting a session
-   requesting a question
-   submitting an answer
-   completing or abandoning a session
-   retrieving session results

Do not expose answer keys in a way that undermines the practice flow.
Document the API contract and error responses.

**Acceptance criteria:**

-   Authenticated users can practice.
-   Submitted answers are validated server-side.
-   Results include correct/incorrect status and score impact.
-   Unauthorized and invalid requests are rejected.
-   API integration tests pass.

------------------------------------------------------------------------

# Phase 6 --- Practice UI and user progress

## Prompt 023 --- Implement the practice screen [IN PROGRESS]

**Goal:** Build the core child-facing learning experience.

**Instructions:**

Create a responsive practice screen with:

-   displayed source phrase
-   optional phonetics
-   text input
-   submit action
-   keyboard submission
-   immediate feedback
-   correct answer or explanation after submission, according to the
    approved UX
-   next-question action
-   session progress
-   safe loading and error states

Make the main interaction comfortable on tablets and usable on small
screens.

**Acceptance criteria:**

-   A user can complete a practice question end-to-end.
-   Input focus behavior is deliberate.
-   Feedback is accessible and not communicated by color alone.
-   Double submissions are prevented.
-   UI tests cover success, failure, loading, and error states.

------------------------------------------------------------------------

## Prompt 024 --- Implement session completion summary [DONE]

**Goal:** Show the results of a completed session.

**Instructions:**

Display:

-   total questions
-   correct answers
-   incorrect answers
-   points earned
-   accuracy
-   words requiring more practice
-   actions to practice again or return to the dashboard

Ensure incomplete sessions are handled according to the documented
policy.

**Acceptance criteria:**

-   Summary values match server results.
-   Zero-question and interrupted-session cases are handled.
-   The layout works on mobile and tablet.
-   Tests cover calculation and rendering states.

------------------------------------------------------------------------

## Prompt 025 --- Implement dashboard APIs and UI [DONE]

**Goal:** Make progress visible at any time.

**Instructions:**

Implement server queries and frontend views for:

-   total points
-   total attempts
-   accuracy
-   recent activity
-   words with repeated errors
-   progress by language direction
-   optional time-based summaries

Avoid exposing other users' data. Use pagination or bounded queries for
history.

**Acceptance criteria:**

-   Dashboard is accessible from navigation.
-   Figures are derived from persisted data.
-   User isolation is tested.
-   Empty states are useful and child-friendly.
-   Dashboard is responsive and accessible.

------------------------------------------------------------------------

## Prompt 026 --- Implement user settings [DONE]

**Goal:** Allow users to choose what appears during practice.

**Instructions:**

Implement settings for the approved options, such as:

-   practice direction
-   selected vocabulary
-   session length
-   repetition preference
-   optional feedback settings

Persist settings per user. Validate them on the server. Ensure changes
take effect predictably and do not corrupt active sessions.

**Acceptance criteria:**

-   Settings survive logout and login.
-   Invalid settings are rejected.
-   Practice selection respects saved settings.
-   Settings UI works on small screens and tablets.
-   Tests cover defaults, updates, and authorization.

------------------------------------------------------------------------

# Phase 7 --- Administration and PWA

## Prompt 027 --- Implement the administrator import UI [DONE]

**Goal:** Provide a usable secure vocabulary management screen.

**Instructions:**

Create an administrator-only UI for:

-   selecting a JSON file
-   displaying validation errors
-   previewing changes
-   confirming an import
-   displaying import results
-   showing import history

Do not place administrative controls in the regular child-facing
navigation unless the user has the required role.

**Acceptance criteria:**

-   Non-administrators cannot access the feature.
-   Preview and confirmation are separate actions.
-   Errors are understandable.
-   Large or invalid files are handled safely.
-   End-to-end import tests pass.

------------------------------------------------------------------------

## Prompt 028 --- Configure PWA behavior [IN PROGRESS]

**Goal:** Make the web application installable and responsive as a PWA.

**Instructions:**

Configure:

-   web app manifest
-   appropriate icons and metadata
-   service worker strategy
-   cache policy
-   update behavior
-   offline and unavailable-network states
-   safe handling of authenticated data

Do not claim that practice works offline unless offline data storage and
synchronization have been explicitly implemented and tested.

**Acceptance criteria:**

-   PWA installability requirements are met.
-   Production assets are cached according to the chosen strategy.
-   Stale application versions are handled.
-   Sensitive data is not accidentally cached publicly.
-   PWA checks and browser tests pass.

------------------------------------------------------------------------

# Phase 8 --- Quality and hardening

## Prompt 029 --- Build the backend integration test suite [DONE]

**Goal:** Verify the backend across module boundaries.

**Instructions:**

Add integration tests covering:

-   registration
-   login/logout
-   authorization
-   vocabulary import
-   question selection
-   answer submission
-   scoring
-   attempt history
-   dashboard queries
-   settings
-   transaction rollback

Use isolated test data and avoid dependence on production resources.

**Acceptance criteria:**

-   Core API workflows are covered.
-   Tests are repeatable.
-   User isolation is verified.
-   Failure paths are tested.
-   Test output is suitable for CI.

------------------------------------------------------------------------

## Prompt 030 --- Build end-to-end browser tests [DONE]

**Goal:** Verify the principal user journeys.

**Instructions:**

Use a browser testing framework to test:

1.  registration
2.  login
3.  choosing settings
4.  completing a practice question
5.  receiving feedback
6.  completing a session
7.  viewing the dashboard
8.  administrator vocabulary import
9.  unauthorized access behavior

Use stable selectors and test data. Avoid brittle timing-based
assertions.

**Acceptance criteria:**

-   Main journeys pass in a clean test environment.
-   Mobile-sized and tablet-sized viewports are covered.
-   Failures produce useful artifacts.
-   Tests do not depend on external production accounts.

------------------------------------------------------------------------

## Prompt 031 --- Perform accessibility review [NOT STARTED]

**Goal:** Improve usability for children and users with accessibility
needs.

**Instructions:**

Review and test:

-   semantic HTML
-   keyboard navigation
-   focus management
-   accessible form labels
-   error announcements
-   contrast
-   text scaling
-   touch targets
-   non-color feedback
-   reduced motion preferences where relevant

Fix confirmed issues and document any known limitations.

**Acceptance criteria:**

-   Automated accessibility checks run.
-   Core flows are manually reviewed with keyboard navigation.
-   Critical accessibility defects are fixed.
-   Feedback is understandable without relying only on color or
    animation.

------------------------------------------------------------------------

## Prompt 032 --- Perform security review [NOT STARTED]

**Goal:** Review the application for common web security risks.

**Instructions:**

Review:

-   authentication and session handling
-   password storage
-   authorization
-   CSRF considerations where applicable
-   input validation
-   file upload limits
-   JSON parsing
-   rate limiting
-   sensitive logging
-   error exposure
-   dependency vulnerabilities
-   database backup exposure
-   security headers

Document findings by severity and fix issues within scope.

**Acceptance criteria:**

-   No critical or high-severity known issue remains without an explicit
    decision.
-   Authorization is tested at the API layer.
-   Sensitive values are absent from logs and responses.
-   Security checks are documented.

------------------------------------------------------------------------

## Prompt 033 --- Review responsive design [NOT STARTED]

**Goal:** Validate the UI on small screens and tablets.

**Instructions:**

Review all core screens at representative mobile and tablet dimensions.
Check:

-   overflow
-   keyboard behavior
-   input visibility
-   button sizing
-   navigation
-   dashboard readability
-   orientation changes
-   long vocabulary phrases
-   error messages
-   touch interactions

Fix defects without introducing screen-specific hacks unless justified.

**Acceptance criteria:**

-   No unintended horizontal scrolling in core views.
-   Practice input remains usable with an on-screen keyboard.
-   Tablet layout uses available space comfortably.
-   Core flows remain usable at narrow widths.

------------------------------------------------------------------------

# Phase 9 --- Deployment and operations

## Prompt 034 --- Create the production build configuration [NOT STARTED]

**Goal:** Produce reproducible production builds.

**Instructions:**

Configure:

-   production frontend build
-   backend build
-   environment variable validation
-   production logging
-   health and readiness checks
-   graceful shutdown
-   database migration execution
-   static asset serving or deployment routing
-   secure default configuration

Separate development, test, and production settings.

**Acceptance criteria:**

-   Production build runs in a clean environment.
-   Missing required configuration fails clearly.
-   Health checks are documented.
-   Secrets are injected through environment or deployment secret
    management.
-   Production configuration does not contain development credentials.

------------------------------------------------------------------------

## Prompt 035 --- Create the container and deployment configuration [NOT STARTED]

**Goal:** Prepare the app for the selected hosting target.

**Instructions:**

Based on the approved hosting decision:

1.  Create a production Dockerfile if Docker is selected.
2.  Use a minimal suitable runtime image.
3.  Run as a non-root user where practical.
4.  Define persistent storage for SQLite.
5.  Document database backup and restore.
6.  Configure HTTPS assumptions and reverse proxy behavior.
7.  Add deployment documentation and environment variable reference.

**Acceptance criteria:**

-   Deployment steps work from a clean checkout.
-   SQLite data persists across application restarts.
-   Backup and restore procedures are documented and tested.
-   The application does not depend on ephemeral storage for permanent
    data.

------------------------------------------------------------------------

## Prompt 036 --- Create CI/CD release workflow [NOT STARTED]

**Goal:** Automate safe release validation and deployment.

**Instructions:**

Create a workflow appropriate to the chosen hosting provider that:

-   runs lint
-   runs typecheck
-   runs unit tests
-   runs integration tests
-   builds the application
-   optionally runs browser tests
-   builds the deployment artifact
-   requires explicit production approval where appropriate
-   records the deployed version

Do not add automatic production deployment until environment protection
and rollback procedures are documented.

**Acceptance criteria:**

-   A failing quality check blocks release.
-   Production deployment uses protected secrets.
-   Release version is traceable to a commit.
-   Rollback instructions exist.

------------------------------------------------------------------------

## Prompt 037 --- Perform production smoke testing [NOT STARTED]

**Goal:** Verify the deployed application.

**Instructions:**

Create a production smoke test checklist and execute it against the
deployed environment:

-   application availability
-   HTTPS
-   health endpoint
-   registration
-   login
-   practice flow
-   dashboard
-   settings
-   administrator import authorization
-   database persistence
-   logout
-   PWA loading behavior

Use test accounts and test vocabulary only. Do not expose credentials in
logs or documentation.

**Acceptance criteria:**

-   All critical smoke checks pass.
-   Any failure is recorded with severity and remediation.
-   Production data is not polluted by uncontrolled test data.
-   A release decision is documented.

------------------------------------------------------------------------

# Phase 10 --- Final handover

## Prompt 038 --- Prepare the project handover [NOT STARTED]

**Goal:** Make TapTalk maintainable by another developer.

**Instructions:**

Update or create:

-   README
-   local development guide
-   environment variable reference
-   architecture overview
-   database migration guide
-   vocabulary import guide
-   testing guide
-   deployment guide
-   backup and restore guide
-   troubleshooting guide
-   known limitations
-   release checklist

Include commands that are verified to work.

**Acceptance criteria:**

-   A new developer can set up the project using the documentation.
-   A vocabulary administrator can understand the import process.
-   Deployment and rollback steps are documented.
-   Known limitations are explicit.
-   Final checks are recorded.

------------------------------------------------------------------------

# Recommended execution gates

Do not proceed automatically from one phase to the next without passing
its gate.

  Gate              Required evidence
  ----------------- ----------------------------------------------------------
  Foundation        Build, lint, typecheck, basic test
  Backend           Migration tests, API tests, security checks
  Learning engine   Matching, scoring, selection, attempt tests
  Frontend          Component tests, responsive review, accessibility checks
  Integration       End-to-end user journeys
  Deployment        Production build, persistence test, smoke test
  Handover          Documentation and release checklist

# Definition of done

A feature is complete only when:

-   The implementation matches its documented requirements.
-   Validation exists at the appropriate trust boundaries.
-   Relevant tests pass.
-   Error and loading states are handled.
-   Accessibility and responsive behavior have been considered.
-   Security implications have been reviewed.
-   Documentation is updated.
-   The agent reports changed files, commands executed, test results,
    and unresolved issues.

# Suggested first execution

Start with Prompt 001, then execute Prompts 002--006. Do not implement
authentication or the learning engine before the architecture, shared
validation strategy, and test foundation are established.

This ordering minimizes the risk of having to rewrite core modules after
the first features have already been built.
