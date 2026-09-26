import { Injectable, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { type TagDto, toApiError } from '../../shared/models';
import { TagsApi } from './tags-api';

const byName = (a: TagDto, b: TagDto) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/**
 * The archive's tags, shared by the filters, the tag editor and the tag pages. Nothing is loaded
 * until a screen asks with load(); reload() after changes keeps the counts right.
 */
@Injectable({ providedIn: 'root' })
export class TagStore {
  private readonly api = inject(TagsApi);
  private readonly wanted = signal(false);
  private readonly resource = rxResource({
    params: () => (this.wanted() ? true : undefined),
    stream: () => this.api.list(),
  });

  /** Every tag by name; empty until loaded. */
  readonly tags = computed<readonly TagDto[]>(() =>
    this.resource.hasValue() ? [...this.resource.value().items].sort(byName) : [],
  );
  readonly loaded = computed(() => this.resource.hasValue());
  readonly loading = computed(() => this.resource.isLoading());
  readonly error = computed(() =>
    this.resource.error() ? toApiError(this.resource.error()).message : null,
  );

  /** Loads the tags, once. */
  load(): void {
    this.wanted.set(true);
  }

  /** Loads them again (a tag was added, renamed, recolored or deleted), if they were loaded. */
  reload(): void {
    if (this.wanted()) {
      this.resource.reload();
    }
  }

  /** Loads the tags, or loads them again: for pages that show their counts. */
  fetch(): void {
    if (this.wanted()) {
      this.resource.reload();
    } else {
      this.wanted.set(true);
    }
  }

  find(id: string): TagDto | undefined {
    return this.tags().find((tag) => tag.id === id);
  }
}
