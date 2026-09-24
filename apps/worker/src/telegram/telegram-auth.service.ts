import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TelegramAccount } from '@tam/database';
import { type SecretBox, SecretBoxError } from '@tam/crypto';
import { PrismaService } from '@tam/database/nest';
import {
  TELEGRAM_ACCOUNT_KEY,
  TelegramAuthState,
  TelegramErrorCode,
  phoneNumberSchema,
} from '@tam/shared';
import {
  AuthRequiredError,
  LoginStepError,
  TelegramError,
  type TelegramUser,
} from '@tam/telegram';
import { maskPhoneNumber } from './phone.js';
import { SECRET_BOX, TELEGRAM_API_PROVIDER, type TelegramApiProvider } from './telegram.tokens.js';

/** Single-tenant: the one Telegram account of this deployment. */
export const ACCOUNT_KEY = TELEGRAM_ACCOUNT_KEY;
/** A pending login (code sent, password asked) is abandoned after this long. */
export const PENDING_LOGIN_TTL_MS = 15 * 60_000;

const PHONE_CONTEXT = 'telegram_accounts.phone';
const CODE_HASH_CONTEXT = 'telegram_accounts.phone_code_hash';

const CLEARED_PENDING_LOGIN = {
  phoneEnc: null,
  phoneCodeHashEnc: null,
  codeExpiresAt: null,
  codeType: null,
  nextCodeType: null,
  codeResendAt: null,
} as const;

/**
 * The web-driven Telegram login as a persistent state machine:
 * LOGGED_OUT → CODE_SENT → (PASSWORD_REQUIRED) → READY. Each step arrives in its own HTTP
 * request, so the state (with the phone number and phone_code_hash encrypted) lives in
 * telegram_accounts and survives worker restarts. Operations run one at a time.
 */
@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
  ) {}

  /** Reconciles the stored state with Telegram after (re)connecting. */
  initialize(now = new Date()): Promise<TelegramAuthState> {
    return this.exclusive(async () => {
      const account = await this.account();
      const user = await this.telegram.api.getAuthorizedUser();
      if (user) {
        await this.markReady(user);
        return TelegramAuthState.READY;
      }
      if (isPendingLogin(account) && !isExpired(account, now)) {
        return account.authState;
      }
      if (account.authState !== TelegramAuthState.LOGGED_OUT || account.phoneMasked !== null) {
        await this.markLoggedOut(
          account.authState === TelegramAuthState.READY
            ? 'The Telegram session is no longer valid; log in again'
            : null,
        );
      }
      return TelegramAuthState.LOGGED_OUT;
    });
  }

  submitPhone(phoneNumber: string, now = new Date()): Promise<TelegramAuthState> {
    return this.exclusive(async () => {
      const account = await this.account();
      if (account.authState === TelegramAuthState.READY) {
        throw invalidState('Already logged in to Telegram. Log out first to use another account.');
      }
      const parsed = phoneNumberSchema.safeParse(phoneNumber);
      if (!parsed.success) {
        throw new LoginStepError(
          TelegramErrorCode.PHONE_NUMBER_INVALID,
          'Enter the phone number in international format, e.g. +84 912 345 678',
        );
      }
      const phone = parsed.data;
      const result = await this.telegram.api.sendCode(phone);
      if (result.kind === 'authorized') {
        await this.markReady(result.user);
        return TelegramAuthState.READY;
      }
      const box = this.requireBox();
      await this.update({
        authState: TelegramAuthState.CODE_SENT,
        phoneEnc: box.sealString(phone, PHONE_CONTEXT),
        phoneMasked: maskPhoneNumber(phone),
        phoneCodeHashEnc: box.sealString(result.phoneCodeHash, CODE_HASH_CONTEXT),
        codeType: result.codeType,
        nextCodeType: result.nextCodeType,
        codeResendAt: new Date(now.getTime() + result.resendAfterSeconds * 1000),
        codeExpiresAt: new Date(now.getTime() + PENDING_LOGIN_TTL_MS),
        lastError: null,
      });
      return TelegramAuthState.CODE_SENT;
    });
  }

  submitCode(code: string, now = new Date()): Promise<TelegramAuthState> {
    return this.exclusive(async () => {
      const account = await this.pendingAccount(TelegramAuthState.CODE_SENT, now);
      const { phone, codeHash } = await this.pendingSecrets(account);
      try {
        const result = await this.telegram.api.signIn(phone, codeHash, code);
        if (result.kind === 'authorized') {
          await this.markReady(result.user);
          return TelegramAuthState.READY;
        }
        await this.update({
          authState: TelegramAuthState.PASSWORD_REQUIRED,
          phoneCodeHashEnc: null,
          lastError: null,
        });
        return TelegramAuthState.PASSWORD_REQUIRED;
      } catch (error) {
        if (error instanceof LoginStepError && error.code === TelegramErrorCode.PHONE_CODE_EXPIRED) {
          await this.markLoggedOut(null);
        }
        throw error;
      }
    });
  }

  resendCode(now = new Date()): Promise<TelegramAuthState> {
    return this.exclusive(async () => {
      const account = await this.pendingAccount(TelegramAuthState.CODE_SENT, now);
      const { phone, codeHash } = await this.pendingSecrets(account);
      const result = await this.telegram.api.resendCode(phone, codeHash);
      if (result.kind === 'authorized') {
        await this.markReady(result.user);
        return TelegramAuthState.READY;
      }
      await this.update({
        phoneCodeHashEnc: this.requireBox().sealString(result.phoneCodeHash, CODE_HASH_CONTEXT),
        codeType: result.codeType,
        nextCodeType: result.nextCodeType,
        codeResendAt: new Date(now.getTime() + result.resendAfterSeconds * 1000),
        codeExpiresAt: new Date(now.getTime() + PENDING_LOGIN_TTL_MS),
        lastError: null,
      });
      return TelegramAuthState.CODE_SENT;
    });
  }

  submitPassword(password: string, now = new Date()): Promise<TelegramAuthState> {
    return this.exclusive(async () => {
      await this.pendingAccount(TelegramAuthState.PASSWORD_REQUIRED, now);
      await this.markReady(await this.telegram.api.checkPassword(password));
      return TelegramAuthState.READY;
    });
  }

  /** Logs out of Telegram (or cancels a pending login) and forgets the cached chat list. */
  logout(): Promise<TelegramAuthState> {
    return this.exclusive(async () => {
      const account = await this.account();
      if (account.authState === TelegramAuthState.READY) {
        try {
          await this.telegram.api.logOut();
        } catch (error) {
          if (!(error instanceof AuthRequiredError)) {
            throw error;
          }
        }
      }
      await this.prisma.$transaction([
        this.prisma.telegramAccount.update({
          where: { accountKey: ACCOUNT_KEY },
          data: loggedOutData(null),
        }),
        this.prisma.telegramDialog.deleteMany({}),
      ]);
      return TelegramAuthState.LOGGED_OUT;
    });
  }

  /** Called when Telegram says the session is gone (e.g. terminated from a phone). */
  markSessionRevoked(): Promise<void> {
    return this.exclusive(() => this.markLoggedOut('The Telegram session was revoked; log in again'));
  }

  async requireReady(): Promise<void> {
    const account = await this.account();
    if (account.authState !== TelegramAuthState.READY) {
      throw new LoginStepError(TelegramErrorCode.TELEGRAM_NOT_READY, 'Log in to Telegram first');
    }
  }

  /** Serializes operations: a double-submitted step can never interleave with another. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private account(): Promise<TelegramAccount> {
    return this.prisma.telegramAccount.upsert({
      where: { accountKey: ACCOUNT_KEY },
      create: { accountKey: ACCOUNT_KEY },
      update: {},
    });
  }

  private async pendingAccount(expected: TelegramAuthState, now: Date): Promise<TelegramAccount> {
    const account = await this.account();
    if (account.authState !== expected) {
      throw invalidState(
        expected === TelegramAuthState.CODE_SENT
          ? 'No login code is pending. Enter your phone number first.'
          : 'No password is expected right now. Enter your phone number first.',
      );
    }
    if (isExpired(account, now)) {
      await this.markLoggedOut(null);
      throw new LoginStepError(
        TelegramErrorCode.PHONE_CODE_EXPIRED,
        'The login attempt has expired. Start again with your phone number.',
      );
    }
    return account;
  }

  private async pendingSecrets(account: TelegramAccount): Promise<{ phone: string; codeHash: string }> {
    const box = this.requireBox();
    try {
      if (!account.phoneEnc || !account.phoneCodeHashEnc) {
        throw new SecretBoxError('Pending login data is missing');
      }
      return {
        phone: box.openString(account.phoneEnc, PHONE_CONTEXT),
        codeHash: box.openString(account.phoneCodeHashEnc, CODE_HASH_CONTEXT),
      };
    } catch (error) {
      if (!(error instanceof SecretBoxError)) {
        throw error;
      }
      this.logger.warn(`Discarding a pending login that cannot be read: ${error.message}`);
      await this.markLoggedOut('The pending login could not be read; start again');
      throw invalidState('The pending login is no longer valid. Start again with your phone number.');
    }
  }

  private requireBox(): SecretBox {
    if (!this.box) {
      throw new TelegramError('Telegram is not configured on the worker', TelegramErrorCode.TELEGRAM_ERROR);
    }
    return this.box;
  }

  private async markReady(user: TelegramUser): Promise<void> {
    await this.update({
      authState: TelegramAuthState.READY,
      telegramUserId: BigInt(user.id),
      username: user.username,
      displayName: user.displayName,
      lastError: null,
      ...CLEARED_PENDING_LOGIN,
    });
    this.logger.log(`Logged in to Telegram as ${user.username ? `@${user.username}` : user.displayName}`);
  }

  private async markLoggedOut(lastError: string | null): Promise<void> {
    await this.update(loggedOutData(lastError));
  }

  private async update(data: Parameters<PrismaService['telegramAccount']['update']>[0]['data']): Promise<void> {
    await this.prisma.telegramAccount.update({ where: { accountKey: ACCOUNT_KEY }, data });
  }
}

function loggedOutData(lastError: string | null) {
  return {
    authState: TelegramAuthState.LOGGED_OUT,
    telegramUserId: null,
    username: null,
    displayName: null,
    phoneMasked: null,
    lastError,
    ...CLEARED_PENDING_LOGIN,
  };
}

function isPendingLogin(account: TelegramAccount): boolean {
  return (
    account.authState === TelegramAuthState.CODE_SENT ||
    account.authState === TelegramAuthState.PASSWORD_REQUIRED
  );
}

function isExpired(account: TelegramAccount, now: Date): boolean {
  return account.codeExpiresAt === null || account.codeExpiresAt.getTime() <= now.getTime();
}

function invalidState(message: string): LoginStepError {
  return new LoginStepError(TelegramErrorCode.INVALID_LOGIN_STATE, message);
}
