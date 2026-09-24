import { Component, computed, input } from '@angular/core';

export type SkeletonVariant = 'line' | 'card' | 'stat';

/**
 * Loading placeholder shaped like the content it stands in for. `card` and `stat` lay out their
 * blocks in a responsive grid (tune with `--skeleton-min-column`); `line` stacks text lines.
 * Screen readers hear one "Loading…" status instead of the decorative blocks.
 */
@Component({
  selector: 'app-skeleton',
  host: { role: 'status' },
  template: `
    <span class="sr-only">{{ label() }}</span>
    <div [class]="variant() === 'line' ? 'lines' : 'grid'" aria-hidden="true">
      @for (item of items(); track item) {
        @switch (variant()) {
          @case ('stat') {
            <div class="surface-card block stat">
              <span class="skeleton icon"></span>
              <span class="skeleton line short"></span>
              <span class="skeleton line value"></span>
            </div>
          }
          @case ('card') {
            <div class="surface-card block card">
              <span class="skeleton line title"></span>
              <span class="skeleton line short"></span>
              <span class="skeleton line"></span>
              <span class="skeleton line"></span>
            </div>
          }
          @default {
            <span class="skeleton line"></span>
          }
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(var(--skeleton-min-column, 220px), 1fr));
    }

    .lines {
      display: grid;
      gap: 12px;
    }

    .block {
      display: grid;
      align-content: start;
      gap: 12px;
      padding: 20px;
    }

    .stat {
      min-height: 124px;
    }

    .card {
      min-height: 168px;
    }

    .line {
      height: 12px;
    }

    .short {
      width: 45%;
    }

    .title {
      width: 70%;
      height: 20px;
    }

    .value {
      width: 55%;
      height: 28px;
    }

    .icon {
      width: 40px;
      height: 40px;
      border-radius: var(--mat-sys-corner-medium);
    }
  `,
})
export class Skeleton {
  readonly variant = input<SkeletonVariant>('line');
  readonly count = input(1);
  readonly label = input('Loading…');

  protected readonly items = computed(() =>
    Array.from({ length: Math.max(1, this.count()) }, (_, index) => index),
  );
}
