import { Component, DestroyRef, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { finalize } from 'rxjs';
import { Notice } from '../../shared/components/notice/notice';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { type MediaType, type SettingsDto, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';
import { MEDIA_TYPE_OPTIONS } from '../downloads/download-labels';
import { SettingsApi } from './settings-api';

/** The limits the api accepts. */
const MAX_FILE_SIZE_MB = 4_096;
const CONCURRENCY_OPTIONS = [1, 2, 3, 4] as const;

/** The download settings as the form edits them (the size as typed). */
interface DownloadDraft {
  mediaTypes: MediaType[];
  maxFileSizeMb: string;
  concurrency: number;
}

function draftOf(settings: SettingsDto): DownloadDraft {
  return {
    mediaTypes: [...settings.downloads.mediaTypes],
    maxFileSizeMb:
      settings.downloads.maxFileSizeMb === null ? '' : String(settings.downloads.maxFileSizeMb),
    concurrency: settings.downloads.concurrency,
  };
}

/** Null for "no limit", a number of MiB, or undefined when the text is not a valid size. */
function parseSize(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 1 && value <= MAX_FILE_SIZE_MB ? value : undefined;
}

/**
 * How media files are downloaded: pausing everything (applies at once), which types download
 * automatically, the largest automatic file and how many files download at the same time.
 */
@Component({
  selector: 'app-download-settings',
  imports: [
    BytesPipe,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatHint,
    MatIcon,
    MatInput,
    MatLabel,
    MatOption,
    MatProgressSpinner,
    MatSelect,
    MatSlideToggle,
    Notice,
    Skeleton,
  ],
  templateUrl: './download-settings.html',
  styleUrl: './download-settings.scss',
})
export class DownloadSettingsPanel {
  private readonly api = inject(SettingsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly typeOptions = MEDIA_TYPE_OPTIONS;
  protected readonly concurrencyOptions = CONCURRENCY_OPTIONS;
  protected readonly mib = 1024 * 1024;

  protected readonly settings = rxResource({ stream: () => this.api.get() });
  protected readonly saved = computed<SettingsDto | undefined>(() =>
    this.settings.hasValue() ? this.settings.value() : undefined,
  );
  protected readonly loadError = computed(() =>
    this.settings.error() ? toApiError(this.settings.error()).message : null,
  );

  protected readonly draft = linkedSignal<SettingsDto | undefined, DownloadDraft | null>({
    source: this.saved,
    computation: (saved) => (saved ? draftOf(saved) : null),
  });
  protected readonly sizeProblem = computed(() => {
    const draft = this.draft();
    return draft && parseSize(draft.maxFileSizeMb) === undefined
      ? `Enter a whole number of MB from 1 to ${MAX_FILE_SIZE_MB}, or leave it empty for no limit.`
      : null;
  });
  protected readonly changed = computed(() => {
    const draft = this.draft();
    const saved = this.saved();
    if (!draft || !saved) {
      return false;
    }
    const current = draftOf(saved);
    return (
      draft.concurrency !== current.concurrency ||
      parseSize(draft.maxFileSizeMb) !== saved.downloads.maxFileSizeMb ||
      [...draft.mediaTypes].sort().join() !== [...current.mediaTypes].sort().join()
    );
  });

  protected readonly pausing = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedNotice = signal(false);

  protected reload(): void {
    this.settings.reload();
  }

  protected togglePaused(change: MatSlideToggleChange): void {
    this.pausing.set(true);
    this.error.set(null);
    this.api
      .update({ downloads: { paused: change.checked } })
      .pipe(
        finalize(() => this.pausing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (settings) => this.settings.set(settings),
        error: (error: unknown) => {
          this.error.set(toApiError(error).message);
          change.source.checked = !change.checked;
        },
      });
  }

  protected toggleType(type: MediaType, checked: boolean): void {
    this.savedNotice.set(false);
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            mediaTypes: checked
              ? [...draft.mediaTypes.filter((item) => item !== type), type]
              : draft.mediaTypes.filter((item) => item !== type),
          }
        : draft,
    );
  }

  protected setMaxSize(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.savedNotice.set(false);
    this.draft.update((draft) => (draft ? { ...draft, maxFileSizeMb: value } : draft));
  }

  protected setConcurrency(value: number): void {
    this.savedNotice.set(false);
    this.draft.update((draft) => (draft ? { ...draft, concurrency: value } : draft));
  }

  protected save(): void {
    const draft = this.draft();
    const maxFileSizeMb = draft ? parseSize(draft.maxFileSizeMb) : undefined;
    if (!draft || maxFileSizeMb === undefined || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api
      .update({
        downloads: { mediaTypes: draft.mediaTypes, maxFileSizeMb, concurrency: draft.concurrency },
      })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (settings) => {
          this.settings.set(settings);
          this.savedNotice.set(true);
        },
        error: (error: unknown) => this.error.set(toApiError(error).message),
      });
  }
}
