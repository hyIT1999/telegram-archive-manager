import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatToolbar } from '@angular/material/toolbar';
import { MatTooltip } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { APP_NAME } from '../../core/app-info';
import { AuthService } from '../../core/auth/auth-service';
import { LOGIN_PATH } from '../../core/auth/return-url';
import { LiveEvents } from '../../core/live/live-events';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import { THEME_OPTIONS, ThemeService } from '../../core/services/theme-service';
import { FocusShortcut } from '../../shared/directives/focus-shortcut';
import { toApiError } from '../../shared/models';

@Component({
  selector: 'app-header',
  imports: [
    FocusShortcut,
    MatDivider,
    MatIcon,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatToolbar,
    MatTooltip,
    RouterLink,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  readonly showMenuToggle = input(false);
  readonly navOpen = input(false);
  readonly menuToggle = output();

  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly live = inject(LiveEvents);

  protected readonly appName = APP_NAME;
  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly email = computed(() => this.auth.currentUser()?.email ?? '');
  protected readonly themeIcon = computed(
    () => THEME_OPTIONS.find((option) => option.mode === this.theme.mode())?.icon ?? 'contrast',
  );
  protected readonly searchQuery = signal('');

  constructor() {
    // Mirror ?q= of the search page in the box (also after back/forward), clear it elsewhere.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        const q = this.router.parseUrl(this.router.url).queryParamMap.get('q');
        this.searchQuery.set(this.onSearchPage() ? (q ?? '') : '');
      });
  }

  protected search(event: Event): void {
    event.preventDefault();
    const q = this.searchQuery().trim();
    if (q) {
      // A new search on the search page keeps the filters chosen there.
      void this.router.navigate(['/search'], {
        queryParams: { q },
        queryParamsHandling: this.onSearchPage() ? 'merge' : undefined,
      });
    }
  }

  private onSearchPage(): boolean {
    const url = this.router.parseUrl(this.router.url);
    return url.root.children['primary']?.segments[0]?.path === 'search';
  }

  protected async logOut(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Log out?',
      message: 'You will need your email and password to sign in again.',
      confirmLabel: 'Log out',
    });
    if (!confirmed) {
      return;
    }
    try {
      await firstValueFrom(this.auth.logout());
    } catch (error) {
      const { status } = toApiError(error);
      // Network and server failures are already toasted by the HTTP interceptor.
      if (status !== null && status > 0 && status < 500) {
        this.notify.error('Logging out failed. Please try again.');
      }
      return;
    }
    this.notify.success('You have been logged out.');
    await this.router.navigateByUrl(LOGIN_PATH);
  }
}
