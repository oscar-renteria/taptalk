# Deploying TapTalk to the Google Cloud VM

A deployment runbook for an engineer or an AI agent working unattended. Every
command here has been executed against the real VM. Follow it in order and verify
each step before continuing.

This document records **no secrets**. Credentials are configured on the VM or in
GitHub, never in this repository. This repository is **public**.

## Current production deployment

| Item             | Value                                                          |
| ---------------- | -------------------------------------------------------------- |
| Hostname         | `35-209-81-212.sslip.io` (IP-derived; see "Domain" below)      |
| VM               | `taptalk`, Debian 13 (trixie), 1 vCPU, 964 MB RAM, 9.7 GB disk |
| SSH              | `rakzox@35.209.81.212:22`                                      |
| Deploy directory | `/home/rakzox/taptalk`                                         |
| Environment file | `/home/rakzox/.config/taptalk/production.env` (mode `0600`)    |
| Images           | `ghcr.io/oscar-renteria/taptalk-api`, `.../taptalk-web`        |

## Hard constraints

1. **Never build on the VM.** 1 vCPU and under 1 GB of RAM cannot run `npm ci`,
   `tsc`, and `vite build` reliably. Images are built in GitHub Actions and pulled.
2. **Never commit a secret, token, or private key** to this repository.
3. **Never commit `database/dataset.json`.** It is git- and docker-ignored on
   purpose. Vocabulary reaches production through the admin import screen.
4. **Deployments are not automatic.** `sudo` on this VM requires a password, so
   GitHub Actions cannot deploy unattended. An operator runs these commands.

## 1. Preconditions

Confirm before changing anything:

```sh
ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 \
  'cat /etc/os-release | head -2; docker --version; docker compose version'
```

Expect Debian 13 and a recent Docker. If Docker is missing, install it. On trixie
the apt repository file `/etc/apt/sources.list.d/docker.sources` **must** use
deb822 multi-line format; a single-line `deb ...` entry in a `.sources` file
breaks `apt` with `Malformed stanza`.

Google Cloud firewall must allow **TCP 443** (certificate issuance) and should
allow **TCP 80** (renewal fallback). Check under VPC network → Firewall rules.

## 2. Build and publish images

Images publish automatically on every push to `master` via
`.github/workflows/release.yml`. Confirm the run succeeded:

```sh
gh run list --workflow=release.yml --limit 1
```

Resolve the immutable digests. Prefer these over mutable tags, so a redeploy
always runs identical bytes:

```sh
for image in taptalk-api taptalk-web; do
  token=$(curl -sS "https://ghcr.io/token?scope=repository:oscar-renteria/$image:pull&service=ghcr.io" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  curl -sS -D - -o /dev/null \
    -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json' \
    "https://ghcr.io/v2/oscar-renteria/$image/manifests/master" \
    | grep -i docker-content-digest
done
```

The GHCR packages must be **public**, otherwise the VM cannot pull anonymously.
Verify with an unauthenticated manifest request: `200` means public, `401` means
private.

## 3. Write the environment file

Create the file on the VM, substituting the digests from step 2:

```sh
ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 \
  'set -e; umask 077; mkdir -p ~/.config/taptalk; cat > ~/.config/taptalk/production.env <<"EOF"
DOMAIN=35-209-81-212.sslip.io
WEB_ORIGIN=https://35-209-81-212.sslip.io
TRUST_PROXY=true
API_IMAGE=ghcr.io/oscar-renteria/taptalk-api@sha256:<API_DIGEST>
CADDY_IMAGE=ghcr.io/oscar-renteria/taptalk-web@sha256:<WEB_DIGEST>
EOF
chmod 600 ~/.config/taptalk/production.env; ls -l ~/.config/taptalk/production.env'
```

Rules that are enforced by the application, not optional:

- `WEB_ORIGIN` **must** start with `https://`. The API refuses to start
  otherwise; this is deliberate CSRF hardening. An IP is a valid host, but the
  scheme must be HTTPS.
- `WEB_ORIGIN` and `DOMAIN` must describe the same origin, with no path,
  trailing slash, wildcard, or credentials.
- `TRUST_PROXY=true` is correct because Caddy is the only reverse proxy. Without
  it, every request appears to come from Caddy and the login rate limit would
  lock out all users together.

## 4. Ship the Compose file

```sh
cd /path/to/taptalk
scp -i ~/.ssh/taptalk_deploy compose.production.yml \
  rakzox@35.209.81.212:~/taptalk/compose.production.yml
```

Validate before starting anything:

```sh
ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 \
  'cd ~/taptalk && docker compose --env-file ~/.config/taptalk/production.env \
     -f compose.production.yml config --quiet && echo VALID'
```

## 5. Deploy

```sh
ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 \
  'cd ~/taptalk && docker compose --env-file ~/.config/taptalk/production.env \
     -f compose.production.yml pull && \
   docker compose --env-file ~/.config/taptalk/production.env \
     -f compose.production.yml up -d'
```

The API must report `healthy`; Caddy waits for that health check before it
starts serving.

## 6. Verify before declaring success

Do not skip these. Each one caught a real defect during the first deployment.

```sh
# 1. Certificate is genuinely trusted by a real CA (0 = verified).
curl -sS -o /dev/null -w 'tls=%{ssl_verify_result}\n' https://35-209-81-212.sslip.io/ready

# 2. Readiness and liveness.
curl -sS https://35-209-81-212.sslip.io/ready    # {"status":"ready"}
curl -sS https://35-209-81-212.sslip.io/health   # {"status":"ok"}

# 3. The API port 3000 must NOT be reachable from outside the VM.

# 4. Security headers appear exactly once. A duplicated
#    Content-Security-Policy means browsers enforce the intersection of both.
curl -sS -D - -o /dev/null https://35-209-81-212.sslip.io/health \
  | grep -icE '^(content-security-policy|x-content-type-options)'

# 5. Secret paths are refused, not rewritten to the SPA shell.
for p in /.env /database/taptalk.db /backups/x.db; do
  printf '%s -> ' "$p"
  curl -sS -o /dev/null -w '%{http_code}\n' "https://35-209-81-212.sslip.io$p"
done
```

Expect TLS verify `0`, HTTP `200` for the two endpoints, `2` header matches, and
`404` for every secret path.

## 7. Persistence and backup

SQLite lives in the `taptalk_taptalk-data` named volume, so it survives restarts
and redeploys. Prove it rather than assume it:

```sh
ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 \
  'cd ~/taptalk && docker compose --env-file ~/.config/taptalk/production.env \
     -f compose.production.yml restart api'

ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 \
  'docker exec taptalk-api-1 node -e "
const { DatabaseSync } = require(\"node:sqlite\");
const db = new DatabaseSync(\"/data/taptalk.db\", { readOnly: true });
console.log(\"users:\", db.prepare(\"SELECT COUNT(*) c FROM users\").get().c);
console.log(\"integrity:\", db.prepare(\"PRAGMA integrity_check\").get().integrity_check);
db.close();"'
```

Backup and restore use the SQLite-aware maintenance script, never a file copy of
a live database:

```sh
ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 '
docker exec taptalk-api-1 node scripts/sqlite-maintenance.mjs backup \
  /data/taptalk.db /data/backup-$(date -u +%Y%m%dT%H%M%SZ).db
docker exec taptalk-api-1 node scripts/sqlite-maintenance.mjs restore \
  /data/backup-FILE.db /data/restored.db'
```

The VM and its disk are not backups. Copy the backup file to encrypted storage
outside the VM.

## 8. Administrators

There is no self-service path to the `administrator` role. The account registers
in the app first, then an operator promotes it:

```sh
ssh -i ~/.ssh/taptalk_deploy rakzox@35.209.81.212 \
  'docker exec taptalk-api-1 node apps/api/dist/cli/set-role.js <username> administrator'
```

The role applies on the next request; no re-login is needed. Use `user` to revoke.

## 9. Rollback

Images are digest-pinned, so rollback is a data change, not a rebuild.

1. Find the previous digest from the release run.
2. Rewrite `API_IMAGE` and `CADDY_IMAGE` in the environment file with the old
   digests.
3. `docker compose pull && docker compose up -d`.

Migrations are forward-only. Rolling back a container does **not** reverse a
schema change; if the failure involves data, restore a verified backup instead.

## Traps that cost time on the first deployment

These are real failures that happened here. Check them before debugging anything
else.

| Symptom                                                   | Cause and fix                                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` fails in CI with `E401 Unable to authenticate`   | The lockfile resolved against a private corporate registry. All `resolved` URLs must point at `registry.npmjs.org`. Leave `version` and `integrity` untouched.                                                   |
| Caddy logs `unrecognized directive: //` and restart-loops | Caddyfile comments use `#`. `//` is not a valid Caddy comment.                                                                                                                                                   |
| `/health` returns HTML and JSON parsing fails             | The SPA fallback ran before `handle @api`. The API proxy and the SPA fallback must each be their own explicit, mutually exclusive `handle` block.                                                                |
| Two `Content-Security-Policy` headers on one response     | Caddy appends headers by default. Every response header needs the `>` replace operator. Browsers enforce the _intersection_ of multiple CSP headers, so the stricter API policy silently governs the whole site. |
| Hashed assets served with `no-store`                      | A matcher-scoped `header @assets` inside the SPA `handle` block is ordered before the site-level header block. Keep it at the site level.                                                                        |
| `Malformed stanza` from `apt`                             | A single-line `deb` entry was written to a `.sources` file. That file requires deb822 multi-line format.                                                                                                         |
| API exits at startup with a `WEB_ORIGIN` error            | `WEB_ORIGIN` must be an exact `https://` origin. HTTP is refused in production by design.                                                                                                                        |
| `404 NO_VOCABULARY` when starting a session               | The database has no vocabulary yet. Import it through the admin screen. Correct behaviour, not a fault.                                                                                                          |
| `404` on `/api`, `/api/graphql`, or similar               | Not a real route. The API lives under `/api/v1/...`.                                                                                                                                                             |
| Certificate never issued                                  | The GHCR package is private, or the firewall blocks TCP 443.                                                                                                                                                     |
| `docker: command not found` after installing Docker       | The user needs a fresh login for the `docker` group.                                                                                                                                                             |
| Port 80 unreachable but HTTPS works                       | Expected if only 443 is open: Caddy used the `tls-alpn-01` challenge. Open 80 anyway for renewal fallback.                                                                                                       |

## Domain

The current hostname is IP-derived. If the VM's external IP changes, the
hostname breaks and every certificate and `WEB_ORIGIN` must be updated. Before
real users arrive, buy a domain, point an `A` record at the VM, and set both
`DOMAIN` and `WEB_ORIGIN` to it. Caddy then issues and renews certificates on its
own with no further configuration.

## Pre-deploy checklist

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run test:deployment
npm run verify:deployment
npm run build:production
npm run smoke:production   # only where the Docker daemon is reachable
```

## Related documents

- [Production container deployment](production-deployment.md): architecture and
  runtime contract
- [Deployment input checklist](deployment-input-checklist.md): the values to
  collect before automating a deployment
- [Administrator provisioning](administrator-provisioning.md): role management
