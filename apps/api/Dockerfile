# syntax=docker/dockerfile:1
# NestJS API image. Build context: repository root.
#   docker build -f apps/api/Dockerfile --target runtime -t tam-api .
# Targets:
#   runtime  (default) the API, plus the create-user CLI used by the compose `bootstrap` service
#   migrate  one-shot `prisma migrate deploy` (has the Prisma CLI, migrations and prisma.config.ts)

ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Workspace manifests only: dependency layers stay cached until a package.json or the lockfile
# changes. npm needs every workspace listed in the root package.json to exist.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY packages/database/package.json packages/database/
COPY packages/storage/package.json packages/storage/
COPY packages/telegram/package.json packages/telegram/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/

# ---- build: full dev dependencies of the api and the database package (Prisma CLI) ----
FROM manifests AS build
RUN npm ci --include-workspace-root -w @tam/database -w @tam/api
COPY tsconfig.base.json tsconfig.node.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# prisma generate needs no database (prisma.config.ts falls back to an empty URL).
RUN npm run build:packages && npm run build -w @tam/api

# ---- migrate: one-shot `prisma migrate deploy` (compose service `migrate`) ----
FROM build AS migrate
WORKDIR /app/packages/database
ENV NODE_ENV=production
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

# ---- prod-deps: runtime dependencies only ----
FROM manifests AS prod-deps
RUN npm ci --omit=dev -w @tam/api

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3100

# node_modules/@tam/* are symlinks into packages/*, so the workspace folders come along.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=prod-deps /app/apps/api ./apps/api
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/crypto/dist ./packages/crypto/dist
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Media volume mount point (shared with the worker), writable by the unprivileged user.
RUN mkdir -p /data/storage && chown node:node /data/storage

USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/api/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
