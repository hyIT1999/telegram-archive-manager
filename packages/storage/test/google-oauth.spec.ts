import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DRIVE_FILE_SCOPE,
  GoogleAccessTokens,
  GoogleApiError,
  GoogleAuthRevokedError,
  GoogleOAuthClient,
  emailFromIdToken,
} from '../src/index.js';
import { FakeGoogle } from '../src/testing/index.js';

describe('GoogleOAuthClient (device flow)', () => {
  let google: FakeGoogle;
  let oauth: GoogleOAuthClient;

  beforeAll(async () => {
    google = await FakeGoogle.start();
    oauth = new GoogleOAuthClient(
      { clientId: google.clientId, clientSecret: google.clientSecret },
      google.endpoints,
    );
  });

  afterAll(() => google.close());

  it('hands out a code, waits for approval and returns tokens with the granted scopes', async () => {
    const device = await oauth.startDeviceAuthorization();
    expect(device).toMatchObject({
      verificationUrl: 'https://www.google.com/device',
      expiresInSeconds: 1800,
      intervalSeconds: 5,
    });
    expect(device.userCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);

    await expect(oauth.pollDeviceAuthorization(device.deviceCode)).resolves.toEqual({ status: 'pending' });
    google.approve(device.userCode, { email: 'teacher@example.com' });
    const result = await oauth.pollDeviceAuthorization(device.deviceCode);
    expect(result.status).toBe('authorized');
    if (result.status !== 'authorized') {
      return;
    }
    expect(result.tokens.email).toBe('teacher@example.com');
    expect(result.tokens.scopes).toContain(DRIVE_FILE_SCOPE);
    expect(result.tokens.refreshToken).toMatch(/^refresh-/);

    // A device code can be redeemed once.
    await expect(oauth.pollDeviceAuthorization(device.deviceCode)).rejects.toBeInstanceOf(GoogleApiError);
  });

  it('reports slow down, denial and expiry', async () => {
    const slow = await oauth.startDeviceAuthorization();
    google.slowDown(slow.userCode);
    await expect(oauth.pollDeviceAuthorization(slow.deviceCode)).resolves.toEqual({ status: 'slow_down' });

    const denied = await oauth.startDeviceAuthorization();
    google.deny(denied.userCode);
    await expect(oauth.pollDeviceAuthorization(denied.deviceCode)).resolves.toEqual({ status: 'denied' });

    const expired = await oauth.startDeviceAuthorization();
    google.expire(expired.userCode);
    await expect(oauth.pollDeviceAuthorization(expired.deviceCode)).resolves.toEqual({ status: 'expired' });
  });

  it('shows when Drive access was not granted', async () => {
    const device = await oauth.startDeviceAuthorization();
    google.approve(device.userCode, { grantDrive: false });
    const result = await oauth.pollDeviceAuthorization(device.deviceCode);
    expect(result.status === 'authorized' && result.tokens.scopes.includes(DRIVE_FILE_SCOPE)).toBe(false);
  });

  it('explains a wrong client id or secret', async () => {
    const wrong = new GoogleOAuthClient({ clientId: 'nope', clientSecret: 'nope' }, google.endpoints);
    await expect(wrong.startDeviceAuthorization()).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  it('refreshes access tokens until the grant is revoked', async () => {
    const refreshToken = google.issueRefreshToken();
    await expect(oauth.refresh(refreshToken)).resolves.toMatchObject({ expiresInSeconds: 3599 });
    await oauth.revoke(refreshToken);
    expect(google.revoked).toContain(refreshToken);
    await expect(oauth.refresh(refreshToken)).rejects.toBeInstanceOf(GoogleAuthRevokedError);
    // Revoking again (or an unknown token) is not an error.
    await expect(oauth.revoke('unknown-token')).resolves.toBeUndefined();
  });

  it('reports an unreachable Google', async () => {
    const offline = new GoogleOAuthClient(
      { clientId: 'x', clientSecret: 'y' },
      { oauth: 'http://127.0.0.1:1', api: 'http://127.0.0.1:1' },
    );
    await expect(offline.startDeviceAuthorization()).rejects.toThrow(/Cannot reach Google/);
  });

  it('reads the email of an id token and ignores malformed ones', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'a@b.c' })).toString('base64url');
    expect(emailFromIdToken(`h.${payload}.s`)).toBe('a@b.c');
    expect(emailFromIdToken('garbage')).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken('h.!!!.s')).toBeNull();
  });
});

describe('GoogleAccessTokens', () => {
  it('refreshes once for concurrent callers, reuses the token, and refreshes after invalidate', async () => {
    let now = 0;
    const refresh = vi.fn(async () => ({ accessToken: `token-${refresh.mock.calls.length}`, expiresInSeconds: 3600 }));
    const tokens = new GoogleAccessTokens({ refresh } as unknown as GoogleOAuthClient, 'refresh', () => now);

    const [first, second] = await Promise.all([tokens.get(), tokens.get()]);
    expect(first).toBe('token-1');
    expect(second).toBe('token-1');
    expect(refresh).toHaveBeenCalledTimes(1);

    now = 3_000_000;
    expect(await tokens.get()).toBe('token-1');
    now = 3_550_000; // less than a minute before expiry
    expect(await tokens.get()).toBe('token-2');

    tokens.invalidate();
    expect(await tokens.get()).toBe('token-3');
  });
});
