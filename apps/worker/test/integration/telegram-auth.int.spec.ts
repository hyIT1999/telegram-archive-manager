import type { PrismaService } from '@tam/database/nest';
import { AuthRequiredError, LoginStepError } from '@tam/telegram';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_KEY,
  PENDING_LOGIN_TTL_MS,
  TelegramAuthService,
} from '../../src/telegram/telegram-auth.service.js';
import {
  TEST_USER,
  chat,
  createFakeTelegramApi,
  randomSecretBox,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';

const PHONE = '+84912345678';

describe('TelegramAuthService', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = testPrisma();
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetTelegramTables(prisma));

  function setup(box = randomSecretBox()) {
    const fake = createFakeTelegramApi();
    return { ...fake, box, auth: new TelegramAuthService(prisma, fake.provider, box) };
  }

  const account = () => prisma.telegramAccount.findUniqueOrThrow({ where: { accountKey: ACCOUNT_KEY } });

  it('logs in with phone and code, keeping the pending login encrypted', async () => {
    const { api, auth } = setup();
    const now = new Date('2026-09-24T10:00:00Z');

    await expect(auth.submitPhone('+84 912 345 678', now)).resolves.toBe('CODE_SENT');
    expect(api.sendCode).toHaveBeenCalledWith(PHONE);
    const pending = await account();
    expect(pending).toMatchObject({
      authState: 'CODE_SENT',
      phoneMasked: '+84•••••••78',
      codeType: 'app',
      nextCodeType: 'sms',
      codeResendAt: new Date(now.getTime() + 60_000),
      codeExpiresAt: new Date(now.getTime() + PENDING_LOGIN_TTL_MS),
    });
    expect(Buffer.from(pending.phoneEnc!).includes(Buffer.from(PHONE))).toBe(false);
    expect(Buffer.from(pending.phoneCodeHashEnc!).includes(Buffer.from(`hash-for-${PHONE}`))).toBe(false);

    await expect(auth.submitCode('12345', now)).resolves.toBe('READY');
    expect(api.signIn).toHaveBeenCalledWith(PHONE, `hash-for-${PHONE}`, '12345');
    expect(await account()).toMatchObject({
      authState: 'READY',
      telegramUserId: BigInt(TEST_USER.id),
      username: TEST_USER.username,
      displayName: TEST_USER.displayName,
      phoneEnc: null,
      phoneCodeHashEnc: null,
      codeExpiresAt: null,
      lastError: null,
    });
  });

  it('asks for the two-step verification password when needed', async () => {
    const { api, auth } = setup();
    api.signIn.mockResolvedValueOnce({ kind: 'password_required' });

    await auth.submitPhone(PHONE);
    await expect(auth.submitCode('12345')).resolves.toBe('PASSWORD_REQUIRED');
    expect(await account()).toMatchObject({ authState: 'PASSWORD_REQUIRED', phoneCodeHashEnc: null });

    await expect(auth.submitPassword('correct horse')).resolves.toBe('READY');
    expect(api.checkPassword).toHaveBeenCalledWith('correct horse');
  });

  it('keeps the login pending after a wrong code, and restarts after an expired one', async () => {
    const { api, auth } = setup();
    await auth.submitPhone(PHONE);

    api.signIn.mockRejectedValueOnce(new LoginStepError('PHONE_CODE_INVALID', 'The code is not correct'));
    await expect(auth.submitCode('00000')).rejects.toMatchObject({ code: 'PHONE_CODE_INVALID' });
    expect((await account()).authState).toBe('CODE_SENT');

    api.signIn.mockRejectedValueOnce(new LoginStepError('PHONE_CODE_EXPIRED', 'expired'));
    await expect(auth.submitCode('11111')).rejects.toMatchObject({ code: 'PHONE_CODE_EXPIRED' });
    expect(await account()).toMatchObject({ authState: 'LOGGED_OUT', phoneEnc: null });
  });

  it('abandons a pending login after its TTL without calling Telegram', async () => {
    const { api, auth } = setup();
    const sentAt = new Date('2026-09-24T10:00:00Z');
    await auth.submitPhone(PHONE, sentAt);

    const later = new Date(sentAt.getTime() + PENDING_LOGIN_TTL_MS + 1);
    await expect(auth.submitCode('12345', later)).rejects.toMatchObject({ code: 'PHONE_CODE_EXPIRED' });
    expect(api.signIn).not.toHaveBeenCalled();
    expect((await account()).authState).toBe('LOGGED_OUT');
  });

  it('rejects steps that do not fit the current state', async () => {
    const { api, auth } = setup();
    await expect(auth.submitCode('12345')).rejects.toMatchObject({ code: 'INVALID_LOGIN_STATE' });
    await expect(auth.submitPassword('pw')).rejects.toMatchObject({ code: 'INVALID_LOGIN_STATE' });
    await expect(auth.submitPhone('0912 abc')).rejects.toMatchObject({ code: 'PHONE_NUMBER_INVALID' });
    expect(api.sendCode).not.toHaveBeenCalled();

    await auth.submitPhone(PHONE);
    await auth.submitCode('12345');
    await expect(auth.submitPhone(PHONE)).rejects.toMatchObject({ code: 'INVALID_LOGIN_STATE' });
  });

  it('serializes concurrent submissions of the same step', async () => {
    const { api, auth } = setup();
    await auth.submitPhone(PHONE);
    const results = await Promise.allSettled([auth.submitCode('12345'), auth.submitCode('12345')]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(api.signIn).toHaveBeenCalledTimes(1);
  });

  it('resends the code with the new delivery details', async () => {
    const { api, auth } = setup();
    const now = new Date('2026-09-24T10:00:00Z');
    await auth.submitPhone(PHONE, now);
    await expect(auth.resendCode(now)).resolves.toBe('CODE_SENT');
    expect(api.resendCode).toHaveBeenCalledWith(PHONE, `hash-for-${PHONE}`);
    expect(await account()).toMatchObject({ codeType: 'sms', nextCodeType: 'call' });

    await auth.submitCode('12345', now);
    expect(api.signIn).toHaveBeenLastCalledWith(PHONE, 'hash-resent', '12345');
  });

  it('logs in directly when Telegram authorizes the number without a code', async () => {
    const { api, auth } = setup();
    api.sendCode.mockResolvedValueOnce({ kind: 'authorized', user: TEST_USER });
    await expect(auth.submitPhone(PHONE)).resolves.toBe('READY');
  });

  it('discards a pending login encrypted with another session key', async () => {
    const first = setup();
    await first.auth.submitPhone(PHONE);
    const second = setup(randomSecretBox());
    await expect(second.auth.submitCode('12345')).rejects.toMatchObject({ code: 'INVALID_LOGIN_STATE' });
    expect(second.api.signIn).not.toHaveBeenCalled();
    expect((await account()).authState).toBe('LOGGED_OUT');
  });

  describe('initialize', () => {
    it('trusts Telegram about an existing session', async () => {
      const { api, auth } = setup();
      api.getAuthorizedUser.mockResolvedValueOnce(TEST_USER);
      await expect(auth.initialize()).resolves.toBe('READY');
      expect((await account()).username).toBe(TEST_USER.username);
    });

    it('keeps a fresh pending login and reports a revoked session', async () => {
      const { auth } = setup();
      await auth.submitPhone(PHONE);
      await expect(auth.initialize()).resolves.toBe('CODE_SENT');

      await prisma.telegramAccount.update({ where: { accountKey: ACCOUNT_KEY }, data: { authState: 'READY' } });
      await expect(auth.initialize()).resolves.toBe('LOGGED_OUT');
      expect((await account()).lastError).toMatch(/no longer valid/);
    });
  });

  it('logs out, forgets the chat list and tolerates an already revoked session', async () => {
    const { api, auth } = setup();
    await auth.submitPhone(PHONE);
    await auth.submitCode('12345');
    await prisma.telegramDialog.create({
      data: { telegramChatId: BigInt(chat('-1001').id), title: 'x', type: 'CHANNEL' },
    });

    api.logOut.mockRejectedValueOnce(new AuthRequiredError());
    await expect(auth.logout()).resolves.toBe('LOGGED_OUT');
    expect(api.logOut).toHaveBeenCalledTimes(1);
    expect(await account()).toMatchObject({ authState: 'LOGGED_OUT', username: null, telegramUserId: null });
    expect(await prisma.telegramDialog.count()).toBe(0);
  });
});
