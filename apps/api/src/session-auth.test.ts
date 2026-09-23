import { describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from './database.js';
import { buildServer } from './server.js';

async function setup(options: Parameters<typeof buildServer>[1] = {}) {
  const database = openDatabase();
  const server = buildServer(database, options);
  const registration = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'learner', password: 'a-secure-password' },
  });
  return { database, server, cookie: String(registration.headers['set-cookie']).split(';')[0]! };
}

function login(server: ReturnType<typeof buildServer>, payload: unknown) {
  return server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: payload as object });
}

function me(server: ReturnType<typeof buildServer>, cookie?: string) {
  return server.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: cookie ? { cookie } : {},
  });
}

function sessionCount(database: SqliteDatabase): number {
  return Number(
    (database.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count,
  );
}

const protectedRoutes: Array<{ method: 'GET' | 'POST' | 'PUT'; url: string }> = [
  { method: 'GET', url: '/api/v1/auth/me' },
  { method: 'GET', url: '/api/v1/dashboard' },
  { method: 'GET', url: '/api/v1/settings' },
  { method: 'PUT', url: '/api/v1/settings' },
  { method: 'GET', url: '/api/v1/practice/question' },
  { method: 'POST', url: '/api/v1/practice/answer' },
  { method: 'POST', url: '/api/v1/practice/sessions' },
  { method: 'GET', url: '/api/v1/practice/sessions/any' },
  { method: 'POST', url: '/api/v1/practice/sessions/any/end' },
  { method: 'POST', url: '/api/v1/admin/vocabulary/preview' },
  { method: 'POST', url: '/api/v1/admin/vocabulary/import' },
  { method: 'GET', url: '/api/v1/admin/vocabulary/imports' },
];

describe('session protection', () => {
  it.each(protectedRoutes)('rejects $method $url without a valid session', async (route) => {
    const { server } = await setup();
    for (const cookie of [undefined, 'taptalk_session=forged-token', 'other=value']) {
      const response = await server.inject({
        method: route.method,
        url: route.url,
        headers: cookie ? { cookie } : {},
        ...(route.method === 'GET' ? {} : { payload: {} }),
      });
      expect(response.statusCode, `${cookie}`).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
    }
    await server.close();
  });

  it('marks every API response, including errors, as not cacheable', async () => {
    const { server, cookie } = await setup();
    for (const response of [
      await me(server, cookie),
      await me(server),
      await login(server, { username: 'learner', password: 'a-secure-password' }),
    ]) {
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(
      (await server.inject({ method: 'GET', url: '/health' })).headers['cache-control'],
    ).toBeUndefined();
    await server.close();
  });

  it('reports the session state with 200 whether or not someone is signed in', async () => {
    const { database, server, cookie } = await setup();
    const session = (headers: Record<string, string> = {}) =>
      server.inject({ method: 'GET', url: '/api/v1/auth/session', headers });

    const signedIn = await session({ cookie });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().user).toEqual({
      id: expect.any(String),
      username: 'learner',
      role: 'user',
      createdAt: expect.any(String),
    });
    expect(signedIn.body).not.toMatch(/password|hash/i);

    for (const response of [
      await session(),
      await session({ cookie: 'taptalk_session=forged-token' }),
    ]) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user: null });
    }

    database.prepare('UPDATE sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
    expect((await session({ cookie })).json()).toEqual({ user: null });
    expect(signedIn.headers['cache-control']).toBe('no-store');
    await server.close();
  });

  it('keeps the health check public', async () => {
    const { server } = await setup();
    expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await server.close();
  });

  it('rejects an expired session', async () => {
    const { database, server, cookie } = await setup();
    expect((await me(server, cookie)).statusCode).toBe(200);
    database.prepare('UPDATE sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
    expect((await me(server, cookie)).statusCode).toBe(401);
    await server.close();
  });

  it('removes expired sessions when a new session is created', async () => {
    const { database, server } = await setup();
    database.prepare('UPDATE sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
    await login(server, { username: 'learner', password: 'a-secure-password' });
    expect(sessionCount(database)).toBe(1);
    await server.close();
  });

  it('logout revokes only the current session and clears the cookie', async () => {
    const { server, cookie } = await setup();
    const second = await login(server, { username: 'learner', password: 'a-secure-password' });
    const secondCookie = String(second.headers['set-cookie']).split(';')[0]!;

    const logout = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await me(server, cookie)).statusCode).toBe(401);
    expect((await me(server, secondCookie)).statusCode).toBe(200);

    const anonymousLogout = await server.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(anonymousLogout.statusCode).toBe(204);
    await server.close();
  });

  it('answers unknown usernames and wrong passwords identically', async () => {
    const { server } = await setup();
    const unknown = await login(server, { username: 'nobody', password: 'a-secure-password' });
    const wrong = await login(server, { username: 'learner', password: 'wrong-password' });
    const oversized = await login(server, { username: 'learner', password: 'x'.repeat(10_000) });
    const missing = await server.inject({ method: 'POST', url: '/api/v1/auth/login' });

    for (const response of [unknown, wrong, oversized, missing]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'INVALID_LOGIN', message: 'Username or password is invalid.' },
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    await server.close();
  });

  it('issues HttpOnly cookies and adds Secure when configured for production', async () => {
    const { server } = await setup({ secureCookies: true });
    const response = await login(server, { username: 'LEARNER', password: 'a-secure-password' });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/; Secure$/);
    expect(cookie).toMatch(/Max-Age=1209600/);
    await server.close();
  });
});
