#!/usr/bin/env bash
# Smoke test of the Docker stack on a Linux host with Docker Compose v2 (Windows Server 2019
# cannot run these Linux containers). Builds every image, starts the stack with throwaway
# secrets, checks health, signs in as the bootstrap admin, then removes everything (volumes too).
#
#   scripts/compose-smoke.sh            # uses host port 18080
#   SMOKE_WEB_PORT=9090 scripts/compose-smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="tam-smoke"
PORT="${SMOKE_WEB_PORT:-18080}"
BASE="http://localhost:${PORT}"
ENV_FILE="$(mktemp)"
COOKIES="$(mktemp)"
ADMIN_EMAIL="smoke-admin@example.com"
ADMIN_PASSWORD="$(openssl rand -hex 16)"

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" "$@"
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "!! Smoke test failed — recent logs:" >&2
    compose logs --tail=80 >&2 || true
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE" "$COOKIES"
  exit "$status"
}
trap cleanup EXIT

# Hex secrets are URL-safe (they end up inside DATABASE_URL / REDIS_URL).
cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
WEB_PORT=${PORT}
CSRF_TRUSTED_ORIGINS=${BASE}
TELEGRAM_SESSION_KEY=$(openssl rand -base64 32)
EOF

echo "==> Building and starting the stack (project ${PROJECT}, port ${PORT})"
compose up -d --build

echo "==> Waiting for the api to become ready and the worker to report in"
deadline=$((SECONDS + 300))
until curl -fsS "${BASE}/api/health/ready" 2>/dev/null | grep -q '"status":"alive"'; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Timed out waiting for /api/health/ready with a live worker" >&2
    exit 1
  fi
  sleep 3
done

echo "==> nginx liveness";            curl -fsS "${BASE}/healthz"
echo "==> readiness";                 curl -fsS "${BASE}/api/health/ready"; echo
echo "==> SPA deep link falls back to index.html"
curl -fsS "${BASE}/dashboard" | grep -q '<app-root'

echo "==> Sign in as the bootstrap admin"
curl -fsS -c "$COOKIES" \
  -H 'Content-Type: application/json' \
  -H "Origin: ${BASE}" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  "${BASE}/api/auth/login"
echo
echo "==> /api/auth/me";  curl -fsS -b "$COOKIES" "${BASE}/api/auth/me"; echo
echo "==> /api/stats";    curl -fsS -b "$COOKIES" "${BASE}/api/stats"; echo
echo "==> /api/channels"; curl -fsS -b "$COOKIES" "${BASE}/api/channels"; echo

echo "==> A cross-site POST is rejected"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Sec-Fetch-Site: cross-site' \
  -H 'Content-Type: application/json' -d '{}' "${BASE}/api/auth/login")
[ "$code" = "403" ] || { echo "expected 403, got ${code}" >&2; exit 1; }

echo "Smoke test passed."
