import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from './auth.js';
import { openDatabase } from './database.js';
import { buildServer } from './server.js';

function legacyHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

describe('password hashing', () => {
  it('stores OWASP-strength scrypt parameters and a unique salt per hash', async () => {
    const [first, second] = await Promise.all([
      hashPassword('secret-pw'),
      hashPassword('secret-pw'),
    ]);
    expect(first).toMatch(/^scrypt\$16384\$8\$5\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('secret-pw', first)).toBe(true);
    expect(await verifyPassword('wrong-pw', first)).toBe(false);
    expect(needsRehash(first)).toBe(false);
  });

  it('still verifies legacy hashes and marks them for upgrade', async () => {
    const legacy = legacyHash('secret-pw');
    expect(await verifyPassword('secret-pw', legacy)).toBe(true);
    expect(await verifyPassword('wrong-pw', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash('scrypt$1024$8$1$aa$bb')).toBe(true);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    for (const stored of ['', 'garbage', 'scrypt$x$8$5$aa$bb']) {
      expect(await verifyPassword('secret-pw', stored)).toBe(false);
    }
  });

  it('upgrades a legacy hash on the next successful login', async () => {
    const database = openDatabase();
    const now = '2026-09-23T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
         VALUES ('u1', 'veteran', ?, 'user', ?, ?)`,
      )
      .run(legacyHash('a-secure-password'), now, now);
    const server = buildServer(database);
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'veteran', password: 'a-secure-password' },
    });
    expect(login.statusCode).toBe(200);
    const { hash } = database
      .prepare("SELECT password_hash AS hash FROM users WHERE id = 'u1'")
      .get() as {
      hash: string;
    };
    expect(hash.startsWith('scrypt$16384$8$5$')).toBe(true);
    expect(await verifyPassword('a-secure-password', hash)).toBe(true);
    await server.close();
  });
});
