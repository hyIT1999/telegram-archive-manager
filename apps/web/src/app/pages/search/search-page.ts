import { Component, computed, input } from '@angular/core';
import { MessageFeed } from '../../features/messages/message-feed';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

/**
 * Results of the search box in the header, across the whole archive, with the filters of any
 * list. The header's box is the search field, so the list shows none of its own.
 */
@Component({
  selector: 'app-search-page',
  imports: [EmptyState, MessageFeed, PageHeader],
  template: `
    @if (query(); as text) {
      <app-page-header
        eyebrow="Search"
        [title]="'Results for “' + text + '”'"
        subtitle="Message text, captions and file names: every word as the start of a word, with or without accents."
      />
      <app-message-feed [searchField]="false" />
    } @else {
      <app-page-header eyebrow="Search" title="Search" subtitle="Search the whole archive." />
      <app-empty-state
        class="surface-card"
        icon="manage_search"
        title="What are you looking for?"
        message="Type in the search box at the top of the page (press / to jump there). Words match the start of words in file names, message text and captions, with or without accents."
      />
    }
  `,
})
export class SearchPage {
  /** Query parameter `?q=`, bound by the router. */
  readonly q = input<string>();

  protected readonly query = computed(() => this.q()?.trim() ?? '');
}
