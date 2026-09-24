import { Component, inject, input, signal } from '@angular/core';
import { FormField, FormRoot, email, form, required } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { APP_NAME } from '../../core/app-info';
import { AuthService } from '../../core/auth/auth-service';
import { safeReturnUrl } from '../../core/auth/return-url';
import { toApiError } from '../../shared/models';

interface Credentials {
  email: string;
  password: string;
}

@Component({
  selector: 'app-login-page',
  imports: [
    FormField,
    FormRoot,
    MatButton,
    MatError,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    MatSuffix,
  ],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  /** Query parameter `?returnUrl=`, bound by the router; validated before use. */
  readonly returnUrl = input<string>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly appName = APP_NAME;
  protected readonly passwordHidden = signal(true);
  protected readonly submitError = signal<string | null>(null);

  private readonly credentials = signal<Credentials>({ email: '', password: '' });

  protected readonly loginForm = form(
    this.credentials,
    (fields) => {
      required(fields.email, { message: 'Enter your email address.' });
      email(fields.email, { message: 'Enter a valid email address.' });
      required(fields.password, { message: 'Enter your password.' });
    },
    { submission: { action: () => this.signIn() } },
  );

  protected togglePasswordVisibility(): void {
    this.passwordHidden.update((hidden) => !hidden);
  }

  private async signIn(): Promise<void> {
    this.submitError.set(null);
    const { email: address, password } = this.credentials();
    try {
      await firstValueFrom(this.auth.login({ email: address.trim(), password }));
    } catch (error) {
      this.submitError.set(signInErrorMessage(error));
      return;
    }
    await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
  }
}

function signInErrorMessage(error: unknown): string {
  const apiError = toApiError(error);
  switch (apiError.status) {
    case 400:
      return 'Check your email address and password, then try again.';
    case 401:
      return 'Incorrect email or password.';
    case 429:
      return 'Too many sign-in attempts. Wait a minute, then try again.';
    default:
      return apiError.message;
  }
}
