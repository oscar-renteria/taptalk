import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const composeFile = join(repositoryRoot, 'compose.production.yml');
const project = `taptalk-smoke-${process.pid}-${Date.now()}`;
const environmentDirectory = mkdtempSync(join(tmpdir(), 'taptalk-production-smoke-'));
const environmentFile = join(environmentDirectory, 'production.env');
let composeStarted = false;

function dockerCompose(arguments_, { allowFailure = false } = {}) {
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', environmentFile, '-f', composeFile, '-p', project, ...arguments_],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `docker compose ${arguments_.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function checkDockerAvailable() {
  const result = spawnSync('docker', ['info'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `Docker daemon is required for the production smoke test.\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate a smoke-test port.')));
        return;
      }
      const port = address.port;
      probe.close(() => resolvePort(port));
    });
  });
}

function request(url, { method = 'GET', headers = {}, body } = {}) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolveRequest, reject) => {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders['content-length'] = Buffer.byteLength(body).toString();
    const outgoing = transport(
      target,
      { method, headers: requestHeaders, rejectUnauthorized: false },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolveRequest({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    outgoing.once('error', reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

async function waitForReady(origin, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await request(`${origin}/ready`);
      if (response.status === 200) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((wait) => setTimeout(wait, 500));
  }
  const status = dockerCompose(['ps'], { allowFailure: true });
  const logs = dockerCompose(['logs', '--no-color'], { allowFailure: true });
  throw new Error(`Timed out waiting for /ready (${lastError}).\n${status.stdout}\n${logs.stdout}`);
}

async function main() {
  checkDockerAvailable();
  const httpPort = await availablePort();
  const httpsPort = await availablePort();
  const origin = `https://localhost:${httpsPort}`;
  const username = `smoke_${Date.now()}`;
  const password = 'Sm0ke!River7#2026';
  writeFileSync(
    environmentFile,
    [
      'DOMAIN=localhost',
      `WEB_ORIGIN=${origin}`,
      `CADDY_HTTP_PORT=${httpPort}`,
      `CADDY_HTTPS_PORT=${httpsPort}`,
      `API_IMAGE=${project}-api`,
      `CADDY_IMAGE=${project}-web`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );

  dockerCompose(['config', '--quiet']);
  dockerCompose(['build', '--pull', 'api', 'caddy']);
  composeStarted = true;
  dockerCompose(['up', '-d']);
  await waitForReady(origin);

  const health = await request(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
  assert.match(String(health.headers['strict-transport-security']), /max-age=31536000/);
  assert.match(String(health.headers['content-security-policy']), /default-src 'self'/);
  assert.equal(health.headers['x-content-type-options'], 'nosniff');

  const page = await request(`${origin}/practice`);
  assert.equal(page.status, 200);
  assert.match(page.body, /id="app"/);
  const assetPath = page.body.match(/(?:src|href)="(\/assets\/[^"?]+\.js)"/)?.[1];
  assert.ok(assetPath, 'The built page must reference a hashed JavaScript asset.');
  const asset = await request(`${origin}${assetPath}`);
  assert.equal(asset.status, 200);
  assert.match(String(asset.headers['cache-control']), /immutable/);

  const registration = await request(`${origin}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(registration.status, 201, registration.body);
  const cookie = String(registration.headers['set-cookie']).split(';')[0];
  assert.match(cookie, /^taptalk_session=/);
  const beforeRestart = await request(`${origin}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(beforeRestart.status, 200, beforeRestart.body);

  dockerCompose(['restart', 'api']);
  await waitForReady(origin);
  const afterRestart = await request(`${origin}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(afterRestart.status, 200, afterRestart.body);
  assert.equal(JSON.parse(afterRestart.body).user.username, username);

  dockerCompose([
    'exec',
    '-T',
    'api',
    'node',
    'scripts/sqlite-maintenance.mjs',
    'backup',
    '/data/taptalk.db',
    '/data/smoke-backup.db',
  ]);
  dockerCompose([
    'exec',
    '-T',
    'api',
    'node',
    'scripts/sqlite-maintenance.mjs',
    'restore',
    '/data/smoke-backup.db',
    '/data/smoke-restored.db',
  ]);
  const restored = dockerCompose([
    'exec',
    '-T',
    'api',
    'node',
    '--input-type=module',
    '-e',
    "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/data/smoke-restored.db', { readOnly: true }); if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') process.exit(1); if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count < 1) process.exit(1); db.close();",
  ]);
  assert.equal(restored.status, 0);

  const logs = dockerCompose(['logs', '--no-color', 'api']);
  assert.match(logs.stdout, /shutdown requested/);
  assert.match(logs.stdout, /shutdown complete/);

  const volumes = spawnSync(
    'docker',
    [
      'volume',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.Name}}',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(volumes.status, 0, volumes.stderr);
  for (const suffix of ['taptalk-data', 'caddy-data', 'caddy-config']) {
    assert.match(volumes.stdout, new RegExp(`${project}_${suffix}`));
  }

  const httpRedirect = await request(`http://localhost:${httpPort}/ready`);
  assert.ok([301, 302, 307, 308].includes(httpRedirect.status));
  const redirectLocation = new URL(String(httpRedirect.headers.location), origin);
  assert.equal(redirectLocation.protocol, 'https:');
  assert.equal(redirectLocation.hostname, 'localhost');
  assert.equal(redirectLocation.pathname, '/ready');
  console.log(`Production Compose smoke passed for ${project}.`);
}

try {
  await main();
} finally {
  if (composeStarted)
    dockerCompose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
  rmSync(environmentDirectory, { recursive: true, force: true });
}
