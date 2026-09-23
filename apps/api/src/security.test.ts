import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { isOriginAllowed, parseAllowedOrigins } from './security.js';
import { assertProductionConfiguration, buildServer, parseTrustProxy } from './server.js';

const credentials = { username: 'learner', password: 'a-secure-password' };

async function registered(options: Parameters<typeof buildServer>[1] = {}) {
  const database = openDatabase();
  const server = buildServer(database, options);
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: credentials,
  });
  return { database, server, cookie: String(response.headers['set-cookie']).split(';')[0]! };
}

describe('security headers', () => {
  it('sends hardening headers on API, error, and not-found responses', async () => {
    const { server, cookie } = await registered();
    for (const response of [
      await server.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } }),
      await server.inject({ method: 'GET', url: '/api/v1/dashboard' }),
      await server.inject({ method: 'GET', url: '/health' }),
      await server.inject({ method: 'GET', url: '/api/v1/unknown' }),
    ]) {
      expect(response.headers).toMatchObject({
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin',
      });
    }
    await server.close();
  });

  it('answers unknown routes in the standard error shape without framework details', async () => {
    const { server } = await registered();
    const response = await server.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'This resource does not exist.' },
    });
    await server.close();
  });
});

describe('cross-site request forgery defences', () => {
  it.each([
    [undefined, 'localhost:80', [], true],
    ['http://localhost:80', 'localhost:80', [], true],
    ['https://evil.example', 'localhost:80', [], false],
    ['null', 'localhost:80', [], false],
    ['not a url', 'localhost:80', [], false],
    ['https://taptalk.example', 'api.internal:3000', ['https://taptalk.example'], true],
    ['https://taptalk.example/', 'api.internal:3000', ['https://taptalk.example'], true],
    ['https://evil.example', 'api.internal:3000', ['https://taptalk.example'], false],
  ] as const)('origin %s to host %s (allowed %j) → %s', (origin, host, allowed, expected) => {
    expect(isOriginAllowed(origin, host, [...allowed])).toBe(expected);
  });

  it('parses the configured origin list', () => {
    expect(parseAllowedOrigins(' https://a.example/, https://b.example ,')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it('rejects state-changing requests from a foreign origin but allows reads', async () => {
    const { server, cookie } = await registered({ allowedOrigins: ['https://taptalk.example'] });
    const foreign = { cookie, origin: 'https://evil.example' };
    for (const request of [
      { method: 'POST', url: '/api/v1/auth/logout' },
      { method: 'PUT', url: '/api/v1/settings' },
      { method: 'POST', url: '/api/v1/practice/sessions' },
    ] as const) {
      const response = await server.inject({ ...request, headers: foreign, payload: {} });
      expect(response.statusCode, request.url).toBe(403);
      expect(response.json().error.code).toBe('CROSS_ORIGIN_REJECTED');
    }
    const read = await server.inject({ method: 'GET', url: '/api/v1/auth/me', headers: foreign });
    expect(read.statusCode).toBe(200);
    const own = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: 'https://taptalk.example' },
    });
    expect(own.statusCode).toBe(204);
    await server.close();
  });

  it('refuses form-style bodies that HTML forms can send cross-site', async () => {
    const { server, cookie } = await registered();
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/settings',
        headers: { cookie, 'content-type': contentType },
        payload: 'direction=german-to-english',
      });
      expect(response.statusCode, contentType).toBe(415);
      expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
    await server.close();
  });
});

describe('input limits', () => {
  it('limits request bodies to 64 KB, except vocabulary imports', async () => {
    const { database, server, cookie } = await registered();
    const tooLarge = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'learner', password: 'x'.repeat(70 * 1024) },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe('PAYLOAD_TOO_LARGE');

    database.prepare("UPDATE users SET role = 'administrator'").run();
    const records = Array.from({ length: 4000 }, (_, index) => ({
      english: `word number ${index}`,
      german: `Wort Nummer ${index}`,
    }));
    const largeImport = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/preview',
      headers: { cookie },
      payload: { content: JSON.stringify(records) },
    });
    expect(JSON.stringify(records).length).toBeGreaterThan(100 * 1024);
    expect(largeImport.statusCode).toBe(200);
    await server.close();
  });

  it('rejects oversized answers and file names and ignores a client-supplied prompt', async () => {
    const { database, server, cookie } = await registered();
    database.prepare("UPDATE users SET role = 'administrator'").run();
    const longName = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/import',
      headers: { cookie },
      payload: {
        content: '[{"english":"tree","german":"Baum"}]',
        confirm: true,
        sourceName: 'x'.repeat(201),
      },
    });
    expect(longName.statusCode).toBe(400);
    expect(longName.json().error.code).toBe('INVALID_SOURCE_NAME');
    await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/import',
      headers: { cookie },
      payload: { content: '[{"english":"tree","german":"Baum"}]', confirm: true },
    });
    const entryId = (database.prepare('SELECT id FROM vocabulary_entries').get() as { id: string })
      .id;
    const answer = (submittedAnswer: string) =>
      server.inject({
        method: 'POST',
        url: '/api/v1/practice/answer',
        headers: { cookie },
        payload: {
          vocabularyEntryId: entryId,
          direction: 'english-to-german',
          prompt: '<script>forged</script>',
          submittedAnswer,
        },
      });

    const tooLong = await answer('x'.repeat(501));
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.code).toBe('ANSWER_TOO_LONG');
    expect((await answer('Baum')).json().result.correct).toBe(true);
    expect(database.prepare('SELECT prompt FROM learning_attempts').all()).toEqual([
      { prompt: 'tree' },
    ]);
    await server.close();
  });

  it('answers requests without a body with a client error instead of crashing', async () => {
    const { server, cookie } = await registered();
    for (const url of ['/api/v1/practice/answer', '/api/v1/auth/login']) {
      const response = await server.inject({ method: 'POST', url, headers: { cookie } });
      expect(response.statusCode, url).toBeLessThan(500);
    }
    await server.close();
  });
});

describe('sensitive data in logs', () => {
  it('never logs passwords, session tokens, or cookies', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const { server, cookie } = await registered({ logStream });
    const token = cookie.split('=')[1]!;
    await server.inject({ method: 'POST', url: '/api/v1/auth/login', payload: credentials });
    await server.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'learner', password: 'wrong-but-secret' },
    });
    await server.close();

    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(3);
    for (const secret of [credentials.password, 'wrong-but-secret', token, 'scrypt$']) {
      expect(log).not.toContain(secret);
    }
  });
});

describe('deployment safety', () => {
  it('rate-limits per real client behind a trusted proxy, not per proxy address', async () => {
    const server = buildServer(openDatabase(), {
      trustProxy: true,
      authRateLimit: { max: 1, windowMs: 60_000 },
    });
    const attempt = (client: string) =>
      server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '10.0.0.1', // the reverse proxy
        headers: { 'x-forwarded-for': client },
        payload: { username: 'nobody', password: 'wrong-password' },
      });
    expect((await attempt('203.0.113.1')).statusCode).toBe(401);
    expect((await attempt('203.0.113.2')).statusCode).toBe(401);
    expect((await attempt('203.0.113.1')).statusCode).toBe(429);
    await server.close();
  });

  it.each([
    [undefined, false],
    ['false', false],
    ['true', true],
    [' 10.0.0.1, 10.0.0.0/8 ', ['10.0.0.1', '10.0.0.0/8']],
  ])('parses TRUST_PROXY=%s', (value, expected) => {
    expect(parseTrustProxy(value)).toEqual(expected);
  });

  it('refuses to start in production without a persistent database', () => {
    expect(() => assertProductionConfiguration({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_PATH',
    );
    expect(() =>
      assertProductionConfiguration({ NODE_ENV: 'production', DATABASE_PATH: ':memory:' }),
    ).toThrow();
    expect(() =>
      assertProductionConfiguration({ NODE_ENV: 'production', DATABASE_PATH: '/data/taptalk.db' }),
    ).not.toThrow();
    expect(() => assertProductionConfiguration({ NODE_ENV: 'development' })).not.toThrow();
  });
});
