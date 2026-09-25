import { Component, computed, input } from '@angular/core';
import { PageHeader } from '../../shared/components/page-header/page-header';
import type { MediaCategory } from '../../shared/models';
import { MessageFeed } from '../messages/message-feed';
import { mediaSection } from './media-sections';

/** One browser for videos, images, documents and audio; the route data picks the category. */
@Component({
  selector: 'app-media-browser-page',
  imports: [MessageFeed, PageHeader],
  template: `
    @let current = section();
    <app-page-header eyebrow="Library" [title]="current.title" [subtitle]="current.description" />
    <app-message-feed [category]="mediaCategory()" />
  `,
})
export class MediaBrowserPage {
  /** Route data `mediaCategory`, bound by the router. */
  readonly mediaCategory = input.required<MediaCategory>();

  protected readonly section = computed(() => mediaSection(this.mediaCategory()));
}
