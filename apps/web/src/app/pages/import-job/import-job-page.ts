import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { chatTypeLabel } from '../../features/channels/channel-labels';
import { ImportJobWatch } from '../../features/imports/import-job-watch';
import { ImportProgress } from '../../features/imports/import-progress';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { isNotFoundError, toApiError } from '../../shared/models';

@Component({
  selector: 'app-import-job-page',
  providers: [ImportJobWatch],
  imports: [
    DatePipe,
    EmptyState,
    ErrorState,
    ImportProgress,
    MatButton,
    MatIcon,
    PageHeader,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './import-job-page.html',
  styleUrl: './import-job-page.scss',
})
export class ImportJobPage {
  /** Route parameter `:id`, bound by the router. */
  readonly id = input.required<string>();

  protected readonly watch = inject(ImportJobWatch);

  protected readonly notFound = computed(() => isNotFoundError(this.watch.error()));
  protected readonly errorMessage = computed(() => toApiError(this.watch.error()).message);
  protected readonly subtitle = computed(() => {
    const job = this.watch.job();
    if (!job) {
      return '';
    }
    const kind = job.type === 'SYNC' ? 'Sync' : 'Import';
    return `${kind} of a ${chatTypeLabel(job.channel.type).toLowerCase()}`;
  });

  constructor() {
    effect(() => this.watch.id.set(this.id()));
  }
}
