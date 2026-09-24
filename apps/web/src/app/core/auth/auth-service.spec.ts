import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { failNetwork, flushError, makeUser } from '../../../testing/fixtures';
import { AUTH_ENDPOINTS, AuthService } from './auth-service';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts signed out', () => {
    expect(auth.currentUser()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });

  describe('login', () => {
    it('posts the credentials and stores the returned user', async () => {
      const user = makeUser();
      const result = firstValueFrom(
        auth.login({ email: 'archivist@example.test', password: 'correct horse' }),
      );

      const request = http.expectOne(AUTH_ENDPOINTS.login);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        email: 'archivist@example.test',
        password: 'correct horse',
      });
      request.flush(user);

      await expect(result).resolves.toEqual(user);
      expect(auth.currentUser()).toEqual(user);
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('asks /me when the login response does not include the user', async () => {
      const user = makeUser();
      const result = firstValueFrom(auth.login({ email: user.email, password: 'secret' }));

      http.expectOne(AUTH_ENDPOINTS.login).flush(null, { status: 204, statusText: 'No Content' });
      http.expectOne(AUTH_ENDPOINTS.me).flush(user);

      await expect(result).resolves.toEqual(user);
      expect(auth.currentUser()).toEqual(user);
    });

    it('stays signed out when the credentials are rejected', async () => {
      const result = firstValueFrom(auth.login({ email: 'a@b.test', password: 'wrong' }));
      flushError(http.expectOne(AUTH_ENDPOINTS.login), 401, 'Invalid credentials');

      await expect(result).rejects.toMatchObject({ status: 401 });
      expect(auth.currentUser()).toBeNull();
    });

    it('makes later session checks use the new user without asking the API', async () => {
      const user = makeUser();
      const login = firstValueFrom(auth.login({ email: user.email, password: 'secret' }));
      http.expectOne(AUTH_ENDPOINTS.login).flush(user);
      await login;

      await expect(firstValueFrom(auth.ensureSession())).resolves.toEqual(user);
      http.expectNone(AUTH_ENDPOINTS.me);
    });
  });

  describe('ensureSession', () => {
    it('asks GET /api/auth/me once and shares the answer', async () => {
      const user = makeUser();
      const first = firstValueFrom(auth.ensureSession());
      const second = firstValueFrom(auth.ensureSession());

      const request = http.expectOne(AUTH_ENDPOINTS.me);
      expect(request.request.method).toBe('GET');
      request.flush(user);

      await expect(first).resolves.toEqual(user);
      await expect(second).resolves.toEqual(user);
      await expect(firstValueFrom(auth.ensureSession())).resolves.toEqual(user);
      http.expectNone(AUTH_ENDPOINTS.me);
      expect(auth.currentUser()).toEqual(user);
    });

    it('treats 401 as signed out and remembers it', async () => {
      const session = firstValueFrom(auth.ensureSession());
      flushError(http.expectOne(AUTH_ENDPOINTS.me), 401, 'Unauthorized');

      await expect(session).resolves.toBeNull();
      await expect(firstValueFrom(auth.ensureSession())).resolves.toBeNull();
      http.expectNone(AUTH_ENDPOINTS.me);
    });

    it('does not remember failures other than 401, so the next check retries', async () => {
      const session = firstValueFrom(auth.ensureSession());
      failNetwork(http.expectOne(AUTH_ENDPOINTS.me));
      await expect(session).resolves.toBeNull();

      const user = makeUser();
      const retry = firstValueFrom(auth.ensureSession());
      http.expectOne(AUTH_ENDPOINTS.me).flush(user);
      await expect(retry).resolves.toEqual(user);
    });
  });

  describe('logout', () => {
    async function signIn(): Promise<void> {
      const login = firstValueFrom(auth.login({ email: 'a@b.test', password: 'secret' }));
      http.expectOne(AUTH_ENDPOINTS.login).flush(makeUser());
      await login;
    }

    it('posts to /api/auth/logout and clears the user', async () => {
      await signIn();
      const logout = firstValueFrom(auth.logout());

      const request = http.expectOne(AUTH_ENDPOINTS.logout);
      expect(request.request.method).toBe('POST');
      request.flush(null, { status: 204, statusText: 'No Content' });

      await expect(logout).resolves.toBeUndefined();
      expect(auth.currentUser()).toBeNull();
      await expect(firstValueFrom(auth.ensureSession())).resolves.toBeNull();
      http.expectNone(AUTH_ENDPOINTS.me);
    });

    it('treats an already expired session (401) as logged out', async () => {
      await signIn();
      const logout = firstValueFrom(auth.logout());
      flushError(http.expectOne(AUTH_ENDPOINTS.logout), 401, 'Unauthorized');

      await expect(logout).resolves.toBeUndefined();
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('keeps the session when the server fails to end it', async () => {
      await signIn();
      const logout = firstValueFrom(auth.logout());
      flushError(http.expectOne(AUTH_ENDPOINTS.logout), 500, 'Internal server error');

      await expect(logout).rejects.toMatchObject({ status: 500 });
      expect(auth.isAuthenticated()).toBe(true);
    });
  });
});
