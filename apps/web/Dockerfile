# syntax=docker/dockerfile:1
# Angular SPA served by nginx (unprivileged, port 8080), which also reverse-proxies /api/ to the
# api service. Build context: repository root.
#   docker build -f apps/web/Dockerfile -t tam-web .

ARG NODE_IMAGE=node:24-trixie-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NG_CLI_ANALYTICS=false
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
RUN npm ci --include-workspace-root -w @tam/shared -w @tam/web
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm run build -w @tam/shared && npm run build -w @tam/web

FROM ${NGINX_IMAGE} AS runtime
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/snippets/ /etc/nginx/snippets/
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
