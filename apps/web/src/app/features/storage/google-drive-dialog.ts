import { Clipboard } from '@angular/cdk/clipboard';
import { Component, DestroyRef, InjectionToken, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { type GoogleDriveConnectDto, type StorageLocationDto, toApiError } from '../../shared/models';
import { formatCountdown } from '../telegram/telegram-labels';
import { StorageApi } from './storage-api';

/** Folder the app creates in My Drive unless another name is given (as on the server). */
export const DEFAULT_DRIVE_FOLDER = 'Unofficial Telegram Archive';

/** Delay before the next poll, from the interval Google asks for; tests shorten it. */
export const GOOGLE_POLL_DELAY = new InjectionToken<(seconds: number) => number>('GOOGLE_POLL_DELAY', {
  providedIn: 'root',
  factory: () => (seconds: number) => seconds * 1000,
});

export interface GoogleDriveDialogData {
  available: boolean;
  /** Why Google Drive cannot be connected (server settings). */
  reason: string | null;
  /** A Google Drive location to reconnect, or null to add a new one. */
  location: StorageLocationDto | null;
}

type Phase =
  | { kind: 'form' }
  | { kind: 'waiting'; flow: GoogleDriveConnectDto }
  | { kind: 'failed'; message: string };

/**
 * Connects a Google account with a code for google.com/device, then waits for the approval.
 * Closes with the created (or reconnected) location. Tokens never reach the browser.
 */
@Component({
  selector: 'app-google-drive-dialog',
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatHint,
    MatIcon,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    Notice,
  ],
  templateUrl: './google-drive-dialog.html',
  styleUrl: './google-drive-dialog.scss',
})
export class GoogleDriveDialog {
  protected readonly data = inject<GoogleDriveDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<GoogleDriveDialog, StorageLocationDto>>(MatDialogRef);
  private readonly api = inject(StorageApi);
  private readonly clipboard = inject(Clipboard);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pollDelay = inject(GOOGLE_POLL_DELAY);

  protected readonly reconnecting = this.data.location !== null;
  protected readonly name = signal(this.data.location?.name ?? 'Google Drive');
  protected readonly folderName = signal(DEFAULT_DRIVE_FOLDER);
  protected readonly starting = signal(false);
  protected readonly copied = signal(false);
  private readonly phase = signal<Phase>({ kind: 'form' });
  private readonly now = signal(Date.now());
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly showForm = computed(() => this.phase().kind === 'form');
  protected readonly flow = computed(() => {
    const phase = this.phase();
    return phase.kind === 'waiting' ? phase.flow : null;
  });
  protected readonly failure = computed(() => {
    const phase = this.phase();
    return phase.kind === 'failed' ? phase.message : null;
  });
  protected readonly remaining = computed(() => {
    const flow = this.flow();
    return flow ? formatCountdown(Math.max(0, (Date.parse(flow.expiresAt) - this.now()) / 1000)) : '';
  });

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
    // The expiry countdown ticks while a code is shown.
    effect((onCleanup) => {
      if (!this.flow()) {
        return;
      }
      this.now();
      const tick = setTimeout(() => this.now.set(Date.now()), 1_000);
      onCleanup(() => clearTimeout(tick));
    });
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onFolderName(event: Event): void {
    this.folderName.set((event.target as HTMLInputElement).value);
  }

  protected start(): void {
    if (this.starting() || !this.name().trim()) {
      return;
    }
    this.starting.set(true);
    const location = this.data.location;
    this.api
      .connectGoogle({
        name: this.name().trim(),
        folderName: this.folderName().trim() || DEFAULT_DRIVE_FOLDER,
        ...(location ? { locationId: location.id } : {}),
      })
      .pipe(
        finalize(() => this.starting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (flow) => {
          this.now.set(Date.now());
          this.phase.set({ kind: 'waiting', flow });
          this.schedule(flow.flowId, flow.intervalSeconds);
        },
        error: (error: unknown) => this.fail(toApiError(error).message),
      });
  }

  protected copy(code: string): void {
    this.copied.set(this.clipboard.copy(code));
  }

  protected retry(): void {
    this.copied.set(false);
    this.phase.set({ kind: 'form' });
  }

  private schedule(flowId: string, intervalSeconds: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(flowId, intervalSeconds), this.pollDelay(intervalSeconds));
  }

  private poll(flowId: string, intervalSeconds: number): void {
    this.api
      .pollGoogle(flowId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          switch (result.status) {
            case 'pending':
              this.schedule(flowId, result.intervalSeconds ?? intervalSeconds);
              return;
            case 'authorized':
              this.dialogRef.close(result.location ?? undefined);
              return;
            case 'denied':
              this.fail("Access was declined on Google's page.");
              return;
            case 'expired':
              this.fail('The code expired before it was used. Start again to get a new one.');
              return;
          }
        },
        error: (error: unknown) => this.fail(toApiError(error).message),
      });
  }

  private fail(message: string): void {
    clearTimeout(this.timer);
    this.phase.set({ kind: 'failed', message });
  }
}
