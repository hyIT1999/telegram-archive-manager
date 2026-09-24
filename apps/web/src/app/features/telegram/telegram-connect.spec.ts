import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  flushError,
  makeReadyStatus,
  makeTelegramStatus,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { TELEGRAM_ENDPOINTS } from './telegram-api';
import { TelegramConnect } from './telegram-connect';
import { TELEGRAM_POLLING, type TelegramPolling, TelegramSession } from './telegram-session';

/** Long enough that no poll happens unless a test asks for it. */
const NO_POLLING: TelegramPolling = { statusMs: 60_000, chatsMs: 60_000 };

describe('TelegramConnect', () => {
  let fixture: ComponentFixture<TelegramConnect>;
  let http: HttpTestingController;
  const notify = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
  const confirm = { ask: vi.fn<() => Promise<boolean>>() };

  function setup(polling: TelegramPolling = NO_POLLING): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        TelegramSession,
        { provide: TELEGRAM_POLLING, useValue: polling },
        { provide: NotifyService, useValue: notify },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TelegramConnect);
    TestBed.tick();
  }

  beforeEach(() => {
    notify.success.mockReset();
    notify.info.mockReset();
    confirm.ask.mockReset();
  });

  afterEach(() => http.verify());

  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent ?? '';
  const button = (label: string) =>
    Array.from(page().querySelectorAll('button')).find((item) =>
      item.textContent?.includes(label),
    );

  async function showStatus(status = makeTelegramStatus()): Promise<void> {
    http.expectOne(TELEGRAM_ENDPOINTS.status).flush(status);
    await fixture.whenStable();
  }

  function type(selector: string, value: string): void {
    const input = page().querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`No input ${selector}`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function submit(): void {
    page().querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  const codeSent = (overrides = {}) =>
    makeTelegramStatus({
      state: 'CODE_SENT',
      phoneMasked: '+84•••••••78',
      codeType: 'app',
      nextCodeType: 'sms',
      codeResendAt: new Date(Date.now() - 1_000).toISOString(),
      ...overrides,
    });

  it('checks the connection, then asks for the phone number', async () => {
    setup();
    fixture.detectChanges();
    expect(page().querySelector('app-skeleton')).not.toBeNull();

    await showStatus();
    expect(page().querySelector('input[type="tel"]')).not.toBeNull();
    expect(button('Send code')?.disabled).toBe(false);
    expect(text()).toContain('never stored');
  });

  it('signs in with phone number, code and two-step password', async () => {
    setup();
    await showStatus();

    type('input[type="tel"]', '+84 912 345 678');
    submit();
    const phone = await nextRequest(http, TELEGRAM_ENDPOINTS.authenticate);
    expect(phone.request.body).toEqual({ step: 'phone', phoneNumber: '+84 912 345 678' });
    phone.flush(codeSent());
    await vi.waitFor(() => expect(text()).toContain('Telegram sent a login code to your Telegram app'));
    expect(text()).toContain('+84•••••••78');

    type('input[autocomplete="one-time-code"]', ' 12345 ');
    submit();
    const code = await nextRequest(http, TELEGRAM_ENDPOINTS.authenticate);
    expect(code.request.body).toEqual({ step: 'code', code: '12345' });
    code.flush(makeTelegramStatus({ state: 'PASSWORD_REQUIRED', phoneMasked: '+84•••••••78' }));
    await vi.waitFor(() => expect(text()).toContain('two-step verification'));

    type('input[autocomplete="off"]', 'correct horse');
    submit();
    const password = await nextRequest(http, TELEGRAM_ENDPOINTS.authenticate);
    expect(password.request.body).toEqual({ step: 'password', password: 'correct horse' });
    password.flush(makeReadyStatus());

    await vi.waitFor(() => expect(page().querySelector('.account-name')?.textContent).toContain('An Archivist'));
    expect(page().querySelector('.account-details')?.textContent).toContain('@archivist · +84•••••••78');
    expect(notify.success).toHaveBeenCalledExactlyOnceWith('Connected to Telegram as An Archivist.');
    expect(page().querySelector('form')).toBeNull();
  });

  it('checks the phone number before contacting the worker', async () => {
    setup();
    await showStatus();

    type('input[type="tel"]', 'call me maybe');
    submit();
    await fixture.whenStable();

    http.expectNone(TELEGRAM_ENDPOINTS.authenticate);
    expect(text()).toContain('international format');
  });

  it('explains a rejected code and stays on the code step', async () => {
    setup();
    await showStatus(codeSent());

    type('input[autocomplete="one-time-code"]', '11111');
    submit();
    flushError(
      await nextRequest(http, TELEGRAM_ENDPOINTS.authenticate),
      422,
      'The code is not correct',
      'PHONE_CODE_INVALID',
    );

    await vi.waitFor(() =>
      expect(page().querySelector('app-notice[role="alert"]')?.textContent).toContain(
        'The code is not correct',
      ),
    );
    expect(page().querySelector('input[autocomplete="one-time-code"]')).not.toBeNull();
  });

  it('turns a Telegram flood wait into a readable delay', async () => {
    setup();
    await showStatus(codeSent());

    button('Send the code by SMS')?.click();
    const resend = await nextRequest(http, TELEGRAM_ENDPOINTS.authenticate);
    expect(resend.request.body).toEqual({ step: 'resend' });
    flushError(resend, 429, 'Telegram asks to wait 3700 s', 'FLOOD_WAIT', {
      retryAfterSeconds: 3_700,
    });

    await vi.waitFor(() =>
      expect(text()).toContain('Telegram asks to wait 1 hour 2 minutes before the next attempt.'),
    );
  });

  it('offers another code only when Telegram allows it', async () => {
    setup();
    await showStatus(codeSent({ codeResendAt: new Date(Date.now() + 90_000).toISOString() }));

    const resend = button('Send the code by SMS');
    expect(resend?.disabled).toBe(true);
    expect(resend?.textContent).toMatch(/\(1:(29|30)\)/);
  });

  it('hides "send again" when Telegram has no other way to deliver the code', async () => {
    setup();
    await showStatus(codeSent({ nextCodeType: 'none' }));

    expect(button('Send')).toBeUndefined();
    expect(button('Sign in')).toBeDefined();
  });

  it('re-reads the status when the login moved on meanwhile', async () => {
    setup();
    await showStatus(codeSent());

    type('input[autocomplete="one-time-code"]', '12345');
    submit();
    flushError(
      await nextRequest(http, TELEGRAM_ENDPOINTS.authenticate),
      409,
      'No login code is pending. Start again with your phone number.',
      'INVALID_LOGIN_STATE',
    );
    (await nextRequest(http, TELEGRAM_ENDPOINTS.status)).flush(makeTelegramStatus());

    await vi.waitFor(() => expect(page().querySelector('input[type="tel"]')).not.toBeNull());
    expect(text()).toContain('No login code is pending');
  });

  it('waits for the worker and notices when it is up', async () => {
    setup({ statusMs: 20, chatsMs: 20 });
    await showStatus(makeTelegramStatus({ worker: 'offline', connection: null }));

    expect(text()).toContain('The background worker is not running');
    expect(button('Send code')?.disabled).toBe(true);

    (await nextRequest(http, TELEGRAM_ENDPOINTS.status)).flush(makeTelegramStatus());
    await vi.waitFor(() => expect(button('Send code')?.disabled).toBe(false));
    expect(text()).not.toContain('The background worker is not running');
  });

  it('explains a worker without Telegram credentials', async () => {
    setup();
    await showStatus(
      makeTelegramStatus({
        connection: 'UNCONFIGURED',
        connectionDetail: 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set',
      }),
    );

    expect(text()).toContain('Telegram is not set up on the worker');
    expect(text()).toContain('TELEGRAM_API_ID and TELEGRAM_API_HASH are not set');
    expect(text()).toContain('README §4');
    expect(button('Send code')?.disabled).toBe(true);
  });

  it('logs out only after confirmation', async () => {
    setup();
    await showStatus(makeReadyStatus());

    confirm.ask.mockResolvedValueOnce(false);
    button('Log out of Telegram')?.click();
    await vi.waitFor(() => expect(confirm.ask).toHaveBeenCalledTimes(1));
    http.expectNone(TELEGRAM_ENDPOINTS.logout);

    confirm.ask.mockResolvedValueOnce(true);
    button('Log out of Telegram')?.click();
    (await nextRequest(http, TELEGRAM_ENDPOINTS.logout)).flush(makeTelegramStatus());

    await vi.waitFor(() => expect(page().querySelector('input[type="tel"]')).not.toBeNull());
    expect(notify.success).toHaveBeenCalledExactlyOnceWith('Logged out of Telegram.');
  });

  it('abandons a pending login without asking', async () => {
    setup();
    await showStatus(codeSent());

    button('Use another number')?.click();
    (await nextRequest(http, TELEGRAM_ENDPOINTS.logout)).flush(makeTelegramStatus());

    await vi.waitFor(() => expect(page().querySelector('input[type="tel"]')).not.toBeNull());
    expect(confirm.ask).not.toHaveBeenCalled();
  });

  it('shows why the account was signed out', async () => {
    setup();
    await showStatus(
      makeTelegramStatus({ lastError: 'The Telegram session was revoked; log in again' }),
    );

    expect(text()).toContain('The Telegram session was revoked; log in again');
  });

  it('shows an error state when the status cannot be read, and retries', async () => {
    setup();
    flushError(http.expectOne(TELEGRAM_ENDPOINTS.status), 500, 'boom');
    await fixture.whenStable();

    const errorState = page().querySelector('app-error-state');
    expect(errorState?.textContent).toContain('The Telegram status could not be loaded');
    errorState?.querySelector('button')?.click();
    TestBed.tick();
    http.expectOne(TELEGRAM_ENDPOINTS.status).flush(makeTelegramStatus());
    await fixture.whenStable();
    expect(page().querySelector('input[type="tel"]')).not.toBeNull();
  });
});
