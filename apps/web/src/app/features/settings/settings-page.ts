import { Component, inject } from '@angular/core';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { THEME_OPTIONS, type ThemeMode, ThemeService } from '../../core/services/theme-service';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { AccountSettings } from '../account/account-settings';
import { StorageLocationList } from '../storage/storage-location-list';
import { TelegramConnect } from '../telegram/telegram-connect';
import { TelegramSession } from '../telegram/telegram-session';
import { BackupSettingsPanel } from './backup-settings';
import { DownloadSettingsPanel } from './download-settings';
import { SyncSettingsPanel } from './sync-settings';

@Component({
  selector: 'app-settings-page',
  providers: [TelegramSession],
  imports: [
    AccountSettings,
    BackupSettingsPanel,
    DownloadSettingsPanel,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatIcon,
    PageHeader,
    StorageLocationList,
    SyncSettingsPanel,
    TelegramConnect,
  ],
  template: `
    <app-page-header
      eyebrow="Manage"
      title="Settings"
      subtitle="How the archive looks and behaves."
    />

    <section id="account" class="surface-card panel" aria-labelledby="account-title">
      <h2 id="account-title" class="panel-title">Your account</h2>
      <p class="panel-hint">How you sign in to this archive, and where you are signed in.</p>
      <app-account-settings />
    </section>

    <section class="surface-card panel" aria-labelledby="telegram-title">
      <h2 id="telegram-title" class="panel-title">Telegram account</h2>
      <p class="panel-hint">
        The account the archive reads channels and groups with. The worker keeps its session
        encrypted.
      </p>
      <app-telegram-connect />
    </section>

    <section class="surface-card panel" aria-labelledby="storage-title">
      <h2 id="storage-title" class="panel-title">Storage locations</h2>
      <p class="panel-hint">
        Where archived media is saved: folders on this computer or Google Drive. Each channel uses
        one; the default applies to channels that did not choose. Telegram chats listed here receive
        backup copies of messages instead.
      </p>
      <app-storage-location-list />
    </section>

    <section class="surface-card panel" aria-labelledby="downloads-title">
      <h2 id="downloads-title" class="panel-title">Media downloads</h2>
      <p class="panel-hint">
        What downloads on its own, and how much at once. Each channel switches its automatic
        downloads on or off on its page.
      </p>
      <app-download-settings />
    </section>

    <section class="surface-card panel" aria-labelledby="sync-title">
      <h2 id="sync-title" class="panel-title">Sync</h2>
      <p class="panel-hint">
        Channels that sync get their new messages as soon as Telegram announces them. They are also
        checked on this schedule, which catches what arrived while the worker was stopped. Each
        channel switches its sync on or off on its page.
      </p>
      <app-sync-settings />
    </section>

    <section class="surface-card panel" aria-labelledby="backup-title">
      <h2 id="backup-title" class="panel-title">Telegram backup</h2>
      <p class="panel-hint">
        Copies of archived messages that the Telegram account posts in chats of its own, with their
        files uploaded again. Add the chats under Storage locations; each channel chooses its chat
        and switches its backup on its page.
      </p>
      <app-backup-settings />
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
