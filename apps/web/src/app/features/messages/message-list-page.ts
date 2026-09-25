import { Component } from '@angular/core';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { MessageFeed } from './message-feed';

/** Every archived message, newest first, with the feed's filters. */
@Component({
  selector: 'app-message-list-page',
  imports: [MessageFeed, PageHeader],
  template: `
    <app-page-header
      eyebrow="Library"
      title="All Messages"
      subtitle="Every archived message across your channels. Albums sent together stay together."
    />
    <app-message-feed />
  `,
})
export class MessageListPage {}
