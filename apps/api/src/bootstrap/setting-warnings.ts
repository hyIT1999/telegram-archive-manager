import type { Env } from '../config/env.js';

/** Settings that are valid but weaken security; logged as warnings at startup. */
export function insecureSettingWarnings(
  env: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE' | 'TRUST_PROXY'>,
): string[] {
  const warnings: string[] = [];
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
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
