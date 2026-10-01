import { describe, expect, it } from 'vitest';
import {
  telegramRpcChannels,
  createChannelRequestSchema,
  phoneNumberSchema,
  telegramAuthenticateRequestSchema,
  telegramRpcReplySchema,
  telegramRpcRequestSchema,
  workerHeartbeatSchema,
} from '../src/index.js';

describe('phoneNumberSchema', () => {
  it('normalizes common international formats to E.164', () => {
    expect(phoneNumberSchema.parse('+84 912 345 678')).toBe('+84912345678');
    expect(phoneNumberSchema.parse('84-912-345-678')).toBe('+84912345678');
    expect(phoneNumberSchema.parse(' +1 (415) 555-0100 ')).toBe('+14155550100');
  });

  it('rejects local-only, too short or non-numeric input', () => {
    for (const bad of ['0912345678x', '+0 123 456', '12345', 'call me', '+84912345678901234']) {
      expect(phoneNumberSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('telegramAuthenticateRequestSchema', () => {
  it('accepts each login step', () => {
    expect(telegramAuthenticateRequestSchema.parse({ step: 'phone', phoneNumber: '+84 90 1234567' })).toEqual({
      step: 'phone',
      phoneNumber: '+84901234567',
    });
    expect(telegramAuthenticateRequestSchema.parse({ step: 'code', code: ' 12345 ' })).toEqual({
      step: 'code',
      code: '12345',
    });
    expect(telegramAuthenticateRequestSchema.parse({ step: 'password', password: 'p' }).step).toBe('password');
    expect(telegramAuthenticateRequestSchema.parse({ step: 'resend' })).toEqual({ step: 'resend' });
  });

  it('rejects unknown steps and empty values', () => {
    expect(telegramAuthenticateRequestSchema.safeParse({ step: 'qr' }).success).toBe(false);
    expect(telegramAuthenticateRequestSchema.safeParse({ step: 'code', code: '' }).success).toBe(false);
    expect(telegramAuthenticateRequestSchema.safeParse({ step: 'password', password: '' }).success).toBe(false);
  });
});

describe('createChannelRequestSchema', () => {
  it('only takes a Telegram chat id', () => {
    expect(createChannelRequestSchema.parse({ telegramChatId: '-1001234567890' })).toEqual({
      telegramChatId: '-1001234567890',
    });
    expect(createChannelRequestSchema.safeParse({ telegramChatId: 'abc' }).success).toBe(false);
  });
});

describe('telegram RPC contract', () => {
  const id = '0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80';

  it('validates requests, including the reply channel prefix', () => {
    const request = {
      id,
      replyTo: `${telegramRpcChannels('tam').replyPrefix}api-1`,
      deadline: Date.now() + 30_000,
      call: { method: 'auth.code', code: '12345' },
    };
    expect(telegramRpcRequestSchema.parse(request).call.method).toBe('auth.code');
    expect(telegramRpcRequestSchema.safeParse({ ...request, replyTo: 'elsewhere' }).success).toBe(false);
    expect(
      telegramRpcRequestSchema.safeParse({ ...request, call: { method: 'auth.phone' } }).success,
    ).toBe(false);
  });

  it('names the channel whose forum topics to read', () => {
    const request = {
      id,
      replyTo: `${telegramRpcChannels('tam').replyPrefix}api-1`,
      deadline: Date.now() + 30_000,
      call: { method: 'topics.refresh', channelId: id },
    };
    expect(telegramRpcRequestSchema.parse(request).call).toEqual({
      method: 'topics.refresh',
      channelId: id,
    });
    expect(
      telegramRpcRequestSchema.safeParse({ ...request, call: { method: 'topics.refresh' } }).success,
    ).toBe(false);
  });

  it('names the chat to check as a backup chat, and the channel whose copies to verify', () => {
    const request = {
      id,
      replyTo: `${telegramRpcChannels('tam').replyPrefix}api-1`,
      deadline: Date.now() + 30_000,
      call: { method: 'backup.checkChat', telegramChatId: '-1001234567890' },
    };
    expect(telegramRpcRequestSchema.parse(request).call).toEqual(request.call);
    expect(
      telegramRpcRequestSchema.safeParse({
        ...request,
        call: { method: 'backup.checkChat', telegramChatId: '@backups' },
      }).success,
    ).toBe(false);
    expect(
      telegramRpcRequestSchema.parse({ ...request, call: { method: 'backup.verify', channelId: id } })
        .call,
    ).toEqual({ method: 'backup.verify', channelId: id });
  });

  it('distinguishes success and failure replies', () => {
    expect(telegramRpcReplySchema.parse({ id, ok: true })).toEqual({ id, ok: true });
    const failure = telegramRpcReplySchema.parse({
      id,
      ok: false,
      error: { code: 'FLOOD_WAIT', message: 'Wait', retryAfterSeconds: 30 },
    });
    expect(failure.ok).toBe(false);
    expect(telegramRpcReplySchema.safeParse({ id, ok: false }).success).toBe(false);
  });
});

describe('worker heartbeat with Telegram state', () => {
  it('accepts beats with and without the telegram field', () => {
    const beat = {
      ts: '2026-09-24T02:00:05.000Z',
      pid: 1,
      host: 'w',
      startedAt: '2026-09-24T02:00:00.000Z',
    };
    expect(workerHeartbeatSchema.parse(beat)).toEqual(beat);
    expect(
      workerHeartbeatSchema.parse({ ...beat, telegram: { state: 'CONNECTED', detail: null } }).telegram,
    ).toEqual({ state: 'CONNECTED', detail: null });
    expect(
      workerHeartbeatSchema.safeParse({ ...beat, telegram: { state: 'SLEEPING', detail: null } }).success,
    ).toBe(false);
  });
});
