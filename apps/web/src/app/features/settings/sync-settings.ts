import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect, type MatSelectChange } from '@angular/material/select';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type SyncIntervalMinutes, toApiError } from '../../shared/models';
import { SYNC_INTERVAL_OPTIONS } from '../sync/sync-labels';
import { SettingsApi } from './settings-api';

/** How often channels that sync are checked for new messages (saved at once). */
@Component({
  selector: 'app-sync-settings',
  imports: [MatButton, MatFormField, MatIcon, MatLabel, MatOption, MatSelect, Notice, Skeleton],
  template: `
    @if (settings.error() && !settings.hasValue()) {
      <app-notice tone="error">{{ loadError() }}</app-notice>
      <button matButton="tonal" type="button" (click)="settings.reload()">
        <mat-icon>refresh</mat-icon>
        Try again
      </button>
    } @else if (interval(); as minutes) {
      <mat-form-field class="interval">
        <mat-label>Check for new messages</mat-label>
        <mat-select [value]="minutes" [disabled]="saving()" (selectionChange)="save($event)">
          @for (option of options; track option.minutes) {
            <mat-option [value]="option.minutes">{{ option.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (error(); as message) {
        <app-notice tone="error">{{ message }}</app-notice>
      } @else if (saved()) {
        <app-notice tone="success">Saved.</app-notice>
      }
    } @else {
      <app-skeleton variant="line" [count]="1" label="Loading the sync settings…" />
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 12px;
      justify-items: start;
    }

    .interval {
      width: min(100%, 280px);
    }
  `,
})
export class SyncSettingsPanel {
  private readonly api = inject(SettingsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly options = SYNC_INTERVAL_OPTIONS;
  protected readonly settings = rxResource({ stream: () => this.api.get() });
  protected readonly interval = computed<SyncIntervalMinutes | null>(() =>
    this.settings.hasValue() ? this.settings.value().sync.intervalMinutes : null,
  );
  protected readonly loadError = computed(() => toApiError(this.settings.error()).message);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(change: MatSelectChange<SyncIntervalMinutes>): void {
    const previous = this.interval();
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.api
      .update({ sync: { intervalMinutes: change.value } })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (settings) => {
          this.settings.set(settings);
          this.saved.set(true);
        },
        error: (error: unknown) => {
          this.error.set(toApiError(error).message);
          // Show the interval that is really saved.
          change.source.value = previous;
        },
      });
  }
}
