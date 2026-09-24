import { Component } from '@angular/core';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-favorites-page',
  imports: [EmptyState, PageHeader],
  template: `
    <app-page-header
      eyebrow="Collections"
      title="Favorites"
      subtitle="Messages you starred to find again quickly."
    />
    <app-empty-state
      class="surface-card"
      icon="star"
      note="Arrives in Phase 6"
      title="Favorites are on their way"
      message="Starring messages and browsing your favorites arrives in Phase 6."
    />
  `,
})
export class FavoritesPage {}
