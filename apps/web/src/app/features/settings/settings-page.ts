import { Component, inject } from '@angular/core';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { THEME_OPTIONS, type ThemeMode, ThemeService } from '../../core/services/theme-service';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { TelegramConnect } from '../telegram/telegram-connect';
import { TelegramSession } from '../telegram/telegram-session';

@Component({
  selector: 'app-settings-page',
  providers: [TelegramSession],
  imports: [
    EmptyState,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatIcon,
    PageHeader,
    TelegramConnect,
  ],
  template: `
    <app-page-header
      eyebrow="Manage"
      title="Settings"
      subtitle="How the archive looks and behaves."
    />

    <section class="surface-card panel" aria-labelledby="telegram-title">
      <h2 id="telegram-title" class="panel-title">Telegram account</h2>
      <p class="panel-hint">
        The account the archive reads channels and groups with. The worker keeps its session
        encrypted.
      </p>
      <app-telegram-connect />
    </section>

    <section class="surface-card panel" aria-labelledby="appearance-title">
      <h2 id="appearance-title" class="panel-title">Appearance</h2>
      <p class="panel-hint">Saved in this browser.</p>
      <mat-button-toggle-group
        aria-labelledby="appearance-title"
        hideSingleSelectionIndicator
        [value]="theme.mode()"
        (change)="selectTheme($event.value)"
      >
        @for (option of themeOptions; track option.mode) {
          <mat-button-toggle [value]="option.mode">
            <mat-icon>{{ option.icon }}</mat-icon>
            {{ option.label }}
          </mat-button-toggle>
        }
      </mat-button-toggle-group>
    </section>

    <section class="surface-card" aria-label="Archive settings">
      <app-empty-state
        icon="tune"
        note="Arrives in Phase 5"
        title="Archive settings are on their way"
        message="Automatic downloads, size and disk-space limits and the sync schedule become configurable here in Phase 5."
      />
    </section>
  `,
  styles: `
    :host {
      display: grid;
      gap: 24px;
    }

    app-page-header {
      margin-bottom: 8px;
    }

    .panel {
      padding: 24px;
    }

    .panel-title {
      font: var(--mat-sys-title-large);
    }

    .panel-hint {
      margin: 4px 0 16px;
      color: var(--mat-sys-on-surface-variant);
    }

    mat-button-toggle mat-icon {
      margin-inline-end: 6px;
      vertical-align: middle;
    }

    @media (max-width: 599.98px) {
      .panel {
        padding: 16px;
      }
    }
  `,
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly themeOptions = THEME_OPTIONS;

  protected selectTheme(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }
}
