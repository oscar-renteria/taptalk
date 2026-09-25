# syntax=docker/dockerfile:1.7

FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS build
WORKDIR /workspace

# Copy workspace manifests first so dependency installation is cached independently of source.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --include=dev

COPY . .
RUN npm run build:production

FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS api
ENV NODE_ENV=production \
    ENV_FILE=none \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    DATABASE_PATH=/data/taptalk.db \
    LOG_LEVEL=info \
    SHUTDOWN_TIMEOUT_MS=10000
WORKDIR /app

# Install only runtime dependencies for the API and its shared workspace package.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @taptalk/api --workspace @taptalk/shared \
    && npm cache clean --force

COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=build /workspace/scripts/sqlite-maintenance.mjs ./scripts/sqlite-maintenance.mjs
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]

FROM caddy:2.10.0-alpine@sha256:ae4458638da8e1a91aafffb231c5f8778e964bca650c8a8cb23a7e8ac557aa3c AS web
COPY --from=build /workspace/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
