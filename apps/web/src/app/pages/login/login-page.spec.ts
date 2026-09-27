import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { flushError, makeUser } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { AUTH_ENDPOINTS, AuthService } from '../../core/auth/auth-service';
import { LoginPage } from './login-page';

@Component({ selector: 'app-page-stub', template: 'signed-in page' })
class PageStub {}

describe('LoginPage', () => {
  let http: HttpTestingController;
  let router: Router;
  let page: HTMLElement;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'login', component: LoginPage },
            { path: '**', component: PageStub },
          ],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  async function openLogin(url = '/login'): Promise<void> {
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, LoginPage);
    await harness.fixture.whenStable();
    page = harness.routeNativeElement as HTMLElement;
  }

  function type(selector: string, value: string): void {
    const input = page.querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`No input ${selector}`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /** Submits the form. Does not wait for stability: a pending login request would block it. */
  function submit(): void {
    page.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('does not call the API until the form is valid', async () => {
    await openLogin();
    submit();
    await harness.fixture.whenStable();

    http.expectNone(AUTH_ENDPOINTS.login);
    expect(page.textContent).toContain('Enter your email address.');
    expect(page.textContent).toContain('Enter your password.');

    type('input[type="email"]', 'not-an-email');
    submit();
    await harness.fixture.whenStable();
    expect(page.textContent).toContain('Enter a valid email address.');
    http.expectNone(AUTH_ENDPOINTS.login);
  });

  it('signs in and returns to the requested page', async () => {
    await openLogin('/login?returnUrl=%2Fchannels%3Fcursor%3Dabc');
    type('input[type="email"]', ' archivist@example.test ');
    type('input[autocomplete="current-password"]', 'correct horse battery');
    submit();

    const request = await nextRequest(http, AUTH_ENDPOINTS.login);
    expect(request.request.body).toEqual({
      email: 'archivist@example.test',
      password: 'correct horse battery',
    });
    request.flush(makeUser());

    await vi.waitFor(() => expect(router.url).toBe('/channels?cursor=abc'));
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });

  it('goes to the dashboard when the return URL points elsewhere', async () => {
    await openLogin('/login?returnUrl=https%3A%2F%2Fevil.example');
    type('input[type="email"]', 'archivist@example.test');
    type('input[autocomplete="current-password"]', 'secret');
    submit();

    (await nextRequest(http, AUTH_ENDPOINTS.login)).flush(makeUser());
    await vi.waitFor(() => expect(router.url).toBe('/dashboard'));
  });

  it('explains rejected credentials and stays on the page', async () => {
    await openLogin();
    type('input[type="email"]', 'archivist@example.test');
    type('input[autocomplete="current-password"]', 'wrong');
    submit();

    flushError(await nextRequest(http, AUTH_ENDPOINTS.login), 401, 'Invalid credentials');
    await vi.waitFor(() =>
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        'Incorrect email or password.',
      ),
    );
    expect(router.url).toBe('/login');
  });

  it('explains rate limiting', async () => {
    await openLogin();
    type('input[type="email"]', 'archivist@example.test');
    type('input[autocomplete="current-password"]', 'secret');
    submit();

    flushError(await nextRequest(http, AUTH_ENDPOINTS.login), 429, 'ThrottlerException');
    await vi.waitFor(() =>
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        'Too many sign-in attempts',
      ),
    );
  });

  it('says how long a locked email has to wait', async () => {
    await openLogin();
    type('input[type="email"]', 'archivist@example.test');
    type('input[autocomplete="current-password"]', 'secret');
    submit();

    flushError(
      await nextRequest(http, AUTH_ENDPOINTS.login),
      429,
      'Too many failed sign-ins for this email. Try again in 14 minutes.',
      'LOGIN_LOCKED',
    );
    await vi.waitFor(() =>
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        'Too many failed sign-ins for this email. Try again in 14 minutes.',
      ),
    );
  });

  it('can reveal the password', async () => {
    await openLogin();
    const password = page.querySelector<HTMLInputElement>('input[autocomplete="current-password"]');
    expect(password?.type).toBe('password');

    page.querySelector<HTMLButtonElement>('button[aria-label="Show password"]')?.click();
    await harness.fixture.whenStable();

    expect(password?.type).toBe('text');
    expect(page.querySelector('button[aria-label="Hide password"]')).not.toBeNull();
  });
});
