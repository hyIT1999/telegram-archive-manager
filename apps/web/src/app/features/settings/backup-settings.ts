import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { toApiError } from '../../shared/models';
import { SettingsApi } from './settings-api';

/** Pausing every Telegram backup at once (saved at once). */
@Component({
  selector: 'app-backup-settings',
  imports: [MatButton, MatIcon, MatSlideToggle, Notice, Skeleton],
  template: `
    @if (settings.error() && !settings.hasValue()) {
      <app-notice tone="error">{{ loadError() }}</app-notice>
      <button matButton="tonal" type="button" (click)="settings.reload()">
        <mat-icon>refresh</mat-icon>
        Try again
      </button>
    } @else if (paused() !== null) {
      <mat-slide-toggle [checked]="paused()" [disabled]="saving()" (change)="togglePaused($event)">
        Pause all backups
      </mat-slide-toggle>
      <p class="hint">
        Stops every Telegram backup, messages asked for one by one included. A file cut off is
        uploaded again from the start later; nothing is sent twice.
      </p>
      @if (error(); as message) {
        <app-notice tone="error">{{ message }}</app-notice>
      }
    } @else {
      <app-skeleton variant="line" [count]="1" label="Loading the backup settings…" />
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 8px;
      justify-items: start;
    }

    .hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class BackupSettingsPanel {
  private readonly api = inject(SettingsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly settings = rxResource({ stream: () => this.api.get() });
  protected readonly paused = computed<boolean | null>(() =>
    this.settings.hasValue() ? this.settings.value().backups.paused : null,
  );
  protected readonly loadError = computed(() => toApiError(this.settings.error()).message);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected togglePaused(change: MatSlideToggleChange): void {
    this.saving.set(true);
    this.error.set(null);
    this.api
      .update({ backups: { paused: change.checked } })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (settings) => this.settings.set(settings),
        error: (error: unknown) => {
          this.error.set(toApiError(error).message);
          // Show the switch where it really is.
          change.source.checked = !change.checked;
        },
      });
  }
}
