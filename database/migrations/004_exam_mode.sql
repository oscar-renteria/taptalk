-- Exam Mode reuses the practice session table rather than duplicating it: an exam
-- is a session whose `kind` is 'exam'. Everything the session already carries -
-- direction, question count, status, timings - and every learning attempt that
-- belongs to it, are exactly what an exam result and its review need.
--
-- Adding a column rather than a parallel table keeps one source of truth for
-- question selection, answer matching, and session lifecycle, so Practice Mode
-- and Exam Mode cannot drift apart.
ALTER TABLE practice_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice'
  CHECK (kind IN ('practice', 'exam'));

-- Exam statistics aggregate over completed exams, newest first, for one user.
CREATE INDEX IF NOT EXISTS practice_sessions_exam_index
  ON practice_sessions (user_id, kind, status, started_at DESC);
