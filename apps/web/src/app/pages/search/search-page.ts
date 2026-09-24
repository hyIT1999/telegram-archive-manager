import { Component, computed, input } from '@angular/core';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-search-page',
  imports: [EmptyState, PageHeader],
  template: `
    <app-page-header eyebrow="Search" [title]="title()" [subtitle]="subtitle()" />
    <app-empty-state
      class="surface-card"
      icon="manage_search"
      note="Arrives in Phase 6"
      title="Full-text search is on its way"
      message="Searching message text, captions and file names, with filters, arrives in Phase 6."
    />
  `,
})
export class SearchPage {
  /** Query parameter `?q=`, bound by the router. */
  readonly q = input<string>();

  protected readonly query = computed(() => this.q()?.trim() ?? '');
  protected readonly title = computed(() =>
    this.query() ? `Results for “${this.query()}”` : 'Search',
  );
  protected readonly subtitle = computed(() =>
    this.query() ? 'Search results will be listed here.' : 'Search the whole archive.',
  );
}
