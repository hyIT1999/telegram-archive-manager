import { Component, computed, input } from '@angular/core';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import type { MediaCategory } from '../../shared/models';
import { mediaSection } from './media-sections';

/** One browser for videos, images, documents and audio; the route data picks the category. */
@Component({
  selector: 'app-media-browser-page',
  imports: [EmptyState, PageHeader],
  template: `
    @let current = section();
    <app-page-header eyebrow="Library" [title]="current.title" [subtitle]="current.description" />
    <app-empty-state
      class="surface-card"
      [icon]="current.icon"
      note="Arrives in Phase 5"
      [title]="current.title + ' browsing is on its way'"
      message="A gallery with previews, players and viewers for downloaded files arrives in Phase 5."
    />
  `,
})
export class MediaBrowserPage {
  /** Route data `mediaCategory`, bound by the router. */
  readonly mediaCategory = input.required<MediaCategory>();

  protected readonly section = computed(() => mediaSection(this.mediaCategory()));
}
