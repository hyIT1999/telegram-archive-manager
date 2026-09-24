import { describe, expect, it } from 'vitest';
import { insecureSettingWarnings } from '../../src/bootstrap/setting-warnings.js';

describe('insecureSettingWarnings', () => {
  it('is quiet for the recommended settings', () => {
    expect(
      insecureSettingWarnings({
        NODE_ENV: 'production',
        COOKIE_SECURE: true,
        TRUST_PROXY: ['loopback'],
      }),
    ).toEqual([]);
    expect(
      insecureSettingWarnings({
        NODE_ENV: 'development',
        COOKIE_SECURE: false,
        TRUST_PROXY: ['loopback'],
      }),
    ).toEqual([]);
  });

  it('warns about non-Secure cookies in production and about trusting every proxy', () => {
    const warnings = insecureSettingWarnings({
      NODE_ENV: 'production',
      COOKIE_SECURE: false,
      TRUST_PROXY: true,
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('COOKIE_SECURE=false');
    expect(warnings[1]).toContain('TRUST_PROXY=true');
  });
});
