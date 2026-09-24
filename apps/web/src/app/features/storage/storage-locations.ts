import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type StorageLocationDto,
  type StorageLocationListDto,
  type StorageSpaceDto,
  toApiError,
} from '../../shared/models';
import { StorageApi } from './storage-api';

export interface LocationCheck {
  status: 'checking' | 'ok' | 'failed';
  space: StorageSpaceDto | null;
  message: string | null;
}

/**
 * The storage locations shown by one list (wizard step, settings), each checked once when the
 * list arrives so the page shows fresh free space and notices broken locations (revoked Google
 * access, removed folders) before anything is saved there.
 */
@Injectable()
export class StorageLocations {
  private readonly api = inject(StorageApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resource = rxResource({ stream: () => this.api.list() });

  readonly list = computed<StorageLocationListDto | undefined>(() =>
    this.resource.hasValue() ? this.resource.value() : undefined,
  );
  readonly items = computed(() => this.list()?.items ?? []);
  readonly error = computed(() => this.resource.error());
  readonly defaultLocation = computed(() => this.items().find((item) => item.isDefault) ?? null);

  private readonly checkStates = signal<ReadonlyMap<string, LocationCheck>>(new Map());
  readonly checks = this.checkStates.asReadonly();

  constructor() {
    effect(() => {
      const items = this.list()?.items;
      if (!items) {
        return;
      }
      untracked(() => {
        for (const item of items) {
          if (!this.checkStates().has(item.id)) {
            this.check(item.id);
          }
        }
      });
    });
  }

  reload(): void {
    this.resource.reload();
  }

  check(id: string): void {
    this.setCheck(id, { status: 'checking', space: null, message: null });
    this.api
      .check(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.setCheck(id, {
            status: result.ok ? 'ok' : 'failed',
            space: result.space,
            message: result.location.lastError,
          });
          this.replace(result.location);
        },
        error: (error: unknown) =>
          this.setCheck(id, { status: 'failed', space: null, message: toApiError(error).message }),
      });
  }

  /** A location created or reconnected elsewhere (dialog): shown and checked right away. */
  upsert(location: StorageLocationDto): void {
    const list = this.list();
    if (!list) {
      return;
    }
    const exists = list.items.some((item) => item.id === location.id);
    this.resource.set({
      ...list,
      items: exists
        ? list.items.map((item) => (item.id === location.id ? location : item))
        : [...list.items, location],
    });
    this.check(location.id);
  }

  /** Removes a location from the list after the server deleted it. */
  removed(id: string): void {
    const list = this.list();
    const wasDefault = list?.items.find((item) => item.id === id)?.isDefault ?? false;
    if (list) {
      this.resource.set({ ...list, items: list.items.filter((item) => item.id !== id) });
    }
    if (wasDefault) {
      // Another location became the default on the server.
      this.reload();
    }
  }

  private replace(location: StorageLocationDto): void {
    const list = this.list();
    if (list?.items.some((item) => item.id === location.id)) {
      this.resource.set({
        ...list,
        items: list.items.map((item) => (item.id === location.id ? location : item)),
      });
    }
  }

  private setCheck(id: string, check: LocationCheck): void {
    this.checkStates.update((checks) => new Map(checks).set(id, check));
  }
}
