import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormField, FormRoot, form, minLength, required, validate } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth-service';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type SessionDto, isNotFoundError, toApiError } from '../../shared/models';
import { timeAgo } from '../../shared/text/relative-time';
import { AccountApi, MIN_PASSWORD_LENGTH } from './account-api';
import { describeUserAgent } from './user-agent';

interface PasswordChange {
  currentPassword: string;
  newPassword: string;
  repeatPassword: string;
}

const EMPTY_CHANGE: PasswordChange = { currentPassword: '', newPassword: '', repeatPassword: '' };

/** Settings → Your account: the password, and the browsers signed in to the archive. */
@Component({
  selector: 'app-account-settings',
  imports: [
    DatePipe,
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
  templateUrl: './account-settings.html',
  styleUrl: './account-settings.scss',
})
export class AccountSettings {
  private readonly api = inject(AccountApi);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifyService);

  protected readonly user = this.auth.currentUser;
  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly passwordsHidden = signal(true);
  protected readonly submitError = signal<string | null>(null);

  private readonly passwords = signal<PasswordChange>(EMPTY_CHANGE);

  protected readonly passwordForm = form(
    this.passwords,
    (fields) => {
      required(fields.currentPassword, { message: 'Enter your current password.' });
      required(fields.newPassword, { message: 'Enter a new password.' });
      minLength(fields.newPassword, MIN_PASSWORD_LENGTH, {
        message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      required(fields.repeatPassword, { message: 'Type the new password again.' });
      validate(fields.repeatPassword, ({ value, valueOf }) =>
        value() === '' || value() === valueOf(fields.newPassword)
          ? undefined
          : { kind: 'mismatch', message: 'The two new passwords differ.' },
      );
    },
    { submission: { action: () => this.changePassword() } },
  );

  protected readonly sessions = rxResource({ stream: () => this.api.sessions() });
  /** "Active … ago" is measured from the moment the list was read. */
  private readonly listedAt = signal(new Date());
  protected readonly sessionsError = computed(() => toApiError(this.sessions.error()).message);
  protected readonly otherSessions = computed(
    () => (this.sessions.value() ?? []).filter((session) => !session.current).length,
  );
  protected readonly busySessionId = signal<string | null>(null);
  protected readonly signingOutOthers = signal(false);

  protected togglePasswordVisibility(): void {
    this.passwordsHidden.update((hidden) => !hidden);
  }

  protected browser(session: SessionDto): string {
    return describeUserAgent(session.userAgent);
  }

  protected lastActive(session: SessionDto): string {
    return session.current
      ? 'Active now'
      : `Active ${timeAgo(session.lastSeenAt, this.listedAt())}`;
  }

  protected async signOut(session: SessionDto): Promise<void> {
    this.busySessionId.set(session.id);
    try {
      await firstValueFrom(this.api.revokeSession(session.id));
      this.notify.success(`${this.browser(session)} was signed out.`);
    } catch (error) {
      // Already gone (expired or signed out elsewhere): the reload shows it.
      if (!isNotFoundError(error)) {
        this.notify.error(toApiError(error).message);
      }
    } finally {
      this.busySessionId.set(null);
      this.reloadSessions();
    }
  }

  protected async signOutOthers(): Promise<void> {
    const count = this.otherSessions();
    const confirmed = await this.confirm.ask({
      title: 'Sign out the other browsers?',
      message: `${count === 1 ? 'The other browser has' : `The ${count} other browsers have`} to sign in again. This browser stays signed in.`,
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    this.signingOutOthers.set(true);
    try {
      const { revoked } = await firstValueFrom(this.api.revokeOtherSessions());
      this.notify.success(
        revoked === 1 ? 'One browser was signed out.' : `${revoked} browsers were signed out.`,
      );
    } catch (error) {
      this.notify.error(toApiError(error).message);
    } finally {
      this.signingOutOthers.set(false);
      this.reloadSessions();
    }
  }

  private async changePassword(): Promise<void> {
    this.submitError.set(null);
    const { currentPassword, newPassword } = this.passwords();
    try {
      await firstValueFrom(this.api.changePassword({ currentPassword, newPassword }));
    } catch (error) {
      this.submitError.set(toApiError(error).message);
      return;
    }
    this.passwordForm().reset(EMPTY_CHANGE);
    this.notify.success('Password changed. Other browsers were signed out.');
    this.reloadSessions();
  }

  private reloadSessions(): void {
    this.listedAt.set(new Date());
    this.sessions.reload();
  }
}
