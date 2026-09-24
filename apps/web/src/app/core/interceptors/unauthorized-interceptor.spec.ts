import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { flushError, makeUser } from '../../../testing/fixtures';
import { AUTH_ENDPOINTS, AuthService } from '../auth/auth-service';
import { unauthorizedInterceptor } from './unauthorized-interceptor';

@Component({ selector: 'app-page-stub', template: '' })
class PageStub {}

describe('unauthorizedInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let router: Router;
  let auth: AuthService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: PageStub }]),
        provideHttpClient(withInterceptors([unauthorizedInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);

    const login = firstValueFrom(auth.login({ email: 'a@b.test', password: 'secret' }));
    http.expectOne(AUTH_ENDPOINTS.login).flush(makeUser());
    await login;
    await router.navigateByUrl('/channels?cursor=abc');
  });

  afterEach(() => http.verify());

  it('clears the session and redirects to /login with the current page as returnUrl', async () => {
    const result = firstValueFrom(client.get('/api/channels'));
    flushError(http.expectOne('/api/channels'), 401, 'Session expired');

    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.isAuthenticated()).toBe(false);
    await vi.waitFor(() => expect(router.url).toBe('/login?returnUrl=%2Fchannels%3Fcursor%3Dabc'));
  });

  it.each([AUTH_ENDPOINTS.me, AUTH_ENDPOINTS.login])(
    'leaves 401 from %s to the caller',
    async (url) => {
      const result = firstValueFrom(client.post(url, {}));
      flushError(http.expectOne(url), 401, 'Unauthorized');

      await expect(result).rejects.toMatchObject({ status: 401 });
      expect(auth.isAuthenticated()).toBe(true);
      expect(router.url).toBe('/channels?cursor=abc');
    },
  );

  it('does not react to other errors', async () => {
    const result = firstValueFrom(client.get('/api/channels/missing'));
    flushError(http.expectOne('/api/channels/missing'), 404, 'Not found');

    await expect(result).rejects.toMatchObject({ status: 404 });
    expect(auth.isAuthenticated()).toBe(true);
    expect(router.url).toBe('/channels?cursor=abc');
  });
});
