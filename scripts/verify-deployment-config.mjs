import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function verifyDeploymentConfig() {
  const read = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');
  const required = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const dockerfile = read('Dockerfile');
  const compose = read('compose.production.yml');
  const caddyfile = read('deploy/Caddyfile');
  const dockerignore = read('.dockerignore');

  required(
    dockerfile.includes(
      'FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS build',
    ),
    'Pinned Node build stage is missing.',
  );
  required(
    dockerfile.includes(
      'FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS api',
    ),
    'Pinned Node API stage is missing.',
  );
  required(
    dockerfile.includes(
      'FROM caddy:2.10.0-alpine@sha256:ae4458638da8e1a91aafffb231c5f8778e964bca650c8a8cb23a7e8ac557aa3c AS web',
    ),
    'Pinned Caddy web stage is missing.',
  );
  required(dockerfile.includes('USER node'), 'API image must run as the node user.');
  required(dockerfile.includes('STOPSIGNAL SIGTERM'), 'API image must stop on SIGTERM.');
  required(dockerfile.includes('/ready'), 'API image must health-check /ready.');
  required(dockerfile.includes('apps/api/dist'), 'API image must copy compiled API output.');
  required(dockerfile.includes('packages/shared/dist'), 'API image must copy shared output.');
  required(
    dockerfile.includes('scripts/sqlite-maintenance.mjs'),
    'API image must include the SQLite maintenance script.',
  );
  required(
    read('package.json').includes('"smoke:production"'),
    'Root package must expose the production stack smoke command.',
  );

  for (const entry of [
    'node_modules',
    '.git',
    '.env',
    'coverage',
    'database/dataset.json',
    '*.log',
  ]) {
    required(dockerignore.split('\n').includes(entry), `.dockerignore must include ${entry}.`);
  }

  const apiStart = compose.indexOf('  api:');
  const caddyStart = compose.indexOf('  caddy:');
  const volumesStart = compose.indexOf('\nvolumes:');
  required(
    apiStart >= 0 && caddyStart > apiStart && volumesStart > caddyStart,
    'Compose service sections are incomplete.',
  );
  const apiSection = compose.slice(apiStart, caddyStart);
  const caddySection = compose.slice(caddyStart, volumesStart);
  required(apiSection.includes('taptalk-data:/data'), 'API must mount the named SQLite volume.');
  required(apiSection.includes('expose:'), 'API must expose its internal port.');
  required(!apiSection.includes('ports:'), 'API must not publish a host port.');
  required(
    caddySection.includes('depends_on:') && caddySection.includes('condition: service_healthy'),
    'Caddy must wait for API readiness.',
  );
  required(
    caddySection.includes('CADDY_HTTP_PORT:-80}:80') &&
      caddySection.includes('CADDY_HTTPS_PORT:-443}:443'),
    'Caddy must publish configurable ports 80 and 443.',
  );
  required(
    compose.includes('taptalk-data:') &&
      compose.includes('caddy-data:') &&
      compose.includes('caddy-config:'),
    'Named volumes are incomplete.',
  );

  for (const route of [
    '/api /api/* /health /ready',
    'reverse_proxy api:3000',
    'try_files {path} /index.html',
    'file_server',
  ]) {
    required(caddyfile.includes(route), `Caddyfile is missing ${route}.`);
  }

  // The API matcher and the SPA fallback must both live inside explicit
  // `handle` blocks. Loose top-level `try_files`/`file_server` directives are
  // ordered before `handle`, so they serve index.html for /health and /ready
  // instead of proxying the API. Assert the block structure, not just presence.
  const apiHandle = caddyfile.match(/handle @api \{([\s\S]*?)\n\t\}/);
  required(apiHandle, 'Caddyfile must wrap the API proxy in a `handle @api` block.');
  required(
    apiHandle[1].includes('reverse_proxy api:3000'),
    '`handle @api` must contain the API reverse proxy.',
  );
  const spaHandle = caddyfile.match(/\n\thandle \{([\s\S]*?)\n\t\}/);
  required(spaHandle, 'Caddyfile must wrap the SPA fallback in a `handle` block.');
  required(
    spaHandle[1].includes('try_files {path} /index.html') && spaHandle[1].includes('file_server'),
    'The SPA `handle` block must contain the fallback and file server.',
  );
  required(
    !spaHandle[1].includes('reverse_proxy') && !spaHandle[1].includes('@api'),
    'The SPA `handle` block must not proxy API traffic.',
  );
  const apiHandlerIndex = caddyfile.indexOf('handle @api {');
  const spaHandlerIndex = caddyfile.indexOf('\n\thandle {');
  required(
    apiHandlerIndex >= 0 && spaHandlerIndex > apiHandlerIndex,
    '`handle @api` must be declared before the SPA `handle` block.',
  );

  // A matcher-scoped `header @assets` placed inside the SPA `handle` block is
  // ordered before the site-level header block, so the site-level `no-store`
  // overwrites it and hashed assets lose immutable caching. It must be at the
  // site level, ahead of the handles.
  const assetsHeaderIndex = caddyfile.indexOf(
    'header @assets >Cache-Control "public, max-age=31536000, immutable"',
  );
  required(
    assetsHeaderIndex >= 0 && assetsHeaderIndex < apiHandlerIndex,
    'The immutable asset cache header must be set at the site level, before `handle @api`.',
  );
  required(
    !spaHandle[1].includes('@assets'),
    'The immutable asset cache header must not live inside the SPA `handle` block.',
  );

  // The SPA fallback rewrites every unmatched path to index.html, so secret
  // paths need a dedicated top-level handle that answers 404 before the
  // fallback can turn them into a 200 HTML response.
  const privateHandle = caddyfile.match(/handle @private \{([\s\S]*?)\n\t\}/);
  required(
    privateHandle && privateHandle[1].includes('respond 404'),
    'Caddyfile must answer 404 for private paths via a `handle @private` block.',
  );
  required(caddyfile.includes('@private path /.env*'), 'Caddyfile must block .env paths.');
  required(
    caddyfile.includes('/database/*') && caddyfile.includes('/backups/*'),
    'Caddyfile must block the database and backup directories.',
  );

  // Caddyfile comments start with `#`. A `//` comment is silently accepted by
  // the daemon-independent checks but makes Caddy refuse to load the config.
  for (const [index, line] of caddyfile.split('\n').entries()) {
    required(
      !/^\s*\/\//.test(line),
      `Caddyfile line ${index + 1} uses a \`//\` comment, which Caddy cannot parse. Use \`#\`.`,
    );
  }
  for (const header of [
    'Strict-Transport-Security',
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ]) {
    required(caddyfile.includes(header), `Caddyfile is missing ${header}.`);
  }
  required(
    caddyfile.includes('>Cache-Control "public, max-age=31536000, immutable"'),
    'Hashed assets are not immutable, or the header is not set with the `>` replace operator.',
  );

  // Caddy appends response headers by default, so a proxied API response that
  // already sets these headers would carry two values. Browsers enforce the
  // intersection of multiple CSP headers, so duplicates silently produce the
  // stricter (API) policy. Every security header must use the `>` operator.
  for (const field of [
    'Cache-Control',
    'Content-Security-Policy',
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Resource-Policy',
    'Permissions-Policy',
    'Referrer-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ]) {
    required(
      caddyfile.includes(`\t\t>${field} `),
      `Caddyfile must set ${field} with the \`>\` replace operator to avoid duplicate headers.`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyDeploymentConfig();
  console.log('Deployment configuration verified.');
}
