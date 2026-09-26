import { DatePipe, formatDate, formatNumber } from '@angular/common';
import {
  Component,
  LOCALE_ID,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar, type ProgressBarMode } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { Notice } from '../../shared/components/notice/notice';
import type { ImportJobDto } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { DOWNLOAD_STAGE_LABELS } from '../downloads/download-labels';
import {
  JOB_STATUS_ICONS,
  canPause,
  canResume,
  downloadedPercent,
  isSync,
  isUnfinished,
  jobNoun,
  progressPercent,
  statusLabel,
} from './import-labels';
import type { ImportJobAction } from './imports-api';

/**
 * Where an import or sync job stands: status, a progress bar over the expected messages, what was
 * found and downloaded (with the files downloading now), why it waits or failed, and
 * (optionally) pause/resume/cancel buttons that emit `action`.
 */
@Component({
  selector: 'app-import-progress',
  imports: [DatePipe, MatButton, MatIcon, MatProgressBar, MatProgressSpinner, Notice],
  templateUrl: './import-progress.html',
  styleUrl: './import-progress.scss',
})
export class ImportProgress {
  readonly job = input.required<ImportJobDto>();
  /** Shows the pause/resume/cancel buttons. */
  readonly actions = input(false, { transform: booleanAttribute });
  /** The action in progress, if any (its button shows a spinner, the others are disabled). */
  readonly busy = input<ImportJobAction | null>(null);
  readonly actionError = input<string | null>(null);
  readonly action = output<ImportJobAction>();

  private readonly locale = inject(LOCALE_ID);
  private readonly bytes = new BytesPipe();

  protected readonly statusLabel = computed(() => statusLabel(this.job()));
  protected readonly statusIcon = computed(() => JOB_STATUS_ICONS[this.job().status]);
  protected readonly noun = computed(() => jobNoun(this.job()));
  protected readonly unfinished = computed(() => isUnfinished(this.job()));
  protected readonly canPause = computed(() => canPause(this.job()));
  protected readonly canResume = computed(() => canResume(this.job()));
  protected readonly percent = computed(() => progressPercent(this.job()));

  protected readonly barMode = computed<ProgressBarMode>(() => {
    const job = this.job();
    if (job.status === 'PENDING') {
      return 'query';
    }
    return job.status === 'RUNNING' && this.percent() === null ? 'indeterminate' : 'determinate';
  });

  protected readonly modeText = computed(() => {
    const job = this.job();
    if (isSync(job)) {
      return 'New messages';
    }
    if (job.mode === 'ALL' || !job.fromDate) {
      return 'The whole history';
    }
    return `Messages since ${formatDate(job.fromDate, 'longDate', this.locale)}`;
  });

  protected readonly messagesText = computed(() => {
    const job = this.job();
    const read = this.count(job.processedMessages);
    if (job.status === 'COMPLETED') {
      if (isSync(job)) {
        return job.processedMessages === 0
          ? 'No new messages'
          : `${read} new ${job.processedMessages === 1 ? 'message' : 'messages'}`;
      }
      return `${read} ${job.processedMessages === 1 ? 'message' : 'messages'}`;
    }
    if (job.totalMessages !== null) {
      return `${read} of about ${this.count(job.totalMessages)}`;
    }
    return `${read} read so far`;
  });

  /** How far the files this import found have downloaded (they download after the import). */
  protected readonly downloadsText = computed(() => {
    const job = this.job();
    if (job.totalMedia === 0) {
      return null;
    }
    const percent = downloadedPercent(job);
    const parts = [
      `${this.count(job.downloadedFiles)} of ${this.count(job.totalMedia)} files · ${this.bytes.transform(job.downloadedBytes)} of ${this.bytes.transform(job.totalBytes)}`,
    ];
    if (percent !== null) {
      // A few files of a big archive are not nothing.
      parts.unshift(percent === 0 && job.downloadedFiles > 0 ? '<1 %' : `${percent} %`);
    }
    if (job.failedFiles > 0) {
      parts.push(`${this.count(job.failedFiles)} failed`);
    }
    if (job.skippedFiles > 0) {
      parts.push(`${this.count(job.skippedFiles)} skipped`);
    }
    return parts.join(' · ');
  });

  /** The files downloading now: the first one with its progress, and how many more. */
  protected readonly currentFileText = computed(() => {
    const [first, ...others] = this.job().activeFiles;
    if (!first) {
      return null;
    }
    const detail =
      first.stage === 'FETCHING'
        ? `${first.progress} %`
        : first.stage
          ? DOWNLOAD_STAGE_LABELS[first.stage]
          : 'Starting';
    const more = others.length > 0 ? ` (and ${others.length} more)` : '';
    return `${first.name} · ${detail}${more}`;
  });

  protected readonly mediaText = computed(() => {
    const job = this.job();
    if (job.totalMedia === 0) {
      return this.unfinished() ? 'None found yet' : 'None';
    }
    return `${this.count(job.totalMedia)} ${job.totalMedia === 1 ? 'file' : 'files'} · ${this.bytes.transform(job.totalBytes)}`;
  });

  protected emit(action: ImportJobAction): void {
    if (this.busy() === null) {
      this.action.emit(action);
    }
  }

  private count(value: number): string {
    return formatNumber(value, this.locale, '1.0-0');
  }
}
