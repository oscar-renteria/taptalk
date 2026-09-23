import { describe, expect, it } from 'vitest';
import { authorize, routeAccess, type AuthenticatedUser } from './auth.js';
import { openDatabase } from './database.js';
import { setUserRole } from './repositories.js';
import { buildServer } from './server.js';

const learner: AuthenticatedUser = {
  id: 'u1',
  username: 'learner',
  role: 'user',
  createdAt: '2026-09-23T00:00:00.000Z',
};
const admin: AuthenticatedUser = { ...learner, id: 'a1', username: 'admin', role: 'administrator' };

describe('authorization policy', () => {
  it.each([
    [null, 'public', 'allowed'],
    [null, 'user', 'unauthenticated'],
    [null, 'administrator', 'unauthenticated'],
    [learner, 'user', 'allowed'],
    [learner, 'administrator', 'forbidden'],
    [admin, 'user', 'allowed'],
    [admin, 'administrator', 'allowed'],
  ] as const)('authorize(%j, %s) is %s', (user, access, decision) => {
    expect(authorize(user, access)).toBe(decision);
  });

  it('derives route access with deny-by-default and non-downgradable admin routes', () => {
    expect(routeAccess('/health', undefined)).toBe('public');
    expect(routeAccess(undefined, undefined)).toBe('public');
    expect(routeAccess('/api/v1/dashboard', undefined)).toBe('user');
    expect(routeAccess('/api/v1/auth/login', 'public')).toBe('public');
    expect(routeAccess('/api/v1/admin/vocabulary/imports', undefined)).toBe('administrator');
    expect(routeAccess('/api/v1/admin/vocabulary/imports', 'public')).toBe('administrator');
  });
});

describe('administrator operations over HTTP', () => {
  const adminRoutes = [
    { method: 'POST', url: '/api/v1/admin/vocabulary/preview' },
    { method: 'POST', url: '/api/v1/admin/vocabulary/import' },
    { method: 'GET', url: '/api/v1/admin/vocabulary/imports' },
  ] as const;
  const payload = { content: '[{"english":"tree","german":"Baum"}]', confirm: true };

  it('rejects regular users on every administrator route without side effects', async () => {
    const database = openDatabase();
    const server = buildServer(database);
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'learner', password: 'a-secure-password' },
    });
    const cookie = String(registration.headers['set-cookie']);

    for (const route of adminRoutes) {
      const response = await server.inject({
        ...route,
        headers: { cookie },
        ...(route.method === 'POST' ? { payload } : {}),
      });
      expect(response.statusCode, route.url).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
    expect(database.prepare('SELECT COUNT(*) AS count FROM vocabulary_entries').get()).toEqual({
      count: 0,
    });
    await server.close();
  });

  it('applies promotion and demotion on the next request without a new login', async () => {
    const database = openDatabase();
    const server = buildServer(database);
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'operator', password: 'a-secure-password' },
    });
    const cookie = String(registration.headers['set-cookie']);
    const history = () =>
      server.inject({
        method: 'GET',
        url: '/api/v1/admin/vocabulary/imports',
        headers: { cookie },
      });

    expect((await history()).statusCode).toBe(403);
    setUserRole(database, 'operator', 'administrator', '2026-09-23T00:00:00.000Z');
    expect((await history()).statusCode).toBe(200);
    setUserRole(database, 'operator', 'user', '2026-09-23T00:00:00.000Z');
    expect((await history()).statusCode).toBe(403);
    await server.close();
  });

  it('cannot be granted through the API: registration always creates a regular user', async () => {
    const server = buildServer(openDatabase());
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'sneaky', password: 'a-secure-password', role: 'administrator' },
    });
    expect(registration.json().user.role).toBe('user');
    await server.close();
  });
});
