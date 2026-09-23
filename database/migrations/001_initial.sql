CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'administrator')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS vocabulary_entries (
  id TEXT PRIMARY KEY NOT NULL,
  english TEXT NOT NULL,
  phonetics TEXT,
  german_display TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vocabulary_answers (
  id TEXT PRIMARY KEY NOT NULL,
  vocabulary_entry_id TEXT NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  answer TEXT NOT NULL,
  normalized_answer TEXT NOT NULL,
  UNIQUE (vocabulary_entry_id, normalized_answer)
);

CREATE INDEX IF NOT EXISTS vocabulary_answers_entry_index ON vocabulary_answers (vocabulary_entry_id);

CREATE TABLE IF NOT EXISTS vocabulary_imports (
  id TEXT PRIMARY KEY NOT NULL,
  initiated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('previewed', 'committed', 'failed')),
  source_name TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'random' CHECK (direction IN ('english-to-german', 'german-to-english', 'random')),
  session_length INTEGER NOT NULL DEFAULT 10 CHECK (session_length BETWEEN 1 AND 100),
  repetition_preference TEXT NOT NULL DEFAULT 'balanced' CHECK (repetition_preference IN ('balanced', 'errors-first')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_entry_id TEXT NOT NULL REFERENCES vocabulary_entries(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('english-to-german', 'german-to-english')),
  prompt TEXT NOT NULL,
  submitted_answer TEXT NOT NULL,
  normalized_answer TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  score_delta REAL NOT NULL,
  matching_reason TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS learning_attempts_user_time_index ON learning_attempts (user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS learning_attempts_error_index ON learning_attempts (user_id, vocabulary_entry_id, correct);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS sessions_expiry_index ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);