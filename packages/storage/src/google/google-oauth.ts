import { StorageError } from '../errors.js';

export interface GoogleEndpoints {
  /** OAuth server, e.g. https://oauth2.googleapis.com */
  readonly oauth: string;
  /** REST APIs, e.g. https://www.googleapis.com */
  readonly api: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  oauth: 'https://oauth2.googleapis.com',
  api: 'https://www.googleapis.com',
};

/** Files and folders this app creates, and nothing else of the user's Drive. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** The email address only labels the location ("archive@gmail.com"). */
export const GOOGLE_DRIVE_SCOPES = ['openid', 'email', DRIVE_FILE_SCOPE] as const;

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REQUEST_TIMEOUT_MS = 30_000;

export interface GoogleClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Google answered with an error, or could not be reached (status null). */
export class GoogleApiError extends StorageError {
  constructor(
    message: string,
    readonly status: number | null,
    readonly reason: string | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** The stored refresh token stopped working: access was revoked, or it expired. */
export class GoogleAuthRevokedError extends StorageError {
  constructor() {
    super(
      'Google access was revoked or has expired. Reconnect the Google account. If this happens ' +
        'every week, publish the OAuth consent screen ("In production").',
    );
  }
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface GoogleTokens {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  /** Scopes the user actually granted; Google lets people untick Drive on the consent screen. */
  scopes: string[];
  email: string | null;
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'authorized'; tokens: GoogleTokens };

interface OAuthAnswer {
  status: number;
  body: Record<string, unknown>;
}

function text(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value === '') {
    throw new GoogleApiError(`Google's answer has no ${field}`, null, null);
  }
  return value;
}

function seconds(body: Record<string, unknown>, field: string, fallback: number): number {
  const value = body[field];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The email claim of an id_token received directly from Google's token endpoint over TLS. */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') {
    return null;
  }
  const payload = idToken.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    const email = (claims as Record<string, unknown> | null)?.['email'];
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

/**
 * OAuth for "TVs and Limited Input devices" clients: the device-code flow (google.com/device),
 * which needs no redirect URI and so works whether the archive is reached through localhost, a
 * LAN address or a domain.
 */
export class GoogleOAuthClient {
  constructor(
    private readonly credentials: GoogleClientCredentials,
    private readonly endpoints: GoogleEndpoints = GOOGLE_ENDPOINTS,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async startDeviceAuthorization(): Promise<DeviceAuthorization> {
    const answer = await this.post('/device/code', {
      client_id: this.credentials.clientId,
      scope: GOOGLE_DRIVE_SCOPES.join(' '),
    });
    if (answer.status !== 200) {
      throw this.errorFrom(answer);
    }
    return {
      deviceCode: text(answer.body, 'device_code'),
      userCode: text(answer.body, 'user_code'),
      verificationUrl:
        typeof answer.body['verification_url'] === 'string'
          ? answer.body['verification_url']
          : text(answer.body, 'verification_uri'),
      expiresInSeconds: seconds(answer.body, 'expires_in', 1_800),
      intervalSeconds: seconds(answer.body, 'interval', 5),
    };
  }

  /** One poll of the token endpoint; callers wait `intervalSeconds` between polls. */
  async pollDeviceAuthorization(deviceCode: string): Promise<DevicePollResult> {
    const answer = await this.post('/token', {
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      device_code: deviceCode,
      grant_type: DEVICE_GRANT,
    });
    if (answer.status === 200) {
      const scope = answer.body['scope'];
      return {
        status: 'authorized',
        tokens: {
          accessToken: text(answer.body, 'access_token'),
          expiresInSeconds: seconds(answer.body, 'expires_in', 3_600),
          refreshToken: text(answer.body, 'refresh_token'),
          scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
          email: emailFromIdToken(answer.body['id_token']),
        },
      };
    }
    switch (answer.body['error']) {
      case 'authorization_pending':
        return { status: 'pending' };
      case 'slow_down':
        return { status: 'slow_down' };
      case 'access_denied':
        return { status: 'denied' };
      case 'expired_token':
        return { status: 'expired' };
      default:
        throw this.errorFrom(answer);
    }
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const answer = await this.post('/token', {
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    if (answer.status === 200) {
      return {
        accessToken: text(answer.body, 'access_token'),
        expiresInSeconds: seconds(answer.body, 'expires_in', 3_600),
      };
    }
    if (answer.body['error'] === 'invalid_grant') {
      throw new GoogleAuthRevokedError();
    }
    throw this.errorFrom(answer);
  }

  /** Revokes a token (and the grant it belongs to). A token Google no longer knows is fine. */
  async revoke(token: string): Promise<void> {
    const answer = await this.post('/revoke', { token });
    if (answer.status !== 200 && answer.body['error'] !== 'invalid_token') {
      throw this.errorFrom(answer);
    }
  }

  private async post(path: string, form: Record<string, string>): Promise<OAuthAnswer> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.endpoints.oauth}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GoogleApiError('Cannot reach Google. Check the internet connection of the server.', null, null, {
        cause: error,
      });
    }
    const body = (await response.json().catch(() => ({}))) as unknown;
    return {
      status: response.status,
      body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {},
    };
  }

  private errorFrom({ status, body }: OAuthAnswer): GoogleApiError {
    const reason = typeof body['error'] === 'string' ? body['error'] : null;
    if (reason === 'invalid_client' || reason === 'unauthorized_client') {
      return new GoogleApiError(
        'Google rejected the OAuth client. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, ' +
          'and that the client type is "TVs and Limited Input devices".',
        status,
        reason,
      );
    }
    if (reason === 'invalid_scope') {
      return new GoogleApiError('This OAuth client may not ask for Google Drive access.', status, reason);
    }
    return new GoogleApiError(`Google answered ${status}${reason ? ` (${reason})` : ''}.`, status, reason);
  }
}

/** Access tokens for API calls. */
export interface AccessTokenSource {
  get(): Promise<string>;
  /** Forgets the cached token after Google rejected it (401). */
  invalidate(): void;
}

/** Access tokens of one refresh token, refreshed a minute before they expire. */
export class GoogleAccessTokens implements AccessTokenSource {
  private current: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly oauth: GoogleOAuthClient,
    private readonly refreshToken: string,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<string> {
    if (this.current && this.current.expiresAt - 60_000 > this.now()) {
      return Promise.resolve(this.current.token);
    }
    this.pending ??= this.oauth
      .refresh(this.refreshToken)
      .then(({ accessToken, expiresInSeconds }) => {
        this.current = { token: accessToken, expiresAt: this.now() + expiresInSeconds * 1000 };
        return accessToken;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  invalidate(): void {
    this.current = null;
  }
}

/** A fixed access token, e.g. the one a login just returned. */
export function staticAccessToken(token: string): AccessTokenSource {
  return { get: () => Promise.resolve(token), invalidate: () => undefined };
}
