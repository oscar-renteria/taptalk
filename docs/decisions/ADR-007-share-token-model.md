# ADR-007: Public Share Token Model

- **Status:** Accepted
- **Date:** 2026-10-01
- **Requirements:** share results and referral links

## Context

A learner finishes a round and wants to show a classmate. That needs a public URL
a stranger can open without an account. The constraints that shape this decision:

- The audience includes children, so nothing identifying may be published.
- The browser is untrusted, so a client must not be able to assert its own score.
- A shared link may be forwarded and opened weeks later, so revocation must be
  possible without changing the URL.
- TapTalk has no analytics infrastructure and must not acquire a tracking SDK,
  a client-side tracking identifier, or a third-party identity for this.

The open question was whether a share token is a **secret capability** (stored
hashed, returned once) or a **public identifier** (stored as issued, retrievable by
its owner).

## Decision

**A share token is a public identifier, not a secret.** It is 32 bytes from
`crypto.randomBytes`, base64url encoded (256 bits, 43 characters), stored as
issued, and never derived from a row id or counter.

**One sanitized payload.** `shareResultPayloadSchema` is `.strict()` and carries six
scalars: kind, direction, correctCount, totalQuestions, score, sharedAt. It is the
only representation of a result that ever leaves the owner's session. The payload is
built field by field from an explicit list, so an owner-derived key cannot arrive
by accident.

**No score snapshot.** The card is re-derived from the session's recorded attempts
on every read, so the API stays the single source of truth and nothing can drift.

**The token grants no access.** It cannot reach the sharer's account, history, or
settings. Every failure on the public endpoint returns one identical response, so
the endpoint cannot be used to probe whether a token ever existed.

**Referral attribution is an HttpOnly cookie, never `localStorage`.** The cookie
holds only the opaque token, which the server resolves by lookup. Revoked shares
and self-referral are refused, the cookie is consumed once, and a unique
`(share, referred user)` index keeps repeat visits idempotent.

**The result image is drawn client-side with Canvas 2D** from the sanitized
payload, with no new dependency and no image-generation service.

## Consequences

**Positive**

- A database compromise exposes no new capability: the links are public by design
  and reveal one anonymized card.
- The owner can always retrieve their own share URL, so the public URL is stable
  and re-sharing is idempotent per session.
- A shared card cannot disagree with the owner's own result, because there is only
  one copy of the truth.
- No client-side tracking identifier exists, so the privacy surface is smaller than
  a typical referral link.

**Negative, and accepted**

- Shares do not expire on a timer, so a link stays live until revoked or until the
  session or owner is deleted. This is the intended behaviour: the point is that a
  classmate can open it later.
- Because the token is retrievable by its owner, there is no "link only once"
  property. The owner can already re-share at any time, so this reveals nothing.
- The public page and the share sheet duplicate the card's layout in markup and in
  canvas. Both are driven by the same payload and the same strings, and both are
  covered by tests, so they can be expected to stay aligned.

**Not decided here**

- Whether a shared card should ever show a display name. It is anonymous by default
  and this ADR does not open that door.
- Referral analytics beyond a signup count and a conversion count. TapTalk has no
  analytics infrastructure and this feature does not add one.