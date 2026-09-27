#!/usr/bin/env bash
# Smoke test of the Docker stack on a Linux host with Docker Compose v2 (Windows Server 2019
# cannot run these Linux containers; CI runs it on every push). Builds every image, starts the
# stack with throwaway secrets, creates a user with the CLI, then checks health, headers, caching,
# the host-name guard, the login limit behind nginx, live updates, an api restart, the worker's
# healthcheck and the unprivileged users; finally removes everything (volumes too).
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
EMAIL="smoke-admin@example.com"
PASSWORD="$(openssl rand -hex 16)"

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

fail() {
  echo "FAILED: $*" >&2
  exit 1
}

# Hex secrets are URL-safe (they end up inside DATABASE_URL / REDIS_URL).
cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
WEB_PORT=${PORT}
WEB_ORIGINS=${BASE}
TELEGRAM_SESSION_KEY=$(openssl rand -base64 32)
EOF

wait_ready() {
  local deadline=$((SECONDS + 300))
  until curl -fsS "${BASE}/api/health/ready" 2>/dev/null | grep -q '"status":"alive"'; do
    [ "$SECONDS" -lt "$deadline" ] || fail "no /api/health/ready with a live worker"
    sleep 3
  done
}

echo "==> Building and starting the stack (project ${PROJECT}, port ${PORT})"
compose up -d --build

echo "==> Waiting for the api to become ready and the worker to report in"
wait_ready

echo "==> Creating the first user with the CLI (password on stdin)"
printf '%s' "$PASSWORD" |
  compose exec -T api node apps/api/dist/cli/create-user.js --email "$EMAIL" --password-stdin

echo "==> nginx liveness";            curl -fsS "${BASE}/healthz"
echo "==> readiness";                 curl -fsS "${BASE}/api/health/ready"; echo

echo "==> SPA: deep links, security headers and caching"
curl -fsS "${BASE}/dashboard" | grep -q '<app-root' || fail "deep link did not return index.html"
headers="$(curl -fsSI "${BASE}/")"
grep -qi "^content-security-policy:.*font-src 'self'" <<<"$headers" || fail "CSP missing"
grep -qi 'googleapis\|upgrade-insecure-requests' <<<"$headers" && fail "CSP loads from elsewhere or upgrades HTTP"
grep -qi '^cache-control: no-cache' <<<"$headers" || fail "index.html is not revalidated"
main="$(curl -fsS "${BASE}/" | grep -o 'main-[A-Za-z0-9_-]*\.js' | head -n1)"
curl -fsSI "${BASE}/${main}" | grep -qi '^cache-control: public, max-age=31536000, immutable' ||
  fail "hashed build output is not cached as immutable"

echo "==> An unknown host name is refused (DNS rebinding)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: rebind.evil.example' "${BASE}/api/health/live")
[ "$code" = "421" ] || fail "expected 421 for an unknown host, got ${code}"

echo "==> Sign in"
curl -fsS -c "$COOKIES" -H 'Content-Type: application/json' -H "Origin: ${BASE}" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" "${BASE}/api/auth/login"
echo
echo "==> /api/auth/me";  curl -fsS -b "$COOKIES" "${BASE}/api/auth/me"; echo
echo "==> /api/stats";    curl -fsS -b "$COOKIES" "${BASE}/api/stats"; echo
echo "==> /api/channels"; curl -fsS -b "$COOKIES" "${BASE}/api/channels"; echo

echo "==> Live updates start with a ready event through nginx"
events="$(curl -sN --max-time 5 -b "$COOKIES" "${BASE}/api/events" || true)"
grep -q '^event: ready' <<<"$events" || fail "no ready event on /api/events"

echo "==> A cross-site POST is rejected"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Sec-Fetch-Site: cross-site' \
  -H 'Content-Type: application/json' -d '{}' "${BASE}/api/auth/login")
[ "$code" = "403" ] || fail "expected 403, got ${code}"

echo "==> A forged X-Forwarded-For does not get around the login limit (5 a minute per client)"
for attempt in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: 203.0.113.${attempt}" -H "Origin: ${BASE}" \
    -d '{"email":"nobody@example.com","password":"wrong password"}' "${BASE}/api/auth/login")
done
[ "$code" = "429" ] || fail "the 6th sign-in of the minute was not limited (got ${code})"

echo "==> The api restarts and nginx finds it again"
compose restart api
wait_ready
curl -fsS -b "$COOKIES" "${BASE}/api/auth/me" >/dev/null || fail "no api after its restart"

echo "==> The worker's healthcheck"
deadline=$((SECONDS + 120))
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q worker)")" = "healthy" ]; do
  [ "$SECONDS" -lt "$deadline" ] || fail "the worker never became healthy"
  sleep 3
done

echo "==> Nothing runs as root, and the archive's database role is not a superuser"
for service in api worker web redis; do
  uid="$(compose exec -T "$service" id -u)"
  [ "$uid" != "0" ] || fail "${service} runs as root"
done
superuser="$(compose exec -T postgres psql -U postgres -tAc "SELECT rolsuper FROM pg_roles WHERE rolname = 'tam'")"
[ "$superuser" = "f" ] || fail "the role tam is a superuser"

echo "Smoke test passed."
