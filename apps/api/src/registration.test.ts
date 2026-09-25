import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { buildServer } from './server.js';

function register(server: ReturnType<typeof buildServer>, payload: unknown) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: payload as object,
  });
}

describe('account registration', () => {
  it('creates an account, starts a session, and never stores or returns the plaintext password', async () => {
    const database = openDatabase();
    const server = buildServer(database);
    const response = await register(server, {
      username: ' learner ',
      password: 'a-secure-password',
    });

    expect(response.statusCode).toBe(201);
    expect(String(response.headers['set-cookie'])).toMatch(/taptalk_session=.+; Path=\/; HttpOnly/);
    expect(response.json().user).toEqual({
      id: expect.any(String),
      username: 'learner',
      role: 'user',
      createdAt: expect.any(String),
    });
    expect(response.body).not.toContain('a-secure-password');
    const stored = database.prepare('SELECT password_hash AS hash FROM users').get() as {
      hash: string;
    };
    expect(stored.hash).not.toContain('a-secure-password');
    expect(stored.hash).toMatch(/^scrypt\$16384\$8\$5\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(database.prepare('SELECT COUNT(*) AS count FROM user_preferences').get()).toEqual({
      count: 1,
    });
    await server.close();
  });

  it('rejects a duplicate username case-insensitively without creating a second account', async () => {
    const database = openDatabase();
    const server = buildServer(database);
    await register(server, { username: 'learner', password: 'a-secure-password' });
    const duplicate = await register(server, { username: 'LEARNER', password: 'another-password' });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('USERNAME_UNAVAILABLE');
    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
    await server.close();
  });

  it.each([
    [{}, 'username'],
    [{ username: 42, password: ['x'] }, 'username'],
    [{ username: 'a', password: 'a-secure-password' }, 'username'],
    [{ username: 'learner', password: 'short' }, 'password'],
    [{ username: 'learner', password: 'password' }, 'password'],
    [{ username: 'learner', password: 'learner-2026' }, 'password'],
    [{ username: 'learner', password: 'x'.repeat(129) }, 'password'],
  ])('rejects invalid or weak credentials %j with field details', async (payload, field) => {
    const server = buildServer(openDatabase());
    const response = await register(server, payload);

    expect(response.statusCode).toBe(400);
    const { error } = response.json();
    expect(error.code).toBe('INVALID_REGISTRATION');
    expect(error.details.some((detail: { field: string }) => detail.field === field)).toBe(true);
    const password = (payload as { password?: unknown }).password;
    // "password" itself is also a field name, so only distinctive values are checked for echoes.
    if (typeof password === 'string' && password !== 'password') {
      expect(response.body).not.toContain(password);
    }
    await server.close();
  });

  it('maps a database failure to a safe error and leaves no partial account', async () => {
    const database = openDatabase();
    database.exec('DROP TABLE user_preferences');
    const server = buildServer(database);
    const response = await register(server, { username: 'learner', password: 'a-secure-password' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' },
    });
    expect(response.body).not.toMatch(/user_preferences|SQL|table/i);
    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
    await server.close();
  });

  it('rate-limits repeated registration and login attempts per client', async () => {
    const server = buildServer(openDatabase(), { authRateLimit: { max: 2, windowMs: 60_000 } });
    await register(server, { username: 'first', password: 'a-secure-password' });
    await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'first', password: 'wrong-password' },
    });
    const limited = await register(server, { username: 'second', password: 'a-secure-password' });

    expect(limited.statusCode).toBe(429);
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    await server.close();
  });

  it('answers malformed JSON with a safe client error', async () => {
    const server = buildServer(openDatabase());
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"username":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'The request is invalid.' },
    });
    await server.close();
  });
});
