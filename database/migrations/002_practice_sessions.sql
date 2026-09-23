CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('english-to-german', 'german-to-english', 'random')),
  question_count INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS practice_sessions_user_status_index ON practice_sessions (user_id, status);

ALTER TABLE learning_attempts ADD COLUMN practice_session_id TEXT REFERENCES practice_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS learning_attempts_session_index ON learning_attempts (practice_session_id);
