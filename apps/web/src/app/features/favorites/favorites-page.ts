import { Component } from '@angular/core';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { MessageFeed } from '../messages/message-feed';

/** The messages marked with ♥, the most recently favorited first. */
@Component({
  selector: 'app-favorites-page',
  imports: [MessageFeed, PageHeader],
  template: `
    <app-page-header
      eyebrow="Collections"
      title="Favorites"
      subtitle="Messages you marked with ♥, the most recently added first."
    />
    <app-message-feed [favorite]="true" defaultSort="favorited" />
  `,
})
export class FavoritesPage {}
