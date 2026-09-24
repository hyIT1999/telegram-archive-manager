import { Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { FormField, FormRoot, form, pattern, required } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type TelegramAuthenticateRequest, toApiError } from '../../shared/models';
import { channelInitials } from '../channels/channel-labels';
import { TelegramApi } from './telegram-api';
import {
  codeDeliveryText,
  connectionNotice,
  formatCountdown,
  isNumericCode,
  resendLabel,
  telegramActionError,
} from './telegram-labels';
import { TelegramSession } from './telegram-session';

/** A loose check before asking the api, which normalizes the number and has the final say. */
const PHONE_PATTERN = /^\s*\+?[\s().-]*[1-9](?:[\s().-]*[0-9]){6,14}[\s().-]*$/;
const CODE_PATTERN = /^\s*[0-9A-Za-z][0-9A-Za-z -]{2,63}\s*$/;

type TelegramAction = 'phone' | 'code' | 'password' | 'resend' | 'logout' | 'cancel';

/**
 * Signs the archive in to Telegram (phone → code → two-step password) and shows the connected
 * account. Needs a TelegramSession from the page.
 */
@Component({
  selector: 'app-telegram-connect',
  imports: [
    ErrorState,
    FormField,
    FormRoot,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    MatSuffix,
    Notice,
    Skeleton,
  ],
  templateUrl: './telegram-connect.html',
  styleUrl: './telegram-connect.scss',
})
export class TelegramConnect {
  protected readonly session = inject(TelegramSession);
  private readonly api = inject(TelegramApi);
  private readonly confirmService = inject(ConfirmService);
  private readonly notify = inject(NotifyService);

  protected readonly pending = signal<TelegramAction | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly passwordHidden = signal(true);

  protected readonly notice = computed(() => {
    const status = this.session.status();
    return status ? connectionNotice(status) : null;
  });
  /** Every action is carried out by the worker, over its Telegram connection. */
  protected readonly canAct = computed(() => {
    const status = this.session.status();
    return status?.worker === 'online' && status.connection === 'CONNECTED';
  });
  protected readonly busy = computed(() => this.pending() !== null || !this.canAct());
  protected readonly loadErrorMessage = computed(() => toApiError(this.session.error()).message);

  protected readonly initials = computed(() =>
    channelInitials(this.session.status()?.user?.displayName ?? ''),
  );
  protected readonly accountDetails = computed(() => {
    const status = this.session.status();
    const username = status?.user?.username;
    return [username ? `@${username}` : null, status?.phoneMasked ?? null]
      .filter((part) => part !== null)
      .join(' · ');
  });

  protected readonly deliveryText = computed(() =>
    codeDeliveryText(this.session.status()?.codeType ?? null),
  );
  protected readonly resendText = computed(() =>
    resendLabel(this.session.status()?.nextCodeType ?? null),
  );
  protected readonly numericCode = computed(() =>
    isNumericCode(this.session.status()?.codeType ?? null),
  );

  /** The current time, re-read with every new status and by the countdown ticks. */
  private readonly now = linkedSignal(() => {
    this.session.status();
    return Date.now();
  });
  /** Seconds until Telegram accepts a request for another code. */
  protected readonly resendWait = computed(() => {
    const resendAt = this.session.status()?.codeResendAt;
    return resendAt ? Math.max(0, Math.ceil((Date.parse(resendAt) - this.now()) / 1000)) : 0;
  });
  protected readonly resendCountdown = computed(() => formatCountdown(this.resendWait()));

  private readonly phone = signal({ phoneNumber: '' });
  protected readonly phoneForm = form(
    this.phone,
    (fields) => {
      required(fields.phoneNumber, { message: 'Enter the phone number of your Telegram account.' });
      pattern(fields.phoneNumber, PHONE_PATTERN, {
        message: 'Enter the number in international format, e.g. +84 912 345 678.',
      });
    },
    { submission: { action: () => this.submitPhone() } },
  );

  private readonly code = signal({ code: '' });
  protected readonly codeForm = form(
    this.code,
    (fields) => {
      required(fields.code, { message: 'Enter the code Telegram sent you.' });
      pattern(fields.code, CODE_PATTERN, { message: 'Enter the code exactly as Telegram sent it.' });
    },
    { submission: { action: () => this.submitCode() } },
  );

  private readonly password = signal({ password: '' });
  protected readonly passwordForm = form(
    this.password,
    (fields) => {
      required(fields.password, { message: 'Enter your two-step verification password.' });
    },
    { submission: { action: () => this.submitPassword() } },
  );

  constructor() {
    // Ticks once a second while the resend countdown runs.
    effect((onCleanup) => {
      if (this.resendWait() === 0) {
        return;
      }
      const timer = setTimeout(() => this.now.set(Date.now()), 1_000);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected togglePassword(): void {
    this.passwordHidden.update((hidden) => !hidden);
  }

  protected async resend(): Promise<void> {
    if (await this.send('resend', { step: 'resend' })) {
      this.notify.info('A new code is on its way.');
    }
  }

  protected async logout(): Promise<void> {
    const confirmed = await this.confirmService.ask({
      title: 'Log out of Telegram?',
      message:
        'The archive cannot read your chats until you log in again. Everything already archived stays.',
      confirmLabel: 'Log out',
      destructive: true,
    });
    if (confirmed && (await this.signOut('logout'))) {
      this.notify.success('Logged out of Telegram.');
    }
  }

  /** Abandons the login in progress, e.g. to use another phone number. */
  protected async cancelLogin(): Promise<void> {
    await this.signOut('cancel');
  }

  private async submitPhone(): Promise<void> {
    await this.send('phone', { step: 'phone', phoneNumber: this.phone().phoneNumber.trim() });
  }

  private async submitCode(): Promise<void> {
    if (await this.send('code', { step: 'code', code: this.code().code.trim() })) {
      this.codeForm().reset({ code: '' });
    }
  }

  private async submitPassword(): Promise<void> {
    try {
      await this.send('password', { step: 'password', password: this.password().password });
    } finally {
      // The password is not kept in the page, whatever Telegram answered.
      this.passwordForm().reset({ password: '' });
    }
  }

  /** Sends one login step; true when Telegram accepted it. */
  private async send(
    action: TelegramAction,
    request: TelegramAuthenticateRequest,
  ): Promise<boolean> {
    if (this.busy()) {
      return false;
    }
    this.pending.set(action);
    this.actionError.set(null);
    try {
      const status = await firstValueFrom(this.api.authenticate(request));
      this.session.update(status);
      if (status.state === 'READY') {
        this.notify.success(
          `Connected to Telegram as ${status.user?.displayName ?? 'your account'}.`,
        );
      }
      return true;
    } catch (error) {
      this.showError(error);
      return false;
    } finally {
      this.pending.set(null);
    }
  }

  private async signOut(action: 'logout' | 'cancel'): Promise<boolean> {
    if (this.busy()) {
      return false;
    }
    this.pending.set(action);
    this.actionError.set(null);
    try {
      this.session.update(await firstValueFrom(this.api.logout()));
      return true;
    } catch (error) {
      this.showError(error);
      return false;
    } finally {
      this.pending.set(null);
    }
  }

  private showError(error: unknown): void {
    this.actionError.set(telegramActionError(error));
    // 409: the login moved on meanwhile (code expired, finished elsewhere, session revoked).
    if (toApiError(error).status === 409) {
      this.session.reload();
    }
  }
}
