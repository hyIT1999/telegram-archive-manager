import { Component, computed, inject, signal } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import type { TagDto } from '../../shared/models';
import { startsWords } from '../../shared/text/searchable';
import { TagActions, messageCount } from './tag-actions';
import { TagStore } from './tag-store';

/** Past this many tags, a field finds one by name. */
export const TAG_SEARCH_FROM = 8;

/** Every tag with how many messages carry it; tags are created, edited and deleted here. */
@Component({
  selector: 'app-tags-page',
  imports: [
    EmptyState,
    ErrorState,
    MatButton,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatPrefix,
    PageHeader,
    RouterLink,
    Skeleton,
  ],
  templateUrl: './tags-page.html',
  styleUrl: './tags-page.scss',
})
export class TagsPage {
  protected readonly store = inject(TagStore);
  private readonly actions = inject(TagActions);

  protected readonly query = signal('');
  protected readonly searchFrom = TAG_SEARCH_FROM;
  protected readonly shown = computed(() => {
    const typed = this.query();
    return this.store.tags().filter((tag) => startsWords(tag.name, typed));
  });
  protected readonly subtitle = computed(() => {
    const count = this.store.tags().length;
    if (!this.store.loaded() || count === 0) {
      return 'Your own labels for organizing archived messages.';
    }
    return count === 1 ? '1 tag' : `${count} tags`;
  });

  constructor() {
    // Fresh counts on every visit.
    this.store.fetch();
  }

  protected count(tag: TagDto): string {
    return messageCount(tag.messageCount);
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected create(): void {
    void this.actions.create();
  }

  protected edit(tag: TagDto): void {
    void this.actions.edit(tag);
  }

  protected remove(tag: TagDto): void {
    void this.actions.remove(tag);
  }
}
