import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { makeUser } from '../../../testing/fixtures';
import { answerSessionCheck } from '../../../testing/http';
import { authGuard } from './auth-guard';
import { guestGuard } from './guest-guard';

@Component({ selector: 'app-login-stub', template: 'login page' })
class LoginStub {}

@Component({ selector: 'app-private-stub', template: 'private page' })
class PrivateStub {}

describe('auth guards', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', canMatch: [guestGuard], component: LoginStub },
          {
            path: '',
            canMatch: [authGuard],
            children: [
              { path: 'dashboard', component: PrivateStub },
              { path: 'channels', component: PrivateStub },
            ],
          },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  describe('authGuard', () => {
    it('sends anonymous visitors to /login, remembering the page they asked for', async () => {
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl('/channels?cursor=abc', LoginStub);
      await answerSessionCheck(http, null);
      await navigation;

      expect(router.url).toBe('/login?returnUrl=%2Fchannels%3Fcursor%3Dabc');
    });

    it('lets signed-in users through', async () => {
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl('/channels', PrivateStub);
      await answerSessionCheck(http, makeUser());
      await navigation;

      expect(router.url).toBe('/channels');
    });

    it('checks the session only once across navigations', async () => {
      const harness = await RouterTestingHarness.create();
      const first = harness.navigateByUrl('/dashboard', PrivateStub);
      await answerSessionCheck(http, makeUser());
      await first;

      await harness.navigateByUrl('/channels', PrivateStub);
      http.expectNone('/api/auth/me');
      expect(router.url).toBe('/channels');
    });
  });

  describe('guestGuard', () => {
    it('shows the login page to anonymous visitors', async () => {
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl('/login', LoginStub);
      await answerSessionCheck(http, null);
      await navigation;

      expect(router.url).toBe('/login');
    });

    it('sends signed-in users to their return URL', async () => {
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl('/login?returnUrl=%2Fchannels', PrivateStub);
      await answerSessionCheck(http, makeUser());
      await navigation;

      expect(router.url).toBe('/channels');
    });

    it('ignores return URLs that leave the app', async () => {
      const harness = await RouterTestingHarness.create();
      const navigation = harness.navigateByUrl(
        '/login?returnUrl=%2F%2Fevil.example%2Fphish',
        PrivateStub,
      );
      await answerSessionCheck(http, makeUser());
      await navigation;

      expect(router.url).toBe('/dashboard');
    });
  });
});
