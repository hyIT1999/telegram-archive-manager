import { HttpErrorResponse } from '@angular/common/http';
import { makeDialog, makeTelegramStatus } from '../../../testing/fixtures';
import {
  codeDeliveryText,
  connectionNotice,
  filterChats,
  foldText,
  formatCountdown,
  formatWait,
  isNumericCode,
  resendLabel,
  telegramActionError,
} from './telegram-labels';

function httpError(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, url: '/api/telegram/authenticate' });
}

describe('telegram labels', () => {
  it.each([
    [1, '1 second'],
    [45, '45 seconds'],
    [60, '1 minute'],
    [150, '3 minutes'],
    [3_600, '1 hour'],
    [3_700, '1 hour 2 minutes'],
    [7_260, '2 hours 1 minute'],
  ])('formats a %i s wait as "%s"', (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });

  it('formats countdowns as m:ss', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(59.2)).toBe('1:00');
    expect(formatCountdown(725)).toBe('12:05');
  });

  it('describes how the code was delivered and how it can be resent', () => {
    expect(codeDeliveryText('app')).toContain('Telegram app');
    expect(codeDeliveryText('missed_call')).toContain('last digits');
    expect(codeDeliveryText('something_new')).toBe('Telegram sent a login code.');
    expect(resendLabel('sms')).toBe('Send the code by SMS');
    expect(resendLabel('call')).toBe('Call me with the code');
    expect(resendLabel('none')).toBeNull();
    expect(resendLabel(null)).toBeNull();
    expect(isNumericCode('sms')).toBe(true);
    expect(isNumericCode('sms_word')).toBe(false);
  });

  it('explains why the worker cannot reach Telegram', () => {
    expect(connectionNotice(makeTelegramStatus())).toBeNull();
    expect(connectionNotice(makeTelegramStatus({ worker: 'offline', connection: null }))).toMatchObject({
      tone: 'warning',
      title: 'The background worker is not running',
    });
    const unconfigured = connectionNotice(
      makeTelegramStatus({
        connection: 'UNCONFIGURED',
        connectionDetail: 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set',
      }),
    );
    expect(unconfigured?.message).toContain('TELEGRAM_API_ID and TELEGRAM_API_HASH are not set');
    expect(unconfigured?.message).toContain('README §4');
    expect(
      connectionNotice(makeTelegramStatus({ connection: 'ERROR', connectionDetail: 'Timed out' }))
        ?.message,
    ).toBe('Timed out. It keeps trying on its own.');
    expect(
      connectionNotice(makeTelegramStatus({ connection: 'STANDBY', connectionDetail: 'Starting' }))
        ?.message,
    ).toBe('The worker is starting.');
  });

  it('turns failed actions into sentences', () => {
    const flood = httpError(429, {
      message: 'Telegram asks to wait 3700 s before trying again',
      code: 'FLOOD_WAIT',
      details: { retryAfterSeconds: 3_700 },
    });
    expect(telegramActionError(flood)).toBe(
      'Telegram asks to wait 1 hour 2 minutes before the next attempt.',
    );
    expect(
      telegramActionError(httpError(429, { message: 'Too many requests', code: 'RATE_LIMITED' })),
    ).toBe('Too many attempts. Wait a minute, then try again.');
    expect(
      telegramActionError(
        httpError(400, {
          message: 'Request validation failed',
          code: 'VALIDATION_FAILED',
          details: [{ path: 'phoneNumber', message: 'Enter the phone number in international format' }],
        }),
      ),
    ).toBe('Enter the phone number in international format');
    expect(
      telegramActionError(httpError(422, { message: 'The code is not correct', code: 'PHONE_CODE_INVALID' })),
    ).toBe('The code is not correct');
  });

  it('matches chats without case or accents, by title or username, and by type', () => {
    const physics = makeDialog({ title: 'Học tập Vật Lý', type: 'SUPERGROUP' });
    const algebra = makeDialog({ title: 'Đại số', username: 'algebra_vn', type: 'GROUP' });
    const news = makeDialog({ title: 'Morning News', username: 'news', type: 'CHANNEL' });
    const chats = [physics, algebra, news];

    expect(foldText('  Đại SỐ ')).toBe('dai so');
    expect(filterChats(chats, 'hoc tap', 'all')).toEqual([physics]);
    expect(filterChats(chats, 'dai', 'all')).toEqual([algebra]);
    expect(filterChats(chats, 'ALGEBRA', 'all')).toEqual([algebra]);
    expect(filterChats(chats, '', 'channels')).toEqual([news]);
    expect(filterChats(chats, '', 'groups')).toEqual([physics, algebra]);
    expect(filterChats(chats, 'news', 'groups')).toEqual([]);
  });
});
