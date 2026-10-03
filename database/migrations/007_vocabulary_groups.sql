-- Custom vocabulary groups.
--
-- A group is a named, user-owned *scope*: a selection of existing vocabulary
-- entries that a Practice session or Exam may draw from. It is not a copy. The
-- group stores references only, so editing the vocabulary later is still visible
-- through the group, and attempts, scores and weighting stay attached to the
-- original vocabulary entry.
--
-- The same entry may sit in any number of groups, because one word can belong to
-- several school tests or study topics. The composite primary key is what stops
-- the same entry appearing twice in one group.

CREATE TABLE IF NOT EXISTS vocabulary_groups (
  id TEXT PRIMARY KEY NOT NULL,
  -- ON DELETE CASCADE: a deleted account leaves no groups behind.
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- User-generated, so trimmed and length-bounded by vocabularyGroupNameSchema
  -- before it reaches here. Not globally unique; a user may reuse a name.
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ownership is the first query column because every read is "my groups".
CREATE INDEX IF NOT EXISTS vocabulary_groups_user_index
  ON vocabulary_groups (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS vocabulary_group_entries (
  group_id TEXT NOT NULL REFERENCES vocabulary_groups(id) ON DELETE CASCADE,
  vocabulary_entry_id TEXT NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  -- One row per entry per group: the same word cannot be added twice.
  PRIMARY KEY (group_id, vocabulary_entry_id)
);

-- Reverse lookup: "which groups is this entry in", and the candidate filter.
CREATE INDEX IF NOT EXISTS vocabulary_group_entries_entry_index
  ON vocabulary_group_entries (vocabulary_entry_id);

-- A session records the scope it started under, so the vocabulary a running
-- session or exam draws from cannot be changed afterwards from the client.
--
-- `vocabulary_group_id` is deliberately ON DELETE SET NULL: deleting a group must
-- not rewrite learning history. `vocabulary_group_name` is a snapshot for the same
-- reason, so a deleted group's name still labels the sessions it was used for.
ALTER TABLE practice_sessions
  ADD COLUMN vocabulary_group_id TEXT REFERENCES vocabulary_groups(id) ON DELETE SET NULL;

ALTER TABLE practice_sessions ADD COLUMN vocabulary_group_name TEXT;

-- The vocabulary a practice session is allowed to draw from, written once when
-- the session starts.
--
-- Exams already freeze their drawn set into exam_questions, but a practice session
-- asks a fresh question each round, so its pool has to be pinned separately.
-- Without this, editing a group mid-session would silently change what a running
-- session asks, and deleting the group would empty it. Membership is resolved once
-- here and copied, so a running session is unaffected by later edits.
--
-- ON DELETE CASCADE keeps the row count bounded: a session outlives nothing else.
CREATE TABLE IF NOT EXISTS practice_session_vocabulary (
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  vocabulary_entry_id TEXT NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, vocabulary_entry_id)
);