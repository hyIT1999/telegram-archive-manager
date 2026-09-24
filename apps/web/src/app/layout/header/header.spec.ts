import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { makeUser } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { AUTH_ENDPOINTS, AuthService } from '../../core/auth/auth-service';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { Header } from './header';

@Component({ selector: 'app-page-stub', template: '' })
class PageStub {}

describe('Header', () => {
  let fixture: ComponentFixture<Header>;
  let http: HttpTestingController;
  let router: Router;
  const confirm = { ask: vi.fn<ConfirmService['ask']>() };
  const notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

  beforeEach(async () => {
    confirm.ask.mockReset();
    notify.success.mockReset();
    notify.error.mockReset();
    TestBed.configureTestingModule({
      imports: [Header],
      providers: [
        provideRouter([{ path: '**', component: PageStub }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfirmService, useValue: confirm },
        { provide: NotifyService, useValue: notify },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);

    const auth = TestBed.inject(AuthService);
    const login = firstValueFrom(auth.login({ email: 'archivist@example.test', password: 'x' }));
    http.expectOne(AUTH_ENDPOINTS.login).flush(makeUser());
    await login;
    await router.navigateByUrl('/dashboard');

    fixture = TestBed.createComponent(Header);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const element = () => fixture.nativeElement as HTMLElement;

  async function openAccountMenu(): Promise<HTMLElement> {
    element().querySelector<HTMLButtonElement>('button[aria-label="Account menu"]')?.click();
    await fixture.whenStable();
    return vi.waitFor(() => {
      const panel = document.querySelector<HTMLElement>('.mat-mdc-menu-panel');
      if (!panel) {
        throw new Error('menu not open yet');
      }
      return panel;
    });
  }

  function menuItem(panel: HTMLElement, label: string): HTMLButtonElement {
    const item = Array.from(panel.querySelectorAll<HTMLButtonElement>('[mat-menu-item]')).find(
      (candidate) => candidate.textContent?.includes(label),
    );
    if (!item) {
      throw new Error(`No menu item "${label}"`);
    }
    return item;
  }

  it('shows the app name', () => {
    expect(element().querySelector('.brand')?.getAttribute('aria-label')).toContain(
      'Unofficial Telegram Archive Manager',
    );
  });

  it('searches the archive from the search box', async () => {
    const input = element().querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    input!.value = '  quantum physics ';
    input!.dispatchEvent(new Event('input'));
    element()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => expect(router.url).toBe('/search?q=quantum%20physics'));
  });

  it('shows the signed-in email in the account menu', async () => {
    const panel = await openAccountMenu();
    expect(panel.textContent).toContain('archivist@example.test');
  });

  it('logs out after confirmation, then toasts and returns to the login page', async () => {
    confirm.ask.mockResolvedValue(true);
    const panel = await openAccountMenu();
    menuItem(panel, 'Log out').click();

    const logout = await nextRequest(http, AUTH_ENDPOINTS.logout);
    expect(confirm.ask).toHaveBeenCalledOnce();
    logout.flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(router.url).toBe('/login'));
    expect(notify.success).toHaveBeenCalledOnce();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
  });

  it('stays signed in when the confirmation is declined', async () => {
    confirm.ask.mockResolvedValue(false);
    const panel = await openAccountMenu();
    menuItem(panel, 'Log out').click();

    await vi.waitFor(() => expect(confirm.ask).toHaveBeenCalledOnce());
    http.expectNone(AUTH_ENDPOINTS.logout);
    expect(router.url).toBe('/dashboard');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });
});
