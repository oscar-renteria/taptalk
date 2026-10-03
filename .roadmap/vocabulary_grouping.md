# Custom Vocabulary Groups

## Goal

Allow learners to organize the existing TapTalk vocabulary into **custom groups** and choose which group of vocabulary should be used when starting a Practice session or Exam.

A typical use case is preparation for a school test:

> `Test 15.10.2026`

The learner creates the group, selects only the vocabulary that will be covered by the upcoming school test, and then starts a Practice session or Exam using that group.

The feature must operate on the existing vocabulary entries. A group is a **selection of vocabulary**, not a copy of the vocabulary.

Learning history, attempts, weighting, and statistics remain attached to the original vocabulary entries regardless of group membership.

---

# Product concept

Introduce a **Vocabulary Groups** area where the learner can:

* see existing groups;
* create a new group;
* rename a group;
* delete a group;
* open a group;
* select/unselect vocabulary entries;
* see how many words are currently included;
* use the group as the vocabulary scope for a Practice session or Exam.

Example:

```text
My vocabulary groups

Test 15.10.2026
18 words

Unit 4
32 words

Irregular verbs
24 words

+ Create group
```

Opening a group:

```text
Test 15.10.2026

18 of 42 words selected

[ Select all ] [ Clear all ]

☑ apple       Apfel
☑ airport     Flughafen
☐ arrive      ankommen
☑ boarding    Einsteigen
...

[ Practice this group ]
[ Exam this group ]
```

The exact visual design should follow the existing TapTalk UI rather than introducing a new visual language.

---

# 1. Vocabulary groups

A group belongs to exactly one authenticated user.

A group should have, at minimum:

* internal ID;
* owner/user ID;
* user-visible name;
* created timestamp;
* updated timestamp.

The group name is user-generated content and must be validated.

Use shared Zod schemas at the API boundary.

Recommended initial constraints:

* name must not be empty;
* trim surrounding whitespace;
* define a sensible maximum length consistent with the existing UI/database conventions;
* names do not need to be globally unique;
* names may be reused by different groups belonging to the same user.

Do not introduce folders or nested groups.

Do not introduce sharing of groups in this feature.

---

# 2. Group membership

A group contains references to existing vocabulary entries.

Implement membership as a relationship rather than copying vocabulary records.

Conceptually:

```text
User
 └── Group
      ├── Vocabulary entry
      ├── Vocabulary entry
      └── Vocabulary entry
```

A vocabulary entry may belong to:

* no custom groups;
* one group;
* multiple groups.

This is important because the same vocabulary can be relevant for multiple school tests or study topics.

Removing a vocabulary entry from a group must **not**:

* delete the vocabulary entry;
* delete attempts;
* reset learning statistics;
* change the vocabulary's normal selection weight;
* affect its membership in other groups.

---

# 3. Database migration

If groups/membership are not already represented by the current schema, add a new numbered migration under:

`database/migrations/`

Do not modify existing migrations.

Use the existing database conventions and foreign-key strategy.

The membership relationship should have an appropriate uniqueness constraint so that the same vocabulary entry cannot accidentally occur twice in one group.

The database should enforce ownership/reference integrity wherever the existing architecture supports it.

Do not add an ORM or native SQLite dependency.

---

# 4. Group management API

Add authenticated API operations following the existing TapTalk API conventions.

The API should support operations equivalent to:

### List groups

Return groups belonging to the authenticated user.

Do not return another user's groups.

Include enough information for the UI to display:

* group name;
* selected word count;
* timestamps if the existing UI needs them.

### Create group

Authenticated.

Input:

```text
name
```

The server creates the group for the authenticated user.

The browser must not be able to specify another owner.

### Rename group

Authenticated.

The API must verify ownership.

### Delete group

Authenticated.

The API must verify ownership.

Deleting a group removes only:

* the group;
* its membership records.

It must never delete the underlying vocabulary entries or learning history.

### Get group

Authenticated.

Return:

* group metadata;
* vocabulary entries available to the owner;
* membership state for each entry.

The response should make it possible for the UI to render a selectable vocabulary list without requiring one request per word.

### Update group membership

Authenticated.

Allow the owner to add/remove vocabulary entries from the group.

The API must verify that every vocabulary entry being added belongs to the authenticated user's available vocabulary according to the existing vocabulary ownership model.

Do not trust vocabulary IDs supplied by the browser merely because the user owns the group.

---

# 5. Ownership and authorization

Authorization is API-side and mandatory.

For every group operation:

* identify the authenticated user from the existing session;
* enforce group ownership in the API service/repository layer;
* never rely solely on frontend route guards or hidden UI controls.

A user must not be able to:

* read another user's group;
* rename another user's group;
* delete another user's group;
* add another user's vocabulary to their group;
* remove another user's group memberships;
* use another user's group as a test scope.

Where possible, design repository queries so ownership is part of the database query rather than a separate client-controlled check.

---

# 6. Vocabulary selection UI

Add a Vocabulary Groups management experience to the existing application navigation.

The UI should allow the learner to create a group and then select vocabulary.

The group editor should support:

* clear group title;
* current selected count;
* `Select all`;
* `Clear all`;
* individual selection/unselection;
* readable vocabulary entries;
* save/update feedback;
* empty-state handling.

The vocabulary list must use existing vocabulary presentation conventions.

Do not introduce a second vocabulary representation just for groups.

If the existing vocabulary list already supports search/filtering, reuse it where practical.

If the existing vocabulary list is large, the implementation should avoid rendering an unnecessarily expensive DOM tree. Follow the existing application's established approach before introducing virtualization.

---

# 7. Selection semantics

The group represents an explicit set of vocabulary entries.

A word is included when it is a member of the group.

Do not interpret group membership as a copy of the vocabulary's current text.

If the underlying vocabulary entry changes later, the group continues to reference that vocabulary entry.

This means:

* edits to the vocabulary remain visible through the group;
* learning history remains intact;
* the group membership itself remains stable.

If an underlying vocabulary entry is removed by an existing vocabulary-management mechanism, follow the existing data-retention/foreign-key rules and ensure stale group memberships cannot produce invalid test questions.

---

# 8. Using a group in Practice

Extend the existing Practice configuration/start flow so that the learner can optionally choose a vocabulary scope.

The learner should be able to choose:

* **All vocabulary**
* one of their custom groups

Do not change the existing direction selection:

* English → German
* German → English
* Random

The existing session length rules remain in force.

When a group is selected, the API must create/select questions only from vocabulary entries belonging to that group.

The browser must never:

1. download the full vocabulary;
2. select a subset locally;
3. submit that subset to the API as authoritative.

The API must resolve the group and vocabulary membership itself.

The API remains authoritative for question selection.

---

# 9. Using a group in Exams

Extend the existing Exam configuration/start flow in the same way.

The learner can select:

* all vocabulary;
* a custom group.

Once an exam has started, the selected vocabulary scope must remain fixed for that exam.

Later modifications to the group must not silently change the vocabulary scope of an already-running exam.

The API should persist whatever scope/reference is required to guarantee this behaviour.

Do not allow the browser to change the vocabulary scope after the exam has started.

---

# 10. Interaction with learning and selection rules

Custom groups are a **vocabulary scope**, not a replacement for TapTalk's learning algorithm.

When a group is used:

```text
available vocabulary
        ↓
selected custom group
        ↓
existing selection algorithm
        ↓
questions
```

The existing selection/learning rules continue to determine which words are selected from the allowed vocabulary.

Do not implement separate scoring, matching, weighting, or learning logic for groups.

In particular:

* group membership does not increase or decrease a word's learning weight;
* adding a word to a group does not reset its history;
* removing a word from a group does not reset its history;
* the existing `selection.ts` remains the intended authority for question-selection rules.

If changes to selection are necessary, make them in the existing backend domain module rather than duplicating the algorithm.

---

# 11. Insufficient vocabulary

A group may contain fewer words than the requested session/exam length.

For example:

```text
Group contains: 8 words
Requested exam: 20 questions
```

The API must not silently expand the selection to vocabulary outside the group.

The API should return an explicit, typed validation/business error indicating that the selected vocabulary scope cannot satisfy the requested session.

The frontend should explain the situation clearly, for example:

> This group contains 8 words. Choose a shorter test or add more words to the group.

The exact wording must use `t()`.

The same rule applies if filtering/selection rules make fewer questions available than the requested session length.

Do not silently fall back to all vocabulary.

---

# 12. Empty groups

A group may exist with zero selected vocabulary entries.

This is useful because the learner may create the group first and populate it later.

However:

* an empty group cannot start Practice;
* an empty group cannot start an Exam.

The API should reject the attempt with an appropriate business error.

The UI should make the reason clear and provide a path back to the group editor.

---

# 13. Group changes and active sessions

Once a Practice session or Exam has started, changes to a group must not alter the active session unexpectedly.

The implementation should preserve the existing session model.

For a started session:

* the session's authoritative vocabulary scope is fixed;
* subsequent group membership changes do not affect already-created questions or the active session;
* answer matching and scoring continue to use the existing API-authoritative rules.

Do not solve this by trusting a client-provided vocabulary list.

---

# 14. Dashboard / Progress

Do not duplicate the complete progress system per group as part of this feature.

The existing learner progress remains vocabulary-based.

However, where the existing dashboard naturally exposes the context of a completed Practice/Exam session, it may show that the session used a custom group.

For example:

```text
Exam
Test 15.10.2026
18 / 20
```

This should use the group name as a historical label/reference according to the existing persistence model.

Do not make group deletion destroy historical session information.

If the existing architecture does not have an appropriate way to preserve this historical context, document the decision and implement the smallest consistent solution rather than introducing a separate reporting system.

---

# 15. Group deletion

Deleting a group removes the group and its membership relationship.

It must not:

* delete vocabulary;
* delete answers;
* delete attempts;
* delete scores;
* delete progress;
* alter other groups.

If historical sessions reference the group, determine whether the existing data model requires preserving a snapshot/name or allowing the group reference to become unavailable.

Follow the existing persistence and reporting conventions.

This behaviour must be covered by tests.

---

# 16. Frontend state

Follow the existing TapTalk convention for domain stores/modules.

Do not introduce a generic global state framework.

The frontend may cache:

* currently loaded groups;
* current group editor state.

It must not treat client-side state as authoritative.

After mutations, synchronize with the API according to the existing application patterns.

Do not persist custom group membership in `localStorage`.

The only existing client-side persistence exception remains:

`taptalk.vocabularyDensity`

---

# 17. Shared schemas

Add or extend schemas in:

`packages/shared`

for:

* group creation;
* group update;
* group retrieval;
* group membership changes;
* group selection in Practice;
* group selection in Exams;
* relevant API errors/responses.

Use inferred TypeScript types from Zod.

Do not duplicate request/response schemas independently in frontend and backend.

All external/user-controlled values must be validated at the trust boundary.

---

# 18. i18n

Every user-facing string must use `t()`.

Add complete translations for:

* Vocabulary Groups;
* Create group;
* Rename group;
* Delete group;
* group name;
* selected word count;
* select all;
* clear all;
* save;
* cancel;
* empty group;
* no groups;
* add vocabulary;
* remove vocabulary;
* all vocabulary;
* custom group selection;
* group used for Practice;
* group used for Exam;
* insufficient vocabulary;
* group not found;
* delete confirmation;
* success/error feedback;
* accessibility labels.

Provide all keys in:

* `en`
* `de`
* `es`

Update `i18n.test.ts` expectations as required.

A missing translation key is a failing check.

---

# 19. Accessibility

The group-management experience is accessibility-gated.

Requirements include:

* native checkbox semantics for vocabulary selection where appropriate;
* keyboard operation for all actions;
* visible focus state;
* accessible group selection controls;
* accessible selected/unselected state;
* `aria-*` only where native semantics are insufficient;
* minimum 44px interactive targets;
* proper dialog semantics for create/rename/delete interactions;
* focus management;
* screen-reader-friendly selected-count feedback;
* no colour-only indication of selected vocabulary.

Run axe-core against:

* group list;
* group editor;
* group selection in Practice;
* group selection in Exam.

---

# 20. Testing

## Backend unit tests

Cover:

* group creation;
* group ownership;
* group retrieval;
* group rename;
* group deletion;
* membership addition;
* membership removal;
* duplicate membership handling;
* vocabulary ownership validation;
* empty group;
* insufficient vocabulary;
* group selection during Practice;
* group selection during Exam;
* active session isolation from later group changes.

Verify that unauthorized users cannot access another user's groups or vocabulary.

## Domain tests

Where practical, keep group-selection logic as pure functions.

Test that:

* a group restricts the candidate vocabulary;
* existing selection weighting is still applied inside that candidate set;
* vocabulary outside the group is never selected;
* group membership does not modify learning weights.

## Frontend tests

Cover:

* create group;
* rename group;
* delete group;
* select/unselect vocabulary;
* select all;
* clear all;
* group count;
* empty state;
* Practice group selection;
* Exam group selection;
* insufficient-vocabulary error;
* translated labels;
* accessible controls.

## E2E tests

Add Playwright journeys covering at minimum:

### Group creation

1. Log in.
2. Open Vocabulary Groups.
3. Create `Test 15.10.2026`.
4. Add a subset of vocabulary.
5. Reload.
6. Verify the group and membership persist.

### Practice

1. Create/select a group.
2. Start Practice using the group.
3. Verify questions come only from the selected vocabulary.
4. Complete the session.
5. Verify normal scoring/progress behaviour remains intact.

### Exam

1. Select a group.
2. Start an Exam.
3. Verify only group vocabulary is used.
4. Modify the group separately.
5. Verify the running exam is unaffected.

### Authorization

Verify that a user cannot access or manipulate another user's group.

### Deletion

Verify that deleting a group does not delete its vocabulary or learning history.

Include the existing mobile and tablet viewport coverage.

---

# 21. Documentation

Update the relevant documentation to describe:

* custom groups as references to vocabulary;
* group ownership;
* group membership;
* Practice/Exam vocabulary scoping;
* interaction with the existing selection algorithm;
* behaviour when groups are empty or too small;
* active-session behaviour;
* deletion behaviour.

Check `docs/requirements/` and existing ADRs before implementation.

In particular, review **OPEN DECISION 004** and any existing requirements concerning user-facing vocabulary filtering before choosing the final UI/selection model.

If the implementation resolves or changes an architectural decision, add/update an ADR following the existing convention.

---

# 22. Non-goals

This feature must NOT implement:

* shared groups;
* class groups;
* teacher-managed groups;
* group collaboration;
* group permissions;
* public groups;
* group sharing;
* leaderboards;
* group-specific learning algorithms;
* separate vocabulary copies;
* group-specific scoring;
* group-specific learning history;
* importing vocabulary into groups;
* exporting groups;
* nested groups;
* tags or a general-purpose taxonomy system.

A group is simply a **named, user-owned selection of existing vocabulary**.

---

# 23. Acceptance criteria

The feature is complete when:

* A learner can create a named custom vocabulary group.
* A learner can select and unselect existing vocabulary entries.
* A vocabulary entry can belong to multiple groups.
* Removing a word from a group does not remove the vocabulary entry or learning history.
* Groups survive browser reloads and new sessions.
* Groups are private to their owner.
* The API enforces ownership for every group operation.
* Practice can be started using a selected group.
* Exams can be started using a selected group.
* The API, not the browser, determines which vocabulary belongs to the selected group.
* Existing selection, matching, scoring, and learning rules remain authoritative on the API.
* An empty group cannot start a session.
* A group with insufficient vocabulary cannot silently fall back to all vocabulary.
* Changing a group does not unexpectedly modify an already-running session/exam.
* Deleting a group does not delete vocabulary or learning history.
* Group selection works with all existing Practice/Exam directions.
* All user-facing strings exist in `en`, `de`, and `es`.
* The complete feature is keyboard accessible and passes axe-core checks.
* Unit tests and Playwright E2E tests cover the important ownership, persistence, selection, and session-isolation rules.

Before marking the feature complete, run:

```text
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

All four commands must pass.

# Implementation principle

**A custom group is a vocabulary scope, not a new vocabulary source.**

The group answers:

> “Which existing words am I allowing this session to use?”

The existing TapTalk selection algorithm then answers:

> “Which of those allowed words should I ask next?”

The API remains authoritative for both decisions. The browser only lets the learner edit the desired group and displays the resulting state.
