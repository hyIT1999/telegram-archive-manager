import { Component, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { MessageFeed } from '../messages/message-feed';
import { TagActions, messageCount } from './tag-actions';
import { TAG_COLORS } from './tag-palette';
import { TagStore } from './tag-store';

/** The messages carrying one tag, with the tag's own actions. */
@Component({
  selector: 'app-tag-page',
  imports: [
    EmptyState,
    ErrorState,
    MatButton,
    MatIcon,
    MessageFeed,
    PageHeader,
    RouterLink,
    Skeleton,
  ],
  template: `
    @if (store.error(); as message) {
      <app-page-header eyebrow="Tag" title="Tag" />
      <app-error-state
        title="The tag could not be loaded"
        [message]="message"
        (retry)="store.reload()"
      />
    } @else if (notFound()) {
      <app-empty-state
        class="surface-card"
        icon="search_off"
        title="Tag not found"
        message="It may have been deleted."
      >
        <a matButton="filled" routerLink="/tags">
          <mat-icon>arrow_back</mat-icon>
          All tags
        </a>
      </app-empty-state>
    } @else if (tag(); as current) {
      <app-page-header eyebrow="Tag" [title]="current.name" [subtitle]="count()">
        <p class="color">
          <span class="swatch" aria-hidden="true" [style.background]="current.color"></span>
          {{ colorName() }}
        </p>
        <a pageActions matButton="outlined" routerLink="/tags">
          <mat-icon>arrow_back</mat-icon>
          All tags
        </a>
        <button pageActions matButton="outlined" type="button" (click)="edit()">
          <mat-icon>edit</mat-icon>
          Edit
        </button>
        <button pageActions matButton="outlined" type="button" (click)="remove()">
          <mat-icon>delete</mat-icon>
          Delete
        </button>
      </app-page-header>
      <app-message-feed [tagId]="current.id" />
    } @else {
      <app-skeleton variant="line" [count]="3" label="Loading the tag…" />
    }
  `,
  styles: `
    .color {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0 0;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--mat-sys-outline);
    }
  `,
})
export class TagPage {
  /** Route parameter `:id`, bound by the router. */
  readonly id = input.required<string>();

  protected readonly store = inject(TagStore);
  private readonly actions = inject(TagActions);
  private readonly router = inject(Router);

  protected readonly tag = computed(() => this.store.find(this.id()));
  protected readonly notFound = computed(() => this.store.loaded() && !this.tag());
  protected readonly count = computed(() => {
    const tag = this.tag();
    return tag ? messageCount(tag.messageCount) : '';
  });
  protected readonly colorName = computed(() => {
    const color = this.tag()?.color ?? null;
    return color === null
      ? 'No color'
      : (TAG_COLORS.find((option) => option.value === color)?.name ?? color);
  });

  constructor() {
    this.store.fetch();
  }

  protected edit(): void {
    const tag = this.tag();
    if (tag) {
      void this.actions.edit(tag);
    }
  }

  protected async remove(): Promise<void> {
    const tag = this.tag();
    if (tag && (await this.actions.remove(tag))) {
      await this.router.navigate(['/tags']);
    }
  }
}
