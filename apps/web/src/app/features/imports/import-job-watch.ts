import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ConfirmService } from '../../core/services/confirm-service';
import { type ImportJobDto, toApiError } from '../../shared/models';
import { isMoving } from './import-labels';
import { type ImportJobAction, ImportsApi } from './imports-api';

export interface ImportPolling {
  /** Re-read a job this often while it is queued or running. */
  readonly jobMs: number;
  /** Re-read the job list this often while one of its jobs is queued or running. */
  readonly listMs: number;
}

/** Polling until live progress over server-sent events arrives (Phase 7). */
export const IMPORT_POLLING = new InjectionToken<ImportPolling>('IMPORT_POLLING', {
  providedIn: 'root',
  factory: () => ({ jobMs: 2_000, listMs: 5_000 }),
});

/**
 * One import job as a page shows it: loaded by id, re-read while it moves, and paused, resumed
 * or cancelled from there. Each page provides its own instance, so polling stops when it is left.
 */
@Injectable()
export class ImportJobWatch {
  private readonly api = inject(ImportsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly polling = inject(IMPORT_POLLING);
  private readonly destroyRef = inject(DestroyRef);

  /** The job to show (route parameter, or the job the wizard just started). */
  readonly id = signal<string | null>(null);

  private readonly resource = rxResource({
    params: () => this.id() ?? undefined,
    stream: ({ params }) => this.api.get(params),
  });

  /** The latest state of the job; kept while it is being re-read. */
  readonly job = computed<ImportJobDto | undefined>(() =>
    this.resource.hasValue() ? this.resource.value() : undefined,
  );
  readonly error = computed(() => this.resource.error());
  /** The action in progress, if any. */
  readonly busy = signal<ImportJobAction | null>(null);
  readonly actionError = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const job = this.job();
      if (!job || !isMoving(job) || this.resource.isLoading()) {
        return;
      }
      const timer = setTimeout(() => {
        // An action may have settled the job since the timer was set.
        const current = this.job();
        if (current && isMoving(current)) {
          this.resource.reload();
        }
      }, this.polling.jobMs);
      onCleanup(() => clearTimeout(timer));
    });
  }

  reload(): void {
    this.resource.reload();
  }

  /** Pauses or resumes at once; cancelling asks first, because a cancelled import cannot resume. */
  async request(action: ImportJobAction): Promise<void> {
    const job = this.job();
    if (!job || this.busy()) {
      return;
    }
    if (action === 'cancel') {
      const confirmed = await this.confirm.ask({
        title: 'Cancel this import?',
        message: `Messages of ${job.channel.title} imported so far stay in the archive. A cancelled import cannot be resumed; start a new one to continue later.`,
        confirmLabel: 'Cancel import',
        cancelLabel: 'Keep importing',
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
    }
    this.act(action);
  }

  private act(action: ImportJobAction): void {
    const job = this.job();
    if (!job || this.busy()) {
      return;
    }
    this.busy.set(action);
    this.actionError.set(null);
    this.api
      .act(job.id, action)
      .pipe(
        finalize(() => this.busy.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => this.resource.set(updated),
        error: (error: unknown) => {
          this.actionError.set(toApiError(error).message);
          // Someone (or the worker) changed the job meanwhile: show where it stands now.
          this.resource.reload();
        },
      });
  }
}
