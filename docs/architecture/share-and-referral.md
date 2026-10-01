# Share Results and Referral Links

## Context

A learner finishes a round and wants to show a classmate. This feature turns a
completed result into one anonymous card and a public URL, so a result can be passed
to somebody who has never used TapTalk.

It is deliberately small: one card, one link, one referral counter. No profiles, no
leaderboards, no friend lists, no comments, no social-network integration. The token
model is decided in [ADR-007](../decisions/ADR-007-share-token-model.md).

## The rule the whole feature rests on

**The API owns the truth; the browser owns the presentation.**

The API decides whether a result may be shared and what score it holds. The client
turns that trusted, sanitized representation into a card, an image, a message, and a
link. It never sends a score, a count, or a percentage, and `createShareResultSchema`
is `.strict()`, so a body carrying one is rejected with `400 INVALID_SHARE_REQUEST`
rather than silently ignored.

## Share tokens

`createShareToken()` in `apps/api/src/share.ts` returns 32 bytes from
`crypto.randomBytes`, base64url encoded: 256 bits in 43 characters.

- **Not derived from anything.** Never a row id, never a counter, so tokens are not
  guessable from creation order.
- **Carries no information.** It encodes nothing about the owner.
- **Stored as issued.** It is the public URL component, not a secret, so the owner can
  always retrieve their own share URL and the public URL stays stable.

## The public payload

`shareResultPayloadSchema` in `packages/shared` is the only representation of a
result that ever leaves the owner's session:

```text
kind, direction, correctCount, totalQuestions, score, sharedAt
```

Six scalars. The object is `.strict()`, so returning one field too many would fail
validation rather than leak quietly. `buildSharePayload` builds it field by field from
an explicit list, so no owner-derived key can arrive by accident.

Absent by construction: username, user id, email, class, school, teacher, the
vocabulary list, per-word answers, and learning history.

## No snapshot

A share row stores **no score**. The card is re-derived from the session's recorded
attempts on every read (`readShareableResult`), so there is exactly one source of
truth. `totalQuestions` counts recorded attempts rather than planned questions, so a
card can never claim an answer to a question that was never asked.

## Eligibility

Shareable only when the session is `completed` **and** has at least one recorded
attempt. `isShareableStatus` and `hasScorableResult` in `apps/api/src/share.ts` are
pure functions covering both rules.

## Lifecycle and revocation

```text
create share --> active --> DELETE /api/v1/share/results/:id --> revoked
     |                                          (owner only)
     +-- ON DELETE CASCADE from users and practice_sessions
```

Shares do not expire on a timer: the point is that a classmate can open the link
later. Revocation is explicit and keeps the same URL, so a leaked link stops working
without the sharer changing anything they already sent.
## Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/share/results` | user | Create or reuse the share for a session |
| `GET` | `/api/v1/share/results` | user | The owner's own shares plus referral counts |
| `DELETE` | `/api/v1/share/results/:id` | user | Revoke one of the owner's shares |
| `GET` | `/api/v1/share/card/:token` | public | The sanitized card |

Guests are refused (`access: 'user'`): a guest has no durable identity, so a share
attributed to one would outlive the session that made it.

The public endpoint answers **one** response for every failure -- unknown, malformed,
revoked, orphaned. A different error per case would let a caller test whether a token
ever existed. It is rate limited for the same reason, on `SHARE_RATE_LIMIT_MAX`
(default 300 per 15 minutes) rather than the sign-in budget: a classroom shares one
public address, so opening a shared link must not consume the allowance that protects
login from brute force.

## Referral attribution

Attribution is acquisition metadata: it records that a learner arrived through a
share, says nothing about what they then practised, and grants no access.

```text
recipient opens /share/<token>
  --> API sets taptalk_referral (HttpOnly, SameSite=Lax, 30 days)
      --> register / login: referral_attributions row (converted_at NULL)
          --> first recorded answer: converted_at set
```

The cookie holds only the opaque token, resolved by lookup rather than trusted.
`recordReferralAttribution` refuses revoked shares, and refuses **self-referral** --
which is what stops a token being used to manufacture fake signups. The cookie is
consumed once and cleared on sign-in, so a later unrelated login is not silently
re-attributed. A unique `(share, referred user)` index makes repeat visits idempotent.

**No `localStorage`.** The cookie is `HttpOnly`, so page scripts cannot read it and
there is no persistent client-side tracking identifier. The public page writes nothing
to storage; this is asserted in the E2E suite.

## Result image

Rendered on the client with the Canvas 2D API from the sanitized payload. No
image-generation service, no SaaS, and no new dependency: the card is a fixed set of
rounded rectangles and text, so a library would not remove any real work and the
production CSP already forbids the remote sources one would pull in.

`drawShareCard` is a pure function of its context and arguments, so unit tests
exercise it against a recording stub rather than a real canvas.

The image carries the score, percentage, direction, result type, and public URL. It
carries no username and no individual word.

## Accessibility

- The card is **text**: the ratio and percentage are real text, and a tick accompanies
  the percentage so a good score is not signalled by colour alone.
- The dialog has `role="dialog"`, `aria-modal`, and a labelled title; focus moves in on
  open, is trapped while open, and Escape closes it.
- Both the share sheet and the public page render a textual equivalent for screen
  readers.
- Every action is a real `<button>` with an accessible name and a 44px target.

## Privacy summary

| Exposed | Not exposed |
|---|---|
| Score, ratio, percentage | Username, user id, email |
| Direction, result type | Class, school, teacher |
| Public URL | Vocabulary list, per-word answers |
| Referral count (owner only) | Learning history, other statistics |

The referral count is the owner's own aggregate -- a number of signups, never who.
