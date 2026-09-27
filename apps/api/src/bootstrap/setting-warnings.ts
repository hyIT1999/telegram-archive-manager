import type { Env } from '../config/env.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Settings that are valid but weaken security; logged as warnings at startup. */
export function insecureSettingWarnings(
  env: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE' | 'TRUST_PROXY' | 'API_HOST'>,
): string[] {
  const warnings: string[] = [];
  // Listening on loopback only (pm2 on this machine), the cookie never crosses a network.
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE && !LOOPBACK_HOSTS.has(env.API_HOST)) {
    warnings.push(
      'COOKIE_SECURE=false: the session cookie is also sent over plain HTTP. Use it only on a trusted LAN.',
    );
  }
  if (env.TRUST_PROXY === true) {
    warnings.push(
      'TRUST_PROXY=true trusts X-Forwarded-For from any client, so the rate limits can be bypassed. List the proxy addresses instead.',
    );
  }
  return warnings;
}
