# TapTalk Product Requirements

Status: baseline for the first release. Items marked `OPEN DECISION` must be resolved in an architecture or product decision record before implementation depends on them.

## Functional requirements

### Accounts and access

- **PR-001** The system shall allow a person to create an account without requiring an email address.
- **PR-002** The system shall allow a registered person to log in and log out using the approved non-email credential flow.
- **PR-003** The system shall keep each person's vocabulary activity, settings, attempts, and dashboard data isolated from every other person's data.
- **PR-004** The system shall support an administrative role that can manage vocabulary imports.
- **PR-005** The system shall enforce administrator authorization on the server for every vocabulary-management operation.

### Vocabulary

- **PR-006** An administrator shall be able to import vocabulary records containing English text, optional phonetics, and German text.
- **PR-007** The system shall represent multiple accepted German alternatives as separate acceptable answers while preserving the original display value.
- **PR-008** The system shall validate malformed vocabulary data and report useful record-level errors before persistent changes are made.
- **PR-009** The system shall provide an import preview that identifies valid records, invalid records, additions, updates, duplicates, and normalization warnings.
- **PR-010** The system shall commit an approved vocabulary import atomically and retain import metadata and outcome.

### Practice

- **PR-011** A person shall be able to practice English-to-German questions.
- **PR-012** A person shall be able to practice German-to-English questions.
- **PR-013** A person shall be able to practice with a random direction selected according to the saved practice settings.
- **PR-014** A person shall submit answers as typed text.
- **PR-015** The system shall validate each submitted answer against the accepted answers for the displayed vocabulary entry using documented deterministic matching rules.
- **PR-016** The system shall distinguish correct, incorrect, empty, and otherwise invalid submissions where the matching policy requires it.
- **PR-017** The system shall calculate scoring on the server and shall not trust a score supplied by the client.
- **PR-018** The system shall record each practice attempt with its user, vocabulary entry, direction, displayed prompt, submitted answer, correctness, scoring result, timestamp, and relevant matching result.
- **PR-019** The system shall select future questions using practice direction, vocabulary filters, and learning history.
- **PR-020** The selection strategy shall increase the likelihood of entries with repeated errors and shall remain explainable; it shall not be described as machine learning unless a later decision explicitly supports that claim.

### Progress and settings

- **PR-021** The dashboard shall show total points, total attempts, accuracy, recent activity, repeated-error words, and progress by language direction.
- **PR-022** The dashboard shall show useful empty states when a person has no attempts or vocabulary activity.
- **PR-023** A person shall be able to view and update the approved practice settings.
- **PR-024** Practice settings shall be persisted per account, validated on the server, and applied predictably to later practice sessions.
- **PR-025** Updating settings shall not corrupt an active practice session.

### Responsive PWA

- **PR-026** The application shall provide a responsive experience on small mobile screens and tablets.
- **PR-027** Core interactions shall support keyboard navigation, visible focus, semantic labels, and feedback that does not rely on color alone.
- **PR-028** The web application shall provide the manifest, icons, metadata, service-worker behavior, and cache policy needed for installability.
- **PR-029** The application shall show a safe unavailable-network state and shall not claim offline practice unless offline storage and synchronization are implemented and tested.

## Non-functional requirements

- **NFR-001** External input shall be validated at the frontend, API, file-import, environment, and persistence trust boundaries as applicable.
- **NFR-002** Passwords or PIN-equivalents shall never be stored or logged in plaintext.
- **NFR-003** API errors shall not expose credentials, password hashes, secrets, SQL, stack traces, or another person's data.
- **NFR-004** Database schema changes shall use reproducible migrations that can run from an empty database and be tested safely.
- **NFR-005** Core domain rules shall be independently unit-testable without Vue, HTTP, or SQLite.
- **NFR-006** Critical account, authorization, vocabulary, practice, dashboard, and settings workflows shall have automated tests.
- **NFR-007** Production configuration shall receive secrets through environment or deployment secret management and shall not contain committed credentials.
- **NFR-008** Core screens shall remain usable without unintended horizontal scrolling at supported mobile and tablet dimensions.
- **NFR-009** The system shall use bounded or paginated history queries where unbounded activity could affect performance.

## Open decisions

- **OPEN DECISION 001** Choose the account identifier and credential policy: username or nickname, and password or PIN-equivalent. Define uniqueness, recovery, and age-appropriate constraints. *Proposed in [ADR-006](../decisions/ADR-006-credential-policy.md); awaiting product confirmation.*
- **OPEN DECISION 002** Choose the session strategy, including cookie attributes, expiration, revocation, CSRF protection, and whether refresh records are stored. *Resolved in [ADR-005](../decisions/ADR-005-authentication-session.md).*
- **OPEN DECISION 003** Define how the initial administrator is provisioned without hardcoded credentials. *Resolved in [administrator provisioning](../operations/administrator-provisioning.md).*
- **OPEN DECISION 004** Choose the approved vocabulary import policy: replace, merge, or versioned imports, including how updates and deletions affect existing attempts.
- **OPEN DECISION 005** Define answer normalization for punctuation, capitalization, Unicode, placeholders, ellipses, and approximate answers. Approximate matching must not be enabled implicitly. *Proposed in [answer-matching.md](../architecture/answer-matching.md); awaiting product confirmation.*
- **OPEN DECISION 006** Define the scoring formula, including repeated attempts in one session, incorrect-answer effects, and rounding or lower bounds. *Proposed in [scoring.md](../architecture/scoring.md); awaiting product confirmation.*
- **OPEN DECISION 007** Define session length, interruption behavior, duplicate submission policy, and whether a session is required for every attempt.
- **OPEN DECISION 008** Choose the SQLite access layer and migration tool while preserving the documented persistence boundary.
- **OPEN DECISION 009** Choose the hosting target, persistent-storage model, HTTPS/reverse-proxy assumptions, backup schedule, and deployment rollback process.
- **OPEN DECISION 010** Define the supported browser matrix, PWA update behavior, and whether any authenticated data may be cached. *Update behaviour and caching decided in [pwa.md](../engineering/pwa.md); browser matrix still open.*
- **OPEN DECISION 011** Define retention and deletion behavior for accounts, attempts, imports, backups, and other personal data.

## Explicitly out of scope for the first release

- Email-based registration, email verification, and email recovery.
- Social login and third-party identity providers.
- Native mobile applications.
- Multiplayer, social feeds, messaging, and public leaderboards.
- Free-form language tutoring, generative explanations, speech recognition, and pronunciation scoring.
- Unreviewed approximate or semantic answer matching.
- Offline practice and synchronization unless explicitly designed, implemented, and tested as a later scope addition.
- Microservice deployment; the first release is a modular monolith.
- Automatic production deployment without protected environments and documented rollback.