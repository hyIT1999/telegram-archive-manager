# syntax=docker/dockerfile:1
# BullMQ worker image (owns the single Telegram connection — run exactly ONE replica).
# Build context: repository root.
#   docker build -f apps/worker/Dockerfile -t tam-worker .

ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

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
COPY apps/e2e/package.json apps/e2e/

FROM manifests AS build
# Prisma's engines look for OpenSSL, which the slim image does not have.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm ci --include-workspace-root -w @tam/database -w @tam/worker
COPY tsconfig.base.json tsconfig.node.json tsconfig.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN npm run db:generate && npx tsc -b apps/worker

FROM manifests AS prod-deps
RUN npm ci --omit=dev -w @tam/worker

FROM ${NODE_IMAGE} AS runtime
# Thumbnails come from Telegram and metadata with the messages, so no ffmpeg is needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    STORAGE_LOCAL_ROOT=/data/storage \
    WORKER_ALIVE_FILE=/tmp/tam-worker.alive

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=prod-deps /app/apps/worker ./apps/worker
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/crypto/dist ./packages/crypto/dist
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
COPY --from=build /app/packages/telegram/dist ./packages/telegram/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist

# Media volume mount point, owned by the unprivileged user so a fresh named volume is writable.
RUN mkdir -p /data/storage && chown node:node /data/storage

USER node
# SIGTERM → graceful shutdown: jobs hand themselves back to the queue before the process exits.
STOPSIGNAL SIGTERM
# The heartbeat touches WORKER_ALIVE_FILE after every beat it wrote to Redis.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "const f=require('node:fs');try{process.exit(Date.now()-f.statSync(process.env.WORKER_ALIVE_FILE).mtimeMs<60000?0:1)}catch{process.exit(1)}"]
CMD ["node", "apps/worker/dist/main.js"]
