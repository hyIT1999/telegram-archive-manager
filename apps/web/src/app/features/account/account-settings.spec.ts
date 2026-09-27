import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth-service';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { flushError, makeSession, makeUser } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { ACCOUNT_ENDPOINTS } from './account-api';
import { AccountSettings } from './account-settings';

const OTHER = makeSession({
  id: '0199a0b1-0000-7000-8000-00000000a002',
  current: false,
  ip: '192.0.2.7',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
});

describe('AccountSettings', () => {
  let fixture: ComponentFixture<AccountSettings>;
  let http: HttpTestingController;
  let notify: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let confirm: { ask: ReturnType<typeof vi.fn> };

  const page = () => fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(page().querySelectorAll<HTMLButtonElement>('button'));
  // Icon ligatures (e.g. "logout") are part of a button's text.
  const button = (label: string) =>
    buttons().find((candidate) => candidate.textContent?.includes(label));

  function type(label: string, value: string): void {
    const field = Array.from(page().querySelectorAll('mat-form-field')).find((candidate) =>
      candidate.querySelector('mat-label')?.textContent?.includes(label),
    );
    const input = field?.querySelector('input');
    if (!input) {
      throw new Error(`no field ${label}`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function render(sessions = [makeSession(), OTHER]): Promise<void> {
    fixture = TestBed.createComponent(AccountSettings);
    fixture.detectChanges();
    (await nextRequest(http, ACCOUNT_ENDPOINTS.sessions)).flush(sessions);
    await fixture.whenStable();
  }

  beforeEach(() => {
    notify = { success: vi.fn(), error: vi.fn() };
    confirm = { ask: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: NotifyService, useValue: notify },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'currentUser').mockReturnValue(makeUser());
    vi.spyOn(auth, 'ensureSession').mockReturnValue(of(makeUser()));
  });

  afterEach(() => http.verify());

  it('lists the signed-in browsers, this one first and without a sign-out button', async () => {
    await render();
    const text = page().textContent ?? '';
    expect(text).toContain('Signed in as archivist@example.test · last sign-in');
    const rows = Array.from(page().querySelectorAll('.session'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Chrome on Windows');
    expect(rows[0]?.textContent).toContain('This browser');
    expect(rows[0]?.textContent).toContain('Active now');
    expect(rows[0]?.querySelector('button')).toBeNull();
    expect(rows[1]?.textContent).toContain('Firefox on Linux');
    expect(rows[1]?.textContent).toContain('192.0.2.7');
    expect(button('Sign out all other browsers')).toBeDefined();
  });

  it('hides "Sign out all other browsers" when this is the only one', async () => {
    await render([makeSession()]);
    expect(button('Sign out all other browsers')).toBeUndefined();
  });

  it('changes the password, then clears the form and reads the sessions again', async () => {
    await render();
    type('Current password', 'the old passphrase');
    type('New password', 'a new passphrase');
    type('New password again', 'a new passphrase');
    button('Change password')?.click();

    const change = await nextRequest(http, ACCOUNT_ENDPOINTS.password);
    expect(change.request.method).toBe('POST');
    expect(change.request.body).toEqual({
      currentPassword: 'the old passphrase',
      newPassword: 'a new passphrase',
    });
    change.flush(null, { status: 204, statusText: 'No Content' });
    (await nextRequest(http, ACCOUNT_ENDPOINTS.sessions)).flush([makeSession()]);
    await fixture.whenStable();

    expect(notify.success).toHaveBeenCalledWith(
      'Password changed. Other browsers were signed out.',
    );
    const inputs = Array.from(page().querySelectorAll<HTMLInputElement>('.password-form input'));
    expect(inputs.map((input) => input.value)).toEqual(['', '', '']);
  });

  it('checks the new password before sending anything', async () => {
    await render();
    type('Current password', 'the old passphrase');
    type('New password', 'short');
    type('New password again', 'different');
    button('Change password')?.click();
    await fixture.whenStable();

    const errors = Array.from(page().querySelectorAll('mat-error')).map((error) =>
      error.textContent?.trim(),
    );
    expect(errors).toEqual(['Use at least 12 characters.', 'The two new passwords differ.']);
    http.expectNone(ACCOUNT_ENDPOINTS.password);
  });

  it('shows why the server refused the change', async () => {
    await render();
    type('Current password', 'not my password');
    type('New password', 'a new passphrase');
    type('New password again', 'a new passphrase');
    button('Change password')?.click();

    flushError(
      await nextRequest(http, ACCOUNT_ENDPOINTS.password),
      422,
      'The current password is not correct.',
      'CURRENT_PASSWORD_WRONG',
    );
    await fixture.whenStable();
    expect(page().querySelector('app-notice')?.textContent).toContain(
      'The current password is not correct.',
    );
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('signs out another browser', async () => {
    await render();
    const row = page().querySelectorAll('.session')[1];
    row?.querySelector('button')?.click();

    const revoke = await nextRequest(http, `${ACCOUNT_ENDPOINTS.sessions}/${OTHER.id}`);
    expect(revoke.request.method).toBe('DELETE');
    revoke.flush(null, { status: 204, statusText: 'No Content' });
    (await nextRequest(http, ACCOUNT_ENDPOINTS.sessions)).flush([makeSession()]);
    await fixture.whenStable();

    expect(notify.success).toHaveBeenCalledWith('Firefox on Linux was signed out.');
    expect(page().querySelectorAll('.session')).toHaveLength(1);
  });

  it('signs out every other browser after asking', async () => {
    await render([makeSession(), OTHER, makeSession({ id: 'third', current: false })]);
    button('Sign out all other browsers')?.click();
    await vi.waitFor(() => expect(confirm.ask).toHaveBeenCalled());
    expect(confirm.ask.mock.calls[0]?.[0]).toMatchObject({
      message: 'The 2 other browsers have to sign in again. This browser stays signed in.',
      destructive: true,
    });

    const revoke = await nextRequest(http, ACCOUNT_ENDPOINTS.revokeOthers);
    expect(revoke.request.method).toBe('POST');
    revoke.flush({ revoked: 2 });
    (await nextRequest(http, ACCOUNT_ENDPOINTS.sessions)).flush([makeSession()]);
    await fixture.whenStable();
    expect(notify.success).toHaveBeenCalledWith('2 browsers were signed out.');
  });

  it('does nothing when the question is dismissed', async () => {
    confirm.ask.mockResolvedValue(false);
    await render();
    button('Sign out all other browsers')?.click();
    await vi.waitFor(() => expect(confirm.ask).toHaveBeenCalled());
    await fixture.whenStable();
    http.expectNone(ACCOUNT_ENDPOINTS.revokeOthers);
  });
});
