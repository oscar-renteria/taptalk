-- An exam's questions are fixed when the exam starts and never change while it
-- runs. Practice Mode draws a question on every request from the learner's
-- current settings, which is right for a round but wrong for a test: the pool
-- could change mid-exam, the same entry could be asked twice, and the length
-- could not be known before the first question. So the set is written here once.
--
-- `position` is the exam's question order, and it is the only thing the client
-- may refer to when submitting an answer. The server resolves the entry from
-- this table, so a client cannot answer a question that was never asked.
CREATE TABLE IF NOT EXISTS exam_questions (
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  vocabulary_entry_id TEXT NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('english-to-german', 'german-to-english')),
  PRIMARY KEY (session_id, position)
);

-- One entry appears at most once per exam. Enforced by the database rather than
-- by the draw, so a future change to the selection policy cannot reintroduce a
-- duplicate question.
CREATE UNIQUE INDEX IF NOT EXISTS exam_questions_entry_index
  ON exam_questions (session_id, vocabulary_entry_id);

-- An exam is completed the moment its last answer is recorded, not when the
-- client decides to ask for the result. Client-driven completion would let a
-- request that is never sent leave a finished exam stuck in 'active', where it
-- is excluded from every statistic and never appears again.
