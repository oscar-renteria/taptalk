# Production container deployment

Prompt 035 packages TapTalk for the selected Google Cloud Compute Engine VM topology:

```text
Internet -> Caddy (:80/:443) -> Fastify API (:3000, private Compose network)
                              -> SQLite named volume taptalk-data:/data
```

Caddy is the only public application ingress. The API port is exposed only inside the Compose network, so browser requests remain same-origin and the production origin guard, secure session cookie, CSRF policy, and disabled production CORS remain effective.

## Files

- [Deployment input checklist](deployment-input-checklist.md): collect the non-secret values, access locations, approvals, and acceptance decisions needed before automation.
- `Dockerfile`: pinned `build`, `api`, and `web` stages. The API runs as the unprivileged `node` user, listens on `0.0.0.0:3000`, uses `SIGTERM`, and has a Node-built-in `/ready` health check.
- `.dockerignore`: excludes Git state, dependencies, coverage, reports, environment files, local databases, and `database/dataset.json`.
- `compose.production.yml`: API/Caddy topology, named `taptalk-data`, `caddy-data`, and `caddy-config` volumes, API health dependency, and ports 80/443 for Caddy only.
- `deploy/Caddyfile`: HTTPS, API/health proxy routes, SPA fallback, immutable hashed-asset caching, no-store shell caching, and production security headers.
- `scripts/sqlite-maintenance.mjs`: SQLite-aware backup and verified restore operations.
- `scripts/verify-deployment-config.mjs`: daemon-independent deployment contract checks.

## VM prerequisites

Before the first deployment, provision and verify the following outside this repository:

1. A Google Cloud Compute Engine VM in a currently eligible region. Confirm the current free-tier machine type, persistent-disk quota, external-IP rules, and outbound-transfer allowance in the Google Cloud console; provider quotas can change.
2. A real DNS `A`/`AAAA` record for the production domain pointing to the VM. Caddy uses that hostname for ACME certificates.
3. A supported Debian/Ubuntu host with Docker Engine and the Compose plugin. Restrict the cloud firewall and host firewall to TCP 80/443 publicly; restrict SSH to the administrator’s source range or a bastion.
4. A persistent disk mounted on the VM for Docker volume data. The VM and its disk are not backups.
5. A production environment file at `/etc/taptalk/taptalk.env`, owned by the deployment user and mode `0600`. Do not put it in Git, an image, or a public directory.

The environment file must contain runtime values such as:

```dotenv
DOMAIN=taptalk.example
WEB_ORIGIN=https://taptalk.example
```

The environment file is read by Compose through `--env-file`; it is not copied into either image. The Compose file supplies the safe internal defaults `NODE_ENV=production`, `API_HOST=0.0.0.0`, `API_PORT=3000`, `DATABASE_PATH=/data/taptalk.db`, `TRUST_PROXY=true`, `AUTH_RATE_LIMIT_MAX=20`, `LOG_LEVEL=info`, and `SHUTDOWN_TIMEOUT_MS=10000`. Override them through the environment file when needed. There are currently no application secrets beyond the protected runtime configuration; future secrets must use the VM or GitHub deployment secret manager.

## Build and start

From a clean checkout on the VM:

```sh
# Keep the environment file outside the repository and mode 0600.
docker compose --env-file /etc/taptalk/taptalk.env -f compose.production.yml build --pull
docker compose --env-file /etc/taptalk/taptalk.env -f compose.production.yml up -d
docker compose --env-file /etc/taptalk/taptalk.env -f compose.production.yml ps
```

`WEB_ORIGIN` and `DOMAIN` are intentionally required during Compose interpolation. Pass the protected file with `--env-file` (or export the variables in the shell) when running Compose; values from that file are passed to the containers through the explicit `environment` mappings. Caddy waits for the API health check before starting its public listener.

Verify through the public origin:

```sh
curl --fail --silent --show-error https://taptalk.example/ready
curl --fail --silent --show-error https://taptalk.example/health
```

`/ready` is the deployment gate and `/health` is the liveness check. Never publish or directly test the API’s port 3000 from the host; Caddy and the API share the private Compose network.

## Backup

Back up SQLite with the API-aware `VACUUM INTO` operation rather than copying an active database file. Run it on the VM against the persistent volume, then copy the resulting file to encrypted storage outside the VM:

```sh
install -d -m 700 /var/backups/taptalk
npm run db:backup -- /var/lib/taptalk/taptalk.db /var/backups/taptalk/taptalk-$(date -u +%Y%m%dT%H%M%SZ).db
# Copy the backup to an encrypted, access-controlled off-VM destination.
```

For a running Compose deployment, obtain the host path of the named volume or run the same operation in a one-shot container with the volume mounted and the API image’s runtime/script files available. Do not copy `taptalk.db-wal` or `taptalk.db-shm` as an alternative to the SQLite-aware backup. Define retention, encryption, monitoring, and provider-side immutability in the VM operations policy.

## Restore and rollback

Restore only after stopping the API or placing the deployment in a maintenance state, and always use a verified backup:

```sh
npm run db:restore -- /var/backups/taptalk/REPLACE_ME.db /var/lib/taptalk/taptalk.db
# If replacing an existing file, review the preserved .before-restore-* file first:
npm run db:restore -- /var/backups/taptalk/REPLACE_ME.db /var/lib/taptalk/taptalk.db --force
docker compose --env-file /etc/taptalk/taptalk.env -f compose.production.yml up -d api caddy
curl --fail --silent --show-error https://taptalk.example/ready
```

The restore command runs `PRAGMA integrity_check`, copies to a temporary target, and renames atomically. With `--force`, it preserves the previous database beside the target rather than deleting it. Test restoration into a clean temporary directory before relying on it for an incident.

Migrations are forward-only. Replacing a container does not roll back a schema migration. Before a release, back up, run the new image’s migration phase, deploy, verify `/ready` and an authenticated smoke path, and use the preserved database/image pair for recovery. Prompt 036 adds immutable image tags, deployment records, and rollback automation.

## Local validation

The daemon-independent checks are:

```sh
npm run build:production
npm run test:deployment
npm run verify:deployment
npm run smoke:production
DOMAIN=taptalk.example WEB_ORIGIN=https://taptalk.example \
  docker compose --env-file /path/to/disposable.env -f compose.production.yml config --quiet
```

On a machine with Docker daemon access, also run:

```sh
docker build --target api -t taptalk-api:local .
docker build --target web -t taptalk-web:local .
docker compose --env-file /path/to/disposable.env -f compose.production.yml up -d
```

Use a disposable domain/environment and volume for local Compose tests. The current development environment used for this change has Docker CLI/Compose installed but cannot access `/var/run/docker.sock`; image builds and live Compose restart tests must therefore be run on the VM or a Docker-enabled CI/developer host before Prompt 035 is marked `DONE`.
