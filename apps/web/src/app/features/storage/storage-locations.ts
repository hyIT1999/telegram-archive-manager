import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type StorageKind,
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
 * Whether a location is checked on its own when the list arrives. A Telegram chat is checked by
 * asking Telegram, which is left to the Check button: its stored state is shown instead.
 */
function checksItself(location: StorageLocationDto): boolean {
  return location.kind !== 'TELEGRAM';
}

/**
 * The storage locations shown by one list (wizard step, settings, backup chat choice), each
 * folder and Drive checked once when the list arrives so the page shows fresh free space and
 * notices broken locations (revoked Google access, removed folders) before anything is saved there.
 */
@Injectable()
export class StorageLocations {
  private readonly api = inject(StorageApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resource = rxResource({ stream: () => this.api.list() });
  /** The kinds the list shows (null: every kind). */
  private readonly kinds = signal<() => readonly StorageKind[] | null>(() => null);

  readonly list = computed<StorageLocationListDto | undefined>(() =>
    this.resource.hasValue() ? this.resource.value() : undefined,
  );
  /** The locations of the kinds shown. */
  readonly items = computed(() => {
    const kinds = this.kinds()();
    const items = this.list()?.items ?? [];
    return kinds === null ? items : items.filter((item) => kinds.includes(item.kind));
  });
  readonly error = computed(() => this.resource.error());
  readonly defaultLocation = computed(() => this.items().find((item) => item.isDefault) ?? null);

  private readonly checkStates = signal<ReadonlyMap<string, LocationCheck>>(new Map());
  readonly checks = this.checkStates.asReadonly();

  constructor() {
    effect(() => {
      if (!this.list()) {
        return;
      }
      const items = this.items();
      untracked(() => {
        for (const item of items) {
          if (checksItself(item) && !this.checkStates().has(item.id)) {
            this.check(item.id);
          }
        }
      });
    });
  }

  /** Shows (and checks) only locations of these kinds; null shows every kind. */
  showOnly(kinds: () => readonly StorageKind[] | null): void {
    this.kinds.set(kinds);
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

  /**
   * A location created or reconnected elsewhere (dialog): shown, and checked right away (a
   * Telegram chat was checked when it was added).
   */
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
    if (checksItself(location)) {
      this.check(location.id);
    }
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
