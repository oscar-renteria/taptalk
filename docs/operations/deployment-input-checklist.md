# Automated deployment input checklist

Use this checklist to hand off the values and access needed for automatic
GitHub Actions → GHCR → Google Cloud VM deployment.

> **Never put passwords, private keys, API tokens, cloud credentials, SSH keys,
> or production data in this file, in Git, in an issue, or in chat.** Put secret
> values in GitHub Environment Secrets, the VM environment file, or an approved
> secret manager. This document records only names, locations, and non-secret
> configuration values.

Status convention: `[ ]` not supplied, `[x]` supplied and verified, and `N/A`
only with a reason. Do not begin production automation until all **Required**
items are checked.

## 1. Minimum values needed to start automation

These are the minimum useful non-secret handoff values. Secret values must be
configured in their destination rather than sent with this checklist.

- [ ] GitHub repository URL: `____________________________`
- [ ] GitHub owner/repository: `____________________________`
- [ ] Default/release branch: `____________________________`
- [ ] VM public IP or stable hostname: `____________________________`
- [ ] VM SSH username and port: `____________________________`
- [ ] Production domain: `____________________________`
- [ ] DNS provider and zone: `____________________________`
- [ ] GCP project ID and VM region/zone: `____________________________`
- [ ] Deployment method: `SSH + Docker Compose` / `GCP-native` (choose one)
- [ ] GitHub production environment name: `____________________________`
- [ ] Backup destination and retention decision: `____________________________`
- [ ] Production approval owner: `____________________________`

## 2. GitHub repository and release controls

### Repository identity

- [ ] GitHub repository URL (HTTPS and SSH clone URLs recorded)
- [ ] Owner and repository name match the intended GHCR namespace
- [ ] Repository visibility and access policy confirmed
- [ ] Default branch is known and normalized
- [ ] Release branch or tag policy is documented
- [ ] Required reviewers and branch-protection policy are identified
- [ ] Repository has no uncommitted deployment-only files

### GitHub Actions permissions

- [ ] Actions are enabled
- [ ] Workflow identity can read repository contents
- [ ] Workflow identity can publish the selected GHCR packages
- [ ] Workflow identity can create/update the selected GitHub Environment
- [ ] Workflow identity can use the selected deployment secret store
- [ ] Required status checks are identified
- [ ] Deployment concurrency rules are agreed (normally one production deploy
      at a time)
- [ ] Hosted GitHub runners are approved for build/validation jobs
- [ ] No self-hosted runner is placed on the production VM without a separate
      security review

### Release identity

- [ ] GHCR API image: `ghcr.io/________________/taptalk-api`
- [ ] GHCR web image: `ghcr.io/________________/taptalk-web`
- [ ] Image naming and immutable commit-SHA tags are agreed
- [ ] Release trigger is selected: tag / manual approval / other
- [ ] Version/tag format is selected (for example, `v0.1.0`)
- [ ] Production approval environment and reviewers are named
- [ ] Rollback window and previous-image retention period are agreed

## 3. Google Cloud VM and host access

### VM identity

- [ ] Cloud provider confirmed: Google Cloud Compute Engine
- [ ] GCP project ID: `____________________________`
- [ ] Region: `____________________________`
- [ ] Zone (if applicable): `____________________________`
- [ ] Instance/VM name: `____________________________`
- [ ] Machine type and current free-tier/quota eligibility verified
- [ ] OS image and version recorded: `____________________________`
- [ ] External IP or stable DNS name: `____________________________`
- [ ] Static-IP requirement decided
- [ ] Outbound access required for GHCR, ACME, and updates confirmed

### Host bootstrap

- [ ] Docker Engine installed and version recorded
- [ ] Docker Compose plugin installed and version recorded
- [ ] Dedicated deployment user created
- [ ] Deployment user can run the approved deployment commands
- [ ] Root login disabled, or an exception explicitly approved
- [ ] SSH restricted to the administrator source range or bastion
- [ ] Host firewall allows TCP 80 and 443
- [ ] Host firewall does not expose API port 3000
- [ ] Host timezone, NTP synchronization, and patching policy set
- [ ] Disk encryption and disk-usage alerts enabled where required

### Deployment account

- [ ] SSH username: `____________________________`
- [ ] SSH port: `22` / `____________________________`
- [ ] Authentication method: deploy key / workload identity / other
- [ ] SSH host-key fingerprint recorded for `known_hosts` pinning
- [ ] Deployment directory on the VM: `____________________________`
- [ ] Deployment user can read the Compose file and protected environment file
- [ ] Deployment user cannot read unrelated user data or credentials
- [ ] Required `sudo` commands are minimized and documented

## 4. Domain, DNS, and HTTPS

- [ ] Production domain: `____________________________`
- [ ] DNS provider: `____________________________`
- [ ] DNS zone/zone ID: `____________________________`
- [ ] A record points to the VM IP/hostname
- [ ] AAAA record decision recorded (or explicitly omitted)
- [ ] DNS TTL is acceptable for the planned failover/rollback process
- [ ] Ports 80 and 443 are reachable from the public Internet
- [ ] Port 80 is allowed for ACME HTTP-01 challenges
- [ ] Port 443 is allowed for HTTPS
- [ ] ACME/contact email recorded in the secret/config destination
- [ ] Existing CAA records, if any, documented
- [ ] Staging domain, if used: `____________________________`
- [ ] DNS update method selected: manual / provider API / other

`DOMAIN` and `WEB_ORIGIN` must describe the same HTTPS origin. Do not include a
path, wildcard, query string, fragment, or credentials in `WEB_ORIGIN`.

## 5. Runtime environment contract

The production environment file should be stored at
`/etc/taptalk/taptalk.env`, owned by the deployment user, with mode `0600`.
Confirm these values without placing secrets in this checklist:

| Variable              | Required value or decision                          | Supplied/verified |
| --------------------- | --------------------------------------------------- | ----------------- |
| `NODE_ENV`            | `production`                                        | `[ ]`             |
| `API_HOST`            | `0.0.0.0` inside the container                      | `[ ]`             |
| `API_PORT`            | `3000` unless intentionally changed                 | `[ ]`             |
| `DATABASE_PATH`       | `/data/taptalk.db` on the named volume              | `[ ]`             |
| `WEB_ORIGIN`          | Exact `https://` origin, normally the public domain | `[ ]`             |
| `TRUST_PROXY`         | `true` only when Caddy is the sole trusted proxy    | `[ ]`             |
| `AUTH_RATE_LIMIT_MAX` | Positive integer; default currently `20`            | `[ ]`             |
| `LOG_LEVEL`           | Normally `info`                                     | `[ ]`             |
| `SHUTDOWN_TIMEOUT_MS` | Normally `10000`; bounded 1000–120000               | `[ ]`             |
| `DOMAIN`              | Caddy site name, normally the production domain     | `[ ]`             |
| `CADDY_HTTP_PORT`     | Host HTTP port, normally `80`                       | `[ ]`             |
| `CADDY_HTTPS_PORT`    | Host HTTPS port, normally `443`                     | `[ ]`             |
| `ACME_EMAIL`          | Optional Caddy/ACME contact, if used                | `[ ]`             |

The current application has no `SESSION_SECRET`. Do not invent or add one
without a separate security decision. Future secrets must be added to the
secret inventory below.

## 6. Credentials and secret inventory

Record the **name and destination** of each secret, never its value.

| Secret or credential                   | Destination                                    | Name/reference     | Owner      | Verified |
| -------------------------------------- | ---------------------------------------------- | ------------------ | ---------- | -------- |
| GitHub Actions registry authentication | GitHub token/permissions                       | `________________` | `________` | `[ ]`    |
| VM SSH private key                     | GitHub Environment Secret or workload identity | `________________` | `________` | `[ ]`    |
| VM SSH host key                        | GitHub Environment Secret or `known_hosts`     | `________________` | `________` | `[ ]`    |
| VM runtime environment file            | VM `/etc/taptalk/taptalk.env`                  | `________________` | `________` | `[ ]`    |
| GCP deployment credentials, if not SSH | GitHub/GCP secret store                        | `________________` | `________` | `[ ]`    |
| DNS API token, if DNS is automated     | GitHub Environment Secret                      | `________________` | `________` | `[ ]`    |
| Off-VM backup credentials              | Backup provider secret store                   | `________________` | `________` | `[ ]`    |
| Monitoring/alert webhook               | Monitoring secret store                        | `________________` | `________` | `[ ]`    |

Also confirm:

- [ ] Secret rotation owner and rotation date are recorded
- [ ] Former SSH keys/tokens can be revoked
- [ ] GitHub secrets are scoped to the production environment where possible
- [ ] The VM environment file is not copied into images or build context
- [ ] Logs do not print environment files, tokens, cookies, or private keys
- [ ] Access to the VM and GitHub repository is auditable

## 7. Persistent storage and backups

- [ ] SQLite named volume is backed by a persistent VM disk
- [ ] Volume name and mount strategy: `____________________________`
- [ ] Minimum free-disk threshold: `____________________________`
- [ ] Off-VM backup destination: `____________________________`
- [ ] Backup provider/region: `____________________________`
- [ ] Backup encryption method and key owner: `____________________________`
- [ ] Backup schedule: `____________________________`
- [ ] Retention period: `____________________________`
- [ ] Backup monitoring/alert owner: `____________________________`
- [ ] Restore test date and result: `____________________________`
- [ ] Restore procedure has been rehearsed in a clean temporary location
- [ ] Rollback understands that migrations are forward-only
- [ ] Previous image and database backup are retained for the rollback window

Do not treat the VM disk as a backup. Do not copy an active SQLite database
without using the documented SQLite-aware backup operation.

## 8. Monitoring and operations

- [ ] Uptime monitor checks `https://DOMAIN/ready`
- [ ] Liveness monitor checks `https://DOMAIN/health`
- [ ] Monitor owner: `____________________________`
- [ ] Alert destination (email, webhook, or incident channel): `____________`
- [ ] VM CPU/memory/disk monitoring enabled
- [ ] Certificate-expiry monitoring enabled
- [ ] Log retention period: `____________________________`
- [ ] Log aggregation destination, if any: `____________________________`
- [ ] Incident contact/escalation path: `____________________________`
- [ ] Maintenance window/timezone: `____________________________`
- [ ] Access review date: `____________________________`

## 9. Deployment and rollback decisions

- [ ] Initial deployment mode selected: manual approval / tag / other
- [ ] Production environment protection enabled
- [ ] Required reviewers named
- [ ] Deployment concurrency selected
- [ ] Image promotion uses immutable commit-SHA/digest references
- [ ] Migration is run before the new API becomes ready
- [ ] Deployment verification includes `/ready`, health, login, and one safe
      authenticated workflow
- [ ] Failed deployment automatically stops promotion
- [ ] Rollback image/digest is known or discoverable
- [ ] Database restore/rollback procedure is approved
- [ ] Downtime expectation is recorded
- [ ] Deployment actor and timestamp are recorded after release

## 10. Final acceptance checklist

- [ ] `npm ci` succeeds from a clean checkout
- [ ] `npm run lint` succeeds
- [ ] `npm run typecheck` succeeds
- [ ] `npm test` succeeds
- [ ] `npm run test:coverage` succeeds
- [ ] `npm run test:deployment` succeeds
- [ ] `npm run verify:deployment` succeeds
- [ ] `npm run build:production` succeeds
- [ ] `npm run smoke:production` succeeds on a Docker-enabled host
- [ ] API image builds and runs as non-root
- [ ] Caddy obtains and renews a certificate
- [ ] `/health` and `/ready` pass through the public origin
- [ ] SPA deep links work through Caddy
- [ ] API proxying and origin checks work through Caddy
- [ ] SQLite data survives an API container restart
- [ ] Backup and restore succeed
- [ ] `SIGTERM` shutdown closes the database cleanly
- [ ] No API port is publicly reachable
- [ ] No secrets, `.env` files, or production data are in Git or images

## 11. Safe handoff to send back

Copy this block into a private ticket or secure message and fill it with
**non-secret values only**. Do not add passwords, tokens, private keys, or
secret-file contents.

```text
GitHub repository URL:
GitHub owner/repository:
Default/release branch:
Production GitHub Environment name:
GHCR API image:
GHCR web image:
Release trigger and version format:
Production approval owner:

Google Cloud project ID:
VM name:
VM region/zone:
VM public IP or stable hostname:
VM SSH username:
VM SSH port:
Deployment method (SSH or GCP-native):
Deployment directory on VM:
Persistent disk/volume strategy:

Production domain:
DNS provider and zone:
DNS record type/value:
ACME contact email destination (not the email secret, if any):
WEB_ORIGIN:
Planned maintenance window/timezone:

Backup destination/provider:
Backup encryption and retention decision:
Monitoring/alert owner:
Rollback owner and retention window:

Secret names already configured in GitHub/VM/GCP:
(Only names and locations, never values.)

Known limitations or unresolved decisions:
```

## 12. What should not be sent

Do not send or commit any of the following:

- VM root or user passwords
- SSH private keys, public keys used as credentials, or `known_hosts` containing
  sensitive infrastructure details unless intentionally approved
- GitHub tokens, GHCR tokens, cloud service-account JSON, DNS API tokens, or
  backup credentials
- The contents of `/etc/taptalk/taptalk.env`
- Real user accounts, passwords, session cookies, or production vocabulary
- Production SQLite databases or backup files
- Cloud billing, project, or account recovery codes

If an item is required for setup, configure it directly in the relevant system
and provide only its secret name, location, owner, and rotation date here.
