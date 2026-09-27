import { describe, expect, it } from 'vitest';
import { insecureSettingWarnings } from '../../src/bootstrap/setting-warnings.js';

describe('insecureSettingWarnings', () => {
  it('is quiet for the recommended settings', () => {
    expect(
      insecureSettingWarnings({
        NODE_ENV: 'production',
        COOKIE_SECURE: true,
        TRUST_PROXY: ['loopback'],
        API_HOST: '0.0.0.0',
      }),
    ).toEqual([]);
    expect(
      insecureSettingWarnings({
        NODE_ENV: 'development',
        COOKIE_SECURE: false,
        TRUST_PROXY: ['loopback'],
        API_HOST: '0.0.0.0',
      }),
    ).toEqual([]);
  });

  it('accepts plain HTTP in production when the api only listens on loopback', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(
        insecureSettingWarnings({
          NODE_ENV: 'production',
          COOKIE_SECURE: false,
          TRUST_PROXY: false,
          API_HOST: host,
        }),
      ).toEqual([]);
    }
  });

  it('warns about non-Secure cookies on a network and about trusting every proxy', () => {
    const warnings = insecureSettingWarnings({
      NODE_ENV: 'production',
      COOKIE_SECURE: false,
      TRUST_PROXY: true,
      API_HOST: '0.0.0.0',
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('COOKIE_SECURE=false');
    expect(warnings[1]).toContain('TRUST_PROXY=true');
  });
});
