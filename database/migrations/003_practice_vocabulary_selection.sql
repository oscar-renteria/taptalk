-- Per-user control over which vocabulary entries Practice Mode may use.
--
-- Only *excluded* entries are stored. That makes the default behaviour correct
-- without a row per user per entry: a user with no rows here can practise all
-- vocabulary, and a newly imported entry is enabled for everyone immediately
-- instead of being silently unavailable until someone opts in.
--
-- Entries are referenced by their stable primary key, never by the displayed
-- word, so duplicate words cannot collide.
--
-- ON DELETE CASCADE on vocabulary_entry_id means deleting an entry clears the
-- selection rows for it, so no stale id can ever be left behind.
CREATE TABLE IF NOT EXISTS user_practice_vocabulary_exclusions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_entry_id TEXT NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  excluded_at TEXT NOT NULL,
  PRIMARY KEY (user_id, vocabulary_entry_id)
);

CREATE INDEX IF NOT EXISTS user_practice_vocabulary_exclusions_entry_index
  ON user_practice_vocabulary_exclusions (vocabulary_entry_id);
