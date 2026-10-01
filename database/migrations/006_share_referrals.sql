-- Share results and referral attribution.
--
-- A share is an opaque, revocable pointer to one COMPLETED session. It stores no
-- score: the card is rendered from the session's persisted attempts every time it
-- is read, so a shared card can never drift from the authoritative result and
-- there is no second copy of the truth to keep in sync.
--
-- The token is a bearer capability for one anonymized card. It carries no
-- information about the owner, is never derived from a sequential id, and grants
-- no access to the owner's account or history -- the public endpoint returns only
-- the allow-listed scalars in `shareResultPayloadSchema`.

CREATE TABLE IF NOT EXISTS shared_results (
  id TEXT PRIMARY KEY NOT NULL,
  -- ON DELETE CASCADE: deleting the owner or the session retires the share, so
  -- the public endpoint can never outlive the data it describes.
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS shared_results_user_index ON shared_results (user_id, created_at DESC);

-- One share per session per owner: re-sharing the same completed result returns
-- the existing token, so the public URL stays stable instead of multiplying.
CREATE UNIQUE INDEX IF NOT EXISTS shared_results_session_unique
  ON shared_results (user_id, session_id);

-- Referral attribution is acquisition metadata only: it records that a learner
-- arrived through a share, never anything about what they then practised. There
-- is deliberately no FK to learning_attempts and no free-form payload.
CREATE TABLE IF NOT EXISTS referral_attributions (
  id TEXT PRIMARY KEY NOT NULL,
  shared_result_id TEXT NOT NULL REFERENCES shared_results(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  -- Set once, on the referred learner's first recorded attempt.
  converted_at TEXT
);

CREATE INDEX IF NOT EXISTS referral_attributions_share_index
  ON referral_attributions (shared_result_id);

-- One attribution per (share, referred learner), so re-registering or switching
-- accounts cannot inflate the count.
CREATE UNIQUE INDEX IF NOT EXISTS referral_attributions_unique
  ON referral_attributions (shared_result_id, referred_user_id);

-- Resolving "has this referred learner started practising yet?" on first attempt.
CREATE INDEX IF NOT EXISTS referral_attributions_user_index
  ON referral_attributions (referred_user_id, converted_at);