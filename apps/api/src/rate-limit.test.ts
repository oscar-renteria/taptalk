import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

describe('rate limiter', () => {
  it('allows up to the limit per key and window, then reports the retry delay', () => {
    let time = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 10_000 }, () => time);
    expect(limiter.check('a')).toEqual({ allowed: true });
    expect(limiter.check('a')).toEqual({ allowed: true });
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 10 });
    expect(limiter.check('b')).toEqual({ allowed: true });

    time = 9_500;
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    time = 10_000;
    expect(limiter.check('a')).toEqual({ allowed: true });
  });
});
